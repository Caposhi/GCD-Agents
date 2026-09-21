/**
 * Builders for the JSON Schemas sent as `output_config.format`.
 *
 * Imports nothing. Each stage builds its own schema beside its own validator,
 * from the same `ALLOWED_OUTPUT_FIELDS` array that `requireExactKeys` reads, so
 * a schema cannot name a field the validator would reject or miss one it
 * requires. A central schema module would have to import all six stage modules
 * — which import `stageExecution.ts`, which needs the schemas — so the kit
 * holds the shapes and the stages hold the content.
 *
 * **What structured outputs enforce, and what they do not.** Anthropic's
 * structured outputs support `type`, `properties`, `required`,
 * `additionalProperties: false`, `enum`, `const`, `anyOf`/`allOf`, internal
 * `$ref` and string formats. They do **not** support `maxLength`, `minLength`,
 * `maxItems` (beyond `minItems` 0 or 1), `minimum`, `maximum` or `pattern`.
 *
 * So a schema built here makes a non-JSON or wrong-shaped response impossible,
 * and does nothing whatever about size. Every character and cardinality ceiling
 * stays exactly where it was: stated in the prompt, enforced by the validator
 * after the response arrives. `note()` writes a ceiling into the field's
 * `description` so the model is told a third time, but a description is
 * guidance and never a constraint — do not read one as enforcement.
 */

/** A bounded string field. `maxChars` is documented in prose, never enforced. */
export function schemaString(description: string, maxChars?: number): Record<string, unknown> {
  return { type: "string", description: note(description, maxChars, "characters") };
}

/** A fixed set of permitted string values — genuinely enforced by the provider. */
export function schemaEnum(
  values: readonly string[], description: string,
): Record<string, unknown> {
  return { type: "string", enum: [...values], description };
}

export function schemaInteger(description: string): Record<string, unknown> {
  return { type: "integer", description };
}

/** An array field. `maxEntries` is documented in prose, never enforced. */
export function schemaArray(
  items: Record<string, unknown>, description: string, maxEntries?: number,
): Record<string, unknown> {
  return { type: "array", items, description: note(description, maxEntries, "entries") };
}

/**
 * An object whose permitted keys are exactly `fields`.
 *
 * `required` is every key and `additionalProperties` is false, which is what
 * makes the schema mirror `requireExactKeys`: the validator refuses an extra or
 * missing key, and so now does generation.
 */
export function schemaObject(
  fields: Readonly<Record<string, Record<string, unknown>>>,
  description?: string,
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...fields },
    required: Object.keys(fields),
    additionalProperties: false,
    ...(description ? { description } : {}),
  };
}

/** `1200` -> `"1,200"`, matching how the prompts write their ceilings. */
export function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function note(description: string, max: number | undefined, unit: string): string {
  return max === undefined ? description : `${description}; at most ${groupDigits(max)} ${unit}`;
}
