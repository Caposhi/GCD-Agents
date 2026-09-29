# Content Studio design — a review-only web interface for the content pipeline

**This document is a design. It implements nothing and authorizes nothing.** No source, test,
migration, workflow, configuration, `render.yaml`, agent, skill or prompt file changes with it.
Nothing here creates a Render service, a database, an OAuth client or a secret. It calls no model,
changes no live service, and does not touch the Phase-A approval gate. Each implementation PR and
each owner action named in [§10](#10-the-pr-sequence-and-the-owner-actions) still needs its own
review, its own explicit authorization and its own evidence.

**State:** `PLANNED` (see [Roadmap](ROADMAP.md)). Owner approval of this design is pending.
Written 2026-09-29 against `main` at `f11101265c1ea7aa771d7efd2f5fdd98f96ab702` (the merge of
PR #101); that SHA is a dated snapshot, not a mutable pointer.

## Evidence labels

Every claim carries one label, in the same style as the
[production-wiring design](PRODUCTION_WIRING_DESIGN.md):

| Label | Meaning |
|---|---|
| **VERIFIED** | Read from repository source, Git or this repository's documented, dated evidence during this design. The reader can reproduce it from the path given |
| **PROPOSED** | A design choice made here. Not built and not authorized |
| **UNKNOWN / TO VERIFY** | Not established by anything this session could inspect: live Render or Google state, plans and prices, provider behaviour. Assume neither way; each has a named check before it is relied on |

A sentence without a label should be read as **UNKNOWN / TO VERIFY**.

## Contents

1. [Purpose, scope and non-goals](#1-purpose-scope-and-non-goals)
2. [Relation to the accepted production-wiring design](#2-relation-to-the-accepted-production-wiring-design)
3. [Render topology](#3-render-topology)
4. [Data model](#4-data-model)
5. [Run execution](#5-run-execution)
6. [Cost controls](#6-cost-controls)
7. [Authentication](#7-authentication)
8. [Screens](#8-screens)
9. [Security and privacy](#9-security-and-privacy)
10. [The PR sequence and the owner actions](#10-the-pr-sequence-and-the-owner-actions)
11. [Open questions and accepted limitations](#11-open-questions-and-accepted-limitations)
12. [Decisions this design made itself](#12-decisions-this-design-made-itself)

---

## 1. Purpose, scope and non-goals

### 1.1 Owner decisions (2026-09-29)

These are recorded as the owner gave them. They are `PLANNED` in [Roadmap](ROADMAP.md).

1. Build a web interface that removes manual terminal runs of the content pipeline and lets the
   owner and staff view every run and report in a browser.
2. **A separate, review-only "Content Studio"** in the same `render.yaml`: its own web service,
   background worker, optional cron job and its own PostgreSQL database. It is **not** built inside
   the live `gcd-social-*` services.
3. **Users:** the owner plus a few staff, signing in with Google, restricted to
   `@germancardepot.com`. The owner decides which users may start paid runs.
4. **Runs are on demand only at launch.** The cron job is designed but disabled until the owner
   decides otherwise.
5. **The manufacturer facts file** (`config/automotive-facts.local.json`, today only on the owner's
   Mac) may be uploaded to the Studio and stored in its private database. It is never committed to
   GitHub.

### 1.2 What the Studio does

**PROPOSED.** The Studio is a browser front end for what `scripts/local/content-run.mjs` does
today. It adds no new reasoning. It offers:

- **Full runs:** stages 1 to 5, the contact lines, and the four critic lenses.
- **Revision:** one revision round (`--revise-from`).
- **Critic replay:** a critic-only replay (`--replay-critic`).
- **Resume:** a resume from `packaging-adaptation` (`--resume-from packaging-adaptation`).
- **History:** every run and report, stored in the Studio database and readable on a phone.

Each paid action is priced first and needs an explicit price confirmation.

The output is the same as today's: a script, a shot list, per-platform captions with their
deterministic contact line and hashtags, and the critic's findings. The owner reads it in the
Studio and **copies it by hand** into Instagram, Facebook or Google Business Profile. Posting
stays a manual copy-paste by the owner.

### 1.3 Non-goals

**PROPOSED, and each is a design invariant that later PRs must test.**

- **No publishing, and no Instagram, Facebook or Google Business Profile credentials.** No Studio
  service carries `IG_*`, `FB_*`, `GOOGLE_ACCESS_TOKEN`, `GOOGLE_REFRESH_TOKEN`, `GBP_*`,
  `IMAGEGEN_API_KEY` or `APPROVAL_CHANNEL_WEBHOOK`. No Studio module transitively reaches
  `src/mcp/posting-tool/index.ts` at runtime, `src/mcp/posting-tool/native/**`, any provider module,
  `src/harness/publicationRunner.ts`, `src/harness/hitl.ts` or `src/harness/igToken.ts`.
  **VERIFIED exception, allowlisted by name:** calling the stages as the CLI does loads
  `src/mcp/posting-tool/validation.ts`, which is pure package validation, through
  `src/harness/packageMap.ts`. `contactLine.ts` and `packagingAdaptation.ts` also carry type-only
  imports of `posting-tool/index.js`, which compile away. The S1 import-graph check allows exactly
  these and nothing else.
- **No access to `gcd-social-db`.** No Studio service receives the live `DATABASE_URL`, and no
  Studio module imports `src/harness/state.ts`.
- **No approval path.** The Studio creates no `approval_queue` row. It sends no Slack message and
  issues no approval token. A Studio report is not an approval, and nothing in it is marked
  approved.
- **No change to the Phase-A gate or to any live service.** No file of `src/api/**`,
  `src/worker/**`, `src/scheduler/**`, `state/migrations/**`, `.github/workflows/deploy-production.yml`
  or `scripts/render/deployment-controller.mjs` changes for the Studio. The existing
  `gcd-social-*` entries in `render.yaml` do not change either (see
  [§3.6](#36-applying-the-blueprint--a-gate-not-a-formality) for the one exposure this cannot rule
  out by itself).
- **No video editing.** Humans film; CapCut or another external editor stays the V1 path
  ([Roadmap](ROADMAP.md): browser-based video editing is `DEFERRED`).
- **No automatic posting,** and no scheduling of posts. The recommended time stays a review note
  (`timingVerified: false`, `schedulable: false`, **VERIFIED** in `packagingAdaptation.ts`).

---

## 2. Relation to the accepted production-wiring design

### 2.1 What was accepted

**VERIFIED.** [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md) (PR #56, merge
`53e2c2bb6115e457670c1f99956d11a1a54530cd`) is the accepted, `UNIMPLEMENTED` design for making the
six stages reachable from the **live** pipeline. It has eight PRs (P1–P8) and seven milestones
(M1–M7). Only M1 has been performed. Its §5.2 reads "**PROPOSED** — no new Render service". Its
roadmap record lists "*A new Render service* was rejected in favour of existing infrastructure"
among the rejected alternatives.

### 2.2 The deliberate deviation from §5.2

**PROPOSED.** The Studio is a new set of Render resources, which departs from §5.2. The reasons:

1. **It cannot publish, by construction.** A service that holds no provider credential and imports
   no posting module cannot publish, whatever a bug or a compromised session does. Inside
   `gcd-social-worker`, the only publication handoff and the holder of every provider credential,
   the same work would sit one import away from publishing. It would depend on checkpoints C4 and
   C5, which do not exist yet (P5 and P6).
2. **It is isolated from the live database.** **VERIFIED** ([Status](STATUS.md), *Material
   unresolved risks* 3 and 4): `gcd-social-db` stores the default-path Instagram token in plaintext
   in `session_state`, and its external allowlist is `0.0.0.0/0`. A separate database, with no
   Studio service holding a credential for the live one, keeps Studio users, sessions, uploads and run
   history away from that token and from that exposure.
3. **The live services do not change.** The live path is inside the M1→M2 partial-release interval
   (bound `2026-10-22T18:52Z`). Its M2–M7 sequence is gated, milestone by milestone, and its
   standing prohibition reads "no unrelated release may occur, of any service, for any reason" (see
   §10 for the Studio's freeze gate). The Studio needs no live release, no live
   migration (008 or later) and no change to any live control.

§5.2's reasoning, to reuse the worker's ownership, recovery and credentials, still holds for
**live** wiring. This deviation covers only a review-only tool that must never gain those
credentials. It does not reopen §5.2 for P1–P8.

### 2.3 What the Studio does not implement

**PROPOSED.** The Studio implements **none of P1–P8** and performs **none of M2–M7**. In
particular:

- It adds no authority control plane, no migration 008, and no C1–C5 checkpoint.
- It flips no `executionEnabled`. **VERIFIED:** all six stages remain `false`.
- It dispatches nothing into the live queue.
- It is not a shadow run. The design's §7.4 says "Only **M4.5** produces real-model evidence", and
  its §7.6 sets the `PRODUCTION-VALIDATED` criteria; Studio runs count towards neither. They are
  operator evidence, like today's local runs.

**A "send to approval" handoff** from a Studio report into the live approval path is **out of
scope**. It would be a separate design needing its own authorization, because it would join the
two systems this design keeps apart.

### 2.4 The pointer in the production-wiring design

**PROPOSED, and made in this change.** A short amendment note in §5.2 of
[PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md) points here. The accepted design is not
rewritten.

---

## 3. Render topology

**Everything about live Render state in this section is UNKNOWN / TO VERIFY.** No Render inspection
was performed or authorized. **VERIFIED** facts come from `render.yaml` and from
[Deployment control](DEPLOYMENT.md).

### 3.1 Services

**PROPOSED** names, types and plans. **Plans and prices are TO VERIFY** in the Render dashboard
before the blueprint change (S8), as `render.yaml`'s own comment already requires.

| Resource | Type | Plan (TO VERIFY) | Role |
|---|---|---|---|
| `gcd-studio-web` | web | `starter` | Sign-in, screens, quotes and confirmations, fact upload, legacy import; enqueues jobs. **Never calls a model** |
| `gcd-studio-worker` | worker | `starter` (TO VERIFY; `standard` if a measured four-lens run needs more than 512 MB) | The single job consumer; runs the pipeline library; the only holder of `ANTHROPIC_API_KEY` |
| `gcd-studio-cron` | cron | `starter` | **Designed, not created at launch** — see [§3.5](#35-the-cron-job--built-disabled) |
| `gcd-studio-db` | PostgreSQL | `basic-256mb` (TO VERIFY) | Studio-only durable state; `databaseName: gcd_studio`; no external access |

**VERIFIED (by contrast):** the live resources are `gcd-social-api`, `gcd-social-worker`,
`gcd-social-scheduler` and `gcd-social-db`. The `gcd-studio-` prefix keeps every Studio resource
distinct from the live ones by name, in `render.yaml`, in the dashboard and in logs.

**PROPOSED — code layout.** Studio code lives under `src/studio/**`, compiled by the existing
`tsc -p tsconfig.json` into `dist/studio/**`. Studio SQL lives under `studio/migrations/`, outside
`state/`. It adds three package scripts: `start:studio-web`, `start:studio-worker` and
`studio:migrate`. Build command, as for the live services: `npm ci --include=dev && npm run build`.

**A consequence to record, not hide.** The live services build the whole repository. Once any
Studio PR merges, a later authorized **live** release will also carry `dist/studio/**`, and any
dependency the Studio adds, without reaching them. [§5.4](#54-executionenabled-and-the-registry--how-the-studio-worker-may-call-stages)
defines the reachability check that keeps it that way.

### 3.2 Environment variables per service

**PROPOSED.** Secrets are `sync: false`, so no value is ever in `render.yaml`. The Studio uses
**Studio-specific names** wherever a live name exists. That way a Studio process can never
pick up a live value through a shared module, and a live process can never pick up a Studio one.

`gcd-studio-web`:

| Key | Value / source | Why |
|---|---|---|
| `NODE_ENV` | `production` | |
| `NODE_OPTIONS` | `--max-old-space-size=400` | as the live API, under a 512 MB instance |
| `STUDIO_DATABASE_URL` | `fromDatabase: gcd-studio-db` / `connectionString` | **Not** `DATABASE_URL`: the live `src/harness/config.ts` reads `DATABASE_URL` (**VERIFIED**), so no Studio process carries that name at all |
| `STUDIO_PUBLIC_ORIGIN` | the Studio's exact HTTPS origin (TO VERIFY once Render assigns it) | the OIDC redirect URI and the CSRF origin check are derived from it and nothing else |
| `STUDIO_ALLOWED_HD` | `germancardepot.com` | the Workspace domain the `hd` claim must equal |
| `STUDIO_GOOGLE_CLIENT_ID` | `sync: false` | **Not** the live `GOOGLE_CLIENT_ID`, which is the GBP OAuth client (**VERIFIED**, `render.yaml`) |
| `STUDIO_GOOGLE_CLIENT_SECRET` | `sync: false` | the Studio's own OAuth client secret |
| `STUDIO_BOOTSTRAP_OWNER_EMAIL` | `sync: false` | read only while the users table holds no owner ([§7.2](#72-allowlist-and-roles)) |
| `STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD` | `sync: false` | deployment-time ceilings over the owner's caps ([§6.2](#62-daily-and-monthly-caps--enforced-before-every-paid-call)) |

`gcd-studio-worker`:

| Key | Value / source | Why |
|---|---|---|
| `NODE_ENV` | `production` | |
| `NODE_OPTIONS` | `--max-old-space-size=400` (TO VERIFY against the plan) | |
| `STUDIO_DATABASE_URL` | `fromDatabase: gcd-studio-db` / `connectionString` | |
| `ANTHROPIC_API_KEY` | `sync: false` | **on the worker only.** The web service never calls a model. The name is the one `src/harness/config.ts` reads (**VERIFIED**). The owner is advised to use a separate key with its own spend limit ([§6.5](#65-the-provider-side-backstop)) |
| `STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD` | `sync: false` | the same ceilings, enforced again at the paid call |

`gcd-studio-cron` (not created at launch): `NODE_ENV`, `STUDIO_DATABASE_URL`, and
`STUDIO_SCHEDULED_RUNS_ENABLED` = `false`.

**No Studio service carries** `DATABASE_URL`, `CONSOLE_TOKEN`, any `IG_*`, `FB_*` or `GBP_*`
value, `GOOGLE_ACCESS_TOKEN`, `GOOGLE_REFRESH_TOKEN`, the live `GOOGLE_CLIENT_ID` or
`GOOGLE_CLIENT_SECRET`, `IMAGEGEN_API_KEY`, `APPROVAL_CHANNEL_WEBHOOK`, `AUTONOMY_PHASE`,
`PUBLIC_BASE_URL` or `ACTIVE_PLATFORMS`. Checking key names alone is not enough, so the rule is
enforced three ways:

- **S8's static check, over values as well as names.** It fails CI in any of these cases:
  - a `gcd-studio-*` block names a forbidden key;
  - any `fromDatabase.name` in a `gcd-studio-*` block is not `gcd-studio-db`;
  - a `gcd-studio-*` block uses `fromGroup` or `fromService` pointing at a live resource;
  - any `gcd-social-*` block references `gcd-studio-db`.
- **A startup refusal.** Values set in the dashboard are invisible to CI, so the web and the worker
  each refuse to start if any forbidden variable is present in their environment, whatever its
  value.
- **A database identity check at runtime.** The web and the worker each refuse to start unless
  `current_database()` is `gcd_studio` and the `studio_database_identity` row matches. This is the
  same check the migration runner makes, repeated at runtime.

`src/studio/**` reads environment variables only in the dot form (`process.env.NAME`), which the
coverage script can see.

**Environment coverage.** **VERIFIED:** `scripts/ci/check-environment-coverage.mjs` compares only
`process.env.X` reads in `src/**/*.ts` (and `num`/`requireEnv` calls) against `.env.example`. It
reads neither Markdown nor `render.yaml`. So the variables above are invisible to it today: it
neither requires nor flags them. They become checked when the PR that first reads one in
`src/studio/**` must add it to `.env.example` with a safe placeholder.

### 3.3 Health checks

**PROPOSED.**

- **`gcd-studio-web`:** `healthCheckPath: /healthz`. It returns a small JSON document with
  `service: "gcd-studio-web"`, `commit` (Render's `RENDER_GIT_COMMIT`), `state: "postgres"`, the
  applied Studio schema version, and `worker` (the age of the worker's last heartbeat row). It needs
  no authentication, returns no user, run or cost data, and reads one indexed row.
- **`gcd-studio-worker`:** Render gives background workers no health check (TO VERIFY). The worker
  instead:
  - emits one structured ready line, `[studio-worker] ready {"service":"gcd-studio-worker","commit":"…","state":"postgres"}`,
    only after ownership is held and restart recovery has finished
    ([§5.3](#53-the-job-queue));
  - writes a heartbeat row every 30 seconds.

  The web shows "worker offline" and refuses new paid confirmations while the heartbeat is older
  than 2 minutes.

### 3.4 How Studio deployments are controlled

**PROPOSED, and chosen: manual, exact-commit deploys by the owner, with native auto-deploy off on
every Studio service.** Every `gcd-studio-*` block in `render.yaml` sets auto-deploy off. The field
name and value are TO VERIFY against the current Render blueprint specification:
`autoDeployTrigger: off`, or the older `autoDeploy: false`. The owner deploys an exact commit from
the Render dashboard, using the Studio release checklist that S8 adds to [Operations](OPERATIONS.md).
Before any deploy, the checklist requires that:

- the commit is on `main`;
- the `CI` run on that exact commit passed all five jobs on attempt 1;
- the commit's diff since the live Studio commit touches no live-service path;
- the web service (which runs the Studio migrations) is deployed first, then the worker, at the
  same commit ([§5.3](#53-the-job-queue), version skew).

Why this, and not the alternatives:

| Option | Verdict | Reason |
|---|---|---|
| Render native auto-deploy on the Studio services | **Rejected** | Every `main` merge would deploy the Studio, including during the partial-release interval, and would run its migrations unattended. [Deployment control](DEPLOYMENT.md)'s rule is to hold no native auto-deploy while GitHub control is the intended authority. Keeping every service in this repository on the same rule is the least surprising |
| Adding the Studio to `deploy-production.yml` and `deployment-controller.mjs` | **Rejected** | It changes the live deployment authority, its fixtures and its serialized order. **VERIFIED:** that controller is `CONFIGURED`, not `ENABLED`, and not yet proven (cutover steps 8–10 not done). The Studio would inherit its gate and its unfinished proof, and the live controller would gain services it was never reviewed for |
| A separate Studio GitHub workflow with its own gate | **Rejected** | It needs a Render API key in GitHub. **VERIFIED** ([Status](STATUS.md)): the only Render API key available is account-wide with write authority, so a Studio workflow could deploy the live services too. That would be a second unattended authority over production |
| **Manual exact-commit deploys, auto-deploy off** | **Chosen** | **Zero new unattended deployment authorities.** [Deployment control](DEPLOYMENT.md) records the current count as "Zero, intentionally", and it stays zero. No credential enters GitHub. No live workflow, controller or fixture changes. It matches how M1 itself was deployed (`trigger: "manual"`) |

**Re-entry condition.** Once the live controller is `ENABLED` and proven (cutover steps 8–10), a
separately reviewed change may bring the Studio under GitHub control. The same applies if Render
offers a service-scoped API key (TO VERIFY). Until then the cost is one human step per Studio
release, recorded as an accepted limitation.

**VERIFIED, and load-bearing.** The live controller deploys only the three service IDs held in the
GitHub `production` environment, and derives `LIVE_SHA` from the live API alone
([Deployment control](DEPLOYMENT.md)). A Studio service is invisible to it, so the Studio cannot
move the live controller's release range, its health check or its `PARTIAL_RELEASE_STATE`
judgement.

### 3.5 The cron job — built disabled

**PROPOSED.** The cron's code is built in S9, and it enqueues only, like `gcd-social-scheduler`. It
refuses to enqueue unless **both** of these hold:

- the deployment-time ceiling `STUDIO_SCHEDULED_RUNS_ENABLED` is exactly `true`;
- the owner-set database setting `scheduled_runs_enabled` is `true`.

A scheduled run gets no price confirmation from a person. So it also needs a standing owner
pre-authorization row that names the goal template, the platforms, the scope tags and a per-run
price ceiling. That row counts against the same caps.

**The `gcd-studio-cron` block is not added to `render.yaml` at launch.** A cron resource that exists
can be switched on by one variable change, and it bills for its runs. Adding it, and choosing its
schedule, is the owner's separate decision under owner decision 4. The code for it does not
depend on that decision.

### 3.6 Applying the blueprint — a gate, not a formality

**UNKNOWN / TO VERIFY, and the most important external fact in this design.** Owner decision 2 puts
the Studio in the same `render.yaml`. This repository does not establish two things:

- whether the live `gcd-social-*` services are linked to a Render **Blueprint** instance;
- whether that Blueprint auto-syncs from `main`.

If they are linked, applying the edited `render.yaml` is a **Blueprint sync over the live services
too**. It can reconcile their settings to the file: for example an auto-deploy default the file
does not state, or a plan. [Deployment control](DEPLOYMENT.md) already says: "Do not synchronize
the Blueprint or re-enable a native setting as a substitute for the controlled proof." If
auto-sync is on, **merging S8 alone** could create the Studio resources and touch the live ones,
with no deploy step at all. The live blocks state no auto-deploy setting, so a sync could apply
Render's default and switch native auto-deploy back on (TO VERIFY).

The unlinked case is not safe either. A new Blueprint created from this `render.yaml` also contains
the `gcd-social-*` entries, and what Render does with existing services of the same name is
TO VERIFY. Creating a service may also deploy it at once (TO VERIFY), which would happen before O5's
exact-commit checklist.

**Recommended default, put to the owner as an amendment to decision 2** (§11, question 2): declare
the Studio in a **separate Blueprint file**, or create its resources by hand from a checked-in
specification. Either way, applying it can name no `gcd-social-*` resource. If the owner keeps one
`render.yaml`, the gate below applies in full.

**PROPOSED gate, before S8 merges and again before the owner applies anything:**

1. A read-only check in the Render dashboard: is this repository linked to a Blueprint instance,
   which resources does it manage, and is auto-sync on? Record the answer with its date.
2. If a Blueprint manages the live services, S8 must not merge while auto-sync is on. The owner
   either turns auto-sync off, which is a change to a live-service setting and needs its own
   authorization, or chooses a separate Blueprint file for the Studio
   ([§11](#11-open-questions-and-accepted-limitations), question 2).
3. When applying, Render's sync preview (TO VERIFY that one is shown) must list **only**
   `gcd-studio-*` resources. **Any change listed against a `gcd-social-*` resource is a stop
   condition.**

### 3.7 Studio migrations — kept strictly separate from the live migrations

**VERIFIED about the live runner** (`src/state/migrate.ts`):

- it reads only `state/migrations/*.sql`, in lexical order;
- it records names in `_migrations` (`CREATE TABLE IF NOT EXISTS`);
- it applies each file inside `BEGIN` … `INSERT INTO _migrations` … `COMMIT`;
- against `DATABASE_URL`, it runs in production only as `gcd-social-api`'s `preDeployCommand`. CI
  (`ci.yml`) and the disposable PostgreSQL self-test also run it, against disposable databases.

**PROPOSED — five independent separations, so that neither runner can ever apply the other's
migrations:**

1. **Different files.** Studio SQL lives in `studio/migrations/NNNN_*.sql`, outside `state/`. The
   live runner's directory read cannot see it. **VERIFIED consequence:** the live controller's
   `git diff --name-only … -- 'state/migrations/**'` guard is unaffected by a Studio migration, and
   a Studio migration never makes a live release migration-bearing.
2. **A different runner and ledger.** `src/studio/db/migrate.ts` reads only `studio/migrations/`
   and records applied files in `studio_schema_migrations`. Each row stores the file's
   **sha256**, which the live `_migrations` table lacks. The runner refuses a recorded file whose
   bytes have since changed.
3. **A different connection variable.** The Studio runner reads only `STUDIO_DATABASE_URL`, and
   refuses if `DATABASE_URL` is also set in its environment. It runs only as `gcd-studio-web`'s
   `preDeployCommand`. **No live service is given `STUDIO_DATABASE_URL`**, and no Studio service is
   given `DATABASE_URL`.
4. **Database identity checks in the Studio runner.** Before applying anything, the runner refuses
   unless all three hold:
   - `current_database()` is `gcd_studio`;
   - no live-schema table exists (`_migrations` without the Studio tripwire marker below,
     `approval_queue`, `session_state`);
   - once created, the singleton `studio_database_identity` row matches.
5. **A tripwire against the unchanged live runner.** Studio migration `0001` creates a table named
   `_migrations` whose `name` column carries `CHECK (false)`, commented as the Studio tripwire.
   Suppose the live runner were ever pointed at the Studio database. Its `CREATE TABLE IF NOT
   EXISTS` does nothing, its first `INSERT INTO _migrations` fails, and its transaction does not
   commit, so no live schema persists. That behaviour is **TO VERIFY by execution** in S2
   (disposable PostgreSQL 16 and 18), not assumed. The live runner itself is not edited.

S2's disposable PostgreSQL suite must run both runners cross-wise:

- the Studio runner against a live-migrated database: refused before any statement;
- the live runner against a Studio-migrated database: fails with nothing committed;
- each runner against its own database: applies, and is idempotent.

---

## 4. Data model

**PROPOSED tables, all in `gcd-studio-db`.** Money is `numeric(12,6)` USD. Times are
`timestamptz`. Ids are UUIDs unless noted. Each table lists its invariants; S2 enforces the
database-side ones with constraints and triggers, and tests them on disposable PostgreSQL 16 and 18.

### 4.1 Identity and access

| Table | Columns (principal) | Invariants |
|---|---|---|
| `studio_users` | `id`, `email` (lower-cased, unique), `google_sub` (unique, set at first sign-in), `display_name`, `role` (`owner` \| `runner` \| `viewer`), `status` (`active` \| `disabled`), `daily_cap_usd` (nullable, per user), `created_by`, `created_at`, `updated_at` | `email` must end `@germancardepot.com`. Once an owner exists, at least one active `owner` always exists: a trigger refuses the change that would remove the last one. Until then the table may be empty, and only the bootstrap path of [§7.2](#72-allowlist-and-roles) can create the first owner. A `google_sub` never changes once set |
| `studio_login_attempts` | `state_hash` (pk), `nonce_hash`, `pkce_verifier`, `created_at`, `expires_at` (10 min) | `state` and `nonce` are stored only as hashes. The PKCE verifier is stored as issued, because the token exchange needs it; it is worthless without the one-time code and expires in 10 minutes. Single use: consumed by delete in the callback transaction. Expired rows are refused and purged. Rows are created before authentication, so creation is rate-limited per client address ([§7.3](#73-sessions-csrf-and-logout)) |
| `studio_sessions` | `id_hash` (pk, sha256 of the cookie value), `user_id`, `csrf_token_hash`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at` | The cookie value itself is never stored. A disabled user's sessions are revoked in the same transaction that disables them |

Roles, enforced server-side on every request:

- **`owner`:** everything, including users and roles, caps, fact upload and legacy import.
- **`runner`:** view, plus start the paid actions (full run, revise, critic replay, resume), within
  the caps.
- **`viewer`:** view only.

The owner decides who is a `runner` (owner decision 3).

### 4.2 Runs, outputs, findings, costs and reports

| Table | Columns (principal) | Invariants |
|---|---|---|
| `studio_runs` | `id`; `kind` (`full` \| `revise` \| `replay_critic` \| `resume_packaging` \| `imported`); `source_run_id` (lineage); `state` (`queued` \| `running` \| `succeeded` \| `failed` \| `refused` \| `cancelled` \| `interrupted`); `requested_by`; `goal`; `platforms`; `scope_tags` (null means unscoped); `runner` (`live` \| `fake`); `fact_version_id`; `approved_facts_sha256`; `automotive_facts_sha256`; `evidence_pack_sha256`; `code_commit`; `quote_id`; `reserved_usd`; `actual_usd`; `verdict`; finding counts; `failure_class`; `failure_message`; `import_tier` (`verified` \| `archived_unverified`, imports only); `created_at` / `started_at` / `finished_at` | The three sha256 fingerprints are the ones the CLI records in `run-meta.json` (**VERIFIED**: `approvedFacts`, `automotiveFacts`, `evidencePackSha256`), computed the same way. A full run records them in `run-meta.json`. A resume, replay or revise records them in its own `resume-meta.json`, `replay-meta.json` or `revision-meta.json`, which the Studio reads from there. A `live` run always has a `quote_id` and a reservation. A terminal state never changes. `source_run_id` must name an existing run, and a run cannot be its own ancestor |
| `studio_run_artifacts` | `run_id`, `name`, `content` (bytea), `sha256`, `byte_length` | **The authoritative record of a run.** Its files are byte for byte **every** file the CLI writes for that kind of run. **VERIFIED** today: `run-meta.json`, `resume-meta.json`, `replay-meta.json`, `revision-meta.json`, `01-…` to `06-final-critic.json`, `round-1-06-final-critic.json`, `05b-contact-lines.json`, `summary.md`, `field-measurements.md` / `.json` and `rejected-responses.json`. S1 derives the list from the library, not from this table. So a Studio run can be exported as a CLI folder and replayed locally, and a CLI folder can be imported. Immutable once written |
| `studio_run_requests` | `run_id`, `seq`, `stage`, `lens`, `model`, `ceiling_usd`, `input_tokens`, `output_tokens`, `cost_usd`, `started_at`, `finished_at`, `outcome` | A `started` row carrying that request's own ceiling is committed **before** the request is sent. It is completed when the request returns. A request with no completed row, or with no known cost (for example a model with no price row, or a response without usage), is charged at its **full ceiling**. That way a crash or an unknown cost never frees money that was probably spent. One row per provider request: five stages plus four lenses for a full run. The four lenses run concurrently, so their rows are written through one serialized `RunSink` |
| `studio_findings` | `run_id`, `idx`, `lens`, `severity`, `category`, `owner`, `issue`, `owner_item` (bool) | **Derived** from `06-final-critic.json` by the library's own accessors, and rebuildable from the artifact. `owner_item` is true exactly where `planRevision` would hold the finding back (a `human_review` owner or a `human_decision` category) |

**Reports.** A report is not a table. The run report screen ([§8.2](#82-run-report)) renders it
from the run's artifacts and derived rows. The `summary.md` artifact is stored exactly as the
CLI writes it, and can be downloaded.

### 4.3 Revision lineage

**PROPOSED.** `studio_runs.source_run_id` forms a tree. A revise, replay or resume points at the
run it read, and an import has no parent. Round 2 of a revision chain is a revise whose source is
round 1's run, exactly as the owner ran it by hand on 2026-09-28 (**VERIFIED**, [Roadmap](ROADMAP.md)).
The report shows the chain in both directions. Revising a run never modifies it (**VERIFIED** CLI
behaviour, kept).

### 4.4 Fact-file versions

| Table | Columns (principal) | Invariants |
|---|---|---|
| `studio_fact_versions` | `id`, `sha256` (unique), `content` (bytea, exactly as uploaded), `byte_length`, `record_count`, `tag_counts` (jsonb), `uploaded_by`, `uploaded_at`, `status` (`active` \| `retired`) | Owner-only insert. `content`, `sha256` and the counts are immutable; only `status` may change. A version is never deleted while any run references it (restrictive foreign key). `sha256` is computed over the uploaded bytes, exactly as the CLI's `fileFingerprint` hashes the file, so a run's recorded `automotiveFacts.sha256` names the version it used |
| `studio_settings` (singleton) | `active_fact_version_id`, `daily_cap_usd`, `monthly_cap_usd`, `scheduled_runs_enabled` (default `false`), `updated_by`, `updated_at` | Every change writes an audit row in the same transaction |

**Each run pins exactly one fact version** (`studio_runs.fact_version_id`). Retiring or replacing
the active version never changes an existing run. A revise, replay or resume uses its **source
run's** pinned version, not the active one. The CLI's fingerprint check then refuses any mismatch,
exactly as it does today.

The approved-facts file is **not** uploaded. It is `config/approved-facts.json` at the worker's
deployed commit, recorded by sha256 as the CLI already does.

### 4.5 Imported legacy runs

**PROPOSED.** An import is a `studio_runs` row with `kind = imported`, its artifacts, and an
`import_tier`:

- **`verified`:** the import passed the same verification as `--revise-from` in revision mode
  ([§8.6](#86-import-of-existing-local-output-runs)). It can be the source of a revise, replay or
  resume.
- **`archived_unverified`:** it failed that verification. The usual reasons are an older
  approved-facts hash (**VERIFIED**: every run recorded before the 2026-09-26 Lane S change carries
  one), a fact version that was never uploaded, or a stage 4 overlay now refused by the
  contact-in-overlay check. It is kept so the owner can see every run, and it is shown with a
  prominent "not revalidated" banner and the refusal reason. **It can never be the source of a
  paid action.**

### 4.6 Audit log, quotes and the spend ledger

| Table | Columns (principal) | Invariants |
|---|---|---|
| `studio_audit_log` | `id`, `at`, `actor_user_id`, `action`, `target_type`, `target_id`, `detail` (jsonb) | Append-only (a trigger refuses `UPDATE` and `DELETE`). Records sign-in, sign-out, role and status changes, cap changes, fact uploads, imports, quotes, confirmations, cancellations and run state changes. `detail` never holds a goal, model text, fact text, an email body, a token or a secret. The only exception to append-only is the retention purge in [§4.7](#47-retention-and-backup). It is a separately reviewed migration or database function, never an application code path |
| `studio_quotes` | `id`, `user_id`, `action`, `params_sha256`, `worker_commit`, `approved_facts_sha256`, `fact_version_id`, `price_table_sha256`, `ceiling_usd`, `breakdown` (jsonb: one line per request), `created_at`, `expires_at` (10 min), `consumed_at` | **Written by the worker's free preflight,** never computed by the web. Single use: consumed in the same transaction that creates the job and the reservation. Bound to one user, one exact parameter set, the worker commit that priced it, both fact fingerprints and the price table ([§6.1](#61-a-price-ceiling-confirmation-before-every-paid-action)) |
| `studio_spend_ledger` | `id`, `entry` (`reserve` \| `release` \| `overrun`), `run_id`, `amount_usd`, `day_local`, `month_local`, `created_at` | Append-only (retention aside). Every entry of a run is booked to the day and month of its `reserve` entry, even when it is written after midnight. Day and month are in `America/New_York` (TO VERIFY that the owner wants shop-local time). **Spend for a day is Σ`reserve` − Σ`release` + Σ`overrun`** over that day's entries. For a finished run this equals its actual cost; for an unfinished one it is its full reservation |
| `studio_jobs` | `id`, `run_id` (unique), `kind` (`preflight` \| `paid` \| `fake`), `state`, `created_at`, `expires_at`, `claimed_at`, `heartbeat_at`, `cancel_requested_at`, `worker_commit` | One job per run. No `attempts` column: a job is never retried ([§5.3](#53-the-job-queue)). A queued job past `expires_at` is never started |
| `studio_worker_heartbeat` (singleton) | `commit`, `schema_version`, `approved_facts_sha256`, `approved_facts_tag_counts` (jsonb), `price_table_sha256`, `beat_at` | Written only by the worker. The web reads the tag counts and fingerprints from here, so the web never loads the fact files or the pricing code itself |

### 4.7 Retention and backup

**PROPOSED defaults, each for the owner to confirm ([§11](#11-open-questions-and-accepted-limitations)):**

| Data | Kept |
|---|---|
| Runs, artifacts, requests, findings | Until the owner deletes a run. Deletion is owner-only and audited. It removes the artifacts and findings, keeps a tombstone row, and keeps the run's ledger entries |
| Fact versions | While any run references them; a retired, unreferenced version may be deleted by the owner |
| Sessions, login attempts | Purged 30 days after expiry, and 1 day after expiry, respectively |
| Audit log, spend ledger | Two years (proposed); never edited |

**Backup is UNKNOWN / TO VERIFY.** Render's backup and point-in-time recovery depend on the
database plan. S8 records what the chosen plan provides. Before the first live run, the owner
performs one restore drill: restore into a new, disposable Render database, open it read-only, and
delete it. A Studio restore has no external side effects to reconcile: nothing was published, no
Slack message was sent, and the only external effect is model spend, which the ledger records.

---

## 5. Run execution

### 5.1 One pipeline library for the CLI and the worker

**PROPOSED (S1).** The pipeline core now in `scripts/local/content-run.mjs` (**VERIFIED**, 2,102
lines) moves into a TypeScript library, `src/harness/contentRun/**`, compiled with the rest of
`src/`. Both callers use it:

- **the CLI** keeps argument parsing, the typed `LIVE` prompt, console output and file writing;
- **the worker** supplies database writes and a pre-confirmed quote.

The library exposes:

- `buildRunEvidence`: loads the records, applies the scope, and builds and validates the pack.
  Today's automotive-facts loader becomes `parseAutomotiveFacts(bytes)` with the same required-field
  checks, plus a path wrapper for the CLI.
- **The six-stage sequence:** `runFullPipeline`.
- **The saved-run paths:** `verifySourceRun`, `resumeFromPackaging`, `replayCritic` and
  `reviseRun`.
- **The shared fakes and measurements:** the fake-runner builders and the field measurements.
- **Pricing:** the cost-ceiling computation, as data. The CLI prints it; the Studio shows it.

Output goes through a `RunSink` interface (`writeArtifact(name, bytes)`, `recordRequest(…)`). The
paid-action gate is an injected `PaidActionConsent`. The library calls it **after every free check
and after pricing, and before the first request**, the same position `requireLiveConsent` holds
today (**VERIFIED**). The CLI's consent is the cost flag plus the typed word `LIVE`. The worker's
consent is a consumed quote with a live reservation ([§6](#6-cost-controls)).

**The CLI keeps working, unchanged in behaviour.** Every flag stays with its meaning and its refusal
combinations:

- `--runner fake|live` and `--i-understand-this-costs-money`;
- `--replay-critic`, `--resume-from packaging-adaptation`, `--revise-from` and `--revise-once`;
- `--scope-tags` and `--list-tags`;
- `--automotive-facts`, `--platforms`, `--out-dir` and `--reviewed-at`.

Fake mode, which is the default, makes no network call. The files written, their names and bytes,
and `run-meta.json`'s schema stay the same. S1's own validation ([§10](#10-the-pr-sequence-and-the-owner-actions))
proves it.

### 5.2 Every existing fail-closed check runs unchanged on the worker

**PROPOSED, and a hard requirement on S1 and S3.** The worker gets these checks by calling the same
library functions, not by re-implementing them:

- **source verification** (`verifySourceRun`): all three fingerprints, the recorded scope, and
  every saved stage output revalidated through its owning validator; in revision mode, the saved
  critic panel re-proved lens by lens;
- **the fingerprints** recorded in `run-meta.json`;
- **the free preconditions before the cost gate:**
  - a live run refuses an absent or incomplete automotive-facts input;
  - every stage's `requiredEvidenceKinds` is checked across all six stages;
  - the contact-line and identity records are checked, as is the scope refusal;
- **the payload contract,** `MAX_PAYLOAD_CHARS` and every guard;
- **the revision caps** (69 / 80 / 31) and the `RevisionCapError`;
- **the contact-in-overlay check** (`overlayContact.ts`, `MERGED` through PR #101). It runs inside
  `validateProductionDirectionOutput`, so it applies to a live stage 4 response and to every
  revalidation.

**One interactive confirmation cannot run on a worker, so it becomes a refusal.**

- **VERIFIED:** `verifySourceRun` asks the operator to type `UNPROVEN` before it continues from a
  source run that predates the automotive-facts fingerprint (`content-run.mjs`, around line 1520).
- S1 injects that confirmation into the library, as it does the paid-action consent. The CLI keeps
  the prompt, and the worker's implementation **always refuses**.
- The Studio therefore never continues on an unproven facts file. That is a narrowing, not a
  relaxation.

**The worker adds checks, and never removes or relaxes one.** The only new gate between the free
checks and the first paid request is the quote and reservation check in
[§6](#6-cost-controls). A refusal before the cost gate records the run as `refused`, with the
library's own error message and no reservation.

### 5.3 The job queue

**PROPOSED (S3).** It reuses the live worker's proven patterns, not its code or its lock.

- **A single consumer.** The worker holds a PostgreSQL **session-level advisory lock** on a
  Studio-only key, derived from the namespace `gcd-studio:worker-ownership:v1`, on a dedicated
  connection for its lifetime. **VERIFIED:** the live key `(1889446263, 889784911)` must not be
  reused ([Data model](DATA_MODEL.md)); the Studio's is a different key in a different database.
  A worker that does not hold the lock consumes nothing and emits no readiness.
- **Locking.** A job is claimed on the ownership session with `FOR UPDATE SKIP LOCKED`, so a claim
  cannot commit after ownership is lost. One job runs at a time. Queued `preflight` jobs, which are
  free and short, are claimed before queued `paid` jobs, so a check never waits behind a long run.
- **Version skew.** At startup the worker refuses to run unless the database's Studio schema version
  equals the one its code expects. At claim time it refuses a paid job whose quote names another
  worker commit, approved-facts sha256, fact version or price table. The release checklist deploys
  the web service (which runs the migrations) first, then the worker.
- **Expiry.** A queued job expires one hour after creation (PROPOSED). An expired job is never
  started; its run becomes `cancelled` and its reservation is released.
- **Timeouts.** Every stage request already has its own budget-derived stream deadline
  (**VERIFIED**, `sdk.ts`). A job also has a wall-clock limit, the sum of its requests' deadlines
  plus a margin. A job over that limit terminalizes as `failed`
  (`failure_class: job_timeout`).
- **Cancellation.** It is cooperative and checked between requests: a user presses Cancel, and no
  further request starts. **A request already in flight is not cancelled.** The critic panel's four
  lens requests are one unit. A cancelled run is `cancelled`. Its completed requests and their
  cost are kept, and its unused reservation is released. Cancelling a **queued** job cancels it
  before it is claimed and releases its whole reservation.
- **Restart recovery: refuse, don't resume.** At startup, after acquiring ownership, the worker
  terminalizes every `running` job as `interrupted`. It reconciles its reservation from the
  durably recorded `studio_run_requests` rows: a request with a `started` row but no completed one
  is charged at its full ceiling. It resumes nothing, matching the live worker's
  posture. The owner may then start a resume or revise from what was saved, as a new, separately
  priced run.
- **Idempotency.** A quote is single use and is consumed in the same transaction that creates the
  run, the job and the reservation. Pressing "Confirm" twice therefore creates one run. A job is
  never retried, and no provider request is retried. **VERIFIED:** the stage boundary sets
  `maxRetries: 0`.

### 5.4 `executionEnabled` and the registry — how the Studio worker may call stages

**VERIFIED:**

- **`executionEnabled` is consulted in exactly one production-source place:** the preview's
  `executionDisabled` summary in `src/harness/contentIntelligence.ts` (line 188), which
  `assertPreviewIsInert` asserts.
- **No executor reads it,** and neither does `invokeStage` (production-wiring design §1.3).
- **The CLI already calls all six executors today with the flag `false`.** It constructs an
  `AgentRegistry`, calls `verifyAllAssets()`, reads each stage's `requiredEvidenceKinds`, and passes
  the registry and a runner (from `createAnthropicStageRunner()`, or a fake) into the executors.
  `buildStagePlan` copies `executionEnabled` into the preview's stage plan, but nothing on that path
  gates on it.

So **the Studio worker can call the stages exactly as the CLI does, without changing any registry
entry, any `executionEnabled` value or any guarded invariant.**

What the dormancy regressions protect, and why the Studio leaves each intact (**VERIFIED** in
`src/harness/contentIntelligence.selftest.ts`):

| Protected property | Checks | Studio effect |
|---|---|---|
| Every registry entry reports `executionEnabled: false` | `AF4`, `AQ17`/`AQ20` and the per-stage equivalents, `CC25` | None. No entry changes |
| Fixed live files do not name an executor | the `AQ18a`–`AQ18h` family for `automotive-truth` (scheduler, orchestrator, approval, publication, image/Slack, API/preview, worker, database/evidence-write paths), and the per-stage equivalents for the other five executors | None. No listed file changes, and `src/studio/**` is not on those lists |
| The preview is inert | `assertPreviewIsInert`, the bound HTTP suite | None |

**What does change, stated plainly.** The production-wiring design rests dormancy on two structural
facts:

1. no production path in this repository calls any executor;
2. no executor has a default runner.

The Studio worker is a deployed caller, so fact 1 **narrows**. It becomes: "no path in the live
`gcd-social-*` services calls any executor". Fact 2 is unchanged. That narrowing is exactly the
situation the production-wiring design §1.3.1 addresses when a caller first appears: the fixed-file
checks are smoke checks and "are not adequate protection for a design that has one".

**PROPOSED — the smallest safe addition, which weakens nothing (S1, extended in S3):**

1. **A transitive import-graph check.** From each live entry point (`dist/api/server.js`,
   `dist/worker/index.js`, `dist/scheduler/daily.js`, `dist/state/migrate.js`,
   `dist/harness/evidence/syncCli.js`, `dist/harness/dryrun.cli.js`), no path may reach any of these:
   - the six executor modules;
   - `stageExecution.js`, `revision.js`;
   - `src/harness/contentRun/**`, `src/studio/**`.

   **VERIFIED today** by a relative-import walk of the compiled `dist/` at `f111012`: none of those
   six entry points reaches any executor, `stageExecution.js`, `revision.js`, `contactLine.js` or
   `overlayContact.js`. The check is written so that an intermediary module cannot defeat it, which
   is the gap §1.3.1 names.
2. **An allowlist of callers.** Only `scripts/local/content-run.mjs` and `src/studio/worker/**` may
   import `src/harness/contentRun/**`. Nothing under `src/studio/web/**` may import it, or
   `stageExecution`, or any executor, or the fact loader, or the pricing code. The web service
   therefore has no code path to a model, as well as no key. Everything the web shows that needs
   those modules is computed by the worker and stored: quotes, revision plans, tag counts and
   fingerprints.
2a. **A shared-module diff guard.** The library uses modules the live services already load:
   `sdk.ts`, `config.ts`, `payloadContract.ts`, `modelPolicy.ts`, `registry.ts`, `pack.ts` and
   `approvedFacts.ts`. An edit to any of these changes a live artifact even if nothing new is
   reachable. For example, S1 may need `sdk.ts`'s `PRICE` table exported. So S1 adds a CI check
   that lists every module the live entry points load, and fails a Studio PR that edits one unless
   the PR names the edit as a live-path change, reviewed as such.
3. **Executed tests** that the Studio web's paid-action routes, with no confirmed quote, reach no
   runner (zero runner invocations). This is proven by running the route, not by reading source.

**A future conflict, recorded for the owner to decide, not resolved here.** The production-wiring
design's **P2** proposes checkpoint **C2**, which makes `invokeStage` refuse unless **both**
`executionEnabled` is `true` **and** the live runtime authority gate permits. It also proposes
checkpoint **C3**, which has the `sdk.ts` request boundary re-read that gate immediately before
each provider request. If P2 merges as written, it would stop the Studio
worker, **and it would equally stop today's local CLI**, because neither sets `executionEnabled` or
consults a live authority gate. So whichever comes first, the P2 implementation PR or the Studio's S3, must name
an explicit, separately reviewed **review-only execution context**. That context would be a
capability that only the CLI and the Studio worker construct. It could never approve or publish,
it would satisfy C2 and C3 explicitly, and it would sit beside the live authority gate, not instead
of it. This design does not change
P2, and it does not propose widening `executionEnabled`.

---

## 6. Cost controls

### 6.1 A price-ceiling confirmation before every paid action

**PROPOSED, replacing the typed `LIVE`.** A paid action takes four steps:

1. **Every free check runs first** on the worker's code, through a free "preflight" job that makes
   no request. It covers the fingerprints, the scope, the evidence classes, the contact and
   identity records, and source verification for a revise, replay or resume. A refusal is shown
   with its reason and costs nothing.
2. **The worker's preflight writes a quote,** and the web shows it. The quote carries the ceiling
   for **exactly the requests this action will make**, one line per request: the model, the maximum output tokens, and the estimated dollars. The
   numbers come from the same computation as the CLI's `printCostCeiling`. **VERIFIED:** it is
   described as "rough, not billing-accurate". It estimates input at four characters per token of
   `MAX_PAYLOAD_CHARS` and prices each request's `max_tokens` at the model's output price. The
   quote shows the total, the caps remaining today and this month, and an expiry.
   - **A model with no price row makes no quote.** The preflight refuses, because an unknown price
     cannot be reserved.
   - **The critic's four lenses are one item,** priced as four concurrent requests whose summed
     ceiling must fit, because they run together (**VERIFIED**: `Promise.allSettled` in
     `finalCritic.ts`).
3. **The user confirms the displayed amount** by a deliberate button press on the quote screen. The
   confirmation posts the quote id. The web **does not recompute** the price, because it has no
   pricing code. It refuses if:
   - the quote is expired, used or someone else's;
   - its fingerprints and worker commit differ from the worker's current heartbeat;
   - the user's role or status changed;
   - any cap would be exceeded.
4. The job, the run and a `reserve` ledger entry equal to the ceiling are created **in one
   transaction** with the quote's consumption. That transaction first takes
   `SELECT … FOR UPDATE` on the `studio_settings` row, which serializes every confirmation. Two
   users confirming at once therefore cannot both pass the cap check against the same headroom.

`--revise-once`'s second prompt becomes a second quote. The revision round is priced after round 1
from the requests it will actually make, as the CLI does today (**VERIFIED**).

### 6.2 Daily and monthly caps — enforced before every paid call

**PROPOSED.** Spend is capped at three levels:

- **the owner's caps:** a daily cap, a monthly cap and an optional per-user daily cap, all in
  `studio_settings` and `studio_users`;
- **the deployment-time ceilings** `STUDIO_MAX_DAILY_USD` and `STUDIO_MAX_MONTHLY_USD`, set on the
  web and the worker;
- **the effective cap:** the **lower** of the owner's cap and the deployment ceiling, so a
  compromised owner session cannot raise spend past the deployment ceiling.

Caps are enforced in code at two points:

1. **at confirmation** (the web), under the settings-row lock: the day's and the month's spend (the
   ledger formula in [§4.6](#46-audit-log-quotes-and-the-spend-ledger)) plus this quote's ceiling
   must be at or below each effective cap;
2. **before every paid request, or before the critic panel as one unit** (the worker), through the
   check the `PaidActionConsent` performs. It re-checks everything independently of the web, so a
   compromised web process or a row written directly cannot buy a request:
   - the run's reservation is live, and the job is not cancelled;
   - the ceiling the library computes **now**, for the requests still to make, fits what remains of
     the reservation;
   - the run's cumulative charged cost (actual, or full ceiling where unknown) is inside the
     reservation;
   - the ledger, re-summed by the worker, is within the worker's own `STUDIO_MAX_DAILY_USD` and
     `STUDIO_MAX_MONTHLY_USD`.

   A missing, unreadable or unparsable cap is treated as **zero**, which fails closed.

**Reservation, then reconciliation.** Each completed request writes its measured cost to
`studio_run_requests`, and the running total is compared with the reservation.

- **If the ceiling held,** the run ends with a `release` entry for the unused part of its
  reservation, leaving its actual (charged) cost booked.
- **If the ceiling was exceeded,** which is possible because the ceiling is an estimate, the run
  starts no further request and terminalizes as `failed` (`cost_ceiling_exceeded`). An `overrun`
  entry is recorded, and every new confirmation is refused until the owner acknowledges it.

**A consequence the owner must know.** **VERIFIED** ([Security and continuity](SECURITY_AND_CONTINUITY.md)):
a full run's printed ceiling is about **$21.65**. The owner's measured full runs cost about **$1.17**
([Status](STATUS.md)). A daily cap below one run's ceiling therefore blocks every full run, even
though the actual cost would fit. The default caps are an owner decision
([§11](#11-open-questions-and-accepted-limitations)).

### 6.3 Who may start a paid run

**PROPOSED.** Only an active `owner` or `runner` can request a quote or confirm one. Fake runs, which
are wiring tests, are `owner`-only. They make no request and need no quote, and they are labelled
"FAKE — wiring test" on every screen.

### 6.4 What was spent, shown plainly

**PROPOSED.** Every run report shows the reserved ceiling, the measured actual cost, and a
per-request table: stage or lens, model, input and output tokens, and cost. A spend panel shows
today and this month against each cap, per user, with every overrun. Costs are what `sdk.ts`'s
`costUsd` computes: the provider-reported token usage times the repository's own price table, which
`sdk.ts` itself calls rough and not billing-accurate. These are the same numbers the owner reports
from local runs today. They are not Anthropic
invoice figures. Reconciling against the Anthropic console is TO VERIFY and manual.

### 6.5 The provider-side backstop

**PROPOSED owner action.** Create the Studio's `ANTHROPIC_API_KEY` in a separate Anthropic
workspace with its own monthly spend limit (TO VERIFY that the owner's Anthropic organization
offers this). The Studio's caps are then not the only limit, and the live worker's key is never
shared with the Studio.

---

## 7. Authentication

### 7.1 Google OpenID Connect

**PROPOSED (S4).** The authorization-code flow with PKCE (S256), `state` and `nonce`:

1. **`GET /auth/login`** creates a login attempt: `state` and `nonce` stored as hashes, the PKCE
   verifier as issued, 10 minutes, single use. It sets
   the short-lived `__Host-gcd_studio_login` cookie (Secure, HttpOnly, SameSite=Lax) and redirects
   to Google with `scope=openid email profile` and `hd=germancardepot.com`, a UI hint only.
2. **`GET /auth/callback`** checks `state` against the cookie and the stored hash, then exchanges
   the code with the client secret and the PKCE verifier. It then verifies the ID token
   **server-side**:
   - the RS256 signature against Google's published keys (JWKS), cached per its headers;
   - `iss` is `https://accounts.google.com` or `accounts.google.com`;
   - `aud` equals `STUDIO_GOOGLE_CLIENT_ID`;
   - `exp` and `iat` are within a small clock skew;
   - `nonce` matches the stored one;
   - **`hd` equals `STUDIO_ALLOWED_HD`;**
   - **`email_verified` is `true`;**
   - the lower-cased `email` ends `@germancardepot.com`;
   - an **active** `studio_users` row exists for that email, and, once set, the same `google_sub`.
     The one exception is the bootstrap in [§7.2](#72-allowlist-and-roles), which creates that row.

   Any failure shows one generic "not authorized" page, writes an audit row naming the reason class
   but not the token, and creates no session. The `hd` claim is the control; the `hd` URL
   parameter is a hint that the design does not rely on.
3. **The library is `jose`** (PROPOSED; exact version pinned, audited in S4) for JWT and JWKS
   verification. It is used instead of hand-written signature code, because the signature check
   is the load-bearing step. The dependency lands in `package-lock.json`, which the live services
   also install. S4 records it, and `npm audit --omit=dev` must stay at zero.

### 7.2 Allowlist and roles

**PROPOSED.** Signing in requires an owner-created allowlist entry. There is no self-registration.

- **Bootstrap.** While no `owner` row exists, a sign-in that passes every other check, and whose
  verified email equals `STUDIO_BOOTSTRAP_OWNER_EMAIL`, creates that user's row as `owner`. The
  variable is ignored once an owner exists.
- **Owner lockout.** Suppose the only owner is disabled by accident or loses their account. No
  in-app path recovers from that, by design. Recovery is a database-level act by whoever holds the
  Render account: a single audited statement through Render's database access (TO VERIFY), recorded
  as an accepted limitation.
- **Managing users.** The owner adds, disables and changes roles on the Users screen. Each change is
  audited, and disabling a user revokes their sessions at once.

### 7.3 Sessions, CSRF and logout

**PROPOSED.**

- **Session cookie:** `__Host-gcd_studio_session`, holding 32 random bytes and stored only as a
  sha256. It is Secure, HttpOnly, SameSite=Lax, `Path=/`, and has no `Domain`. SameSite=Lax (not
  Strict) is chosen so a link to a run opened from email or chat still carries the session on a
  top-level GET. Every state-changing request is protected separately (below).
- **Lifetime:** 12 hours idle and 7 days absolute. The session id is rotated at sign-in.
- **CSRF:** a per-session synchronizer token, sent in a hidden form field or a header and compared
  with its stored hash. **Also**, the `Origin` header must equal `STUDIO_PUBLIC_ORIGIN` on every
  `POST`. State never changes on a `GET`.
- **Rate limits:** `GET /auth/login`, the callback and failed sign-ins are rate-limited per client
  address, in-process (the web is one instance). Unconsumed login attempts expire and are purged.
- **Logout:** a `POST /auth/logout` with CSRF protection. It revokes the session row and clears the
  cookie. The owner can revoke any user's sessions.
- **No shared tokens and no credentials in URLs.** No console token, no bearer URL, and no token in
  any query string. **VERIFIED** contrast: the live approval link is a bearer URL, recorded as a
  transitional risk in [Security and continuity](SECURITY_AND_CONTINUITY.md). The Studio does not
  repeat that pattern.
- **Headers:**
  - a strict `Content-Security-Policy`: `default-src 'self'`, no inline script, `frame-ancestors 'none'`;
  - `Strict-Transport-Security`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`;
  - no CORS.

### 7.4 The Google Cloud OAuth client — a manual prerequisite

**UNKNOWN / TO VERIFY; owner action O1.** The owner creates, in a Google Cloud project owned by the
`germancardepot.com` Google Workspace organization:

- an OAuth consent screen of user type **Internal**, which restricts sign-in to the organization's
  accounts (TO VERIFY that this is available for the organization);
- a **Web application** OAuth client whose only authorized redirect URI is
  `<STUDIO_PUBLIC_ORIGIN>/auth/callback`.

The client id and secret go only into the Render dashboard, as `STUDIO_GOOGLE_CLIENT_ID` and
`STUDIO_GOOGLE_CLIENT_SECRET`. They are never pasted into chat, an issue or this repository. This
client is separate from the live GBP OAuth client.

---

## 8. Screens

**PROPOSED (S5–S7).** Server-rendered HTML with one small static script for the Copy buttons and
confirmations. Every model-written string is HTML-escaped on output, and nothing is inserted as raw
HTML. **The layout works on a phone:**

- a single column below 700 px;
- tap targets of at least 44 px;
- no horizontal scroll;
- captions in a monospace-free, wrapping block with the Copy button directly beneath.

### 8.1 Runs list

Newest first. Each row shows:

- when the run was requested, and by whom;
- the goal, truncated;
- the kind (full, revise, replay, resume or import);
- the state, the verdict and the blocking / advisory finding counts;
- the actual cost;
- a "not revalidated" badge on an `archived_unverified` import;
- a "FAKE" badge on a fake run.

The list can be filtered by state, kind and requester. A queued or running row updates by polling;
there is no live socket.

### 8.2 Run report

In this order:

1. **Header:** the goal, the platforms, the scope tags, the kind, the state, the verdict and
   the lineage, as links to the parent and child runs. It also shows the fact version, the three
   fingerprints (short form, with the full value on tap) and the commit.
2. **Captions, one card per platform.** Each card shows the caption, then the deterministic contact
   line. Google Business Profile shows its `BOOK` call to action, as the CLI's `summary.md` shows
   it. Then come the hashtags and the local keywords.
   - A **Copy** button copies exactly the text the owner pastes, assembled by the same code that
     assembles the contacted package (`contactLine.ts`), never re-implemented in the page. For
     Instagram and Facebook that is the caption, the separator, the hashtags and the contact line.
     Google Business Profile has no contact text, only the `BOOK` call to action, so its card
     copies the caption and shows the booking call to action as a separate item.
   - The Copy buttons are disabled on an `archived_unverified` import.
   - A second button copies the caption alone.
   - A banner states that the contact line is copied from approved facts, not written by a model,
     and that nothing here is approved or scheduled.
3. **Script:** the hook, the beats and the script.
4. **Shot list:** each shot, its overlays and the production requirements. Requirements are marked
   `availabilityVerified: false` in plain words: "to be confirmed by a person".
5. **Findings,** grouped **by stage owner** (stages 3, 4 and 5) and, within each, **blocking first,
   then advisory**, with the lens, category and issue. A toggle groups them by lens instead.
6. **Needs your decision,** a separate section: every finding owned by `human_review`, and every
   `human_decision` finding. These are exactly the findings the revision pass never sends to a
   model (**VERIFIED**, `planRevision`). They are shown first on a phone if any exist.
7. **Cost:** the reserved ceiling, the actual cost, and the per-request table
   ([§6.4](#64-what-was-spent-shown-plainly)).
8. **Files:** download any artifact, or the whole run as one JSON bundle in the import format of
   [§8.6](#86-import-of-existing-local-output-runs). Every download is served with
   `Content-Disposition: attachment`, a `text/plain` or `application/json` type, `nosniff` and a
   sandboxing CSP. So no stored model text or imported content is ever rendered as a page on the
   Studio's origin.

A failed or refused run shows the library's error message, the stage it stopped at, and whatever
it saved (for example `rejected-responses.json`). It also offers **Resume from packaging** when the
failure was at stage 5, as the CLI allows.

### 8.3 New run

For an `owner` or a `runner`:

- **Goal:** a text area, 1 to 2,000 characters, as the live trigger bounds it.
- **Platforms:** check boxes over `instagram`, `facebook` and `google_business_profile`, all
  checked by default (**VERIFIED**, `PACKAGING_PLATFORMS`).
- **Scope tags:** chosen from the pack's tag list. This is what `--list-tags` prints today: each
  tag with its record count, no claim text (**VERIFIED**). It is computed from the active fact
  version plus `config/approved-facts.json`; the worker computes the counts and the web reads them.
  The screen shows how many records the chosen scope would include against the 64-record cap. It
  refuses an over-cap choice before any quote, as the CLI's own pack cap already would. An unscoped
  run is allowed, as in the CLI, whenever the whole pack fits the cap.
- **Review time:** the run records the approved-facts review time exactly as the CLI's
  `--reviewed-at` default does: the run's own instant. It is written to `run-meta.json`.

Then **Check** runs the free preflight and **Get price** shows the quote
([§6.1](#61-a-price-ceiling-confirmation-before-every-paid-action)).

### 8.4 Revise, and critic replay

From a succeeded run's report, for an `owner` or a `runner`:

- **Revise** shows the plan before the quote: which stage the round starts at, which stages re-run,
  which findings go to each stage, which advisory findings are dropped over a cap, and which items
  are held back for the owner. The plan comes from `planRevision` on the worker, in the free
  preflight. If no revisable blocking finding exists, the screen says so and offers no quote.
- **Critic replay** re-runs the four lenses only, priced as four requests.

Both create a child run, and the source run is never modified.

### 8.5 Fact-file upload (owner only)

1. The owner uploads one JSON file, up to 1 MB (PROPOSED bound). Until it is validated, the bytes
   are held in a single owner-only staging row (`studio_fact_uploads`), never in
   `studio_fact_versions`.
2. The worker validates it with the **existing loader**: the same required fields
   (`id, claim, subject, tags, sourceType, sourceRef, provenance, reviewedAt`) and the same
   `facts`-array shape (**VERIFIED**, `loadAutomotiveFacts`). The loader ignores unknown fields,
   and so does the Studio. Refusing them would force the owner to edit the file, which would
   change its sha256 and orphan every local run already fingerprinted against it. Unknown field
   names are listed to the owner as a warning instead. It then builds and checks a pack with
   `buildEvidencePack` and `assertUsableEvidencePack` over the uploaded records plus the approved
   facts, as a dry run.
3. On success the Studio stores the exact bytes and their sha256. It shows the record count and the
   tag counts, never claim text, and the owner may then mark the version active.
4. A refusal shows the loader's own message, and the staging row is deleted. Nothing reaches
   `studio_fact_versions`.

Only the owner can download a version's bytes. Other users see its sha256, date, uploader and tag
counts.

### 8.6 Import of existing `local-output` runs

The owner picks one run folder from `local-output/content-intelligence/` in the browser. The page
reads the **known file names only** client-side. It posts them as one bounded JSON document
(PROPOSED: at most 20 files and 10 MB), with each file **base64-encoded and accompanied by its
sha256**, so no byte-order mark, line ending or invalid UTF-8 is altered on the way. The server
recomputes every sha256 and refuses a mismatch or an unknown name. No archive format and no new
parsing dependency is involved.

An imported `run-meta.json` may record an absolute path from the owner's computer. The bytes are
kept exactly, because the fingerprints depend on them, but the screens show only the file's base
name.

The worker then revalidates it with the **existing verifiers**. It runs `verifySourceRun` in
revision mode against:

- the approved-facts file at its deployed commit;
- the fact version whose sha256 the folder's meta file names.

If both match and every saved output revalidates, including the saved critic panel lens by lens,
the import is `verified`. Otherwise it is `archived_unverified`, with the refusal reason
([§4.5](#45-imported-legacy-runs)). A revised folder keeps its lineage when its source was imported
first.

### 8.7 Users and caps settings (owner only)

- **Users:** add by email, set the role (`owner`, `runner` or `viewer`), set a per-user daily cap,
  disable, and revoke sessions.
- **Caps:** daily and monthly caps, shown beside the deployment ceilings that bound them.
- **Other settings:** the active fact version, a read-only view of the audit log, and
  `scheduled_runs_enabled`. That setting stays unavailable while the cron resource does not exist.

---

## 9. Security and privacy

### 9.1 Threat model

**PROPOSED.**

| Threat | Control |
|---|---|
| An outsider signs in | Google OIDC with `hd`, `email_verified` and the domain checked server-side, plus an owner-managed allowlist |
| A staff member escalates their role | The role is checked server-side on every route. The database refuses removing the last owner. Every change is audited |
| A stolen session cookie | Secure, HttpOnly and `__Host-` cookie; idle and absolute expiry; revocation on logout, disable or owner action |
| Cross-site request forgery | Synchronizer token plus an exact `Origin` check. No state change on `GET` |
| Stored XSS through model prose (captions, findings) or a goal | All output escaped, a strict CSP with no inline script, no raw-HTML rendering. Downloads are served as attachments with `nosniff` and a sandboxing CSP ([§8.2](#82-run-report)) |
| A compromised web process writes rows directly (a consumed quote, a reservation, a job) | The worker re-checks every quote binding, the ceiling, the reservation and its own deployment ceilings before each paid request ([§6.2](#62-daily-and-monthly-caps--enforced-before-every-paid-call)). PROPOSED for S2: a least-privilege database role for the web that cannot alter triggers or write the ledger outside the confirmation function; TO VERIFY that Render's plan allows a second role. Until then, the web holds the database owner's credential, and this is an accepted limitation |
| Prompt injection through the goal | As today: the goal reaches models only as a labelled untrusted data block, and every output is validated by id (**VERIFIED**) |
| Runaway spend | Quotes, caps, reservation and reconciliation, overrun lock-out, deployment ceilings, and the provider-side workspace limit |
| The Studio publishes | Structurally impossible: no provider credential, no posting module ([§1.3](#13-non-goals)), and an import-graph test |
| The Studio reaches the live database | It holds no live URL, and it is a separate database. The Studio's own database has no external access (`ipAllowList: []`, TO VERIFY semantics) |
| Theft of the Anthropic key | It is set on the worker only. The worker serves no HTTP, and the web service holds no key and no path to a model |
| A malicious fact upload | Owner-only, size-bounded, validated by the existing loader and the pack's semantic validator, and pinned by sha256 |
| A malicious import | Owner-only, bounded, and treated as untrusted. It never becomes a paid action's source unless it revalidates completely |
| Server-side request forgery | The web makes outbound calls only to Google's fixed OIDC endpoints, and the worker only to the Anthropic API |
| Leakage through logs | See [§9.2](#92-log-redaction) |

### 9.2 Log redaction

**PROPOSED.** Studio logs are structured lines carrying ids, states, classes, counts, durations and
costs.

- **They never carry:**
  - a goal, model text, fact text, an email address or a cookie;
  - a token, an OAuth code or an ID token;
  - the contents of the booking link;
  - an error message that may echo input.
- **Error messages** are stored in `studio_runs.failure_message` for authorized users. They are
  logged only by class.
- **Build and deploy logs** are unaffected, since secrets are `sync: false` and never printed.

The live controller's redaction ([Deployment control](DEPLOYMENT.md)) does not reach the Studio.
The Studio's rule is simpler: log no content at all.

### 9.3 The booking-URL token in approved facts

**VERIFIED:** `config/approved-facts.json` holds the shop's public booking link, a capability URL
carrying a token, which [Security and continuity](SECURITY_AND_CONTINUITY.md) records as public
business content. The contact line copies it into Facebook text and the Google Business Profile
call to action (**VERIFIED**, `contactLine.ts`). The Studio therefore stores it inside run artifacts
and shows it to signed-in users, because the owner must paste it.

**PROPOSED:**

- the Studio never logs it;
- it never places it in a URL, a quote or an audit row;
- no test or fixture copies it beyond what `config/approved-facts.json` already holds (tests use
  synthetic `.test` hosts, as PR #101's tests do).

This design does not reproduce it.

### 9.4 No customer data

**PROPOSED, and an invariant.** The Studio stores no customer data. Its inputs are:

- the owner's goal;
- the approved business facts;
- the manufacturer facts file;
- model output.

The fact loader's fields are sourced claims, not customer records. The Tekmetric probe
(**VERIFIED**, [Roadmap](ROADMAP.md)) and every other customer-data source are out of scope. S7's
upload screen lists every field name outside the loader's known set as a warning before the owner
activates a version. That way a stray export is noticed without the loader being made stricter than
the CLI ([§8.5](#85-fact-file-upload-owner-only)).

### 9.5 What the Studio database holds, and who can read it

| Data | Readable by |
|---|---|
| Users, roles and sessions (hashed) | The owner (users); nobody (session values) |
| Fact-file versions | Bytes: the owner. Metadata and tag counts: all signed-in users. Cited claims appear inside run artifacts, readable by everyone who can read the run |
| Runs, artifacts, findings, costs | All signed-in users (`viewer` and up) |
| Quotes, ledger, caps | All signed-in users see spend. Only the owner changes caps |
| Audit log | The owner |
| Anthropic key | Nobody in the database; it is a worker environment variable only |

**Database-level access.** Render's database credentials are held by the owner's Render account,
and by the two Studio services through `fromDatabase` (TO VERIFY that no other service is given
them). External connections are refused (`ipAllowList: []`, TO VERIFY). This deliberately differs
from the live database's `0.0.0.0/0`.

---

## 10. The PR sequence and the owner actions

**PROPOSED.** The PRs are serial: each starts from `main` after the previous one merges. Each needs
its own authorization and follows [`AGENTS.md`](../AGENTS.md)'s documentation and validation rules.
Each runs the repository's full validation:

- build, typecheck and `npm run test:offline`;
- the payload-contract mutation harness where its targets change;
- the simulated dry run and the deployment-controller fixtures;
- Markdown links, environment coverage, the sensitive scan and `npm audit --omit=dev`;
- `git diff --check`;
- CI's five jobs on attempt 1.

The names S1–S9 are new, so they cannot be confused with the production-wiring design's P1–P8.

| # | Scope | Validation specific to it | Touches a live path? |
|---|---|---|---|
| **S1** | **Library extraction.** `src/harness/contentRun/**` takes the CLI's core. The CLI becomes a thin shell with every flag unchanged. The import-graph check and the caller allowlist from [§5.4](#54-executionenabled-and-the-registry--how-the-studio-worker-may-call-stages) land here. Mutations that target `content-run.mjs` are re-pointed at the moved code, each with the same expected checks | Offline counts **unchanged, plus the new checks**. Every existing CLI check keeps its name and its result. **A fake-runner golden test:** full, `--replay-critic`, `--resume-from`, `--revise-from` and `--revise-once` runs write byte-identical files before and after (timestamps pinned). `--list-tags` and every refused flag combination behave identically. Mutation count and captured paths recorded. The shared-module diff guard ([§5.4](#54-executionenabled-and-the-registry--how-the-studio-worker-may-call-stages), item 2a) lands here | No live service is redeployed. It adds new `dist/` modules that nothing live imports, as proven by the check. **Any edit to a module the live services load** (for example exporting `sdk.ts`'s price table) is a live-path change, named in S1 and reviewed as one |
| **S2** | **Studio schema and migrations.** `studio/migrations/0001_*.sql` and on, `src/studio/db/migrate.ts`, `npm run studio:migrate`, and the database identity checks and tripwire | Disposable PostgreSQL 16 and 18: apply, enforce every invariant in [§4](#4-data-model), and re-run idempotently. **The cross-runner refusals in [§3.7](#37-studio-migrations--kept-strictly-separate-from-the-live-migrations).** No `state/migrations/**` change | No |
| **S3** | **Worker and queue.** `src/studio/worker/**`: ownership, claim, recovery, heartbeat, the cancellation checks, the `RunSink` over the database, and the reservation and reconciliation primitives, with the check before each paid request | Offline and disposable PostgreSQL, with a **fake runner only**. Proofs: single consumer under contention; refuse-don't-resume after a kill; no request after cancel; cost recorded before the next request; overrun stops the run; zero runner calls without a reservation | No |
| **S4** | **Authentication.** `src/studio/web/**` skeleton: `/healthz`, OIDC login, callback and logout, sessions, CSRF, roles, bootstrap owner, security headers. Adds `jose` | A local fake OIDC issuer with its own keys proves refusal of: a wrong `hd`, `email_verified: false`, a wrong `aud` or `iss`, a bad signature, expiry, a replayed `state`, a nonce mismatch and an unlisted email; and one accepted path. CSRF and `Origin` refusals. Cookie attributes. Zero dependency-audit findings | No |
| **S5** | **Read-only screens.** Runs list, run report (Copy buttons, findings grouping, *Needs your decision*, cost), and file downloads | XSS: every model-text field rendered with hostile content stays inert. Role checks on every route. Phone-width layout checked in a headless Chromium at 375 px, with no horizontal scroll | No |
| **S6** | **Run and revise actions with caps.** New run, revise, critic replay and resume; free preflight, quotes, confirmation, caps, per-user permission, cancellation, and the spend panel | Executed tests: no quote, a wrong user, an expired or reused quote, a changed price, or a cap exceeded, each gives **zero runner calls**. A double confirmation creates one run. Revise-plan display matches `planRevision` | No |
| **S7** | **Fact upload and legacy import.** Owner-only upload with the existing loader, versions, the active pointer, and the import into `verified` or `archived_unverified` | Loader refusals shown. A pinned version survives replacement. A synthetic legacy folder imports `verified`; one with an older approved-facts hash imports `archived_unverified` and is refused as a paid source | No |
| **S8** | **`render.yaml` additions** for `gcd-studio-web`, `gcd-studio-worker` and `gcd-studio-db` (not the cron), with auto-deploy off, `sync: false` secrets and `ipAllowList: []`. The static forbidden-variable check. The Studio release checklist in [Operations](OPERATIONS.md). [Status](STATUS.md) and [README](../README.md) sentences that say `render.yaml` is unchanged since artifact `A` get updated | YAML parse and actionlint; the forbidden-variable check; the deployment-controller fixtures unchanged. **Entry gate: the Blueprint check in [§3.6](#36-applying-the-blueprint--a-gate-not-a-formality) is recorded, and the freeze gate below is resolved** | `render.yaml` changes. **The existing `gcd-social-*` blocks do not** |
| **S9** | **Cron, built disabled.** `src/studio/cron/**`, enqueue-only, with the double gate and the owner pre-authorization row. Not added to `render.yaml` | Refuses with either gate off. An unspent pre-authorization cannot exceed its per-run ceiling or the caps. No runner call from the cron process | No |

**Documents each PR must update**, beyond [Roadmap](ROADMAP.md), [Status](STATUS.md) and the root
[README](../README.md), under [`AGENTS.md`](../AGENTS.md)'s binding rule. This change adds only a labelled planned note to
Architecture and a validation record to Testing. Otherwise it leaves these documents as they are,
because they describe current reality:

| PR | Documents |
|---|---|
| S1 | [Architecture](ARCHITECTURE.md), [Testing](TESTING.md) |
| S2 | [Data model](DATA_MODEL.md), [Testing](TESTING.md) |
| S3, S4 | [Environment](ENVIRONMENT.md), `.env.example`, [Security and continuity](SECURITY_AND_CONTINUITY.md), [Testing](TESTING.md) |
| S5–S7 | [Testing](TESTING.md), plus [Security and continuity](SECURITY_AND_CONTINUITY.md) for S7's upload and import |
| S8 | [Deployment control](DEPLOYMENT.md), [Operations](OPERATIONS.md), [Environment](ENVIRONMENT.md), and a dated note in [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md) §4.4 and §5.1, where `gcd-social-api` is named as the only `preDeployCommand` |
| S9 | [Operations](OPERATIONS.md) |

**Owner actions, each named and separately authorized:**

| # | Action | When |
|---|---|---|
| **O1** | **Create the Google OAuth client** ([§7.4](#74-the-google-cloud-oauth-client--a-manual-prerequisite)) | Before the first sign-in; after `STUDIO_PUBLIC_ORIGIN` is known |
| **O2** | **Create the Studio's Anthropic key**, in a separate workspace with a spend limit ([§6.5](#65-the-provider-side-backstop)) | Before the first live run |
| **O3** | **Apply the blueprint:** the Blueprint check first, then the sync preview listing only `gcd-studio-*` resources ([§3.6](#36-applying-the-blueprint--a-gate-not-a-formality)) | After S8 merges and after the freeze gate |
| **O4** | **Set the secrets** in the Render dashboard: `STUDIO_GOOGLE_CLIENT_ID`, `STUDIO_GOOGLE_CLIENT_SECRET`, `STUDIO_BOOTSTRAP_OWNER_EMAIL`, `STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD`, and `ANTHROPIC_API_KEY` on the worker only | With O3 (Render may ask for `sync: false` values at blueprint creation; TO VERIFY) |
| **O5** | First manual deploy of an exact commit, first sign-in as bootstrap owner, add staff, set caps, upload the facts file, one restore drill | After O3 and O4 |
| **O6** | **The first live run:** one full run, confirmed at its displayed ceiling, its actual cost compared with a local run's | After O5; its own authorization |

**The release-freeze question is a gate.** **VERIFIED:** the M1→M2 partial-release interval is bound
at `2026-10-22T18:52Z`. Its standing prohibition reads "no unrelated release may occur, of any
service, for any reason" ([Status](STATUS.md)).

- **Default:** create the Studio services (O3) only **after the interval is closed**, or under
  whatever terms the owner's decision at the bound puts in force. The interval may be extended
  again, so "after the bound" alone is not enough.
- **Merging S1–S9 is not a release, on two conditions.** First, `deploy-production` must keep
  refusing at its disabled gate (**VERIFIED** on every merge so far). Second, Render native
  auto-deploy must stay off on all three live services. That was last verified on 2026-09-18
  ([Status](STATUS.md)), and the daily interval monitor does not cover it. Both are re-verified
  read-only before each Studio merge, and S8 must also pass the Blueprint auto-sync check.
- **Exception:** earlier only if the owner decides, in writing, that the freeze does not cover new
  services. That decision is recorded in [Status](STATUS.md) before O3.

The interval's expiry is itself a decision point for the owner, and its outcome may change this
gate.

---

## 11. Open questions and accepted limitations

### 11.1 Open questions for the owner

1. **Approve this design?** Studio PR 1 (S1) is the next repository change only after approval.
2. **One `render.yaml` or a separate Blueprint file?** Owner decision 2 says one `render.yaml`. This
   design **recommends amending it**: declare the Studio in a separate Blueprint file, or create it
   by hand from a checked-in specification
   ([§3.6](#36-applying-the-blueprint--a-gate-not-a-formality)). Whether or not the live services
   are Blueprint-managed, applying a file that also contains the `gcd-social-*` entries risks
   touching them. Keep the decision (with the full §3.6 gate), or amend it?
3. **Does the partial-release freeze cover new services?** The default is no Studio services
   until the interval (bound `2026-10-22T18:52Z`) is closed, or under the terms then in force.
4. **Default caps.** One full run's printed ceiling is about $21.65 against about $1.17 actual. What
   daily and monthly caps, and what deployment ceilings? Should the reservation use the printed
   ceiling (safe, blocks sooner) or a tighter bound (a separate, reviewed change to the estimate)?
5. **Who is a `runner` at launch,** and does each need a per-user daily cap?
6. **Time zone for "daily" and "monthly"** (`America/New_York` proposed).
7. **Retention:** keep runs indefinitely, or delete after a period? Audit and ledger for two
   years?
8. **Worker plan:** start on `starter` and measure, or start on `standard`?
9. **The P2 conflict** ([§5.4](#54-executionenabled-and-the-registry--how-the-studio-worker-may-call-stages)):
   when either is designed first, should P2 define a review-only execution context that keeps the
   CLI and the Studio working?
10. **A separate Anthropic workspace and key** for the Studio, yes or no?
11. **Fake runs** in the Studio: keep them (owner-only), or leave fake mode to the CLI?

### 11.2 Accepted limitations (proposed)

- **Deploys are manual,** one human step per Studio release, until the live controller is proven.
- **Owner lockout has no in-app recovery.** It takes one audited database statement by the Render
  account holder ([§7.2](#72-allowlist-and-roles)).
- **Until S2 proves a least-privilege role, the web holds the database owner's credential.** The
  worker's independent checks are the control ([§9.1](#91-threat-model)).
- **A Studio source run that predates the automotive-facts fingerprint is always refused** as a
  paid source, where the CLI would let an operator type `UNPROVEN`.
- **The price ceiling is an estimate,** and the CLI itself calls it "rough, not billing-accurate". An
  overrun is possible. It is detected after the request that caused it, stops the run, and locks new
  confirmations; it is not prevented.
- **An in-flight request cannot be cancelled.** Cancellation takes effect between requests, and the
  critic's four lenses are one unit.
- **Costs are the SDK's measured figures,** not Anthropic invoice figures.
- **Older local runs import as `archived_unverified`** whenever their approved-facts hash predates
  the deployed file, or their stage 4 overlay is now refused. They are viewable, never a paid
  source.
- **A live release of `gcd-social-*` after any Studio PR merges carries Studio code, unused.** The
  import-graph check is what keeps it unreachable.
- **Studio runs are operator evidence, not production evidence.** They move no production-wiring
  milestone and make no stage `PRODUCTION-VALIDATED`.
- **The Studio's reports are not approvals.** Copy-paste posting stays the owner's manual act,
  outside every gate this repository controls.

---

## 12. Decisions this design made itself

The owner's five decisions did not settle these points, so the design settled them. Each is recorded
here so it can be reviewed, and reversed, on its own:

1. **Deploy control:** manual exact-commit deploys with auto-deploy off; no controller or
   workflow change ([§3.4](#34-how-studio-deployments-are-controlled)).
2. **The registry question:** call the stages exactly as the CLI does, with `executionEnabled`
   untouched. The protection added is a transitive import-graph check, a caller allowlist and
   executed zero-runner tests. The future P2 conflict is recorded, not resolved
   ([§5.4](#54-executionenabled-and-the-registry--how-the-studio-worker-may-call-stages)).
3. **Studio-specific variable names:** `STUDIO_DATABASE_URL`, `STUDIO_GOOGLE_CLIENT_*` and no
   `DATABASE_URL` on any Studio service ([§3.2](#32-environment-variables-per-service)).
4. **Five migration separations,** including a tripwire `_migrations` table, so that neither
   runner can apply the other's migrations ([§3.7](#37-studio-migrations--kept-strictly-separate-from-the-live-migrations)).
5. **The cron is not in `render.yaml` at launch,** and its code is double-gated
   ([§3.5](#35-the-cron-job--built-disabled)).
6. **Artifacts are the authoritative record:** byte-identical to CLI files; tables are derived
   ([§4.2](#42-runs-outputs-findings-costs-and-reports)).
7. **Two import tiers:** `verified` and `archived_unverified`
   ([§4.5](#45-imported-legacy-runs)).
8. **Caps:** reserve the printed ceiling, reconcile to the charged cost, and stop and lock on
   overrun. An in-flight or unknown-cost request is charged at its full ceiling. Confirmations are
   serialized on the settings row. The effective cap is the lower of the owner's cap and a
   deployment ceiling ([§6.2](#62-daily-and-monthly-caps--enforced-before-every-paid-call)).
8a. **Quotes are written by the worker,** bound to its commit, both fact fingerprints and the price
   table. The worker re-checks them, and its own ceilings, before every paid request. The web
   never prices anything ([§6.1](#61-a-price-ceiling-confirmation-before-every-paid-action)).
9. **`jose` for token verification,** and Lax `__Host-` cookies with synchronizer CSRF tokens plus
   `Origin` checks ([§7](#7-authentication)).
10. **The upload and import formats:** JSON only, read client-side, each imported file base64-encoded
    with its sha256, and no archive dependency
    ([§8.5](#85-fact-file-upload-owner-only), [§8.6](#86-import-of-existing-local-output-runs)).
11. **Fake runs are owner-only** and labelled on every screen ([§6.3](#63-who-may-start-a-paid-run)).
