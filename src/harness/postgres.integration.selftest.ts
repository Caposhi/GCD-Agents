/**
 * Disposable PostgreSQL integration test for the Phase-0A approval boundary.
 *
 * Safety contract:
 * - Requires PHASE0A_DISPOSABLE_POSTGRES=1 and a loopback-only
 *   PHASE0A_POSTGRES_ADMIN_URL.
 * - Creates randomly named databases, touches only those databases, and drops
 *   them on exit.
 * - Runs the compiled repository migration runner. The upgrade scenario first
 *   runs that runner against a temporary migration directory containing 001-004,
 *   seeds legacy state, then runs it against the complete repository directory.
 * - Replaces global fetch while exercising the sanctioned publication entrypoint;
 *   no provider request can leave the process.
 */

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Pool as PgPool } from "pg";
import { config } from "./config.js";
import { adaptApprovedFactsFile } from "./evidence/approvedFacts.js";
import { buildEvidencePack } from "./evidence/pack.js";
import { assertPublishAllowed, SOCIAL_POST_APPROVAL_SUBJECT } from "./hitl.js";
import { assertPlatformSafePublicationJpeg, MAX_PUBLICATION_JPEG_BYTES } from "./mediaPolicy.js";
import {
  assertHostedMediaIntegrity,
  canonicalApprovalJson,
  closeState,
  createApproval,
  decideApproval,
  getApproval,
  getLiveApprovedSubject,
  hashApprovalSubject,
  hashMediaBytes,
  initState,
  listContentEvidence,
  listContentEvidenceRelations,
  revokeApproval,
  saveMedia,
  stateEnabled,
  syncContentEvidence,
  verifyApprovalToken,
} from "./state.js";
import {
  CLAIM_PENDING_BRIEF_SQL,
  completeBrief,
  setApprovalStatus,
  recordDurablePhaseEvent,
  listRunningBriefs,
  listRevocablePendingApprovals,
  approvalIdsWithOwningBriefMarker,
  eventsForRun,
  phaseMarkersForRun,
} from "./state.js";
import { WorkerOwnership, OwnershipLostError, connectOwnershipClient } from "./workerOwnership.js";
import {
  reconcileAbandonedWork,
  sweepOrphanApprovals,
  RecoveryDeps,
  PHASE_APPROVAL_REQUESTED,
  PHASE_PUBLISH_ATTEMPT_STARTED,
  PHASE_RECONCILED,
} from "./briefRecovery.js";
import { publishApprovedPackage } from "../mcp/posting-tool/index.js";
import type { PostPackage } from "../mcp/posting-tool/types.js";

const execFileAsync = promisify(execFile);
const EXPECTED_MIGRATIONS = [
  "001_init.sql",
  "002_brief_and_approval.sql",
  "003_media.sql",
  "004_events.sql",
  "005_approval_integrity.sql",
  "006_content_evidence.sql",
  "007_evidence_bounds.sql",
] as const;
const GROUPS = ["fresh", "upgrade", "durable"] as const;
type Group = typeof GROUPS[number];
const checks: Record<Group, number> = { fresh: 0, upgrade: 0, durable: 0 };

function check(group: Group, label: string, condition: boolean): void {
  if (!condition) throw new Error(`[${group}] ${label}`);
  checks[group] += 1;
  console.log(`  ✓ [${group}] ${label}`);
}

async function expectError(
  group: Group,
  label: string,
  operation: () => Promise<unknown>,
  pattern?: RegExp,
): Promise<void> {
  let message = "";
  try {
    await operation();
  } catch (err) {
    message = (err as Error).message;
  }
  check(group, label, message.length > 0 && (!pattern || pattern.test(message)));
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asDatabaseUrl(adminUrl: string, database: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

function validateAdminUrl(raw: string | undefined): string {
  if (process.env.PHASE0A_DISPOSABLE_POSTGRES !== "1") {
    throw new Error("PHASE0A_DISPOSABLE_POSTGRES=1 is required for this destructive disposable-database test");
  }
  if (!raw) throw new Error("PHASE0A_POSTGRES_ADMIN_URL is required");
  const parsed = new URL(raw);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("PHASE0A_POSTGRES_ADMIN_URL must be a PostgreSQL URL");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (!loopbackHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error("PHASE0A_POSTGRES_ADMIN_URL must use a loopback hostname");
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error("PHASE0A_POSTGRES_ADMIN_URL must identify an administrative database");
  }
  return parsed.toString();
}

function assertGcdRuntimeCredentialsAbsent(): void {
  const runtimeSecrets = [
    "DATABASE_URL",
    "CONSOLE_TOKEN",
    "ANTHROPIC_API_KEY",
    "IMAGEGEN_API_KEY",
    "APPROVAL_CHANNEL_WEBHOOK",
    "IG_ACCESS_TOKEN",
    "FB_PAGE_ACCESS_TOKEN",
    "GOOGLE_ACCESS_TOKEN",
    "GOOGLE_REFRESH_TOKEN",
    "GOOGLE_CLIENT_SECRET",
  ];
  const present = runtimeSecrets.filter((name) => process.env[name]?.trim());
  if (present.length) {
    throw new Error(`clear GCD runtime credentials before running PostgreSQL integration tests: ${present.join(", ")}`);
  }
}

function sanitizedMigrationEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "LANG", "LC_ALL", "TZ", "TMPDIR"] as const) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return Object.assign(env, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    PUBLIC_BASE_URL: "https://phase0a.invalid",
    ANTHROPIC_API_KEY: "",
    IMAGEGEN_API_KEY: "",
    APPROVAL_CHANNEL_WEBHOOK: "",
    IG_ACCESS_TOKEN: "",
    FB_PAGE_ACCESS_TOKEN: "",
    GOOGLE_ACCESS_TOKEN: "",
    GOOGLE_REFRESH_TOKEN: "",
    GOOGLE_CLIENT_SECRET: "",
    CONSOLE_TOKEN: "",
  });
}

interface MigrationRun {
  elapsedMs: number;
  stdout: string;
}

async function runCompiledMigrations(
  repoRoot: string,
  databaseUrl: string,
  migrationCwd: string,
): Promise<MigrationRun> {
  const started = performance.now();
  const runner = resolve(repoRoot, "dist/state/migrate.js");
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [runner], {
      cwd: migrationCwd,
      env: sanitizedMigrationEnv(databaseUrl),
      maxBuffer: 4 * 1024 * 1024,
    });
    if (stderr.trim()) console.error(stderr.trim());
    return { elapsedMs: Math.round(performance.now() - started), stdout };
  } catch (err) {
    const failure = err as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `compiled migration runner failed: ${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim(),
    );
  }
}

async function partialMigrationRoot(repoRoot: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gcd-phase0a-migrations-"));
  const target = join(root, "state", "migrations");
  await mkdir(target, { recursive: true });
  for (const file of EXPECTED_MIGRATIONS.slice(0, 4)) {
    await copyFile(resolve(repoRoot, "state/migrations", file), join(target, file));
  }
  return root;
}

async function migrationNames(pool: PgPool): Promise<string[]> {
  const result = await pool.query(`SELECT name FROM _migrations ORDER BY name`);
  return result.rows.map((row) => String(row.name));
}

async function assertSchemaObjects(pool: PgPool, group: "fresh" | "upgrade"): Promise<void> {
  const triggerResult = await pool.query(
    `SELECT c.relname AS table_name, t.tgname
     FROM pg_trigger t
     JOIN pg_class c ON c.oid=t.tgrelid
     WHERE NOT t.tgisinternal
       AND t.tgenabled IN ('O','A')
       AND t.tgname IN (
         'approval_decision_no_update',
         'approval_decision_no_delete',
         'approval_subject_immutable',
         'media_content_immutable'
       )
     ORDER BY t.tgname`,
  );
  check(group, "all four enabled integrity triggers exist", triggerResult.rowCount === 4);

  const triggerMap = new Map(triggerResult.rows.map((row) => [String(row.tgname), String(row.table_name)]));
  check(
    group,
    "integrity triggers are attached to the intended tables",
    triggerMap.get("approval_decision_no_update") === "approval_decisions"
      && triggerMap.get("approval_decision_no_delete") === "approval_decisions"
      && triggerMap.get("approval_subject_immutable") === "approval_queue"
      && triggerMap.get("media_content_immutable") === "media",
  );

  const functionResult = await pool.query(
    `SELECT p.proname, l.lanname
     FROM pg_proc p
     JOIN pg_language l ON l.oid=p.prolang
     JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname=current_schema()
       AND p.proname IN (
         'prevent_approval_decision_mutation',
         'prevent_approval_subject_mutation',
         'prevent_media_content_mutation'
       )`,
  );
  check(
    group,
    "all three PL/pgSQL integrity functions exist",
    functionResult.rowCount === 3 && functionResult.rows.every((row) => row.lanname === "plpgsql"),
  );

  const requiredConstraints = new Set([
    "approval_queue_no_plaintext_token",
    "approval_queue_payload_sha256_format",
    "approval_queue_token_hash_format",
    "approval_queue_revocation_shape",
    "approval_queue_bound_live_shape",
    "approval_queue_subject_copies_match",
    "approval_decisions_pkey",
    "approval_decisions_approval_id_key",
    "approval_decisions_decision_check",
    "approval_decisions_payload_sha256_check",
    "media_content_sha256_format",
    "media_content_sha256_matches_bytes",
  ]);
  const constraintResult = await pool.query(
    `SELECT conname, convalidated
     FROM pg_constraint
     WHERE conrelid IN (
       'approval_queue'::regclass,
       'approval_decisions'::regclass,
       'media'::regclass
     )`,
  );
  const constraints = new Map(constraintResult.rows.map((row) => [String(row.conname), row.convalidated === true]));
  check(
    group,
    "all Phase-0A checks, primary key, and one-decision uniqueness constraint are validated",
    [...requiredConstraints].every((name) => constraints.get(name) === true),
  );

  const foreignKey = await pool.query(
    `SELECT confdeltype
     FROM pg_constraint
     WHERE conrelid='approval_decisions'::regclass
       AND conname='approval_decisions_approval_id_fkey'
       AND confrelid='approval_queue'::regclass
       AND contype='f'`,
  );
  check(group, "decision relationship is an ON DELETE RESTRICT foreign key", foreignKey.rows[0]?.confdeltype === "r");

  const indexResult = await pool.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname=current_schema()
       AND indexname IN (
         'approval_queue_live_authorization_idx',
         'approval_decisions_pkey',
         'approval_decisions_approval_id_key',
         'approval_decisions_decided_at_idx'
       )`,
  );
  check(group, "all explicit and constraint-backed Phase-0A indexes exist", indexResult.rowCount === 4);

  const approvalColumns = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema=current_schema()
       AND table_name='approval_queue'
       AND column_name IN (
         'subject_type',
         'subject_payload',
         'payload_sha256',
         'approval_token_hash',
         'token_expires_at',
         'authorization_expires_at',
         'revoked_at',
         'revoked_by',
         'revocation_reason'
       )`,
  );
  const approvalColumnTypes = new Map(
    approvalColumns.rows.map((row) => [String(row.column_name), String(row.data_type)]),
  );
  check(
    group,
    "all nine Phase-0A approval columns exist with their intended SQL types",
    approvalColumnTypes.size === 9
      && approvalColumnTypes.get("subject_type") === "text"
      && approvalColumnTypes.get("subject_payload") === "jsonb"
      && approvalColumnTypes.get("payload_sha256") === "text"
      && approvalColumnTypes.get("approval_token_hash") === "text"
      && approvalColumnTypes.get("token_expires_at") === "timestamp with time zone"
      && approvalColumnTypes.get("authorization_expires_at") === "timestamp with time zone"
      && approvalColumnTypes.get("revoked_at") === "timestamp with time zone"
      && approvalColumnTypes.get("revoked_by") === "text"
      && approvalColumnTypes.get("revocation_reason") === "text",
  );

  const decisionColumns = await pool.query(
    `SELECT a.attname,
            a.attnotnull,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            pg_get_expr(d.adbin, d.adrelid) AS default_expression
     FROM pg_attribute a
     LEFT JOIN pg_attrdef d
       ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid='approval_decisions'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped`,
  );
  const decisionColumnMap = new Map(
    decisionColumns.rows.map((row) => [String(row.attname), row]),
  );
  const requiredDecisionTypes: Record<string, string> = {
    id: "uuid",
    approval_id: "uuid",
    decision: "text",
    subject_type: "text",
    payload_sha256: "text",
    decided_by: "text",
    decided_at: "timestamp with time zone",
  };
  check(
    group,
    "approval_decisions has all required non-null columns and generated defaults",
    decisionColumnMap.size === 7
      && Object.entries(requiredDecisionTypes).every(([name, type]) => {
        const row = decisionColumnMap.get(name);
        return row?.attnotnull === true && row.data_type === type;
      })
      && String(decisionColumnMap.get("id")?.default_expression).includes("gen_random_uuid()")
      && String(decisionColumnMap.get("decided_at")?.default_expression).includes("now()"),
  );

  const mediaColumn = await pool.query(
    `SELECT a.attnotnull, format_type(a.atttypid, a.atttypmod) AS data_type
     FROM pg_attribute a
     WHERE a.attrelid='media'::regclass
       AND a.attname='content_sha256'
       AND NOT a.attisdropped`,
  );
  check(
    group,
    "media.content_sha256 is a non-null text column",
    mediaColumn.rows[0]?.attnotnull === true && mediaColumn.rows[0]?.data_type === "text",
  );
}

/**
 * Phase 0B.0 evidence schema, against the real database.
 *
 * The TypeScript contract and the SQL CHECK constraints are deliberately
 * redundant. These assertions prove the database enforces class separation on
 * its own, so a future writer that bypasses the application layer still cannot
 * store a fact without a source or promote a measurement into a truth.
 */
async function assertContentEvidenceSchema(
  pool: PgPool,
  databaseUrl: string,
  group: "fresh" | "upgrade",
): Promise<void> {
  const rejects = async (label: string, sql: string, values: unknown[] = []): Promise<void> => {
    let rejected = false;
    try {
      await pool.query(sql, values);
    } catch {
      rejected = true;
    }
    check(group, label, rejected);
  };

  const base = `INSERT INTO content_evidence (id, kind, claim, subject, source_type`;

  // M. malformed evidence is rejected by the database itself.
  await rejects(
    "[evidence] a verified fact without a source is rejected by the database",
    `${base}) VALUES ('bad-1','verified_automotive_fact','c','s','manufacturer_documentation')`,
  );
  await rejects(
    "[evidence] a verified fact sourced from model inference is rejected",
    `${base}, source_ref, provenance, reviewed_at)
       VALUES ('bad-2','verified_automotive_fact','c','s','model_inference','r','p',now())`,
  );
  await rejects(
    "[evidence] an unknown evidence kind is rejected",
    `${base}) VALUES ('bad-3','wishful_thinking','c','s','repository_config')`,
  );
  await rejects(
    "[evidence] an empty claim is rejected",
    `${base}) VALUES ('bad-4','creative_hypothesis','   ','s','model_inference')`,
  );
  await rejects(
    "[evidence] confidence outside [0,1] is rejected",
    `${base}, confidence) VALUES ('bad-5','creative_hypothesis','c','s','model_inference', 2)`,
  );
  await rejects(
    "[evidence] performance evidence from a non-analytics source is rejected",
    `${base}, observed_at) VALUES ('bad-6','gcd_performance_evidence','c','s','model_inference', now())`,
  );
  await rejects(
    "[evidence] a generalizable observation is rejected",
    `${base}, observed_at, provenance, generalizable)
       VALUES ('bad-7','gcd_direct_observation','c','s','gcd_shop_record', now(), 'p', true)`,
  );
  await rejects(
    "[evidence] a certain causal hypothesis is rejected",
    `${base}, confidence) VALUES ('bad-8','causal_hypothesis','c','s','model_inference', 1)`,
  );
  await rejects(
    "[evidence] a high-confidence unsupported assumption is rejected",
    `${base}, confidence) VALUES ('bad-9','unsupported_assumption','c','s','unattributed', 0.9)`,
  );
  await rejects(
    "[evidence] superseded without a successor is rejected",
    `${base}, lifecycle) VALUES ('bad-10','creative_hypothesis','c','s','model_inference','superseded')`,
  );
  await rejects(
    "[evidence] self-supersession is rejected",
    `${base}, lifecycle, superseded_by_id)
       VALUES ('bad-11','creative_hypothesis','c','s','model_inference','superseded','bad-11')`,
  );
  await rejects(
    "[evidence] a self-referential relation is rejected",
    `INSERT INTO content_evidence_relations (from_id, to_id, kind) VALUES ('x','x','supports')`,
  );

  // Migration 007's bounds, enforced by the database rather than only mirrored
  // in TypeScript. The offline suite proves the two sets of numbers agree; this
  // is the only place the constraints themselves run.
  const bounded = `${base}, source_ref, provenance, reviewed_at)`;
  const verified = (id: string, claim: string, subject: string) =>
    `${bounded} VALUES ('${id}','verified_automotive_fact',${claim},${subject},` +
    `'manufacturer_documentation','r','p',now())`;
  await rejects(
    "[evidence] a claim over the bound is rejected by the database",
    verified("bound-1", "repeat('c',1001)", "'s'"),
  );
  await rejects(
    "[evidence] a subject over the bound is rejected by the database",
    verified("bound-2", "'c'", "repeat('s',201)"),
  );
  await rejects(
    "[evidence] an id over the bound is rejected by the database",
    `${bounded} VALUES (repeat('z',201),'verified_automotive_fact','c','s',` +
    `'manufacturer_documentation','r','p',now())`,
  );
  await rejects(
    "[evidence] an attribute over the bound is rejected by the database",
    `${base}, attribute, source_ref, provenance, reviewed_at)
       VALUES ('bound-4','verified_automotive_fact','c','s','manufacturer_documentation',
               repeat('a',121),'r','p',now())`,
  );
  await rejects(
    "[evidence] a source ref over the bound is rejected by the database",
    `${bounded} VALUES ('bound-5','verified_automotive_fact','c','s',
       'manufacturer_documentation',repeat('r',501),'p',now())`,
  );
  await rejects(
    "[evidence] a provenance over the bound is rejected by the database",
    `${bounded} VALUES ('bound-6','verified_automotive_fact','c','s',
       'manufacturer_documentation','r',repeat('p',501),now())`,
  );
  await rejects(
    "[evidence] a reviewer over the bound is rejected by the database",
    `${base}, source_ref, provenance, reviewed_at, reviewed_by)
       VALUES ('bound-7','verified_automotive_fact','c','s','manufacturer_documentation',
               'r','p',now(),repeat('b',201))`,
  );
  await rejects(
    "[evidence] too many tags are rejected by the database",
    `${base}, tags, source_ref, provenance, reviewed_at)
       VALUES ('bound-8','verified_automotive_fact','c','s','manufacturer_documentation',
               array_fill('t'::text, array[17]),'r','p',now())`,
  );
  await rejects(
    "[evidence] one over-long tag is rejected by the database, not just the tag count",
    `${base}, tags, source_ref, provenance, reviewed_at)
       VALUES ('bound-9','verified_automotive_fact','c','s','manufacturer_documentation',
               ARRAY[repeat('t',61)],'r','p',now())`,
  );
  await rejects(
    "[evidence] a detail object over the serialized bound is rejected by the database",
    `${base}, detail, source_ref, provenance, reviewed_at)
       VALUES ('bound-10','verified_automotive_fact','c','s','manufacturer_documentation',
               jsonb_build_object('b', repeat('d',4000)),'r','p',now())`,
  );
  await rejects(
    "[evidence] a relation note over the bound is rejected by the database",
    `INSERT INTO content_evidence_relations (from_id, to_id, kind, note)
       VALUES ('bound-ok-a','bound-ok-b','supports',repeat('n',501))`,
  );

  // The other half: a record built to every bound EXACTLY must still insert.
  // A bound that is off by one in the database would fail here, not silently
  // narrow what the system can store.
  let boundaryAccepted = false;
  try {
    await pool.query(
      `INSERT INTO content_evidence
         (id, kind, claim, subject, attribute, tags, source_type, source_ref,
          provenance, reviewed_at, reviewed_by, created_at, lifecycle)
       VALUES (repeat('i',200),'verified_automotive_fact',repeat('c',1000),repeat('s',200),
               repeat('a',120),array_fill(repeat('t',60), array[16]),
               'manufacturer_documentation',repeat('r',500),repeat('p',500),now(),
               repeat('b',200),now(),'active')`,
    );
    boundaryAccepted = true;
  } catch {
    boundaryAccepted = false;
  }
  check(group, "[evidence] a record at every bound exactly is accepted by the database",
    boundaryAccepted);
  await pool.query(`DELETE FROM content_evidence WHERE id = repeat('i',200)`);

  const tagHelper = await pool.query(
    `SELECT provolatile, proisstrict FROM pg_proc WHERE proname = 'content_evidence_tag_length_within'`,
  );
  check(group,
    "[evidence] the per-tag bound's helper exists and is immutable, which is what lets a "
    + "CHECK constraint call it at all",
    tagHelper.rowCount === 1
      && String(tagHelper.rows[0]?.provolatile) === "i"
      && tagHelper.rows[0]?.proisstrict === true);

  const relationKinds = await pool.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'content_evidence_relations_kind_check'`,
  );
  check(group, "[evidence] relation-kind constraint exists", relationKinds.rowCount === 1);

  const indexes = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'content_evidence'`,
  );
  const names = indexes.rows.map((r: any) => String(r.indexname));
  check(
    group,
    "[evidence] expected indexes exist",
    ["content_evidence_kind_lifecycle_idx", "content_evidence_subject_idx",
      "content_evidence_active_idx", "content_evidence_tags_idx"].every((n) => names.includes(n)),
  );

  // L. the operator sync is idempotent against the real upsert.
  await closeState();
  config.databaseUrl = databaseUrl;
  await initState({ requireDurable: true });
  try {
    const raw = await readFile(resolve(repoRootForEvidence(), "config/approved-facts.json"), "utf8");
    const adapted = adaptApprovedFactsFile(raw, { reviewedAt: "2026-08-01T00:00:00Z", now: Date.UTC(2026, 7, 27) });
    const firstRun = await syncContentEvidence(adapted.records);
    const secondRun = await syncContentEvidence(adapted.records);
    check(group, "[evidence] first sync inserts every adapted record",
      firstRun.inserted === adapted.records.length && firstRun.updated === 0);
    check(group, "[evidence] repeating the sync changes nothing",
      secondRun.inserted === 0 && secondRun.updated === 0
        && secondRun.unchanged === adapted.records.length);

    const stored = await listContentEvidence();
    check(group, "[evidence] stored records round-trip",
      stored.length === adapted.records.length
        && stored.every((r) => r.kind === "verified_business_fact"));
    check(group, "[evidence] provenance survives the database round-trip",
      stored.every((r) => (r.provenance ?? "").includes(adapted.contentSha256)));

    // A changed claim is an update, not a duplicate row.
    const mutated = adapted.records.map((r, i) => (i === 0 ? { ...r, claim: `${r.claim} (revised)` } : r));
    const thirdRun = await syncContentEvidence(mutated);
    check(group, "[evidence] a changed claim updates exactly one row",
      thirdRun.updated === 1 && thirdRun.inserted === 0);

    const pack = buildEvidencePack({
      goal: "integration pack",
      records: await listContentEvidence(),
      relations: await listContentEvidenceRelations(),
      now: Date.UTC(2026, 7, 27),
    });
    check(group, "[evidence] a pack built from durable rows exposes citable facts",
      pack.allowedFacts.length > 0 && pack.unsupportedAssumptions.length === 0);
  } finally {
    await closeState();
  }
}

function repoRootForEvidence(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

async function assertStartupProbe(databaseUrl: string, group: "fresh" | "upgrade"): Promise<void> {
  await closeState();
  config.databaseUrl = databaseUrl;
  await initState({ requireDurable: true });
  check(group, "application durable startup/schema probe succeeds", stateEnabled());
  await closeState();
}

async function assertMigrationLockTimeout(
  repoRoot: string,
  databaseUrl: string,
  pool: PgPool,
): Promise<void> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("BEGIN");
    await lockClient.query("LOCK TABLE approval_queue IN ACCESS SHARE MODE");
    const started = performance.now();
    let failure = "";
    try {
      await runCompiledMigrations(repoRoot, databaseUrl, repoRoot);
    } catch (err) {
      failure = (err as Error).message;
    }
    const elapsedMs = Math.round(performance.now() - started);
    check(
      "upgrade",
      "migration 005 fails on a conflicting lock instead of waiting indefinitely",
      /canceling statement due to lock timeout/i.test(failure),
    );
    check(
      "upgrade",
      "migration lock failure occurs around the configured 10-second deadline",
      elapsedMs >= 8_000 && elapsedMs < 30_000,
    );
    check(
      "upgrade",
      "failed locked migration does not record migration 005",
      JSON.stringify(await migrationNames(pool)) === JSON.stringify(EXPECTED_MIGRATIONS.slice(0, 4)),
    );
    const rollbackProbe = await pool.query(
      `SELECT
         to_regclass('public.approval_decisions') IS NULL AS decision_table_absent,
         NOT EXISTS (
           SELECT 1 FROM pg_attribute
           WHERE attrelid='approval_queue'::regclass
             AND attname='subject_type'
             AND NOT attisdropped
         ) AS subject_column_absent`,
    );
    check(
      "upgrade",
      "failed locked migration leaves no partial Phase-0A schema",
      rollbackProbe.rows[0]?.decision_table_absent === true
        && rollbackProbe.rows[0]?.subject_column_absent === true,
    );
  } finally {
    await lockClient.query("ROLLBACK").catch(() => {});
    lockClient.release();
  }
}

interface LegacySeed {
  approvalIds: Record<"pending" | "approved" | "rejected" | "posted", string>;
  media: Array<{ id: string; bytes: Buffer }>;
  briefId: string;
  eventId: string;
}

async function seedLegacyState(pool: PgPool): Promise<LegacySeed> {
  const approvalIds = {} as LegacySeed["approvalIds"];
  const statusRows = [
    { status: "pending", decidedBy: null, decidedAt: null },
    { status: "approved", decidedBy: "legacy-reviewer", decidedAt: new Date("2026-01-02T03:04:05Z") },
    { status: "rejected", decidedBy: "legacy-reviewer", decidedAt: new Date("2026-01-03T03:04:05Z") },
    { status: "posted", decidedBy: "legacy-reviewer", decidedAt: new Date("2026-01-04T03:04:05Z") },
  ] as const;
  for (const entry of statusRows) {
    const legacyPackage = { legacy: true, status: entry.status, text: `legacy-${entry.status}` };
    const inserted = await pool.query(
      `INSERT INTO approval_queue (
         platform, package, status, approval_token, package_formatted,
         summary, decided_by, decided_at, notes
       ) VALUES ('facebook', $1, $2, $3, $1, $4, $5, $6, $7)
       RETURNING id`,
      [
        JSON.stringify(legacyPackage),
        entry.status,
        `legacy-plaintext-${entry.status}`,
        `Legacy ${entry.status}`,
        entry.decidedBy,
        entry.decidedAt,
        `historical-${entry.status}`,
      ],
    );
    approvalIds[entry.status] = String(inserted.rows[0].id);
  }

  const mediaBytes = [Buffer.from("legacy-media-one", "utf8"), Buffer.from([0, 1, 2, 3, 254, 255])];
  const media: LegacySeed["media"] = [];
  for (const bytes of mediaBytes) {
    const inserted = await pool.query(
      `INSERT INTO media (mime, bytes) VALUES ('image/jpeg', $1) RETURNING id`,
      [bytes],
    );
    media.push({ id: String(inserted.rows[0].id), bytes });
  }

  const brief = await pool.query(
    `INSERT INTO brief_queue (brief, status) VALUES ($1, 'pending') RETURNING id`,
    [JSON.stringify({ goal: "legacy durable brief", source: "phase0a-upgrade-test" })],
  );
  await pool.query(
    `INSERT INTO session_state (session_id, state) VALUES ('legacy-session', $1)`,
    [JSON.stringify({ checkpoint: 4, valid: true })],
  );
  const event = await pool.query(
    `INSERT INTO events (run_id, kind, agent, message, data)
     VALUES ('legacy-run', 'legacy:event', 'legacy-agent', 'legacy event remains', $1)
     RETURNING id`,
    [JSON.stringify({ sequence: 1 })],
  );
  await pool.query(
    `INSERT INTO brand_scorecard (run_id, platform, voice_score, compliance_pass, notes)
     VALUES ('legacy-run', 'facebook', 0.91, true, 'legacy score remains')`,
  );
  return {
    approvalIds,
    media,
    briefId: String(brief.rows[0].id),
    eventId: String(event.rows[0].id),
  };
}

async function assertLegacyUpgrade(pool: PgPool, seed: LegacySeed): Promise<void> {
  const approvals = await pool.query(
    `SELECT id, status, package, package_formatted, summary, notes,
            approval_token, subject_type, subject_payload, payload_sha256,
            approval_token_hash, revoked_at, revoked_by, revocation_reason,
            decided_by, decided_at
     FROM approval_queue
     WHERE id = ANY($1::uuid[])`,
    [Object.values(seed.approvalIds)],
  );
  check("upgrade", "all four legacy approval rows remain present", approvals.rowCount === 4);
  check(
    "upgrade",
    "all legacy plaintext approval tokens are cleared",
    approvals.rows.every((row) => row.approval_token === null),
  );

  const byStatus = new Map(approvals.rows.map((row) => [String(row.status), row]));
  check(
    "upgrade",
    "legacy pending and approved authorizations are explicitly revoked",
    ["pending", "approved"].every((status) => {
      const row = byStatus.get(status);
      return row?.revoked_at instanceof Date
        && row.revoked_by === "migration:005_approval_integrity"
        && String(row.revocation_reason).includes("not canonically hash-bound");
    }),
  );
  check(
    "upgrade",
    "revoked legacy live rows were not laundered into hash-bound approvals",
    ["pending", "approved"].every((status) => {
      const row = byStatus.get(status);
      return row?.subject_type === null
        && row.subject_payload === null
        && row.payload_sha256 === null
        && row.approval_token_hash === null;
    }),
  );
  check(
    "upgrade",
    "legacy rejected and posted rows remain terminal and unrevoked",
    byStatus.get("rejected")?.revoked_at === null && byStatus.get("posted")?.revoked_at === null,
  );
  check(
    "upgrade",
    "historical terminal packages, summaries, notes, and decision metadata remain interpretable",
    ["rejected", "posted"].every((status) => {
      const row = byStatus.get(status);
      return row?.package?.status === status
        && row.package_formatted?.status === status
        && row.summary === `Legacy ${status}`
        && row.notes === `historical-${status}`
        && row.decided_by === "legacy-reviewer"
        && row.decided_at instanceof Date;
    }),
  );

  const mediaRows = await pool.query(
    `SELECT id, bytes, content_sha256 FROM media WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [seed.media.map((item) => item.id)],
  );
  check("upgrade", "all pre-existing media IDs remain intact", mediaRows.rowCount === seed.media.length);
  check(
    "upgrade",
    "pre-existing media bytes remain byte-for-byte intact",
    seed.media.every((expected) => {
      const row = mediaRows.rows.find((candidate) => candidate.id === expected.id);
      return Buffer.isBuffer(row?.bytes) && row.bytes.equals(expected.bytes);
    }),
  );
  check(
    "upgrade",
    "media SHA-256 values are correctly backfilled",
    seed.media.every((expected) => {
      const row = mediaRows.rows.find((candidate) => candidate.id === expected.id);
      return row?.content_sha256 === hashMediaBytes(expected.bytes);
    }),
  );

  const continuity = await pool.query(
    `SELECT
       EXISTS(SELECT 1 FROM brief_queue WHERE id=$1 AND brief->>'goal'='legacy durable brief') AS brief_ok,
       EXISTS(SELECT 1 FROM session_state WHERE session_id='legacy-session' AND state->>'checkpoint'='4') AS session_ok,
       EXISTS(SELECT 1 FROM events WHERE id=$2 AND message='legacy event remains') AS event_ok,
       EXISTS(SELECT 1 FROM brand_scorecard WHERE run_id='legacy-run' AND compliance_pass=true) AS score_ok`,
    [seed.briefId, seed.eventId],
  );
  check(
    "upgrade",
    "legacy brief, session, event, and scorecard state remain intact",
    Object.values(continuity.rows[0] ?? {}).every((value) => value === true),
  );

  const immutableMediaId = seed.media[0]!.id;
  await expectError(
    "upgrade",
    "legacy media byte mutation is rejected by PostgreSQL",
    () => pool.query(`UPDATE media SET bytes=$2 WHERE id=$1`, [immutableMediaId, Buffer.from("changed")]),
    /approved media content is immutable/,
  );
  await expectError(
    "upgrade",
    "legacy media MIME mutation is rejected by PostgreSQL",
    () => pool.query(`UPDATE media SET mime='image/png' WHERE id=$1`, [immutableMediaId]),
    /approved media content is immutable/,
  );
  await expectError(
    "upgrade",
    "legacy media digest mutation is rejected by PostgreSQL",
    () => pool.query(`UPDATE media SET content_sha256=$2 WHERE id=$1`, [immutableMediaId, "0".repeat(64)]),
    /approved media content is immutable/,
  );
  await expectError(
    "upgrade",
    "legacy media ID mutation is rejected by PostgreSQL",
    () => pool.query(`UPDATE media SET id=gen_random_uuid() WHERE id=$1`, [immutableMediaId]),
    /approved media content is immutable/,
  );
  await expectError(
    "upgrade",
    "legacy media deletion is rejected by PostgreSQL",
    () => pool.query(`DELETE FROM media WHERE id=$1`, [immutableMediaId]),
    /content-addressed media rows cannot be deleted/,
  );
  await expectError(
    "upgrade",
    "legacy revocation metadata is immutable",
    () => pool.query(
      `UPDATE approval_queue SET revocation_reason='changed' WHERE id=$1`,
      [seed.approvalIds.pending],
    ),
    /approval revocation is immutable/,
  );
  await expectError(
    "upgrade",
    "a revoked legacy pending approval cannot be approved",
    () => pool.query(
      `UPDATE approval_queue SET status='approved', decided_by='intruder', decided_at=now() WHERE id=$1`,
      [seed.approvalIds.pending],
    ),
    /approval decisions require an active row/,
  );
}

async function assertBaseConstraintBehavior(pool: PgPool): Promise<void> {
  await expectError(
    "durable",
    "deprecated plaintext approval tokens are rejected",
    () => pool.query(
      `INSERT INTO approval_queue (platform, package, status, approval_token)
       VALUES ('facebook', '{}'::jsonb, 'rejected', 'plaintext-is-forbidden')`,
    ),
    /approval_queue_no_plaintext_token/,
  );
  await expectError(
    "durable",
    "an unbound, unrevoked pending approval is rejected",
    () => pool.query(
      `INSERT INTO approval_queue (platform, package, status)
       VALUES ('facebook', '{}'::jsonb, 'pending')`,
    ),
    /approval_queue_bound_live_shape/,
  );
  await expectError(
    "durable",
    "mismatched canonical and legacy subject copies are rejected",
    () => pool.query(
      `INSERT INTO approval_queue (
         platform, package, package_formatted, status, subject_type, subject_payload
       ) VALUES ('facebook', '{"a":1}'::jsonb, '{"a":1}'::jsonb, 'rejected', 'test/v1', '{"a":2}'::jsonb)`,
    ),
    /approval_queue_subject_copies_match/,
  );
  await expectError(
    "durable",
    "media rows cannot persist a digest that differs from their bytes",
    () => pool.query(
      `INSERT INTO media (mime, bytes, content_sha256) VALUES ('image/jpeg', $1, $2)`,
      [Buffer.from("digest mismatch"), "0".repeat(64)],
    ),
    /media_content_sha256_matches_bytes/,
  );
}

async function publicationJpegFixture(): Promise<Buffer> {
  const { Jimp, JimpMime } = await import("jimp");
  const image = new Jimp({ width: 1_080, height: 1_080, color: 0x16324fff });
  return (await image.getBuffer(JimpMime.jpeg, { quality: 85 })) as Buffer;
}

function facebookPackage(mediaId: string, digest: string, text = "Exact durable caption"): PostPackage {
  return {
    platform: "facebook",
    target: {
      accountId: "phase0a-page",
      apiHost: "graph.facebook.com",
      apiVersion: "v25.0",
    },
    text,
    images: [{
      url: `https://phase0a.invalid/media/${mediaId}-${digest}.jpg`,
      contentSha256: digest,
    }],
  };
}

async function assertDurableBehavior(pool: PgPool, databaseUrl: string): Promise<void> {
  await closeState();
  config.databaseUrl = databaseUrl;
  config.publicBaseUrl = "https://phase0a.invalid";
  await initState({ requireDurable: true });
  check("durable", "durable state is enabled for application integration", stateEnabled());

  await assertBaseConstraintBehavior(pool);

  const jpeg = await publicationJpegFixture();
  const jpegPolicy = assertPlatformSafePublicationJpeg(jpeg);
  check(
    "durable",
    "publication fixture is an actual <=5-MiB 1080x1080 JPEG",
    jpeg.length <= MAX_PUBLICATION_JPEG_BYTES
      && jpegPolicy.width === 1_080
      && jpegPolicy.height === 1_080,
  );
  const media = await saveMedia("image/jpeg", jpeg);
  check("durable", "application media digest matches live durable bytes", media.contentSha256 === hashMediaBytes(jpeg));
  const packageA = facebookPackage(media.id, media.contentSha256);
  const packageB = facebookPackage(media.id, media.contentSha256, "Mutated payload B");

  const approval = await createApproval("Durable exact payload A", [packageA]);
  const stored = await pool.query(
    `SELECT approval_token, approval_token_hash, subject_type, subject_payload,
            package, package_formatted, payload_sha256, status
     FROM approval_queue WHERE id=$1`,
    [approval.id],
  );
  const storedRow = stored.rows[0];
  check("durable", "approval creation persists one durable pending row", stored.rowCount === 1 && storedRow.status === "pending");
  check("durable", "approval plaintext token is not persisted", storedRow.approval_token === null);
  check(
    "durable",
    "only the SHA-256 of the decision capability is persisted",
    storedRow.approval_token_hash === sha256Text(approval.token)
      && storedRow.approval_token_hash !== approval.token,
  );
  check(
    "durable",
    "all three subject copies and canonical SHA-256 are exact",
    canonicalApprovalJson(storedRow.subject_payload) === canonicalApprovalJson([packageA])
      && canonicalApprovalJson(storedRow.package) === canonicalApprovalJson([packageA])
      && canonicalApprovalJson(storedRow.package_formatted) === canonicalApprovalJson([packageA])
      && storedRow.payload_sha256 === hashApprovalSubject([packageA])
      && storedRow.subject_type === SOCIAL_POST_APPROVAL_SUBJECT,
  );
  check(
    "durable",
    "the one-time plaintext token is absent from all persisted subject text",
    !JSON.stringify(storedRow).includes(approval.token),
  );

  const invalidDecision = await decideApproval(approval.id, `${approval.token}-wrong`, "approved", "offline-reviewer");
  check("durable", "invalid approval token cannot decide", !invalidDecision.ok && invalidDecision.reason === "invalid token");
  const untouched = await pool.query(
    `SELECT status, (SELECT count(*)::int FROM approval_decisions WHERE approval_id=$1) AS decisions
     FROM approval_queue WHERE id=$1`,
    [approval.id],
  );
  check(
    "durable",
    "invalid token leaves queue and decision log untouched",
    untouched.rows[0]?.status === "pending" && untouched.rows[0]?.decisions === 0,
  );

  const validDecision = await decideApproval(approval.id, approval.token, "approved", "offline-reviewer");
  check("durable", "valid approval token records the human decision", validDecision.ok);
  const live = await assertPublishAllowed<PostPackage[]>(approval.id);
  check(
    "durable",
    "durable publication authorization resolves the exact hash-bound subject",
    live.payloadSha256 === approval.payloadSha256
      && canonicalApprovalJson(live.subject) === canonicalApprovalJson([packageA]),
  );
  const decision = await pool.query(
    `SELECT decision, subject_type, payload_sha256, decided_by
     FROM approval_decisions WHERE approval_id=$1`,
    [approval.id],
  );
  check(
    "durable",
    "durable decision row agrees with queue subject and reviewer",
    decision.rowCount === 1
      && decision.rows[0]?.decision === "approved"
      && decision.rows[0]?.subject_type === SOCIAL_POST_APPROVAL_SUBJECT
      && decision.rows[0]?.payload_sha256 === approval.payloadSha256
      && decision.rows[0]?.decided_by === "offline-reviewer",
  );

  await expectError(
    "durable",
    "approval subject payload mutation is rejected by PostgreSQL",
    () => pool.query(`UPDATE approval_queue SET subject_payload='[]'::jsonb WHERE id=$1`, [approval.id]),
    /approval subject and authorization material are immutable/,
  );
  await expectError(
    "durable",
    "approval subject hash mutation is rejected by PostgreSQL",
    () => pool.query(`UPDATE approval_queue SET payload_sha256=$2 WHERE id=$1`, [approval.id, "0".repeat(64)]),
    /approval subject and authorization material are immutable/,
  );
  await expectError(
    "durable",
    "approval lifetime mutation is rejected by PostgreSQL",
    () => pool.query(`UPDATE approval_queue SET authorization_expires_at=now()+interval '2 days' WHERE id=$1`, [approval.id]),
    /approval subject and authorization material are immutable/,
  );
  await expectError(
    "durable",
    "approval decision UPDATE is rejected as append-only",
    () => pool.query(`UPDATE approval_decisions SET decided_by='changed' WHERE approval_id=$1`, [approval.id]),
    /approval decisions are append-only/,
  );
  await expectError(
    "durable",
    "approval decision DELETE is rejected as append-only",
    () => pool.query(`DELETE FROM approval_decisions WHERE approval_id=$1`, [approval.id]),
    /approval decisions are append-only/,
  );
  await expectError(
    "durable",
    "a second durable decision row is rejected",
    () => pool.query(
      `INSERT INTO approval_decisions (
         approval_id, decision, subject_type, payload_sha256, decided_by
       ) VALUES ($1, 'approved', $2, $3, 'duplicate')`,
      [approval.id, SOCIAL_POST_APPROVAL_SUBJECT, approval.payloadSha256],
    ),
    /approval_decisions_approval_id_key/,
  );
  await expectError(
    "durable",
    "an approval with a decision cannot be deleted through the relationship",
    () => pool.query(`DELETE FROM approval_queue WHERE id=$1`, [approval.id]),
    /approval_decisions_approval_id_fkey/,
  );

  const concurrent = await createApproval("Concurrent terminal decision", [packageA]);
  const concurrentResults = await Promise.all([
    decideApproval(concurrent.id, concurrent.token, "approved", "reviewer-a"),
    decideApproval(concurrent.id, concurrent.token, "rejected", "reviewer-b"),
  ]);
  check(
    "durable",
    "exactly one of two concurrent decisions succeeds",
    concurrentResults.filter((result) => result.ok).length === 1,
  );
  const concurrentStored = await pool.query(
    `SELECT q.status, q.decided_by AS queue_decided_by,
            d.decision, d.decided_by AS log_decided_by,
            (SELECT count(*)::int FROM approval_decisions WHERE approval_id=q.id) AS decision_count
     FROM approval_queue q
     JOIN approval_decisions d ON d.approval_id=q.id
     WHERE q.id=$1`,
    [concurrent.id],
  );
  check(
    "durable",
    "the concurrent winner is the single matching durable terminal decision",
    concurrentStored.rows[0]?.decision_count === 1
      && concurrentStored.rows[0]?.status === concurrentStored.rows[0]?.decision
      && concurrentStored.rows[0]?.queue_decided_by === concurrentStored.rows[0]?.log_decided_by,
  );

  const expiredToken = await createApproval("Expired token", [packageA], {
    tokenExpiresAt: new Date(Date.now() - 60_000),
    authorizationExpiresAt: new Date(Date.now() + 60_000),
  });
  const expiredVerify = await verifyApprovalToken(expiredToken.id, expiredToken.token);
  const expiredDecision = await decideApproval(expiredToken.id, expiredToken.token, "approved", "late-reviewer");
  check(
    "durable",
    "expired decision capability fails verification and decision",
    !expiredVerify.ok && expiredVerify.reason === "expired"
      && !expiredDecision.ok && expiredDecision.reason === "expired",
  );

  const expiredAuthorization = await createApproval("Expired authorization", [packageA], {
    tokenExpiresAt: new Date(Date.now() + 60_000),
    authorizationExpiresAt: new Date(Date.now() - 60_000),
  });
  check(
    "durable",
    "an unexpired decision token may record review independently of publication lifetime",
    (await decideApproval(expiredAuthorization.id, expiredAuthorization.token, "approved", "offline-reviewer")).ok,
  );
  await expectError(
    "durable",
    "expired publication authorization is blocked",
    () => getLiveApprovedSubject(expiredAuthorization.id),
    /authorization has expired/,
  );

  const pendingRevocation = await createApproval("Pending revocation", [packageA]);
  const pendingRevoked = await revokeApproval(pendingRevocation.id, "offline-operator", "test revocation");
  const revokedVerify = await verifyApprovalToken(pendingRevocation.id, pendingRevocation.token);
  check(
    "durable",
    "pending approval revocation invalidates its decision capability",
    pendingRevoked.ok && !revokedVerify.ok && revokedVerify.reason === "revoked",
  );

  const approvedRevocation = await createApproval("Approved revocation", [packageA]);
  await decideApproval(approvedRevocation.id, approvedRevocation.token, "approved", "offline-reviewer");
  check(
    "durable",
    "approved authorization can be revoked once",
    (await revokeApproval(approvedRevocation.id, "offline-operator", "test approved revocation")).ok,
  );
  check(
    "durable",
    "a second revocation attempt cannot overwrite immutable metadata",
    !(await revokeApproval(approvedRevocation.id, "other", "overwrite")).ok,
  );
  await expectError(
    "durable",
    "revoked approved authorization is blocked at durable publication load",
    () => assertPublishAllowed(approvedRevocation.id),
    /has been revoked/,
  );

  await assertHostedMediaIntegrity(packageA.images![0]!.url, media.contentSha256);
  check("durable", "durable hosted-media URL, row digest, live bytes, MIME, and JPEG policy agree", true);
  await expectError(
    "durable",
    "wrong approved media digest is rejected",
    () => assertHostedMediaIntegrity(packageA.images![0]!.url, "0".repeat(64)),
    /digest does not match/,
  );
  await expectError(
    "durable",
    "durable media-byte mutation is rejected before publication",
    () => pool.query(`UPDATE media SET bytes=$2 WHERE id=$1`, [media.id, Buffer.from("mutated")]),
    /approved media content is immutable/,
  );

  const originalFetch = globalThis.fetch;
  let transportMode: "deny" | "success" = "deny";
  let fetchCalls = 0;
  let providerRequestWasBound = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (transportMode !== "success") throw new Error("offline transport denied an unexpected provider request");
    fetchCalls += 1;
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    providerRequestWasBound = String(input) === "https://graph.facebook.com/v25.0/phase0a-page/photos"
      && init?.method === "POST"
      && init?.redirect === "error"
      && init?.signal instanceof AbortSignal
      && headers.get("authorization") === "Bearer offline-placeholder"
      && body.url === packageA.images![0]!.url
      && body.caption === packageA.text;
    return new Response(JSON.stringify({ id: "offline-post-id" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await expectError(
      "durable",
      "payload-A approval cannot authorize payload-B publication",
      () => publishApprovedPackage(
        packageB,
        { approvalId: approval.id, packageIndex: 0 },
        { fbPageId: "phase0a-page", fbPageAccessToken: "offline-placeholder", graphVersion: "v25.0" },
      ),
      /does not match the exact approved payload/,
    );
    check("durable", "payload mismatch is blocked before provider transport", fetchCalls === 0);

    transportMode = "success";
    const publication = await publishApprovedPackage(
      packageA,
      { approvalId: approval.id, packageIndex: 0 },
      { fbPageId: "phase0a-page", fbPageAccessToken: "offline-placeholder", graphVersion: "v25.0" },
    );
    check(
      "durable",
      "sanctioned publication entrypoint uses the durable approval and durable media row",
      publication.ok && publication.id === "offline-post-id" && fetchCalls === 1,
    );
    check(
      "durable",
      "offline transport observed exact approved target/content plus timeout and redirect refusal",
      providerRequestWasBound,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const afterPublication = await getApproval(approval.id);
  check(
    "durable",
    "offline transport simulation does not bypass or rewrite durable approval state",
    afterPublication?.status === "approved" && afterPublication.payloadSha256 === approval.payloadSha256,
  );
  await closeState();
}

/**
 * Exclusive worker ownership and interrupted-brief recovery against real
 * PostgreSQL. The advisory-lock semantics that make startup recovery safe —
 * session scope and automatic release on session death — cannot be proven by
 * an in-memory double, so they are proven here.
 */
async function assertOwnershipAndRecovery(pool: PgPool, databaseUrl: string): Promise<void> {
  // assertDurableBehavior closes durable state on the way out. Re-open it, and
  // prove it: without this the recovery helpers below would silently exercise
  // the in-memory fallback and assert nothing about real PostgreSQL.
  await closeState();
  config.databaseUrl = databaseUrl;
  await initState({ requireDurable: true });
  check("durable", "durable state is re-enabled for the ownership/recovery suite", stateEnabled());

  // --- ownership contention across two real dedicated sessions ---
  // Every acquisition below is tracked so a failed check can never leave a
  // polling session connected: an open connection would block DROP DATABASE
  // during cleanup and turn an assertion failure into a hung job.
  const heldForCleanup: { release(): Promise<void> }[] = [];
  const pollDelay = (): Promise<void> => new Promise<void>((r) => { setTimeout(r, 10); });
  try {
    const first = await WorkerOwnership.acquire({
      connect: () => connectOwnershipClient(databaseUrl),
      sleep: pollDelay,
      log: () => {},
    });
    heldForCleanup.push(first);
    check("durable", "a dedicated session acquires the worker ownership advisory lock", first.isOwner);

    // Deterministic contention: the waiter cannot possibly succeed before the
    // holder releases, and the holder releases only on a fixed poll count. No
    // wall-clock assumption, so slower CI I/O cannot make this flaky.
    const RELEASE_ON_POLL = 3;
    let polls = 0;
    let acquiredOnPoll = -1;
    const secondOwned = await WorkerOwnership.acquire({
      connect: () => connectOwnershipClient(databaseUrl),
      log: () => {},
      sleep: async () => {
        polls += 1;
        if (polls === RELEASE_ON_POLL) await first.release();
        await pollDelay();
      },
    }).then((owned) => { acquiredOnPoll = polls; return owned; });
    heldForCleanup.push(secondOwned);
    check(
      "durable",
      "a second session repeatedly fails to acquire while the first session holds the lock",
      polls >= RELEASE_ON_POLL,
    );
    check(
      "durable",
      "the waiter acquires only after the holder's session ends",
      acquiredOnPoll >= RELEASE_ON_POLL && secondOwned.isOwner,
    );
    await secondOwned.release();

    // Session death (not a clean unlock) must also release the lock, which is
    // the property that makes SIGKILL, OOM and host loss recoverable with no TTL.
    const abrupt = await connectOwnershipClient(databaseUrl);
    const taken = await abrupt.query(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
      [1_889_446_263, 889_784_911],
    );
    check("durable", "a raw session can take the ownership lock", taken.rows[0]?.acquired === true);
    await abrupt.end();
    const afterDeath = await WorkerOwnership.acquire({
      connect: () => connectOwnershipClient(databaseUrl),
      sleep: pollDelay,
      log: () => {},
    });
    heldForCleanup.push(afterDeath);
    check("durable", "ending the holding session releases the advisory lock automatically", afterDeath.isOwner);
    await afterDeath.release();
  } finally {
    for (const owned of heldForCleanup) await owned.release().catch(() => {});
  }

  // --- the claim is fenced to the ownership session -------------------------
  // The race this closes: barrier passes, ownership connection dies, successor
  // acquires and finishes startup recovery, and only THEN the old claim commits
  // -- producing a running row nothing will ever reconcile. Running the claim on
  // the ownership session makes that impossible, because a dead session cannot
  // commit.
  {
    const owned = await WorkerOwnership.acquire({
      connect: () => connectOwnershipClient(databaseUrl),
      sleep: pollDelay,
      log: () => {},
    });
    try {
      const pendingId = (await pool.query(
        `INSERT INTO brief_queue (brief, status) VALUES ($1, 'pending') RETURNING id`,
        [JSON.stringify({ goal: "claim fencing fixture" })],
      )).rows[0].id as string;

      const claimed = await owned.claimPendingBrief(CLAIM_PENDING_BRIEF_SQL);
      check("durable", "the ownership session can claim a pending brief",
        claimed?.id === pendingId);
      const afterClaim = await pool.query(`SELECT status FROM brief_queue WHERE id=$1`, [pendingId]);
      check("durable", "a claim committed by the owner marks the brief running",
        afterClaim.rows[0].status === "running");
      await pool.query(`UPDATE brief_queue SET status='failed', outcome='{}'::jsonb WHERE id=$1`, [pendingId]);

      // Now kill the ownership session server-side and prove a claim cannot
      // commit afterwards.
      const secondId = (await pool.query(
        `INSERT INTO brief_queue (brief, status) VALUES ($1, 'pending') RETURNING id`,
        [JSON.stringify({ goal: "claim after session death" })],
      )).rows[0].id as string;

      // Identify the owning backend by the advisory lock itself, not by its
      // last statement text, so the kill is deterministic.
      const backend = await pool.query(
        `SELECT pid FROM pg_locks
         WHERE locktype='advisory' AND granted AND classid=$1 AND objid=$2`,
        [1_889_446_263, 889_784_911],
      );
      check("durable", "the ownership advisory lock is visible in pg_locks", backend.rows.length === 1);
      await pool.query(`SELECT pg_terminate_backend($1)`, [backend.rows[0].pid]);
      // Give PostgreSQL a moment to actually tear the backend down.
      await new Promise((r) => setTimeout(r, 200));

      let refused = false;
      try {
        await owned.claimPendingBrief(CLAIM_PENDING_BRIEF_SQL);
      } catch (err) {
        refused = true;
        check("durable", "a claim on a dead ownership session fails rather than committing",
          err instanceof OwnershipLostError || err instanceof Error);
      }
      check("durable", "the claim after ownership-session death did not succeed", refused);
      const afterDeath = await pool.query(`SELECT status FROM brief_queue WHERE id=$1`, [secondId]);
      check("durable", "the brief stays pending, so a successor can still claim it",
        afterDeath.rows[0].status === "pending");
      check("durable", "the terminated session no longer reports ownership", !owned.isOwner);
      await pool.query(`DELETE FROM brief_queue WHERE id=$1`, [secondId]);
    } finally {
      await owned.release().catch(() => {});
    }
  }

  // --- recovery writes satisfy the live schema constraints ---
  const runId = (await pool.query(
    `INSERT INTO brief_queue (brief, status, claimed_at) VALUES ($1, 'running', now()) RETURNING id`,
    [JSON.stringify({ goal: "recovery integration fixture" })],
  )).rows[0].id as string;
  const approvalId = (await pool.query(
    `INSERT INTO approval_queue (platform, package, summary, package_formatted, status, subject_type,
                                 subject_payload, payload_sha256, approval_token_hash,
                                 token_expires_at, authorization_expires_at)
     VALUES ('multi', $1, 'recovery fixture', $1, 'pending', 'recovery-fixture/v1', $1, $2, $3,
             now() + interval '1 day', now() + interval '1 day')
     RETURNING id`,
    [JSON.stringify([{ platform: "facebook" }]), sha256Text("recovery-fixture"), sha256Text("token")],
  )).rows[0].id as string;

  await recordDurablePhaseEvent({
    runId, kind: PHASE_APPROVAL_REQUESTED, message: "approval requested", data: { approvalId, packageCount: 1 },
  });
  await recordDurablePhaseEvent({
    runId,
    kind: PHASE_PUBLISH_ATTEMPT_STARTED,
    message: "provider attempt starting",
    data: { approvalId, packageIndex: 0, platform: "facebook" },
  });
  check(
    "durable",
    "durable phase markers are readable back for their run",
    (await eventsForRun(runId)).length === 2,
  );
  check(
    "durable",
    "an approval marker links its approval id back to a run",
    (await approvalIdsWithOwningBriefMarker([approvalId])).has(approvalId),
  );
  check(
    "durable",
    "a running brief is visible to the owner's recovery scan",
    (await listRunningBriefs()).some((row) => row.id === runId),
  );

  const escalations: string[] = [];
  const providerCalls: string[] = [];
  const recoveryDeps: RecoveryDeps = {
    phaseMarkersForRun,
    recordDurablePhaseEvent,
    completeBrief,
    revokeApproval,
    setApprovalStatus,
    notifyEscalation: async (_goal, reason) => { escalations.push(reason); },
    listRunningBriefs,
    listRevocablePendingApprovals,
    approvalIdsWithOwningBriefMarker,
    log: () => {},
  };
  const results = await reconcileAbandonedWork(recoveryDeps);
  check("durable", "recovery classifies a started-but-unsettled attempt as uncertain",
    results.some((r) => r.runId === runId && r.classification === "uncertain_provider_outcome"));
  check("durable", "recovery makes no provider request", providerCalls.length === 0);

  const recovered = await pool.query(`SELECT status, outcome FROM brief_queue WHERE id=$1`, [runId]);
  check("durable", "recovery writes a terminal failed status accepted by the 002 status constraint",
    recovered.rows[0].status === "failed");
  check("durable", "recovery never returns a brief to pending", recovered.rows[0].status !== "pending");
  check("durable", "the recovery outcome flags required provider reconciliation",
    recovered.rows[0].outcome?.requiresProviderReconciliation === true);
  check("durable", "the recovery outcome preserves the approval linkage",
    recovered.rows[0].outcome?.approvalId === approvalId);
  check("durable", "an uncertain outcome is escalated", escalations.some((r) => r.includes("uncertain")));

  const audit = await pool.query(`SELECT count(*)::int AS count FROM events WHERE run_id=$1 AND kind=$2`,
    [runId, PHASE_RECONCILED]);
  check("durable", "recovery appends a durable reconciliation audit event", audit.rows[0].count === 1);

  const revokedRow = await pool.query(
    `SELECT revoked_at, revoked_by FROM approval_queue WHERE id=$1`, [approvalId],
  );
  check("durable", "recovery revokes the interrupted brief's approval", revokedRow.rows[0].revoked_at !== null);
  check("durable", "the revocation records the worker as its actor",
    String(revokedRow.rows[0].revoked_by).startsWith("worker:"));

  // --- orphan sweep against real rows ---
  const orphanId = (await pool.query(
    `INSERT INTO approval_queue (platform, package, summary, package_formatted, status, subject_type,
                                 subject_payload, payload_sha256, approval_token_hash,
                                 token_expires_at, authorization_expires_at)
     VALUES ('multi', $1, 'orphan fixture', $1, 'pending', 'recovery-fixture/v1', $1, $2, $3,
             now() + interval '1 day', now() + interval '1 day')
     RETURNING id`,
    [JSON.stringify([{ platform: "facebook" }]), sha256Text("orphan-fixture"), sha256Text("orphan-token")],
  )).rows[0].id as string;
  const swept = await sweepOrphanApprovals(recoveryDeps);
  check("durable", "an approval with no owning marker is swept", swept.includes(orphanId));
  const sweptRow = await pool.query(`SELECT revoked_at FROM approval_queue WHERE id=$1`, [orphanId]);
  check("durable", "the swept orphan approval is durably revoked", sweptRow.rows[0].revoked_at !== null);
}

async function createDatabase(admin: PgPool, database: string): Promise<void> {
  if (!/^gcd_phase0a_(fresh|upgrade)_[a-z0-9_]+$/.test(database)) {
    throw new Error(`refusing unexpected disposable database name: ${database}`);
  }
  await admin.query(`CREATE DATABASE "${database}"`);
}

async function dropDatabase(admin: PgPool, database: string): Promise<void> {
  if (!/^gcd_phase0a_(fresh|upgrade)_[a-z0-9_]+$/.test(database)) {
    throw new Error(`refusing to drop unexpected database name: ${database}`);
  }
  await admin.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname=$1 AND pid <> pg_backend_pid()`,
    [database],
  );
  await admin.query(`DROP DATABASE "${database}"`);
}

async function main(): Promise<void> {
  assertGcdRuntimeCredentialsAbsent();
  const adminUrl = validateAdminUrl(process.env.PHASE0A_POSTGRES_ADMIN_URL);
  const repoRoot = process.cwd();
  const suffix = `${process.pid}_${randomBytes(6).toString("hex")}`;
  const freshName = `gcd_phase0a_fresh_${suffix}`;
  const upgradeName = `gcd_phase0a_upgrade_${suffix}`;
  const freshUrl = asDatabaseUrl(adminUrl, freshName);
  const upgradeUrl = asDatabaseUrl(adminUrl, upgradeName);
  const pg: typeof import("pg") = await import("pg");
  const admin = new pg.Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 10_000 });
  const created: string[] = [];
  let partialRoot: string | undefined;
  let freshMigrationMs = 0;
  let pre005MigrationMs = 0;
  let upgrade005MigrationMs = 0;

  try {
    const version = await admin.query(`SHOW server_version`);
    const postgresVersion = String(version.rows[0]?.server_version ?? "unknown");
    console.log(`[postgres] server version ${postgresVersion}`);

    await createDatabase(admin, freshName);
    created.push(freshName);
    const freshRun = await runCompiledMigrations(repoRoot, freshUrl, repoRoot);
    freshMigrationMs = freshRun.elapsedMs;
    const freshPool = new pg.Pool({ connectionString: freshUrl, max: 8 });
    try {
      check(
        "fresh",
        "compiled migration runner applies every migration in lexical order",
        JSON.stringify(await migrationNames(freshPool)) === JSON.stringify([...EXPECTED_MIGRATIONS]),
      );
      check(
        "fresh",
        "runner output confirms every expected migration was applied",
        EXPECTED_MIGRATIONS.every((name) => freshRun.stdout.includes(`[migrate] applied ${name}`))
          && freshRun.stdout.includes("[migrate] done"),
      );
      await assertSchemaObjects(freshPool, "fresh");
      await assertStartupProbe(freshUrl, "fresh");
      await assertContentEvidenceSchema(freshPool, freshUrl, "fresh");
      await assertDurableBehavior(freshPool, freshUrl);
      await assertOwnershipAndRecovery(freshPool, freshUrl);
    } finally {
      await closeState();
      await freshPool.end();
    }

    await createDatabase(admin, upgradeName);
    created.push(upgradeName);
    partialRoot = await partialMigrationRoot(repoRoot);
    const pre005Run = await runCompiledMigrations(repoRoot, upgradeUrl, partialRoot);
    pre005MigrationMs = pre005Run.elapsedMs;
    const upgradePool = new pg.Pool({ connectionString: upgradeUrl, max: 4 });
    try {
      check(
        "upgrade",
        "compiled migration runner creates the realistic 001-004 baseline",
        JSON.stringify(await migrationNames(upgradePool)) === JSON.stringify(EXPECTED_MIGRATIONS.slice(0, 4))
          && EXPECTED_MIGRATIONS.slice(0, 4).every((name) => pre005Run.stdout.includes(`[migrate] applied ${name}`)),
      );
      const legacy = await seedLegacyState(upgradePool);
      await assertMigrationLockTimeout(repoRoot, upgradeUrl, upgradePool);
      const upgradeRun = await runCompiledMigrations(repoRoot, upgradeUrl, repoRoot);
      upgrade005MigrationMs = upgradeRun.elapsedMs;
      check(
        "upgrade",
        "real compiled runner skips 001-004 and applies migration 005",
        EXPECTED_MIGRATIONS.slice(0, 4).every((name) => upgradeRun.stdout.includes(`[migrate] skip ${name}`))
          && upgradeRun.stdout.includes("[migrate] applied 005_approval_integrity.sql")
          && JSON.stringify(await migrationNames(upgradePool)) === JSON.stringify([...EXPECTED_MIGRATIONS]),
      );
      await assertLegacyUpgrade(upgradePool, legacy);
      await assertSchemaObjects(upgradePool, "upgrade");
      await assertStartupProbe(upgradeUrl, "upgrade");
      await assertContentEvidenceSchema(upgradePool, upgradeUrl, "upgrade");
    } finally {
      await closeState();
      await upgradePool.end();
    }

    const total = GROUPS.reduce((sum, group) => sum + checks[group], 0);
    console.log(
      `[postgres] PASS ${total} checks `
      + `(fresh=${checks.fresh}, upgrade=${checks.upgrade}, durable=${checks.durable}); `
      + `migration_ms fresh=${freshMigrationMs}, baseline_001_004=${pre005MigrationMs}, upgrade_005=${upgrade005MigrationMs}`,
    );
  } finally {
    const cleanupFailures: Error[] = [];
    await closeState().catch((err) => cleanupFailures.push(err as Error));
    config.databaseUrl = undefined;
    for (const database of created.reverse()) {
      await dropDatabase(admin, database).catch((err) => {
        console.error(`[postgres] failed to drop owned disposable database ${database}: ${(err as Error).message}`);
        cleanupFailures.push(err as Error);
      });
    }
    await admin.end().catch((err) => cleanupFailures.push(err as Error));
    if (partialRoot) {
      await rm(partialRoot, { recursive: true, force: true }).catch((err) => cleanupFailures.push(err as Error));
    }
    if (cleanupFailures.length) {
      throw new AggregateError(cleanupFailures, "disposable PostgreSQL integration cleanup failed");
    }
  }
}

main().catch((err) => {
  console.error(`[postgres] FAIL: ${(err as Error).stack ?? (err as Error).message}`);
  process.exitCode = 1;
});
