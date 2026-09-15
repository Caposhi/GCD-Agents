#!/usr/bin/env node
/**
 * §4.1 prerequisite — fresh, read-only, AGGREGATE-ONLY production evidence audit.
 *
 * REQUIRES OPERATOR ACTION. Run by an authorized operator, never from an agent
 * session. No agent session in this repository has been given, or may request,
 * a production database credential.
 *
 * This file is a THIN CLI WRAPPER. The fixed query set, the bounds reader and
 * the 23-check evaluation live in `scripts/ops/lib/aggregateAudit.mjs`, and the
 * failure sanitizer in `scripts/ops/lib/errorCategories.mjs`, so this tool and
 * `scripts/ops/m1-readiness/` cannot drift into two different answers.
 *
 * Usage (operator machine, read-only role strongly preferred):
 *
 *   export GCD_AUDIT_DATABASE_URL='postgres://READONLY_USER@host:5432/dbname'
 *   node scripts/ops/evidence-aggregate-audit.mjs
 *
 * The variable is deliberately NOT `DATABASE_URL`, so this cannot be run by
 * accident against whatever happens to be exported in a deploy shell.
 *
 * Safety properties, all enforced below rather than merely documented:
 *   - every statement runs inside `BEGIN TRANSACTION READ ONLY`;
 *   - `default_transaction_read_only` is set for the session;
 *   - the query set is fixed; nothing is interpolated from argv or env;
 *   - it returns COUNTS, EXISTENCE and MAXIMA only. It never selects claim
 *     text, subject text, any other row content, PII, or credential values;
 *   - it prints no connection string, user, host, or password — including on
 *     the failure path, where the driver's message AND its code are withheld
 *     and only a fixed category chosen in the shared module is emitted. The
 *     message routinely names the user and the host:port, and the SQLSTATE is
 *     chosen by the server, so neither is repeated.
 *
 * What it answers is exactly one question, per §4.1: *can the immediately
 * validated constraints of migration 007 pass against the data actually
 * stored?* Bounds are NOT chosen here — they are read from the single
 * authority, `src/harness/agents/payloadContract.ts` → `EVIDENCE_LIMITS`, so
 * this cannot drift from the contract it is checking.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { sanitizedFailure } from "./lib/errorCategories.mjs";
import {
  EVIDENCE_AGGREGATES_SQL,
  RELATION_AGGREGATES_SQL,
  REQUIRED_TABLES,
  TABLE_EXISTENCE_SQL,
  TAG_AGGREGATES_SQL,
  assertDistinctColumns,
  evaluateAggregateAudit,
  readEvidenceLimits,
} from "./lib/aggregateAudit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

const main = async () => {
  const url = process.env.GCD_AUDIT_DATABASE_URL;
  if (!url) {
    console.error(
      "GCD_AUDIT_DATABASE_URL is not set.\n" +
        "Set it, in the operator's own shell, to a READ-ONLY production connection string.\n" +
        "Never paste a production credential into chat, into a pull request, or into source control.",
    );
    process.exit(2);
  }

  const limits = readEvidenceLimits(REPO_ROOT);
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 15_000 });
  const client = await pool.connect();
  const out = { audited_at: new Date().toISOString(), read_only: true };
  try {
    // Belt and braces: session-level read-only, then an explicitly read-only
    // transaction. Any accidental write raises rather than proceeding.
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN TRANSACTION READ ONLY");

    const tables = (await client.query(TABLE_EXISTENCE_SQL)).rows.map((r) => r.table_name);
    out.tables_present = tables;
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length) {
      out.error = `expected tables absent: ${missing.join(", ")}`;
      await client.query("ROLLBACK");
      console.log(JSON.stringify(out, null, 2));
      process.exit(1);
    }

    // `pg` collapses two columns of the same name into one row property, so a
    // duplicate is only visible in the result's field list.
    const read = async (sql, label) => {
      const result = await client.query(sql);
      assertDistinctColumns(result.fields, label);
      return result.rows[0];
    };
    out.content_evidence = await read(EVIDENCE_AGGREGATES_SQL, "content_evidence aggregates");
    out.content_evidence_tags = await read(TAG_AGGREGATES_SQL, "content_evidence tag aggregates");
    out.content_evidence_relations = await read(
      RELATION_AGGREGATES_SQL,
      "content_evidence_relations aggregates",
    );

    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }

  // --- measured maximum vs bound, each stated individually ------------------
  const evaluated = evaluateAggregateAudit({
    evidence: out.content_evidence,
    tags: out.content_evidence_tags,
    relations: out.content_evidence_relations,
    limits,
  });

  out.bounds_source = evaluated.bounds_source;
  out.checks = evaluated.checks;
  out.check_count = evaluated.check_count;
  out.verdict = evaluated.verdict;
  out.failing_checks = evaluated.failing_checks;
  out.note =
    "Aggregate-only. No claim text, subject text, other row content, PII, or credential " +
    "value was selected or printed. This answers only whether 007's immediately validated " +
    "constraints can pass against stored data; it authorizes nothing by itself.";

  console.log(JSON.stringify(out, null, 2));
  process.exit(evaluated.failing_checks.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(sanitizedFailure("audit", error));
  process.exit(1);
});
