/**
 * The single strict data contract used for BOTH external GitHub responses and
 * the runner's own persisted evidence.
 *
 * There is deliberately one implementation rather than one per boundary: a
 * second, laxer parser is how a boundary quietly stops being a boundary.
 *
 * What it enforces:
 *
 *   - **fatal UTF-8 decoding.** Bytes are decoded with `fatal: true`, so an
 *     invalid sequence is an error rather than U+FFFD. Silent replacement is
 *     exactly how two different byte strings become one identifier.
 *   - **decoded-key duplicate rejection.** `JSON.parse` keeps the LAST of a
 *     duplicated key and gives no way to observe that it happened, so a
 *     response carrying `"conclusion":"failure","conclusion":"success"` would
 *     read as success. Keys are compared AFTER escape decoding, so `"a"` and
 *     `"a"` are the same key.
 *   - **bounded documents.** Byte length, nesting depth, node count, string
 *     length and key length all have fixed ceilings.
 *   - **safe integers.** An integral literal outside the safe range is refused
 *     rather than silently rounded to a different number.
 *   - **closed schemas at every depth.** Object schemas name every field they
 *     accept; an unknown field is rejected unless that object explicitly
 *     declares `unknown: "discard"`, which only the external-GitHub schemas do
 *     and which records how many keys were discarded.
 *   - **fixed enumerations.** A string field can be pinned to a closed set.
 *
 * Nothing in this module reads the environment, the clock, or the filesystem.
 */

/** A validation or parse failure. Carries a path, never external content. */
export class StrictDataError extends Error {
  /**
   * @param {string} reason a message written in source
   * @param {string} [path] the location in the document, e.g. `$.jobs[3].name`
   */
  constructor(reason, path = "$") {
    super(`${path}: ${reason}`);
    this.name = "StrictDataError";
    this.path = path;
    this.reason = reason;
  }
}

/** Fixed ceilings. Not configurable; a caller may only make them smaller. */
export const STRICT_LIMITS = Object.freeze({
  maxBytes: 2_000_000,
  maxDepth: 32,
  maxNodes: 200_000,
  maxStringChars: 100_000,
  maxKeyChars: 256,
});

/**
 * Decode bytes as UTF-8 with no substitution and no BOM tolerance.
 *
 * @param {Uint8Array} bytes
 * @param {{ maxBytes?: number }} [options]
 * @returns {string}
 */
export const decodeUtf8Strict = (bytes, options = {}) => {
  const maxBytes = Math.min(options.maxBytes ?? STRICT_LIMITS.maxBytes, STRICT_LIMITS.maxBytes);
  if (!(bytes instanceof Uint8Array)) throw new StrictDataError("expected raw bytes");
  if (bytes.byteLength > maxBytes) {
    throw new StrictDataError(`document is ${bytes.byteLength} bytes; the ceiling is ${maxBytes}`);
  }
  try {
    // `ignoreBOM: false` makes a leading U+FEFF a real character rather than a
    // silently stripped prefix, so it is then rejected as a leading token.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new StrictDataError("document is not valid UTF-8");
  }
};

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const DIGITS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/**
 * A recursive-descent JSON reader.
 *
 * `JSON.parse` cannot express the two properties this boundary needs — it
 * silently collapses duplicate keys and it silently rounds oversized integers —
 * so the document is read here instead.
 */
class StrictJsonReader {
  /**
   * @param {string} text
   * @param {{ maxDepth: number, maxNodes: number, maxStringChars: number, maxKeyChars: number }} limits
   */
  constructor(text, limits) {
    this.text = text;
    this.i = 0;
    this.nodes = 0;
    this.limits = limits;
  }

  /** @param {string} reason */
  fail(reason) {
    throw new StrictDataError(`${reason} at offset ${this.i}`);
  }

  countNode() {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) this.fail("document exceeds the node ceiling");
  }

  skipWhitespace() {
    while (this.i < this.text.length && WHITESPACE.has(this.text[this.i])) this.i += 1;
  }

  /** @param {number} depth */
  readValue(depth) {
    if (depth > this.limits.maxDepth) this.fail("document exceeds the nesting ceiling");
    this.countNode();
    this.skipWhitespace();
    if (this.i >= this.text.length) this.fail("unexpected end of document");
    const c = this.text[this.i];
    if (c === "{") return this.readObject(depth);
    if (c === "[") return this.readArray(depth);
    if (c === '"') return this.readString(this.limits.maxStringChars);
    if (c === "-" || DIGITS.has(c)) return this.readNumber();
    if (this.text.startsWith("true", this.i)) return (this.i += 4), true;
    if (this.text.startsWith("false", this.i)) return (this.i += 5), false;
    if (this.text.startsWith("null", this.i)) return (this.i += 4), null;
    return this.fail("unexpected token");
  }

  /** @param {number} depth */
  readObject(depth) {
    this.i += 1; // consume '{'
    /** @type {Record<string, unknown>} */
    const out = Object.create(null);
    const seen = new Set();
    this.skipWhitespace();
    if (this.text[this.i] === "}") return this.i += 1, out;
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.i] !== '"') this.fail("expected a quoted object key");
      const key = this.readString(this.limits.maxKeyChars);
      // Compared AFTER escape decoding: `"a"` and `"a"` are one key.
      if (seen.has(key)) this.fail("duplicate object key after escape decoding");
      seen.add(key);
      this.skipWhitespace();
      if (this.text[this.i] !== ":") this.fail("expected ':' after an object key");
      this.i += 1;
      // `__proto__` on a null-prototype object is an ordinary own property, but
      // it is refused outright so no consumer can be surprised by it later.
      if (key === "__proto__") this.fail("refusing the key __proto__");
      out[key] = this.readValue(depth + 1);
      this.skipWhitespace();
      const c = this.text[this.i];
      if (c === ",") {
        this.i += 1;
        continue;
      }
      if (c === "}") {
        this.i += 1;
        return out;
      }
      this.fail("expected ',' or '}' in an object");
    }
  }

  /** @param {number} depth */
  readArray(depth) {
    this.i += 1; // consume '['
    /** @type {unknown[]} */
    const out = [];
    this.skipWhitespace();
    if (this.text[this.i] === "]") return this.i += 1, out;
    for (;;) {
      out.push(this.readValue(depth + 1));
      this.skipWhitespace();
      const c = this.text[this.i];
      if (c === ",") {
        this.i += 1;
        continue;
      }
      if (c === "]") {
        this.i += 1;
        return out;
      }
      this.fail("expected ',' or ']' in an array");
    }
  }

  /** @param {number} maxChars */
  readString(maxChars) {
    this.i += 1; // consume opening quote
    let out = "";
    for (;;) {
      if (this.i >= this.text.length) this.fail("unterminated string");
      const c = this.text[this.i];
      if (c === '"') {
        this.i += 1;
        if (out.length > maxChars) this.fail("string exceeds its ceiling");
        return out;
      }
      if (c === "\\") {
        this.i += 1;
        const esc = this.text[this.i];
        if (esc === '"') out += '"';
        else if (esc === "\\") out += "\\";
        else if (esc === "/") out += "/";
        else if (esc === "b") out += "\b";
        else if (esc === "f") out += "\f";
        else if (esc === "n") out += "\n";
        else if (esc === "r") out += "\r";
        else if (esc === "t") out += "\t";
        else if (esc === "u") {
          const hex = this.text.slice(this.i + 1, this.i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("malformed \\u escape");
          out += String.fromCharCode(Number.parseInt(hex, 16));
          this.i += 4;
        } else this.fail("unknown string escape");
        this.i += 1;
        continue;
      }
      // JSON forbids unescaped control characters inside a string.
      if (c < " ") this.fail("unescaped control character in a string");
      out += c;
      this.i += 1;
      if (out.length > maxChars) this.fail("string exceeds its ceiling");
    }
  }

  readNumber() {
    const start = this.i;
    if (this.text[this.i] === "-") this.i += 1;
    if (this.text[this.i] === "0") this.i += 1;
    else if (DIGITS.has(this.text[this.i])) {
      while (this.i < this.text.length && DIGITS.has(this.text[this.i])) this.i += 1;
    } else this.fail("malformed number");
    let integral = true;
    if (this.text[this.i] === ".") {
      integral = false;
      this.i += 1;
      if (!DIGITS.has(this.text[this.i])) this.fail("malformed number fraction");
      while (this.i < this.text.length && DIGITS.has(this.text[this.i])) this.i += 1;
    }
    if (this.text[this.i] === "e" || this.text[this.i] === "E") {
      integral = false;
      this.i += 1;
      if (this.text[this.i] === "+" || this.text[this.i] === "-") this.i += 1;
      if (!DIGITS.has(this.text[this.i])) this.fail("malformed number exponent");
      while (this.i < this.text.length && DIGITS.has(this.text[this.i])) this.i += 1;
    }
    const value = Number(this.text.slice(start, this.i));
    if (!Number.isFinite(value)) this.fail("number is not finite");
    // An integral literal that does not survive the round trip has been rounded
    // to a DIFFERENT number. A run id is exactly such a value, so this is
    // refused rather than recorded.
    if (integral && !Number.isSafeInteger(value)) this.fail("integer is outside the safe range");
    return value;
  }
}

/**
 * Parse a JSON document under the strict rules above.
 *
 * @param {string} text
 * @param {Partial<typeof STRICT_LIMITS>} [overrides] may only tighten
 * @returns {unknown}
 */
export const parseStrictJson = (text, overrides = {}) => {
  const limits = {
    maxDepth: Math.min(overrides.maxDepth ?? STRICT_LIMITS.maxDepth, STRICT_LIMITS.maxDepth),
    maxNodes: Math.min(overrides.maxNodes ?? STRICT_LIMITS.maxNodes, STRICT_LIMITS.maxNodes),
    maxStringChars: Math.min(
      overrides.maxStringChars ?? STRICT_LIMITS.maxStringChars,
      STRICT_LIMITS.maxStringChars,
    ),
    maxKeyChars: Math.min(
      overrides.maxKeyChars ?? STRICT_LIMITS.maxKeyChars,
      STRICT_LIMITS.maxKeyChars,
    ),
  };
  const reader = new StrictJsonReader(text, limits);
  const value = reader.readValue(0);
  reader.skipWhitespace();
  if (reader.i !== text.length) reader.fail("trailing content after the document");
  return value;
};

/**
 * Decode bytes and parse them in one step.
 *
 * @param {Uint8Array} bytes
 * @param {Partial<typeof STRICT_LIMITS>} [overrides]
 */
export const readStrictJson = (bytes, overrides = {}) =>
  parseStrictJson(decodeUtf8Strict(bytes, overrides), overrides);

// ---------------------------------------------------------------------------
// Closed schemas
// ---------------------------------------------------------------------------

/** @param {{ max?: number, min?: number }} [o] */
export const str = (o = {}) => ({ kind: "string", min: o.min ?? 0, max: o.max ?? 4_096 });
/** @param {readonly string[]} values */
export const enumOf = (values) => ({ kind: "enum", values: Object.freeze([...values]) });
/** @param {{ min?: number, max?: number }} [o] */
export const int = (o = {}) => ({
  kind: "integer",
  min: o.min ?? Number.MIN_SAFE_INTEGER,
  max: o.max ?? Number.MAX_SAFE_INTEGER,
});
export const bool = () => ({ kind: "boolean" });
/** @param {object} item @param {{ min?: number, max?: number }} [o] */
export const arr = (item, o = {}) => ({
  kind: "array",
  item,
  min: o.min ?? 0,
  max: o.max ?? 1_000,
});
/**
 * @param {Record<string, object>} fields every accepted field, by name
 * @param {{ optional?: readonly string[], unknown?: "reject" | "discard" }} [o]
 *   `unknown` defaults to `"reject"`. Only the external-GitHub schemas set
 *   `"discard"`, because GitHub adds response fields without notice and a
 *   readiness runner that fails on an unrelated addition is a runner nobody can
 *   use. Discarded keys are counted and never read.
 */
export const obj = (fields, o = {}) => ({
  kind: "object",
  fields,
  optional: new Set(o.optional ?? []),
  unknown: o.unknown ?? "reject",
});
/** A value that is permitted to be `null` as well as `inner`. */
export const nullable = (inner) => ({ kind: "nullable", inner });

/**
 * Validate a parsed value against a closed schema, at every depth.
 *
 * Returns the validated value, rebuilt from the schema rather than passed
 * through, so nothing the schema did not name can reach a consumer even by
 * aliasing.
 *
 * @param {unknown} value
 * @param {object} schema
 * @param {{ path?: string, discarded?: { count: number } }} [ctx]
 */
export const validate = (value, schema, ctx = {}) => {
  const path = ctx.path ?? "$";
  const discarded = ctx.discarded ?? { count: 0 };
  switch (schema.kind) {
    case "nullable":
      if (value === null) return null;
      return validate(value, schema.inner, { path, discarded });
    case "string": {
      if (typeof value !== "string") throw new StrictDataError("expected a string", path);
      if (value.length < schema.min || value.length > schema.max) {
        throw new StrictDataError(`string length ${value.length} is outside its bound`, path);
      }
      return value;
    }
    case "enum": {
      if (typeof value !== "string") throw new StrictDataError("expected a string", path);
      if (!schema.values.includes(value)) {
        throw new StrictDataError("value is outside its fixed enumeration", path);
      }
      return value;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new StrictDataError("expected a safe integer", path);
      }
      if (value < schema.min || value > schema.max) {
        throw new StrictDataError("integer is outside its bound", path);
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") throw new StrictDataError("expected a boolean", path);
      return value;
    }
    case "array": {
      if (!Array.isArray(value)) throw new StrictDataError("expected an array", path);
      if (value.length < schema.min || value.length > schema.max) {
        throw new StrictDataError(`array length ${value.length} is outside its bound`, path);
      }
      return value.map((entry, index) =>
        validate(entry, schema.item, { path: `${path}[${index}]`, discarded }),
      );
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new StrictDataError("expected an object", path);
      }
      /** @type {Record<string, unknown>} */
      const out = {};
      const present = Object.keys(value);
      for (const key of present) {
        if (Object.hasOwn(schema.fields, key)) continue;
        if (schema.unknown === "discard") {
          discarded.count += 1;
          continue;
        }
        throw new StrictDataError("unknown field", `${path}.${key}`);
      }
      for (const [key, fieldSchema] of Object.entries(schema.fields)) {
        const has = Object.hasOwn(value, key);
        if (!has) {
          if (schema.optional.has(key)) continue;
          throw new StrictDataError("required field is absent", `${path}.${key}`);
        }
        out[key] = validate(value[key], fieldSchema, { path: `${path}.${key}`, discarded });
      }
      return out;
    }
    default:
      throw new StrictDataError(`unsupported schema kind ${String(schema.kind)}`, path);
  }
};

/**
 * Validate and report how many unknown keys were discarded.
 *
 * Only the COUNT is returned. Key names are external text and are deliberately
 * not carried into evidence.
 *
 * @param {unknown} value
 * @param {object} schema
 */
export const validateCounting = (value, schema) => {
  const discarded = { count: 0 };
  const validated = validate(value, schema, { path: "$", discarded });
  return { value: validated, discarded_unknown_fields: discarded.count };
};

/**
 * Serialize a value that has already been validated against a closed schema,
 * and prove the serialized bytes re-read to the same shape under the same
 * schema. A document the runner cannot read back is not evidence.
 *
 * @param {unknown} value
 * @param {object} schema
 * @param {number} maxBytes
 */
export const serializeChecked = (value, schema, maxBytes) => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > maxBytes) {
    throw new StrictDataError(`serialized document is ${bytes.byteLength} bytes; the ceiling is ${maxBytes}`);
  }
  validate(readStrictJson(bytes, { maxBytes }), schema);
  return { text, bytes };
};
