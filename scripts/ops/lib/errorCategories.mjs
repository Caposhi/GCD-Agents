/**
 * The single sanitizer for database and driver failures.
 *
 * Extracted verbatim from `scripts/ops/evidence-aggregate-audit.mjs` and
 * `scripts/ops/migration-state-read.mjs`, which each carried their own copy, so
 * the migration-state read, the aggregate audit and the M1 readiness runner
 * cannot drift into three different disclosure boundaries.
 *
 * A raw driver message routinely embeds the database user and the host:port it
 * tried (`password authentication failed for user "..."`, `connect ECONNREFUSED
 * 127.0.0.1:1`), and operator logs or committed evidence would carry whatever is
 * printed. The SQLSTATE is not trusted either: a shape check on it is not a
 * sanitizer, because `RAISE ... USING ERRCODE = 'ZZZZZ'` lets the database choose
 * the five characters, so any well-formed value would pass straight through.
 *
 * This list is the sanitizer. An identifier that is not a key here yields
 * `UNKNOWN`, and the value emitted is always one of the fixed strings below —
 * chosen in this file, never by the server.
 */

/** @type {ReadonlyMap<string, string>} */
export const KNOWN_ERROR_CATEGORIES = new Map([
  // PostgreSQL SQLSTATEs (class 08 connection, 28 authorization, others as met).
  ["08000", "connection_exception"],
  ["08001", "connection_not_established"],
  ["08003", "connection_does_not_exist"],
  ["08004", "connection_rejected"],
  ["08006", "connection_failure"],
  ["08007", "transaction_resolution_unknown"],
  ["28000", "invalid_authorization"],
  ["28P01", "invalid_password"],
  ["3D000", "database_does_not_exist"],
  ["25006", "read_only_transaction"],
  ["42501", "insufficient_privilege"],
  ["42P01", "undefined_table"],
  ["53300", "too_many_connections"],
  ["55P03", "lock_not_available"],
  ["57014", "query_canceled"],
  ["57P01", "admin_shutdown"],
  ["57P03", "cannot_connect_now"],
  // Node/system and TLS error codes.
  ["ECONNREFUSED", "connection_refused"],
  ["ECONNRESET", "connection_reset"],
  ["ETIMEDOUT", "connection_timeout"],
  ["ENOTFOUND", "host_not_found"],
  ["EHOSTUNREACH", "host_unreachable"],
  ["ENETUNREACH", "network_unreachable"],
  ["EPIPE", "broken_pipe"],
  ["EAI_AGAIN", "dns_temporary_failure"],
  ["CERT_HAS_EXPIRED", "tls_certificate_expired"],
  ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls_self_signed_certificate"],
  ["SELF_SIGNED_CERT_IN_CHAIN", "tls_self_signed_certificate"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_unverified_certificate"],
]);

/**
 * Categories this repository's own code raises, so a deadline or an operator
 * interruption is distinguishable from a server-side failure without ever
 * echoing a message. These are chosen here, never read off the wire.
 */
export const LOCAL_ERROR_CATEGORIES = Object.freeze({
  DEADLINE_EXCEEDED: "deadline_exceeded",
  INTERRUPTED: "interrupted",
  UNKNOWN: "UNKNOWN",
});

/** The complete set of category strings this module will ever emit. */
export const ALL_ERROR_CATEGORIES = Object.freeze([
  ...new Set([...KNOWN_ERROR_CATEGORIES.values(), ...Object.values(LOCAL_ERROR_CATEGORIES)]),
]);

/**
 * Map an arbitrary thrown value to one fixed category string.
 *
 * Nothing from the error's message, stack, `detail`, `hint`, `where`, `schema`,
 * `table`, `column` or `constraint` is read: PostgreSQL populates several of
 * those with identifiers chosen by whoever wrote the failing object.
 *
 * @param {unknown} error
 * @returns {string} one member of {@link ALL_ERROR_CATEGORIES}
 */
export const categorizeError = (error) => {
  const local = /** @type {{ gcdCategory?: unknown }} */ (error)?.gcdCategory;
  if (typeof local === "string" && Object.values(LOCAL_ERROR_CATEGORIES).includes(local)) {
    return local;
  }
  const raw = /** @type {{ code?: unknown }} */ (error)?.code;
  if (typeof raw !== "string") return LOCAL_ERROR_CATEGORIES.UNKNOWN;
  return KNOWN_ERROR_CATEGORIES.get(raw) ?? LOCAL_ERROR_CATEGORIES.UNKNOWN;
};

/**
 * A failure report that cannot leak connection identity.
 *
 * @param {string} label short operation name chosen by the caller, in source
 * @param {unknown} error
 * @returns {string}
 */
export const sanitizedFailure = (label, error) =>
  `${label} failed. error_category=${categorizeError(error)}\n` +
  "The driver's own message and code are deliberately withheld: both can be chosen " +
  "by the database, and the message can contain the database user, host or port. " +
  "Check the connection settings in your own shell; they are not echoed here.";

/**
 * An error carrying a category chosen in this repository rather than by a server.
 *
 * @param {string} category one of {@link LOCAL_ERROR_CATEGORIES}
 * @param {string} detail a message written in source; never interpolated with
 *   external text
 */
export class CategorizedError extends Error {
  /**
   * @param {string} category
   * @param {string} detail
   */
  constructor(category, detail) {
    super(detail);
    this.name = "CategorizedError";
    this.gcdCategory = category;
  }
}
