# GCD Content Intelligence roadmap

Last reviewed: 2026-10-02.

This roadmap is the canonical unfinished-work sequence and the current-phase cursor. It orders work; it does not grant authority to deploy, migrate, call providers, change external configuration, or begin a phase. [Status](STATUS.md) records what is verified true now. Where this file and verified production evidence disagree, resolve the discrepancy rather than following this text. Roadmap continuity is binding — see [`AGENTS.md`](../AGENTS.md).

## State vocabulary

| State | Meaning |
|---|---|
| `PLANNED` | In scope and ordered, but not built |
| `IMPLEMENTED` | Code exists and local validation passes |
| `MERGED` | Merged to `main` at a known SHA; says nothing about production |
| `CONFIGURED` | External identifiers/settings exist |
| `ENABLED` | The gate controlling it is actually on |
| `DEPLOYED` | A release carrying it is live in production |
| `PRODUCTION-VALIDATED` | Its behavior has been observed in production |
| `BLOCKED` | A named dependency or decision prevents safe progress |
| `DEFERRED` | Intentionally not scheduled; reason and re-entry condition recorded |
| `SUPERSEDED` | Replaced by a different accepted design; kept for its rationale |

These are not interchangeable and must not be collapsed into "done". `MERGED` in particular is not `DEPLOYED`.

## Implemented repository change awaiting merge

### Content Studio S4 — authentication: the `src/studio/web/**` skeleton, Google OpenID Connect, the bootstrap owner, sessions, CSRF, roles and security headers; `jose` added; S3 recorded as merged — `IMPLEMENTED`

**State:** `IMPLEMENTED` on branch `claude/affectionate-dirac-n1tlhn`, based directly on `origin/main` at `0aae05b210fc9d4471efa3a177329981980bb50a` (the merge of PR #107, S3). **Not `MERGED`, not `CONFIGURED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** No Render file names the web service: `render.yaml` is unchanged and `render.studio.yaml` does not exist (S8). No Studio service, database, Google OAuth client, consent screen, secret, `STUDIO_PUBLIC_ORIGIN` or Anthropic key exists. Nothing ran anywhere but this container, against a local fake OpenID issuer and a disposable PostgreSQL 16 server; **no request was made to Google except the one read-only GET of its public discovery document**, and none to Render or Anthropic. No migration, `studio/migrations/**`, `state/migrations/**`, `config/` file, prompt, skill, model id, registry entry or `executionEnabled` value changed; no live-loaded module changed (`scripts/ci/live-path-manifest.json` is unchanged and `CS3` passes). The partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** [PR #108](https://github.com/Caposhi/GCD-Agents/pull/108), open, not merged, from `claude/affectionate-dirac-n1tlhn` into `main`. CI is recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Preflight (2026-10-02), all passed before any edit:**

- `origin/main` was exactly `0aae05b…`, with ordered parents `bec4a41…` then `8b3b8d3…`, and `git diff 8b3b8d3 0aae05b` was empty. PR #107 was merged with that merge commit. The only other open PR, #39, touches none of `src/studio/**`, `studio/**`, `src/harness/livePathGuards.ts`, `package.json`, `package-lock.json` or `.github/workflows/**`.
- CI run 37011861567 (push, head `0aae05b`) completed on attempt 1 with exactly the five jobs, all `success`; `deploy-production` run 72 (37013609061) refused at *Refuse while production automation is disabled* and skipped its release job. The figures are in S3's record below.
- The working tree was clean and the tracked `.DS_Store` present and unmodified.
- The baseline on `0aae05b`: `npm ci`, typecheck and build passed; `npm run test:offline` passed eleven suites, 1,872 checks; the harness's source inventory was **589 mutations** (`--list` is not a harness option: the harness printed its inventory and began a full run, which was stopped); each shard passed on the untouched base — shard 0/3 197 mutations in 13m11s, shard 1/3 196 in 14m20s, shard 2/3 196 in 17m01s, 51 captured targets (in a separate worktree, while this change was being built in the main checkout, so the times are under load); and `CS3`, the live-path manifest diff guard, passed.
- **Render native auto-deploy was not re-verified** (owner decision of 2026-10-02, below).

**Why.** Design §10's S4 row, §7 and §9: the web service's skeleton and authentication, proven against a local fake issuer, before any screen (S5) or paid action (S6) exists.

**Delivered.**

1. **The web service, `src/studio/web/**`, and `npm run start:studio-web`** (`node dist/studio/web/main.js`), on `node:http` as `src/api/server.ts` is, with no framework. Modules: `main.ts` (the entry point), `startup.ts` (the start-up decisions), `server.ts` (the lifecycle), `app.ts` (the route table and handlers), `oidc.ts`, `sessions.ts`, `store.ts` (`WebStore` and `PgWebStore`), `rateLimit.ts`, and the test-only `testSupport.ts`.
2. **The environment** (design §3.2). `main.ts` reads only `STUDIO_DATABASE_URL`, `STUDIO_PUBLIC_ORIGIN`, `STUDIO_ALLOWED_HD`, `STUDIO_GOOGLE_CLIENT_ID`, `STUDIO_GOOGLE_CLIENT_SECRET`, `STUDIO_BOOTSTRAP_OWNER_EMAIL`, `PORT` and `RENDER_GIT_COMMIT`, each as `process.env.NAME`, plus the names present for the scan. It never reads `STUDIO_MAX_*`. **Refused before any connection:**
   - (a) any forbidden variable, whatever its value, even empty: `DATABASE_URL`, `CONSOLE_TOKEN`, `GOOGLE_ACCESS_TOKEN`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `IMAGEGEN_API_KEY`, `APPROVAL_CHANNEL_WEBHOOK`, `AUTONOMY_PHASE`, `PUBLIC_BASE_URL`, `ACTIVE_PLATFORMS`, any `IG_*`, `FB_*` or `GBP_*` name, and `ANTHROPIC_API_KEY`, which is forbidden on the web **in every phase**;
   - (b) a `STUDIO_PUBLIC_ORIGIN` that is not an exact https origin (no path, trailing slash, query, fragment, credentials, upper case or default port);
   - (c) a `STUDIO_ALLOWED_HD` other than `germancardepot.com`;
   - (d) a missing or empty client id or client secret;
   - also a missing or non-PostgreSQL `STUDIO_DATABASE_URL`, a `PORT` that is not a port, and a `RENDER_GIT_COMMIT` that is not a full SHA (as the worker refuses);
   - (e) then, connected but before listening: the worker's own check — `current_database()` is `gcd_studio`, the `studio_database_identity` row matches, the tripwire and ledger are present, and the applied schema version is exactly `0002_studio_schema.sql`.

   **To share these with the worker without reaching it,** the worker's pure start-up rules — the forbidden lists, `forbiddenNamesPresent`, the expected migrations and the identity and schema-version decisions — moved, unchanged, into the S2 runner module `src/studio/db/runner.ts`. `src/studio/worker/startup.ts` re-exports them under their S3 names and raises every refusal through its own `WorkerStartupRefusal`, with the same reasons and the same words; every `SW` check keeps its name and result (23 of 23), and the three mutations of moved lines (`M549`, `M556`, `M557`) are re-pointed at the runner with the same edit, suite and expected checks.
3. **Google OpenID Connect** (design §7.1): the authorization-code flow with PKCE S256, `state` and `nonce`.
   - **The endpoints are code constants** (`GOOGLE_OIDC` in `oidc.ts`), from Google's discovery document `https://accounts.google.com/.well-known/openid-configuration`, read once, read-only, on **2026-10-02 at 13:31:24Z**: authorization `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`, JWKS `https://www.googleapis.com/oauth2/v3/certs`; issuers `https://accounts.google.com` and `accounts.google.com`. No module but the entry point reads the environment, so no variable can change an endpoint or an issuer. A test injects a fake issuer only through `createStudioWebApp`'s `oidc` parameter, which the entry point never passes (`SA8`); the entry point, executed, redirects to Google's endpoint (`SAP3`).
   - **`GET /auth/login`** creates a `studio_login_attempts` row — `state` and `nonce` as sha256 hex, the PKCE verifier as issued — sets `__Host-gcd_studio_login` (Secure, HttpOnly, SameSite=Lax, `Path=/`, no `Domain`, 600 s) holding the state, and redirects with `scope=openid email profile`, `hd=germancardepot.com` (a hint only) and a `redirect_uri` derived from `STUDIO_PUBLIC_ORIGIN`, never from `Host`.
   - **`GET /auth/callback`** refuses an ID or access token in the URL, checks `state` against **both** the cookie and the stored hash, consumes the attempt through `studio_consume_login_attempt` (single use, refuses expired), exchanges the code with the client secret and the verifier within **10 s** (no redirect followed), and accepts the ID token **only** from the token response.
   - **Verified with `jose`:** algorithms `["RS256"]` only; `iss` one of the two issuers; `aud` the client id; `exp` and `iat` within a **60 s** skew (and `iat` no older than an hour); then the nonce against its stored hash, `hd` equal to `STUDIO_ALLOWED_HD` (missing is refused), `email_verified` the boolean `true`, the lower-cased email ending `@germancardepot.com`, an **active** `studio_users` row, and `google_sub` set at first sign-in and matching on every one after.
   - **Any failure** shows one generic *Not authorized* page, writes one `studio_audit_log` row (`auth.sign_in_refused`, `detail` `{ "reason": "<class>" }` and nothing else) and creates no session. **Success always redirects to `/`**: there is no return-to parameter.
   - **The key set** is `jose`'s `createRemoteJWKSet` with an explicit **5 s** timeout; no cache is written here. Its caching is a fixed maximum age, not the response's cache headers — a dated deviation note is at design §7.1.
4. **The bootstrap owner** (design §7.2). While no active owner exists, a sign-in passing every other check whose verified email equals the lower-cased `STUDIO_BOOTSTRAP_OWNER_EMAIL` creates that user as the active owner, with its `google_sub`, audited (`auth.bootstrap_owner`). It relies on the schema's advisory-locked insert trigger, not re-implemented: two concurrent first sign-ins create exactly one owner (`SAP4`). The variable is ignored once an owner exists and refuses the bootstrap while unset.
5. **Sessions, CSRF and headers** (design §7.3).
   - `__Host-gcd_studio_session` holds 32 random bytes; only its sha256 is stored. Same attributes as the login cookie, `Max-Age` 7 days. **12 h idle, 7 d absolute**, extended at most once a minute and never past the absolute expiry; rotated at sign-in (a presented session is revoked). Revoked, expired and disabled-user sessions are refused (`decideSession`).
   - **CSRF:** a per-session synchronizer token — an HMAC of a fixed label keyed by the session's 32 random bytes — compared in constant time with its stored sha256, **and** `Origin` exactly equal to `STUDIO_PUBLIC_ORIGIN` on every POST; a missing `Origin` or `null` is refused. No GET changes application state.
   - **`POST /auth/logout`** revokes the session, clears the cookie and redirects to `/`; `GET /auth/logout` is 405.
   - **Purges** (`DELETE`, at start and every ten minutes): login attempts 1 day after they expire, and sessions 30 days after their idle or absolute expiry or their revocation — design §4.7's retention, which also discharges S2's "purges (S4)" follow-up.
   - **Rate limits,** in process, per client address: `GET /auth/login` 20 a minute, `GET /auth/callback` 20 a minute, failed sign-ins 10 per 15 minutes (past which the callback refuses before any work).
   - **Headers on every response,** errors, 404s and `/healthz` included: `Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. No CORS header.
   - **Roles:** one route table, `STUDIO_ROUTE_TABLE`; every route declares `public`, `viewer`, `runner` or `owner`. An undeclared path is 404, an undeclared method 405, and a route whose role is unknown is denied to everyone. The role is checked on every request against the live users row the session lookup reads.
   - **S4's pages:** signed out, a *Sign in with Google* link; signed in, the escaped display name and role and a logout form. No inline script.
6. **`/healthz`** (design §3.3): `service: "gcd-studio-web"`, `commit`, `state: "postgres"`, `schema_version` (the newest applied Studio migration) and `worker_heartbeat_age_seconds` (null before the worker's first beat). No authentication, and no user, run or cost data. If the database cannot be read it answers 503 with `state: "unavailable"`.
7. **Logging** (design §9.2): structured `[studio-web] <event> {…}` lines of ids, classes and counts only — never an email, token, code, state, nonce, cookie, the client secret or an error message (`SA64`, `SAP11`).
8. **The dependency `jose`, exactly `6.2.12`** (no caret), in `dependencies`. From `package-lock.json`: integrity `sha512-9NiFmJEex0sy2Dk58j2UGBSHgUs2ypF9eZSu4L6vjOX3Dp96Sw1F3uL+H+D1sx02jZZdzUT0HgvCy59CuvXcWw==`, license MIT, **zero transitive runtime dependencies** (its lock entry declares none). `npm audit --omit=dev` stays at 0. **The consequence design §3.1 asks to record:** `jose` lands in the one lockfile the live services also install, so their next authorized release will carry it in `node_modules`, unreached — no live entry point reaches it (`CS11`).
9. **Two new guards in the Content Intelligence suite, beside `CS1`–`CS9`:**
   - **`CS10` — the web's TRANSITIVE isolation.** From every compiled `dist/studio/web/**` module (suites and test support included), no path reaches `dist/harness/contentRun/**`, `dist/studio/worker/**`, a stage executor, `stageExecution.js`, `revision.js` or `revisionInput.js`, the fact loader (`approvedFacts.js`), the pricing table (`sdk.js`), any `STUDIO_FORBIDDEN_TREES` or `STUDIO_FORBIDDEN_MODULES` entry, `@anthropic-ai/sdk` or any package but `pg` and `jose`; everything reached is the web tree or the S2 runner; and from `main.js` no test module is reachable at all. Synthetic trees prove an intermediary, a re-export or a dynamic import cannot hide a forbidden reach.
   - **`CS11` — `jose` only under `src/studio/web/**`**, by any import form, and the live graph walks clean with every other dependency allowed and `jose` not.
   - **The one-hop `STUDIO_WEB_TREE` rule in `callerViolations` is unchanged.** Two existing checks needed their inventories updated, each stricter, not weaker: `CS2` now names `src/studio/web/**` among the Studio trees and requires it to exist; `CS9` now requires exactly the two `start:studio-*` commands, each running a `dist/studio/` module. `SM2b` holds the web's entry point to its own exact list of variables, as S3 did for the worker's.
10. **Tests.** `src/studio/web/web.offline.selftest.ts` is the **twelfth** `test:offline` suite (`npm run test:studio-web`); `src/studio/web/web.postgres.selftest.ts` (`npm run test:studio-web-postgres`) joins the existing PostgreSQL step, renamed *Content Studio schema, worker and web disposable PostgreSQL suites*. The fake issuer runs on `node:http` at 127.0.0.1:0 with RSA keys generated at start, and serves an authorization endpoint, a token endpoint (which checks the client secret, the redirect URI and the PKCE S256 verifier) and a JWKS. No test contacts Google.

**Its checks.** Each case is its own named check.

- **Startup:** `SA1` (a), `SA2` (b), `SA3` (c), `SA4` (d), `SA5` (the URL, port and commit), `SA6` (the entry point executed with `ANTHROPIC_API_KEY` set to an empty value, `DATABASE_URL`, an empty `GBP_` name, a trailing-slash origin, another hd, an empty secret and a missing client id — each exit 1, no connection), `SA7` (e), `SA8` (the entry point's reads, order and arguments), `SA9` (the constants, and an app built without an issuer goes to Google).
- **Login and the accepted paths:** `SA10` (the attempt, the login cookie, the authorization request), `SA11` (a listed user; every cookie attribute; `google_sub` set once), `SA12` (bootstrap with a case-varied variable).
- **Refusals:** `SA13` hd wrong, `SA14` hd missing, `SA15` `email_verified` false, `SA16` missing, `SA17` the string `"true"`, `SA18` aud, `SA19` iss, `SA20` a bad signature, `SA21` a different key under the same kid, `SA22` alg none, `SA23` HS256 keyed with the public key, `SA23a` RS512 by the right key, `SA24` expired, `SA25` `iat` in the future, `SA26` a replayed state, `SA27` cookie and stored hash disagree, `SA28` state missing, `SA29` nonce mismatch, `SA30` an attempt over 10 minutes old, `SA31` token endpoint error, `SA32` token endpoint timeout, `SA33` an ID token in the callback URL, `SA34` an unlisted email, `SA35` a disabled user, `SA36` a `google_sub` mismatch, `SA37` a non-domain email whose hd passes, `SA38` bootstrap while unset, `SA39` bootstrap once an owner exists; `SA40` no redirect from a query parameter; `SA41` the store consumes attempts only through the schema's function.
- **CSRF and Origin:** `SA42` no token, `SA43` wrong token, `SA44` another session's token, `SA45` Origin missing, `SA46` `null`, `SA47` another origin, `SA48` GET logout 405, `SA49` a valid logout.
- **Sessions:** `SA50` idle expiry, `SA51` absolute expiry, `SA52` revocation, `SA53` disabling revokes, `SA54` rotation at sign-in, `SA55` the cookie value never stored.
- **Headers, health, routes, limits, purge, logs:** `SA56` headers on success, 401, 403, 404, 405, 429, 500 and `/healthz`, no CORS; `SA57` `/healthz`'s body; `SA58` an undeclared route denied; `SA59` default deny and a viewer refused on a test-only owner route (which does not ship); `SA60` the live role; `SA61`–`SA63` the three rate limits; `SA65` the purge; `SA66` the sign-in plan; `SA64` across the whole suite, nothing captured holds a secret, code, state, nonce, verifier, cookie, CSRF token, ID token, email or the client secret.
- **PostgreSQL:** `SAP1` the web's identity refusal against a database not named `gcd_studio`, through its entry point; `SAP2` an unmigrated `gcd_studio`; `SAP3` the entry point end to end with Google's constants; `SAP4` two concurrent first sign-ins create exactly one owner; `SAP5`/`SAP5a` a sign-in over the real store, nothing secret stored, replay refused; `SAP6` an expired attempt refused and deleted; `SAP7` disabling revokes; `SAP8` the session triggers; `SAP9` the purge; `SAP10` the audit rows; `SAP11` the logs.

**Mutations `M590`–`M611`** (the S4 group, 22). Each fails a named check:

| Id | Mutation | Suite | Expected |
|---|---|---|---|
| `M590` | the `hd` check dropped | web | `SA13`, `SA14` |
| `M591` | the `email_verified` check dropped | web | `SA15`, `SA16`, `SA17` |
| `M592` | any audience accepted | web | `SA18` |
| `M593` | any issuer accepted | web | `SA19` |
| `M594` | the RS256 allowlist dropped | web | `SA23a` |
| `M595` | the nonce check skipped | web | `SA29` |
| `M596` | the state-cookie comparison skipped | web | `SA27` |
| `M597` | a login attempt read instead of consumed (not single-use) | web | `SA41` |
| `M598` | the Origin check skipped | web | `SA45`, `SA46`, `SA47` |
| `M599` | the CSRF comparison skipped | web | `SA42`, `SA43`, `SA44` |
| `M600` | HttpOnly dropped | web | `SA10`, `SA11` |
| `M601` | Secure dropped | web | `SA10`, `SA11` |
| `M602` | the `__Host-` prefix dropped | web | `SA10`, `SA11` |
| `M603` | the bootstrap honoured when an owner exists | web | `SA39`, `SA66` |
| `M604` | the session lookup ignoring `revoked_at` | web | `SA49`, `SA52`, `SA53`, `SA54` |
| `M605` | idle expiry ignored | web | `SA50` |
| `M606` | an email logged | web | `SA64` |
| `M607` | the redirect taken from a query parameter | web | `SA40` |
| `M608` | `ANTHROPIC_API_KEY` removed from the web's forbidden list | web | `SA1`, `SA6` |
| `M609` | the route rule's default deny removed | web | `SA59` |
| `M610` | a web module importing a worker module (not the library: the transitive guard) | Content Intelligence | `CS10` |
| `M611` | a live module importing `jose` | Content Intelligence | `CS11`, `CS3` |

**611 mutations in all (609 prohibited, 2 coordinated-authority), over 56 captured paths** (was 589 over 51): the five new paths are `src/studio/web/{startup,oidc,sessions,store,app}.ts`. The shard each runs in follows from its index (`M-shard`).

**Migrations / schema impact:** none. S4 uses S2's schema unchanged: the login-attempt function, the users triggers, the session guard and lifetimes, the disable-revokes trigger and the audit log. [Data model](DATA_MODEL.md) is checked and unchanged; its S4 rows (the hash discipline, the bootstrap email, the purges) are now implemented as recorded there.

**Material design decisions.**

- **Decisions are pure functions; the store only reads and writes rows.** `decideSession`, `planSignIn`, `roleAllows`, `csrfMatches`, `originAllowed`, `checkIdentityClaims` and `decideWebStartup` take data. The store returns a session with its live users row unfiltered, so revocation, expiry and status are decided in one place, and the offline suite and the mutation harness can prove each one. The schema's own rules (single use, the bootstrap trigger, the session guard) are relied on, not re-implemented, and proven on PostgreSQL.
- **The CSRF token is derived, not stored in the clear:** an HMAC keyed by the session's 32 random bytes. It is per session, unforgeable without the HttpOnly cookie, and only its sha256 is stored, as the schema requires, so the server never holds a token it could leak.
- **The shared start-up rules moved into the S2 runner module,** not a new tree, so the worker's entry point still reaches only `startup.ts`, `money.ts` and the runner (`SW1c` unchanged) and the web reaches no worker module.
- **One audit row per refusal, carrying only the reason class,** and logs of ids and classes only. This is why a failed sign-in's audit row carries no email (an accepted limitation below).
- **A route table with default deny,** so a later route cannot be added without a declared role.
- **`/healthz` reads the session not at all,** and answers 503 rather than a false `postgres` when the database cannot be read.

**Material rejected alternatives.**

- **A web framework** (Express, Fastify). Rejected: the task requires `node:http`, as the live API, and a framework would be a further dependency in the shared lockfile.
- **Writing the JWKS fetch and cache by hand.** Rejected: the design makes `jose` the load-bearing verifier; jose's own remote key set, with a timeout, is used, and its caching difference is recorded as a deviation.
- **Trusting `X-Forwarded-For` for the rate limits.** Rejected for now, as on the live API: it is spoofable without a trusted-proxy configuration. Behind Render's proxy the limits may therefore be service-wide (TO VERIFY at S8; an accepted limitation).
- **Re-checking the bootstrap race in application code.** Rejected: the schema's advisory-locked trigger already serializes it, and the task forbids re-implementing it.
- **Testing every flow only against PostgreSQL.** Rejected: the mutation harness runs offline, so each decision is proven offline against a store that keeps the schema's rules, and the PostgreSQL suite proves the real schema.
- **A new CI job for the web's PostgreSQL suite.** Rejected: it would change the five-job shape; it runs in the existing step.

**Automated validation.** *(Figures from this container: 4 CPUs, Node 22.22.0; PostgreSQL 16.14 from the container's own packages. PostgreSQL 18 was not available locally — CI's PostgreSQL 18 job proves it.)*

- **Build and typecheck:** `npm run build` and `npm run typecheck` pass.
- **`npm run test:offline`:** now **twelve suites**, all pass. Totals went from **1,872 to 1,941** checks: Content Intelligence 1,328 → 1,330 (`CS10`, `CS11`), plus the web's new offline suite of 67 (about 3 s). The other suites are unchanged: posting 52, image 18, orchestrator 119, gate 56, API 51, render identity 1, ownership 112, interval 94, Studio database 18, Studio worker 23.
- **The Studio PostgreSQL suites on PostgreSQL 16.14** (a disposable local cluster): the schema suite 217 checks and the worker suite 19, unchanged after the start-up rules moved; the web suite 12 checks in about 1.0–1.7 s, **12 passing runs in a row** (the last after the §4.7 purge change). PostgreSQL 18 was not available here; CI's PostgreSQL 18 job runs all three.
- **The payload-contract mutation harness, all three shards:** run on this code after the commit that records these figures; the shard figures are recorded in the next commit and in the PR.
- **Each new and re-pointed mutation, applied one at a time in a scratch copy before the harness run:** all 25 (`M549`, `M556`, `M557`, `M590`–`M611`) failed exactly their expected checks.
- **The shard guard** (`npm run check:mutation-shards`): ALL PASS, all 11 injected faults refused, with the renamed step; the workflow YAML parses.
- **Other checks:** the M1 readiness offline suite, 461 checks; the simulated dry run, OK; the deployment-controller fixtures, PASS; `npm audit --omit=dev`, 0 vulnerabilities; Markdown links, 66 files; environment coverage, **45 variables** (was 40: the five web variables are added); the sensitive scan, 234 text files, no finding, manually triaged (the new files hold only synthetic values: generated keys, `.test` and `.invalid` hosts, addresses assembled at run time, the placeholder `fake-access-token`); `git diff --check`, clean.
- **AgentShield 1.4.0** exited zero at **B/87**, with the same 18 findings as on `main` (9 medium, 9 low, none critical or high, none on a changed file).
- **What did not run:** no model, provider, Google sign-in, live database, Render, approval, publication, deployment or release action. The only external request was the one read-only GET of Google's discovery document.

**Production evidence:** none, and none is possible: nothing is deployed, no OAuth client exists, and no Studio service exists.

**Rollback / recovery:** revert the commit. No state outside the repository changes; there is no Studio database, OAuth client or secret.

**Security and privacy implications.** See [Security and continuity](SECURITY_AND_CONTINUITY.md).

- The web holds the Studio's own OAuth client secret (never the live GBP client's) and no provider key; it refuses to start beside one.
- Every outbound call is to the three Google constants; nothing else is fetched (design §9.1, SSRF).
- No credential, token, cookie value or email is logged or stored in the clear; the cookie and CSRF values are stored only as sha256; the PKCE verifier is stored as issued until it is consumed or purged (design §4.1).
- `jose` is a new production dependency in the shared lockfile, with no transitive runtime dependencies and zero audit findings, reachable only from the web.
- Fixtures are synthetic: generated keys, `.test` hosts, and addresses assembled at run time.

**Accepted limitations.**

- **A failed sign-in's audit row carries no email** (only the reason class), so the owner cannot see from the Studio who tried to sign in.
- **The rate limits key on the direct peer address.** Behind Render's proxy every client may share one address, so the limits may act service-wide (TO VERIFY at S8) — a sign-in lockout is then a denial-of-service risk, not an authentication bypass.
- **The key set is cached for jose's fixed 10 minutes,** not per the response's cache headers; an unknown `kid` refetches after a 30-second cooldown (dated note at design §7.1).
- **The owner cannot yet revoke another user's sessions or manage users in the Studio** — the Users screen is S7; until then that is an audited database statement, as design §7.2 records for owner lockout.
- **The web cannot yet show "worker offline"** or refuse paid confirmations on a stale heartbeat (S6); `/healthz` reports the heartbeat's age.

**TO VERIFY / owner prerequisites — not done:**

- **O1:** the Google Cloud OAuth client (a Web application client whose only redirect URI is `<STUDIO_PUBLIC_ORIGIN>/auth/callback`) in a project owned by the Workspace organization;
- **the Internal consent screen** (that it is available for the organization);
- **`STUDIO_PUBLIC_ORIGIN`**, once Render assigns the Studio's address (S8, O3);
- whether Render's proxy forwards the client address in a way a later change could trust.

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — **blocking**.
- **This PR's own CI:** each job's and each shard's duration on the final head, recorded in the PR and reconciled here with the merge SHA.
- The watch item on the PostgreSQL jobs' 30-minute limit (the cursor).
- Carried: the web's least-privilege database role (S8); the audit-log and ledger two-year purge (a future reviewed migration).

**Documents updated:**

- this file: this record; S3's record moved to *Merged repository change awaiting rollout* and reconciled; the cursor; *Planned — Content Studio*; the owner decision of 2026-10-02;
- [Content Studio design](CONTENT_STUDIO_DESIGN.md): dated notes at §7.1 (the key set's caching), §7.3 (the rate limits' client address) and the §10 freeze-gate bullet (the owner decision);
- [Status](STATUS.md), [README](../README.md), [Environment](ENVIRONMENT.md), `.env.example` (`STUDIO_PUBLIC_ORIGIN`, `STUDIO_ALLOWED_HD`, `STUDIO_GOOGLE_CLIENT_ID`, `STUDIO_GOOGLE_CLIENT_SECRET`, `STUDIO_BOOTSTRAP_OWNER_EMAIL`), [Security and continuity](SECURITY_AND_CONTINUITY.md), [Testing](TESTING.md), [Architecture](ARCHITECTURE.md), [AI handoff](AI_HANDOFF.md), [`AGENTS.md`](../AGENTS.md) (twelve suites), and the mutation harness's header.

**Checked and deliberately left unchanged:**

- [Data model](DATA_MODEL.md): no schema change;
- [Deployment control](DEPLOYMENT.md) and [Operations](OPERATIONS.md): no deployment, service or runbook changed;
- `render.yaml`, `scripts/ci/live-path-manifest.json`, `deploy-production.yml`, every migration, `config/**`, prompts, skills and model ids;
- the M1 readiness runner: the five jobs are unchanged.

## Next repository change — Content Studio S5 (read-only screens), pending S4's merge

**The next repository change is Content Studio S5:** the read-only screens — the runs list, the run report (Copy buttons, findings grouping, *Needs your decision*, cost) and file downloads — on S4's route table, sessions and roles. See the [Content Studio design](CONTENT_STUDIO_DESIGN.md) §8 and §10.

- **S4 is `IMPLEMENTED`**, not merged (the record at the top of this file). **S5 begins after it merges.** The design's PRs are serial.
- **S3 is `MERGED`** through PR #107 at `0aae05b…` (2026-10-02); its record is under *Merged repository change awaiting rollout* below. *(Until 2026-10-02 this item read: S3 `IMPLEMENTED`, not merged; S4 begins after it merges.)*
- **The owner prerequisites S4 depends on are not done and are TO VERIFY:** O1 (the Studio's Google OAuth client), the Internal consent screen, and the real `STUDIO_PUBLIC_ORIGIN` (S8, O3). S5 does not need them; the first real sign-in does.
- S5 needs its own explicit authorization; nothing here grants it.
- Nothing here authorizes enabling any stage, creating any Render service, database or OAuth client, any release, or any change to the Phase-A approval gate.

**Owner decision of 2026-10-02 — Render native auto-deploy.** Native auto-deploy is always off on the three live services; per-merge re-verification is no longer requested. This is owner attestation, not reviewer-observed evidence. Last observed by screenshot on 2026-10-01. The deploy-production refusal is still verified from GitHub on every merge. S8's Blueprint auto-sync check is unaffected. *(Recorded in [Status](STATUS.md) and as a dated note at the design's §10 freeze-gate bullet. It changes how the freeze gate's second condition is evidenced for S4 and later Studio merges, not the condition itself.)*

This section was headed *Next repository change — not chosen*, then *… Content Studio PR 1 (library extraction), pending the owner's approval of the design*, *… Content Studio S1 (library extraction)*, *… Content Studio S2 (Studio schema and migrations), pending S1's merge*, *… Content Studio S2 (Studio schema and migrations), pending the mutation-harness speed-up's merge*, *… Content Studio S3 (worker and queue), pending S2's merge*, *… Content Studio S3 (worker and queue), pending the mutation-harness shards change's merge*, and *… Content Studio S4 (authentication), pending S3's merge*. Earlier records refer to it by those names.

Open items, carried unchanged except where S4, at the top of this file, says otherwise:

- **`reasoning-standard` output headroom:** 126,000 of the model's 128,000 output tokens since PR #95; recovering it by narrowing the `claimUse[].summary` allowance is open.
- **`brand-compliance-critic` is still on `claude-sonnet-4-6`** (`agents/brand-compliance-critic.md`) — Lane S work; routing it, and the two `sdk.ts` fallbacks with it, is open (see the legacy model migration record).
- **The M1→M2 interval ends `2026-10-22T18:52Z`**; the expiry is a decision point for the owner (see [Status](STATUS.md)).
- **AgentShield grade B/87** (9 medium oversized-agent, 9 low unspecified-model findings; no critical or high).
- **Splitting completed phases out of this file** into `docs/COMPLETED_ROADMAP_PHASES.md`, a separate documentation change.
- **Stage 2's restrictions can misdescribe the evidence** — a follow-up candidate recorded by the PR #99 record (*Documentation reconciliation — PR #98 recorded as merged, the revision pass's two owner-run rounds, and a corrected "critic gap"*, under *Merged repository change awaiting rollout* below); no fix is chosen.
- **`--resume-from production-direction`** — a follow-up candidate recorded by the contact-in-overlay change (PR #101, under *Merged repository change awaiting rollout* below): a live run refused at stage 4 cannot be resumed there today, so stages 1–3 are paid again; not built.
- Carried from the revision-pass record: describing the identity records in `SCRIPT_CLAIMS` and `PLATFORM_CLAIMS` in the critic prompts; tuning `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens.
- **`DEFERRED`, as the owner listed them on 2026-09-28** (not previously recorded in this repository; recorded here so they are not lost): Mercedes 223.2 and the round-2 fluids; the DPF/GPF bulk-oil question; the Spanish version.
- ~~**The owner's post-merge fake-runner check of S1** on the real facts file and one real run folder (fake runner only, no cost; the commands are in S1's PR).~~ **Done 2026-09-30** (operator-local; recorded in S1's record below).
- ~~**The mutation step's growth.**~~ **Discharged 2026-10-01 by S3** (its record, now under *Merged repository change awaiting rollout*)**:** PR #106 merged the shards, and every shard's CI step took under 12 minutes on its PR (11m18s, 11m36s, 11m08s; run 36900834356) and under 10 minutes on `main` (9m51s, 6m20s, 8m35s; run 36902831610), comfortably under the owner's 30-minute bar. *As carried until then:* After the speed-up (PR #104, now under *Merged repository change awaiting rollout*) the suite is about 95% of the harness's time and every mutation still runs it whole, so the step still grows with each mutation. The levers left are the owner's: a larger (paid) CI runner with `MAX_WORKERS` raised, a higher `timeout-minutes`, or restructuring the gate. The owner's merge bar for the speed-up is **30 minutes** for the CI mutation step (2026-09-30). *(2026-09-30: the speed-up merged through PR #104 with a CI mutation step of 26m59s on the PR and 26m34s on `main`. S2's first head, adding 11 mutations and 31 sampled clean builds, took 32m15s, over the bar; S2 now samples four per run (2026-10-01), and its revised CI figure is in PR #105. Still open.)* *(2026-10-01: S2 merged through PR #105. Its CI mutation step took **18m09s** on the PR and **30m13s** on `main`, for the same code: runner variance of more than ten minutes, and 13 seconds over the bar on `main`. **The mutation-harness shards change at the top of this file** (`IMPLEMENTED`, not merged) splits the harness into three shards, one in each of the three existing Node and PostgreSQL jobs, with no new job, paid runner or gate change; its local figures are in its record. This item stays open until all three shards have a CI figure from that change's PR, and is discharged only if each is comfortably under 30 minutes. *(PR #106's first run measured shard 0 at 11m19s and shard 2 at 10m35s; shard 1 did not run, because the Studio suite's race failed its job first.)* Those figures are recorded in its PR and reconciled with its merge SHA. Still open until then.)*
- **An independent review of the Content Studio design** before later Studio PRs, carried from the design record.
- **Watch item (2026-10-01): the PostgreSQL jobs' `timeout-minutes: 30` now binds first.** *(2026-10-02, S3's figures: *PostgreSQL 16 integration* 11m31s and *PostgreSQL 18 integration* 14m55s on PR #107's final run, 15m00s and 15m48s on `main`, with shards at 13m23s and 14m10s there; S4's are in its record and PR. Still under the owner's 20-minute stop limit; not a defect today.)* Each PostgreSQL job carries a mutation shard since PR #106, so its 30-minute limit, not the quality job's 60, is the nearest. Totals: *PostgreSQL 16 integration* 13m02s and *PostgreSQL 18 integration* 12m40s on PR #106's final run, 7m41s and 10m11s on `main`; S3's own figures are in its record. The owner's stop limit for this work is 20 minutes for a PostgreSQL job. Levers when it nears: raise `n` (more than one shard step in a job is already allowed by the guard), or the owner's runner and timeout choices. Not a defect today.
- **The merge SHA of Content Studio S4 at the top of this file** (mutable-identifier exception) — **blocking**; it is reconciled into that record once merged. *(Content Studio S3's merge-SHA follow-up, formerly here, is discharged by S4: `0aae05b…`; the mutation-harness shards change's by S3: `bec4a41…`; Content Studio S2's by the shards change: `fd88a2c…`; the mutation-harness speed-up's by S2: `0bb3f0b…`; S1's by the speed-up: `c1c19f4…`; PR #102's by S1: `4664515…`; PR #101's by PR #102: `f111012…`.)*
- ~~**From the shards change's validation:** the race in S2's disposable-PostgreSQL suite (an unhandled pool `'error'` when a test database is dropped while a pooled client is still closing; 4 of 14 local runs under load) — a separate fix; see that record's follow-ups.~~ **Fixed in the shards change itself** (owner decision of 2026-10-01; item 8 of its record).
- **From S2:** the least-privilege database role for the Studio web (design §9.1; S8, once Render's plan is known), ~~the login-attempt and session purges (S4)~~ *(built by S4, at the top of this file: §4.7's retention, by `DELETE`)*, and the audit-log and ledger two-year purge (a future reviewed migration).

## Planned — Content Studio (owner decisions of 2026-09-29) — `PLANNED`

**State:** `PLANNED`. The design is [`docs/CONTENT_STUDIO_DESIGN.md`](CONTENT_STUDIO_DESIGN.md), added by the documentation change now recorded under *Merged repository change awaiting rollout* (PR #102). It was first recorded with the owner's approval pending. **The owner approved it on 2026-09-29, with the answers below.** Approval is not implementation. **S1 — the pipeline library and the §5.4 protections — is `IMPLEMENTED`, not merged** (*Content Studio S1*, at the top of this file). *(Corrected 2026-09-30: S1 is `MERGED` through PR #103 at `c1c19f4…`, not deployed or enabled; its record is under *Merged repository change awaiting rollout* below.)* No Studio service exists: no `src/studio/**` code, Studio migration, Render service, database, Google OAuth client, secret or Anthropic key. *(2026-09-30: S2 — `src/studio/db/**` and `studio/migrations/**`, the Studio schema and its runner — is `IMPLEMENTED`, not merged, at the top of this file; still no Render service, database, OAuth client, secret or key, and nothing has been migrated.)* *(2026-10-01: S2 is `MERGED` through PR #105 at `fd88a2c…`, not deployed or enabled; its record is under *Merged repository change awaiting rollout* below. Still no Render service, database, OAuth client, secret or key, and nothing has been migrated.)* *(2026-10-01: S3 — the review-only execution context and the worker, `src/studio/worker/**` — is `IMPLEMENTED`, not merged, fake runner only, at the top of this file. No Render file names the worker; still no Render service, database, OAuth client, secret or key.)* *(2026-10-02: S3 is `MERGED` through PR #107 at `0aae05b…`, not deployed or enabled; its record is under *Merged repository change awaiting rollout* below. S4 — the web service's authentication, `src/studio/web/**`, with `jose` — is `IMPLEMENTED`, not merged, at the top of this file. No Render file names the web service; still no Render service, database, Google OAuth client, consent screen, secret, `STUDIO_PUBLIC_ORIGIN` or key.)* This entry sits outside the production-wiring sequence: the Studio implements none of P1–P8, performs none of M2–M7, and moves no production-wiring milestone.

**Owner decisions (2026-09-29), recorded verbatim:**

1. Build a web interface that removes manual terminal runs of the content pipeline and lets the owner and staff view every run and report in a browser.
2. **A separate, review-only "Content Studio"** in the same `render.yaml`: its own web service, background worker, optional cron job and its own PostgreSQL database. It is **not** built inside the live `gcd-social-*` services.
3. **Users:** the owner plus a few staff, signing in with Google, restricted to `@germancardepot.com`. The owner decides which users may start paid runs.
4. **Runs are on demand only at launch.** The cron job is designed but disabled until the owner decides otherwise.
5. **The manufacturer facts file** (`config/automotive-facts.local.json`, today only on the owner's Mac) may be uploaded to the Studio and stored in its private database. It is never committed to GitHub.

**Amendment to decision 2 (owner, 2026-09-29).** The Studio gets a **separate Blueprint file, `render.studio.yaml`**, not the shared `render.yaml`. Decision 2 is otherwise unchanged. Whether Render supports a Blueprint at a non-default path is TO VERIFY. If it does not, the Studio's resources are created by hand from that checked-in file, which is the specification. **`render.yaml` is not modified at all by any Studio PR.** Decision 2 above is kept as first given.

**The owner's answers of 2026-09-29 to the design's §11.1** (recorded in full in design §11.1a):

1. **The design is approved** as amended. It stays `PLANNED`, and each S-PR and owner action still needs its own authorization.
2. **Decision 2 is amended** as above.
3. **The freeze covers new services; the default is kept.** No Studio service is created (O3) until the M1→M2 interval (bound `2026-10-22T18:52Z`) is closed, or under whatever terms are then in force.
4. **Caps:**
   - owner caps $50 a day and $200 a month;
   - deployment ceilings `STUDIO_MAX_DAILY_USD` = 75 and `STUDIO_MAX_MONTHLY_USD` = 300;
   - an Anthropic workspace spend limit of $300 a month for the Studio key.

   The reservation stays at the full printed ceiling. Tightening the estimate is a separate, reviewed future change.
5. **Only the owner is a `runner` at launch;** staff are `viewer`. Runners added later get a $25 per-user daily cap.
6. **Time zone:** `America/New_York`.
7. **Retention:** runs are kept until the owner deletes them. The audit log and spend ledger are kept for 2 years.
8. **The worker starts on `standard`,** is measured, and may move down to `starter`. Plan prices are TO VERIFY.
9. **The P2 conflict is a binding rule.** Whichever comes first, production-wiring P2 or Studio S3, must define an explicit, separately reviewed review-only execution context, so that the local CLI and the Studio keep working. It can never approve or publish, and it sits beside the live authority gate, never replacing it. A dated pointer at P2 in [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md) records it.
10. **A separate Anthropic workspace and key for the Studio is required.** O2 must happen before the first live run.
11. **Fake runs stay in the Studio, owner-only,** labelled on every screen.

**Operational note (owner, 2026-09-29).** `STUDIO_BOOTSTRAP_OWNER_EMAIL` must name a real Google Workspace **user** account, not a shared mailbox, an alias or a group, because the `hd` and `email_verified` checks only work for Workspace user accounts. The owner enters the value in Render; it is never committed.

**Sequence (design §10), serial, each separately authorized:**

- **S1** library extraction — **`MERGED`** through PR #103 at `c1c19f4…` (2026-09-30), not deployed or enabled;
- **S2** Studio schema and migrations — **`MERGED`** through PR #105 at `fd88a2c…` (2026-10-01), not deployed or enabled; *(until 2026-10-01: `IMPLEMENTED`, not merged; until 2026-09-30: the next repository change, pending the mutation-harness speed-up's merge, which is `MERGED` through PR #104 at `0bb3f0b…`)*;
- **S3** worker and queue, and the review-only execution context — **`MERGED`** through PR #107 at `0aae05b…` (2026-10-02), not deployed or enabled, fake runner only; *(until 2026-10-02: `IMPLEMENTED`, not merged; until 2026-10-01: the next repository change, pending S2's merge and then the mutation-harness shards change's, which is `MERGED` through PR #106 at `bec4a41…`)*;
- **S4** authentication — **`IMPLEMENTED`**, not merged (the record at the top of this file); no OAuth client, secret or origin exists *(until 2026-10-02: the next repository change, pending S3's merge)*;
- **S5** read-only screens — the next repository change, pending S4's merge;
- **S6** run and revise actions with caps;
- **S7** fact upload and legacy import;
- **S8** a new `render.studio.yaml`, with `render.yaml` byte-identical;
- **S9** the cron, built disabled.

**Owner actions, named separately:**

- **O1** create the Google OAuth client;
- **O2** create the Studio's Anthropic key;
- **O3** create the Studio resources from `render.studio.yaml`;
- **O4** set the secrets;
- **O5** the first deploy and setup;
- **O6** the first live run.

**Gates:**

- ~~**Owner approval of the design.**~~ **Given 2026-09-29.**
- **The release-freeze gate — confirmed by the owner.** The M1→M2 interval is bound at `2026-10-22T18:52Z`, and its prohibition covers "any service". No Studio service is created (O3) until the interval is closed, or under the terms then in force. Merging S1–S9 is not a release, while `deploy-production` keeps refusing at its disabled gate and native auto-deploy stays off on the live services (design §10). *(Owner decision of 2026-10-02: native auto-deploy being off is now an owner attestation, not re-verified per merge — last observed by screenshot on 2026-10-01; the `deploy-production` refusal is still verified from GitHub on every merge; S8's Blueprint auto-sync check is unaffected. See the cursor above.)*
- **The Blueprint check before S8 merges.** Is this repository linked to a Render Blueprint, which file does it read, and is auto-sync on? S8 adds only `render.studio.yaml` and leaves `render.yaml` byte-identical. Any Blueprint or dashboard action touching a `gcd-social-*` resource is a stop condition (design §3.6).
- ~~**The P2 rule** (design §5.4): whichever comes first, P2 or S3, defines the review-only execution context.~~ **Met by S3** (`IMPLEMENTED`; *`MERGED` through PR #107 since 2026-10-02*): it defines the context and how C2 and C3 would accept it; P2 is unchanged.
- **O2 before O6:** no live Studio run without the separate Anthropic workspace and key.

**Open questions:** answered by the owner on 2026-09-29 (design §11.1 and §11.1a).

## Merged repository change awaiting rollout

### Content Studio S3 — the review-only execution context (Part 1), and the Studio worker and job queue (Part 2); PR #106 recorded as merged — `MERGED`

**Merge reconciliation (recorded 2026-10-02 by Content Studio S4, at the top of this file):** `MERGED` through [PR #107](https://github.com/Caposhi/GCD-Agents/pull/107) at `0aae05b210fc9d4471efa3a177329981980bb50a`. Its ordered parents are `bec4a41449fac5fd50e631c62b9424924afe260c` (the PR #106 merge) and then reviewed head `8b3b8d374544b695e63413459da5bcdd35dcc33a`; `git diff 8b3b8d3 0aae05b` is empty. Nothing followed it on `main` when S4 began.

- **PR CI:** final [run 36961697170](https://github.com/Caposhi/GCD-Agents/actions/runs/36961697170) (run 251) on head `8b3b8d3` passed all five jobs on attempt 1:
  - *Node 22 offline quality gates* **15m08s** of 60 (03:47:27–04:02:35Z), with shard 0/3 **13m30s** (03:48:06–04:01:36Z);
  - *PostgreSQL 16 integration* **11m31s** of 30 (03:47:27–03:58:58Z), with the Content Studio step 14s and shard 1/3 **9m48s** (03:49:07–03:58:55Z);
  - *PostgreSQL 18 integration* **14m55s** of 30 (03:47:26–04:02:21Z), with the Content Studio step 13s and shard 2/3 **13m21s** (03:48:58–04:02:19Z);
  - *AgentShield 1.4.0* 11s; *Workflow and YAML static validation* 7s.
- **`main` push:** [run 37011861567](https://github.com/Caposhi/GCD-Agents/actions/runs/37011861567) (run 252) on `0aae05b` passed all five jobs on attempt 1:
  - *Node 22 offline quality gates* **14m58s** (13:16:08–13:31:06Z), with shard 0/3 **13m22s** (13:16:46–13:30:08Z);
  - *PostgreSQL 16 integration* **15m00s** (13:16:07–13:31:07Z), with the Content Studio step 14s and shard 1/3 **13m23s** (13:17:43–13:31:06Z);
  - *PostgreSQL 18 integration* **15m48s** (13:16:08–13:31:56Z), with the Content Studio step 13s and shard 2/3 **14m10s** (13:17:43–13:31:53Z);
  - *AgentShield 1.4.0* 9s; *Workflow and YAML static validation* 6s.
- **Deploy:** the `deploy-production` workflow, [run 37013609061](https://github.com/Caposhi/GCD-Agents/actions/runs/37013609061) (run 72), refused at *Refuse while production automation is disabled*, and its release job was skipped.
- **Render native auto-deploy was not re-verified for this merge:** by the owner's decision of 2026-10-02 (the cursor, below) it is an owner attestation, last observed by screenshot on 2026-10-01.

**Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`; fake runner only.** This paragraph discharges the blocking merge-SHA follow-up and the PR-CI follow-up below. Where the record says `IMPLEMENTED`, not merged, or that its CI is recorded only in the PR, this paragraph supersedes it. The watch item stands: the PostgreSQL jobs took 15m00s and 15m48s on `main`, under the owner's 20-minute stop limit and the 30-minute timeout. The record was written at the top of this file, so where it says *Next repository change* or *Planned — Content Studio* "below", those entries are now above it. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/sharp-gates-4pnvcs`, based directly on `origin/main` at `bec4a41449fac5fd50e631c62b9424924afe260c` (the merge of PR #106). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** **Fake runner only.** No Render file names the worker: `render.yaml` is unchanged and `render.studio.yaml` does not exist (S8). No Studio service, database, OAuth client, secret or Anthropic key exists. Nothing ran anywhere but disposable PostgreSQL 16 and 18 servers. All six stages keep `executionEnabled: false`, the registry is unchanged, and no live-loaded module changed (`scripts/ci/live-path-manifest.json` is unchanged and `CS3` passes). No migration, `config/` file, prompt, skill, model, limit or dependency changed. The partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** [PR #107](https://github.com/Caposhi/GCD-Agents/pull/107), open, not merged, from `claude/sharp-gates-4pnvcs` into `main`. CI is recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Preflight (2026-10-01), all passed before any edit:**

- `origin/main` was exactly `bec4a41…`, with ordered parents `fd88a2c…` then `217fbea…` and nothing after it. The working tree was clean.
- PR #106's final CI run 36900834356 on `217fbea`, the `main` push run 36902831610 on `bec4a41` and its `deploy-production` run 71 were verified. Every job passed on attempt 1, and `deploy-production` refused at its disabled-automation gate. Their figures are in PR #106's record below.

**Why.** Design §10's S3 row. **S3 came before production-wiring P2, so under the owner's binding rule of 2026-09-29 (design §5.4, §11.1a item 9) it defines the review-only execution context.** It is recorded as Part 1, separately from the worker, so that it can be reviewed by itself.

#### Part 1 — the review-only execution context

**Delivered.**

1. **The type and its constructor:** `src/harness/contentRun/executionContext.ts`, re-exported by the library's index.
   - `ReviewOnlyExecutionContext` is a frozen object holding exactly `kind: "review-only"`, `caller` (`"local-cli"` or `"studio-worker"`) and one per-request check, `checkRequests(unit) => Promise<void>`. A module-private `unique symbol` brand means no object literal satisfies the type.
   - `createReviewOnlyExecutionContext` is the only way to make one. It refuses any other caller and a missing check, freezes the result and records it in a module-private registry.
   - `isReviewOnlyExecutionContext` accepts only a context that registry issued, still frozen, with exactly its three keys. So a look-alike literal, a spread copy, a frozen copy and a prototype child are all refused.
   - **The module imports nothing at run time** (only types, which compile away). Reaching it reaches nothing else.
2. **The library's paid paths require it, next to `PaidActionConsent`.** In each of `runFullPipeline`, `resumeFromPackaging`, `replayCritic` and `reviseRun`, a run with the live runner calls `requireReviewOnlyExecutionContext(io.execution, kind)` immediately before `io.consent(...)`. Without a context, or with anything that is not one, every paid path refuses with `ReviewOnlyContextError` before consent, before any runner exists and before any output is created. `RunIo` gains the optional `execution` field. A fake run without one runs as before.
3. **The per-request check, the C3-equivalent.** When a context is supplied, the library wraps every stage runner (`gateRequestUnits`) so that `checkRequests` runs immediately before every request unit. Each stage request is one unit, and the critic panel's four lens requests are one unit, checked once when the first arrives. Each unit carries its own priced lines and every line still to come. A request outside the action's priced requests is refused before it is sent, and a refusal means that unit and every later one are never sent.
4. **The CLI constructs it.** `scripts/local/content-run.mjs` makes one context (`caller: "local-cli"`) after it knows the compiled library exists, and hands it to every run. Its check allows every unit, because the CLI's consent — the cost flag and the typed `LIVE` — covers the whole priced action before the first request. **The CLI's behaviour is unchanged:** the golden test against `bec4a41` reports 0 differences.
5. **How P2's C2 and C3 would accept it**, written down and not built, in [CONTENT_STUDIO_DESIGN.md §5.4](CONTENT_STUDIO_DESIGN.md#how-p2s-c2-and-c3-accept-the-context-written-by-s3-2026-10-01-not-built), with a dated pointer at P2 in [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md). In brief:
   - **C2** gains a second, review-only branch. An `invokeStage` invocation carrying a context must pass `isReviewOnlyExecutionContext`, and for it neither `executionEnabled` nor the live gate is read. The context does not satisfy them and is never recorded as having done so. An invocation without a context keeps P2's rule exactly. A look-alike is refused, never treated as live.
   - **C3** awaits the context's `checkRequests` immediately before each provider request, and refuses on its rejection. P2 moves S3's library-level call there, so each unit is checked once.
   - **C1, C4 and C5 accept no context.**
   - Once P3/P4 make `stageExecution.js` live-reachable, it may import the verifier from the leaf module, which P3/P4 then exempt from `FORBIDDEN_LIVE_TREES` by name, keeping CS8. In a live process the registry is empty, because both permitted constructors are unreachable from every live entry point.

**Its checks.** Each is executed. Mutations `M534`–`M546` make `CS7`, `CS7a`, `CS7b`, `CS8`, `CS9` and `SW7`–`SW7b` load-bearing; the type-level check is its own proof, shown failing on an injected fault:

- **`CS7`:** the CLI's context is frozen and holds exactly `kind`, `caller` and `checkRequests`. Six look-alikes are refused, and the constructor refuses another caller or a missing check.
- **`CS7a`:** every paid path — a live full run, resume, revision and critic replay — refuses before consent, runner and output when given no context or one of four look-alikes. A fake run without one still runs. A fake run given a look-alike refuses before any output.
- **`CS7b`:** the CLI's own context, checked on its own before any block that runs the CLI — exactly its three keys, frozen, `local-cli`, verified — so a change to the context's shape is named even when every CLI run fails, or a later block crashes, because of it.
- **`CS7c`:** the type-level check file `src/studio/worker/executionContext.typecheck.ts` is in place. Its assertions fail `npm run typecheck` and `npm run build` if one stops holding:
  - the context's keys are exactly these three;
  - its kind and callers are closed literals;
  - its members are read-only;
  - its one capability is a per-unit gate;
  - each of six `@ts-expect-error` lines must not compile — an object literal, another caller, an `approve` or `publish` capability, an `approve` member, and a reassignment.

  Proven by injecting an `approve` member into the interface, which failed the typecheck, and restoring it.
- **`CS8`:** the construction allowlist, an executed check that extends the S1 caller allowlist (`contextConstructionViolations` in `src/harness/livePathGuards.ts`). Only `scripts/local/content-run.mjs` and `src/studio/worker/**` may name the constructor — by identifier, property or string key. The library may only define and re-export it. Synthetic violations from the web tree, a live module, another script, another library module and the database tree each fail.
- **`CS9`:** beside the live gate, never replacing it.
  - No live entry point reaches the context's module.
  - No live-loaded module names the context, its constructor, its checks or its module, so none can construct or receive one (`reviewOnlyMentions`).
  - The module imports nothing at run time, and a walk from it reaches no posting, approval or live-database module.
  - The CLI imports only Node built-ins statically.
  - Every `start:studio-*` command runs a `dist/studio/` module.
- **The existing import-graph check (`CS1c`)** now walks every compiled worker module and finds no posting, approval, Instagram-token, `state.ts` or live-service reach.
- **`SW7`–`SW7b`** (the worker's offline suite, the only tree besides the CLI allowed to construct a context) prove the per-unit check:
  - with a context, every unit is checked before it is sent, in order;
  - the panel is one unit;
  - refused at the third unit, a fake run records two responses;
  - on a live path with a counting fake runner, refused at unit 1 the runner is called zero times, and at unit 2, once;
  - a request outside the priced action is refused.

**Material design decisions.**

- **The context is a capability object, not a flag.** It carries the one thing a review-only caller needs, its own per-request check, and nothing that names approval, publication or a live database. So "it can never approve or publish" is a property of its shape, held by a type-level check and an executed key check, not a promise.
- **Brand plus registry.** The type brand stops a literal at compile time; the registry stops a forged or copied object at run time. Neither alone suffices in JavaScript.
- **The check sits at the runner wrapper today.** S3 builds no part of P2. The library calls the context where it already wraps every runner, the same position P2's C3 will take at the boundary.
- **The CLI's per-unit check is a no-op that changes nothing.** Its consent covers the whole priced action, so a per-request prompt would change the CLI's behaviour, which the task forbids.

**Material rejected alternatives.**

- **Widening `executionEnabled`, or a registry entry for the Studio.** Rejected: it would change a guarded invariant and the dormancy regressions. The design proposes nothing of the kind.
- **A context that carries the stage runner.** Rejected: it would make the context a model-calling capability that C2/C3 would then have to trust. The runner stays the library's runtime choice.
- **Checking the caller by stack inspection.** Rejected as fragile under compilation. The static construction allowlist and the import graph bound who can call the constructor.
- **Letting P2 define the context later.** Rejected: the owner's rule binds whichever comes first, and S3 came first.

#### Part 2 — the Studio worker and job queue (design §10, S3)

**Delivered.** `src/studio/worker/**` and `npm run start:studio-worker` (`node dist/studio/worker/main.js`), not deployed:

1. **Start-up** (`startup.ts`, `main.ts`; design §3.2).
   - **The environment.** The worker refuses, before connecting, if any forbidden variable is present, whatever its value, even empty: `DATABASE_URL`, `CONSOLE_TOKEN`, `GOOGLE_ACCESS_TOKEN`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `IMAGEGEN_API_KEY`, `APPROVAL_CHANNEL_WEBHOOK`, `AUTONOMY_PHASE`, `PUBLIC_BASE_URL`, `ACTIVE_PLATFORMS`, any `IG_*`, `FB_*` or `GBP_*` name, and, in S3, `ANTHROPIC_API_KEY`.
   - **Before anything reads the environment.** The entry point decides this before the content-run library — and with it the live `src/harness/config.ts` — is loaded: the worker is a literal dynamic import after the decision.
   - **What it reads:** the names present, `STUDIO_DATABASE_URL`, `STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD` and `RENDER_GIT_COMMIT`. The commit must be a full SHA.
   - **The database.** It then runs S2's `current_database()` and `studio_database_identity` decision. It also refuses an unmigrated database (`not-migrated`), and any schema version but `0002_studio_schema.sql`: a missing, extra or changed migration, recorded or on disk.
2. **Ownership** (`session.ts`): a session-level `pg_try_advisory_lock` on a Studio-only key, the first eight bytes of sha256(`gcd-studio:worker-ownership:v1`). It is neither the live key `(1889446263, 889784911)` nor the Studio migration runner's.
   - Every statement the worker makes runs on that one serialized session, so nothing can commit after ownership is lost.
   - A worker without the lock retries, consumes nothing and emits no readiness.
   - **Readiness is emitted only after ownership is held and recovery has finished**, as `[studio-worker] ready {"service":"gcd-studio-worker","commit":"…","state":"postgres"}`.
3. **The queue** (`jobs.ts`).
   - **The claim** runs on the ownership session, inside a transaction that first proves this backend holds the lock, with `FOR UPDATE SKIP LOCKED`. Free `preflight` jobs are taken before `paid` and `fake` ones, then oldest first, never an expired or cancellation-requested job, and only from `queued`.
   - **Expired and cancelled queued jobs** are closed unstarted, their runs `cancelled` and their reservations released in full.
   - **No retries:** a job is never claimed twice, and no request is retried.
   - **Preflight jobs** are claimed first and closed at once with `preflight_not_built`: the free preflight and its quote are S6's.
   - **A job whose run is no longer `queued`** is closed (`cancelled`, audited `job.refused`), never started, so one inconsistent row cannot stop the worker on every restart.
4. **Execution** (`execute.ts`). Each job runs through the library exactly as the CLI runs it. The run's goal, platforms and scope become the CLI's options; the review time is the run's own instant.
   - **The facts.** The approved facts come from `config/approved-facts.json` at the worker's commit. The automotive facts are the run's pinned fact version, recorded under the CLI's default path, so `run-meta.json` is the CLI's byte for byte.
   - **The collaborators:** the always-refusing `UNPROVEN` confirmation, a reporter that logs nothing, its `PaidActionConsent`, and a context with `caller: "studio-worker"`.
   - **A stored scope the CLI would refuse at its flag** (an empty tag list) refuses the run (`invalid_scope_tags`) before any work.
   - **Before any work it refuses** (`decideBeforeWork`): a kind it does not run, a job whose kind does not match its run, **a live run on a worker with no paid runner (every live run in S3: `live_runs_not_enabled`)**, and a paid job whose quote names another worker commit, approved-facts sha256, fact version or price table (`version_skew`).
   - **A wall-clock limit:** every request's stream deadline and set-up timeout, plus five minutes. It is checked before each unit and also enforced by a timer while a request is in flight.
   - **Cancellation** is checked between units; the critic's four lenses are one unit.
   - **The terminal state.** A refusal before output is `refused`; after output, `failed`. A cancellation is `cancelled`, and an overrun `failed` with `cost_ceiling_exceeded`. On a failure the worker saves what the CLI saves: the revision's final metadata, the field measurements and `rejected-responses.json`.
5. **Recovery: refuse, don't resume** (`jobs.ts`). At start-up, after ownership and before readiness, every `running` run becomes `interrupted` (`worker_restart`). Its reservation is reconciled from the durable `studio_run_requests` rows: a request with a `started` row and no completed one is charged its full ceiling. Nothing is resumed.
6. **The heartbeat:** the §4.6 singleton row, written at once and then every 30 seconds — the commit, the schema version, the approved-facts sha256 and tag counts, and the price table's sha256 (`priceTableSha256`, added to `contentRun/pricing.ts`). It also refreshes the running job's `heartbeat_at`.
7. **`RunSink` over the database** (`runSink.ts`). Artifacts are stored as exactly the library's bytes, a string as UTF-8, with sha256 and length.
   - The library rewrites four files during a run: `resume-meta.json`, `revision-meta.json` and the two measurement files. The schema's rows are immutable, so those four are stored once, with their final bytes, when the run ends. A second write of any other artifact is refused.
   - **Request rows.** A paid unit's `started` rows, each with its own ceiling, are committed in the transaction that re-checks the reservation, **before the request is sent**. The response completes its row with tokens and measured cost; an unknown or unusable cost leaves it charged its full ceiling. The four lens rows are written in one transaction and completed through the one serialized session.
   - A `RunSource` reads a saved run's artifacts for a replay, resume or revision.
8. **Reservation and reconciliation** (`spend.ts`; design §6.2).
   - **Before every paid request or lens unit, and in the worker's `PaidActionConsent`,** the worker re-reads the run under its row lock and refuses, fail-closed and in this order:
     - a job cancelled or no longer running;
     - the wall clock;
     - a run that is not a running live run;
     - no live reservation — exactly one `reserve` entry equal to the run's reservation, and a quote;
     - a reservation already settled;
     - a quote that is missing, unconsumed, another user's or for another action;
     - a requester no longer an active owner or runner;
     - an unpriced request;
     - a request still in flight;
     - a charge over the reservation;
     - a ceiling still to come that does not fit what remains;
     - an unacknowledged overrun;
     - the effective daily, monthly and per-user caps, re-summed from the ledger.
   - **The effective cap** is the lower of the worker's own `STUDIO_MAX_*` and the owner's `studio_settings` cap. A cap that is missing or cannot be read counts as zero.
   - **Settlement.** A finished live run releases its unused reservation, or books its overrun.
   - **An overrun** fails a run that otherwise succeeded, and locks every paid request and confirmation (`confirmationsLocked`, for S6) until an owner's `spend.overrun_acknowledged` audit row names the run.
   - Money is exact integer micro-dollars (`money.ts`); a ceiling rounds up.
9. **Fake runner only.** In S3 no worker path can construct the provider runner or read `ANTHROPIC_API_KEY`.
   - `start:studio-worker` gives the worker no paid runner, so every job naming `live` is refused before any work.
   - The runtime handed to the library replaces `createAnthropicStageRunner` with one that yields only the paid runner the worker was given, and otherwise refuses.
   - No Studio module imports `stageExecution`, `sdk` or `config`; and `ANTHROPIC_API_KEY` is a start-up refusal, so the live `config.ts` the stage modules load never sees one.
   - The disposable-PostgreSQL suite proves the paid path with a replaying fake stage runner injected in the provider's place.
10. **CI:** the worker's PostgreSQL suite runs in the existing *Content Studio schema and worker disposable PostgreSQL suites* step (renamed from *… schema … suite*), after the schema suite, on 16 and 18. The offline suite is the eleventh `test:offline` suite. **No job was added.** `scripts/ci/check-mutation-shards.rb`'s self-test re-anchors one injected fault on that step's new `run:` line; its rule is unchanged.
11. **Housekeeping.**
    - PR #106 is recorded as `MERGED` at `bec4a41…`, with its runs, under *Merged repository change awaiting rollout* below. Its merge-SHA follow-up is discharged.
    - PR #106's first comment proposed a different, catch-all patch, which the merged fix superseded. This is noted in that record.
    - **The mutation step's growth is discharged** with the measured CI figures.
    - **A watch item is added:** the PostgreSQL jobs' 30-minute limit now binds first.
    - The cursor is now S4.
    - `livePathGuards.liveEntryPointsFromConfig` no longer treats `start:studio-*` scripts as live entry points (`CS9` requires each to run a `dist/studio/` module, and `render.yaml`'s own commands are still all walked).
    - S2's `SM2b` now also holds the worker's entry point to an exact list of reads (below).

**Its proofs, each an executed check:**

| Proof | Check |
|---|---|
| A single consumer under contention, with two worker processes started | `SWP2`, `SWP2a` |
| Refuse-don't-resume after a kill mid-run (`SIGKILL`), and after a session killed mid-request, reconciled from the durable rows | `SWP3`, `SWP10`; `SW13a` |
| No request after cancel (in flight completes; a lens unit completes; a queued job never starts) | `SWP5`; `SW5` |
| The request row is durable — visible to another session — before each request is sent | `SWP4` |
| An overrun stops the run and locks confirmations until acknowledged | `SWP7`; `SW5`, `SW6`, `SW13` |
| Zero runner calls without a reservation: missing, settled, expired, wrong user (demoted; another user's quote), exhausted — and version skew, zero caps, a live job with no paid runner | `SWP6`; `SW5`, `SW11` |
| The startup refusals and the schema-version refusal | `SW1`–`SW1c`, `SW3`, `SW3a`; `SWP1`–`SWP1b` |
| A full fake run through the worker writes artifacts byte-identical to the CLI's | `SWP14` |
| No retries; the wall clock; preflight first; a job whose run is not queued closed, not started, and an empty stored scope refused; the heartbeat; the reconciliation | `SWP8`, `SWP9`, `SWP11`, `SWP11a`, `SWP12`, `SWP4a`; `SW12`, `SW4a` |
| Fake runner only | `SW8`, `SWP13` |
| The review-only context (Part 1) | `CS7`, `CS7a`, `CS7b`, `CS7c`, `CS8`, `CS9`, `SW7`–`SW7b` |

**Migrations / schema impact:** none. S3 uses S2's schema unchanged; the overrun acknowledgement is an audit row. See [Data model](DATA_MODEL.md).

**Material design decisions.**

- **One session for everything.** Ownership, claims, request rows and artifacts share the lock's connection, serialized in process. A lost connection therefore loses the lock and every later write together.
- **Pure decisions, executed twice.** Every refusal is a pure function over a snapshot or the environment (`decideWorkerStartup`, `decideSchemaVersion`, `decidePaidUnit`, `decideBeforeWork`, `planSettlement`). The offline suite and the mutation harness prove each one, and the PostgreSQL suite proves them end to end, because the mutation harness runs offline.
- **The worker re-checks the owner's caps too, not only its own ceilings.** The effective cap is design §6.2's, and the check is stricter than "the worker's own ceilings" alone.
- **An unacknowledged overrun stops every paid request, not only new confirmations.** Fail-closed; S6's confirmation will use the same query.
- **A preflight job is claimed first and closed at once** until S6 builds it, so the queue-order rule is real now.
- **The automotive facts are recorded under the CLI's default path,** so a Studio run exported as a folder replays with the CLI's defaults. Its identity is the sha256, which names the pinned fact version.
- **`SM2b` extended by exactly one named module.** S2's check said no Studio runtime module but the migration entry point reads the environment. The design requires the worker to read `STUDIO_DATABASE_URL` (§3.2). So `SM2b` now names the worker's entry point too, with its own exact list: the names present, `STUDIO_DATABASE_URL`, the two caps and `RENDER_GIT_COMMIT`, never `DATABASE_URL` and never a computed name. Every other Studio runtime module still reads nothing, and `migrate.ts`'s rule is unchanged. The check count stays 18.

**Material rejected alternatives.**

- **A worker that accepts `live` jobs with a refusing runner.** Rejected: the task requires a live job refused before any work, and that is stronger.
- **Testing the paid path only through pure functions.** Rejected: the durable-row ordering, the kill and the contention are database facts, so they are tested on disposable PostgreSQL with a replaying fake runner.
- **A new migration for the overrun acknowledgement.** Rejected: no schema change is in S3's lane, and an audit row expresses it.
- **Folding the worker's offline checks into S2's suite, to keep ten suites.** Rejected: they prove another module, and the mutation harness names one suite per mutation. PR #106 rejected an eleventh suite for a *workflow guard*, which belongs with workflow validation; the worker's suite is an offline test suite like the other ten, so [`AGENTS.md`](../AGENTS.md) now says eleven.
- **A new CI job for the worker's PostgreSQL suite.** Rejected: it would change the five-job shape the M1 readiness gate checks. It runs in the existing step.

**Automated validation.** *(Figures from this container: 4 CPUs, Node 22.22.0; PostgreSQL 16.15 and 18.6 from the official `postgres:16` and `postgres:18` images, as CI uses.)*

- **Build and typecheck:** `npm run build` and `npm run typecheck` pass; the type-level file `src/studio/worker/executionContext.typecheck.ts` is part of the typecheck.
- **`npm run test:offline`:** now **eleven suites**, all pass. Totals went from **1,843 to 1,872** checks: Content Intelligence 1,322 → 1,328, plus the worker's new offline suite of 23. The other suites are unchanged: posting 52, image 18, orchestrator 119, gate 56, API 51, render identity 1, ownership 112, interval 94, Studio database 18.
- **The Studio PostgreSQL suites under load:** 20 runs each on PostgreSQL **16.15** and **18.6**, with **0 crashes**. Each run passed the schema suite (217 checks) and the worker suite (19 checks). The first run was at load average 1.26 and the other nineteen at 5.37–9.86 on 4 CPUs. One worker-suite run takes about 12–17 s.
- **`npm run test:postgres`:** 208 checks on each server, unchanged.
- **`npm run test:payload-mutation`, unsharded:** **ALL PASS, 589 mutations (587 prohibited, 2 coordinated-authority), 4 workers, 51 captured targets, 27m34s.** Every harness invariant is green: `M-isolation`, `M-capture`, `M-kill`, `M0`, `M-inc0`, `M-order`, `M-shard`, `M-inc-restore` (243 of 243), `M-inc-sample` (4 of 243: M344, M354, M447, M498), `M-inc-end`, `M-end`, `M-inc-sample-fault`, `M-inc-tsc`, `M-inc-fault`, `M-copies`, `M-authority`.
  - Summed worker time: 613 suites 6,021 s; 243 builds 210 s; 243 restore builds 104 s.
  - An earlier full run on this code, 29m33s, caught 588 of the 589. It missed `M539` (the context gains an `approve` member), because `CS7b` then ran after the `CN` block, which crashes under that mutation. `CS7b` now runs on its own before any block that runs the CLI. Under `M539` alone it fails by name.
- **Each shard locally** (`--shard k/3`), all ALL PASS: shard 0 ran 197 mutations in 10m16s, shard 1 ran 196 in 9m55s, and shard 2 ran 196 in 9m09s. Each `M-shard` is green. The three id sets are disjoint, and together they are exactly `M1`–`M589`.
- **The golden test** (`node scripts/local/content-run-golden.mjs --base bec4a41 --allow-stack-frames`): 240 files and 84 scenarios, **0 differences**, 59 stack-frame-only stderr differences. The CLI's behaviour is unchanged.
- **The shard guard** (`ruby scripts/ci/check-mutation-shards.rb`): ALL PASS, all 11 injected faults refused. The workflow YAML parses.
- **Other checks:**
  - the M1 readiness offline suite: 461 checks;
  - the simulated dry run: OK;
  - the deployment-controller fixtures: PASS;
  - `npm audit --omit=dev`: 0 vulnerabilities;
  - Markdown links: 66 files;
  - environment coverage: 40 variables (was 38; `STUDIO_MAX_DAILY_USD` and `STUDIO_MAX_MONTHLY_USD` are added);
  - the sensitive scan: 223 tracked text files, manually triaged, nothing sensitive;
  - `git diff --check`: clean.
- **AgentShield 1.4.0** exited zero at **B/87**, with the same 18 findings as on `main` (9 medium, 9 low, none critical or high, none on a changed file).
- **What did not run:** no model, provider, live database, Render, approval, publication, deployment or release action.

**Production evidence:** none, and none is possible: nothing is deployed, and no live run is enabled.

**Rollback / recovery:** revert the commit. No state outside the repository changes. There is no Studio database.

**Security and privacy implications.** See [Security and continuity](SECURITY_AND_CONTINUITY.md).

- No credential, secret, dependency, provider call or network access was added. The worker's start-up refuses every live credential.
- Its logs carry ids, states, classes and counts only, never a goal, model text, fact text or an error message.
- Fixtures are synthetic: four plainly labelled automotive records, generated ids and addresses assembled at run time. The approved facts are read where they are, never copied into a fixture.

**Accepted limitations.**

- **No live run is possible until S6.** Every paid-path check is proven with a fake runner standing in for the provider.
- **The overrun acknowledgement has no screen yet.** S6's web writes the audit row; until then, the lock clears only by an owner's audited database statement.
- **`studio_findings` is not yet derived** from `06-final-critic.json`; S5 renders the findings, and that PR owns their derivation.
- **The wall-clock limit cannot cancel a request in flight.** It marks the run failed and stops further requests; the in-flight response is discarded, as design §5.3 accepts.
- **The heartbeat cannot prove the worker healthy to Render**, which gives background workers no health check (TO VERIFY); the web's two-minute rule (S4–S6) reads it.

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — **blocking**.
- **This PR's own CI:** each job's and each shard's duration on the final head, recorded in the PR and reconciled here with the merge SHA.
- The watch item on the PostgreSQL jobs' 30-minute limit (the cursor).
- Carried from S2: the web's least-privilege role (S8) and the purges (S4; a future reviewed migration).

**Documents updated:**

- this file: this record; PR #106's record moved to *Merged repository change awaiting rollout* and reconciled; the cursor; *Planned — Content Studio*;
- [Content Studio design](CONTENT_STUDIO_DESIGN.md) §5.4 (how C2 and C3 accept the context, dated) and the dated P2 pointer in [Production-wiring design](PRODUCTION_WIRING_DESIGN.md);
- [Environment](ENVIRONMENT.md), `.env.example` (`STUDIO_MAX_DAILY_USD`, `STUDIO_MAX_MONTHLY_USD`), [Security and continuity](SECURITY_AND_CONTINUITY.md), [Testing](TESTING.md), [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md), [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [`AGENTS.md`](../AGENTS.md) (eleven suites), and the mutation harness's header.

**Checked and deliberately left unchanged:**

- [Deployment control](DEPLOYMENT.md) and [Operations](OPERATIONS.md): no deployment, service or runbook changed;
- `render.yaml`, `scripts/ci/live-path-manifest.json`, every live service, every migration;
- the M1 readiness runner: the five jobs are unchanged.

### Mutation-harness shards — `--shard k/n` in the payload-contract mutation harness, three shards inside the three existing Node and PostgreSQL CI jobs, and a static guard; the Studio PostgreSQL suite's teardown race fixed; Content Studio S2 recorded as merged — `MERGED`

**Merge reconciliation (recorded 2026-10-01 by Content Studio S3, at the top of this file):** `MERGED` through [PR #106](https://github.com/Caposhi/GCD-Agents/pull/106) at `bec4a41449fac5fd50e631c62b9424924afe260c`. Its ordered parents are `fd88a2cb4d5079a7df321d3416f87bdd208a5974` (the PR #105 merge) and then reviewed head `217fbeabecf58d8c7bd720a06f6aae4b4fac4579`. Nothing followed it on `main` when S3 began.

- **PR CI:** final [run 36900834356](https://github.com/Caposhi/GCD-Agents/actions/runs/36900834356) (run 248) on head `217fbea` passed all five jobs on attempt 1:
  - *Node 22 offline quality gates* **12m51s** of 60 (17:38:16–17:51:07Z), with shard 0/3 **11m18s** (17:38:52–17:50:10Z);
  - *PostgreSQL 16 integration* **13m02s** of 30 (17:38:15–17:51:17Z), with shard 1/3 **11m36s** (17:39:39–17:51:15Z);
  - *PostgreSQL 18 integration* **12m40s** of 30 (17:38:15–17:50:55Z), with shard 2/3 **11m08s** (17:39:44–17:50:52Z);
  - *AgentShield 1.4.0* 11s; *Workflow and YAML static validation* 7s.
- **`main` push:** [run 36902831610](https://github.com/Caposhi/GCD-Agents/actions/runs/36902831610) (run 249) on `bec4a41` passed all five jobs on attempt 1:
  - *Node 22 offline quality gates* **11m18s** (17:54:16–18:05:34Z), with shard 0/3 **9m51s** (17:54:45–18:04:36Z);
  - *PostgreSQL 16 integration* **7m41s** (17:54:15–18:01:56Z), with shard 1/3 **6m20s** (17:55:33–18:01:53Z);
  - *PostgreSQL 18 integration* **10m11s** (17:54:16–18:04:27Z), with shard 2/3 **8m35s** (17:55:48–18:04:23Z);
  - *AgentShield 1.4.0* 9s; *Workflow and YAML static validation* 7s.
- **Deploy:** the `deploy-production` workflow, [run 36904248544](https://github.com/Caposhi/GCD-Agents/actions/runs/36904248544) (run 71), refused at *Refuse while production automation is disabled* (`RENDER_DEPLOY_AUTOMATION_ENABLED must be exactly true`), and its release job was skipped.
- **The first PR comment proposed a different patch, superseded by the merged fix.** PR #106's first comment, on run 36889093883, proposed a catch-all: an `'error'` listener on every pool that ignored every error (`pool.on("error", () => {})`). The merged fix (item 8) is narrower and was the owner's decision: every connection's socket is awaited before a drop, and the listener ignores only a `57P01` arriving after that pool's teardown began, failing the suite by name on anything else. The catch-all was never pushed.

**CI tooling, so not `DEPLOYED`; not `ENABLED`, not `PRODUCTION-VALIDATED`.** This paragraph discharges the blocking merge-SHA follow-up and the PR-CI follow-up below. It also **discharges *The mutation step's growth***: every shard's step took under 12 minutes on the PR and under 10 minutes on `main`, comfortably under the owner's 30-minute bar. Where the record says `IMPLEMENTED`, not merged, that its CI is recorded only in the PR, or that the growth item stays open, this paragraph supersedes it. **A new watch item replaces it** (the cursor): each PostgreSQL job's `timeout-minutes: 30` now binds before the quality job's 60, because each carries a shard; their totals were 13m02s and 12m40s on the PR and 7m41s and 10m11s on `main`. The record was written at the top of this file, so where it says *Next repository change* or *Planned — Content Studio* "below", those entries are now above it. The rest of this record is preserved as written at implementation.


**State:** `IMPLEMENTED` on branch `claude/vibrant-thompson-dhl0a5`, based directly on `origin/main` at `fd88a2cb4d5079a7df321d3416f87bdd208a5974` (the merge of PR #105, Content Studio S2). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** CI tooling and documentation only:

- `scripts/ci/payload-contract-mutation.mjs` (the `--shard` option and `M-shard`);
- `.github/workflows/ci.yml` (three shard steps and the guard);
- the new `scripts/ci/check-mutation-shards.rb`;
- one `package.json` script, `check:mutation-shards`;
- *(second commit, owner decision of 2026-10-01)* `src/studio/db/migrate.postgres.selftest.ts`: its pool teardown and error policy only (item 8 below).

No mutation, expected check, product source, `check(...)` name, check assertion, `SP` id, Studio migration, the Studio runner, prompt, skill, `config/` file, model, limit, migration, `render.yaml` or live-service file changed. **No CI job was added, removed or renamed.** The five job names, every `timeout-minutes` and every runner type are unchanged; only steps changed. No dependency was added. All six stages keep `executionEnabled: false`. The partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged, so no release is possible. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** [PR #106](https://github.com/Caposhi/GCD-Agents/pull/106), from `claude/vibrant-thompson-dhl0a5` into `main`. CI is recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Preflight (2026-10-01), all passed before any edit:**

- `origin/main` was exactly `fd88a2c…`, with ordered parents `0bb3f0b…` then `0dd2952…` and nothing after it.
- The working tree was clean.
- PR #105's final CI run, the `main` push run and `deploy-production` run 70 matched the owner's figures. They are recorded in S2's record below.
- The M1 readiness runner was read before any edit: it checks job names, status, conclusion and attempt only, never steps or durations (see *Material design decisions*).

**Why.** Run 246 measured the mutation step at **30m13s** on `main` for the same code that took **18m09s** on PR #105: runner speed varies by more than ten minutes. S3–S9 will add mutations. The two PostgreSQL jobs finish in about 1½ minutes and then sit idle. Splitting the harness across the three existing runners therefore divides the time with no new job, no paid runner and no change to any gate.

**Delivered.**

1. **`--shard k/n` in the harness.** It runs exactly the mutations whose zero-based index modulo `n` equals `k`. The selection depends on the index alone, so shards `0` to `n − 1` are disjoint and together run every mutation.
   - With no `--shard` the run is shard `0/1`: every mutation, as before. Local `npm run test:payload-mutation` is unchanged.
   - The harness refuses, with exit 2 before any work: a second `--shard`, any other option spelled `--shard…` (such as `--shard=1/3`), a value that is not `k/n` in whole numbers without leading zeros, `k ≥ n`, and `n` above the mutation count.
   - The worker count is capped by the shard's own mutation count. Workers take the shard's ids in order from one shared queue, as before.
2. **Every per-run proof runs in every shard:** `M0`, `M-isolation`, `M-kill`, `M-capture`, `M-inc0`, `M-inc-restore`, `M-inc-end`, `M-inc-fault`, `M-inc-tsc`, `M-inc-sample-fault`, `M-end`, `M-copies`, `M-authority` and `M-order`.
   - `M-order` checks the shard's own ids, printed in ascending order, each exactly once.
   - `M-inc-restore` counts the shard's own compiled mutations.
3. **`M-inc-sample` keeps the global seeded choice of four.** `GITHUB_SHA` is the same in every job of a run, so the three shards agree on the sample. Each shard compares only the sampled ids it owns: none, some or all four. The log line prints the global sample and the shard's share, and the check requires one comparison per owned id.
4. **A new check, `M-shard`.** The shard prints `k`, `n`, the total number of mutations and the exact ids it took from the queue (`M-shard: k=…, n=…; 533 mutations in all; this shard ran …: M…`). It asserts that `k` and `n` are valid (`0 ≤ k < n ≤` the mutation count). It also asserts that the zero-based indices it ran are exactly `k, k + n, k + 2n, …` (ids `M(k + 1)`, `M(k + n + 1)`, …), each once, and that their number equals the closed-form count `⌊(total − 1 − k) / n⌋ + 1`. That count is computed independently of the filter that chose them.
5. **CI runs three shards (`n = 3`) inside the existing jobs.**
   - **Shard 0** runs in *Node 22 offline quality gates*, replacing the full run. Its step is now named *Payload-contract mutation tests, shard 0/3*.
   - **Shard 1** runs as a new last step of *PostgreSQL 16 integration*, and **shard 2** of *PostgreSQL 18 integration*. The shard comes from the matrix: `include` entries add `mutation-shard: "1"` to the `"16"` combination and `"2"` to the `"18"` one. The step runs `npm run test:payload-mutation -- --shard ${{ matrix.mutation-shard }}/3`.
   - The job names are unchanged, because they name only `postgres-version`.
6. **A static guard, `scripts/ci/check-mutation-shards.rb`.** It runs in the existing workflow-validation step, renamed *Parse checked-in YAML and check the mutation shards*. Locally it runs as `npm run check:mutation-shards`, which needs Ruby.
   - It parses `ci.yml` and expands each job's matrix, including `include`. It substitutes `${{ matrix.KEY }}` per combination.
   - It fails if any command running the harness lacks exactly one `--shard k/n`, if the shards disagree on `n`, or if any `k` in `0..n−1` is not run exactly once across all jobs and matrix expansions.
   - It refuses rather than guesses on what it cannot resolve statically: a matrix expression, `exclude`, or an unresolved `${{ }}`.
   - It then proves itself with **eleven injected faults** applied to the workflow's own text. Each must be refused for its expected reason:
     - a shard missing;
     - a shard duplicated, two ways;
     - a different `n`;
     - `k ≥ n`;
     - the harness without `--shard`, in its own job and in another;
     - `--shard=`;
     - an undefined matrix key;
     - an unresolved expression;
     - `exclude`.

     Each fault's anchor must occur exactly once in the workflow, so a drifted workflow fails the self-test instead of passing it vacuously.
7. **Housekeeping.**
   - Content Studio S2 recorded as `MERGED` through PR #105 at `fd88a2c…`, with its runs. Its merge-SHA follow-up is discharged in its record below, in the cursor, and in [Status](STATUS.md), [Testing](TESTING.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md) and [Environment](ENVIRONMENT.md).
   - The owner's Render check of 2026-10-01 is recorded in [Status](STATUS.md).
8. **The Studio PostgreSQL suite's teardown race, fixed in this PR** (owner decision of 2026-10-01, a second commit on the same branch).
   - **Cause:**
     - In `pg-pool` 3.14.0, `pool.end()` resolves as soon as the pool's client list is empty. That happens synchronously in `_remove()`, before each `client.end()` has closed its socket.
     - The suite then called `Databases.drop()`, whose `pg_terminate_backend` could reach a backend that was still closing.
     - The server's `57P01` ("terminating connection due to administrator command") then arrived at a client that still carried the pool's idle listener. With no `'error'` listener on the pool, Node aborted with `Unhandled 'error' event`.
     - It crashed PR CI run 36889093883 (*PostgreSQL 16 integration*, after `SP6`), so the shard 1/3 step was skipped.
   - **Fix, in `src/studio/db/migrate.postgres.selftest.ts` only:**
     - Every pool now comes from `openPool`, and `closePool` ends it.
     - `closePool` marks the pool as closing, awaits `pool.end()`, and then awaits every connection the pool opened until its socket has closed (each client's `'end'`, recorded on the pool's `'connect'`). Only then is the database dropped.
     - Every pool has an `'error'` listener. It ignores only `57P01` arriving after that pool's teardown began, and records anything else: any other error, or `57P01` during the test body.
     - A recorded error fails the suite by name (`FAIL  pool errors — …`) and exits 1. A clean run prints `pool errors: none unexpected (N connection termination(s) ignored after teardown began)`.
     - No check's assertion, no `SP` id, no Studio migration and not the runner changed. A passing run still reports **217 checks**.
   - **The listener cannot hide a real failure.** `--inject-pool-termination` (a command-line flag, not an environment variable) terminates the wrong-name database pool's idle connection right after `SP1`, during the test body. On PostgreSQL 16 and 18 the suite then exited 1 with `FAIL  pool errors — 1 unexpected: wrong-name database: 57P01 terminating connection due to administrator command (during the test body)`, while all 217 checks passed.
   - **The stress result** is under *Automated validation*.

**Migrations / schema impact:** none.

**Material design decisions.**

- **Index modulo `n`, not contiguous ranges.** Each group is spread across all three shards, so no shard holds all of one group's cost (for example every Studio-suite mutation). Appending a mutation adds it to exactly one shard, and every existing id keeps its shard. Contiguous ranges would move ids between shards on every append.
- **The shard is bound to the matrix by `include`, not by an expression** such as `matrix.postgres-version == '16' && 1 || 2`. An `include` value is static data the guard can expand and check. An expression is opaque to it.
- **Shard 0 stays in the quality job, and shards 1 and 2 run after the PostgreSQL suites,** so the database steps still report first.
- **The guard is Ruby, in the workflow-validation job.** That job already parses the workflows with Ruby's standard YAML library (`check-yaml.rb`). The repository has no npm YAML parser, and adding a dependency was out of scope. Running the guard in the existing step adds no job and no step.
- **Each shard still proves itself in full.** Every per-run proof runs in every shard: the isolation and kill proofs, four first builds, the clean builds, the final builds and the injected faults. This costs a fixed one to two minutes per shard. The alternative, running those proofs in one shard only, would leave two jobs' results resting on another job's proofs.
- **No `--shard` means shard `0/1`,** so `M-shard` runs in a local full run too. Its count then equals the whole inventory.
- **The M1 readiness runner is unaffected.** `scripts/ops/m1-readiness/github.mjs` fixes `EXPECTED_JOB_NAMES` to the five job names. It checks only each job's `name`, `status`, `conclusion` and `run_attempt` (and `run_id`). Its job schema discards every other field, steps included (`{ unknown: "discard" }`). Nothing here changes a job name or a job count.

- **The Studio suite's pool policy (item 8) fails by name without changing the check count.** The failure is a named `FAIL  pool errors` line that adds to the failure count, so a passing run still reports exactly 217 checks, the owner's acceptance figure. `--inject-pool-termination` proves it can fire. It is a command-line flag rather than an environment variable, so the environment-coverage check and `.env.example` are unchanged.

**Material rejected alternatives.**

- **For the Studio suite's race:**
  - **A pool `'error'` listener that ignores everything.** Rejected: it would hide a real failure, such as a backend killed during the test body.
  - **Only waiting for the sockets, or only adding a listener.** Rejected: either alone leaves the other gap. The owner's decision required both.
  - **`DROP DATABASE … WITH (FORCE)`.** Rejected: it still terminates backends, so it is the same race.
  - **A new counted check for the policy.** Rejected: it would change the 217-check figure. The named failure line and the injected fault prove the same thing.
- **A new job per shard.** Rejected: the M1 readiness gate requires exactly five jobs, and the task forbade it.
- **A larger, paid runner, or a higher `timeout-minutes`.** Both are the owner's levers. Neither removes the variance or the growth.
- **Contiguous index ranges, or one shard per group.** Rejected as above: unbalanced, and unstable as mutations are appended. The legacy group alone holds more than half the inventory.
- **A Node guard with a hand-written YAML reader,** or a new YAML dependency. Rejected: fragile, or out of scope.
- **The guard as an eleventh `test:offline` suite.** Rejected: it would change the ten-suite contract that [`AGENTS.md`](../AGENTS.md) records. A workflow check belongs with workflow validation.

**Automated validation.** *(Figures from this container: 4 CPUs, Node 22.22.0, Ruby 3.3.6.)*

- Build and typecheck clean.
- **`npm run test:offline`**, **ten suites, all pass**, counts unchanged from S2: posting 52, image 18, orchestrator 119, gate 56, API 51, render identity one invariant-suite pass, ownership/recovery 112, content intelligence 1,322, interval monitor 94 and Studio database 18, for **1,843** checks.
- **The mutation harness, locally.** Every run used 4 workers and the default seed `gcd-payload-mutation:inc-sample:v1`, sampling `M344`, `M354`, `M447` and `M498`. Each ran in a copy whose `payload-contract-mutation.mjs` is byte-identical (sha256) to the final one.
  - **Unsharded:** **ALL PASS — 533 mutations, 4 workers, 29m06s**, with every harness invariant green. `M-shard` passed at `k=0, n=1`, with 533 ids; `M-inc-restore` 187 of 187; `M-inc-sample` 4 of 187. This run overlapped the other validation below, so its wall time is not a clean figure.
  - **Shard 0/3:** **ALL PASS — 178 of 533 mutations, 10m17s**. `M-inc-restore` 64 of 64; `M-inc-sample` share none, 0 comparisons.
  - **Shard 1/3:** **ALL PASS — 178 of 533 mutations, 10m21s**. `M-inc-restore` 65 of 65; `M-inc-sample` share `M344`, 1 comparison.
  - **Shard 2/3:** **ALL PASS — 177 of 533 mutations, 10m13s**. `M-inc-restore` 58 of 58; `M-inc-sample` share `M354`, `M447`, `M498`, 3 comparisons.
  - In every shard, `M-isolation`, `M-capture` (41 targets), `M-kill`, `M0`, `M-inc0`, `M-order`, `M-shard`, `M-inc-end`, `M-end`, `M-inc-sample-fault`, `M-inc-tsc`, `M-inc-fault`, `M-copies` and `M-authority` passed.
  - **Coverage, from the three `M-shard` lines:** the id sets are pairwise disjoint, and their union is exactly `M1`–`M533`, the unsharded run's ids. Every per-mutation result line (1,071 with the restore lines) is identical between the unsharded run and the union of the shards.
  - Each shard's summed worker time was about 2,030 suite-seconds, against 6,352 for the unsharded run. Its fixed proofs (4 first builds, 5 clean builds, 7 fault builds) took about 170 worker-seconds.
  - Local wall times are not CI projections; the CI figure decides.
- **The harness's refusals:** `--shard` with no value, `3/3`, `01/3`, `--shard=1/3`, two `--shard`s, `0/534`, `a/b`, `-1/3` and `--shards 0/3` each exited 2 before any work.
- **`npm run check:mutation-shards`** (Ruby 3.3.6) passed on the final `ci.yml`, covering shards 0, 1 and 2 of 3 exactly once, and refused all eleven injected faults for their expected reasons. `scripts/ci/check-yaml.rb` parsed `render.yaml` and every workflow. Pinned actionlint 1.7.12, with its checksum verified, exited 0.
- **`npm run test:postgres`** passed 208 checks on PostgreSQL 16.15 and 18.6 (the official `postgres:16` and `postgres:18` images, as CI uses): fresh 59, upgrade 80, durable 69.
- **`npm run test:studio-postgres`**, first commit (the unchanged S2 suite): 217 checks on both servers when it finished, but **4 of 14 runs aborted** with an unhandled pool `'error'` under CPU load (two of seven on each server), after `SP2` and after `SP5`. The same crash failed PR CI run 36889093883.
- **The race, fixed (item 8): a stress comparison under load.** **Required: 30 runs on each server with 0 crashes and 217 checks each, under load. Met.** Two rounds, each run with a payload-contract mutation shard alongside. Every iteration ran the old suite (from `7bf3f0b`, built in a scratch copy) and the fixed suite, interleaved.
  - **Isolated round** (the old suite on its own two servers, cleaned after each crash; the fixed suite on two servers never cleaned between runs). Load came from shard 1/3 plus a looping shard 0/3, a 1-minute load average of 11.4–17.8 on 4 CPUs.
    - **Fixed suite: PostgreSQL 16, 30 of 30 runs passed 217 checks, 0 crashes; PostgreSQL 18, 30 of 30 passed 217, 0 crashes.** Every run printed `pool errors: none unexpected (0 connection termination(s) ignored after teardown began)`. With the sockets awaited, no teardown-time `57P01` reached a pool at all.
    - **Old suite: PostgreSQL 16, 11 of 30 crashed; PostgreSQL 18, 10 of 30 crashed.** All crashed with `Unhandled 'error' event`.
  - **First round** (all four on two shared servers; shard 1/3 then 2/3 as load, load average 4.1–9.1):
    - The fixed suite passed **30 of 30 on PostgreSQL 16**, and **16 of 16 valid runs on PostgreSQL 18**.
    - The old suite crashed 2 of 30 times on each server.
    - Its PostgreSQL 18 crash in run 17 left a `gcd_studio` database behind. The suite's own safety check then refused every later PostgreSQL 18 run, old or fixed ("a database named gcd_studio already exists"). Those 14 fixed-suite runs were invalid, not failures, which is why the isolated round was run.
  - **Before and after, in all:**
    - **Before:** 4 of 14 early runs, 4 of 47 valid first-round runs and 21 of 60 isolated runs crashed, plus PR CI run 36889093883.
    - **After:** 0 crashes in 106 valid runs, every one at 217 checks.
- **The golden test** (`node scripts/local/content-run-golden.mjs --base fd88a2c --allow-stack-frames`): 240 files and 84 scenarios, **0 differences**, 59 stack-frame-only stderr differences.
- The M1 readiness offline suite (461 checks), the simulated dry run, the deployment-controller fixtures, Markdown links (66 files), environment coverage (38 variables), `npm audit --omit=dev` (0 vulnerabilities), `git diff --check` and the whole-tree whitespace check all passed.
- **The sensitive scan** passed. Every added line was triaged by hand: no email address, phone number, token, credential, URL with a secret, customer datum or facts-file content. The only URLs added are public GitHub Actions run and PR links.
- AgentShield 1.4.0 exited zero at **B/87** with the same 18 findings (9 medium, 9 low; no critical or high). None names a changed file.
- **The second commit (the race fix), validated 2026-10-01:**
  - build and typecheck clean;
  - `npm run test:offline`, ten suites with the same counts (1,843 checks);
  - the stress comparison above, and `--inject-pool-termination` failing by name on both servers;
  - `npm run test:postgres`, 208 checks on PostgreSQL 16.15 and 18.6;
  - **shard 1/3 run once on the final code: ALL PASS — 178 of 533 mutations, 12m40s**, under the stress load;
  - Markdown links, environment coverage (38 variables, unchanged: the injection is a command-line flag), the sensitive scan, and `git diff --check`.
- **CI on the final head** is recorded in the PR.

**Production evidence:** none, and none is possible. This is CI tooling.

**Rollback / recovery:** revert the commit. No state outside the repository changes.

**Security and privacy implications.**

- The harness stays offline in every shard: no network, database, provider or credential.
- In the PostgreSQL jobs, the shard step carries no step-level environment. The database URLs are set only on the earlier steps that use them, so the harness and the Studio offline suite never see `DATABASE_URL`.
- Every copy is still a disposable no-Git directory in the runner's temporary space. `M-isolation`, `M-kill` and `M-authority` prove the checkout untouched in each job.
- No secret, credential or dependency was added.

**Accepted limitations.**

- **Each shard pays the fixed per-run proofs,** so three shards together take more total CPU than one full run. Wall time is what is divided.
- **Shards are balanced by count, not by cost.** A shard that draws more compiled or Studio-suite mutations takes a little longer.
- **The PostgreSQL jobs' `timeout-minutes` is 30**, against 60 for the quality job. Shards 1 and 2 share that 30 minutes with about 1½ minutes of database suites, so as mutations grow it is the nearest limit. Raising `n` would mean more than one shard step in a job, which the guard already allows.
- **Cross-shard coverage is proven by construction and by the guard, not by any one process.** Each shard's `M-shard` line lists its ids, so the union can be checked from the three logs.
- **The guard supports the matrix forms this workflow uses.** It refuses any other form until it is taught that form.

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — **blocking**.
- **This PR's own CI.** Each shard's step and each job's duration on the final head, recorded in the PR and reconciled here with the merge SHA. *The mutation step's growth* (the cursor) stays open until **all three shards have a CI figure from this PR**, and is discharged only if each is comfortably under 30 minutes.
  - *First head `7bf3f0b`, [run 36889093883](https://github.com/Caposhi/GCD-Agents/actions/runs/36889093883) (run 247):* shard 0/3 took **11m19s** (quality job 12m45s) and shard 2/3 **10m35s** (PostgreSQL 18 job 11m58s). *PostgreSQL 16 integration* failed in the Studio suite (the race, item 8), so shard 1/3 has no CI figure yet. AgentShield took 26s and workflow validation 9s.
- **The mutation step's growth**, carried in the cursor until then.
- ~~**A race in S2's disposable-PostgreSQL suite, found during this change's validation and not fixed here.**~~ **Fixed in this PR** (item 8; owner decision of 2026-10-01). *Cause:* `pool.end()` resolves before the pool's sockets close, so `Databases.drop()`'s `pg_terminate_backend` could reach a closing connection, and no pool had an `'error'` listener. It crashed 4 of 14 local runs under load and PR CI run 36889093883. *Stress result:* 30 of 30 runs on each of PostgreSQL 16 and 18 passed 217 checks with 0 crashes, under a load average of 11–18, against 21 crashes in 60 runs of the old suite on the same load (see *Automated validation*).

**Documents updated:**

- this file: this record; S2's record moved to *Merged repository change awaiting rollout*, with its merge and CI reconciled; the cursor; *Planned — Content Studio*;
- [Testing](TESTING.md), [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md), [Environment](ENVIRONMENT.md), and the mutation harness's header.

**Checked and deliberately left unchanged:**

- [`AGENTS.md`](../AGENTS.md): still ten `test:offline` suites;
- [Deployment control](DEPLOYMENT.md): no deployment changed;
- [Content Studio design](CONTENT_STUDIO_DESIGN.md): a dated design;
- [M1 readiness runner](M1_READINESS_RUNNER.md): the five jobs are unchanged;
- `scripts/ops/m1-readiness/**`.

### Content Studio S2 — the Studio schema and migrations, kept strictly apart from the live ones; `M-inc-sample` in the mutation harness; PR #104 recorded as merged — `MERGED`

**Merge reconciliation (recorded 2026-10-01 by the mutation-harness shards change at the top of this file):** `MERGED` through [PR #105](https://github.com/Caposhi/GCD-Agents/pull/105) at `fd88a2cb4d5079a7df321d3416f87bdd208a5974`. Its ordered parents are `0bb3f0b80f657981c69b524455e05c52b38ec65b` (the PR #104 merge) and then reviewed head `0dd29527061b482f8fd7fb0fc505f8b1bf11e1f0`. Nothing followed it on `main` when the shard change began.

- **PR CI:** [run 36864852379](https://github.com/Caposhi/GCD-Agents/actions/runs/36864852379) (run 245) on head `0dd2952` passed all five jobs on attempt 1:
  - *Node 22 offline quality gates* **19m42s** of 60 (12:53:44–13:13:26Z), with the mutation step **18m09s** (12:54:21–13:12:30Z);
  - *PostgreSQL 16 integration* 1m23s, and *PostgreSQL 18 integration* 1m22s;
  - *AgentShield 1.4.0* 9s, and *Workflow and YAML static validation* 5s.
- **`main` push:** [run 36868582727](https://github.com/Caposhi/GCD-Agents/actions/runs/36868582727) (run 246) on `fd88a2c` passed the same five jobs on attempt 1:
  - quality job **31m45s** (13:25:37–13:57:22Z), mutation step **30m13s** (13:26:11–13:56:24Z);
  - PostgreSQL 16 1m25s, PostgreSQL 18 1m23s;
  - AgentShield 10s, and workflow validation 6s.
- **Against the owner's 30-minute bar** for the CI mutation step:
  - 18m09s on the PR, under the bar;
  - 30m13s on `main`, 13 seconds over it, **for the same code**.

  The difference, more than ten minutes, is attributed to runner variance. It is the reason for the shard change at the top of this file.
- **Deploy:** the `deploy-production` workflow ([run 70](https://github.com/Caposhi/GCD-Agents/actions/runs/36872573564)) passed "Refuse non-main, non-push, or unsuccessful CI runs" and refused at "Refuse while production automation is disabled". "Select exact release commit" and the "Serialized API, worker, scheduler release" job were skipped. No release.
- **Durations** come from the Actions jobs API, not from the harness's summary line.

**Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`; no Studio database exists, and nothing has been migrated anywhere but disposable test servers.** This paragraph discharges the blocking merge-SHA follow-up and the PR-CI follow-up below. Where the record says `IMPLEMENTED`, not merged, or that its CI is recorded only in the PR, this paragraph supersedes it. **The mutation step's growth stays open** (the cursor). The record was written at the top of this file, so where it says *Planned — Content Studio* "below", that entry is now above it. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/quirky-mendel-1w4273`, based directly on `origin/main` at `0bb3f0b80f657981c69b524455e05c52b38ec65b` (the merge of PR #104). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`. No Studio database exists, and nothing has been migrated anywhere but disposable test servers.** Unchanged: `state/migrations/**`, `src/state/migrate.ts`, `render.yaml`, every live-service file (`src/api/**`, `src/worker/**`, `src/scheduler/**`, and every module in `scripts/ci/live-path-manifest.json`: no live-path edit is declared), `config/`, prompts, skills, models and every `executionEnabled` value (all six `false`). No npm dependency was added: the runner uses the existing `pg`. The five CI job names, every `timeout-minutes` and every runner are unchanged. The partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged, so no release is possible. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** [PR #105](https://github.com/Caposhi/GCD-Agents/pull/105), from `claude/quirky-mendel-1w4273` into `main`. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Revision of 2026-10-01 (owner decision): `M-inc-sample` became a rotating sample of four.** The first head, `e7a4650`, sampled 31 of 187 compiled mutations (each group's first and every eighth after it). Its [CI run 36780160805](https://github.com/Caposhi/GCD-Agents/actions/runs/36780160805) passed all five jobs on attempt 1, but the **mutation step took 32m15s** and the **quality job 33m48s** — over the owner's 30-minute bar for the step. (PostgreSQL 16 took 1m29s and PostgreSQL 18 1m27s, the new Studio step 3 s in each.) The ~28½-minute projection made before that push, from local worker-seconds, was wrong and is withdrawn. The owner then decided to shrink the sample:

- **The sample is now exactly four compiled mutations per run, each from a different group,** chosen deterministically from a seed: `GITHUB_SHA` when it is set (so successive commits sample different mutations), otherwise the documented constant `gcd-payload-mutation:inc-sample:v1`. The harness prints the seed and the sampled ids.
- **Why four is enough:**
  - each clean build costs about 10 CPU-seconds (about 15 s of wall time under 4-way load);
  - the risk it guards against — an incremental `dist/` that differs from a clean build of the same mutated sources — is low, because every restore is already verified byte for byte against a clean build (`M-inc-restore`, 187 of 187), as is each copy's first and last build (`M-inc0`, `M-inc-end`);
  - the rotation covers more mutations over successive commits than any one run does.
- `M-inc-sample-fault` and every other check are unchanged.
- **The new figures:** locally **ALL PASS — 533 mutations, 4 workers, 31m40s** (seed `gcd-payload-mutation:inc-sample:v1`, the default; sampled `M344`, `M354`, `M447`, `M498`, from the field-margin, critic-policy, packaging-`claimUse`-cap and contact-in-overlay groups); six sample clean builds (four sampled, two in `M-inc-sample-fault`) took 61 worker-seconds, against 489 for the first sample; CI on the revised head is recorded in the PR and reconciled here with the merge SHA.

**Specification.** [Content Studio design](CONTENT_STUDIO_DESIGN.md) §3.2, §3.7, §4 (every table and invariant), §4.7, §5.3, §6.1–§6.2, §8.5 (the staging row), §11.1a and §10's S2 row, under the owner's authorization of 2026-09-30.

**Preflight (2026-09-30), all passed before any edit:** `origin/main` was exactly `0bb3f0b…` with ordered parents `c1c19f4…` then `e24835f…` and nothing after it; the working tree was clean. PR #104's final CI run 36756156748, the `main` push run 36769163023 and `deploy-production` run 69 were verified, and are recorded in PR #104's record below.

**Delivered.**

1. **The schema, design §4 exactly** — `studio/migrations/0001_studio_identity_and_tripwire.sql` (the tripwire `_migrations`, the `studio_schema_migrations` ledger, the `studio_database_identity` singleton) and `studio/migrations/0002_studio_schema.sql` (every §4 table and the §8.5 staging row `studio_fact_uploads`). Every database-side invariant §4 states is a constraint or a trigger. They include:
   - owner-domain emails, the last-owner protection (race-safe) and an immutable `google_sub`;
   - single-use login attempts;
   - immutable terminal run states, no self-ancestry and immutable artifacts;
   - an append-only audit log and ledger;
   - restrictive fact-version references and single-use quotes;
   - one job per run, and the singletons;
   - the staging row.

   The ledger's day and month come from the run's `reserve` entry, computed in `America/New_York`. `studio_settings` is seeded with the owner's §11.1a caps (**$50 a day, $200 a month**) and `scheduled_runs_enabled = false`; the migration's comments say these are owner-editable defaults. Each invariant is listed with the check that proves it in [Data model](DATA_MODEL.md#content-studio-schema--the-separate-gcd_studio-database), and so are the §4 rules that are application-side by nature, each with its owning PR.
2. **The five separations of §3.7:**
   - separate files, in `studio/migrations/`, which the live runner cannot see;
   - `src/studio/db/migrate.ts` (entry point) and `runner.ts`, with the `studio_schema_migrations` ledger recording each file's **sha256** and refusing a recorded file whose bytes have changed, or that is missing;
   - the runner reads **only `STUDIO_DATABASE_URL`** and refuses before connecting if `DATABASE_URL` is present at all, even empty;
   - identity checks made with read-only probes before any other statement: `current_database()` is `gcd_studio`, no live-schema table exists (all ten live tables, not only the design's three examples, checked against `state/migrations/` by `SM6`), a `_migrations` table carries the tripwire, and once created the `studio_database_identity` row matches;
   - the **tripwire** `_migrations` table in `0001`, whose `name` column has `CONSTRAINT studio_tripwire_refuses_live_runner CHECK (false)`.
3. **`npm run studio:migrate`**, and `STUDIO_DATABASE_URL` in `.env.example` as a local `gcd_studio` placeholder, so environment coverage checks it (38 variables, from 35).
4. **Tests.**
   - `npm run test:studio-postgres` — the disposable-PostgreSQL suite, **217 checks** on each of PostgreSQL 16 and 18 (runner 9, cross 6, schema 202). It applies every migration, proves every §4 invariant by attempting the forbidden write (`SP101`–`SP302`), re-runs the runner and proves it idempotent, refuses a changed and a missing migration file, and **runs both runners cross-wise**: the Studio runner against a live-migrated database is refused after read-only probes alone, and the unchanged live runner against a Studio-migrated database fails on the tripwire with nothing committed.
   - `npm run test:studio-db` — the offline suite, **18 checks** (`SM1`–`SM6c`): the environment refusal, the file-sha256 ledger, the identity decisions, refusal before any statement, and drift checks. It is the tenth `test:offline` suite.
   - **CI:** one new step, *Content Studio schema disposable PostgreSQL suite*, inside the existing `postgres-integration` job for 16 and 18. No job was added, renamed, removed or re-timed.
   - **Mutations `M523`–`M533`**, the Content Studio S2 group, each run against the Studio offline suite and each failing a named check: the `DATABASE_URL` refusal removed (`SM1`, `SM1a`); the entry point no longer reporting `DATABASE_URL`'s presence (`SM1a`, `SM2b`), falling back to its value (`SM2b`) or reading a look-alike variable first (`SM2a`, `SM2b`); the migration-sha256 refusal removed (`SM3`); and the identity decision accepting another database name (`SM4`), ignoring live-schema tables (`SM4a`, `SM5`), accepting a live ledger (`SM4b`) or a missing identity row (`SM4c`), the probe reading any `_migrations` as the tripwire (`SM5`), and identity decided only after statements have run (`SM5`). **533 mutations in all** (531 prohibited, 2 coordinated-authority), over 41 captured paths.
5. **`M-inc-sample`, closing the gap from PR #104's review.** For a deterministic, rotating sample of **exactly four compiled mutations, each from a different group**, chosen from a seed (`GITHUB_SHA` when set, otherwise `gcd-payload-mutation:inc-sample:v1`; the harness prints the seed and the ids), the harness also builds the **mutated** sources with a clean `tsc` into the worker's own `sample-dist/` and requires it to be byte-identical to the incremental `dist/` the suite ran against. `M-inc-sample-fault` proves the comparison can fail: a source edited and not rebuilt is reported as exactly one differing file, nothing once the incremental compiler has built it, and the copy is then restored and rebuilt to the clean build exactly. Nothing else in the runner's build or comparison logic changed. *(Until the revision of 2026-10-01 above, the sample was each group's first compiled mutation and every eighth after it: 31 of 187.)*
6. **Housekeeping:** PR #104 recorded as `MERGED` at `0bb3f0b…` with its runs (below), and its merge-SHA follow-up discharged here, in the cursor, in [Status](STATUS.md), [Testing](TESTING.md), [README](../README.md), [AI handoff](AI_HANDOFF.md) and [Security and continuity](SECURITY_AND_CONTINUITY.md).

**Migrations / schema impact:** **no live migration.** Two new Studio migrations for a database that does not exist yet (`gcd_studio`, created at O3). Neither live runner nor any live table is touched; the live controller's `state/migrations/**` guard is unaffected, so this change is not migration-bearing for any live release.

**Material design decisions.**

- **The ledger is created by migration 0001 itself**, and the runner records 0001 in the same transaction. The runner therefore sends no DDL of its own, and on a live database it sends nothing but `SELECT`s before refusing (`SM5`, `SP5`).
- **Every refusal is a pure decision over data** (`resolveStudioDatabaseUrl`, `planStudioMigrations`, `decideStudioIdentity`), so each is testable offline and each has a mutation. The same probe and decision run again inside each file's transaction, under a Studio-only advisory lock (`gcd-studio:migration-runner:v1`); a runner that loses a race refuses rather than apply twice (`SP7`).
- **`DATABASE_URL` is refused whatever its value, even empty**, following §3.2's "whatever its value". A shell that sources `.env.example` whole is therefore refused, which [Environment](ENVIRONMENT.md) says.
- **Each Studio SQL file also refuses by itself to run outside `gcd_studio`** (a `DO` block), whoever runs it and however.
- **The last-owner rule is race-safe:** the trigger locks the remaining active owners before counting, so of two concurrent demotions the second waits and is then refused (`SP123`).
- **No self-ancestry without a graph walk:** a run's source must already exist when the run is inserted, and `source_run_id` never changes afterwards, so no statement can create a cycle — even two rows naming each other in one `INSERT` (`SP193`).
- **Decisions where §4 was silent**, each the stricter reading and each recorded in [Data model](DATA_MODEL.md#content-studio-schema--the-separate-gcd_studio-database):
  - a finished run is frozen in full, not only its state, except the owner's tombstone (`deleted_at`, `deleted_by`, the one pair of columns added for §4.7's deletion);
  - a job's states are `queued`, `running`, `finished`, `cancelled` and `expired`, and only a free preflight job has no run, because §6.1's preflight runs before any run exists;
  - a quote may be requested only for an active owner or runner (§6.3);
  - a fact version can be created only from the staged upload's exact bytes;
  - a run takes no new artifact once finished, and its request rows freeze with it;
  - the ledger holds at most one settlement (a release or an overrun) per run, a release never exceeds the reservation, and the database sets `created_at`, so a reservation cannot be back-dated onto an earlier day;
  - `charged_usd` is a generated column (a request's measured cost once completed with a known cost, else its full ceiling);
  - a 1 MiB bound for §8.5's proposed "1 MB".
- **The disposable suite creates a database named exactly `gcd_studio`**, because the runner's name check is the real constant, and refuses to start if one exists.
- **The mutation harness gained per-mutation suites** (`suite`), so the S2 mutations run the Studio offline suite. `M0` and `M-end` now require every suite a mutation runs to pass. This is part of the Tests scope, not of `M-inc-sample`.
- **`CS2`'s S1-era precondition "no file under `src/studio/` exists" was narrowed** to "the only Studio tree is `src/studio/db/**`", because S2 makes the old wording false by design. The invariant it guards is unchanged, and `CS2` keeps its id: no Studio file outside `src/studio/worker/**` imports the content-run library.

**Material rejected alternatives.**

- **A runner that creates its ledger with `CREATE TABLE IF NOT EXISTS`, as the live one does.** Rejected: it would be DDL before the identity check, and it would create a Studio table in a live database.
- **Enforcing any §4 invariant in application code instead of the database.** Forbidden by the task. The rules left to the application are application-side by nature, and each is recorded with its owner.
- **Parameterizing the expected database name for tests.** Rejected: the suite must prove the real constant.
- **A recursive ancestor walk for self-ancestry.** Rejected as redundant, given the rule that the source must exist first and never change, which is sufficient and cheaper.
- **Refusing `DATABASE_URL` only when non-empty.** Rejected: §3.2 says whatever its value.
- **A least-privilege database role for the web in S2** (proposed in §9.1). Deferred, not rejected: whether Render's plan allows a second role is TO VERIFY, and roles are created outside migrations. The single-role limitation of §11.2 therefore stands.
- **Building every mutated `dist/` cleanly.** Rejected for cost: a clean `tsc` is about 16 CPU-seconds, and there are 187 compiled mutations. The first, one-in-eight sample (31 builds, 474 worker-seconds locally) took the CI mutation step to 32m15s, over the 30-minute bar, so the sample is now four rotating builds (above).
- **A separate CI job, or a new npm dependency such as a migration library.** Forbidden by the task and by the M1 readiness gate's five jobs.

**Automated validation.** *(Every figure is from this container: 4 CPUs, Node 22.22.2.)*

- Build and typecheck clean.
- **`npm run test:offline`**, **ten suites, all pass:**
  - before (at `0bb3f0b`): posting 52, image 18, orchestrator 119, gate 56, API 51, render identity one invariant-suite pass, ownership/recovery 112, content intelligence 1,322 and interval monitor 94, for **1,825** checks;
  - after: the same nine counts, unchanged, plus **Studio database 18**, for **1,843** checks.

  `CS2`'s name changed (see above), and every other check kept its name.
- **`npm run test:studio-postgres`**, locally: **PostgreSQL 16.13: 217 checks, all pass**, and **PostgreSQL 18.6: 217 checks, all pass**, each in about 4 s.
  - The 18.6 server was the relocatable `embedded-postgres-binaries` 18.6.0 build from Maven Central; `apt.postgresql.org` is blocked here.
  - CI runs the official `postgres:16` and `postgres:18` images.
- **`npm run test:postgres`**, unchanged: 208 checks on each of PostgreSQL 16.13 and 18.6 (fresh 59, upgrade 80, durable 69).
- **`npm run test:payload-mutation`**, locally, 4 workers, on the revised code: **ALL PASS — 533 mutations (531 prohibited, 2 coordinated-authority), 4 workers, 41 captured paths, 31m40s**, with every harness invariant green (`M-isolation`, `M-capture`, `M-kill`, `M0`, `M-inc0`, `M-order`, `M-inc-restore` 187 of 187, `M-inc-sample` 4 of 187, `M-inc-end`, `M-end`, `M-inc-sample-fault`, `M-inc-tsc`, `M-inc-fault`, `M-copies`, `M-authority`). The log printed `M-inc-sample seed: gcd-payload-mutation:inc-sample:v1 (default); sampled: M344, M354, M447, M498 (field margin, critic policy, packaging claimUse cap, contact in overlay)`. Summed worker time: 549 suites 6,853 s; 187 builds 243 s; 187 restore builds 138 s; 6 sample clean builds 61 s (four sampled, two in `M-inc-sample-fault`; 489 s for 33 on the first head); 5 clean builds 88 s; 4 first builds 94 s; fault builds 20 s. This container's speed varies between sessions (a suite run averaged 12.5 s here, 16 s on the first head's run), so local wall times are not CI projections; the CI figure decides. As before, the harness ran in a copy of the final code so documentation could be edited meanwhile. *(On the first head, with the 31-mutation sample: ALL PASS — 533 mutations, 4 workers, 40m52s, `M-inc-sample` 31 of 187. Its CI mutation step was 32m15s; see the revision above.)*
- **The golden test** (`node scripts/local/content-run-golden.mjs --base 0bb3f0b --allow-stack-frames`): 240 files and 84 scenarios, **0 differences**, 59 stack-frame-only stderr differences.
- The M1 readiness offline suite (461 checks), the simulated dry run, the deployment-controller fixtures, Markdown links (66 files), environment coverage (38 variables), the sensitive scan (209 tracked text files, every added line triaged by hand: no email address, phone number, token, credential, booking link, customer datum or facts-file content; fixture addresses are assembled at run time), `npm audit --omit=dev` (0 vulnerabilities), `git diff --check`, and the whole-tree whitespace check.
- AgentShield 1.4.0: exited zero at **B/87** with the same 18 findings (9 medium, 9 low; no critical or high).
- CI on the final head is recorded in the PR.

**Production evidence:** none, and none is possible. No Studio database exists, and creating one is O3, after the freeze (design §10).

**Rollback / recovery:** revert the commit. No live state changed and no Studio database exists. Once one does, a reversal would be a documented SQL file outside `studio/migrations/`, applied by hand, never a down migration.

**Security and privacy implications.**

- The Studio runner cannot reach the live database by accident, and the live runner cannot write the Studio's (above).
- No credential, secret or dependency was added. `.env.example` holds a placeholder only.
- The suites run only against loopback disposable servers, and refuse otherwise.
- Test fixtures are synthetic: hashes of fixed strings, generated ids, and fixture addresses assembled at run time. No facts-file content, customer datum or booking link is in any fixture or document.
- **Still open:** the single database role (§11.2).

**Accepted limitations.**

- **Not every §4 rule is the database's.** The application-side ones are listed with their owners in [Data model](DATA_MODEL.md#content-studio-schema--the-separate-gcd_studio-database): hashing the real values, rate limits, the bootstrap email, the periodic purges, what an artifact's bytes are, the worker-only writes (the single role), and audit-detail content.
- **The two-year purge of the audit log and ledger does not exist.** Both refuse every delete today; the purge must come as a separately reviewed migration or function.
- **`pg` may take connection parts missing from the URL** (a password, say) from `PG*` variables. The target is exactly `STUDIO_DATABASE_URL`'s (`SM2a`), and the identity check refuses any database but a Studio `gcd_studio`.
- **The disposable suite needs a server without a `gcd_studio` database,** and it refuses one that has it. CI's service containers are fresh for every job.
- **`M-inc-sample` is a sample of four per run.** A run checks four mutated `dist/`s; the rotation covers others on later commits, and every restore is still compared (`M-inc-restore`).
- **The mutation step grows:** 11 more mutations and four sampled clean builds per run. With the first sample of 31 the CI step was 32m15s; the revised figure is recorded in the PR.

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — **blocking**.
- **This PR's own CI:** the quality job, the mutation step and the two PostgreSQL jobs on the final head, against the owner's 30-minute bar for the mutation step. They are recorded in the PR and reconciled here with the merge SHA.
- **The mutation step's growth**, carried in the cursor.
- **The least-privilege database role** (design §9.1): S8, once Render's plan is known.
- **The login-attempt and session purges** (S4), and **the two-year retention purge** (a future reviewed migration).
- **The design's "TO VERIFY by execution in S2"** (§3.7, separation 5) is now verified. The design, a dated document, is deliberately not edited, as S1 left it.

**Documents updated:**

- this file: this record; PR #104's record moved to *Merged repository change awaiting rollout*, with its merge and CI reconciled; the cursor; *Planned — Content Studio*;
- [Data model](DATA_MODEL.md) (the Studio schema, separated from the live one), [Testing](TESTING.md), [Environment](ENVIRONMENT.md), [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Architecture](ARCHITECTURE.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), [`AGENTS.md`](../AGENTS.md) ("currently ten suites"), `.env.example`, and the mutation harness's header.

Checked and deliberately left unchanged: [Content Studio design](CONTENT_STUDIO_DESIGN.md) (a dated design), [Deployment control](DEPLOYMENT.md) and [Operations](OPERATIONS.md). No deployment or operation changed; `npm run studio:migrate` becomes an operator command only with S8's release checklist.

### Mutation-harness speed-up — incremental, verified builds in the payload-contract mutation harness; Content Studio S1 recorded as merged — `MERGED`

**Merge reconciliation (recorded 2026-09-30 by Content Studio S2, then at the top of this file and now the record above):** `MERGED` through [PR #104](https://github.com/Caposhi/GCD-Agents/pull/104) at `0bb3f0b80f657981c69b524455e05c52b38ec65b`, whose ordered parents are `c1c19f4b89bd405b854e44bd0aa863de24f3d483` (the PR #103 merge) and then reviewed head `e24835faeb5d07f7b8d115a7946deffab9b7884e`, with nothing after it on `main` when S2 began.

- **PR CI:** [run 36756156748](https://github.com/Caposhi/GCD-Agents/actions/runs/36756156748) (run 242) on head `e24835f` passed all five jobs on attempt 1: *Node 22 offline quality gates* **28m25s** of 60 (18:06:11–18:34:36Z), with the mutation step **26m59s** (18:06:40–18:33:39Z); *PostgreSQL 16 integration* 1m25s; *PostgreSQL 18 integration* 1m19s; *AgentShield 1.4.0* 11s; *Workflow and YAML static validation* 6s.
- **`main` push:** [run 36769163023](https://github.com/Caposhi/GCD-Agents/actions/runs/36769163023) (run 243) on `0bb3f0b` passed the same five jobs on attempt 1: quality job **27m59s** (19:56:43–20:24:42Z), mutation step **26m34s** (19:57:12–20:23:46Z); PostgreSQL 16 1m29s, PostgreSQL 18 1m27s; AgentShield 14s; workflow validation 6s.
- **Against the owner's 30-minute bar** for the CI mutation step: 26m59s and 26m34s, both under it.
- **Deploy:** the `deploy-production` workflow ([run 69](https://github.com/Caposhi/GCD-Agents/actions/runs/36772435277)) passed "Refuse non-main, non-push, or unsuccessful CI runs" and refused at "Refuse while production automation is disabled"; "Select exact release commit" and the "Serialized API, worker, scheduler release" job were skipped. No release.
- **Durations** come from the Actions jobs API, not from the harness's summary line.

**CI tooling, so not `DEPLOYED`; not `ENABLED`, not `PRODUCTION-VALIDATED`.** This paragraph discharges the blocking merge-SHA follow-up and the PR-CI follow-up below; where the record says `IMPLEMENTED`, not merged, or that its CI is recorded only in the PR, this paragraph supersedes it. **The mutation step's growth stays open** (the cursor). The accepted limitation "a mutated `dist/` is not itself compared with a clean build" is narrowed by S2's `M-inc-sample`. Earlier records' dated notes that call this change "at the top of this file, `IMPLEMENTED`" predate its merge. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/mutation-step-perf-dao9sc`, based directly on `origin/main` at `c1c19f4b89bd405b854e44bd0aa863de24f3d483` (the merge of PR #103, Content Studio S1). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** The change is CI tooling (`scripts/ci/payload-contract-mutation.mjs`) and documentation. No product source, test, `check(...)` name, prompt, skill, `config/` file, model, limit, migration, `render.yaml`, workflow, `timeout-minutes`, CI job or runner type changed. All six stages keep `executionEnabled: false`. The partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged, so no release is possible. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** opened from `claude/mutation-step-perf-dao9sc` into `main`; its number and CI run are recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Why.** On `main` at `c1c19f4` ([run 241](https://github.com/Caposhi/GCD-Agents/actions/runs/36716816644)), the mutation step took **38m47s** of the quality job's **40m12s**, against `timeout-minutes: 60`. Two PRs earlier it took about 23 minutes, and every Studio PR adds mutations. A timeout fails attempt 1 of the quality job, which the M1 readiness gate cannot accept. A sixth job would not help, because the gate counts exactly five. Every mutation of compiled source ran a full, non-incremental `tsc` (about 10 CPU-seconds), and its restore forced a second one.

**Owner decisions (2026-09-30).**

1. The task first set a target of **≤ 20 minutes** for the CI mutation step, and required stopping before pushing if it could not be met. The first full local run after the change took **23m27s**. That projects to about 26½ minutes on CI, so work stopped before pushing and the options were reported.
2. The owner then revised the target to **≤ 25 minutes**, projected with the local-to-CI ratio of `main` run 241 against the local baseline (38m47s ÷ 34m22s = **1.1285**). The owner also asked for one more injected-fault check: `M-inc-tsc`, below.
3. Before that run finished, the owner **replaced the projection rule**. Push and open the PR if the full local run on the final code is ALL PASS with every invariant intact (including `M-inc0`, `M-inc-restore`, `M-inc-end`, `M-inc-fault` and `M-inc-tsc`), whatever the projection. **The merge decision is made on the actual CI figure, with a bar of 30 minutes for the mutation step.** The final-code local run took **25m41s**, which projects to about 29 minutes at 1.1285. It passed every invariant, so the PR was opened.

**Measured first — the profile, before and after.** Before: 66 mutations, every eighth id from `M1` to `M521`, so every group is sampled. They ran on unchanged `main` with 4 workers, in a scratch-instrumented copy of the harness. After: the harness's own `--profile` output. Shares are of summed worker time.

| | Build | Restore rebuild | Suite | Other |
|---|---:|---:|---:|---:|
| Before, 66-mutation sample | 29% | 7% | 64% | ≈0% |
| After, the same 66 | 2.5% | 0.7% | 96.8% | ≈0% |
| After, all 522 | 3.1% | 1.7% | 95.1% | ≈0% |

Per compiled mutation, the build went from **11.7 s to 1.0 s**, and its restore from about 10 s (a full rebuild, often paid by the next mutation) to **0.6 s**. The suite took about 9.7–10.8 s under 4-way load both before and after. One suite run costs about 8.3 CPU-seconds on an idle machine:

- about 3 CPU-s in the 17 CLI child processes its checks spawn, each mostly Node start-up and module loading;
- about 1.7 CPU-s in the TypeScript parsing of `CS1`/`CS2`'s import-graph and caller checks;
- about 0.6 CPU-s loading the suite itself;
- the rest in about 1,300 small checks.

**Delivered.**

1. **Incremental compilation, one long-lived compiler per worker.**
   - Each worker starts `payload-contract-mutation.mjs --incremental-build-server` in its own copy. It runs the copy's own TypeScript and re-reads `tsconfig.json` for every build.
   - It keeps the previous builder program in memory: `createEmitAndSemanticDiagnosticsBuilderProgram`, the builder that `tsc --incremental` and `tsc --watch` are built on. It also keeps every unchanged file's syntax tree, handed back only when the file's bytes and parse options match.
   - A build therefore re-checks and re-emits only the files a change affects. It is still a full type-check of everything affected; nothing is transpiled without checking.
   - The exit status comes from `tsc`'s own `emitFilesAndReportErrorsAndGetExitStatus`: 0 only with no diagnostic of any kind. A mutation that fails to compile is still not a pass.
   - Measured on an idle machine:
     - one-file body change: 0.1–0.2 s;
     - an exported-signature change that re-checks every dependent: 2.4–2.9 s, about 3 CPU-s (a full `tsc` is about 10);
     - a type error: refused with `TS2322`.
2. **No stale `dist/` between mutations.** A compiled mutation's restore is rebuilt immediately, before its worker takes the next mutation. Before, it was rebuilt lazily by the next mutation. The rule is still "rebuild whenever `dist/` could differ from its sources".
3. **Copies start with no `dist/`.** The authoritative checkout's `dist/` is no longer copied, so each copy's first build writes its `dist/` from nothing.
4. **The compile cache for the suite.** The suite and its CLI children run with `NODE_COMPILE_CACHE` in the worker's own directory. It holds V8 bytecode for byte-identical module sources only, and saved about 4% of suite CPU.
5. **Five soundness checks, all passing:**
   - **`M-inc0`:** every copy's first build is byte-identical to a clean full build (`tsc -p tsconfig.json --incremental false`, into a separate directory) of the same sources (87 files).
   - **`M-inc-restore`:** after **every** compiled mutation (176 of 176), the rebuild of its restored sources is byte-identical to that clean build. On any difference, the copy's `dist/` is rebuilt from nothing, so no later mutation inherits it.
   - **`M-inc-end`:** after its last mutation, each worker does a fresh clean full build and requires its incremental `dist/` to match it byte for byte, before the final suite pass (`M-end`).
   - **`M-inc-tsc`** (the owner's addition): a source state holding an injected type error fails real `tsc` (`--noEmit`, non-zero) **and** the incremental compiler (non-zero status). Once the fault is removed, both return 0.
   - **`M-inc-fault`:** proves the checks can fail. The compiler refuses an injected type error (`TS2322`). The comparison reports three faults, each a real way an incremental `dist/` can go wrong: an orphaned output left behind when a source is removed, a stale output the incremental compiler does not re-emit, and a missing file. It also reports no difference for identical trees.
6. **Timing.** The log ends with the wall time spent on each kind of work, summed over the workers. `--profile <file>` writes the per-mutation split.

**Invariants, all kept.**

- Every one of the 522 mutations runs the whole suite and must make every check it names fail by name.
- In the final-code run, all 1,053 per-mutation result and restore lines are **byte-identical in content and order** to the unchanged-`main` run. The only additions are the five new harness lines (`M-inc0`, `M-inc-restore`, `M-inc-end`, `M-inc-tsc`, `M-inc-fault`), placed so that every existing line keeps its relative order.
- The byte-for-byte restore and its sha256 verification are unchanged.
- Copies still carry no Git. `M-isolation`, `M-capture`, `M-kill`, `M0`, `M-order`, `M-end`, `M-copies` and `M-authority` are unchanged.
- The compilers are process-group leaders like every build and suite, so signals stop them. Each also exits when its input closes, so a killed harness cannot leave one running.

**Figures — harness duration, before and after.**

| Where | Before | After |
|---|---:|---:|
| CI mutation step | **38m47s** (`main` run 241); 40m21s (PR #103's run 240) | recorded in this PR's CI run; reconciled here with the merge SHA |
| CI quality job | **40m12s** of 60 (run 241); 41m46s (run 240) | recorded in this PR's CI run |
| Local, this container (4 CPUs, Node 22.22.2, 4 workers, 522 mutations) | **34m22s** (unchanged `main`, all pass) | **23m27s** (first full run), **25m41s** (final code, with `M-inc-tsc`) — all pass |

The two after-runs differ mostly in suite time (9.9 s and 10.8 s per suite under load), which is machine variance. Summed worker time for the final run: 530 suites 5,698 s; 176 builds 184 s; 176 restore builds 100 s; 4 first builds 69 s; 5 clean builds 70 s; fault builds 10 s.

**Material design decisions.**

- **A persistent builder program, not `tsc --incremental` per build.** Measured on an idle machine, `tsc --incremental` for a one-file body change still took about 3.2 CPU-s, 1.07 s of it re-parsing and re-binding 404 unchanged files. The persistent builder takes 0.1–0.2 s. Both use the same TypeScript builder, and errors are decided by `tsc`'s own exit-status function.
- **Prove each restore, not only the end state.** Comparing after every compiled mutation costs one small build and a 2 MB byte comparison each time. It turns "incremental is sound" from an end-of-run spot check into 176 proofs. The end-of-worker clean build and the fault injections are kept as well.
- **The clean reference is a real `tsc` CLI build** with no incremental state, into its own directory, so it shares nothing with the compiler it checks except TypeScript itself.

**Material rejected alternatives.**

- **Transpile-only builds, running only the named check, skipping checks, or sampling mutations.** Forbidden by the task, and each would weaken what a mutation proves.
- **V8 thread, GC and tiering flags** (`--max-semi-space-size`, `--single-threaded-gc`, `--single-threaded`, `--max-opt`, `--no-opt`, `--max-lazy`). Measured: none lowered the total CPU of `tsc` or the suite.
- **A persistent suite process re-running the checks in memory.** Rejected: product modules can keep state across runs, and a run could then read a file a previous mutation changed.
- **Reordering the queue to cluster compiled mutations.** Unnecessary once restores are immediate and cheap. Output order is fixed by id either way.
- **Merging or parallelizing the suite's CLI children.** Merging would change what the checks test, and parallelizing buys nothing: the harness is CPU-bound at 4 workers.

**Migrations / schema impact:** none.

**Automated validation.** Build and typecheck clean. `npm run test:offline` passed all nine suites with counts unchanged — posting 52, image 18, orchestrator 119, gate 56, API 51, render identity one invariant-suite pass, ownership/recovery 112, content intelligence 1,322, interval monitor 94 — **1,825** checks.

- **`npm run test:payload-mutation`, twice, locally (4 CPUs, available parallelism 4, 4 workers, 39 captured paths, 522 mutations: 520 prohibited, 2 coordinated-authority):**
  - on unchanged `main` at `c1c19f4`: **ALL PASS, 34m22s**;
  - on the final code: **ALL PASS, 25m41s**, with `M-isolation`, `M-capture`, `M-kill`, `M0`, `M-inc0`, `M-order`, `M-inc-restore` (176 of 176), `M-inc-end`, `M-end`, `M-inc-tsc`, `M-inc-fault`, `M-copies` and `M-authority` green;
  - an earlier full run of the same change without `M-inc-tsc` took **23m27s**, all pass;
  - all 1,053 per-mutation result and restore lines of the final run are byte-identical, in content and order, to the `main` run's.
- **The golden test** (`node scripts/local/content-run-golden.mjs --base c1c19f4 --allow-stack-frames`): 240 files and 84 scenarios, **0 differences**, 59 stack-frame-only stderr differences.
- The M1 readiness offline suite (461 checks), the simulated dry run, and the deployment-controller fixtures.
- Markdown links (66 files); environment coverage (35 variables); the sensitive scan (203 tracked text files), with manual triage of every added line: no email address, phone number, token, credential, booking link, customer datum or facts-file content.
- `npm audit --omit=dev` (0 vulnerabilities); `git diff --check` and the whole-tree whitespace check.

AgentShield 1.4.0 exited zero at **B/87** with the same 18 findings (9 medium, 9 low; no critical or high). CI on the final head is recorded in the PR.

**Production evidence:** none, and none is possible. The harness is CI tooling.

**Rollback / recovery:** revert the commit. There is no migration and no durable state. Reverting restores full `tsc` builds and the lazy restore rebuild.

**Security and privacy implications:** none new. The harness stays offline: no network, database, provider or credential. It still never writes the authoritative checkout (`M-authority`, `M-kill`). The compile cache and the build state live in each worker's disposable directory and are removed with it. The workflow, its permissions and its five jobs are unchanged.

**Accepted limitations.**

- **The suite is now about 95% of the harness's time**, and each added mutation adds one full suite run (about 10 s of worker time on 4 workers). The step still grows linearly. The remaining levers are the owner's: a larger CI runner with `MAX_WORKERS` raised, a higher timeout, or restructuring the gate.
- **The original ≤ 20-minute target was not met.** The CI figure decides the merge against the owner's 30-minute bar.
- **Each compiler holds its program in memory** (about 450–520 MB per worker in this container, four workers).
- **A mutated `dist/` is not itself compared with a clean build of the mutated sources**, which would cost the full build this change removes. The builder re-emits every file a change affects, including files whose output depends on another file (verified in a scratch project with const-enum inlining, in both directions). Every restore is compared with the clean build.

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — **blocking**.
- **This PR's own CI:** the mutation step's and quality job's durations on the final head, against the owner's 30-minute bar. They are recorded in the PR and reconciled into this record with the merge SHA.
- **The mutation step's growth** (the first accepted limitation); carried in the cursor.

**Documents updated:** this file (this record; S1's record moved to *Merged repository change awaiting rollout* with its merge, CI and the owner's acceptance check reconciled; the cursor; *Planned — Content Studio*; dated notes on the carried speed-up follow-ups), [Testing](TESTING.md), [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Architecture](ARCHITECTURE.md), [Deployment control](DEPLOYMENT.md) (the dated auto-deploy observation), and the mutation harness's header.

### Content Studio S1 — the pipeline library `src/harness/contentRun/**`, the local CLI a thin shell over it, and the §5.4 protections; PR #102 recorded as merged — `MERGED`

**Merge reconciliation (recorded 2026-09-30 by the mutation-harness speed-up at the top of this file):** `MERGED` through [PR #103](https://github.com/Caposhi/GCD-Agents/pull/103) at `c1c19f4b89bd405b854e44bd0aa863de24f3d483`, whose ordered parents are `46645153f7d9b11668dbaa81522a6bb80e2f5af8` (the PR #102 merge) and then reviewed head `e96c3fe02565c57c96ca810856757ef12ec812cf`.

- **PR CI:** [run 36641936404](https://github.com/Caposhi/GCD-Agents/actions/runs/36641936404) (run 240) on head `e96c3fe` passed all five jobs on attempt 1: *Node 22 offline quality gates*, *PostgreSQL 16 integration*, *PostgreSQL 18 integration*, *AgentShield 1.4.0* and *Workflow and YAML static validation*. Quality job **41m46s** of 60 (22:50:48–23:32:34Z, 2026-09-29); mutation step **40m21s** (22:51:17–23:31:38Z).
- **`main` push:** [run 36716816644](https://github.com/Caposhi/GCD-Agents/actions/runs/36716816644) (run 241) on `c1c19f4` passed the same five jobs on attempt 1. Quality job **40m12s** (12:45:16–13:25:28Z, 2026-09-30); mutation step **38m47s** (12:45:44–13:24:31Z).
- **Deploy:** the `deploy-production` workflow ([run 68](https://github.com/Caposhi/GCD-Agents/actions/runs/36721531470)) passed its CI-provenance step and refused at its "Refuse while production automation is disabled" step. It skipped release selection and the serialized API, worker, scheduler release job, as on every `main` merge during the interval. No release.
- **Durations** come from the Actions jobs API, not from the harness's summary line.

**Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** No release is possible during the interval, and nothing live imports the library (`CS1`). This paragraph discharges the blocking merge-SHA follow-up and the PR-CI follow-up below; where the record says `IMPLEMENTED`, not merged, or that its CI is recorded only in the PR, this paragraph supersedes it.

**The owner's post-merge acceptance check (2026-09-30, operator-local; fake runner, no model call, no cost).** The owner compared the pre-S1 CLI at `4664515` with the post-S1 CLI, on the owner's real facts file and on the run `…-revised-2026-09-28T17-52-05-407Z-revised-2026-09-28T18-26-40-227Z`:

- `--list-tags` printed identical output;
- `--replay-critic` exited 0 on both;
- the replay output, normalized for paths, timestamps and stack frames, was the same.

The facts file and the run folder were not examined from this repository, and nothing from either is recorded here. This discharges the follow-up *the owner's post-merge fake-runner check*. **The reviewer independently reproduced the golden comparison**: 240 files and 84 scenarios, 0 differences, 59 stack-frame-only; and proved the comparator catches a one-byte change.

The record was written at the top of this file: where it says *Planned — Content Studio* "below", that entry is now above it, and "the cursor" is now *Next repository change — Content Studio S2 (Studio schema and migrations), pending the mutation-harness speed-up's merge*. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/great-hawking-t5zr25`, based directly on `origin/main` at `46645153f7d9b11668dbaa81522a6bb80e2f5af8` (the merge of PR #102). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** It is the first of the nine Studio PRs in the approved [Content Studio design](CONTENT_STUDIO_DESIGN.md) (§5.1, §5.2, §5.4 and §10's S1 row), and it builds no Studio service: no `src/studio/**` code, no migration, no Render resource and no `render.studio.yaml`. All six stages keep `executionEnabled: false`; the registry and the `AQ18`-family dormancy checks are unchanged and still pass. **No live-service file changed:** nothing under `src/api/**`, `src/worker/**`, `src/scheduler/**` or `state/migrations/**`, and not `render.yaml`, `config/`, the deploy workflow or the deployment controller. Models, effort, prompts, skills and limits are unchanged, and no npm dependency was added. The partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged, so no release is possible. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** opened from `claude/great-hawking-t5zr25` into `main`; its number and CI run are recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Why.** The owner authorized Studio S1 on 2026-09-29, after approving the design. The Studio worker (S3) must run exactly the code the CLI runs, with every fail-closed check intact (design §5.2), so the CLI's pipeline core becomes a library both call. The worker is a deployed caller of the stage executors, so the design's §5.4 also requires executed structural checks that the live `gcd-social-*` services cannot reach it.

**Delivered.**

1. **The library, `src/harness/contentRun/**`**, compiled by the existing `tsc` into `dist/harness/contentRun/`. It holds the pipeline core that `scripts/local/content-run.mjs` held, moved with every free check, refusal message and byte written unchanged:
   - `evidence.ts`: `parseAutomotiveFacts(bytes, { label, now })` (the same eight required fields and record shape), the path wrapper `loadAutomotiveFactsFile(path, now)`, `factFileAt`, `loadRecords`, `buildRunEvidence`, `countTags` (`--list-tags` as data), `normalizeScopeTags`, `effectiveEvidenceScope`, `alwaysIncludedIds`, `evidencePackFingerprint`, `EvidenceScopeError`;
   - `pipeline.ts`: `runFullPipeline`, `resumeFromPackaging`, `replayCritic`, `reviseRun`, `WRITER_STAGE_FILES`;
   - `verify.ts`: `verifySourceRun`, `readSavedStage`, `nowFromRunDirName`, `REUSED_STAGE_FILES`;
   - `fakes.ts`: `buildFakeStageResponses`, `fakeStageRunner`; `recording.ts`: `createRunRecorder`, `recordingRunner`, `measureFields`, `measurementTable`;
   - `pricing.ts`: `computeCostCeiling` — the cost ceiling **returned as data** (`CostCeiling`: one line per request, the total, the policies checked) — plus `allStagePolicies`, `criticLensPolicies`, `resumePolicies`, `revisionPolicies`, `RESUME_POINTS`;
   - `summary.ts`: `markdownSummary`, `revisionSummaryLines`, `summaryFooter`; `runtime.ts`: `loadRuntime`, `ContentRunRuntime`; `consent.ts`: `refuseUnprovenAutomotiveFacts`;
   - `types.ts`: the injected seams — `RunSink` (`writeArtifact(name, bytes)`, `recordRequest(entry)`), `RunSource`, `RunOutputs`, `FactFile`, `RunReporter`, **`PaidActionConsent`** and the **`UnprovenFactsConfirmation`**; and `index.ts`, which also exports `RUN_ARTIFACT_NAMES`, every file name each kind of run can write (design §4.2: "S1 derives the list from the library").

   **`PaidActionConsent`** is called for a live runner only, after every free check and after pricing, and before any runner is built or any output created — exactly where `requireLiveConsent` stood — with the kind, the label and the ceiling for exactly the requests the action makes. **The `UNPROVEN` confirmation** is injected the same way. `refuseUnprovenAutomotiveFacts`, the future worker's, always refuses; nothing uses it yet.
2. **The CLI is a thin shell** (2,102 → 637 lines). It keeps argument parsing, the typed `LIVE` and `UNPROVEN` prompts, the printed cost ceiling, console output and file writing, and hands the library a run-directory sink, a directory source, its consent and its confirmation. **Every flag and refusal behaves as before**; the fake runner stays the default and makes no network call; file names, bytes and every `*-meta.json` schema are unchanged. It imports the compiled library when it is built, so `--help`, usage and every argument refusal still work without a build; `main` refuses with the same build instruction when either the stage executors or the library is missing. It keeps its own parse-time copies of `normalizeScopeTags` and `RESUME_POINTS`, because it must refuse a bad flag before any compiled module loads; `CS4` holds them equal to the library's. It re-exports the library's pure helpers and the library object itself (`contentRunLibrary`), so the offline suite reaches the library only through the CLI.
3. **The fake-runner golden test, `scripts/local/content-run-golden.mjs`.** It drives a CLI as a child process through **84 scenarios**: full, scoped, platform-subset, `--revise-once`, `--replay-critic`, `--resume-from packaging-adaptation` and `--revise-from` runs; `--list-tags` in four forms; UNPROVEN confirmed and refused; overwrite, fingerprint, scope, platform, goal, missing-stage and malformed-stage refusals; every live-runner refusal short of the typed word; and 29 refused flag combinations. The clock is pinned by a preload, and asynchronous file reads complete in issue order, because `main` itself is not deterministic: the critic's four concurrent lens requests finish in I/O order, and two unpinned captures of `main` differed in 48 places (measurement-row, `modelRequests` and console order). Pinned, three captures of `main` were identical. **It was captured on `main` at `4664515` before any change.** After the move: **all 240 files byte-identical, every exit code and every stdout identical.** The one difference is in stderr and is cosmetic: 59 scenarios end in a plain `Error`, which Node prints with its stack, and those stack-frame lines name the moved files and lines (and, because the CLI now imports the library at load, no longer show three Node loader frames). The reported messages are identical. `--base <rev>` repeats the whole comparison against any revision in a temporary Git worktree.
4. **The §5.4 protections, each an executed check in the offline suite** (`src/harness/livePathGuards.ts`, a checker nothing live imports):
   - **(1) The import-graph check.** `CS1` walks the compiled `dist/` transitively from every live entry point — `dist/api/server.js`, `dist/worker/index.js`, `dist/scheduler/daily.js`, `dist/state/migrate.js`, `dist/harness/evidence/syncCli.js`, `dist/harness/dryrun.cli.js` — through static imports, re-exports and literal dynamic imports, using the TypeScript compiler's parser (an existing devDependency) rather than regular expressions. No path may reach the six executors, `stageExecution.js`, `revision.js`, `dist/harness/contentRun/**` or `dist/studio/**`. It fails closed on a computed `import()`, a `require` or `createRequire`, an unresolvable or out-of-tree specifier, a package not in `dependencies`, and a string naming a forbidden module path; every violation is reported with the chain of modules that reached it. **49 modules** are reachable today, and none is forbidden. `CS1a` derives the entry points from `render.yaml`'s start and pre-deploy commands and `package.json`'s start, migrate, dry-run and evidence-sync scripts, and requires them to equal the walked list: **the list was verified complete; none was missing.** `CS1b` proves the walk against synthetic trees, including a forbidden module reached through a plain import, a re-export and a lazy import in turn. `CS1c` walks the other direction required by design §1.3: the library (and any compiled `src/studio/**`) reaches no posting, provider, approval, Instagram-token or live-database module and no live service's code, with `posting-tool/validation.js`, reached through `packageMap.js`, the one allowlisted exception.
   - **(2) The caller allowlist.** `CS2`: only `scripts/local/content-run.mjs` and `src/studio/worker/**` may import `contentRun/**`, and nothing under `src/studio/web/**` may import it, the stage-execution boundary or an executor. It scans every code file in the repository (import, re-export, `import()` and `require`), and proves the rule against synthetic `src/studio/worker`, `src/studio/web` and `src/studio/shared` files, since `src/studio/**` does not exist yet.
   - **(2a) The shared-module diff guard.** `CS3`: every module the live entry points load is pinned by sha256 in **`scripts/ci/live-path-manifest.json`** (49 modules, each with a `declared` reason). An edit to one, or a module entering or leaving the live set, fails until the same change updates the manifest. **That update is the declaration**: its diff names each live-path edit and carries a reason, which a reviewer reads as a live-path change. `node dist/harness/livePathGuards.js` prints the live set and any problem; `--declare "<reason>"` rewrites the changed entries with that reason. `CS3a` proves the refusals and the accepted declared edit against synthetic manifests. **Declared live-path edits in S1: none.** The manifest's 49 entries are the baseline, unchanged from `main` at `4664515`.
   - **The injected gates, executed:** `CS5` (the worker's UNPROVEN confirmation refuses a legacy replay before any consent, runner or output) and `CS6` (the consent is asked once per live paid action, after the free checks and pricing, with the ceiling for exactly its requests — 9, 5, 6 and 4 — and no runner or output exists until it allows; a free-check refusal and a fake run never ask).
5. **Source-reading checks re-pointed at the moved code**, each keeping its name and result: `CN11`, `CN14`, `CV17`, `CV18`, `CD0g`, `CE1`–`CE7`, `CE8`'s source clause, `CE9`, `CR9`, and the orchestrator suite's `MR7`, which now reads the library's price table. Where a check had asserted an order among call sites, it asserts the same order against the library's call sites and the CLI's consent (for example `computeCostCeiling(...)` before `io.consent(...)` before `io.outputs.open…(...)`), and several gained clauses — `CN11` now also proves neither the CLI's `--list-tags` printer nor `countTags` builds a pack, registry, runner or price; `CE8`'s summary clause no longer passes vacuously on an empty body.
6. **Mutations.** 26 of the 32 mutations that targeted `content-run.mjs` now target the library file holding the code they break, with the same ids and expected checks. Where the typed library needed it, a `to` text was adapted to compile the same break: `M365`, `M481` and `M486` gained a type cast, `M427` a runtime-false guard, and `M482` passes its extra key by spread; `M485` relabels the failure sink as the source directory, because the library holds no directory of its own; `M489` starts its second round from the same source; and `M465` and `M487` now drop the injected consent call. Six stay on the CLI, whose argument parsing, `--list-tags` printing and dispatch did not move (`M423`, `M424`, `M429`, `M430`, `M431`, `M462`). **Fifteen new mutations, `M508`–`M522`**, prove `CS1`, `CS1a`, `CS1c`, `CS2`, `CS3`, `CS4`, `CS5` and `CS6` each fail by name — among them the scheduler importing `overlayContact.js`, an intermediary that names no executor but reaches `packagingAdaptation.js`, which fails `CS1` while every `AQ18` fixed-file check stays green. **522 mutations in total (520 prohibited, 2 coordinated-authority), 39 captured paths.**
7. **PR #102 recorded as `MERGED`** at `4664515…`, with its runs; its record moves to *Merged repository change awaiting rollout* below, and its merge-SHA follow-up is discharged there, in the cursor, and in [Status](STATUS.md).
8. **The Studio entry and the cursor.** In *Planned — Content Studio* below, S1 is `IMPLEMENTED`, not merged. The cursor becomes **S2 (Studio schema and migrations), pending S1's merge**.

**Migrations / schema impact:** none.

**Material design decisions.**

- **The runtime object stays the seam.** Every library function takes the bundle of compiled modules as its first argument, exactly as the CLI's functions did, so the suite can still hand a path a runtime whose executors, pack builder or registry throw, and prove the path never reaches them.
- **The library reports; the CLI prints.** Progress, verification and warning lines go through an injected `RunReporter`, in the order the CLI printed them; the cost ceiling is data the CLI's consent prints; the typed prompts stay in the CLI.
- **The CLI's sink writes synchronously,** so its failure path — which writes `rejected-responses.json` and the measurements from a module-level failure context the library hands it — stays synchronous, as it was.
- **The price table stays a mirror** in `pricing.ts`, as it was in the CLI, rather than an edit to `sdk.ts`. That keeps S1's live-path edits at zero; `MR7` still requires every model a policy resolves to to carry the identical row in both.
- **The diff guard is a checked-in hash manifest.** Chosen because it is offline and deterministic, needs no Git history (the mutation harness's copies have none, and CI would otherwise depend on fetch depth and merge-base detection), cannot be lost the way a commit trailer is on a squash, and is reviewed in the diff like the code it pins. It applies to every change, not only Studio PRs: any edit to a live-loaded module must say so.
- **The allowlist is static and scans syntax, not text,** except for one rule: a file that holds a computed `import()` may not also hold a string naming a compiled library module. The live protection that must not be evadable is the import-graph walk, which fails closed on any computed import.

**Material rejected alternatives.**

- **Exporting `sdk.ts`'s `PRICE` table.** Not needed, and it would be a live-path edit. `sdk.ts` already exports `legacyModelPriceUsdPerMTok`, but using it would print a price, not `~$?`, for a model the mirror lacks, which is a behaviour change.
- **A diff guard based on `git diff` with a PR label or commit trailer.** Rejected: no Git history in the mutation copies, a label needs the GitHub API, and a trailer does not survive a squash.
- **The CLI importing the library statically.** Rejected: without a build, `--help` and every argument refusal would fail at import, and a bad flag would no longer be refused before the build check.
- **Checked-in golden digests in CI.** Rejected for S1: every stage file records the sha256 of its prompts and of `config/approved-facts.json`, so digests would break on every prompt change; and golden files themselves would copy the booking URL into new files. The before/after comparison is the S1 proof, repeatable with `--base`.
- **Regular-expression import scanning.** Rejected in favour of the TypeScript parser, which does not mistake a comment or a string for an import.

**Automated validation.** Build and typecheck clean. `npm run test:offline` passed all nine suites. Counts, before (on `4664515`) → after:

- posting 52 → 52, image 18 → 18, orchestrator 119 → 119, gate 56 → 56, API 51 → 51;
- render identity one invariant-suite pass → one;
- ownership/recovery 112 → 112;
- content intelligence **1,312 → 1,322** (+`CS1`, `CS1a`, `CS1b`, `CS1c`, `CS2`, `CS3`, `CS3a`, `CS4`, `CS5`, `CS6`);
- interval monitor 94 → 94.

That is **1,815 → 1,825** checks. Every existing check kept its name and passes.

- **The golden test:** captured on `4664515` before any change, then compared after it: 0 differences in 240 files and 84 scenarios, and 59 stack-frame-only stderr differences (cosmetic). `--base 4664515 --allow-stack-frames` reproduced the result independently.
- **`npm run test:payload-mutation`**, run locally on the final source in a clean worktree: **ALL PASS — 522 mutations (520 prohibited, 2 coordinated-authority), 4 workers, 32m52s**, on 4 CPUs with available parallelism 4 and **39 captured paths**. `M-isolation`, `M-capture`, `M-kill`, `M0`, `M-order`, `M-end`, `M-copies` and `M-authority` were green. A pre-check had run the 47 mutations of the CLI, the library and the guards alone, and each failed exactly its named checks.

The other checks, all passing:

- the M1 readiness offline suite (461 checks);
- the simulated dry run;
- the deployment-controller fixtures;
- Markdown links (66 files);
- environment coverage (35 variables; the library reads none);
- the sensitive scan (203 tracked text files), with manual triage of the added lines: no email address, phone number, token, credential, booking link, customer datum or facts-file content;
- `npm audit --omit=dev` (0 vulnerabilities);
- `git diff --check`.

AgentShield 1.4.0 exited zero at B/87 with the same 18 findings (9 medium, 9 low). CI on the final head is recorded in the PR.

**Production evidence:** none.

**Rollback / recovery:** revert the commit. The library is new files that nothing live imports; the CLI returns to its single-file form.

**Security and privacy implications.** No secret, token, credential, customer datum, run folder, zip or facts-file content is added. The golden test and every new check use synthetic facts written to temporary directories; no fixture is committed, and no golden output (which would copy the booking URL from `config/approved-facts.json`) is checked in. Every live-runner scenario refuses before the first request, with no API key in the child's environment and the provider URL pointed at an unreachable port. The library reads no environment variable of its own.

**Accepted limitations.**

- **Stack-frame lines differ** in the stderr of refusals that are plain `Error`s: the message is identical, the frames name the library's files. Cosmetic, and reported above.
- **The golden test is not a CI step.** It needs a base revision and Git, so it runs locally (`--base <rev>`); the offline suite's CLI checks keep guarding behaviour in CI.
- **The allowlist can be evaded by deliberate string construction.** It guards against an unreviewed import, not an adversary; the fail-closed import-graph walk guards the live services.
- **`recordRequest` is called when a response arrives.** Design §4.2's `started` row committed before each request is S3's to add, through the same sink.
- **The CLI loads the compiled library when it is imported,** so usage and argument errors now load the compiled modules first. No output or behaviour changes (golden-verified).

**Unresolved follow-ups.**

- ~~**This PR's merge SHA** (mutable-identifier exception) — **blocking**.~~ **Discharged 2026-09-30:** merge `c1c19f4…`; see *Merge reconciliation* above.
- ~~**This PR's own CI**: whether all five jobs pass on attempt 1 on the final head. It is recorded in the PR, and reconciled into this record with the merge SHA.~~ **Discharged 2026-09-30:** PR CI run 36641936404 and `main` push run 36716816644 each passed all five jobs on attempt 1 (mutation step 40m21s and 38m47s); see *Merge reconciliation* above.
- ~~**The owner's post-merge fake-runner check** on the real facts file and one real run folder (the commands are in the PR). Fake runner only; no cost.~~ **Done 2026-09-30 (operator-local):** identical `--list-tags`, `--replay-critic` exit 0 on both CLIs, and the same normalized replay output; see *Merge reconciliation* above.
- **An independent review of the design** before later Studio PRs, carried from the design record.

**Documents updated:** this file (this record; PR #102's record moved and reconciled; the cursor; *Planned — Content Studio*); [Architecture](ARCHITECTURE.md); [Testing](TESTING.md); [Status](STATUS.md); [README](../README.md); [AI handoff](AI_HANDOFF.md). **Checked and deliberately left unchanged:** [Content Studio design](CONTENT_STUDIO_DESIGN.md) (a dated design; its §5.1 and §5.4 describe what S1 now implements, and it is not a status document), [Security and continuity](SECURITY_AND_CONTINUITY.md), [Deployment control](DEPLOYMENT.md), [Environment](ENVIRONMENT.md), [Data model](DATA_MODEL.md), [Operations](OPERATIONS.md) and `.env.example`: no variable, deployment, schema or operation changed. Each modified document was reread in full.

### The Content Studio design — `docs/CONTENT_STUDIO_DESIGN.md` for the owner's `PLANNED` review-only web interface; PR #101 recorded as merged — `MERGED`

**Merge reconciliation (recorded 2026-09-29 by Content Studio S1, then at the top of this file; *corrected 2026-09-30: S1's record is now the one above this*):** `MERGED` through [PR #102](https://github.com/Caposhi/GCD-Agents/pull/102) at `46645153f7d9b11668dbaa81522a6bb80e2f5af8` (merged 2026-09-29T21:15:37Z), whose ordered parents are `f11101265c1ea7aa771d7efd2f5fdd98f96ab702` (the PR #101 merge) and then reviewed head `971d35183b61c548392f8697fda653355bae5de2`.

- **PR CI:** [run 36628172047](https://github.com/Caposhi/GCD-Agents/actions/runs/36628172047) (run 237) on head `971d351` passed all five jobs on attempt 1: *Node 22 offline quality gates*, *PostgreSQL 16 integration*, *PostgreSQL 18 integration*, *AgentShield 1.4.0* and *Workflow and YAML static validation*. Quality job **31m50s** of 60 (20:41:54–21:13:44Z); mutation step **30m24s** (20:42:23–21:12:47Z).
- **`main` push:** [run 36632070685](https://github.com/Caposhi/GCD-Agents/actions/runs/36632070685) (run 238) on `4664515` passed the same five jobs on attempt 1. Quality job **24m05s** (21:15:43–21:39:48Z); mutation step **22m40s** (21:16:11–21:38:51Z).
- **Deploy:** the `deploy-production` workflow ([run 67](https://github.com/Caposhi/GCD-Agents/actions/runs/36634763414)) passed its CI-provenance step and refused at its "Refuse while production automation is disabled" step. It skipped release selection and the serialized API, worker, scheduler release job, as on every `main` merge during the interval. No release.
- **Durations** come from the Actions jobs API, not from the harness's summary line.

It is documentation only, so nothing about it can be deployed or enabled. This paragraph discharges the blocking merge-SHA follow-up and the PR-CI follow-up below; where the record says `IMPLEMENTED`, unmerged, or that its CI is recorded only in the PR, this paragraph supersedes it. The record was written at the top of this file: where it says *Planned — Content Studio* "below", that entry is now above it, and "the cursor" is now *Next repository change — Content Studio S2*. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/youthful-mayer-vix75s`, based directly on `origin/main` at `f11101265c1ea7aa771d7efd2f5fdd98f96ab702` (the merge of PR #101). **Documentation only:** it changes `*.md` files and nothing else. It builds no part of the Studio, which is `PLANNED` (see *Planned — Content Studio* below). It touches no source, test, mutation, prompt, skill, configuration, `render.yaml`, migration or workflow. All six stages keep `executionEnabled: false`, and the partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged. The tracked `.DS_Store` is untouched. No model was called, and no Render, Google or Anthropic setting was read or changed.

**PR / merge:** opened from `claude/youthful-mayer-vix75s` into `main`; its number and CI run are recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Why.** The owner decided on 2026-09-29 to build a separate, review-only web interface for the content pipeline (the five decisions are recorded verbatim under *Planned — Content Studio* below) and asked for the design first.

**Delivered.**

1. **[`docs/CONTENT_STUDIO_DESIGN.md`](CONTENT_STUDIO_DESIGN.md)**, new. Every item is labelled **VERIFIED** (from source), **PROPOSED** or **UNKNOWN / TO VERIFY**. It covers:
   - purpose and non-goals;
   - the relation to the production-wiring design;
   - the Render topology, including deploy control, health checks and migration separation;
   - the data model, retention and backup;
   - run execution, including the library extraction, the job queue, the fail-closed checks and the registry question;
   - cost controls and authentication;
   - the screens, and security and privacy;
   - the PR sequence S1–S9 and owner actions O1–O6, with the release-freeze gate;
   - open questions and accepted limitations;
   - the decisions the design made itself.
2. **The amendment pointer.** [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md) §5.2 gains a short note pointing to the Studio design and stating the deliberate deviation from "no new Render service". The accepted design is not otherwise rewritten.
3. **PR #101 recorded as `MERGED`** at `f111012…`, with its runs. Its record moves to *Merged repository change awaiting rollout* below. Its merge-SHA and PR-CI follow-ups are discharged there and in [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md) and [Security and continuity](SECURITY_AND_CONTINUITY.md). Each "`IMPLEMENTED`, not merged" label for it gets a dated correction, and its original wording is kept.
4. **The Studio entry and the cursor.** *Planned — Content Studio* below records the owner's decisions as `PLANNED`. The cursor now names Content Studio PR 1 (S1, library extraction) as the next repository change, pending the owner's approval of the design. *(Superseded by item 6: approved 2026-09-29.)* Every other open item is carried unchanged, except that PR #101's merge-SHA follow-up becomes this PR's, and the `--resume-from production-direction` bullet now points to PR #101's moved record.
5. **Planned-architecture notes** in [README](../README.md), [Status](STATUS.md), [AI handoff](AI_HANDOFF.md) and [Architecture](ARCHITECTURE.md). None describes anything as built.
6. **The owner's approval and answers of 2026-09-29, added to this same PR in new commits.** The owner approved the design with answers to its eleven open questions. They are recorded in design §11.1a and in *Planned — Content Studio* below, and applied wherever they change the design:
   - **Decision 2 amended:** a separate `render.studio.yaml`, with `render.yaml` never modified by a Studio PR. The original decision 2 is kept.
   - **The freeze covers new services.**
   - **Caps:** $50 a day and $200 a month; ceilings 75 and 300; a $300-a-month Anthropic workspace limit; the full-ceiling reservation kept.
   - **Roles:** the owner is the only `runner`; staff are `viewer`; later runners get a $25 daily cap.
   - **Time zone** `America/New_York`.
   - **Retention:** runs until deleted; audit log and ledger two years.
   - **The worker on `standard`.**
   - **The P2 conflict** made a binding rule, with a dated pointer at P2 in [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md).
   - **The separate Anthropic workspace and key required.**
   - **Fake runs** kept, owner-only.
   - **An operational note:** the bootstrap owner must be a Workspace user account. No address is recorded.

   The cursor now names S1 with the design approved.

**Migrations / schema impact:** none. The design proposes a separate Studio schema under `studio/migrations/`; none exists.

**Material design decisions** (each is argued in the design's §12):

- **Deploy control.** Manual exact-commit deploys by the owner, with native auto-deploy off on every Studio service. This keeps the count of unattended deployment authorities at zero, puts no credential in GitHub, and changes no live workflow or controller.
- **The registry question.** The Studio worker calls the stages exactly as the local CLI does, with `executionEnabled` untouched. **VERIFIED:** outside the preview's summary, no production source reads the flag, and the CLI already runs all six stages with it `false`. What changes is that "no production caller" narrows to "no caller in the live `gcd-social-*` services". The design therefore adds three protections and weakens nothing: a transitive import-graph check from every live entry point, a caller allowlist for the run library, and executed zero-runner tests.
- **The conflict with P2.** The production-wiring design's P2, as written, would stop both the Studio worker and today's CLI. It was first recorded rather than resolved. *(2026-09-29: the owner made it a binding rule. Whichever comes first, the P2 implementation PR or Studio S3, must define a separately reviewed review-only execution context that can never approve or publish and sits beside the live authority gate.)*
- **Studio-specific variable names.** No Studio service carries `DATABASE_URL` or any live credential, and `ANTHROPIC_API_KEY` is on the worker only.
- **Migration separation.** Five independent separations, including a tripwire `_migrations` table, so that neither runner can apply the other's migrations.
- **The cron.** Built double-gated, and left out of the Studio's Blueprint at launch. *(Since the owner's amendment of 2026-09-29, that Blueprint is `render.studio.yaml`; `render.yaml` is never modified.)*
- **Artifacts are authoritative.** The Studio stores the CLI's own files byte for byte; its tables are derived.
- **Two import tiers:** `verified` and `archived_unverified`.
- **Caps.** Each paid action reserves its printed ceiling and is reconciled to the measured cost. An overrun stops the run and locks new confirmations.
- **Authentication.** Google OIDC with `hd` and `email_verified` checked server-side, plus an owner-managed allowlist.

**Material rejected alternatives.**

- **Building the Studio inside the live services.** Rejected by owner decision 2. It would also sit one import away from publishing, and share the database that stores the plaintext Instagram token.
- **Native auto-deploy, extending the live controller, or a separate Studio GitHub workflow.** Rejected; see the design's §3.4. The only Render key available is account-wide, so a workflow holding it could deploy the live services.
- **Flipping `executionEnabled` for the Studio.** Rejected. It would change a guarded invariant and gate nothing, because no execution path reads it.
- **Reusing the live variable names** (`DATABASE_URL`, `GOOGLE_CLIENT_ID`). Rejected, because a shared module could pick up the other system's value.
- **A zip upload for legacy import.** Rejected: it would need a new parsing dependency, and a bounded JSON document read client-side does not.

**Automated validation.** Build and typecheck clean. `npm run test:offline` passed all nine suites with counts unchanged from `f111012` before the edit: posting 52, image 18, orchestrator 119, gate 56, API 51, render identity one invariant-suite pass, ownership/recovery 112, content intelligence 1,312, interval monitor 94, for **1,815** checks.

The other checks, all passing:

- the M1 readiness offline suite (461 checks);
- the simulated dry run and the deployment-controller fixtures;
- Markdown links (66 files, one more for the new design);
- environment coverage (35 variables);
- the sensitive-content scan (189 tracked text files);
- `npm audit --omit=dev` (zero vulnerabilities);
- `git diff --check`;
- a check that every changed path ends `.md`.

AgentShield 1.4.0 exited zero at B/87 with the same 18 findings (9 medium, 9 low). The link checker does not resolve `#anchors`, so the design's 55 internal anchors were checked separately against GitHub heading slugs, and all resolve.

**How the proposed variables are treated:** `scripts/ci/check-environment-coverage.mjs` reads only `process.env` reads in `src/**/*.ts` against `.env.example`. It never reads Markdown or `render.yaml`, so the design's proposed variables are neither required nor flagged until code reads them.

**Sensitive-scan manual triage:** the only URLs added are this repository's pull-request and Actions-run links and Google's public OIDC issuer. No email address, phone number, token, credential, OAuth value, booking link, customer datum or fact-file content is added.

The mutation harness was not re-run: it mutates source, prompts, a skill, SQL and the CLI, none of which changed. Details in [Testing](TESTING.md); CI on the final head is recorded in the PR.

**Re-run after the owner's answers (item 6), 2026-09-29.** The checks were run again on the answers commits, and all passed:

- build and typecheck;
- `npm run test:offline`, counts unchanged at **1,815**;
- Markdown links (66 files) and the design's internal anchors (78, all resolving), plus the two cross-document anchors from [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md);
- environment coverage (35 variables) and the sensitive-content scan (189 files);
- `git diff --check`;
- a check that only `*.md` files changed since `b33954b`.

Manual triage of the added lines found no email address, URL, token, credential or phone number.

**Production evidence:** none.

**Rollback / recovery:** revert the commit.

**Security and privacy implications.** Documentation only. The only URLs added are this repository's pull-request and Actions-run links, Google's public OIDC issuer (`https://accounts.google.com`) and relative links. The design names environment variables and describes where values would be set, but contains no value. It names no OAuth client id or secret, no API key, no customer datum, no booking-URL token beyond what `config/approved-facts.json` already holds (it is described, never reproduced), no run folder or archive, and nothing from the local facts file.

**Accepted limitations.**

- **Every live fact the design relies on is `UNKNOWN / TO VERIFY`.** This includes Render plans, prices and blueprint fields; Google Workspace and OAuth settings; and Anthropic workspace limits. Above all, it includes **whether the live services are Blueprint-managed with auto-sync** (design §3.6), which could make merging S8 alone touch the live services. *(2026-09-29: the owner's amendment moves the Studio to a separate `render.studio.yaml` and leaves `render.yaml` byte-identical, which removes the edit that would have triggered such a sync. The dated Blueprint check and the stop condition on any `gcd-social-*` resource stay. Whether Render reads a Blueprint at a non-default path is TO VERIFY; if not, the resources are created by hand from that file.)*
- **The design has had one in-session adversarial review,** whose findings are folded in. They covered:
  - cost accounting for in-flight and unknown-cost requests;
  - serialized cap checks;
  - quotes bound to the worker commit and fingerprints;
  - the posting-tool validation import;
  - the Blueprint path;
  - download headers;
  - byte-exact import.

  It has not had an independent review; the production-wiring design took nine rounds. One should happen before S1 begins.
- **PR #101's owner-acceptance follow-up stays open:** the free refusal on the `…19-26-43-383Z` folder.

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — **blocking**.
- **This PR's own CI**: whether all five jobs pass on attempt 1 on the final head. It is recorded in the PR, and reconciled into this record with the merge SHA.
- ~~**Owner approval of the design.** Nothing in the Studio sequence begins without it.~~ **Given 2026-09-29**, with the answers in design §11.1a. Each S-PR still needs its own authorization.
- ~~**The owner's open questions** (design §11.1)~~ **answered 2026-09-29.** **Owner actions O1–O6:** none performed.

**Documents updated:**

- the new [`docs/CONTENT_STUDIO_DESIGN.md`](CONTENT_STUDIO_DESIGN.md);
- [PRODUCTION_WIRING_DESIGN.md](PRODUCTION_WIRING_DESIGN.md) (the §5.2 pointer, and the dated P2 pointer added with the owner's answers);
- this file: this record; PR #101's record moved, with its merge and CI reconciled; *Planned — Content Studio*; the cursor; a dated correction in the revision-pass record's follow-ups; the PR #100 record's reference to "the contact-in-overlay change at the top of this file";
- [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md) and [Security and continuity](SECURITY_AND_CONTINUITY.md).

**Checked and deliberately left unchanged:** [Deployment control](DEPLOYMENT.md), [Environment](ENVIRONMENT.md), [Data model](DATA_MODEL.md), [Operations](OPERATIONS.md) and `.env.example`. Each describes current reality, which this change does not alter. The design's §10 names the Studio PR that must update each one. Each modified document was reread in full.

### Stage 4's contact-in-overlay rule enforced in code — `overlayContact.ts`, called by `validateProductionDirectionOutput` on every overlay — `MERGED`

**Merge reconciliation (recorded 2026-09-29 by the Content Studio design change — PR #102, the record above this one since S1):** `MERGED` through [PR #101](https://github.com/Caposhi/GCD-Agents/pull/101) at `f11101265c1ea7aa771d7efd2f5fdd98f96ab702` (merged 2026-09-29T17:37:31Z), whose ordered parents are `e6333a8e17064329f26eb2f452d6bb94ea84f1bf` (the PR #100 merge) and then reviewed head `fcb901f9e83c0160dff18310c90c2c6df02532aa`.

- **PR CI:** [run 36573197045](https://github.com/Caposhi/GCD-Agents/actions/runs/36573197045) (run 233) on head `fcb901f` passed all five jobs on attempt 1: *Node 22 offline quality gates*, *PostgreSQL 16 integration*, *PostgreSQL 18 integration*, *AgentShield 1.4.0* and *Workflow and YAML static validation*. Quality job **23m32s** of 60 (13:10:35–13:34:07Z); mutation step **22m14s** (13:10:57–13:33:11Z).
- **`main` push:** [run 36606270013](https://github.com/Caposhi/GCD-Agents/actions/runs/36606270013) (run 234) on `f111012` passed the same five jobs on attempt 1. Quality job **32m06s** (17:37:36–18:09:42Z); mutation step **30m43s** (17:38:03–18:08:46Z).
- **Deploy:** the `deploy-production` workflow ([run 66](https://github.com/Caposhi/GCD-Agents/actions/runs/36610074585)) passed its CI-provenance step and refused at its "Refuse while production automation is disabled" step. It skipped release selection and the serialized API, worker, scheduler release job, as on every `main` merge during the interval. No release.
- **Not read:** the harness's own summary line, in either log. The step durations above come from the Actions jobs API.

It is dormant stage code, one prompt sentence and tests. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`**; all six stages keep `executionEnabled: false`. This paragraph discharges the blocking merge-SHA follow-up and the PR-CI follow-up below. Where the record says `IMPLEMENTED` or unmerged, or that its CI is recorded only in the PR, this paragraph supersedes it. The owner-acceptance follow-up stays open: the free refusal on the `…19-26-43-383Z` folder. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/jolly-edison-9d4rjc`, based directly on `origin/main` at `e6333a8e17064329f26eb2f452d6bb94ea84f1bf` (the merge of PR #100). Dormant stage code, one sentence in one stage prompt, tests, mutations and documentation. **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All six stages keep `executionEnabled: false`; no production path reaches stage 4, and the partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged, so no release is possible. Nothing else moved: shot fields, stages 3 and 5, the contact-line attachment, `config/approved-facts.json`, the critic, its aggregation, models, effort, limits, budgets and `executionEnabled` are unchanged. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** opened from `claude/jolly-edison-9d4rjc` into `main`; its number and CI run are recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Why.** The owner's decision of 2026-09-29. Since PR #98, stage 4's prompt has said an overlay never carries contact details, because code attaches a fixed contact line to every stage 5 package (`src/harness/agents/contactLine.ts`), copied exactly from the approved facts. Nothing in code enforced that. In the owner's operator-local run of 2026-09-26 a stage 4 overlay typed the shop's phone number and "Book online", and the critic did not flag it (see the PR #96 and PR #97 records and [Status](STATUS.md)). **This change addresses the cursor item "The stage 4 contact-in-overlay rule is prompt-only"**, which moves from *Next repository change — not chosen* into this record.

**Delivered.**

1. **A new module, `src/harness/agents/overlayContact.ts`.** `overlayContactViolations(text, pack)` is a pure function over one overlay string and the `EvidencePack`. It returns zero or more of three categories, always in this order: `phone`, `url`, `call_to_action`. It first normalizes the text: Unicode NFKC, invisible format characters (`\p{Cf}`) removed, curly quotes made straight, whitespace collapsed to one space, lower case.
   - **`phone`:**
     - a North American-shaped number: optional `+1`, an area code with or without parentheses, then 3 and 4 digits. Separators may be a space, a dot, a dash (hyphen, the Unicode dashes and minus) or nothing. The number may not start or end inside a longer digit run;
     - a 7-digit local number with a dot or dash separator (`921-1515`);
     - when the pack holds a usable `approved-facts:phone` record, that number's last seven digits inside any run of digits and phone separators, in any grouping.
   - **`url`:** `http://` or `https://`; `www.`; a bare domain ending in `.com`, `.net`, `.org`, `.io`, `.app`, `.co`, `.us`, `.biz` or `.info` (`URL_TLDS`); an email address; and, when the pack holds a usable `approved-facts:bookingurl` record, that link's host.
   - **`call_to_action`:** the closed list `CALL_TO_ACTION_PHRASES`, each matched as a whole phrase on word boundaries. The list, exactly: `book online`, `book now`, `book today`, `book your`, `schedule online`, `schedule now`, `call us`, `call now`, `call today`, `give us a call`, `contact us`, `visit us`, `visit our`, `text us`, `message us`, `dm us`, `link in bio`.
   - **Not matched, by design:**
     - bare `visit` and bare `call` ("each shop visit", "the driver's call");
     - the shop's name, which is branding, not contact;
     - `5,000`, `6 months`, `12,000`, model years and year ranges such as `2019–2024` and `2019-2024`;
     - a model number followed by a year, such as `C300 2021` (a space does not separate the 7-digit local form).
   - **Missing records never throw.** The approved values are read with the existing `readContactValue`, so the same usable-record rule applies. A record that is absent or unusable only removes that one extra match; the generic patterns always apply.
2. **Wired into `validateProductionDirectionOutput`.** After the existing bounds checks, every `overlayText[].text` is checked. The first violating overlay throws the stage's existing `StageExecutionError`: `stage production-direction: "overlayText[<index>].text" contains contact details (<categories>); code attaches the contact line, so an overlay may not carry a phone number, a URL or a call to action`. **The message never contains the overlay text or any contact value.** Because `revalidateProductionDirectionOutput` goes through this validator, the check applies to:
   - a live stage 4 response (refused like any other stage 4 validator refusal);
   - stage 5's and the critic's revalidation of the stage 4 output;
   - the local CLI's `verifySourceRun`, which serves `--replay-critic`, `--resume-from packaging-adaptation` and `--revise-from`, and runs before any cost gate. There the message reads `stage production-direction: "directionOutput" is invalid: stage production-direction: "overlayText[<index>].text" contains contact details (…)`.

   Only `overlayText[].text` is checked. The module header and the validator's scope comment in `productionDirection.ts` now describe this one narrow, closed exception to "nothing here is keyword matching".
3. **The prompt line.** `agents/production-direction.md` keeps its existing rule and adds one sentence: *An overlay containing a phone number, a URL or web address, or a call to action such as "book online" or "call us" is rejected by code, and the whole response fails.* `CV10`, which pins the existing rule, is unchanged and still passes; the new `CW10` pins the new sentence.
4. **Checks** (content-intelligence suite):
   - `AF5` now lists `overlayContact.ts`, and the new `AF5e` requires it to invoke no stage, hold no runner and not import the stage-execution boundary.
   - `CW1`–`CW10`, placed after the `CV` group:
     - `CW1` rejects each phone shape: the six the owner listed, and synthetic numbers with en dashes, no space after the area code, a leading `1` and a dotted local number. It runs with the pack's phone record and without it.
     - `CW2` rejects each URL shape and an email.
     - `CW3` pins the phrase list exactly. It rejects every phrase in mixed case, inside curly quotes, with doubled spaces, with a non-breaking space and in full-width characters.
     - `CW4` accepts `5,000 miles or 6 months`, `Every 6 months`, `2019–2024 E-Class`, `2019-2024 E-Class`, `Model Year 2025`, `12,000 miles`, `Short trips`, `Stop-and-go traffic`, `Each shop visit`, `The driver's call` (both apostrophes), `German Car Depot` and the pack's own shop name, `C300 2021` and a 13-digit part number.
     - `CW5` recognizes the pack's phone number in an unusual grouping and a synthetic booking host, each only when its record is present.
     - `CW6` is a synthetic reproduction of the 2026-09-26 incident: one overlay with the pack's phone number and "Book online". It refuses the whole response and names index 1 and `phone, call_to_action`.
     - `CW7` requires the message to contain neither the overlay text, the phone number, its digits, "book online" nor the URL.
     - `CW8` shows revalidation refusing a saved stage 4 output with a violating overlay, while the same saved output with a clean overlay still revalidates.
     - `CW9` uses a pack without the phone, booking and shop records. It still refuses a generic phone and URL, and the check never throws, even on a pack with no records.
     - `CW10` pins the prompt sentence.
5. **Mutations `M493`–`M507`** (`CONTACT_IN_OVERLAY_MUTATIONS`), appended after every earlier group. The harness now reports **507 mutations (505 prohibited, 2 coordinated)** and captures **28** paths (27 before; `overlayContact.ts` added). Each mutation and the named check it must fail:

   | Mutation | Must fail |
   |---|---|
   | The validator no longer calls the check | `CW6`–`CW9` |
   | The North American phone pattern dropped | `CW1` |
   | The 7-digit local pattern dropped | `CW1` |
   | The phone pattern's digit-run guard dropped | `CW4` |
   | The approved phone digits dropped | `CW5` |
   | The bare-domain URL pattern dropped | `CW2` |
   | The email pattern dropped | `CW2` |
   | The approved booking host dropped | `CW5` |
   | `book online` removed from the list | `CW3` |
   | Bare `visit` added to the list | `CW4`, an acceptance check |
   | NFKC dropped | `CW3` |
   | Whitespace collapsing dropped | `CW3` |
   | Case folding dropped | `CW2`, `CW3` |
   | The error echoing the overlay text | `CW7`, `CW8` |
   | The prompt sentence dropped | `CW10` |
6. **Housekeeping.**
   - **PR #100 recorded as `MERGED`** at `e6333a8…`, with its runs. Its record moves to *Merged repository change awaiting rollout* below. Its merge-SHA and PR-CI follow-ups are discharged there and in [Status](STATUS.md), [AI handoff](AI_HANDOFF.md) and [Testing](TESTING.md).
   - **The ambiguous reference fixed.** The cursor's "a follow-up candidate recorded by the documentation reconciliation above" now names the PR #99 record explicitly. Within the moved records, "the documentation reconciliation at the top of this file" and "… above" now name PR #100 and PR #99; that position is no longer theirs.
   - **The cursor.** The prompt-only bullet is addressed here; this PR's merge SHA is the cursor's blocking follow-up, replacing PR #100's; `--resume-from production-direction` is added as a follow-up candidate. **No other phase is chosen.**

**Migrations / schema impact:** none.

**Material design decisions.**

- **Refuse outright.** A violation fails stage 4's contract exactly as an over-long field or a fabricated id does, with the same error type, and there is no retry and no repair. Every other contract check does the same.
- **Categories, never content.** The error names the index and the categories only. No overlay text or contact value can reach a console, a log, a saved failure or an issue this way.
- **Generic patterns first; approved values only add.** The rule does not depend on the pack. With the records it also catches the shop's own number in an unusual grouping, and its booking host on any TLD. Without them it still refuses every generic shape and never throws.
- **Reuse `readContactValue`** for the approved values, inside a guard that treats any refusal as "absent". The usable-record rule is the contact line's own, and `contactLine.ts` is unchanged. The import makes a module cycle: `productionDirection` → `overlayContact` → `contactLine` → `packagingAdaptation` → `productionDirection`. It is safe, because every cross-module use happens at call time, and the whole offline suite loads and runs through it.
- **A closed phrase list, not a classifier.** Bare `visit` and bare `call` stay unmatched, and the list is pinned by `CW3`.
- **The 7-digit local form needs a dot or a dash.** A space would read `C300 2021` as a phone number.
- **Curly-quote normalization is kept but not load-bearing.** No current phrase contains a quote, so dropping it changes no result, and no mutation claims it. It is there so that a phrase added later behaves the same whichever quote a model types.

**Material rejected alternatives.**

- **A deterministic blocking finding routed to the revision pass instead of a refusal.** Rejected: it would change critic aggregation, and every other contract check refuses outright.
- **Matching bare `visit` / `call`, or a wider keyword or semantic classifier.** Rejected: both have legitimate uses in overlays (`CW4`). A wider net would suggest a semantic check that the code does not perform.
- **Space-separated 7-digit local numbers.** Rejected: model designations followed by a year would match.
- **Checking shot fields, stage 3, stage 5, or the critic.** Out of scope by the owner's decision: only `overlayText[].text`.

**Automated validation.** Build and typecheck clean. `npm run test:offline` passed all nine suites — posting 52, image 18, orchestrator 119, gate 56, API 51, render identity one invariant-suite pass, ownership/recovery 112, content intelligence **1,312** (1,301 on `e6333a8` before the change; +`AF5e`, +`CW1`–`CW10`), interval monitor 94: **1,815** checks (1,804 before). `npm run test:payload-mutation`, run locally on the final source: **ALL PASS — 507 mutations, 4 workers, 27m49s** (4 CPUs, available parallelism 4), with `M-isolation`, `M-capture` (**28** targets), `M-kill`, `M0`, `M-order`, `M-end`, `M-copies` and `M-authority` green and each of `M493`–`M507` failing exactly its named checks. No existing check or fixture overlay tripped the new rule before the `CW` group was added. End to end through the local CLI with the fake runner: a synthetic six-stage run was saved, and a copy was made with one stage 4 overlay changed to a phone number and "Book online". `--revise-from`, `--replay-critic`, `--resume-from packaging-adaptation` and `--revise-from --runner live --i-understand-this-costs-money` (no API key) each exited 1 with `"overlayText[0].text" contains contact details (phone, call_to_action)`, before any cost ceiling was printed. None wrote a directory, and no phone digit appeared in the output. The M1 readiness offline suite (461 checks), simulated dry run, deployment-controller fixtures, Markdown links (65 files), environment coverage (35 variables), the sensitive-content scan (188 tracked text files) and `npm audit --omit=dev` (zero vulnerabilities) passed. `git diff --check` and the repository-whitespace check also passed. Sensitive-scan manual triage: the scan first flagged the synthetic email fixture, which now uses the scanner's allowed `example.invalid`. The only contact values added are the shop's public phone shapes the owner specified, already in `config/approved-facts.json`. No booking-URL token, credential or customer datum is added. AgentShield 1.4.0 exited zero at B/87 with the same 18 findings as `main` (9 medium, 9 low). The only difference is `agents/production-direction.md`'s measured size, 12,098 → 12,264 characters, in its existing oversized-agent finding. Details in [Testing](TESTING.md); CI on the final head is recorded in the PR.

**Production evidence:** none.

**Rollback / recovery:** revert the commit. No data, schema, configuration or saved run is changed, so a revert also restores replay, resume and revision of the saved runs this change refuses.

**Security and privacy implications:**

- The refusal never echoes the overlay text or a contact value.
- Tests read the shop name, phone number and booking link from the pack, or use synthetic values: `555` numbers, `examplegarage.*`, and a `.test` booking host.
- The six phone shapes the owner listed appear in the test source and in `CW1`'s check name. They are the shop's public number, already in `config/approved-facts.json`.
- No booking-URL token, credential, customer datum, run folder or archive is committed.

**Accepted limitations.**

- **A violation in a live run fails the run at stage 4, after stages 1–3 are paid.** `--resume-from` supports only `packaging-adaptation`, so a live run refused at stage 4 cannot be resumed from stage 4. `--resume-from production-direction` is a follow-up candidate, not built.
- **Saved runs whose stage 4 overlay contains contact details are now refused** for replay, resume and revision, before any cost gate. The owner's operator-local run `2026-09-26T17-04-00-636Z` and its resume `2026-09-26T17-04-00-636Z-resume-packaging-adaptation-2026-09-26T19-26-43-383Z` are expected to be refused, because the resume reused stage 4 from the 17-04 run. This is recorded as an expectation: this repository has not examined those folders. Whether the owner's two 2026-09-28 revised runs are refused is not known here. They re-ran stage 4 under the prompt rule, and nothing in this repository shows their overlays.
- **The phrase list is closed**, so an unlisted wording passes, such as "reserve a slot" or a number written in words. The critic remains the second line.
- **The approved-phone comparison is a digit match.** An unrelated number that contains the shop's seven local digits would also be refused. No such case is known.

**Unresolved follow-ups.**

- ~~**This PR's merge SHA** (mutable-identifier exception) — **blocking**.~~ **Discharged 2026-09-29:** PR #101, merge `f11101265c1ea7aa771d7efd2f5fdd98f96ab702`.
- ~~**This PR's own CI**: whether all five jobs pass on attempt 1 on the final head. It is recorded in the PR, and reconciled into this record with the merge SHA.~~ **Discharged 2026-09-29:** PR CI run 36573197045 and `main` push run 36606270013 each passed all five jobs on attempt 1 (mutation step 22m14s and 30m43s); see *Merge reconciliation* above.
- **Owner acceptance after merge:** run the free refusal on the `…19-26-43-383Z` folder (the invocation is in the PR) and record the result.
- **`--resume-from production-direction`**: a follow-up candidate, not built.
- Carried unchanged from PR #99 and PR #100: the stage-2 limitation (a follow-up candidate), and the URLs for sources 2, 3, 4 and 5 of the owner's twelve-source review.

**Documents updated:**

- this file: this record; PR #100's record moved to *Merged repository change awaiting rollout* with its merge and CI reconciled; the moved records' references to "the documentation reconciliation at the top of this file" / "above" made explicit; the *Next repository change* entry;
- [Status](STATUS.md), [README](../README.md) (the stage 4 section and the mutation count), [AI handoff](AI_HANDOFF.md), [Testing](TESTING.md) and [Architecture](ARCHITECTURE.md) (stage 4's validation paragraph);
- the source comments in `productionDirection.ts` and the mutation harness's header.

Each was reread in full.


### Documentation reconciliation — PR #99 recorded as merged, the comparison rule's two source comments restated as precautionary, and stale state labels corrected — `MERGED`

**Merge reconciliation (recorded 2026-09-29 by the contact-in-overlay change, PR #101):** `MERGED` through [PR #100](https://github.com/Caposhi/GCD-Agents/pull/100) at `e6333a8e17064329f26eb2f452d6bb94ea84f1bf` (merged 2026-09-29T12:16:27Z), whose ordered parents are `a26101e466020fba5815b2ad378095dfbc4f866c` (the PR #99 merge) and then reviewed head `20c4ca95509749c33560e9ef83faab0c96babba8`. PR CI [run 36487240746](https://github.com/Caposhi/GCD-Agents/actions/runs/36487240746) (run 231) on head `20c4ca9` passed all five jobs on attempt 1 — *Node 22 offline quality gates*, *PostgreSQL 16 integration*, *PostgreSQL 18 integration*, *AgentShield 1.4.0* and *Workflow and YAML static validation*: quality job **30m11s** of 60 (21:36:38–22:06:49Z), mutation step **28m50s** (21:37:04–22:05:54Z). The `main` push [run 36567028496](https://github.com/Caposhi/GCD-Agents/actions/runs/36567028496) (run 232) on `e6333a8` passed the same five jobs on attempt 1: quality job **28m07s** (12:16:35–12:44:42Z), mutation step **26m44s** (12:17:01–12:43:45Z). The `deploy-production` workflow ([run 65](https://github.com/Caposhi/GCD-Agents/actions/runs/36570177245)) passed its CI-provenance step, refused at its "Refuse while production automation is disabled" step, skipped release selection, and skipped the serialized API, worker, scheduler release job, as on every `main` merge during the interval — no release. The harness's own summary line was not read from either log. Documentation and two source comments only, so there is nothing to deploy or roll out; it is kept in this section for its history. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`**; all six stages keep `executionEnabled: false`. The blocking merge-SHA follow-up and the PR-CI follow-up below are discharged by this paragraph; where the record says `IMPLEMENTED` or unmerged, or that its CI is recorded only in the PR, this paragraph supersedes it. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/adoring-turing-yeu61c`, based directly on `origin/main` at `a26101e466020fba5815b2ad378095dfbc4f866c` (the merge of PR #99). **Documentation and two source comments only:** it changes `*.md` files plus one comment in `src/harness/contentIntelligence.selftest.ts` and one in `scripts/ci/payload-contract-mutation.mjs`. No executable line, check string, check logic, mutation (`name`, `file`, `from`, `to`), mutation count (492) or ordering changed, and no prompt, skill, configuration, migration or workflow. It moves no roadmap scope, enables nothing and authorizes no release. All six stages remain `executionEnabled: false`, and the partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** opened from `claude/adoring-turing-yeu61c` into `main`; its number and CI run are recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Delivered.**

1. **PR #99 recorded as `MERGED`** at `a26101e…`, with its PR CI run 36470162601, its `main` push run 36481230729 and the `deploy-production` run 64 that refused (see its record, now under *Merged repository change awaiting rollout* below). Its merge-SHA and PR-CI follow-ups are discharged. It is documentation only: **not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`**. The same state is recorded in [Status](STATUS.md) (a phase-table row), [AI handoff](AI_HANDOFF.md) and [Testing](TESTING.md).
2. **The two source comments restated as precautionary** — the follow-up PR #99 recorded. `CM12`'s comment in `src/harness/contentIntelligence.selftest.ts` and the block comment above `COMPARISON_CLAIM_MUTATIONS` in `scripts/ci/payload-contract-mutation.mjs` no longer say the copy credited a manufacturer with a comparison the shop's own record made. Each now says the rule is a precaution, that the owner's check of 2026-09-28 found BMW's own record makes the city-versus-long-distance comparison, so there was no critic gap, and points to PR #97's corrected record in this file. Before editing, no mutation's `from` or `to` string and no check was found to contain the text changed, and no mutation targets either file.
3. **Stale state labels corrected**, each with its original wording kept and a dated correction beside it, each state verified against `git log` and the merge commit:
   - PR #92 (writer restrictions, `f2a5878…`): the Phase 0B.2 record's aside, the Phase 0B.4 and Phase 0B.5 records' asides, the PR #89 record's *Why a reviewer may see caveats a writer may not* (whose "withheld from every writing stage after stage 3" has been untrue since PR #92 — stages 4 and 5 render both blocks, verified in `productionDirection.ts` and `packagingAdaptation.ts`), and [AI handoff](AI_HANDOFF.md)'s narrow-critic-panel entry and its Phase 0B.5 boundary sentence.
   - PR #95 (the `claimUse` cap of 36, `09b4cc7…`): [README](../README.md) (two), [Status](STATUS.md), [AI handoff](AI_HANDOFF.md), [Architecture](ARCHITECTURE.md) and [Testing](TESTING.md), the last two also naming 99,000 as `main`'s `reasoning-standard` floor, which has been 126,000 since PR #95 (verified from the built `POLICY_OUTPUT_TOKEN_FLOORS`).
   - PR #97 (CI headroom and the comparison rule, `610e230…`): the PR #92 record's mutation-harness follow-up and [Architecture](ARCHITECTURE.md)'s comparison-rule aside.
   - PR #89 (the narrow critic panel, `e557dda…`): two asides in [AI handoff](AI_HANDOFF.md).
   - PR #66 (the M1 readiness runner, `508423a…`): the *Tooling status* heading and paragraph in the [M1 readiness decision record](M1_READINESS_DECISION_RECORD.md).
   - PR #41 (`aec3e80…`, merged 2026-08-29): the [Phase 0B.0 rollout runbook](ROLLOUT_PHASE_0B0.md)'s "It remains **unmerged**".
   - PR #71 and PR #73 (`71f2a13…`, `1ba8e45…`): the two out-of-band tooling entries below, which say `IMPLEMENTED` and not `MERGED` for scripts that are on `main`.
4. **The cursor.** *Next repository change — not chosen* is unchanged except for this PR's merge-SHA follow-up. The source-comment follow-up was never listed there; it was PR #99's own follow-up and is discharged in that record. No next phase is chosen.

**Checked and left unchanged.** Statements that were true when written and are already superseded in place (the `State:` lines below each *Merge reconciliation* paragraph, the interval monitor's 2026-09-22 update), and statements that are still true: PR #39 is still open and unmerged (verified on GitHub), the `claude/m1-db-blocker-fix-gp7psx` branch at `db0c833…` is still not on `main`, and P1 of the production-wiring design has not merged. `docs/archive/` was not searched or edited.

**Migrations / schema impact:** none.

**Material design decisions.**

- **Correct in place, never delete** — the same practice as PR #99: each stale label keeps its wording, followed by a dated correction naming the PR and merge that superseded it.
- **Comments state the motivation, and nothing else moves.** The comparison rule, `CM12` and `M466`–`M468` are unchanged; only the recorded reason for them changed, and a comment is not something any check or mutation reads.

**Material rejected alternatives.**

- **Rewriting the stale labels to `MERGED` in place.** Rejected: [`AGENTS.md`](../AGENTS.md) preserves what was believed and when.
- **Also rewording `CM12`'s check string, which still says "without the motivating runs' wording".** Out of scope: a check string is not a comment, and that string is still accurate (the runs' wording is still kept out of the skill).

**Automated validation.** Build and typecheck clean. `npm run test:offline` passed all nine suites with counts unchanged — posting 52, image 18, orchestrator 119, gate 56, API 51, render identity one invariant-suite pass, ownership/recovery 112, content intelligence 1,301, interval monitor 94: **1,804** checks, the same as on `a26101e` before the edit. `npm run test:payload-mutation` was re-run because two of the files it reads changed: **ALL PASS — 492 mutations, 4 workers, 24m06s** locally (4 CPUs, available parallelism 4), with `M-isolation`, `M-capture` (27 targets), `M-kill`, `M0`, `M-order`, `M-end`, `M-copies` and `M-authority` green. The M1 readiness offline suite (461 checks), simulated dry run, deployment-controller fixtures, Markdown links (65 files), environment coverage (35 variables), the sensitive-content scan (187 tracked text files; manual triage: the only URLs added are this repository's pull-request and Actions-run links, and no credential, token value, phone number, booking link, customer datum or raw output is added), `npm audit --omit=dev` (zero vulnerabilities), `git diff --check` and the repository-whitespace check passed. AgentShield 1.4.0 exited zero at B/87 with the same 18 findings (9 medium, 9 low), none on a changed file. A mechanical check of `git diff -U0` on the two source files found 19 changed lines, every one a comment line and none executable. Details in [Testing](TESTING.md); CI on the final head is recorded in the PR.

**Production evidence:** none.

**Rollback / recovery:** revert the commit.

**Security and privacy implications:** none. The only URLs added are this repository's pull-request and Actions-run links; no credential, token value, booking-URL token, customer datum, run folder or archive is committed.

**Accepted limitations.**

- **The harness's own summary line** (`ALL PASS — 492 mutations, N workers`) was not read from PR #99's two CI logs; their step durations come from the Actions jobs API.
- **The search for stale labels** covered `IMPLEMENTED`, "not merged", "unmerged", "awaiting merge" and "yet to be recorded" outside `docs/archive/`. A stale state stated in other words may remain.

**Unresolved follow-ups.**

- ~~**This PR's merge SHA** (mutable-identifier exception) — **blocking**.~~ **Discharged 2026-09-29:** PR #100, merge `e6333a8e17064329f26eb2f452d6bb94ea84f1bf`.
- ~~**This PR's own CI** — whether all five jobs pass on attempt 1 on the final head — recorded in the PR; to be reconciled into this record with the merge SHA.~~ **Discharged 2026-09-29:** PR CI run 36487240746 and `main` push run 36567028496 each passed all five jobs on attempt 1 (mutation step 28m50s and 26m44s); see *Merge reconciliation* above.
- Carried unchanged from PR #99: the stage-2 limitation (a follow-up candidate), and the URLs for sources 2, 3, 4 and 5 of the owner's twelve-source review.

**Documents updated:** this file (this record; PR #99's record moved to *Merged repository change awaiting rollout* with its merge and CI reconciled; dated corrections in the PR #92 and PR #89 records, the Phase 0B.2, 0B.4 and 0B.5 records and both out-of-band tooling entries; the *Next repository change* entry), [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Testing](TESTING.md), [Architecture](ARCHITECTURE.md), [M1 readiness decision record](M1_READINESS_DECISION_RECORD.md), [Phase 0B.0 rollout runbook](ROLLOUT_PHASE_0B0.md), and the two source comments. Each was reread in full.

### Documentation reconciliation — PR #98 recorded as merged, the revision pass's two owner-run rounds, and a corrected "critic gap" — `MERGED`

**Merge reconciliation (recorded 2026-09-28 by the PR #100 documentation reconciliation):** `MERGED` through [PR #99](https://github.com/Caposhi/GCD-Agents/pull/99) at `a26101e466020fba5815b2ad378095dfbc4f866c` (merged 2026-09-28T20:43:36Z), whose ordered parents are `07b6435318011748b876015432f94e3ef73eb853` (the PR #98 merge) and then reviewed head `c2b40a9eea445d48ad3e6805ff9218186ea10aa9`. PR CI [run 36470162601](https://github.com/Caposhi/GCD-Agents/actions/runs/36470162601) (run 229) on head `c2b40a9` passed all five jobs on attempt 1 — *Node 22 offline quality gates*, *PostgreSQL 16 integration*, *PostgreSQL 18 integration*, *AgentShield 1.4.0* and *Workflow and YAML static validation*: quality job **29m46s** of 60 (19:08:39–19:38:25Z), mutation step **28m21s** (19:09:07–19:37:28Z). The `main` push [run 36481230729](https://github.com/Caposhi/GCD-Agents/actions/runs/36481230729) (run 230) on `a26101e` passed the same five jobs on attempt 1: quality job **18m55s** (20:43:42–21:02:37Z), mutation step **17m40s** (20:44:02–21:01:42Z). The harness's own summary line was not read from either log. The `deploy-production` workflow ([run 64](https://github.com/Caposhi/GCD-Agents/actions/runs/36483414743)) passed its CI-provenance step, refused at its "Refuse while production automation is disabled" step, skipped release selection, and skipped the serialized API, worker, scheduler release job, as on every `main` merge during the interval — no release. Documentation only, so there is nothing to deploy or roll out; it is kept in this section for its history. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`**; all six stages keep `executionEnabled: false`. The blocking merge-SHA follow-up and the PR-CI follow-up below are discharged by this paragraph, and the source-comment follow-up by the PR #100 change; where the record says unmerged, or that its CI is recorded only in the PR, this paragraph supersedes it. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/dazzling-meitner-i0w1bq`, based directly on `origin/main` at `07b6435318011748b876015432f94e3ef73eb853` (the merge of PR #98). **Documentation only:** it changes `*.md` files and nothing else — no source, prompt, skill, test, mutation, configuration, migration or workflow — so it moves no roadmap scope, enables nothing and authorizes no release. All six stages remain `executionEnabled: false`, and the partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) is unchanged. The tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** opened from `claude/dazzling-meitner-i0w1bq` into `main`; its number and CI run are recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Delivered.**

1. **PR #98 recorded as `MERGED`** at `07b6435…`, with its PR CI run, its `main` push run and the `deploy-production` run that refused (see the revision-pass record under *Merged repository change awaiting rollout* below). Its record moved there from this section; its blocking merge-SHA follow-up and its PR-CI follow-up are discharged. It is recorded as **not `DEPLOYED`, not `ENABLED` and not `PRODUCTION-VALIDATED`**. The same state change is made wherever another document called the revision pass `IMPLEMENTED` or not merged: [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Testing](TESTING.md), [Architecture](ARCHITECTURE.md) and [Security and continuity](SECURITY_AND_CONTINUITY.md).
2. **The revision pass's acceptance evidence**, two owner-run rounds on 2026-09-28, recorded in its record as operator-local evidence: the first live revision, and a second, deliberate one on the first round's output.
3. **The "critic gap" statements corrected.** Earlier records said the copy's city-versus-long-distance comparison was credited to BMW although the BMW record contains no such comparison, and that no lens flagged it. That claim came from memory and was wrong: the owner verified on 2026-09-28 that the local BMW record `bmw-my2025-conditions-more-frequent-service` compares city use with "a vehicle that is driven long distances at moderate engine speeds", so the copy's "than steady long-distance driving" was supported and the critic was right not to flag it. Every instance outside `docs/archive/` now carries a dated correction beside the original wording, which is kept as history: this file's PR #97, PR #96, PR #95 and PR #93 records, [Status](STATUS.md), [AI handoff](AI_HANDOFF.md), [Testing](TESTING.md) and [README](../README.md). `CM12` and the comparison rule in `skills/claim-boundaries` stay exactly as they are; their motivation is restated as precautionary. The "unflagged BMW highway attribution" follow-up is withdrawn wherever it appeared; the separate follow-up to describe the identity records in `SCRIPT_CLAIMS` / `PLATFORM_CLAIMS` stays open.
4. **A stage-2 limitation recorded** (record only, no fix) beside the existing "model prose is not verified" limitation in the Phase 0B.2 record below, and in [AI handoff](AI_HANDOFF.md): stage 2's `forbiddenClaims` and `requiredCaveats` bind stages 3–5, but they are model prose and can misdescribe the evidence. See *Stage 2's restrictions can misdescribe the evidence* in the revision-pass record.
5. **The missing YouTube URLs.** The owner's twelve-source evidence review is recorded in the Lane S record below; a dated note there now records that the URLs for sources 2, 3, 4 and 5 are still missing. None is inferred.
6. **The cursor.** No next phase is chosen here; see *Next repository change — not chosen* below.

**Migrations / schema impact:** none.

**Material design decisions.**

- **Correct in place, never delete.** Each wrong statement keeps its original wording, followed by a dated correction naming what was wrong, why, and who verified it and when — the same practice as the replay-input correction in the narrow critic panel record.
- **The comparison rule stays.** It states a correct rule (a comparison needs a record that makes it, credited to that record's source) and nothing in it depends on the mistaken premise, so only its recorded motivation changes.

**Material rejected alternatives.**

- **Deleting the wrong statements.** Rejected: [`AGENTS.md`](../AGENTS.md) preserves rationale and evidence, and a reader of the older records must be able to see what was believed and why it changed.
- **Removing `CM12`, the rule or `M466`–`M468`.** Rejected, and out of scope: the rule is sound as a precaution, and this change touches no source, skill, check or mutation.
- **Fixing the stage-2 limitation now.** Out of scope: it would change a prompt or add a check; it is recorded as a follow-up candidate.

**Automated validation.** Build and typecheck clean. `npm run test:offline` passed all nine suites, unchanged because no source changed — posting 52, image 18, orchestrator 119, gate 56, API 51, render identity one invariant-suite pass, ownership/recovery 112, content intelligence 1,301, interval monitor 94: **1,804** checks. Simulated dry run, deployment-controller fixtures, Markdown links (65 files), environment coverage (35 variables), the sensitive-content scan (187 tracked text files; manual triage: the only URLs added are this repository's pull-request and Actions-run links, and no credential, token value, phone number, booking link, customer datum or raw output is added), `npm audit --omit=dev` (zero vulnerabilities), `git diff --check`, a check that the diff touches only `*.md`, and a full diff review. AgentShield 1.4.0 exited zero at B/87 with the same 18 findings (9 medium, 9 low). The mutation harness was not re-run: it mutates source, prompts and SQL, none of which changed. Details in [Testing](TESTING.md); CI on the final head is recorded in the PR.

**Production evidence:** none; this change records operator-local evidence only.

**Rollback / recovery:** revert the commit.

**Security and privacy implications:** none. The evidence recorded is run-folder names, finding counts, costs and record ids; no customer data, credential, booking-URL token beyond what `config/approved-facts.json` already holds, raw run output or archive is committed.

**Accepted limitations.**

- **The acceptance evidence is operator-local**, as the owner reported it; the run folders exist only on the owner's machine and were not re-examined from this repository.
- **Two source comments still carry the original, mistaken motivation for the comparison rule**: `CM12`'s comment in `src/harness/contentIntelligence.selftest.ts` ("credited a manufacturer with a comparison its record does not make") and the comment above `COMPARISON_CLAIM_MUTATIONS` in `scripts/ci/payload-contract-mutation.mjs` ("credited a manufacturer with a comparison the shop's own record made, and no lens flagged it"). This change is documentation only and may not edit source, so they are recorded here rather than silently left; see the follow-ups. *(2026-09-28: both reworded by the PR #100 documentation reconciliation.)*

**Unresolved follow-ups.**

- ~~**This PR's merge SHA** (mutable-identifier exception) — **blocking**.~~ **Discharged 2026-09-28:** PR #99, merge `a26101e466020fba5815b2ad378095dfbc4f866c`.
- ~~**This PR's own CI** — whether all five jobs pass on attempt 1 on the final head — recorded in the PR; to be reconciled into this record with the merge SHA.~~ **Discharged 2026-09-28:** PR CI run 36470162601 and `main` push run 36481230729 each passed all five jobs on attempt 1 (mutation step 28m21s and 17m40s); see *Merge reconciliation* above.
- ~~**Re-word the two source comments above** so they state the rule's motivation as precautionary. A comment-only source change; it needs its own authorization, and must not change `CM12`'s logic or any mutation.~~ **Done 2026-09-28** by the PR #100 documentation reconciliation, under its own authorization: both comments now describe the rule as precautionary and point to PR #97's corrected record; no check, mutation or count changed.
- **The stage-2 limitation** — a follow-up candidate, not built (see *Next repository change — not chosen*).
- **The URLs for sources 2, 3, 4 and 5** of the owner's twelve-source review — to be supplied by the owner.

**Documents updated:** this file (this record; PR #98's record moved to *Merged repository change awaiting rollout* with its merge, CI and acceptance evidence reconciled; dated corrections in the PR #97, PR #96, PR #95 and PR #93 records; a dated addition to the Lane S record and to the Phase 0B.2 record; the *Next repository change* entry), [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Testing](TESTING.md), [Architecture](ARCHITECTURE.md), [Security and continuity](SECURITY_AND_CONTINUITY.md). Each was reread in full.

### A single opt-in revision pass — `--revise-from <run-dir>` and `--revise-once` in the local CLI, each writing stage's findings cap derived from the contract; stage 4's prompt keeps contact details out of overlays — `MERGED`

**Merge reconciliation (recorded 2026-09-28 by the PR #99 documentation reconciliation above):** `MERGED` through [PR #98](https://github.com/Caposhi/GCD-Agents/pull/98) at `07b6435318011748b876015432f94e3ef73eb853` (merged 2026-09-28T17:36:30Z), whose ordered parents are `610e230e78209fe1d3ca4d83216ed3ff18deec21` (the PR #97 merge) and then reviewed head `2db65a412888b0dbbafdfc9bba2812ab2272fec6`. PR CI [run 36454119958](https://github.com/Caposhi/GCD-Agents/actions/runs/36454119958) (run 227) on head `2db65a4` passed all five jobs on attempt 1 — *Node 22 offline quality gates*, *PostgreSQL 16 integration*, *PostgreSQL 18 integration*, *AgentShield 1.4.0* and *Workflow and YAML static validation*: quality job **23m09s** of 60 (16:52:14–17:15:23Z), mutation step **21m48s** (16:52:38–17:14:26Z). The `main` push [run 36459335061](https://github.com/Caposhi/GCD-Agents/actions/runs/36459335061) (run 228) on `07b6435` passed the same five jobs on attempt 1: quality job **22m11s** (17:36:36–17:58:47Z), mutation step **20m55s** (17:36:56–17:57:51Z). Each run's harness log ends `ALL PASS — 492 mutations, 4 workers` (21m47s and 20m54s by its own clock). The `deploy-production` workflow ([run 63](https://github.com/Caposhi/GCD-Agents/actions/runs/36461959280)) passed its CI-provenance step, refused at its "Refuse while production automation is disabled" step, skipped release selection, and skipped the serialized API, worker, scheduler release job, as on every `main` merge during the interval — no release. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`**; all six stages keep `executionEnabled: false`. The blocking merge-SHA follow-up and the PR-CI follow-up below are discharged by this paragraph; where the record says unmerged, that no live revision has run, or that its CI figures are yet to be recorded, this paragraph and the acceptance evidence below supersede it. The rest of this record is preserved as written at implementation.

**Acceptance evidence — two owner-run rounds, 2026-09-28 (operator-local).** Figures as the owner reported them; the run folders exist only on the owner's machine, were not re-examined from this repository, and are **not production evidence**.

| | Round 1 | Round 2 |
|---|---|---|
| Invocation | `--revise-from` on `2026-09-26T17-04-00-636Z-resume-packaging-adaptation-2026-09-26T19-26-43-383Z` | a second `--revise-from`, deliberately run on round 1's output folder (`…-revised-2026-09-28T17-52-05-407Z`) |
| Output folder | `…-revised-2026-09-28T17-52-05-407Z` | `…-revised-2026-09-28T17-52-05-407Z-revised-2026-09-28T18-26-40-227Z` |
| Findings before → after | 26 (9 blocking) → 19 (4 blocking) | 19 (4 blocking) → 13 (2 blocking) |
| Cost | $0.853952 | $0.819536 |

Common to both rounds: stages 3, 4 and 5 were re-run, and stages 1–2 were reused and revalidated; the critic panel ran fresh, with no round-1 findings sent; `findingsDropped` was empty; and the source folders were not modified. In round 2, finding F19 (`human_review`, `human_decision`) was held back as an owner item and never sent to a model.

Round 2's cost per request:

| Request | Cost |
|---|---:|
| hook-story-script | $0.07374 |
| production-direction | $0.094022 |
| packaging-adaptation | $0.103974 |
| critic: platform-and-local | $0.110856 |
| critic: voice-and-craft | $0.113828 |
| critic: evidence-fidelity | $0.158424 |
| critic: production-coherence | $0.164692 |

The two findings still blocking after round 2:

- **The script's hook** says "Both carmakers say that decision changes with how you actually drive." That breaks stage 2's forbidden "both say" claim. It is in the script only; the captions do not contain it.
- **The ending contradicts the setup**: "it depends how you drive" is followed by "everyone hears the same 5,000/6". It affects the script and all three captions. It is a writing-quality finding, not a false claim.

**One round per invocation, by design.** The pass makes exactly one round each time it is invoked and never plans from the round-2 panel. Running a second `--revise-from` on round 1's output was the owner's deliberate choice, and is exactly the "further round is a new, deliberate invocation" this record's limitations describe. This is recorded as evidence that the revision pass works as designed. **It is not production validation.**

**Stage 2's restrictions can misdescribe the evidence (recorded 2026-09-28; a follow-up candidate, not fixed).** In the piece these rounds revised, stage 2's assessment said the G-Class list "adds mountainous terrain, poor road surfaces, dusty conditions and air-recirculation", and its second forbidden claim treated mountainous terrain and poor roads as G-Class-only items. The owner-verified E-Class record `mb-eclass-arduous-conditions-oil-frequency` includes "use in mountainous terrain or on poor road surfaces"; only dusty conditions and air recirculation are G-Class-only. As a result the writers credited those items to the E-Class — correctly, though that technically contradicted stage 2's text — and the critic correctly did not flag it. Stage 2's `forbiddenClaims` and `requiredCaveats` bind stages 3–5 (PR #92), but they are model prose, and nothing checks them against the records they describe. Recorded beside the Phase 0B.2 limitation below; no prompt or code changed.

**State:** `IMPLEMENTED` on branch `claude/gallant-noether-wvvkda`, based directly on `origin/main` at `610e230e78209fe1d3ca4d83216ed3ff18deec21` (the merge of PR #97). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false`, no production path reaches any of them, and the partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) prohibits any release. The change is dormant stage code (stages 3–5 accept an optional revision input; the critic module gains a revalidator for its own saved output), two new modules (`src/harness/agents/revision.ts`, `src/harness/agents/revisionInput.ts`), derivations in `payloadContract.ts`, the three writing-stage prompts, the operator-local CLI, tests, mutations and documentation. No `config/` file, model, effort, `executionEnabled` value, critic lens prompt, stage 1–2 prompt, `.github/` file or deployed path changed; no enforced limit moved; the tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** opened from `claude/gallant-noether-wvvkda` into `main`; its number and CI run are recorded in the PR. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Why — the owner's decision of 2026-09-26.** The resumed run `2026-09-26T17-04-00-636Z-resume-packaging-adaptation-2026-09-26T19-26-43-383Z` (operator-local; see PR #97's record below) returned 26 critic findings, **9 blocking**, each naming the stage that owns it. The owner decided to build one opt-in revision pass that sends each owning stage its own findings once, and re-runs the critic on the result. *Relocated from the `PLANNED` entry, not deleted:* "Decided by the owner on 2026-09-26, after the resumed run above: the next change builds a single revision pass. Only the decision is recorded here; its design, scope, cost ceiling and acceptance evidence are not yet specified and must be settled in that change. It does not authorize enabling any stage, any release, or any change to the Phase-A approval gate." The design, the cap and the cost gate below are what the owner then specified (2026-09-28).

**Delivered.**

1. **Two entry points, one function (`reviseRun` in `scripts/local/content-run.mjs`).** `--revise-from <run-dir>` revises a completed run (it must hold `run-meta.json` with all three fingerprints, the saved stage 1–5 outputs and `06-final-critic.json`). `--revise-once`, given with a goal, makes a full run and then calls the same function on the directory it just wrote. With neither flag every path behaves exactly as before. `--revise-from` cannot be combined with `--replay-critic`, `--resume-from`, `--list-tags` or `--revise-once`; `--revise-once` needs a goal and a full run.
2. **Source verification first, before any cost gate.** The shared verifier (`verifySourceRun`) runs in revision mode: `run-meta.json` must record the approved-facts, automotive-facts and pack fingerprints and the instant (no unproven path, as for a resume), each must match, the recorded scope is reused, and every saved stage 1–5 output is revalidated through its owning validator. It then revalidates the saved critic panel output (`revalidateFinalCriticOutput`, new in `finalCritic.ts`): the output is split back into its four lens answers, each run through `validateCriticLensOutput` against the packages the critic saw (stage 5 with its contact lines rebuilt from the pack), re-aggregated, and required to equal the saved output byte for byte.
3. **What is revised (`planRevision` in `revision.ts`).** Only findings whose owner is in `REVISABLE_OWNERS` (now exported: `hook-story-script`, `production-direction`, `packaging-adaptation`) and whose category is not `human_decision` may reach a model. Every finding owned by `human_review`, and every `human_decision` finding, is an **owner item**: printed, recorded in `revision-meta.json` and listed in `summary.md`, never sent. If no *blocking* finding has a revisable owner, the pass prints that and makes **no request**; nothing is written.
4. **Which stages re-run.** The earliest writing stage owning at least one blocking finding, and every later writing stage through stage 5, in order. Stages 1–2 never re-run. Stage 1–2 outputs, and any writing stage before the start, are copied byte for byte; an earlier stage owning only advisory findings is not re-run and its findings are recorded as not sent.
5. **What a re-run stage receives.** Its ordinary inputs — with the revised upstream outputs where those changed — plus two untrusted data blocks, after the ordinary ones: `PREVIOUS_OUTPUT` (its own round-1 output as saved; stage 5's is its model output before contact lines) and `CRITIC_FINDINGS` (only the findings it owns, each with `id`, `severity`, `category`, `platform`, `lens`, `issue` and `suggestedAction`; ids are `F<n>`, the finding's 1-based position in the round-1 panel). The executor (`revisionDataBlocks` in `revisionInput.ts`) refuses, before the request, a finding owned by any other stage or by `human_review`, a `human_decision` finding, more findings than its cap, a repeated or malformed id, an over-long issue or suggested action, a `PREVIOUS_OUTPUT` over the stage's own output ceiling, and a rendered block over its derived ceiling. Every existing validator applies unchanged.
6. **The prompts.** Stages 3, 4 and 5 each gain a *Revision requests* section: fix every blocking finding; weigh every other finding; change nothing else unnecessarily; a finding only narrows or corrects and never permits anything — the stage's claim block (`PERMITTED_CLAIMS` for stage 3, `SCRIPT_CLAIMS` for stages 4 and 5) stays the only source of assertable fact and stage 2's restrictions still bind; a finding asking for something not permitted is left out and raised as an open question; an empty `CRITIC_FINDINGS` means the stage re-runs only because an earlier one was revised. The section says every rule, validator and ceiling applies unchanged. The word "advisory" is not used for it: `CM6`/`CM7` keep that word out of the writer prompts, so the section says "every other finding — every one whose `severity` is not `blocking`".
7. **After revision.** The contact lines are re-attached from the pack, and all four critic lenses run **fresh**: `executeFinalCritic` has no input for round-1 findings or verdicts, and is called with exactly its ordinary inputs. **Exactly one round**: nothing plans from the round-2 panel, whatever its verdict.
8. **Output.** A new sibling `<source>-revised-<timestamp>` holding the reused files, the revised stage files, `05b-contact-lines.json`, the round-2 `06-final-critic.json`, `round-1-06-final-critic.json` (round 1's panel, copied), `revision-meta.json` (schema `gcd-content-revision/1`: source run, origin, start stage, re-run stages, reused files, the caps, finding ids sent per stage, dropped findings, findings not sent because their stage did not re-run, owner items, round-1 and round-2 verdicts, model requests, per-request and total cost, and a `status` of `started`, `completed` or `failed`), `summary.md` with a *Revision — one round* section showing round 1 and round 2 side by side (panel verdict, counts, each lens) and what each stage was sent, dropped, not sent, or kept for the owner, and `field-measurements.*`. The source run is never modified. If a revised stage fails validation, its paid response is saved to that directory's `rejected-responses.json` as in any run, `revision-meta.json` records the failure, no later request is made, and round 1 is left as it was. Under `--revise-once` the round-1 directory is never touched again: the failure handler is cleared before the revision starts, so even a refusal before the revision's own directory exists writes nothing into round 1's.
9. **Cost gate.** `revisionPolicies` prices exactly the requests the round will make — the start stage, every later writing stage, and the four lenses; never stages 1–2 — with the same cost flag and typed `LIVE` gate. Under `--revise-once` live, the first gate covers round 1 and says the revision is not included; after round 1 the revision prints its own exact ceiling and asks for `LIVE` again.
10. **Stage 4's prompt: no contact details in overlays.** "Overlay text never contains contact details: no phone number, no website or URL, and no "book online", "call us", "visit" or similar." Code attaches the contact line. Evidence: in the resumed run above, shot 7's overlay typed the phone number and "Book online", and no lens flagged it.
11. **Supporting changes.** The fake runner's production-coherence lens now returns one blocking finding owned by `production-direction` (and keeps its human item), so a fake run exercises the revision path end to end. The failure handler's file-writing half is exported as `saveFailureRecords` so the offline suite can drive it in-process. Two earlier mutations (`M404`, `M410`) had their sites re-pointed because the code they target moved (`...revisionBlocks` now follows stage 5's restriction blocks; stage 4's ordinary blocks now live in `WRITER_STAGE_BLOCKS`), with the same edits and expected checks.

**The cap (the owner's decision of 2026-09-28) and the budgets, before and after.** Derived in `payloadContract.ts` as `REVISION_FINDING_CAPS`: for each writing stage, the largest N for which that stage's worst-case assembled payload — its ordinary blocks (`WRITER_STAGE_BLOCKS`, the same definition `STAGE_ASSEMBLED_CEILINGS` now reads), `PREVIOUS_OUTPUT` at the stage's own output ceiling, and N worst-case findings (`criticFindingsBlockChars`, each at the critic's enforced 600-character issue and 300-character suggested action, escaping included, with the widest id and longest enums) — stays within `MAX_PAYLOAD_CHARS`, and never more than the 80 findings a panel can return (`MAX_PANEL_FINDINGS`). **`MAX_PAYLOAD_CHARS` stays 410,000**, derived from the six ordinary stages only; the revision ceilings (`REVISION_ASSEMBLED_CEILINGS`) are deliberately not part of that derivation.

| Writing stage | Ordinary request (unchanged) | Revision with all 80 findings — **the reason for the cap** | Derived cap | Revision at its cap |
|---|---:|---:|---:|---:|
| 3, hook-story-script | 196,142 | **430,627** — over 410,000 by 20,627 | **69** | 408,396 |
| 4, production-direction | 127,081 | 376,476 — fits | **80** (every finding) | 376,476 |
| 5, packaging-adaptation | 220,375 | **507,371** — over 410,000 by 97,371 | **31** | 408,342 |

`CRITIC_FINDINGS` with all 80 findings is 161,682 characters. No output contract changed, so no output floor moved: `reasoning-heavy` 87,000, `reasoning-standard` 126,000 and `critic` 111,000 against a 128,000 model cap each, with `POLICY_MAX_TOKENS` unchanged. The rough per-request input estimate the CLI prints is still `MAX_PAYLOAD_CHARS / 4`, so it did not move either.

**Selection over a cap, and the refusal.** A stage owning more findings than its cap keeps blocking findings first, then advisory findings in lens order (evidence-fidelity, platform-and-local, voice-and-craft, production-coherence), then in original order; what does not fit is dropped — advisory only — and every dropped finding is recorded (id, lens, severity, stage) in `revision-meta.json` and listed in `summary.md`. A stage owning more **blocking** findings than its cap is refused with `RevisionCapError`, naming the stage, the count and the cap, before the cost gate and before any request.

**Material design decisions.**

- **One function for both flags**, so `--revise-once` verifies round 1 from disk exactly as `--revise-from` would, and the two cannot drift.
- **Findings from a revalidated panel output, not a trusted file.** Round 1's findings decide what reaches a model, so they are re-proved lens by lens rather than read.
- **Owner-only routing, enforced twice**: by the plan, and again by each executor before its request.
- **Caps derived from the contract, not chosen**, with the shared boundary held fixed; blocking findings are never dropped — a stage that cannot carry them all is refused.
- **A leaf module for the blocks** (`revisionInput.ts` imports no stage module) so the three writers can import it without an import cycle through the critic.
- **The revision section is static prompt text**, present on every request and conditional on the two blocks, so a revision request uses the same registered, hashed instruction assets as any other.
- **A second typed `LIVE` under `--revise-once`**, because the revision's exact requests are only known after round 1.

**Material rejected alternatives.**

- **Multi-round loops** (revise until the critic passes). Rejected: unbounded cost, and a critic that sees its own earlier verdicts converges on agreement rather than on correctness. One round, then a person.
- **A separate "fixer" model rewriting the copy.** Rejected: it would be a writer with no claim block, stage-2 restrictions or validator of its own; the owning stage already has all three.
- **Revising stages 1–2.** Rejected: they set the angle and the permitted claims — the evidence boundary — which a critic finding may narrow but must never widen or re-open.
- **Showing round-1 findings or verdicts to the round-2 critic.** Rejected: it anchors the second review on the first, and a revision graded against its own brief can only look fixed.
- **Automatic revision without opt-in.** Rejected: every revision is new paid requests; it runs only when a person asks, behind the same cost flag and typed `LIVE`.
- **Raising `MAX_PAYLOAD_CHARS` to 510,000 to fit every finding (option 2 of 2026-09-28).** Rejected by the owner: it moves the shared boundary every stage is sized against, and every request's input estimate with it, for a worst case the resumed run (26 findings) is nowhere near.
- **A smaller `PREVIOUS_OUTPUT` alone (option 3).** Rejected: stage 5's gap is 97,371 characters, and even its provider-facing copy alone is dominated by the captions, so it cannot close the gap without also narrowing what the stage is shown of its own answer.

**Migrations / schema impact:** none. No SQL and no durable state. Two new operator-local run files (`revision-meta.json`, `round-1-06-final-critic.json`); every existing run file's format is unchanged.

**Automated validation.** See *Validation* in the PR and [Testing](TESTING.md). All nine offline suites pass; the full mutation harness passed all 492 mutations on 4 workers in 22m22s locally; two fake-runner rounds (`--revise-once`, and `--revise-from` on a saved run) each re-requested exactly stages 4 and 5 and the four lenses. Content intelligence **1,275 → 1,301**: `AF5d` (the two new modules are not executors; `AF5`'s module list gains them) and `CV1`–`CV25`. Mutations **468 → 492** (`M469`–`M492`); captured paths **25 → 27** (`revision.ts`, `revisionInput.ts`). Existing checks adjusted, not weakened: `AF5` (module list), `CN14` (it now finds the replay's own identity preflight rather than the file's last one, which is now the revision's).

**Production evidence:** none, and none is possible — no stage is enabled or reachable. **No live revision has been run**; the owner's first live `--revise-from` on the resumed run above is the acceptance evidence still to come. *(2026-09-28: the owner has since run it, and a second round on its output; see *Acceptance evidence* at the head of this record. Operator-local evidence, still no production evidence.)*

**Rollback / recovery:** revert the commit. No migration and no durable state; revision directories are operator-local and can be deleted.

**Security and privacy implications:** none new on any deployed path. The revision pass is operator-local, fake by default, and live only behind the cost flag and typed `LIVE`. Human-owned and `human_decision` findings are never sent to a model. Round 1 is never modified. No credential, provider, workflow or approval-gate change; the Phase-A approval gate and the live `brand-compliance-critic` are untouched.

**Accepted limitations.**

- **Revalidating the saved panel output is structural, not provenance.** An edit that keeps every lens consistent — one revisable owner swapped for another, say — is indistinguishable from a real answer and passes, exactly as for every other saved output.
- **The revision rules and the overlay contact rule are instructions to a model, not deterministic checks.** Nothing in code detects a phone number or "book online" in overlay text, or proves a revised answer fixed a finding; the round-2 critic's verdict is the evidence. *(Corrected 2026-09-29: since PR #101 (`f111012…`, `MERGED`, not deployed), `overlayContact.ts` refuses a phone number, a URL or a listed call to action in stage 4 `overlayText[].text`; the revision rules remain prompt-only.)*
- **A dropped advisory finding reaches no model** (it is recorded for the person running the pass).
- **Round 2 may still ask for revision**; a further round is a new, deliberate invocation, never automatic.
- **`--revise-once` live asks for `LIVE` twice.**

**Unresolved follow-ups.**

- ~~**This PR's merge SHA** (mutable-identifier exception) — **blocking**.~~ **Discharged 2026-09-28:** PR #98, merge `07b6435318011748b876015432f94e3ef73eb853`.
- ~~**This PR's own CI** — whether all five jobs pass on attempt 1 on the final head, with the mutation step's duration — recorded in the PR; to be reconciled into this record with the merge SHA.~~ **Discharged 2026-09-28:** PR CI run 36454119958 and `main` push run 36459335061 each passed all five jobs on attempt 1 (mutation step 21m48s and 20m55s); see *Merge reconciliation* above.
- ~~**The first live revision** (the owner's `--revise-from` on the resumed run) — acceptance evidence, operator-local.~~ **Done 2026-09-28 (operator-local):** 26 (9 blocking) → 19 (4 blocking) findings at $0.853952, then a deliberate second round, 19 (4 blocking) → 13 (2 blocking) at $0.819536; see *Acceptance evidence* above.
- **A deterministic check for contact details in overlay text** — a candidate, not built; the rule is prompt-only. *(2026-09-29: built by the contact-in-overlay change (PR #101, under *Merged repository change awaiting rollout*) — `IMPLEMENTED`, not merged.)* *(Corrected 2026-09-29: `MERGED` through PR #101 at `f111012…`; not deployed. Its record is now under *Merged repository change awaiting rollout*, no longer at the top of this file.)*
- Carried: the critic-prompt change for the identity records; recovering `reasoning-standard` headroom by shrinking the `claimUse[].summary` allowance; `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens; moving completed history out of this file.

**Documents updated:** this file (this record; the `PLANNED` entry relocated into it; PR #97's record moved to *Merged repository change awaiting rollout* with its merge and CI reconciled), [README](../README.md), [Status](STATUS.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), the three writing-stage prompts, and the mutation harness's header. Each was reread in full.

### CI headroom — the payload-contract mutation harness runs in parallel and the quality job's timeout is 60 minutes; `claim-boundaries` treats a comparison as a claim — `MERGED`

**Merge reconciliation (recorded 2026-09-28 by the revision-pass change above):** `MERGED` through [PR #97](https://github.com/Caposhi/GCD-Agents/pull/97) at `610e230e78209fe1d3ca4d83216ed3ff18deec21` (merged 2026-09-28T12:14:35Z), whose ordered parents are `d1ffc5f189a742890b9629101c564baf0a91213d` (the PR #96 merge) and then reviewed head `df2322eaa572a3f0865fcd3f1d015ca1cc919eef`. PR CI [run 36271968177](https://github.com/Caposhi/GCD-Agents/actions/runs/36271968177) (run 225) on head `df2322e` passed all five jobs on attempt 1: quality job **14m23s** of 60, mutation step **13m28s** for 468 mutations on **4 workers**. The `main` push [run 36420578993](https://github.com/Caposhi/GCD-Agents/actions/runs/36420578993) (run 226) on `610e230` passed all five jobs on attempt 1: quality job **20m49s** (12:14:41–12:35:30Z), mutation step **19m26s** (12:15:09–12:34:35Z); its worker count was not read from the log. The `deploy-production` workflow ([run 62](https://github.com/Caposhi/GCD-Agents/actions/runs/36422817721)) refused at its "Refuse while production automation is disabled" step, as on every `main` merge during the interval — no release. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** The blocking merge-SHA follow-up and the PR-CI follow-up below are discharged by this paragraph; where the record says unmerged, or that its CI figures are yet to be recorded, this paragraph supersedes it. Of its unresolved follow-ups, the stage 4 overlay that typed the phone number and "Book online" is addressed by the change above (a prompt rule, not a deterministic check). The rest of this record is preserved as written at implementation.


**State:** `IMPLEMENTED` on branch `claude/optimistic-wright-zjl7pc`, based directly on `origin/main` at `d1ffc5f189a742890b9629101c564baf0a91213d` (the merge of PR #96). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false`, no production path reaches any of them, and the partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) prohibits any release. The change is the mutation harness (`scripts/ci/payload-contract-mutation.mjs`), one `timeout-minutes` value in `.github/workflows/ci.yml`, one fact-free skill (`skills/claim-boundaries/SKILL.md`), one offline check, three mutations, and documentation. No stage prompt, contract limit, `config/` file, model, effort, `executionEnabled` value or deployed path changed; no job was added, split, renamed or removed; the tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** opened from `claude/optimistic-wright-zjl7pc` into `main`; its number and CI run are recorded in the PR itself. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Why — CI headroom.** PR #96's PR CI [run 36263299254](https://github.com/Caposhi/GCD-Agents/actions/runs/36263299254) (head `055901d`) passed all five jobs on attempt 1, but its *Node 22 offline quality gates* job took **43m59s** (18:39:16–19:23:15Z) against `timeout-minutes: 45`; its mutation step alone took **42m36s** (18:39:44–19:22:20Z) for 465 mutations. The harness ran every mutation one after another in a single disposable copy, so the job's duration grew with each appended mutation and one slower runner would have cancelled it. A cancelled quality job is a failed attempt 1, and the M1 readiness gate (`scripts/ops/m1-readiness/github.mjs`) accepts only a run whose five named jobs all succeed **on attempt 1** — so a re-run cannot repair it.

**Why — the critic's blind spot (operator-local evidence).** In four owner-run live runs, copy credited BMW with comparing city driving to "long, steady highway/long-distance" driving. As the owner reported it, the BMW record contains no such comparison; the comparison is the shop's own `drivingConditionsView` record (Lane S, `config/approved-facts.json`, which this repository confirms states that city driving "is harder on an engine and its components than steady highway driving" as the shop's professional judgment). No critic lens flagged it, and `claim-boundaries` had no rule that a comparison is a claim of its own. The BMW record itself is operator-local automotive evidence and was not re-examined from this repository.

*Corrected 2026-09-28 — the claim above was wrong; kept as written for history.* It said the BMW record contains no such comparison. That came from memory, not from the record. The owner verified the local BMW record `bmw-my2025-conditions-more-frequent-service` on 2026-09-28, and it compares city use with "a vehicle that is driven long distances at moderate engine speeds", so the copy's "than steady long-distance driving" was supported, and the critic was right not to flag it. There was no critic gap. **The motivation for the rule below is therefore precautionary**: a comparison is still its own claim and still needs a record that makes it, credited to that record's source, and `CM12`, the rule and `M466`–`M468` stay exactly as delivered. The follow-up to address an "unflagged BMW highway attribution" is withdrawn wherever this file carried it; the follow-up to describe the identity records in `SCRIPT_CLAIMS` / `PLATFORM_CLAIMS` stays open. Recorded by the documentation reconciliation at the top of this file.

**Delivered.**

1. **The mutation harness runs its mutations in parallel inside the same job.**
   - The worker count is `min(MAX_WORKERS, os.availableParallelism(), mutation count)` with `MAX_WORKERS` fixed at **4** (each worker runs a full `tsc` and suite, so memory bounds it as well as CPU). The log prints the count and the parallelism it was derived from.
   - **Each worker owns one disposable no-Git copy**, prepared exactly as the single copy was (no `.git`, locked dependencies linked). No two workers share a copy, a `dist/`, a mutated file or a child process. Within its copy a worker runs one mutation at a time exactly as before — mutate, rebuild when needed, run the suite, restore byte-for-byte, verify the restoration by SHA-256 — and tracks its own stale `dist/`.
   - Workers take the next mutation id from one shared queue. **Ids, expected-check matching and output order are fixed by position in `MUTATIONS`**: each mutation's results are buffered and printed strictly in id order, whichever worker ran it. No result depends on the assignment, because every copy starts from the same bytes and is restored before its worker takes the next mutation.
   - Builds and suites run asynchronously, each as the leader of its **own process group**, so a catchable signal stops every build and suite **together with the processes they start** (`npx` runs `tsc` through a shell; the suite spawns the local CLI), then restores every in-flight file and removes every copy. Found while testing this change: killing only the direct child left `tsc` running, and it recreated a removed copy's `dist/`.
   - Every existing guarantee is kept and each is still a named check: `M-isolation` (now over every worker's copy: none is the authoritative checkout or inside it, none has `.git`, no two share a directory), `M-capture`, `M-kill` (unchanged: a `SIGKILL`ed child with an actively mutated copy leaves the authoritative bytes and Git status unchanged during and after), `M0` (every copy builds and passes before any mutation), `M-end` (every copy passes again after), and `M-authority`. Two checks are new: **`M-order`** (every mutation ran exactly once and printed in id order) and **`M-copies`** (every worker's copy of every captured target is a regular file byte-identical to the authoritative bytes captured before the run).
2. **The quality job's `timeout-minutes` is 60** (was 45), as a safety net only. It is still one of exactly the five jobs the M1 readiness gate requires by name; no job was added, split, renamed or removed, and no step changed.
3. **`claim-boundaries` gains *A comparison is a claim*** — fact-free, after the attribution rules. Setting one thing against another ("more than", "less than", "harder than", "better than", "worse than", "versus", any other "than") is a claim of its own; it needs a record that states that comparison, not one that describes one side; it is credited only to the source whose record makes it, never to a source quoted beside it; and each comparison is checked on its own, even inside a sentence whose other statements are correctly credited. The three writers and the critic's evidence-fidelity lens already load the skill, so no prompt changed.
4. **`CM12`** requires the section, every named comparison form and each rule sentence, requires the writers and the evidence lens to load the skill, and refuses the motivating runs' own wording (`highway`, `city`, `driving`, `long-distance`, `steady`) anywhere in the skill; `CM9` and `AL5`–`AL7` still keep it free of every approved value, make, service, place and digit. **`M466`–`M468`** drop the record requirement, credit the comparison to the source quoted beside it, and add the motivating wording; each must make `CM12` fail by name.

**Figures — harness duration, before and after.**

| Where | Before (sequential) | After (parallel) |
|---|---:|---:|
| CI mutation step | 42m36s, 465 mutations (PR run 36263299254); 33m05s on `main` run 224, same commit tree | recorded in this PR's CI run; reconciled here with the merge SHA |
| CI quality job | 43m59s of 45 (PR run); 34m25s (`main` run 224) | recorded in this PR's CI run, now of 60 |
| Local, this container (4 CPUs, Node 22.22.2) | **65m21s**, 465 mutations, all pass (`d1ffc5f` in its own worktree) | **20m57s**, 468 mutations, 4 workers, all pass — **3.1× faster** |

The two local runs were compared line by line: every `M1`–`M465` result and restoration line is identical in content and order in both logs (939 lines); only `M0`'s wording changed (it now counts the copies). The sequential run was pinned to one CPU after its first minutes so two short parallel smoke runs could use the other three without slowing it; being sequential, it used one CPU at a time either way. Runner speed varies: the same 465 mutations took 42m36s and 33m05s on two GitHub runners the same afternoon. The CI speed-up depends on the runner's CPU count, which the log now prints.

**Material design decisions.**

- **Workers inside the one job, not more jobs.** The M1 readiness gate requires exactly five named jobs passing on attempt 1; a sharded matrix or a second mutation job would change that set.
- **A shared queue, not a fixed partition.** Mutations differ widely in cost (a `src/` mutation rebuilds; a prompt or SQL mutation does not), so a fixed partition leaves workers idle. Assignment is free to vary because results cannot depend on it; output order is fixed separately.
- **`MAX_WORKERS` = 4.** It covers the common GitHub-hosted runner sizes and bounds memory at four concurrent `tsc` runs and suites; the runner's own parallelism lowers it further.
- **Timeout 60, not higher.** It is a net for runner variance, not the fix; the parallel harness is the fix.

**Material rejected alternatives.**

- **Splitting the mutation harness into its own job, or a matrix of shards.** Rejected: the five-job rule.
- **Several workers in one copy.** Rejected: mutations would see each other's edits and `dist/`, and a restoration could not be attributed.
- **`worker_threads`.** Unnecessary: the work is child processes; asynchronous execution in one process parallelizes it with less shared state.
- **Only raising the timeout.** Rejected: it buys one or two more groups of mutations and leaves the growth in place.
- **A comparison rule in the critic's lens prompt.** Out of scope (no stage prompt changes here), and the skill already reaches the writers and the evidence lens, so a rule there covers both sides.

**Migrations / schema impact:** none. No SQL, no durable state, no run-file format change.

**Automated validation.** See *Validation* in the PR and [Testing](TESTING.md). Content intelligence **1,274 → 1,275** (`CM12`); mutations **465 → 468** (`M466`–`M468`); the harness's own checks gain `M-order` and `M-copies`.

**Production evidence:** none, and none is possible — no stage is enabled or reachable, and the harness is CI tooling.

**Rollback / recovery:** revert the commit. No migration and no durable state. Reverting the harness restores sequential execution; reverting the timeout returns to 45, which the sequential harness nearly exhausted.

**Security and privacy implications:** none new. The workflow's permissions, triggers, jobs and steps are unchanged; only one `timeout-minutes` value moved. The harness stays offline — no network, database, provider or credential — and still never writes the authoritative checkout. The skill states no fact. The Phase-A approval gate and the live `brand-compliance-critic` are untouched.

**Accepted limitations.**

- **The CI speed-up is bounded by the runner's CPU count.** A two-vCPU runner gets two workers; the log records the count.
- **A comparison rule is guidance to a model, not a deterministic check.** The writers and the evidence lens are told; nothing in code detects a comparison. Whether the next live run's critic flags one is the evidence.
- **A `SIGKILL` of the harness itself still strands its copies** (and now any running build or suite in them) — unchanged in kind from before, and still unable to touch the authoritative checkout (`M-kill`).

**Operator-local evidence — the resumed run of 2026-09-26.** Figures as the owner reported them, not re-examined from this repository and not production evidence. The owner's `--resume-from packaging-adaptation` of `2026-09-26T17-04-00-636Z`, written to `2026-09-26T17-04-00-636Z-resume-packaging-adaptation-2026-09-26T19-26-43-383Z`, cost **$0.73078** for the resume, reusing stage 1–4 outputs that had cost **$0.42916**. Stage 5 validated (the critic ran on it). The critic panel returned **26 findings: 9 blocking and 17 advisory**; the platform-and-local lens raised **0** blocking. Instagram's caption plus hashtags measured **1,940** characters against **1,815** stated and **2,136** enforced (1.069× the target, 91% of the budget — inside the room PR #96 sized). **Two errors the critic missed:** the BMW comparison above, and a stage 4 overlay typing the phone number and "Book online". *(Corrected 2026-09-28: only the overlay was an error. The BMW comparison was supported by BMW's own record and correctly not flagged; see the correction under *Why* above.)*

**Owner's decision, 2026-09-26: build a single revision pass — the next change** (`PLANNED` when written; now `IMPLEMENTED` — see the revision-pass record above, into which the planning entry was relocated). *(2026-09-28: `MERGED` through PR #98 at `07b6435…`; not deployed, enabled or production-validated.)*

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — **blocking**.
- **This PR's own CI**: whether all five jobs pass on attempt 1 on the final head, with the quality job's and mutation step's durations — recorded in the PR; to be reconciled into this record with the merge SHA.
- **The stage 4 overlay that typed the phone number and "Book online"** was missed by every lens; it is not addressed here (stage prompts are out of scope).
- Carried: the critic-prompt change for the identity records; recovering `reasoning-standard` headroom by shrinking the `claimUse[].summary` allowance; `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens; moving completed history out of this file.

**Documents updated:** this file (this record; PR #96's record moved to *Merged repository change awaiting rollout* with its merge and CI reconciled; the *Next repository change* entry), [README](../README.md), [Status](STATUS.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), and the mutation harness's header. Each was reread in full.

### Stage 5's caption stated below its enforced budget, and `--resume-from packaging-adaptation` in the local CLI — `MERGED`

**Merge reconciliation (recorded 2026-09-26 by the CI-headroom and comparison-rule change above):** `MERGED` through [PR #96](https://github.com/Caposhi/GCD-Agents/pull/96) at `d1ffc5f189a742890b9629101c564baf0a91213d` (merged 2026-09-26T19:25:27Z), whose ordered parents are `09b4cc7fa138164123e4ffa97755d3144c0338cb` (the PR #95 merge) and then reviewed head `055901dc1c934945c04ef3c15a167c502033ae59`. PR CI [run 36263299254](https://github.com/Caposhi/GCD-Agents/actions/runs/36263299254) on head `055901d` passed all five jobs on attempt 1; its quality job took **43m59s** against `timeout-minutes: 45`, with **465 mutations** in a mutation step of **42m36s** — the headroom problem the change above addresses. The `main` push [run 224](https://github.com/Caposhi/GCD-Agents/actions/runs/36266004566) on `d1ffc5f` also passed all five jobs on attempt 1 (quality job 34m25s, mutation step 33m05s — the same 465 mutations 9m31s faster on another runner), and the `deploy-production` workflow ([run 61](https://github.com/Caposhi/GCD-Agents/actions/runs/36267966612)) refused at its "Refuse while production automation is disabled" step, as on every `main` merge during the interval — no release. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** The blocking merge-SHA follow-up below is discharged by this paragraph; where the record says unmerged, this paragraph supersedes it. *After merge:* the owner's live `--resume-from packaging-adaptation` of `2026-09-26T17-04-00-636Z` ran, stage 5 validated with Instagram's caption plus hashtags at 1,940 against the 1,815 target and 2,136 budget, and the critic ran — the follow-up below asking for that run is discharged; see the record above. Of the carried follow-ups, the mutation-harness speed-up and the BMW attribution are addressed by the change above (the latter in `claim-boundaries`, not in a critic prompt). *(Corrected 2026-09-28: the BMW attribution was not an error — BMW's own record makes that comparison — so that follow-up is withdrawn rather than addressed; see the correction in PR #97's record above.)* The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/friendly-hypatia-1a2im5`, based directly on `origin/main` at `09b4cc7fa138164123e4ffa97755d3144c0338cb` (the merge of PR #95). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false`, no production path reaches any of them, and the partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) prohibits any release. The change is dormant stage code, one prompt, the operator-local CLI, the offline and mutation suites, and documentation. No enforced limit moved, no model, effort, critic, stage 1–4 prompt, `config/` file, `.github/` file or deployed path changed, and the tracked `.DS_Store` is untouched. No model was called.

**PR / merge:** opened from `claude/friendly-hypatia-1a2im5` into `main`; its number and CI run are recorded in the PR itself. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Why — two owner-run live runs on 2026-09-26, both lost at stage 5 (motivating evidence).** Both are **operator-local evidence, not production evidence**; the figures are as the owner reported them and were not re-examined from this repository.

1. **`2026-09-26T14-28-27-677Z`** spent **$0.530567** on stages 1–5; stage 5 was refused at `"claimUse" exceeds 24 entries` (27 legitimate entries). Fixed by PR #95 (below).
2. **`2026-09-26T17-04-00-636Z`**, the first run after PR #95 merged, paid for stages 1–5 again (five paid responses, saved to its `rejected-responses.json`), and stage 5 was refused at **`"packages[0].caption" exceeds 2136 characters (actual 2279)`**. 2,136 is Instagram's 2,200 provider limit less the 64-character contact-line reserve. Its `field-measurements` record Instagram's caption plus separator plus hashtags at **2,442 / 2,136**. The owner's previous run measured the same field at **2,034 / 2,136 (95%)**.

**Both failed runs kept validated stage 1–4 outputs** — only stage 5 was refused — so re-running from stage 1 would buy four stages again for outputs already paid for and already valid.

**Diagnosis.** The prompt stated 2,136 — the enforced figure itself — as the Instagram caption-plus-hashtags length. A model aims at a stated number and lands around it: 2,442 / 2,136 = **1.143×** on the stated measure, and the caption alone at 2,279 = 1.067× of it. The repository already records the same behaviour on other fields — stage 1 `concept` +5% and `rationale` +29% (*Output-field classification*), the critic's `issue` +5% (419 / 400). For internal-plumbing fields the answer was a hidden margin above the stated figure; for a platform field the ceiling may not rise, so the aim point has to come down.

**Delivered.**

1. **A stated caption target, derived in the contract** (`payloadContract.ts`). `STATED_CAPTION_TARGET_PERCENT` = **85** and `statedCaptionTarget(enforced) = floor(enforced × 85 / 100)`, in integer arithmetic so it never rounds toward the budget. Stage 5 reads it per platform as `statedCaptionBudget(platform)` = `statedCaptionTarget(effectiveCaptionBudget(platform))`. Each platform has one enforced caption budget, applied twice by the validator — to the caption alone and to caption + separator + hashtags — so one stated target covers both.
2. **The enforced budget is unchanged.** `effectiveCaptionBudget` and the validator are untouched: the smaller of the provider limit and `pipelineCaptionChars`, less `CONTACT_LINE_RESERVE_CHARS`. A caption between the stated target and the budget validates; one character over the budget is refused exactly as before.
3. **Every model-facing channel states the target** — the prompt's *Per-platform shape* (now also saying the figure counts caption, separator and hashtags **together, not the caption alone**, and no longer spelling out the enforced arithmetic) and the response schema's caption description. The prompt now states **no** enforced caption figure.
4. **A deliberate extension of the output-field classification**, recorded in `payloadContract.ts` as `STATED_BELOW_ENFORCED_FIELDS` = exactly `packaging-adaptation.packages[].caption`: **a product-bearing field may be *stated below* its enforced limit; it is never *enforced above* it.** This is distinct from `REVIEWER_ONLY_MARGIN_FIELDS` (a reviewer-only field enforced *above* its stated figure) — here the enforced figure is the platform's own limit less the reserve, and nothing a platform receives can grow.
5. **The run's measurement reports both figures.** `field-measurements` rows for `packages[<platform>].caption+hashtags` now carry the stated target in `stated` and the budget in `enforced`, so `% of stated` shows the aim-point overshoot directly.
6. **`--resume-from packaging-adaptation <run-dir>`** in `scripts/local/content-run.mjs`, built on the `--replay-critic` machinery. The replay's free checks moved — unchanged in order, and for a replay unchanged in wording — into one shared `verifySourceRun`, which both modes call before their spend guard:
   - it rebuilds the evidence pack with the run's **recorded scope** (a different `--scope-tags` is refused) at the run's recorded instant and review time, and **refuses unless `run-meta.json` records, and the rebuilt evidence matches, the approved-facts, automotive-facts and evidence-pack fingerprints** — a resume has **no** typed-`UNPROVEN` path, because it makes new paid requests;
   - it **revalidates the saved stage 1–4 outputs** through their owning validators (`validateStrategyConceptOutput`, `revalidateAutomotiveTruthOutput`, `revalidateHookStoryScriptOutput`, `revalidateProductionDirectionOutput`) and **refuses if any is missing, malformed or invalid**; it reads no stage 5 file, because the source run usually has none;
   - it then checks the contact-line and identity records and the evidence classes stages 5 and 6 require, prints the **cost ceiling for only the five requests it makes** (`resumePolicies`: stage 5 plus the four critic lenses — **~$13.35**, against ~$21.65 for a full run and ~$11.88 for a critic-only replay), and keeps the cost flag and the **typed `LIVE` gate**;
   - it writes stage 5, `05b-contact-lines.json`, the critic panel, `summary.md` (with a *Resumed at* line), field measurements and `resume-meta.json` (including the `modelRequests` it actually made) into a **new sibling directory** `<run>-resume-packaging-adaptation-<instant>`, which also holds **byte-for-byte copies** of the source's `run-meta.json` and stage 1–4 files so a later `--replay-critic` verifies it like any run. **The source run is never modified**, and no stage 1–4 executor is called.
   - Only `packaging-adaptation` is accepted as the resume point (`RESUME_POINTS`); it cannot be combined with `--replay-critic` or `--list-tags`, and it reuses the recorded goal and platforms.

**Figures — stated and enforced, per platform.**

| Platform | Enforced budget (unchanged) | Stated target (85%, floored) | Room between them |
|---|---:|---:|---:|
| `instagram` | 2,136 (2,200 − 64) | **1,815** | 321 (1.177×) |
| `facebook` | 2,008 (`min(63,206, 2,200)` − 192) | **1,706** | 302 (1.177×) |
| `google_business_profile` | 1,500 (1,500 − 0) | **1,275** | 225 (1.176×) |

**Material design decision — why 85% and not the owner's suggested ~88%.** The one measurement on this exact field is 1.143×. At 85% the headroom is 1 / 0.85 = 1.176×, which clears that measurement under both readings of what the model did: overshooting the stated total proportionally (1,815 × 1.143 = 2,075 ≤ 2,136), or aiming the caption alone at the figure and then adding the 163 characters of separator and hashtags that run carried (1,815 × 1.067 + 163 = 2,100 ≤ 2,136). At 88% the headroom is 1 / 0.88 = 1.136× — **below** the 1.143× already measured — so the same response to an 1,879 target would reach 2,148 and be refused again; `CQ4` asserts both. 85% is the nearest round percentage that clears the measurement with room; lower would take product room (about 290 words stay on Instagram) for no measured reason.

**Material rejected alternatives.**

- **Raising any enforced limit.** Out of scope, and never above a platform limit: the budget is the platform's own limit less the contact reserve.
- **88%.** Rejected on the measurement above.
- **A margin model like `REVIEWER_ONLY_MARGIN_FIELDS`** (state the budget, enforce more). Impossible for platform text: the enforced figure is already at the platform limit less the reserve.
- **Keying the caption in `STATED_FIELD_CEILINGS`.** That table holds one stated figure per field and enforces `CEILING_SLACK_MULTIPLIER`; the caption is per platform and stated *below* the enforced figure, so it has its own constant and set.
- **Resuming with the replay's `UNPROVEN` path for runs without fingerprints.** Rejected: a resume buys new stages on top of the saved outputs, so evidence identity must be proven. Both motivating runs record all three fingerprints.
- **Resuming inside the source directory.** Rejected: the source run is evidence of what was paid for and must stay byte-identical.
- **Accepting other resume points now.** Out of scope; `RESUME_POINTS` is a one-entry list and a mutation (`M462`) asserts widening it fails `CR7`.

**Migrations / schema impact:** none. No SQL, no durable state. In local run files, the `stated` value of the `field-measurements` caption rows now carries the target rather than the budget, and resumed directories add one new file, `resume-meta.json` (`gcd-content-resume/1`); `run-meta.json` and `replay-meta.json` are unchanged. Every stage 5 output that validated before this change still validates.

**Limit check.** No payload ceiling, output-token floor, `max_tokens`, handoff guard or `MAX_PAYLOAD_CHARS` moved (stage 5's output contract is sized on the enforced `pipelineCaptionChars`, which is unchanged); `CP5` and `CC19a` pass unchanged. The prompt goes from 15,117 to 15,120 characters (`MAX_INSTRUCTION_CHARS` 200,000 unchanged).

**Automated validation.** See *Validation* in the PR and [Testing](TESTING.md). `CQ1`–`CQ7` and `CR1`–`CR10` are new (content intelligence 1,257 → **1,274**); `CD6`, `CK14` and `CE7` were re-specified, not loosened, and the four fixtures that build a caption at the full budget (`BQ33`, `BQ33f`, and the fixtures behind `BX19` and `CQ7`) now fail by name instead of aborting the suite when a validator narrows the budget (details in Testing). Mutations **`M454`–`M465`** are appended after `M453` (453 → **465**).

**Production evidence:** none, and none is possible — no stage is enabled or reachable. The motivating runs are operator-local evidence.

**Rollback / recovery:** revert the commit. No migration and no durable state. A resumed directory is an ordinary local run directory; deleting it loses nothing the source run holds.

**Security and privacy implications:** none new. No credential, customer data, provider, publishing, scheduling, approval, model, effort, thinking or autonomy setting changed; the Phase-A approval gate and the live `brand-compliance-critic` are untouched. `--resume-from` spends only behind the same cost flag and typed `LIVE` gate as a full run, and only after every free check.

**Accepted limitations.**

- **The fraction is sized on one measurement of this field.** A model that overshoots a stated caption target by more than 1.176× will still be refused; the field measurements now show the overshoot against the target on every run, so the next data point arrives as data.
- **The prompt's size-ceiling rule still says one character over any ceiling discards the response.** For the caption that now overstates the risk (there are 225–321 characters of room), exactly as it already did for the plumbing fields with hidden margins; it is deliberate, so the model is not told about the room.
- **A resume reuses stages 1–4 as the source run produced them.** It cannot correct a weak stage 1–4 output; that still needs a full run.

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — **blocking**.
- **Recover `reasoning-standard` headroom by shrinking the `claimUse[].summary` allowance.** Stage 5 sets the `reasoning-standard` budget at **126,000 of the model's 128,000** output tokens since PR #95; its plumbing `claimUse[].summary` (stated 400, enforced 800) across 36 entries is the largest contributor that is not product. A narrower enforced allowance (still at least `CEILING_SLACK_MULTIPLIER` × its stated figure) or a lower stated figure would recover headroom; it moves an enforced limit, so it was out of scope here.
- An owner-run live `--resume-from packaging-adaptation` on `2026-09-26T17-04-00-636Z` after merge, to see stage 5 validate against the new target and the critic run. Not an acceptance gate for this change.
- Carried: the critic-prompt change for the identity records ~~and the unflagged BMW highway attribution~~ *(withdrawn 2026-09-28: not an error — BMW's own record makes the comparison; see the correction in PR #97's record)*; speeding up the mutation harness (now 465) *(2026-09-30: made parallel by PR #97; its builds made incremental and verified by the mutation-harness speed-up at the top of this file, `IMPLEMENTED`. Not discharged: the original 20-minute target was not met and the suite now dominates — see* The mutation step's growth *in the cursor.)*; `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens; moving completed history out of this file.

**Documents updated:** this file (this record; PR #95's record moved to *Merged repository change awaiting rollout* with its merge and CI reconciled; dated additions to *Output-field classification* and the local-CLI entry), [README](../README.md), [Status](STATUS.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), `agents/packaging-adaptation.md`, and the mutation harness's header. Each was reread in full.

### Stage 5's `claimUse` cap derived from the contract (24 → 36), and "Do not list" the identity records — `MERGED`

**Merge reconciliation (recorded 2026-09-26 by the stage 5 caption-target and `--resume-from` change above):** `MERGED` through [PR #95](https://github.com/Caposhi/GCD-Agents/pull/95) at `09b4cc7fa138164123e4ffa97755d3144c0338cb`, whose ordered parents are `6f350792fdd8fd65d01c6fcb786b95dab0b819aa` (the PR #94 merge) and then reviewed head `6cfc6da314c6bf572ef3fd1998911ea7451f6b10`. PR CI [run 221](https://github.com/Caposhi/GCD-Agents/actions/runs/36251559892) on head `6cfc6da` passed all five jobs on attempt 1, with **453 mutations** in a mutation step of **28m03s** (15:20:18–15:48:21Z). The `main` push [run 222](https://github.com/Caposhi/GCD-Agents/actions/runs/36257672883) on `09b4cc7` also passed all five jobs on attempt 1 (mutation step 27m44s), and the `deploy-production` workflow ([run 60](https://github.com/Caposhi/GCD-Agents/actions/runs/36259414681)) refused at its "Refuse while production automation is disabled" step, as on every `main` merge during the interval — no release. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** The blocking merge-SHA follow-up below is discharged by this paragraph; where the record says unmerged, this paragraph supersedes it. *After merge:* the owner's live run `2026-09-26T17-04-00-636Z` lost stage 5 on the Instagram caption instead — see the record above. Whether that response's `claimUse` would have validated is not known: the validator checks every package before `claimUse`. The rest of this record is preserved as written at implementation.

**State:** `IMPLEMENTED` on branch `claude/cool-shannon-3rf47s`, based directly on `origin/main` at `6f350792fdd8fd65d01c6fcb786b95dab0b819aa` (the merge of PR #94). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false`, no production path reaches any of them, and the partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) prohibits any release. No model was called.

**PR / merge:** opened from `claude/cool-shannon-3rf47s` into `main`; its number and CI run are recorded in the PR itself. **This PR's merge SHA is the blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md).

**Why — the owner's run of 2026-09-26 (motivating evidence).** Run `2026-09-26T14-28-27-677Z`, a live run by the owner after PR #94 merged, spent **$0.530567** on stages 1–5, and stage 5's paid response was then **refused by its validator**: `"claimUse" exceeds 24 entries`. It carried **27** entries: instagram 10, facebook 10, google_business_profile 7. **Every one was a record stage 3 used** — stage 3 bound 11 — and **no identity record was listed**. Stage 6 never ran. This is **operator-local evidence, not production evidence**; the figures are as the owner reported them and were not re-examined from this repository.

**Corrected diagnosis.** The refusal was **not** caused by identity records padding the list. It was a **fixed cap below the contract's own legitimate maximum**: `PACKAGING_FIELD_LIMITS.maxClaimUses` was a hand-kept 24, while a caption may rely on every record stage 3 used (at most `SCRIPT_FIELD_LIMITS.maxClaimUses`, 12), a record may be bound once on each platform, and a request names at most `maxRequestedPlatforms` distinct platforms (3; `validateRequestedPlatforms` refuses more, and refuses a repeat). The legitimate maximum is therefore 12 × 3 = 36, and any response whose bindings totalled more than 24 across its platforms — more than eight per platform on average — was refused, however faithful.

**The owner's scoped dry pass.** Before that run, the owner's dry pass `2026-09-26T14-27-21-098Z` built a **44-record** evidence pack under the run's recorded `--scope-tags` (below the 64-record cap that an unscoped 67-record pack exceeds since Lane S). Operator-local; the tags themselves stay on the owner's machine.

**Delivered.**

1. **The cap is derived** (`payloadContract.ts`). `PACKAGING_FIELD_LIMITS.maxClaimUses` is now `SCRIPT_FIELD_LIMITS.maxClaimUses * PACKAGING_MAX_REQUESTED_PLATFORMS` — **36** today — and `maxRequestedPlatforms` reads the same new constant, `PACKAGING_MAX_REQUESTED_PLATFORMS` (3), so the platform count is written once. The identity records are **not** counted: code binds them on every platform (`packagingClaimRecords`), and the prompt now tells the model not to list them. The validator, the response schema's description (`at most 36 entries`), `OUTPUT_FIELD_BOUNDS`, and every derived ceiling below read the one value.
2. **The prompt states the contract's figure** (`agents/packaging-adaptation.md`). Both `claimUse` ceilings — the output sketch and the size-ceiling list — say **at most 36 entries**. That figure was already contract-checked: `CD2`/`CD3` compare every stated ceiling with the validator's and fail on a stale number, and they did fail on "24" until the prompt was updated. *The identity records* now says: "**Do not list them in `claimUse`; code binds them on every platform.**" and that an entry for one only spends room the chosen claims may need.
3. **Tests** `CP1`–`CP5` and **mutations** `M447`–`M453` (below).

**Decision — a model-listed identity entry stays accepted, and counts toward the cap.** Checked in source: the validator accepts any id in `packagingClaimUniverse` (stage 3's used records plus the identity records), refuses a repeat per platform, and `packagingClaimRecords` never binds an identity record twice, so an identity entry is harmless to correctness. Today's behaviour is kept for two reasons. *Refusing* one would discard a paid response for citing a record it was shown — the alternative PR #93 rejected. *Not counting* one toward the cap would let a valid response carry 12 + 2 = 14 entries per platform, 42 in all, and the output contract would have to be sized for 42: stage 5's floor would reach about 139,000 tokens, over the 128,000 model cap. So the prompt says "Do not list", an identity entry is accepted if listed, and it counts; the only response this still refuses is one that binds all twelve used claims on every platform **and** lists an identity record as well (`CP3`).

**Before → after — every figure the cap feeds** (built at `6f35079` and at this change; `payloadContract.ts`, `modelPolicy.ts`, and the CLI's own estimator).

| Value | Before (`main` at `6f35079`) | After |
|---|---:|---:|
| `PACKAGING_FIELD_LIMITS.maxClaimUses` | 24 (typed) | **36** (derived: 12 × 3) |
| `maxRequestedPlatforms` | 3 (typed) | 3 (from `PACKAGING_MAX_REQUESTED_PLATFORMS`) |
| `PLATFORM_CLAIMS_BLOCK_CHARS` (evidence and platform lenses) | 32,204 | **46,964** |
| `SCRIPT_CLAIMS` — stage 5 and the evidence lens (`PACKAGING_SCRIPT_CLAIMS_BLOCK_CHARS`) | 38,362 | 38,362 — unchanged (sized by stage 3's 12 + 2) |
| Stage 5 output contract (`PACKAGING_OUTPUT` transport) | 98,084 | **125,132** |
| Contacted stage 5 output the critic receives (`CONTACTED_PACKAGING_OUTPUT` transport) | 104,852 | **131,900** |
| `packaging-adaptation` assembled ceiling | 220,375 | 220,375 — unchanged (its input blocks do not carry its own output) |
| Critic lens ceilings: evidence / platform / voice / production | 223,464 / 137,426 / 26,153 / 265,277 | **238,224 / 179,234** / 26,153 / **292,325** |
| `final-critic` assembled ceiling (largest lens) | 265,277 | **292,325** |
| `MAX_PAYLOAD_CHARS` | 410,000 | 410,000 — unchanged (still set by `automotive-truth`, 403,564) |
| Headroom under `MAX_PAYLOAD_CHARS`: `final-critic` | 144,723 | 117,675 |
| `POLICY_OUTPUT_TOKEN_FLOORS`: `reasoning-heavy` / `reasoning-standard` / `critic` | 87,000 / 99,000 / 111,000 | 87,000 / **126,000** / 111,000 |
| `POLICY_MAX_TOKENS["reasoning-standard"]` (derived from its floor) / model output cap | 99,000 / 128,000 | **126,000** / 128,000 |
| `reasoning-standard` stream deadline (`POLICY_STREAM_DEADLINE_MS`) | 84 min | **106 min** |
| Critic lens output-token floors | 111,000 / 111,000 / 46,000 / 46,000 | unchanged (lens contracts do not carry stage 5's cap) |
| Handoff guards (stages 1–4, evidence pack) | 66,022 / 86,011 / 72,621 / 87,531 / 337,376 | unchanged |
| Prompt characters, `agents/packaging-adaptation.md` | 15,067 | 15,185 (`MAX_INSTRUCTION_CHARS` 200,000 unchanged) |
| CLI ceiling estimate: full run / critic-only replay | ~$20.84 / ~$11.88 | **~$21.65** / ~$11.88 |

**Limit check — no enforced limit is exceeded and none was raised.** Every assembled ceiling fits `MAX_PAYLOAD_CHARS`; every floor is strictly below its model's 128,000 output cap (`CC19a`); the critic's lens floors still leave `THINKING_RESERVE_TOKENS` under its cap; the instruction ceiling is untouched. **One sizing rule is crossed, and is recorded rather than hidden:** `reasoning-standard` at 126,000 is above the one-fifth-unallocated rule (≤ 102,400) PR #85 used to size the plumbing margins, and leaves **2,000 tokens** under its model's cap. That rule is documented as a sizing rule, not an invariant, and asserting it was explicitly rejected (see *Output-field classification* below); the critic already exceeds it. The consequence is that stage 5's contract has almost no room left: any future growth of stage 5's output — another platform, a longer summary, a wider margin — will fail `CC19a` rather than fit, and 2.5× on `claimUse[].summary` would now reach 139,532. **The owner should accept this before merge.**

**Migrations / schema impact:** none. No SQL, no durable state, no saved-file format change. Every stage 5 output that validated before this change still validates.

**Material rejected alternatives.**

- **Raising the cap to another hand-kept number** (for example 30 for the observed 27). Rejected: it would be wrong again at the next run whose captions rely on more of stage 3's claims, and nothing would tie it to the platform count or stage 3's cardinality.
- **Excluding identity entries from the count.** Rejected: see *Decision* above — the output contract would need 42 entries and would overflow the model cap.
- **Refusing a model-listed identity entry.** Rejected, as in PR #93: a paid response would die for citing a record it was shown.
- **Narrowing `PLATFORM_CLAIMS` to stage 3's 12 + 2 per platform** (it counts the whole cap on every platform, which over-approximates). Not done: the owner asked for recomputation, not a derivation change; the over-approximation is safe and every ceiling still fits.
- **Lowering `claimUse[].summary`'s margin to buy back budget.** Out of scope ("any other limit").

**Automated validation.** Build and typecheck clean. `npm run test:offline` passes all nine suites; content-intelligence gains `CP1`–`CP5` (1,252 → 1,257). `CP1` requires the cap to equal stage 3's cardinality times the contract's platform count, the platform count to equal the closed enum's size with a repeated platform refused, the source to derive both rather than type a number, and the response schema and field bound to carry it. `CP2` validates a response binding all 12 of stage 3's used claims on each of the three platforms (36 entries), the owner's 10/10/7 shape, and the maximal fixture now binding 12 per platform. `CP3` refuses 37 entries by name and accepts 35 used plus one identity entry. `CP4` requires the prompt to state the derived figure twice, no stale 24, and "Do not list". `CP5` requires stage 5 to set the `reasoning-standard` floor, its budget to equal that floor under the model's cap, and every assembled payload to fit. `CD2`, `CD3` and `CC43a` were already contract-checked and needed only the prompt and comment updates. `npm run test:payload-mutation` derives **453 mutations** (451 prohibited, 2 coordinated); `M447`–`M453` are appended after `M446` and were each run and caught locally: the cap back to 24 (`CP1`, `CP2`), hand-kept at 36 (`CP1`), multiplying a typed 3 (`CP1`), the validator not counting identity entries (`CP3`) or letting one entry past the cap (`CP3`), and the prompt stating 24 (`CP4`) or dropping "Do not list" (`CP4`). A fake-runner full run with `--scope-tags approved-facts,claim-cap-auto` against a synthetic 84-record automotive file built a **34-record** pack and completed all six stages; the same file unscoped refused at 84 > 64 before any stage. The full list and results are in the PR.

**Harness duration.** Recorded in the PR and in [Testing](TESTING.md) from the local run and the CI run on the final head. For reference: PR #94's run 219 took **21m06s** in its mutation step for 446 mutations (13:53:15–14:14:21Z), faster than PR #93's run 216 (33m50s for 445), so runner speed varies more than the per-mutation growth.

**Production evidence:** none, and none is possible — no stage is enabled or reachable. The motivating run is operator-local evidence.

**Rollback / recovery:** revert the commit. No migration and no durable state. A stage 5 output with more than 24 entries saved after this change would then be refused on replay, which fails closed.

**Security and privacy implications:** none new. No credential, customer data, provider, publishing, scheduling, approval, model, effort, thinking or autonomy setting changed; the Phase-A approval gate and the live `brand-compliance-critic` are untouched. The stage 5 `max_tokens` rises to 126,000, which can raise the cost of a live stage 5 call only as far as the output actually produced.

**Accepted limitations.**

- **`reasoning-standard` is 2,000 tokens under its model's cap** (see *Limit check*).
- **A response that binds every used claim on every platform and also lists an identity record is still refused.** The prompt now says not to list them.
- **The critic lens prompts** still describe `SCRIPT_CLAIMS` as "every evidence record stage 3 bound" (carried from PR #93; out of scope here), and still state `claimFindingUse` at 24 — a separate limit this change does not touch.

**Unresolved follow-ups.**

- **This PR's merge SHA** (mutable-identifier exception) — blocking.
- An owner-run live full run after merge, to confirm stage 5 now validates; not an acceptance gate for this change.
- Carried: the critic-prompt change for the identity records ~~and the unflagged BMW highway attribution~~ *(withdrawn 2026-09-28: not an error — BMW's own record makes the comparison; see the correction in PR #97's record)*; speeding up the mutation harness (now 453) *(2026-09-30: made parallel by PR #97; its builds made incremental and verified by the mutation-harness speed-up at the top of this file, `IMPLEMENTED`. Not discharged: the original 20-minute target was not met and the suite now dominates — see* The mutation step's growth *in the cursor.)*; `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens; moving completed history out of this file.

**Documents updated:** this file (this record; Lane S and PR #93 moved to *Merged repository change awaiting rollout* with their merge and CI reconciled; a dated addition to the 64-record-cap item), [README](../README.md), [Status](STATUS.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), `agents/packaging-adaptation.md`, and the mutation harness's header. Stale "`IMPLEMENTED`, not merged" markers for PR #88, #89, #92 and #93 work in the README, Architecture, AI handoff and Security and continuity were reconciled to `MERGED` where this change touched those passages; the README's guard and assembled-ceiling figures, which predated PR #92 and PR #93, were refreshed. Each was reread in full.

### Lane S — CTO-attested oil-interval rationale and driving-conditions facts — `MERGED`

**Merge reconciliation (recorded 2026-09-26 by the stage 5 `claimUse` cap change above):** `MERGED` through [PR #94](https://github.com/Caposhi/GCD-Agents/pull/94) at `6f350792fdd8fd65d01c6fcb786b95dab0b819aa`, whose ordered parents are `fb88ec5974f1cb9f6f51e59d47c621015bba70ef` and then reviewed head `3294ae415b060c24d9bf58bef6f03551d0ab3a5c`. PR CI [run 219](https://github.com/Caposhi/GCD-Agents/actions/runs/36246631793) on head `3294ae4` passed all five jobs on attempt 1 (446 mutations; mutation step 21m06s). The `main` push [run 220](https://github.com/Caposhi/GCD-Agents/actions/runs/36248088902) on `6f35079` also passed on attempt 1, and the `deploy-production` workflow ([run 59](https://github.com/Caposhi/GCD-Agents/actions/runs/36249726084)) refused at its "Refuse while production automation is disabled" step, as it has on every `main` merge during the interval — no release. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** The blocking merge-SHA follow-up below is discharged by this paragraph; where the record says unmerged, this paragraph supersedes it.

**State:** `IMPLEMENTED` on branch `codex/lane-s-approved-facts`, based directly on `origin/main` at `fb88ec5974f1cb9f6f51e59d47c621015bba70ef`. **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, and not `PRODUCTION-VALIDATED`.** This change is limited to three owner-attested strings in `config/approved-facts.json`, adapter and mutation regressions, and documentation. It changes no schema, application code, prompt, approval gate, workflow, provider authority, or deployed service. The current partial-release interval (bound `2026-10-22T18:52Z`; see [Status](STATUS.md)) prohibits any release, so even after merge this remains `MERGED`-only until a separately authorized release. The live worker at `44d7336…` does not carry it. No model was called.

**PR / merge:** [PR #94](https://github.com/Caposhi/GCD-Agents/pull/94), from `codex/lane-s-approved-facts` into `main`. Its merge SHA is necessarily unknown before merge and is the **blocking follow-up** permitted by the mutable-identifier rule in [`AGENTS.md`](../AGENTS.md). Never treat the eventual PR merge as a release.

**Authorization and delivered scope.** Michael Capote, GCD CTO, attested `oilChangeRationale`, `oilChangeTimeLimit`, and `drivingConditionsView` on 2026-09-26 as the shop's professional judgment, not measured data, and authorized their repository addition with the supplied wording byte for byte. They are not sourced from the website. `_note` records that provenance. The existing deterministic adapter produces ids `approved-facts:oilchangerationale`, `approved-facts:oilchangetimelimit`, and `approved-facts:drivingconditionsview`; each claim is exactly `"<field>: <value>"`, each is `verified_business_fact`, each is within `claimChars` 1,000, and each carries exactly `approved-facts` and `gcd` — no `automotive-capability` tag. The file now projects 30 approved facts and has sha256 `f8cebefd5e4bbab676bb64884f4ee79a02c43064e14f729a9c7de262343ae58d`.

**Production-path impact.** A future, separately authorized worker release carrying this file would let the deployed copywriter say that GCD deliberately recommends 5,000 miles or 6 months as a conservative shop interval, not a BMW or Mercedes-Benz requirement; explain that shop judgment by the technicians' experience with sludge, excessive carbon buildup, other common engine problems, and long-term engine/component reliability while saying it is not based on oil-analysis testing; explain the six-month limit by GCD's South Florida experience with condensation moisture and contaminants in short-trip or long-sitting cars, again not as oil-analysis testing; and state that GCD considers city short-trip, stop-and-go and idling use harder than steady highway use, with different component wear, as professional judgment rather than a manufacturer statement. The deployed orchestrator reads the JSON, removes metadata keys, caches and deep-freezes the canonical facts, discards caller-supplied alternatives, gives the same brief to the copywriter, and gives the exact generated provider payload plus that brief to `brand-compliance-critic`; the critic may accept only faithful claims grounded in those strings. Phase A still requires a live, durable human approval whose hash matches the exact provider-bound subject before every provider call. That gate is untouched.

**Pack-size and replay consequence.** With the owner's 37 local automotive records, the 30 approved facts produce 67 projected records. An unscoped local run therefore correctly exceeds `EVIDENCE_LIMITS.maxProjectedRecords` 64 and refuses before any paid call. Local runs now need `--scope-tags` including `approved-facts` and one or more relevant automotive tags; a fake-runner demonstration with one selected synthetic automotive tag builds a 31-record pack. Runs recorded before Lane S carry the earlier approved-facts hash and correctly refuse replay against this file.

**Evidence-review conclusions — source list, not transcripts.** These titles and links preserve the reviewed source inventory and its disposition; they do not replace the owner's attestation or turn the statements into measured findings.

1. Anderson's Garage, “Changing Your Oil is CRITICAL…” — [YouTube](https://www.youtube.com/watch?v=hKeVk070u50); low weight.
2. The Motor Oil Geek, “The FACTS About Oil Changes (What The Owner's Manual DIDN'T Tell You)” — URL not supplied.
3. Challenger Auto and Truck Service, “The Oil Change Interval Crisis” — URL not supplied.
4. Auto Care Pro, “I Tested 3,000 vs 7,500 vs 10,000…” — URL not supplied; **rejected**.
5. Royalty Auto Service, “We Are Adjusting Our Oil Change Intervals At The Shop!” — URL not supplied.
6. Auto Care Pro, “The TRUTH About 5,000 vs 15,000…” — [YouTube](https://www.youtube.com/watch?v=tQn0PelA-9o); **rejected**.
7. AutomotivePress, “HOW OFTEN SHOULD YOU CHANGE YOUR OIL? ENGINEER & FORMER NISSAN GT-R LEADER EXPLAINS” — [YouTube](https://www.youtube.com/watch?v=FlmTPH_5UmQ).
8. Endless Money Pits, “Does Oil Really Need to be Replaced Every Year?” — [YouTube](https://www.youtube.com/watch?v=7hJU112oUg8).
9. Project Farm, “Will Annual Oil Change Damage Your Car?” — [YouTube](https://www.youtube.com/watch?v=T-yt5a1cWd4).
10. Endless Money Pits, “Are You Changing Oil Too Often? … BMW Oil Analysis PART 1” — [YouTube](https://www.youtube.com/watch?v=z1ZJJyfph4M).
11. SprinterFix × The Motor Oil Geek, “How Often Should You Change Your Oil? The Truth From An Oil Expert” — [YouTube](https://www.youtube.com/watch?v=JUxlxx4dKXk).
12. Engineering Explained, “What If You Forget To Change Your Oil?” — [YouTube](https://www.youtube.com/watch?v=eVyPWP5t09c).

*Dated addition, 2026-09-28:* the URLs for sources **2, 3, 4 and 5** are still missing. They were never supplied to this repository, none is inferred or reconstructed here, and recording them is an open follow-up for the owner.

**Owner wording decision.** “High heat” was deliberately left out of `oilChangeTimeLimit`: sources 8, 9, and 11 contradict heat-driven oil degradation, and stage 2 forbids that claim. The approved sentence is the owner's narrower professional judgment about condensation moisture and contaminants.

**Design decisions, rejected alternatives, and safety.** The canonical JSON remains the only fact authority; the generic adapter remains unchanged; these statements stay `verified_business_fact` because they are owner-attested shop judgment rather than measured automotive data. Adding `automotive-capability`, changing another approved field or `automotive-facts`, widening the 64-record cap, weakening the Phase-A gate, editing a prompt, importing evidence, or releasing were rejected as out of scope. The change introduces no credential, customer data, platform export, database dump, new URL, migration, durable write, or external-system dependency. Rollback is a repository revert; the hash check makes incompatible replays refuse rather than silently drift.

**Validation.** Build and typecheck passed. All nine offline suites passed, 1,755 checks total: posting 52, image 18, orchestrator 119, gate 56, API 51, render identity one invariant-suite pass, ownership/recovery 112, content intelligence 1,252, and interval monitor 94. The payload-mutation harness passed all 446 mutations (444 prohibited and 2 coordinated updates), including appended `M446` changing a Lane S value and being caught by appended `CO2`; the Lane S self-tests are `CO1`–`CO4`. Simulated dry run, deployment-controller fixtures, the 461-check M1 readiness offline suite, production dependency audit (zero vulnerabilities), AgentShield 1.4.0 (exit zero, B/87, no critical/high; nine pre-existing oversized-agent medium and nine pre-existing unspecified-model low findings), Markdown links (65 files), environment coverage (35 variables), sensitive scan (185 tracked text files, manually triaged clean), whitespace review, and both fake-runner pack-size cases passed. The unscoped run refused 67 records before a stage call; `--scope-tags approved-facts,lane-s-auto` built 31 and completed all six fake stages. Complete final diff review is required again after the PR number is recorded. No live model call was made. Full detail is in [Testing](TESTING.md).

**Unresolved follow-up:** ~~this PR's merge SHA~~ — discharged above (`6f35079`). No release is authorized; the interval's release prohibition must be resolved and a release separately authorized before production can carry these facts.

**Documents updated:** [README](../README.md), this file, [Status](STATUS.md), and [Testing](TESTING.md). Each modified document is reread as a whole before push.

### Evidence-pack scoping in the local CLI, the shop's identity records bound on every stage 5 platform, and stage 2's whitelist at 16 — `MERGED`

**State:** `MERGED` through [PR #93](https://github.com/Caposhi/GCD-Agents/pull/93) at `fb88ec5974f1cb9f6f51e59d47c621015bba70ef`. Its ordered parents are `f2a58785c8a9aa2605dda3c7f7daf34ffdf16007` and then reviewed head `00c9cde019a349000e0b9e767823c409c8d98000`. **Not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false` and no production path reaches any of them. CI [run 216](https://github.com/Caposhi/GCD-Agents/actions/runs/36178128557) on head `00c9cde` passed all five jobs on attempt 1: 445 mutations, mutation step 33m50s, quality job 35m10s. The `main` push [run 217](https://github.com/Caposhi/GCD-Agents/actions/runs/36244544876), head `fb88ec5`, **passed on attempt 1** (completed 2026-09-26T13:45:30Z; still pending when Lane S's documentation was written, reconciled by the stage 5 `claimUse` cap change). The rest of this record preserves the implementation detail; where it says unmerged or that the merge SHA is unknown, this paragraph supersedes it.

**PR / merge:** [PR #93](https://github.com/Caposhi/GCD-Agents/pull/93), from `claude/eager-hawking-pb2cr7` into `main`, merged as `fb88ec5974f1cb9f6f51e59d47c621015bba70ef`. The blocking merge-SHA follow-up recorded at implementation is discharged by Lane S above.

**Why — the owner's run after PR #92 (motivating evidence).** Run `2026-09-25T16-21-51-293Z`, a full six-stage live run by the owner after PR #92 merged, cost **$1.172956**. The critic panel returned **31 findings, 17 blocking** (the run before PR #92, `2026-09-24T18-01-36-439Z`, cost $1.161138 with 28 findings, 14 blocking). **Patterns (A), (B) and (C) from PR #92's record were gone from the copy.** The remaining blocking findings were, as the owner reported them:

- **8 about facts not bound**: no stated rationale, and the makes, the oil specification and the records squeezed out of stage 2's twelve-claim whitelist;
- **9 writing errors**: ASSYST overreach, BMW "never meant", the shot-3 attribution, shot order, and a garbled sentence.

This is **operator-local evidence, not production evidence**: no stage is enabled or reachable. The run's outputs exist only on the owner's machine and were not re-examined from this repository; the figures are as the owner reported them.

**Owner decisions, 2026-09-25.**

- **Brand names in hashtags and keywords are approved** as descriptive use, with no affiliation implied.
- **Identity facts are attached by code**, and **stage 2's `allowedClaims` cap is raised to 16.**
- **The "why" facts** (the missing rationale) **follow in a separate Lane S change** to `config/approved-facts.json`, after this one merges.

**Verified in source before the change** (at `f2a5878`):

- `buildEvidencePack` already accepted `tags` and `subjects` (`matchesScope` in `pack.ts`), but `content-run.mjs` never passed them, so every run projected every loaded record — the 64-record cap problem recorded under *Open — the evidence pack is at its 64-record cap*.
- The identity records are `approved-facts:makes` and **`approved-facts:servicearea`** — the adapter's `approvedFactEvidenceId("serviceArea")` lower-cases the field name, so there is no hyphen and no "aerea". Both are `verified_business_fact` records with attributes `makes` and `serviceArea`.
- Stage 5's whole factual authority was stage 3's used-claim set (`scriptUsedClaimRecordsForPackaging`), and the critic's `PLATFORM_CLAIMS` listed only stage 5's own model bindings, so a make- or place-naming hashtag or keyword was supported only on a platform where stage 5 had bound a record stage 3 happened to use.
- `TRUTH_FIELD_LIMITS.maxAllowedClaims` was 12, and stage 2 may permit any citable fact in the pack, not only stage 1's — so a wider whitelist is usable. `POLICY_MAX_TOKENS["reasoning-heavy"]` is *derived* from stage 2's output contract (`POLICY_OUTPUT_TOKEN_FLOORS`), so it moves with the cap.

**Delivered.**

1. **Evidence-pack scoping in the CLI** (`scripts/local/content-run.mjs`).
   - **`--scope-tags a,b,c`** narrows the pack to records carrying at least one of the tags, through the pack builder's own `tags` scope. The tags are trimmed, deduplicated and sorted; an empty list is refused rather than read as no scope. **With no flag the pack, its fingerprint and `run-meta.json` are exactly what they were before** (`CN1`, `CN3`).
   - **Always included, whatever the scope:** the contact-line records (`approved-facts:shop`, `approved-facts:phone`, `approved-facts:bookingurl`) and the identity records (`approved-facts:makes`, `approved-facts:servicearea`), read from `CONTACT_FACTS` and `IDENTITY_FACT_IDS` rather than retyped. `buildEvidencePack` gains an optional `alwaysIncludeIds`, consulted only when a scope is given; a kept record is validated, sorted, counted and classified like any other (`CN2`). A scoped run refuses with `EvidenceScopeError`, naming the record, if any of the five was not loaded — before any pack exists, so before the cost gate (`CN13`).
   - **Recorded and fingerprinted.** A scoped run writes `evidenceScope` — `{ schema: "gcd-evidence-scope/1", tags, alwaysIncludedIds }` — into `run-meta.json` (and `replay-meta.json`), and the pack fingerprint becomes the sha256 of that scope's JSON, a newline, then the stage projection. An unscoped run writes no `evidenceScope` and its fingerprint is the projection's plain sha256, as before (`CN3`, `CN4`).
   - **`--replay-critic` reuses the source run's recorded scope**, with or without an identical `--scope-tags`; a different `--scope-tags`, one given against an unscoped run, an always-included set that differs from this CLI's, and a malformed `evidenceScope` are refused before any output directory exists. An edited or removed recorded scope is refused by the fingerprint (`CN6`–`CN8`).
   - **`--list-tags`** prints each tag and how many loaded records carry it, sorted, plus the total — and, with `--scope-tags`, how many records that scope would include. It prints no claim text and no record id, takes no goal and no `--replay-critic`, and returns before any pack, registry, runner or cost estimate, even with `--runner live` (`CN9`–`CN12`). The automotive-facts file is local-only, so its tags were not seen by this change; the owner chooses scopes from `--list-tags`.
   - **An identity preflight**, `assertIdentityFactsAvailable`, runs beside the contact-line preflight: in a full run before the cost ceiling and the live prompt, and in a replay before its spend guard (`CN14`).
   - `main` is exported and takes `argv`, and the evidence helpers are exported, so the offline suite drives fake runs in-process rather than as child processes (see *Design decisions*).
2. **The identity records, bound on every stage 5 platform by code** (`src/harness/agents/identityFacts.ts`, `packagingAdaptation.ts`, `finalCritic.ts`).
   - `identityFacts.ts`, modelled on `contactLine.ts`, reads both records from the pack's `allowedFacts`. Either one absent, conflicted, stale or inactive, not a verified business fact, carrying another attribute, or not reading `"<field>: <value>"` is an `IdentityFactError` (`CN17`). The module states no make or place (`CN23`).
   - **Stage 5's claim set** (`packagingClaimUniverse`) is stage 3's used records, in stage 3's order, then the identity records stage 3 did not already use. It is what stage 5's `SCRIPT_CLAIMS` renders — each record's id, kind, claim and attribute, the evidence system's own wording — and what stage 5's `claimUse` validator accepts (`CN19`, `CN22`).
   - **`packagingClaimRecords` binds the identity records on every requested platform**, after that platform's own model bindings, never twice. So the critic's `PLATFORM_CLAIMS` always shows them, and both claim-binding lenses may bind a finding to them on any platform (`CN20`, `CN21`). The model does not choose them and need not list them.
   - Stage 5 and the critic fail closed on a pack without them, before any model call (`CN18`). The zero-used-claims refusal still counts stage 3's used claims alone, so the identity records never rescue an empty script (`CN22`; mutation `M439`).
   - **Prompts.** `agents/packaging-adaptation.md` describes the identity records in `SCRIPT_CLAIMS` and adds *The identity records*: code binds them on every platform; **a make is descriptive use only** — naming one never states or implies affiliation, authorization, certification, dealer status or endorsement; a place is only where the service-area record says; and they permit nothing else (`CN24`). `agents/automotive-truth.md` says the identity records reach stage 5 by code, so stage 2 need not spend a whitelist entry on them for the packaging stage alone (`CN25`). Neither prompt names a value.
3. **Stage 2's `allowedClaims` cap: 12 → 16** (`TRUTH_FIELD_LIMITS.maxAllowedClaims`). Stage 2's validator, response schema and prompt say 16 and refuse 17; stage 1's `supportingFactIds` (`maxIds`) and stage 3's `claimUse` stay 12 (`CN26`). Every derived ceiling and floor was recomputed from the contract (below); none exceeds its limit, so no limit was raised by hand.
4. **Tests and mutations.** `CN1`–`CN28` (below) and mutations `M418`–`M445`.

**Before → after — every affected figure** (from `payloadContract.ts` and `modelPolicy.ts`, built at `f2a5878` and at this change).

| Value | Before (`main` at `f2a5878`) | After |
|---|---:|---:|
| `TRUTH_FIELD_LIMITS.maxAllowedClaims` | 12 | **16** |
| `TRUTH_OUTPUT` transport (stage 3's `TRUTH_OUTPUT` block, `HANDOFF_GUARDS.truthOutputChars`) | 73,859 | **86,011** |
| `PERMITTED_CLAIMS_BLOCK_CHARS` (stage 3) | 32,882 | **43,842** |
| `SCRIPT_CLAIMS` — stage 4 (`SCRIPT_CLAIMS_BLOCK_CHARS`) | 32,882 | 32,882 — unchanged |
| `SCRIPT_CLAIMS` — stage 5 and the evidence lens (`PACKAGING_SCRIPT_CLAIMS_BLOCK_CHARS`, 12 + 2 records) | 32,882 | **38,362** |
| `PLATFORM_CLAIMS_BLOCK_CHARS` (24 + 2 ids per platform) | 29,744 | **32,204** |
| `hook-story-script` assembled ceiling | 173,030 | **196,142** |
| `packaging-adaptation` assembled ceiling | 214,895 | **220,375** |
| Critic lens ceilings: evidence / platform / voice / production | 215,524 / 134,966 / 26,153 / 265,277 | **223,464 / 137,426** / 26,153 / 265,277 |
| `strategy-concept` / `automotive-truth` / `production-direction` / `final-critic` assembled ceilings | 341,520 / 403,564 / 127,081 / 265,277 | unchanged |
| `MAX_PAYLOAD_CHARS` | 410,000 | 410,000 — unchanged (still set by `automotive-truth`, 403,564) |
| Headroom under `MAX_PAYLOAD_CHARS`: stage 3 / stage 5 | 236,970 / 195,105 | 213,858 / 189,625 |
| `POLICY_OUTPUT_TOKEN_FLOORS`: `reasoning-heavy` / `reasoning-standard` / `critic` | 74,000 / 99,000 / 111,000 | **87,000** / 99,000 / 111,000 |
| `POLICY_MAX_TOKENS["reasoning-heavy"]` (derived from its floor) / model output cap | 74,000 / 128,000 | **87,000** / 128,000 |
| `reasoning-heavy` stream deadline (`POLICY_STREAM_DEADLINE_MS`) | 63 min | **74 min** |
| Critic lens output-token floors | 111,000 / 111,000 / 46,000 / 46,000 | unchanged |
| Prompt characters: `agents/packaging-adaptation.md` / `agents/automotive-truth.md` (each stage's instruction channel grows by the same) | 13,729 / 8,568 | 15,067 / 8,904 (`MAX_INSTRUCTION_CHARS` 200,000 unchanged) |
| CLI ceiling estimate: full run / critic-only replay | ~$20.19 / ~$11.88 | **~$20.84** / ~$11.88 |

`reasoning-heavy`'s 87,000 is still under the one-fifth-unallocated rule the plumbing margins were sized against (at most 102,400 of the 128,000 cap). The contact-line reserves, caption budgets and every output contract other than stage 2's are unchanged.

**Migrations / schema impact:** none. No SQL, no durable state.

**Material design decisions.**

- **Identity records are part of stage 5's claim set, and bound per platform by code.** This is the smallest design that fits the existing claim-binding contract: `SCRIPT_CLAIMS` is already where stage 5 and the evidence lens read the evidence system's wording, `PLATFORM_CLAIMS` is already how the critic learns what is bound where, and `packagingClaimRecords` is already the one function both read. Appending two records to the first and binding them in the second changes no block label, no output shape and no saved-file format, so every stage 5 output saved before this change still revalidates, and no critic prompt had to change.
- **Code binds them; the model may also cite them.** Refusing a model binding to an identity record would discard a paid response for citing a record it was shown; allowing it and never binding twice keeps the result deterministic either way.
- **The scope lives in the pack builder, with an always-included list.** Filtering in the CLI would have skipped the builder's validate-every-record-before-scoping rule; the builder already had the tag scope, so the list is one optional field there.
- **An unscoped run is byte-identical.** No `evidenceScope` key and the old fingerprint formula, so every earlier run still replays, and a scoped run's fingerprint makes an older CLI that ignores the scope refuse to replay it.
- **The CLI checks run in-process.** Every one of the harness's mutations reruns the whole content-intelligence suite, and the CI job's limit is 45 minutes; spawning the CLI for each CN check added about 2.2 s to the suite (5.9 s against 3.7 s), which at run 213's pace would have pushed the harness past the limit. In-process, CN adds about 0.25 s.

**Material rejected alternatives.**

- **A separate `IDENTITY_CLAIMS` block.** Rejected: the critic's lens prompts are out of scope, and a block they do not describe would reach the lenses unexplained; the evidence lens needs the wording in `SCRIPT_CLAIMS` to check a make- or place-naming tag at all.
- **Having stages 1–3 cite the identity records.** Rejected on the same grounds as the contact line: they would compete for the twelve citation slots the piece's own claims need — the competition that squeezed the makes out on 2026-09-25.
- **Refusing a model's `claimUse` entry naming an identity record.** Rejected: a paid response would die for citing a record it was given.
- **Raising stage 1's `maxIds` or stage 3's `maxClaimUses` too.** Not done: the owner decided only stage 2's cap. Stage 3's twelve uses may now be the binding constraint, as the `maxIds` decision warned (see *Accepted limitations*).
- **Always writing `evidenceScope: null` for an unscoped run.** Rejected: it would change every unscoped run's `run-meta.json` for no information a replay needs — an absent scope already means none.

**Automated validation (on the head that was pushed).** Build and typecheck clean. `npm run test:offline` **ALL PASS** on all nine suites — **1,751 checks** (1,723 before): posting 52, image 18, orchestrator 119, gate 56, API 51, render-identity one invariant pass, ownership/recovery 112, content-intelligence **1,248** (was 1,220), interval monitor 94. New checks `CN1`–`CN28`, appended after the last group: the always-included option changes nothing unscoped (`CN1`) and keeps the five records under any scope (`CN2`); an unscoped CLI run is today's run exactly (`CN3`); a scoped run records and fingerprints its scope (`CN4`); an empty scope is refused (`CN5`); a replay reuses the recorded scope (`CN6`) and refuses a different one (`CN7`) or an edited, removed or differently-always-included one (`CN8`); `--list-tags` prints counts only, reaches no pack, registry, stage or runner, and refuses a goal (`CN9`–`CN12`); a scoped run refuses a missing always-included record (`CN13`); the identity preflight precedes both spend gates (`CN14`); the identity ids are the adapter's own, read unchanged, and fail closed (`CN15`–`CN18`); stage 5's `SCRIPT_CLAIMS` carries them (`CN19`); code binds them on every platform and the critic accepts them there (`CN20`, `CN21`); they rescue no empty script (`CN22`); the module is deterministic and value-free (`CN23`); both prompts (`CN24`, `CN25`); the cap is 16 and enforced, with stage 1 and stage 3 at 12 (`CN26`); the claim blocks and the `reasoning-heavy` floor are derived from the contract (`CN27`, `CN28`). **Re-specified, not loosened:** `BK6`, `BK13`, `BK14`, `BO3`, `BR14`, `BR16`–`BR18`, `BU7`–`BU9` (stage 5's claim set and per-platform bindings now end with the identity records), `CM10` (stage 5's ceiling uses the wider claim block), `AF5` (the module list gains `identityFacts.ts`), and the source markers of `CE2`, `CE4`, `CE9` and `CD0g` (`main` is now `export async function main(argv …)`). Fixture packs for stages 5 and 6 gain the two identity records exactly as the adapter projects them, and the CC maximal pack gains two maximal identity records and sixteen maximal facts so stage 2's output is measured at its new maximum. `npm run test:payload-mutation` derives **445 mutations** (443 prohibited, 2 coordinated); the twenty-eight new ones, `M418`–`M445`, are appended after every earlier group and were each run and caught locally; the full-harness result and its duration are taken from CI on push (see *Harness duration* below). A fake-runner CLI full run with and without `--scope-tags`, a critic-only replay of each, the replay refusals, and a `--list-tags` run were driven by hand against synthetic automotive facts. Also: simulated dry run, deployment-controller fixtures, `npm audit --omit=dev`, Markdown links, environment coverage, the sensitive-content scan with manual triage, AgentShield, and `git diff --check` — results in the PR. **No live model call was made.**

**Harness duration.** Recorded in the PR and in [Testing](TESTING.md) once CI has run it on the final head. Suite time is measured in-process at about 3.9 s against 3.7 s before this change.

**Production evidence:** none, and none is possible — no stage is enabled or reachable. The motivating runs above are operator-local evidence.

**Rollback / recovery:** revert the commit. No migration and no durable state. A scoped run's `run-meta.json` is a local record; after a revert its `evidenceScope` is ignored and its fingerprint no longer matches, so a replay of it is refused rather than rebuilt with the wrong pack.

**Security and privacy implications.** The identity records are public business identity already in `config/approved-facts.json`; they add no credential, customer data or new data flow. Stage 5 and the evidence lens now see two more records in the evidence system's own wording. The descriptive-use rule is a prompt rule, not a deterministic check. `--list-tags` prints tag names and counts only — no claim text, no ids — and the local automotive-facts file's tags stay on the operator's machine. No tool, provider, publishing, scheduling, approval, credential, model, effort, thinking or autonomy setting changed. The Phase-A approval gate and the live `brand-compliance-critic` are untouched.

**Accepted limitations.**

- **The critic's lens prompts still describe `SCRIPT_CLAIMS` as "every evidence record stage 3 bound".** It now also holds the two identity records, and the prompts are out of scope here; a lens could misattribute an identity record to stage 3. Recorded as a follow-up.
- **Descriptive use is not verified by code.** Whether a make-naming tag implies affiliation is a prompt rule stage 5 is given and the critic may flag; nothing detects it.
- **Stage 3's twelve claim uses may now be the bottleneck.** Stage 2 may permit sixteen, but the script may use twelve; whether the extra permissions are spent is **unverified** until the owner runs again.
- **Scoping is by tag only.** `subjects` scoping exists in the builder but is not exposed; a scope that omits a record a stage needs is the operator's choice, and the stages' own required-evidence preflight still refuses before the cost gate if a needed evidence class is missing.
- **The oil specification and the rationale** in the 2026-09-25 findings are not addressed by the identity records; the oil specification needs stage 2 to permit its record (now possible at 16), and the rationale needs the Lane S facts.

**Known critic gap (recorded, not fixed here).** In three runs the copy attributed a city-versus-"long, steady highway" comparison to BMW, which the BMW record does not contain, and no lens flagged it. The critic prompts are out of scope for this change. *(Withdrawn 2026-09-28 — not a gap. The statement that the BMW record does not contain the comparison came from memory and was wrong: the owner verified the local BMW record `bmw-my2025-conditions-more-frequent-service` on 2026-09-28, and it compares city use with "a vehicle that is driven long distances at moderate engine speeds", so the copy's "than steady long-distance driving" was supported, and the critic was right not to flag it. Kept as written for history; see the correction in PR #97's record above.)*

**Evidence review for the "why" facts (summary for the Lane S change).** The owner reviewed 12 YouTube sources. Conclusions, as the owner reported them: **no source measured 5,000 miles as optimal**; the claims **"time alone degrades oil"** and **"heat degrades oil"** were **contradicted** — the latter is also forbidden by stage 2; and **two Auto Care Pro videos were rejected as unreliable.** No transcript is recorded. **The source titles and URLs were not supplied to this change**, so they are not listed here; recording them is a follow-up for the Lane S change. *(2026-09-28: the Lane S record above lists all twelve titles and eight URLs; the URLs for sources 2, 3, 4 and 5 are still missing.)*

**Unresolved follow-ups.**

- ~~PR #93 `main` push run 217's final conclusion~~ — green on attempt 1 (see *State* above).
- ~~Lane S's own merge SHA (mutable-identifier exception)~~ — `6f35079` (PR #94).
- An owner-run live full run after merge, choosing a scope from `--list-tags`, to see whether the unbound-fact findings fall. Not an acceptance gate for this change.
- A critic-prompt change: describe the identity records in `SCRIPT_CLAIMS` and `PLATFORM_CLAIMS`~~, and address the unflagged BMW highway attribution~~. *(The BMW half is withdrawn 2026-09-28: not an error — BMW's own record makes the comparison; see the correction in PR #97's record above. The identity-records half stays open.)*
- **Speed up the mutation harness**, carried from PR #92's record, now at 445 mutations. *(2026-09-30: made parallel by PR #97; its builds made incremental and verified by the mutation-harness speed-up at the top of this file, `IMPLEMENTED`. Not discharged: the original 20-minute target was not met and the suite now dominates — see* The mutation step's growth *in the cursor.)*
- Carried, out of scope here: `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens, and moving completed history out of this file.

**Documents updated with implementation:** this file (this record; PR #92's record moved to *Merged repository change awaiting rollout* with its merge, CI and follow-ups reconciled; dated additions to the `maxIds` decision, the 64-record-cap item and the local-CLI entry), [README](../README.md), [Status](STATUS.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), `agents/automotive-truth.md`, `agents/packaging-adaptation.md`, and the mutation harness's header. Each was reread in full.

### Writer restrictions — stage 2's caveats and forbidden claims bind stages 3–5, and every writer loads `claim-boundaries` with an attribution rule — `MERGED`

**State:** `MERGED` through [PR #92](https://github.com/Caposhi/GCD-Agents/pull/92) at `f2a58785c8a9aa2605dda3c7f7daf34ffdf16007` (recorded 2026-09-25). Its ordered parents are `cd56907505e2f5d68fd2e052b7ccb659caad0579` (the PR #91 merge) and then the PR head `afdea1be9ceb0c02e85c855340d66247c6b34c00`. **Not `DEPLOYED`, not `ENABLED`, and not `PRODUCTION-VALIDATED`**: the live worker does not carry it, all six stages remain `executionEnabled: false`, and no production path reaches any of them. **CI:** [run 213](https://github.com/Caposhi/GCD-Agents/actions/runs/36058433478) on the PR head `afdea1b` passed all five jobs on attempt 1, with 417 mutations in a mutation step of 33m59s (the quality job took 35m22s against its 45-minute limit); the `main` push [run 214](https://github.com/Caposhi/GCD-Agents/actions/runs/36147811190) on `f2a5878` passed on attempt 1. The rest of this record is preserved as written at implementation, with dated additions marked; where it says the change is unmerged or that its merge SHA is a blocking follow-up, this line supersedes it. *As written at implementation:* `IMPLEMENTED` on branch `claude/great-archimedes-2oysf0`, based on `main` at `cd56907505e2f5d68fd2e052b7ccb659caad0579` (the PR #91 merge). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false` and no production path reaches any of them. The change is dormant stage code, three writer prompts, one fact-free skill, the offline and mutation suites, and documentation. It authorizes no release: the partial-release interval in [Status](STATUS.md) (current bound `2026-10-22T18:52Z`) still prohibits any release of any service. No deployed legacy path changed: `src/harness/orchestrator.ts`, `packageMap.ts`, `src/api`, `src/scheduler` and `agents/brand-compliance-critic.md` are untouched, and so is the tracked `.DS_Store`. No stage 1 prompt or skill, critic behaviour, config file, approved fact, evidence-pack cap, model or effort changed; one sentence of the evidence-lens prompt and two of the stage 2 prompt were corrected (Delivered, item 6), and the CI quality job's time limit moved from 30 to 45 minutes (item 5). No model was called.

**PR / merge:** [PR #92](https://github.com/Caposhi/GCD-Agents/pull/92), from `claude/great-archimedes-2oysf0` into `main`, merged as `f2a58785c8a9aa2605dda3c7f7daf34ffdf16007`. The blocking merge-SHA follow-up recorded at implementation is **discharged** by the scoping and identity-facts change (its record, *Evidence-pack scoping in the local CLI …*, is at the top of this file). *As written at implementation:* **the merge SHA is not knowable before merging.** It is a **blocking follow-up** under the mutable-identifier exception in [`AGENTS.md`](../AGENTS.md), to be reconciled in the first change after merge.

**Why — the owner's third complete live run (motivating evidence).** Run `2026-09-24T18-01-36-439Z`, a full six-stage live run by the owner, cost **$1.161138**. The critic panel returned **28 findings: 14 blocking and 14 advisory**. Nearly all the blocking findings trace to rules the critic enforces but the writing stages were never given:

- **(A) Merged attribution.** One condition list credited to "both manufacturers", mixing BMW's and Mercedes' wording, in the script, every caption and a shot overlay.
- **(B) Stage 2's `requiredCaveats` ignored.** The shop-recommendation qualifier was not kept beside the number; the Mercedes directive was not scoped to its model's manual; the caveat that the manuals do not describe oil-condition measurement was omitted; and "tentative" was dropped.
- **(C) An implied forbidden claim.** Copy implied that local driving is arduous, near a stage-2 forbidden claim.
- **The shot-3 overlay** was caught at **blocking** severity, and the finding named the record bound to that shot. The record id was not reported to this change.

The owner's brief calls these "the four patterns"; they are recorded here as given, (A)–(C) plus the shot-3 overlay. This is **operator-local evidence, not production evidence**: no stage is enabled or reachable. The run's outputs exist only on the owner's machine and were not re-examined from this repository. The figures are as the owner reported them.

**Verified in source before the change** (at `cd56907`):

- Stage 3's prompt labelled stage 2's `forbiddenClaims` and `requiredCaveats` "provisional, unverified prose" and called `forbiddenClaims` "advisory".
- Stages 4 and 5 did not receive either list. Their executors sent `SCRIPT_OUTPUT` and `SCRIPT_CLAIMS` (stage 4), and those two plus `PRODUCTION_OUTPUT` and `REQUESTED_PLATFORMS` (stage 5); stage 2's output reached them only as validator input.
- `skills/claim-boundaries/SKILL.md` was loaded only by `automotive-truth` and the critic's evidence-fidelity lens, and had no multi-source attribution rule.
- The evidence lens did receive both lists, as `REQUIRED_CAVEATS` and `FORBIDDEN_CLAIMS`, and its prompt tells it to flag copy that drops a caveat or asserts a forbidden claim. So the critic enforced rules no writer was shown.

**Delivered.**

1. **An attribution rule in `skills/claim-boundaries/SKILL.md`, fact-free.** A new section, *Attribution — whose record says it*: credit each statement to the source whose record says it; never write "both", "all", "every", "each of them" or "manufacturers say" unless each named source's own record says it; never merge two sources' lists into one attributed list; keep each source's own terms, hedges ("may") and scope, including model or manual scope; never place one source's wording over another source's material; and when records differ, say so rather than smoothing them into agreement. The skill's description and opening now say whose claim it is as well as whether it may be made, and name every stage that loads it. It names no make, place, number or approved-fact value (`CM9`; `AL5`–`AL9` still pass).
2. **`claim-boundaries` loaded into `hook-story-script`, `production-direction` and `packaging-adaptation`**, after each stage's craft skill (`registry.ts`). Each writer prompt gains a short *Attribution* section pointing to the skill's rules.
3. **Stage 2's restrictions become binding on stages 3, 4 and 5.**
   - **Stage 3.** It already received both lists inside `TRUTH_OUTPUT`. Its prompt now calls `requiredCaveats` and `forbiddenClaims` **binding restrictions**, not advisory prose, in a new section *Stage 2's restrictions bind you*: keep each caveat beside the claim it qualifies, in its own terms, scope (including model or manual) and hedge; do not make or imply a forbidden claim. The lists can only narrow what may be said and never permit anything; `PERMITTED_CLAIMS` stays the only source of assertable fact; if honouring a caveat would seem to require asserting something `PERMITTED_CLAIMS` does not establish, the writer leaves it out and records an open question.
   - **Stages 4 and 5.** Two new untrusted data blocks, `REQUIRED_CAVEATS` then `FORBIDDEN_CLAIMS`, appended after each stage's own blocks. They are rendered by `renderRequiredCaveats` / `renderForbiddenClaims`, exactly as the evidence lens receives them. The renderers moved from `finalCritic.ts` to `automotiveTruth.ts` (the module that owns stage 2's type) so all three consumers share one function each; `finalCritic.ts` re-exports them, and the evidence lens's blocks are byte-identical to before. `WRITER_RESTRICTION_BLOCKS` in `payloadContract.ts` fixes their labels, order and ceilings (the evidence lens's own `REQUIRED_CAVEATS_BLOCK_CHARS` and `FORBIDDEN_CLAIMS_BLOCK_CHARS`); `renderWriterRestrictionBlocks` in `productionDirection.ts`, used by both stages, refuses a block over its ceiling before any request. Each prompt names both blocks with the evidence lens's own descriptions and binds them in the same terms as stage 3's, with `SCRIPT_CLAIMS` the only source of fact.
   - **Stage 2's `assessment` stays withheld wherever it was withheld.** Stages 4 and 5 still never receive the assessment, a restatement or stage 2's wider whitelist. Stage 3 receives the assessment inside `TRUTH_OUTPUT`, exactly as before this change.
4. **Budgets recomputed from the contract** (below). No stage's assembled ceiling exceeds `MAX_PAYLOAD_CHARS`, so no limit was raised.
5. **The CI job that runs the mutation harness gets a longer time limit** (second owner-directed addendum). `.github/workflows/ci.yml`: the `quality` job ("Node 22 offline quality gates") moves from `timeout-minutes: 30` to `timeout-minutes: 45`; no other job, timeout or step changed. **Why:** the whole job, including the full mutation harness, had to finish in 30 minutes, and with this change's 417 mutations it did not — [run 212](https://github.com/Caposhi/GCD-Agents/actions/runs/36049549500) on `678dbd4` was cancelled at the limit after `M1`–`M405` had passed with no failures (run 210 on `499b460` finished 415 mutations in 23m47s; run 211, docs-only, was also cancelled at 30 minutes). **Rejected: moving the harness into a separate job.** `scripts/ops/m1-readiness/github.mjs` requires exactly the five CI jobs, by name, all passing on the first attempt on `main`; a sixth job would break the M1 readiness gate.
6. **Two prompts that described the lists before they bound the writers now say what is true** (an owner-directed addendum on the same branch; both were first recorded here as accepted limitations and are fixed in this change):
   - `agents/final-critic-evidence.md` no longer says `REQUIRED_CAVEATS` and `FORBIDDEN_CLAIMS` are shown "to no writing stage after stage 3". It says the writing stages (3, 4 and 5) receive the same lists as binding restrictions, so copy that ignores them has broken a rule it was given, and keeps "use them only to check the copy". Nothing else in the lens prompt changed, and the lens's inputs and behaviour are unchanged.
   - `agents/automotive-truth.md` no longer says "`forbiddenClaims` is advisory: it tells later stages and human reviewers what you rejected and why." It says `requiredCaveats` and `forbiddenClaims` are passed to stages 3–5 as binding restrictions and to the critic as its yardstick, so each should be written precisely and only where the evidence warrants it. Its next sentence, first kept verbatim, was then reworded by a second owner-directed addendum because its "it" followed two lists: it now reads "Neither list is a filter anything runs, so a claim you leave out of `forbiddenClaims` is not thereby permitted." The last sentence is kept verbatim: "Nothing is permitted except what you bound to a fact id."

**Before → after — every affected figure.**

| Value | Before (`main` at `cd56907`) | After |
|---|---:|---:|
| `production-direction` assembled ceiling | 105,675 | **127,081** (+ `REQUIRED_CAVEATS` 10,838 + `FORBIDDEN_CLAIMS` 10,382, each with 91 characters of framing and a 2-character join) |
| `packaging-adaptation` assembled ceiling | 193,489 | **214,895** (same two blocks) |
| `hook-story-script` assembled ceiling | 173,030 | 173,030 — unchanged; it already received both lists inside `TRUTH_OUTPUT` |
| `strategy-concept` / `automotive-truth` / `final-critic` assembled ceilings | 341,520 / 403,564 / 265,277 | unchanged |
| Critic lens ceilings (evidence / platform / voice / production) | 215,524 / 134,966 / 26,153 / 265,277 | unchanged |
| `MAX_PAYLOAD_CHARS` | 410,000 | 410,000 — unchanged (still set by `automotive-truth`, 403,564) |
| Headroom under `MAX_PAYLOAD_CHARS`: stage 4 / stage 5 | 304,325 / 216,511 | 282,919 / 195,105 |
| Output-token floors: `reasoning-heavy` / `reasoning-standard` / `critic` | 74,000 / 99,000 / 111,000 | unchanged — floors derive from output contracts, and this change adds input only |
| Assembled instruction characters: stage 3 / 4 / 5 | 12,958 / 15,970 / 18,327 | 19,896 / 23,257 / 25,568 (`MAX_INSTRUCTION_CHARS` 200,000, unchanged) |
| CLI ceiling, critic-only replay / full run | ~$11.88 / ~$20.19 | unchanged (priced at `MAX_PAYLOAD_CHARS`) |

**Migrations / schema impact:** none. No SQL, no durable state.

**Material design decisions.**

- **Restrictions, never permissions.** A caveat or forbidden claim is stage 2's model prose. Giving it to a writer as a source of fact would reopen the widening the pipeline exists to prevent, so every prompt says the lists only narrow, the claim block stays the only source of fact, and a caveat that would need an unbound fact becomes an open question instead of copy.
- **One renderer, one ceiling.** The writers receive exactly the bytes the critic checks against, so "the writer was told" and "the critic enforced" cannot drift apart. Moving the renderers to stage 2's module avoids a stage-4-imports-stage-6 cycle.
- **Stage 3's input is unchanged.** It already carried both lists; only its framing was wrong. Its receipt of `assessment` inside `TRUTH_OUTPUT` predates this change and was left as it was.
- **The attribution rule belongs in the claim skill, stated without facts**, so the stage that decides what may be claimed, the stages that write it, and the lens that reviews it read the same words.

**Material rejected alternatives.**

- **Keeping the lists reviewer-only** (PR #89's decision, recorded in its record below). Rejected on the third run's evidence: a reviewer that holds rules no writer was shown turns every caveat into a blocking finding after the copy is paid for.
- **Treating a caveat as permission to state its content.** Rejected: it would make stage 2's prose a second source of fact.
- **Sending stages 4 and 5 all of `TRUTH_OUTPUT`.** Rejected: it would hand them stage 2's assessment, restatements and wider whitelist.
- **A deterministic check of copy against the lists.** Rejected for this change: matching prose to prose is a semantic judgement, and keyword matching would imply a check the code does not perform. The evidence lens remains the check.
- **Stages 4 and 5 importing the renderers from `finalCritic.ts`.** Rejected: an import cycle between stage 4 and stage 6.
- **Removing `assessment` from stage 3's `TRUTH_OUTPUT`.** Not done: out of this change's scope, which keeps the assessment withheld where it was withheld and changes no stage-3 input.

**Automated validation (on the head that was pushed).** Build and typecheck clean. `npm run test:offline` **ALL PASS** on all nine suites — **1,723 checks** (1,712 before): posting 52, image 18, orchestrator 119, gate 56, API 51, render-identity one invariant pass, ownership/recovery 112, content-intelligence **1,220** (was 1,209), interval monitor 94. New checks `CM1`–`CM11`, appended after the last group: every writer loads `claim-boundaries` and every executed writer request carries it (`CM1`); stages 4 and 5 receive both blocks in order, byte-identical to the renderers (`CM2`, `CM3`); one renderer and one ceiling per block (`CM4`); no writer receives stage 2's assessment through the blocks, stages 4 and 5 receive it nowhere, and stage 3 only inside `TRUTH_OUTPUT` (`CM5`); stage 3's prompt no longer calls the lists advisory and binds them as narrow-only restrictions (`CM6`); stages 4 and 5's prompts do the same (`CM7`); the attribution rule is present and each writer prompt points to it (`CM8`); the skill stays fact-free (`CM9`); stages 4 and 5's ceilings count both blocks (`CM10`); neither the evidence-lens prompt nor stage 2's prompt carries the old wording, stage 2's prompt says neither list is a filter, and its nothing-permitted sentence is verbatim (`CM11`). Nine checks were re-specified, not loosened: `AT8`, `BC11`, `BL13` (three instruction assets), `AZ19`, `BI20`, `BS21` (the new asset lists), `BB10`, `BK9` (stage 2's assessment and restatements reach stages 4 and 5 nowhere; its caveats and forbidden claims only inside their own blocks), and `BU5`'s description. `npm run test:payload-mutation` derives **417 mutations** (415 prohibited, 2 coordinated); the twenty new ones, `M398`–`M417`, are appended after every earlier group, and `M416`/`M417` restore each old prompt sentence and are caught by `CM11`. A local run of the harness on the first pushed head passed `M1`–`M376` with zero failures before it was stopped in favour of CI; the full result is taken from CI on push (see [PR #92](https://github.com/Caposhi/GCD-Agents/pull/92)). A fake-runner CLI full run, instrumented in a scratch copy and driven against synthetic automotive facts, showed stage 4 receiving `[SCRIPT_OUTPUT, SCRIPT_CLAIMS, REQUIRED_CAVEATS, FORBIDDEN_CLAIMS]` and stage 5 `[SCRIPT_OUTPUT, PRODUCTION_OUTPUT, REQUESTED_PLATFORMS, SCRIPT_CLAIMS, REQUIRED_CAVEATS, FORBIDDEN_CLAIMS]`, both blocks byte-identical to the evidence lens's, and stage 2's assessment in neither prompt. Also clean: simulated dry run, deployment-controller fixtures, `test:m1-readiness` (461), `npm audit --omit=dev` (0 vulnerabilities), Markdown links, environment coverage (35 variables), the sensitive-content scan with manual triage (the only URLs added are this repository's pull-request links), AgentShield 1.4.0 at B/87 with zero critical or high findings, and `git diff --check`. **No live model call was made.**

**Production evidence:** none, and none is possible — no stage is enabled or reachable. The motivating run above is operator-local evidence.

**Rollback / recovery:** revert the commit. No migration and no durable state.

**Security and privacy implications.** Stages 4 and 5 are now shown two more pieces of stage 2's model prose, bounded by stage 2's validator and by derived block ceilings and framed as untrusted data. The prompts say the lists only narrow; the residual risks are a writer echoing a forbidden claim's text (see *Accepted limitations*) or treating a caveat's wording as a fact, which no code detects — as no code detects any unfaithful paraphrase — and which the evidence lens reviews. Stage 2's assessment, restatements and wider whitelist stay withheld from stages 4 and 5 (`CM5`). The skill added to three instruction channels states no fact (`CM9`). No tool, provider, publishing, scheduling, approval, credential, model, effort, thinking or autonomy setting changed. The Phase-A approval gate and the live `brand-compliance-critic` are untouched. No customer data, credential or raw run output is committed.

**Accepted limitations.**

- **Prompt rules, not deterministic checks.** Whether a writer keeps a caveat, avoids an implied forbidden claim, or attributes correctly is not verified by code. Whether the next live run's critic findings fall is **unverified** until the owner runs one.
- **The writers now see the text of stage 2's forbidden claims, so a writer could echo one.** Before this change stages 4 and 5 never saw that text. Mitigations: every writer prompt says the lists permit nothing and that a forbidden claim may be neither made nor implied, and the critic's evidence lens checks every piece against the same list, rendered from the same function.
- **Stage 3 still receives stage 2's `assessment`** inside `TRUTH_OUTPUT`, as it did before.
- **The writer instruction channels grow** by about 7,000 characters each (the skill plus the new sections). AgentShield's oversized-agent findings are unchanged in count (9 medium, 9 low, grade B/87); three of those prompts grew.

**Unresolved follow-ups.**

- ~~**Blocking:** this change's merge SHA (mutable-identifier exception).~~ **Discharged 2026-09-25:** merge `f2a58785c8a9aa2605dda3c7f7daf34ffdf16007`.
- ~~An owner decision on the evidence-lens prompt sentence and the stage 2 prompt's "advisory" wording.~~ **Fixed in this change** by the owner-directed addendum (Delivered, item 6; `CM11`).
- ~~An owner-run live full run after merge, to see whether (A)–(C) and the caveat findings fall. Not an acceptance gate for this change.~~ **Done 2026-09-25 (operator-local evidence):** run `2026-09-25T16-21-51-293Z`, $1.172956, 31 findings (17 blocking), against run `2026-09-24T18-01-36-439Z`'s $1.161138 and 28 findings (14 blocking). As the owner reported it, (A), (B) and (C) were gone from the copy; the remaining blocking findings were 8 about facts not bound and 9 writing errors. The follow-up change is *Evidence-pack scoping in the local CLI …* at the top of this file.
- **Speed up the mutation harness** before it approaches about 650 mutations. Its runtime grows about 3.5 s per mutation, so at that size it would near the new 45-minute limit. *Dated addition, 2026-09-25:* run 213 took 33m59s for 417 mutations — about 4.9 s each, against about 3.4 s on run 210 — so on a slow runner the limit is nearer than 650. The scoping and identity-facts change brings the count to 445 and keeps the suite's own time almost flat to stay inside it. One option is to run mutations in parallel inside the same job; the five-job CI shape the M1 readiness gate requires must not change. *Dated addition, 2026-09-26:* PR #96's run took 42m36s in its mutation step for 465 mutations, inside a 43m59s job; the CI-headroom change at the top of this file (`IMPLEMENTED`) runs the mutations in parallel inside the same job and raises the job's limit to 60 minutes, with the five jobs unchanged. *(Corrected 2026-09-28: that change is `MERGED` through PR #97 at `610e230e78209fe1d3ca4d83216ed3ff18deec21`, and its record is no longer at the top of this file.)* *(2026-09-30: made parallel by PR #97; its builds made incremental and verified by the mutation-harness speed-up at the top of this file, `IMPLEMENTED`. Not discharged: the original 20-minute target was not met and the suite now dominates — see* The mutation step's growth *in the cursor.)*
- Carried, out of scope here: tune `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens (two per-lens output samples now exist; see PR #90's record), the evidence pack's 64-record cap, and moving completed history out of this file.

**Documents updated with implementation:** this file (this record; PR #91's record moved to *Merged repository change awaiting rollout* and its merge SHA recorded; PR #90's second replay's per-lens output tokens and base commit; the stale "at the top of this file" pointers in the PR #87, `maxIds`, PR #89 and PR #90 records), [README](../README.md), [Status](STATUS.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), `agents/hook-story-script.md`, `agents/production-direction.md`, `agents/packaging-adaptation.md`, `agents/final-critic-evidence.md` (one sentence), `agents/automotive-truth.md` (two sentences), `.github/workflows/ci.yml` (one timeout), `skills/claim-boundaries/SKILL.md`, and the mutation harness's header. Each was reread in full.

### Documentation reconciliation — PR #90 recorded as merged, with its second owner-run replay — `MERGED`

**State:** `MERGED` through [PR #91](https://github.com/Caposhi/GCD-Agents/pull/91) at `cd56907505e2f5d68fd2e052b7ccb659caad0579` (recorded 2026-09-24). Its ordered parents are `9c1332d360903011b6b35cd7a2ad8c21ad5c2288` (the PR #90 merge) and then the PR head `dd26e6444c14c8b7cb74eaef3e0c87ed27e98610`. Documentation only, so there is nothing to deploy or roll out; it is kept in this section for its history. The rest of this record is preserved as written at implementation; where it says the change is unmerged or that its merge SHA is a blocking follow-up, this line supersedes it. *As written at implementation:* `IMPLEMENTED` on branch `claude/relaxed-euler-v6y22e`, based on `main` at `9c1332d360903011b6b35cd7a2ad8c21ad5c2288` (the PR #90 merge). **Documentation only:** it changes `*.md` files and nothing else — no source, prompt, test, configuration, migration or workflow — and so it moves no roadmap scope, enables nothing and authorizes no release. The partial-release interval in [Status](STATUS.md) (current bound `2026-10-22T18:52Z`) is unchanged. The tracked `.DS_Store` is untouched.

**Delivered.**

- **PR #90 recorded as `MERGED`** at `9c1332d360903011b6b35cd7a2ad8c21ad5c2288` (merged 2026-09-24T14:58:29Z). Its record moved from this section to *Merged repository change awaiting rollout* below, and its blocking merge-SHA follow-up is discharged. It is recorded as **not `DEPLOYED`, not `ENABLED` and not `PRODUCTION-VALIDATED`**.
- **The owner's second live `--replay-critic`** (2026-09-24T14:59:31Z) is recorded in PR #90's record as *Second owner-run replay*, and PR #89's record points to it wherever it said item 7 was caught only at advisory severity. The original wording is kept as history.
- The same state change in [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Testing](TESTING.md), [Architecture](ARCHITECTURE.md) and [Security and continuity](SECURITY_AND_CONTINUITY.md), wherever they called PR #90's change implemented or not merged.

**PR / merge:** [PR #91](https://github.com/Caposhi/GCD-Agents/pull/91), from `claude/relaxed-euler-v6y22e` into `main`, merged as `cd56907505e2f5d68fd2e052b7ccb659caad0579`. The blocking merge-SHA follow-up recorded at implementation is **discharged** by the writer-restriction change (see its record, *Writer restrictions — …*, in this file). *As written at implementation:* its merge SHA was not knowable before merging, and was recorded as a blocking follow-up under the mutable-identifier exception in [`AGENTS.md`](../AGENTS.md).

**Migrations / schema impact:** none.

**Validation:** `npm run test:offline` unchanged at 1,712 checks, Markdown links, `git diff --check`, and a check that the diff touches only `*.md`. Every modified section was reread as a whole.

**Production evidence:** none; this change records operator-local evidence only.

**Rollback / recovery:** revert the commit.

**Security and privacy implications:** none. The replay figures recorded are costs, token counts, fingerprints and record ids; no customer data, credential or raw output is committed.

**Unresolved follow-ups.**

- ~~**Blocking:** this PR's (PR #91) merge SHA (mutable-identifier exception).~~ **Discharged 2026-09-24:** merge `cd56907505e2f5d68fd2e052b7ccb659caad0579`.
- Carried, out of scope here: moving completed history out of this file into `docs/COMPLETED_ROADMAP_PHASES.md` (a separate change), and the tuning follow-ups in PR #90's record.

**Documents updated:** this file, [Status](STATUS.md), [README](../README.md), [AI handoff](AI_HANDOFF.md), [Testing](TESTING.md), [Architecture](ARCHITECTURE.md), [Security and continuity](SECURITY_AND_CONTINUITY.md). Each modified section was reread as a whole.

### Critic-panel follow-up — owner-aware panel verdict, per-shot record ids for the evidence lens, PostgreSQL 16 timing tolerance — `MERGED`

**State:** `MERGED` through [PR #90](https://github.com/Caposhi/GCD-Agents/pull/90) at `9c1332d360903011b6b35cd7a2ad8c21ad5c2288` (merged 2026-09-24T14:58:29Z; recorded 2026-09-24). Its ordered parents are `e557dda6601a9ff4cc8d6664cc1cf42045365234` (the PR #89 merge) and then the reviewed head `08ce35975b40b54b78b07619050283684dab3efe`. **Not `DEPLOYED`, not `ENABLED`, and not `PRODUCTION-VALIDATED`**: the live worker does not carry it, all six stages remain `executionEnabled: false`, and no production path reaches any of them. The rest of this record is preserved as written at implementation, with dated additions marked. Where it says the change is unmerged, or that its PR number and merge SHA are a blocking follow-up, this line supersedes it. The owner has since run a second live replay; see *Second owner-run replay* below. *As written at implementation:* `IMPLEMENTED` on branch `claude/keen-turing-j82dr3`, based on `main` at `e557dda6601a9ff4cc8d6664cc1cf42045365234` (the PR #89 merge). **Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false` and no production path reaches any of them. The change covers dormant stage code, one lens prompt, the offline and mutation suites, the disposable-PostgreSQL self-test of the M1 readiness runner, and documentation. It authorizes no release: the partial-release interval in [Status](STATUS.md) (current bound `2026-10-22T18:52Z`) still prohibits any release of any service. No deployed legacy path changed. `src/harness/packageMap.ts`, `orchestrator.ts`, `agents/brand-compliance-critic.md`, `src/api` and `src/scheduler` are untouched, and so is the tracked `.DS_Store`. No stage's `executionEnabled` changed, and no model was called.

**PR / merge:** [PR #90](https://github.com/Caposhi/GCD-Agents/pull/90), from `claude/keen-turing-j82dr3` into `main`, merged as `9c1332d360903011b6b35cd7a2ad8c21ad5c2288`. The blocking merge-SHA follow-up recorded at implementation is **discharged** by the documentation reconciliation (PR #91), whose record is directly above this one. *As written at implementation:* the PR number and merge SHA were not knowable before merging, and were recorded as a blocking follow-up under the mutable-identifier exception in [`AGENTS.md`](../AGENTS.md).

**Why.** Two items come from the owner's acceptance replay of PR #89, recorded in the panel's record below, and one from PR #89's CI:

1. **The panel verdict ignored the owner.** It returned `needs_revision` for any blocking finding, including one owned by `human_review`, which no revision can resolve.
2. **The evidence lens could not see which record an overlay's shot carries.** On the acceptance run it caught item 7 ("stop-and-go" is BMW's wording over the Mercedes page) only at advisory severity, without naming the manual: "whichever manual is shown…". `OVERLAY_TEXT` carried each overlay's shot index, role, shot subject and text. It did not carry stage 4's `claimVisuals` binding, so the lens could not tell that shot 2 was bound to `mb-eclass-arduous-conditions-oil-frequency`.
3. **A PostgreSQL 16 timing check was flaky.** On PR #89, `elapsed >= PHASE_MS && elapsed < DEADLINES_MS.database_lock` (`PHASE_MS = 1_200`) in `scripts/ops/m1-readiness/postgres.selftest.mjs` failed once and passed on an identical re-run.

**Delivered.**

- **Owner-aware panel verdict** (`aggregateCriticVerdict` in `src/harness/agents/finalCritic.ts`):
  1. any blocking finding owned by a revisable stage (`REVISABLE_OWNERS`: `hook-story-script`, `production-direction`, `packaging-adaptation`) → `needs_revision`;
  2. else any blocking finding owned by `human_review`, any `human_decision` finding, or any lens verdict `needs_human_review` → `needs_human_review`;
  3. else → `provisional_pass`.

  The function's doc comment and the module header state the rule. The per-lens verdict-consistency check is unchanged; only the panel's own verdict moved. It supersedes the PR #89 design decision recorded below, and the old decision is kept there, marked superseded.
- **The evidence lens sees which records each overlay's shot carries.** `renderOverlayText` adds `shotFactIds` to every `OVERLAY_TEXT` entry. It lists the fact ids of every `claimVisuals.used` binding whose `shotIndex` is that overlay's shot, in stage 4's own binding order, and an empty array when stage 4 bound nothing to the shot. It is read from the typed binding only. No model prose is added, and the binding's `directionSummary` is not shown. **Every such id resolves to claim text the lens already receives, verified from source before the change.** Stage 4's validator accepts a `claimVisuals` id only if it is in `scriptClaimRecords(...)`, and `executeFinalCritic` revalidates stage 4 through `revalidateProductionDirectionOutput` before any request. The evidence lens's `SCRIPT_CLAIMS` is `renderPackagingScriptClaims`, which renders `scriptUsedClaimRecordsForPackaging` — the same `scriptClaimRecords(...)` set — with each record's `id`, `kind` and `claim`. So no new channel was needed. `BU22` checks the same property on the assembled prompt. No other lens's inputs changed: production-coherence already receives the whole `PRODUCTION_OUTPUT`, `claimVisuals` included, and it is unchanged.
- **The evidence-lens prompt uses the ids** (`agents/final-critic-evidence.md`). The `OVERLAY_TEXT` input line now defines `shotFactIds` and says to look each id up in `SCRIPT_CLAIMS`. The on-screen-wording rule now tells the lens to compare each overlay's wording with the record or records bound to that shot. Wording from a different record is a fidelity problem even when that record is bound elsewhere in the piece. The lens is to say which bound record the wording departs from and which record it came from, and to say so when no record is bound to the shot. The prompt names no make, place or approved-fact value (`BW15` still passes). Prompt text is executable input, so it is tested (`BU26`) and mutated (two new mutations).
- **PostgreSQL 16 timing tolerance** (`scripts/ops/m1-readiness/postgres.selftest.mjs`, the lock-wait deadline scenario).
  - **Root cause, from the code and measured:**
    - The deadline is `setTimeout(PHASE_MS)`, armed by `deadlineSignal` inside `withDeadline`, and `elapsed` was measured with `Date.now()`.
    - libuv keeps its loop clock in whole milliseconds. Arming at X.9 ms records a start of X, so the timer can fire up to (just under) 1 ms of monotonic time early.
    - Where the kernel's coarse monotonic clock ticks at 1 ms or finer, libuv reads its loop time from `CLOCK_MONOTONIC_COARSE`, which can lag by up to one more tick.
    - `Date.now()` is wall-clock time, itself truncated to a millisecond and subject to slew.
    - Teardown after the timer fires takes only about 1 ms. Twenty local probe runs of the scenario, on the same code path, measured 1,201–1,208 ms, so a strict `>= PHASE_MS` had almost no margin.
    - In isolation, `setTimeout(50)` fired after 49.095 ms of monotonic time. `Date.now()` measured 49 ms on 15 of 2,000 runs.
  - **Fix:** measure `elapsed` with `performance.now()` (monotonic, sub-millisecond), and allow the smallest tolerance the cause justifies: `elapsed > PHASE_MS - 2`. A comment names the cause.
  - The upper bound (`< DEADLINES_MS.database_lock`) is unchanged. No check was skipped, disabled or quarantined.

**Before → after — the evidence lens's input, and what did not move.**

| Value | Before (PR #89, `main` at `e557dda`) | After |
|---|---:|---:|
| `OVERLAY_TEXT_BLOCK_CHARS` | 10,962 | **60,432** (worst case: all 10 overlays on one shot, each carrying all 12 binding ids at 200 characters, fully escaped) |
| Evidence-fidelity assembled ceiling | 166,054 | **215,524** |
| Platform-and-local / voice-and-craft / production-coherence assembled ceilings | 134,966 / 26,153 / 265,277 | unchanged |
| `STAGE_ASSEMBLED_CEILINGS["final-critic"]` (largest lens request) | 265,277 (production-coherence) | 265,277 — unchanged |
| `MAX_PAYLOAD_CHARS` | 410,000 | 410,000 — unchanged |
| Evidence-fidelity output contract, transport / contract | 110,727 / 62,427 | unchanged — the output contract did not move |
| Evidence-fidelity output-token floor | 111,000 | 111,000 — unchanged; `POLICY_OUTPUT_TOKEN_FLOORS.critic` stays 111,000, 17,000 under the 128,000 cap (reserve 16,000) |
| CLI ceiling, critic-only replay / full run | ~$11.88 / ~$20.19 | unchanged (priced at `MAX_PAYLOAD_CHARS`) |

The output-token floor is derived from each lens's *output* contract, and this change adds only input, so it cannot move.

**Migrations / schema impact:** none. No SQL, no durable state.

**Material design decisions.**

- **Revision before a person, and a person when only a person can act.** `needs_revision` says an upstream stage can fix something, so it is reserved for blocking work a stage owns. A blocking finding owned only by `human_review` asks for a person. When both are present, revision comes first; the human-owned finding still names its owner on the finding, and a person reviews the revised package anyway.
- **Ids only, joined to `SCRIPT_CLAIMS`.** The same choice `PLATFORM_CLAIMS` made: the record text reaches the lens once, and `shotFactIds` says which of those records stage 4 put behind which shot.
- **Stage 4's order, and an empty array rather than an absent key.** The order is deterministic and is stage 4's own. Every entry has the same shape, so "bound nothing" is stated, not inferred.
- **The tolerance is derived from the timer, not chosen for comfort.** The early firing is bounded below 2 ms by how libuv keeps time, so 2 ms is the smallest tolerance that cannot flake for that reason.

**Material rejected alternatives.**

- **Keeping "any blocking finding → `needs_revision`", with the owner as routing** (PR #89's decision). Rejected: the verdict names an action, and `needs_revision` sent the operator to re-run a stage for a finding no stage can resolve.
- **Deciding the human arm first when both are present.** Rejected: the revisable finding is still fixable, and fixing it first loses nothing, because the human-owned finding keeps its owner.
- **Repeating the bound record's claim text inside `OVERLAY_TEXT`.** Rejected: a second copy of evidence text, for the same reason `PLATFORM_CLAIMS` became ids-only.
- **Showing `directionSummary`.** Rejected: it is stage 4's model prose, not a record.
- **One entry per shot instead of per overlay.** Rejected: the lens reads overlays, and the requested shape puts the ids on each overlay entry.
- **A larger round tolerance, loosening the upper bound, or skipping the check.** Rejected: the cause bounds the error below 2 ms, and the upper bound is what proves the deadline, not `lock_timeout`, stopped the read.

**Automated validation (on the head that was pushed).** Build and typecheck clean. `npm run test:offline` **ALL PASS** on all nine suites — **1,712 checks** (1,704 before): posting 52, image 18, orchestrator 119, gate 56, API 51, render-identity one invariant pass, ownership/recovery 112, content-intelligence **1,209** (was 1,201), interval monitor 94. New checks: `CL27`, `CL27b`, `CL28` (the owner-aware verdict), `BU22`–`BU26` (the per-shot ids, their scope, the worst-case ceiling and the prompt). Three checks were re-specified for the new rule, not loosened. `CL9` now covers every revisable owner in turn; its human-owned half moved to `CL27`, which now expects `needs_human_review`. `BU3` includes `shotFactIds`. `BY16` now expects the panel's `needs_human_review` for a human-owned blocking finding alone. `npm run test:payload-mutation` **ALL PASS — 397 mutations** (386 before; 395 prohibited, 2 coordinated). Eleven new mutations, `M387`–`M397`, are appended after every earlier group so no existing id moves:

- the revision arm reverting to any blocking finding (`CL27`, `CL27b`, `BY16`);
- the human-owned blocking arm dropped (`CL27b`);
- the two arms decided in the wrong order (`CL28`);
- the last arm no longer yielding `provisional_pass` (`CL6`, `CL7`);
- `shotFactIds` dropped (`BU3`, `BU22`, `BU23`);
- `shotFactIds` not filtered to the overlay's own shot (`BU23`);
- `shotFactIds` carrying stage 4's direction-summary prose (`BU3`, `BU22`, `BU24`);
- the evidence lens shown stage 4's whole output (`BU24`);
- the block ceiling no longer counting the ids (`BU25`);
- each of the two prompt sentences removed (`BU26`).

`M372`–`M374` had their `from` sites repointed at the owner-aware rule's lines, each still expecting the same checks. The disposable PostgreSQL 16 M1 readiness suite passes locally at 60 checks. Also clean: simulated dry run, deployment-controller fixtures, `npm audit --omit=dev`, Markdown links, environment coverage, the sensitive-content scan with manual triage, and `git diff --check`. A fake-runner CLI full run and a `--replay-critic` against it were driven against synthetic automotive facts, with an overlay on a bound shot and one on an unbound shot added to the saved stage 4 output. The evidence lens's assembled `OVERLAY_TEXT` carried `shotFactIds: ["synthetic-brake-fluid-interval"]` and `shotFactIds: []`, and no other lens's prompt contained the field. **No live model call was made.**

**Second owner-run replay — PASSED 7 of 7 (owner-run, 2026-09-24; recorded after merge).**

- **How it was run.** The owner ran a live `--replay-critic` on `2026-09-23T17-07-15-470Z` at 2026-09-24T14:59:31Z, one minute after this change merged, on `9c1332d` (this change's merge commit; recorded 2026-09-24 by the writer-restriction change). It used the same fingerprints as the first replay (PR #89's *Acceptance result*): approved-facts `02fa31fe…`, automotive facts `b40d8e79…`, pack `9d27c94e…`.
- **Catch rate.** All seven items of PR #89's acceptance fixture were flagged. **Item 7 is now blocking**, owned by `production-direction`. The finding names `mb-eclass-arduous-conditions-oil-frequency` as the shot's record and `bmw-my2025-conditions-more-frequent-service` as the source of "stop-and-go", and quotes the Mercedes wording. On the first replay the same item was advisory and named no manual.
- **Findings.** 23 in total: 8 blocking and 15 advisory. The panel verdict was `needs_revision` under the owner-aware rule. Every blocking finding was owned by a revisable stage, so the rule's first arm decided it, and the old rule would have returned the same verdict.
- **Cost.** **$0.571748** measured:
  - evidence-fidelity $0.1995;
  - platform-and-local $0.123104;
  - voice-and-craft $0.089808;
  - production-coherence $0.159336.

  It used 63,337 input and 15,920 output tokens, against the first replay's $0.547364, 62,951 and 14,778. *(Recorded 2026-09-24 by the writer-restriction change:)* per-lens output tokens were evidence-fidelity 6,699, platform-and-local 3,335, voice-and-craft 2,242 and production-coherence 3,644, against the first replay's 6,209 / 3,578 / 1,859 / 3,132.
- **Input growth.** The evidence lens's input rose by 386 tokens versus the first replay, 16,380 against 15,994. That is attributable to `shotFactIds`, the only input this change added, and it equals the rise in the panel's total input (63,337 against 62,951).
- **Observation, not a measurement of variance.** The seven core items were caught in both replays. The extra advisory findings beyond them varied between the two runs. Two samples do not establish a catch rate or a variance, only that the seven were stable across these two.

This is operator-local evidence from a live model call against saved outputs. It is **not production evidence**: no stage is enabled or reachable. The run's outputs exist only on the owner's machine and were not re-examined from this repository. The figures above are as the owner reported them.

**Production evidence:** none, and none is possible — no stage is enabled or reachable.

**Rollback / recovery:** revert the commit. No migration and no durable state.

**Security and privacy implications.** No new input channel. The evidence lens now sees, per overlay, record ids it already received in `SCRIPT_CLAIMS`, and no model prose. No provider, publishing, scheduling or approval surface was added, and no tool, model, effort, thinking or autonomy setting changed. The verdict change can make the panel say `needs_human_review` where it said `needs_revision`. Both are non-approving, and neither gates anything. The Phase-A approval gate and the live `brand-compliance-critic` are untouched. The timing change is test-only.

**Accepted limitations.**

- **The verdict change is not re-measured on the acceptance run.** That run's outputs are on the owner's machine only. Whether any of its seven blocking findings was owned by `human_review` alone, and so whether its verdict would change, cannot be established here. *(2026-09-24: on the second replay the owner-aware verdict was `needs_revision`, with all eight blocking findings owned by revisable stages; the `needs_human_review` arm has not yet been exercised by a live run. The first replay's seven blocking findings remain unexamined from here.)*
- **Whether the lens now names the manual, or raises item 7 to blocking, is unverified** until a live replay is run. The prompt and the input make it possible; they do not guarantee it. *(2026-09-24: on the second replay it did both — blocking, owned by `production-direction`, naming both records; see *Second owner-run replay* above. One sample; the prompt still does not guarantee it.)*
- **`shotFactIds` says what stage 4 bound, not what the shot shows.**
- **The worst-case evidence-lens payload grows by 49,470 characters.** The panel's largest request, and so `MAX_PAYLOAD_CHARS`, do not move.
- **The timing tolerance rests on libuv's timer semantics** as documented in the check's comment. A future runtime that fires timers earlier would need the tolerance re-derived.

**Unresolved follow-ups.**

- ~~**Blocking:** this PR's number and merge SHA (mutable-identifier exception).~~ **Discharged 2026-09-24:** PR #90, merge `9c1332d360903011b6b35cd7a2ad8c21ad5c2288`.
- ~~An owner-run live `--replay-critic` on `2026-09-23T17-07-15-470Z`, to see whether item 7 is now named and at what severity, and what the owner-aware verdict is on real findings. Not an acceptance gate for this change.~~ **Done 2026-09-24:** PASSED 7 of 7 at $0.571748, item 7 blocking and named, verdict `needs_revision`; see *Second owner-run replay* above.
- Carried, out of scope here: tune `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens (one full per-lens output sample so far, from the first replay; the second replay's per-lens output tokens were not reported), and the evidence pack's 64-record cap. Deduplicating findings remains a rejected alternative. *(2026-09-24: the second replay's per-lens output tokens are now recorded above — evidence 6,699 / platform 3,335 / voice 2,242 / production 3,644 — so two samples exist; tuning is still open.)*

**Documents updated with implementation:** [README](../README.md), [Status](STATUS.md) (PR #89 recorded as merged, and a phase row for this change), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md), [Production-wiring design](PRODUCTION_WIRING_DESIGN.md), [M1 readiness runner](M1_READINESS_RUNNER.md), this file, `agents/final-critic-evidence.md`, and the mutation harness's header. This file's changes: PR #89's record moved to *Merged repository change awaiting rollout*, with its acceptance result, measured cost, replay-input correction and superseded design decision; the PR #86 and PR #88 records' pointers clarified; and the CLI entry's pointer. Each was reread in full.

### Narrow critic panel — `final-critic` becomes four focused lenses with deterministic aggregation — `MERGED`

**State:** `MERGED` through [PR #89](https://github.com/Caposhi/GCD-Agents/pull/89) at `e557dda6601a9ff4cc8d6664cc1cf42045365234` (merged 2026-09-24T12:56:09Z; recorded 2026-09-24). Its ordered parents are `fb51527ce8077cf45e4adc576c0cbc72b9f52aff` (the PR #88 merge) and then the reviewed head `a1cb8f89c5f4a169075fea4a7d90607cd5cfcc66`. **Not `DEPLOYED`, not `ENABLED`, and not `PRODUCTION-VALIDATED`**: the live worker does not carry it. The rest of this record is preserved as written at implementation, with dated additions marked. Where it says the change is unmerged, or that its PR number and merge SHA are a blocking follow-up, this line supersedes it. Its acceptance replay has since been run and passed; see *Acceptance result* below. *As written at implementation:* `IMPLEMENTED` on branch `claude/kind-curie-5i5r6i`, based on `main` at `fb51527ce8077cf45e4adc576c0cbc72b9f52aff` (the PR #88 merge). Not `MERGED`, not `DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`. All six stages remain `executionEnabled: false` and no production path reaches any of them; the change is dormant stage code, stage prompts, one new fact-free skill, and the operator-local CLI. It authorizes no release; the partial-release interval in [Status](STATUS.md) (current bound `2026-10-22T18:52Z`) still prohibits any release of any service. No deployed legacy path changed: `src/harness/packageMap.ts`, `orchestrator.ts`, the legacy functions in `sdk.ts` (`runAgent`, `runVision`, `collect()`), `agents/brand-compliance-critic.md`, `src/api` and `src/scheduler` are untouched, and so is the tracked `.DS_Store`. This record moves the *Narrow critic panel* item out of `PLANNED`; the planning entry's evidence is carried below, not deleted.

**PR / merge:** [PR #89](https://github.com/Caposhi/GCD-Agents/pull/89), from `claude/kind-curie-5i5r6i` into `main`, merged as `e557dda6601a9ff4cc8d6664cc1cf42045365234`. The blocking merge-SHA follow-up recorded at implementation is **discharged** by the critic-panel follow-up change (PR #90) above. *As written at implementation:* the PR number and merge SHA were not knowable before merging, and were recorded as a blocking follow-up under the mutable-identifier exception in [`AGENTS.md`](../AGENTS.md).

**Why.** The owner decided on 2026-09-23 to build the panel next, after the deterministic contact line (PR #88). One critic reviewing everything at once is one long prompt, one budget and one opinion; four narrow reviewers each look at one kind of problem, with only the inputs that problem needs, and their findings are combined by code rather than by a model.

**Delivered.**

- **One stage, four lenses.** `final-critic` stays one registered stage (order 6; the six-stage registry is unchanged). Its executor makes **exactly one model request per lens, four lenses, concurrently, no retries**. Each request goes through the existing stage request boundary on the `critic` policy — Claude Opus 5.5, adaptive thinking, effort `high`, `max_tokens` 128,000 — with every existing guard: `maxRetries: 0`, the stop-reason checks, and the stream deadline. The guarantee "exactly one model request per stage" is amended **for `final-critic` only** to "exactly one request per lens, four lenses, no retries"; every other stage still makes exactly one request, and a regression requires every other stage to declare exactly one prompt (`CL25`).
- **The lenses.**

  | Lens | Categories (plus `human_decision`) | Shown | Skills |
  |---|---|---|---|
  | **evidence-fidelity** | `claim_fidelity`, `uncited_implication` | `SCRIPT_COPY` (stage 3's hook, beats, script), `OVERLAY_TEXT` (stage 4's overlay wording, each with its shot index and shot subject), `PACKAGING_COPY` (each package's caption, hashtags, local keywords, contact line), `SCRIPT_CLAIMS`, `PLATFORM_CLAIMS`, and — reviewer-only — `REQUIRED_CAVEATS` and `FORBIDDEN_CLAIMS` from stage 2 | `critique-discipline`, `claim-boundaries` |
  | **platform-and-local** | `platform_semantics`, `hashtag_keyword_relevance`, `timing` | `PACKAGING_OUTPUT` (stage 5 with its contact lines), `REQUESTED_PLATFORMS`, `PLATFORM_CLAIMS` | `critique-discipline`, the new `platform-local-review` |
  | **voice-and-craft** | `voice_clarity` | `COPY`: the hook, the script, each caption | `critique-discipline`, `script-craft`, `adaptation-craft` |
  | **production-coherence** | `production_coherence` | `SCRIPT_OUTPUT`, `PRODUCTION_OUTPUT`, `PACKAGING_OUTPUT` | `critique-discipline`, `production-craft` |

  Any lens may raise `human_decision`; the validator refuses any other category from a lens, and each lens's response schema enumerates only its own. Only the two lenses shown `PLATFORM_CLAIMS` have a `claimFindingUse` channel; the voice and production lenses' contracts have no such field.
- **Prompts and assets.** `agents/final-critic.md` is replaced by four self-contained, tool-free lens prompts that pin no model: `agents/final-critic-evidence.md`, `agents/final-critic-platform.md`, `agents/final-critic-voice.md`, `agents/final-critic-production.md`. Each states its lens's inputs, categories and size ceilings, that it never approves, that its answer is combined by code, and — where the lens sees packages — that the `contact` object is deterministic. All four prompts and every skill a lens uses are declared on the `final-critic` registry entry; `CRITIC_LENS_ASSETS` in `finalCritic.ts` maps each lens to its own. `invokeStage` gained `instructionAssets`: a lens request puts only its own prompt and skills into the instruction channel and records the rest as `omitted`; a request naming an undeclared asset, or selecting no prompt, is refused; a stage declaring more than one prompt must name its assets, so four prompts can never be concatenated into one request. `StageRunnerRequest.lens` carries the lens as a label for the caller's own records; `createAnthropicStageRunner` does not forward it to the provider.
- **A fact-free platform rubric.** `skills/platform-local-review/SKILL.md`, in the style of `skills/script-craft`, covers platform fit, hashtag and local-keyword relevance (a keyword that names no place is not local; a keyword naming a make, service or kind of business needs a bound claim behind it), and the review-only timing note. It states no fact and no number; `skills/platform-specs` and `skills/local-seo`, which carry concrete facts, are not injected. `BW8`–`BW15` prove it states no approved-fact value, make, service, place, destination, provider id, media profile or digit, and that no lens prompt names a make, place, approved-fact value or destination.
- **Why a reviewer may see caveats a writer may not.** Stage 2's `requiredCaveats` and `forbiddenClaims` are withheld from every writing stage after stage 3, so a writer cannot reach for a claim stage 3 did not use. **A reviewer writes no copy**: showing the evidence-fidelity lens the caveats lets it check that the copy kept them, and gives it nothing it could put into a caption. Stage 2's assessment and restatements stay withheld from every lens, and no other lens receives either block (`BU5`, `BU6`, `BU11`). *(Superseded 2026-09-24 for the writers by the writer-restriction change at the head of *Implemented repository change awaiting merge* (`IMPLEMENTED`, not merged): on the owner's third complete live run, a reviewer holding rules no writer was shown turned them into blocking findings, so stages 4 and 5 now receive both blocks as binding restrictions and stage 3's prompt binds the copy it already had. The evidence lens is still the only lens shown them.)* *(Corrected 2026-09-28: the writer-restriction change is `MERGED` through PR #92 at `f2a58785c8a9aa2605dda3c7f7daf34ffdf16007`, not deployed, and its record is no longer at the head of that section. The sentence above that the two lists "are withheld from every writing stage after stage 3" has therefore been untrue on `main` since PR #92: checked against current source, `productionDirection.ts` and `packagingAdaptation.ts` render `REQUIRED_CAVEATS` and `FORBIDDEN_CLAIMS` for stages 4 and 5, and `CRITIC_LENS_BLOCKS` still gives them to the evidence-fidelity lens only. Stage 2's assessment and restatements still reach no lens and neither stage 4 nor stage 5.)*
- **Fail closed.** If any lens fails — a request error, a refused, truncated or unfinished response, non-strict JSON, a category outside its own, or any other validation failure — the stage fails closed with a named `CriticPanelError` (a `StageExecutionError`) listing every failed lens and why. The executor waits for every lens to settle before throwing, so no returned response is abandoned mid-flight, and the local CLI, which records every response as it arrives, saves the raw response of every lens that did return to `rejected-responses.json`.
- **Deterministic aggregation — no model writes or merges the combined output.** `aggregateCriticPanel` in TypeScript: `findings` is the union of every lens's findings in lens order, each carrying its `lens`, **with no deduplication**; each claim-finding binding keeps its `lens` and is re-indexed into the aggregated findings. `verdict`: **any blocking finding → `needs_revision`; else any `human_decision` finding or any lens verdict `needs_human_review` → `needs_human_review`; else `provisional_pass`.** *(Superseded 2026-09-24 by the owner-aware rule in the critic-panel follow-up (PR #90) above. Only a blocking finding owned by a revisable stage now yields `needs_revision`; one owned only by `human_review` yields `needs_human_review`.)* The top-level `summary` is deterministic — finding counts per lens and severity. Each lens's own model-written summary is kept, verbatim and attributed, in `lenses`, never merged. Every non-authoritative marker is kept: the panel's assessment and every lens's carry `authoritative`, `approvalGranted`, `publishable`, `executable` and `productionValidated` as literal `false`, with `aggregation: "deterministic_critic_panel"`.
- **Contracts and budgets per lens.** `CRITIC_LENSES`, `CRITIC_LENS_FIELD_LIMITS`, `CRITIC_LENS_OUTPUTS`, `CRITIC_LENS_OUTPUT_TOKEN_FLOORS`, `CRITIC_LENS_BLOCKS` and `CRITIC_LENS_ASSEMBLED_CEILINGS` in `payloadContract.ts`. Every lens instantiates the single critic's per-field figures — no product decision moved — and each lens's fields are classified under `final-critic:<lens>.<field>` in `OUTPUT_FIELD_BOUNDS` and `STATED_FIELD_CEILINGS`. `REVIEWER_ONLY_MARGIN_FIELDS` is now each lens's `findings[].issue` — the one field the single critic had, split four ways — and `CD0f2` pins exactly that set. The executor refuses a lens block larger than its derived ceiling, so the payload contract, not the executor, decides what each lens sees.
- **The local CLI.** Full runs and `--replay-critic` both run the whole panel. The fake runner answers each lens separately. `summary.md` renders the panel's computed verdict and counts, then one section per lens — its verdict, its own summary and only its own findings. Every saved response and every `field-measurements` row carries its lens (`final-critic:<lens>.<field>`), measured against that lens's own limits. The cost ceiling counts one request per lens.
- **Contact line — shop name from its record (PR #88 review follow-up).** `contactLine.ts` reads the shop name from the approved-facts `shop` record (`approved-facts:shop`, claim `shop: German Car Depot`) instead of typing "German Car Depot" into the module — byte for byte, failing closed exactly like the phone number and booking link (absent, not a usable verified business fact, wrong attribute, or not one clean line → `ContactLineError` before any paid call). Instagram's line now cites `approved-facts:shop` and `approved-facts:phone`; Facebook's cites all three records; Google Business Profile's call to action carries no name and cites the booking link only. **Rendered text is unchanged for the current facts** (`CK1` pins `Call German Car Depot: {phone}` and the Facebook line literally); `CK4c` proves a different shop record renders its own name, `CK4d` and `CK4e` the fail-closed cases. `CONTACT_LINE_MAX_SOURCE_FACTS` moves 2 → 3.

**Before → after — every figure.**

| Value | Before (single critic, `main` at `fb51527`) | After (panel) |
|---|---:|---:|
| Critic model requests per stage execution | 1 | **4** (one per lens) |
| Output contract transport / contract chars | `CRITIC_OUTPUT` 109,006 / 60,706 | evidence-fidelity 110,727 / 62,427; platform-and-local 110,773 / 62,473; voice-and-craft 45,519 / 26,019; production-coherence 45,629 / 26,129 |
| Output-token floor | 110,000 (`critic`) | evidence-fidelity 111,000; platform-and-local 111,000; voice-and-craft 46,000; production-coherence 46,000; `POLICY_OUTPUT_TOKEN_FLOORS.critic` = largest = **111,000** |
| `critic` `max_tokens` / stream deadline | 128,000 / 108 min | 128,000 / 108 min — unchanged, per lens request |
| Headroom under 128,000 at the floor (reserve required: `THINKING_RESERVE_TOKENS` 16,000) | 18,000 | evidence-fidelity 17,000; platform-and-local 17,000; voice-and-craft 82,000; production-coherence 82,000 — every lens ≥ 16,000 (`CC19c`) |
| `CONTACT_LINE_MAX_SOURCE_FACTS` | 2 | 3 |
| `CONTACTED_PACKAGING_OUTPUT` transport / contract (= `FINAL_CRITIC_LIMITS.packagingOutputChars`) | 103,604 / 56,474 | **104,852 / 57,122** |
| Lens blocks (new) | — | `SCRIPT_COPY` 32,294; `OVERLAY_TEXT` 10,962; `PACKAGING_COPY` 38,333; `REQUIRED_CAVEATS` 10,838; `FORBIDDEN_CLAIMS` 10,382; `COPY` 26,086 |
| Assembled ceiling per request | final-critic 327,021 | evidence-fidelity 166,054; platform-and-local 134,966; voice-and-craft 26,153; production-coherence 265,277 |
| `STAGE_ASSEMBLED_CEILINGS["final-critic"]` (largest request) | 327,021 | **265,277** |
| Other five assembled ceilings | 341,520 / 403,564 / 173,030 / 105,675 / 193,489 | unchanged |
| `MAX_PAYLOAD_CHARS` | 410,000 | 410,000 — unchanged (still set by `automotive-truth`) |
| `reasoning-heavy` / `reasoning-standard` floor, `max_tokens`, deadline | 74,000 / 99,000; 63 / 84 min | unchanged |
| `OUTPUT_FIELD_BOUNDS` entries | 55 | 69 (the six critic rows became twenty: six per claim-binding lens, four per other lens) |
| `STATED_FIELD_CEILINGS` entries | 14 | 18 |
| CLI ceiling, one critic-only replay | ~$2.97 (1 request) | **~$11.88** (4 requests × ~$2.97) |
| CLI ceiling, one full run | ~$11.28 (6 requests) | **~$20.19** (9 requests) |

The floors move because each lens's validated output carries its `lens` attribution on every finding and binding and the witness now counts a two-digit finding index; the raw model response carries neither, so the bound is conservative. The CLI ceiling is the same rough worst case it has always printed — each request priced at `MAX_PAYLOAD_CHARS / 4` input tokens and its whole `max_tokens` of output — and it is a ceiling, not a spend.

**Measured cost — the owner's acceptance replay, 2026-09-24.** The panel's live critic-only replay of run `2026-09-23T17-07-15-470Z` cost **$0.547364**:

- evidence-fidelity $0.188156;
- platform-and-local $0.127964;
- voice-and-craft $0.082148;
- production-coherence $0.149096.

It used 62,951 input and 14,778 output tokens; output per lens was 6,209 / 3,578 / 1,859 / 3,132 in that order. That is about 2.6× the single Opus 5.5 critic's $0.209 on the same run. **This is the expected cost of a critic-only replay on a run of that size.** It is one operator-local measurement, not production evidence. A full run adds the same over a single-critic run; the repository records no measured cost for stages 1–5, so no full-run total is claimed.

*Estimate recorded at implementation, superseded by the measurement above and kept as history (it was within range):* The single Opus 5.5 critic on run `2026-09-23T17-07-15-470Z` cost **$0.209** (23,526 input and 5,746 output tokens). Estimated for the panel on that run: instructions grow from about 19.5 KB (the single prompt plus `critique-discipline`) to about 87 KB across four lenses (four ~20–25 KB instruction sets), and the data blocks from about 18.5k to roughly 30–35k tokens because the packaging output and forms of the script reach more than one lens — about 52–57k input tokens, **~$0.21–0.23**; if each lens thinks and answers in 4–6k output tokens, 16–23k output tokens, **~$0.32–0.46**. **Estimated total ~$0.53–0.69 per critic-only replay, roughly 2.5–3.3× the single critic**; a full run adds the same over a single-critic run. The repository records no measured cost for stages 1–5, so no full-run total is claimed. This is arithmetic on stated assumptions, not a measurement.

**Acceptance fixture — recorded at implementation; verified by the owner after merge (see *Acceptance result* below).** The owner runs a live `--replay-critic` against `local-output/content-intelligence/2026-09-23T17-07-15-470Z`. Those outputs exist only on the owner's machine and were not reached from this change. **The panel passes if it flags at least all seven below, each on the right platform or surface:**

1. **Script** — "You also don't have to bring the car to us, or to a dealer, to stay covered": warranty overreach; no BMW record supports it.
2. **Google Business Profile caption** — makes BMW claims, but no BMW record is bound on GBP.
3. **Instagram and Facebook captions, and the script** — say BMW and Mercedes both describe intervals as calculated or written for normal driving; only the Mercedes record says that.
4. **Facebook** — "BMW agrees" drops BMW's hedge ("may") and its scope (maintenance generally, not oil and filter).
5. **Script** — closes with "Book online or give us a call": contact channels named in model copy — uncited, and now against stage 3's rule.
6. **Local keywords** — "BMW oil change service", "Mercedes-Benz oil change service", "German car maintenance shop": make, service and shop type are not established by bound claims, and none is local.
7. **Shot-2 overlay** — "Short trips. Stop-and-go. Idling." sits over the Mercedes page; "stop-and-go" is BMW's wording.

**Comparison baseline:** the single Opus 5.5 critic caught all seven on that run, at **$0.209**. The panel is accepted only if it catches at least those seven; the replay also yields the panel's measured cost and each lens's `usage.output_tokens`, which replace the estimate above and inform tuning `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens.

**Replay input — corrected 2026-09-24.** Run `2026-09-23T17-07-15-470Z` was produced **after** PR #86, so it replays against the **current** `config/approved-facts.json`. The owner's replay matched the current file hash `02fa31fe…`. It does not need, and would refuse, the pre-PR-#86 file. *Recorded at implementation, and correct only for the earlier run `2026-09-23T12-22-23-782Z` (produced before PR #86), kept as that run's history:* "Because the approved-facts file changed after that run (PR #86), the replay must use the pre-change file from `git show e812ba4:config/approved-facts.json` — the replay checks the file hash — as recorded in the PR #86 record above; the shop, phone and booking records it needs are present in that file." Run `12-22-23-782Z` is not replayable under the current contract in any case; see the acceptance-fixture finding below.

**Acceptance result — PASSED, 7 of 7 (owner-run, 2026-09-24).**

- **How it was run.** The owner ran a live `--replay-critic` on `2026-09-23T17-07-15-470Z` at 2026-09-24T12:59:02Z. It used approved-facts `02fa31fe…` and automotive facts `b40d8e79…`.
- **Catch rate.** All seven listed items were flagged. Item 7 (the shot-2 overlay's "stop-and-go") was caught only at **advisory** severity, and without naming the manual ("whichever manual is shown…"). The critic-panel follow-up (PR #90) above addresses that by showing the evidence lens which records each overlay's shot carries. *(2026-09-24: on the owner's second replay, with that follow-up merged through PR #90, item 7 was blocking, owned by `production-direction`, and named both records; see *Second owner-run replay* in PR #90's record above.)*
- **Findings.** 21 in total: 7 blocking and 14 advisory. The panel verdict was `needs_revision`, computed under this record's original rule.
- **Cost.** $0.547364 measured, broken down under *Measured cost* above.
- **Field limits.** No field exceeded its stated limit. The longest `issue` was 366 of 400 characters.

This is operator-local evidence from a live model call against saved outputs. It is **not production evidence**: no stage is enabled or reachable. The run's outputs exist only on the owner's machine and were not re-examined from this repository.

**Background carried from the `PLANNED` entry (relocated, not deleted).** *Owner decision, 2026-09-23: build it next*, after the contact-line change. The planned shape — four narrow reviewers, evidence-fidelity receiving stage 2's `requiredCaveats` and `forbiddenClaims` as reviewer-only input, platform & local, voice & craft, production coherence, aggregated deterministically with no model-written merged summary — is what this record delivers. *The single Opus 5.5 critic's result on run `2026-09-23T17-07-15-470Z`* — the second complete six-stage run, and the first with the critic on `claude-opus-5-5` (cost $0.209; 23,526 input and 5,746 output tokens) — caught **4 of 4** against the pre-registered list (the "to stay covered" warranty line, blocking; the make/service keywords; the uncited "Book online or give us a call"; "both say … normal driving") and **3 more** (Google Business Profile making BMW claims with no BMW record bound on GBP, blocking; Facebook's "BMW agrees" dropping BMW's hedge and scope; the shot-2 overlay using BMW's "stop-and-go" over the Mercedes page). For comparison, the Sonnet 5 critic on the earlier run caught 1 of 3. *Acceptance test as first written, superseded by the fixture above and preserved as history:* a replay of the 2026-09-23 run must flag the "both manufacturers say … not a direct read of your oil" misattribution, the uncited estimate-approval claim, and the make/service GBP keywords. *Acceptance-fixture finding, 2026-09-23:* the first `--replay-critic` attempt against `local-output/content-intelligence/2026-09-23T12-22-23-782Z` refused before any model call with `packages[2].localKeywords exceeds 2 entries` — its saved stage 5 output carries three Google Business Profile keywords, legal when produced and invalid under PR #87's cap of two; refusal is correct fail-closed behavior. Superseded 2026-09-23 by run `2026-09-23T17-07-15-470Z`, produced under the current contract. Its stage 5 caption+hashtag sizes fit the contact-line budgets (see the contact-line record's replay-compatibility note).

**What the reference says — quoted from the `claude-api` skill, invoked for this change before any model request code was written.** From `shared/model-migration.md` → "Migrating to Claude Opus 5.5":

- Thinking: "On Claude Opus 5.5 thinking is **always on**: `{"type": "disabled"}` and `{"type": "enabled", "budget_tokens": N}` both return a 400 `invalid_request_error` at every effort level".
- Effort: "**The API default is `medium`** (Claude Opus 5 and earlier Opus models default to `high`), so a request that omits `effort` now runs one level lower than it did. **Set `effort` explicitly** and re-run the sweep rather than carrying the Claude Opus 5 setting over."
- `max_tokens`: "**Size `max_tokens` for the thinking as well as the reply.** Thinking counts toward `max_tokens` even though its text isn't returned under the default `display`, so a limit sized for a no-thinking route cuts replies off."

And from the skill's own guidance: "Fable 5, Claude Fable 5.1, Opus 5, Claude Opus 5.5, … support up to 128K `max_tokens`, but the SDKs require streaming for values that large to avoid HTTP timeouts", and "`max_retries`/`maxRetries` default 2 (retries 408/409/429/5xx + connection errors)". Each lens request therefore keeps the `critic` policy exactly as PR #87 set it — adaptive thinking, effort `high` set explicitly, `max_tokens` at the 128,000 cap covering thinking and reply, streamed, `maxRetries: 0`. The same section's advice to ship a refusal fallback remains **deliberately not followed**, for the reason the PR #87 record gives.

**Migrations / schema impact:** none. No SQL, no durable state.

**Material design decisions.**

- **Keep it inside the existing stage.** `final-critic` stays order 6 with one registry entry and one executor; the panel is how that stage does its work. Every caller, the CLI, the preview's six-stage plan and the dormancy assertions are unchanged in shape.
- **Code aggregates; no model merges.** The verdict, the counts, the union and the attribution are computed, so nothing a lens writes can overrule another lens or the rule.
- **The union is not deduplicated.** Two lenses flagging the same line is two findings, each attributed; a reviewer sees that two independent lenses agreed.
- **The payload contract decides what each lens sees.** `CRITIC_LENS_BLOCKS` fixes labels and order, the executor renders exactly those, and a block over its derived ceiling is refused.
- **Per-lens contracts, identical figures.** Each lens is bounded and budgeted on its own, but no field's product figure moved when the critic was split.
- **Overlay text travels with its shot subject.** On-screen words attribute a claim to whatever is on screen, so the evidence lens needs the shot subject beside each overlay — acceptance item 7 turns on it — and nothing else of stage 4. *(2026-09-24: each overlay now also carries `shotFactIds`, the ids of the records stage 4 bound to its shot, and still nothing else of stage 4. See the critic-panel follow-up (PR #90) record above.)*
- **The panel verdict is owner-aware** — *superseding, 2026-09-24, the decision below*. A blocking finding owned by a revisable stage → `needs_revision`. Else a blocking finding owned by `human_review`, any `human_decision` finding, or any lens verdict `needs_human_review` → `needs_human_review`. Else `provisional_pass`. **Why it was superseded:** the verdict names an action. `needs_revision` sent the operator to re-run a stage for a finding that, by its own owner, no revision can resolve. The acceptance run's findings made the cost of that visible. The lens-verdict arm is still kept and exercised directly (`CL10`). See the critic-panel follow-up (PR #90) above.
  - *Superseded decision, as written at implementation:* "**The panel verdict is a triage signal; the owner stays on the finding.** Under the rule, a blocking finding owned by `human_review` yields `needs_revision` at the panel level; the finding still names `human_review`. A lens's own `needs_human_review` already requires a blocking finding, so the rule's lens-verdict arm is kept for completeness and exercised directly (`CL10`)."

**Material rejected alternatives.**

- **A model-written merged summary.** Rejected: a fifth model call that reads four critiques and writes one could drop, soften or re-weight a lens's finding, and would be one more paid request and one more failure point — the merge is exactly the step that must not be an opinion.
- **Four separately registered stages.** Rejected: it would change the six-stage registry, the preview plan, the dormancy assertions and every caller, and turn one reviewing stage into four pipeline stages with four prerequisites, for no gain over one stage that makes four requests.
- **Deduplicating findings.** Rejected: deciding that two findings are "the same" is a semantic judgement no deterministic check makes reliably; merging them would hide which lenses agreed, and a wrong merge would silently drop a real finding.
- **Injecting `skills/platform-specs` or `skills/local-seo` into the platform lens.** Rejected: both carry concrete facts (media profiles, provider payloads, an address, city lists, makes), which would give a reviewer a second, unclassified source of "fact".
- **Letting a lens raise any category.** Rejected: a lens straying into another's job is refused, so each lens's scope is enforced rather than hoped for.

**Automated validation (on the head that was pushed).** Build and typecheck clean. `npm run test:offline` **ALL PASS** on all nine suites — **1,704 checks** (1,629 before): posting 52, image 18, orchestrator 119, gate 56, API 51, render-identity one invariant pass, ownership/recovery 112, content-intelligence **1,201** (was 1,126), interval monitor 94. New checks: `BT10`, `BU16`–`BU21`, `BV14`, `BW8`–`BW15`, `BY34`, `CL1`–`CL26`, `CK4c`–`CK4e`, `CC19c`, `CE10`, `CG14`–`CG16`; the critic groups `BT`, `BU`, `BV`, `BX`, `BY`, `CB`, `CK`, `CC`, `CD`, `CE`, `CF` and `CI` were rewritten for four lens requests and the per-lens contracts, not loosened. `npm run test:payload-mutation` **ALL PASS — 386 mutations** (369 before; 384 prohibited, 2 coordinated-authority updates); seventeen new mutations, `M370`–`M386`, are appended after every earlier group so no existing id moves, and seven earlier mutations (`M344`, `M353`, `M358`, `M362`, `M364`, `M366`, `M368`) had their `from` sites repointed at the per-lens keys, the shop-name template, the CLI's new summary line and the evidence lens prompt, each still expecting the same check. Also clean: simulated dry run; deployment-controller fixtures; `npm audit --omit=dev` (0 vulnerabilities); Markdown links (65 files); environment coverage (35 variables); the sensitive-content scan (184 files — manual triage: the diff adds no phone number, URL, token or e-mail address to code; the only URLs added to documents are this repository's own pull-request links); AgentShield 1.4.0 at **B/87** with zero critical or high findings (see the limitation below); and `git diff --check`. **One defect was found by the mutation harness and fixed before push:** the first full run failed only `M357` (Facebook's contact reserve narrowed in the contract), because the new `CK4c` built a contact line for a longer substitute shop name outside any guard, so under a narrowed reserve its `ContactLineError` aborted the suite instead of failing a named check. `CK4c` now evaluates inside a guard, and `M357` again fails `CD6 (facebook)` and `CD3 (packaging-adaptation)` by name. The CLI was driven in fake mode against synthetic automotive facts, a full run and a critic-only replay, both running the four lenses. **No live model call was made.**

**Production evidence:** none, and none is possible — no stage is enabled or reachable. The acceptance fixture above is the owner's post-merge verification; its result (PASSED, 7 of 7, 2026-09-24) is operator-local evidence from a live replay, not production evidence.

**Rollback / recovery:** revert the commit. No migration, no durable state; files written under `local-output/` are local run records never read back.

**Security and privacy implications.** The panel adds no provider, publishing, scheduling or approval surface, no tool, and no credential. Stage 2's caveats and forbidden claims now reach one model — the evidence-fidelity reviewer — that writes no copy; they were already in the pipeline and carry no customer data. Four requests replace one, so a critic run costs more and makes four refusals possible; every one is a visible, named failure, and no fallback answers with a different model. The shop name is now read from the approved-facts record rather than typed into code, which removes a hardcoded business fact from source; it is the same public name already in `config/approved-facts.json`. The Phase-A approval gate and the live `brand-compliance-critic` are untouched.

**Accepted limitations.**

- **The panel is not measured.** Whether four narrow lenses catch more than, the same as, or less than the single Opus 5.5 critic is exactly what the acceptance replay decides; the single critic caught all seven, so the panel can at best match it on this fixture. *(2026-09-24: measured once. It matched the single critic, 7 of 7, with item 7 only advisory; see the acceptance result. Measured again after PR #90: 7 of 7, with item 7 blocking; see *Second owner-run replay* in PR #90's record.)*
- **Cost rises.** Four requests with overlapping inputs cost more than one; the estimate above is arithmetic, not a measurement. *(2026-09-24: measured at $0.547364 against the single critic's $0.209 on the same run.)*
- **A lens can still stray in prose.** Category restriction is enforced; a lens writing about another lens's concern under its own category is not detected.
- **Effort and the thinking reserve are shared, not tuned per lens.** Every lens runs effort `high` under one `THINKING_RESERVE_TOKENS`; per-lens tuning waits on the measured replay.
- **The panel's four prompts are longer in total than the one they replace, and AgentShield counts each.** Its grade moves from A/92 to **B/87**: the one `agents/final-critic.md` medium oversized-agent finding and one low unspecified-model finding become four of each (9 medium and 9 low in total, from 6 and 6), with zero critical or high findings. The prompts pin no model by design — the stage policy chooses it — and CI does not gate on the grade.

**Unresolved follow-ups.**

- ~~**Blocking:** the PR number and merge SHA above (mutable-identifier exception).~~ **Discharged 2026-09-24:** PR #89, merge `e557dda6601a9ff4cc8d6664cc1cf42045365234`.
- ~~The acceptance replay against `2026-09-23T17-07-15-470Z`, by the owner, after merge — with its measured cost recorded here.~~ **Done 2026-09-24:** PASSED 7 of 7 at $0.547364; see the acceptance result.
- ~~Item 7 was caught only at advisory severity, without naming the manual. Addressed in repository code by the critic-panel follow-up (PR #90) record above; whether a live replay now names it is unverified.~~ **Verified once, 2026-09-24:** with that follow-up merged through PR #90, the owner's second replay flagged item 7 as blocking, owned by `production-direction`, naming `mb-eclass-arduous-conditions-oil-frequency` and `bmw-my2025-conditions-more-frequent-service`; see *Second owner-run replay* in PR #90's record.
- Tune `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` per lens from measured `usage.output_tokens`, carried forward from the PR #87 record. One sample now exists (per-lens output 6,209 / 3,578 / 1,859 / 3,132); still open. *(2026-09-24: a second sample, from the second replay, is 6,699 / 3,335 / 2,242 / 3,644; see PR #90's record.)*
- The evidence pack's 64-record cap — see the open item below.

**Documents updated with implementation:** [README](../README.md), [Status](STATUS.md) (PR #88 recorded as merged, and a phase row for this change), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md) (including a stale clause that still called the PR #87 critic policy `IMPLEMENTED`, now `MERGED`), [Environment](ENVIRONMENT.md), [Production-wiring design](PRODUCTION_WIRING_DESIGN.md) (the one-request guarantee, amended for `final-critic`), this file (including PR #88's record, moved to *Merged repository change awaiting rollout*, and the `PLANNED` entry, relocated into this record), the four lens prompts, `skills/platform-local-review/SKILL.md`, and the mutation harness's header. `agents/final-critic.md` was removed. Each was reread in full.

### Deterministic contact line for stage 5 packages, plus follow-ups from the first complete six-stage run — `MERGED`

**State:** `MERGED` through [PR #88](https://github.com/Caposhi/GCD-Agents/pull/88) at `fb51527ce8077cf45e4adc576c0cbc72b9f52aff` (recorded 2026-09-23). **Not `DEPLOYED`, and not `PRODUCTION-VALIDATED`**: the live worker does not carry it, all six stages remain `executionEnabled: false`, and no production path reaches any of them. Implemented on branch `claude/kind-curie-5i5r6i`, based on `main` at `72535d5cc7f184efe8d9763030e70a75e727595b` (the PR #86 merge). The rest of this record is preserved as written at implementation; where it says the change is unmerged or that its PR number and merge SHA are a blocking follow-up, this line supersedes it. The narrow critic panel it points to below is now `MERGED` through PR #89; its record is directly above this one.

**PR / merge:** opened as a pull request from `claude/kind-curie-5i5r6i` into `main`. **The PR number and merge SHA are not knowable before merging** — recorded here as a **blocking follow-up** under the mutable-identifier exception in [`AGENTS.md`](../AGENTS.md), to be reconciled in the first change after merge.

**The defect — measured, on both complete runs.** In both six-stage runs of 2026-09-23, stage 1 planned a call to action ("book online or call") but spent all twelve of its citation slots on other facts and never cited `approved-facts:phone` or `approved-facts:bookingurl`. Stage 3 then wrote "Book online or give us a call" with no citation; the Opus 5.5 critic correctly flagged it as an uncited implication; and stage 5 correctly dropped it — so every caption shipped with no way to book. Every stage behaved as designed. The design had no place for a contact line.

**Owner decision, 2026-09-23.** (a) Keep `STRATEGY_LIMITS.maxIds` at 12 — see the decided item below. (b) Attach contact details **by code, never by a model**: contact details must match the approved data exactly (`skills/local-seo`, "NAP consistency"), and they should not compete for citation slots.

**Delivered.**

- **`src/harness/agents/contactLine.ts`** — a deterministic step that runs after stage 5 validates and before the critic. For each package it adds a typed `contact` object, `{ kind: "deterministic_contact", text, gbpCta?, sourceFactIds }`. **No model writes or edits any part of it.** Values are copied byte for byte from the evidence pack's `approved-facts:phone` and `approved-facts:bookingurl` records — the substring after the record's `"<field>: "` prefix, which the approved-facts adapter writes from the checked-in file — and `sourceFactIds` lists exactly the records used. A needed record that is absent, not a usable `verified_business_fact` (conflicted, stale or inactive records are not in `allowedFacts`), or whose value does not read back as one clean line (or, for the booking link, plain HTTPS) is a `ContactLineError` before any paid call.
- **Owner-reviewed templates, used verbatim:** Instagram `Call German Car Depot: {phone}`; Facebook `Call German Car Depot: {phone} · Book online: {bookingUrl}`; Google Business Profile no text and `gbpCta = { actionType: "BOOK", url: {bookingUrl} }`, mirroring the BOOK rule `ctaForGbp` applies in `packageMap.ts` — which was read and not changed, and against whose public `buildFinalPackage` behaviour a regression checks the mirror.
- **Rendered from `config/approved-facts.json` today:** Instagram text `Call German Car Depot: (954) 921-1515` (37 characters); Facebook text `Call German Car Depot: (954) 921-1515 · Book online: ` followed by the checked-in booking-widget link (130 characters, 131 UTF-8 bytes); Google Business Profile `BOOK` to that same link (77 characters).
- **A named contact reserve per platform.** `CONTACT_LINE_RESERVE_CHARS` in `payloadContract.ts` — Instagram 64, Facebook 192, Google Business Profile 0 — covers the two-character separator plus the contact text, in characters and again in UTF-8 bytes. Provider-visible text becomes caption + separator + hashtags + separator + contact text, and stays within each platform's existing limit, because stage 5's caption budget is lowered by the reserve: `effectiveCaptionBudget()` in `packagingAdaptation.ts` is the one number the validator applies, the prompt states, the response schema describes, and the local CLI's field measurement reports. A caption refused because of the reserve names it (`… less the N-character contact-line reserve CONTACT_LINE_RESERVE_CHARS.<platform>`). A contact line longer than its reserve fails closed rather than being trimmed.
- **Contact text is not caption prose.** It sits outside the caption, so stage 5's recognizable-URL ban keeps applying to model prose only; the Facebook line legitimately carries the booking link.
- **The critic always sees the contacted shape.** `executeFinalCritic` now takes the contacted packaging output. `revalidateContactedPackagingOutput` requires a `contact` on every package, revalidates the stage 5 part through stage 5's own revalidator (so the reserve-lowered budget is re-checked), rebuilds every contact line from the pack, and refuses any line that differs — all before any model call. Its `PACKAGING_OUTPUT` block carries the contact objects.
- **Prompts.** `agents/hook-story-script.md` and `agents/packaging-adaptation.md` gain one rule: do not name a contact or booking channel (phone, website, online booking, "call us", "visit"), because code adds a fixed contact line. `agents/packaging-adaptation.md` states the lowered caption budgets. `agents/final-critic.md` gains a section stating that `contact` is deterministic, copied from approved facts, not model-written, and must not be flagged as an uncited implication — while it may still raise, for example, contact lines inconsistent between platforms, or a caption that also names a contact channel. Nothing else in those prompts changed.
- **`scripts/local/content-run.mjs`.** The same step runs in full runs and in `--replay-critic`: every record the requested platforms' contact lines need is checked before the cost gate (a full run) or the spend guard (a replay); the lines are attached after stage 5, written to `05b-contact-lines.json`, and the critic receives the attached packages. `summary.md` renders each platform's contact line and Google Business Profile's call to action beside its caption. The stage 5 file stays exactly what stage 5 returned, so a replay revalidates it and attaches afresh rather than trusting a saved copy.
- **Summary footer bug (follow-up a).** The footer said "_Fake-runner output. Not reviewed. Not publishable. Authorizes nothing._" even for live runs, including the 2026-09-23T17:07Z one. It now names the runner that ran — `_Live-runner output. …_` or `_Fake-runner output. …_` — keeping "Not reviewed. Not publishable. Authorizes nothing." for both. The CLI now runs `main()` only when executed as a script, so the suite imports it and exercises the footer for both runners.

**Limits and budgets, before → after.** Stated figures for every other field are unchanged.

| Value | Before | After |
|---|---:|---:|
| `CONTACT_LINE_RESERVE_CHARS` Instagram / Facebook / GBP | — | 64 / 192 / 0 |
| Stage 5 caption budget (caption + separator + hashtags) Instagram | 2,200 | **2,136** |
| Stage 5 caption budget Facebook (`Math.min(63,206, 2,200)` less reserve) | 2,200 | **2,008** |
| Stage 5 caption budget Google Business Profile | 1,500 | 1,500 — unchanged |
| Provider-visible limit (caption + tags + contact) Instagram / Facebook / GBP | 2,200 / 2,200 / 1,500 | 2,200 / 2,200 / 1,500 — unchanged |
| `CONTACT_CTA_URL_CHARS` (GBP call-to-action link) | — | 200 |
| `PACKAGING_OUTPUT` transport / contract (stage 5's own response) | 98,084 / 53,324 | 98,084 / 53,324 — unchanged |
| `CONTACTED_PACKAGING_OUTPUT` transport / contract (the critic's `PACKAGING_OUTPUT` block) | — | 103,604 / 56,474 |
| `FINAL_CRITIC_LIMITS.packagingOutputChars` | 98,084 | **103,604** |
| `STAGE_ASSEMBLED_CEILINGS["final-critic"]` | 321,501 | **327,021** |
| Other five assembled ceilings | 341,520 / 403,564 / 173,030 / 105,675 / 193,489 | unchanged |
| `MAX_PAYLOAD_CHARS` | 410,000 | 410,000 — unchanged (still set by `automotive-truth`) |
| `reasoning-heavy` floor / `max_tokens` / stream deadline | 74,000 / 74,000 / 63 min | unchanged |
| `reasoning-standard` floor / `max_tokens` / stream deadline | 99,000 / 99,000 / 84 min | unchanged |
| `critic` floor / `max_tokens` / stream deadline | 110,000 / 128,000 / 108 min | unchanged |
| CLI ceiling estimate: full run / critic-only replay | ~$11.28 / ~$2.97 | unchanged |

No token budget moves because the contact line is not model output: stage 5's response is still bounded by `PACKAGING_OUTPUT`, and the critic's output contract is unchanged. The critic's input grows by 5,520 characters at the worst case — three packages, each counted with contact text at the widest reserve less its separator, a 200-character call-to-action link and two source-fact ids, at the escape factor, plus their skeleton — and its assembled ceiling stays below `MAX_PAYLOAD_CHARS`.

**Replay compatibility.** A stage 5 output that was valid before this change still revalidates, unless its caption and hashtags no longer fit under the new budget, in which case the replay refuses with a message naming `CONTACT_LINE_RESERVE_CHARS.<platform>`; an offline regression proves both halves with a synthetic package (`CK9`, `CK9a`), and the same for a caption that fits in characters but not in UTF-8 bytes (`CK9c`). **Run `2026-09-23T17-07-15-470Z` measured caption+hashtag text of 1,375 (Instagram), 1,048 (Facebook) and 912 (Google Business Profile) UTF-8 bytes. All three still fit** — under 2,136, 2,008 and 1,500 respectively; the validator counts characters, which are never more than bytes (`CK9b`). That run's own outputs live only in the operator's local-output folder, so its replay is not exercised here, and the replay's other fail-closed checks — approved-facts identity, automotive-facts identity, pack fingerprint — are unchanged by this change and not re-verified.

**Migrations / schema impact:** none. No SQL, no durable state.

**Material design decisions.**

- **Code, not a model, owns contact details.** A model paraphrasing a record cannot guarantee NAP consistency; copying the record's bytes can. It also takes contact details out of the citation budget, which is what starved them.
- **The contact line lives outside stage 5's output.** Stage 5's validated output and its saved file are unchanged in shape, so outputs saved before this change still revalidate, and the critic's `PACKAGING_OUTPUT` is the only place the contacted shape exists.
- **The critic rebuilds, never trusts.** A supplied contact line is compared with one rebuilt from the same pack; a missing, edited, or widened line is refused before any model call.
- **The reserve is a named constant, and it bounds characters and bytes.** Platform limits count characters; the payload derivation counts bytes too, and the Facebook template's "·" is two bytes — so the reserve holds both. Reserves carry headroom (Instagram needs 39 of 64, Facebook 133 bytes of 192) so a reformatted phone number or a longer link fails a free check rather than silently eating caption room, and a change to a reserve fails the prompt drift checks until the prompt moves with it.
- **Google Business Profile reserves nothing.** Its booking link travels as a structured `BOOK` call to action, not as summary text.

**Material rejected alternatives.**

- **A model-written call to action.** Rejected: it is exactly what failed on both runs — the close went uncited, was correctly flagged, and was correctly dropped — and a model cannot guarantee the exact approved phone and link.
- **Citing the contact facts through stages 1–3.** Rejected: contact records would compete with the claims the piece is about for the twelve citation slots stage 1 has and the twelve permitted claims stage 2 has — the competition that dropped them — and every stage would have to preserve them faithfully for no editorial reason.
- **Raising `maxIds` / `maxAllowedClaims` to 16 so the contact facts fit.** Rejected; see the decided `maxIds` item below.
- **Having stage 5 append the line inside the caption.** Rejected: the caption is model prose under the URL ban and is never checked for faithfulness, so the line could be altered, and the ban would have to be weakened for the booking link.
- **Saving the contact line into stage 5's output.** Rejected: it would change stage 5's contract and make every previously saved stage 5 output fail revalidation.

**Production evidence:** none, and none is possible — no stage is enabled or reachable. **No live model call was made by this change.**

**Rollback / recovery:** revert the commit. No migration, no durable state; `05b-contact-lines.json` files written under `local-output/` are local run records never read back.

**Security and privacy implications.** The contact line carries only public business contact details already in `config/approved-facts.json` — its `_note` records the booking-widget link as public — and adds no credential, token, customer data, or new data flow. It adds no provider, publishing, scheduling, or approval surface: no provider payload is built, and the package stays provisional, unverified, non-publishable and non-executable. The Phase-A approval gate and the live `brand-compliance-critic` are untouched. The prompt edits add a restriction to stages 3 and 5 and a scoped instruction to the critic; no tool, model id, thinking or effort setting, capability, or autonomy boundary changed.

**Accepted limitations.**

- **A model can still name a contact channel.** The stage 3 and 5 prompts forbid it and the critic may flag it, but no deterministic check detects "call us" in prose.
- **The reserve narrows every Instagram and Facebook caption** by 64 and 192 characters, whether or not the line needs all of it.
- **The line is fixed.** It varies by platform only; a piece that should carry no contact line, or a different one, needs a reviewed change.
- **The Google Business Profile call to action is review metadata only.** Nothing here builds or sends a GBP payload; the live path's own `ctaForGbp` is unchanged and separate.

**Unresolved follow-ups.**

- **Blocking:** the PR number and merge SHA above (mutable-identifier exception).
- The narrow critic panel, which the owner decided on 2026-09-23 to build next, after this change — see its entry below. *(Now `MERGED` through PR #89; its record is above this one.)*
- The evidence pack's 64-record cap — see the new open item below.

**Automated validation (on the head that was pushed).** Build and typecheck clean. `npm run test:offline` **ALL PASS** on all nine suites — **1,629 checks** (1,597 before): posting 52, image 18, orchestrator 119, gate 56, API 51, render-identity one invariant pass, ownership/recovery 112, content-intelligence **1,126** (was 1,094), interval monitor 94. The 32 new checks are `AF5c`, `CK1`–`CK17` (with `CK4a`, `CK4b`, `CK5a`, `CK8a`, `CK9a`, `CK9b`, `CK9c`, `CK13a`, `CK13b`), `CE8`, `CE9` and `CG11`–`CG13`; `BX18`–`BX23`, `BU4`, `BO3`, `BQ33e`/`BQ33f`, `CC11`/`CC13`, `CD6` and `CE7` were updated to the contacted shape and the lowered budgets, not loosened. `npm run test:payload-mutation` **ALL PASS — 369 mutations** (355 before; 367 prohibited, 2 coordinated-authority updates): the fourteen new ones, `M356`–`M369`, are appended after every earlier group so no existing id moves, and the harness now captures sixteen paths. Also clean: simulated dry run; deployment-controller fixtures; `npm audit --omit=dev` (0 vulnerabilities); Markdown links (61 files); environment coverage (35 variables); the sensitive-content scan (180 files — manual triage: the only phone number in the diff is GCD's public business number, already committed in `config/approved-facts.json`, and two `(000) 000-0000` values are synthetic test fixtures; the booking link is not written into any document); AgentShield 1.4.0 at grade A/92 with zero critical or high findings — its six medium oversized-agent and six low unspecified-model findings are the same classes and counts as before this change, though three of the oversized prompts grew by the rules added here; and `git diff --check`. **Two defects were found in review and fixed before push.** First, found by the new mutations: the contact text's UTF-8 byte bound was folded into the character check, so a Facebook line one byte over its reserve ("·" is two bytes) was refused with a message reporting only a character count that fit — an unexplained refusal; the reserve now bounds characters and bytes as two explicit checks, each with its own message (`CK8a`). Second, found in self-review: a saved caption within the new budget in characters but over it in UTF-8 bytes was refused on replay without naming the reserve; the byte-bound message now names it too (`CK9c`, `M369`). The CLI was also driven by hand in fake mode against a synthetic automotive-facts file: `summary.md` showed all three contact renderings and the fake-runner footer, and `05b-contact-lines.json` matched. **No live model call was made.**

**Documents updated with implementation:** [README](../README.md), [Status](STATUS.md) (PR #86 recorded as merged, and a phase row for this change), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), [AI handoff](AI_HANDOFF.md) (including a pre-existing stale clause that still called the critic-policy change unmerged, now recorded as `MERGED` through PR #87), [Security and continuity](SECURITY_AND_CONTINUITY.md), this file, `agents/hook-story-script.md`, `agents/packaging-adaptation.md`, and `agents/final-critic.md`. Each was reread in full.

### CTO-attested approved-facts expansion

**State:** `MERGED` through [PR #86](https://github.com/Caposhi/GCD-Agents/pull/86) at `72535d5cc7f184efe8d9763030e70a75e727595b` (recorded 2026-09-23). **Not `DEPLOYED`, and not `PRODUCTION-VALIDATED`**: the live worker at `R` does not carry it. Implemented on branch `codex/approved-cto-facts`. The rest of this record is preserved as written at implementation; where it says review and merge remain outstanding, this line supersedes it.

**Authorization and delivered scope:** on 2026-09-23 the GCD CTO attested five business facts and authorized only their repository addition. `config/approved-facts.json` now contains the verbatim top-level string fields `oilChangeRecommendation`, `nextOilChangeAppointment`, `serviceRecords`, `vehicleHistoryReview`, and `engineOils`. Its `_note` preserves the existing rules while identifying those five fields as CTO-attested on 2026-09-23 and not website-sourced. The generic adapter already projects every eligible top-level string, so no parsing path changed; `engineOils` alone joins `parts` in the `automotive-capability` tag set. The adapter now deterministically produces 27 records.

**CTO correction, 2026-09-23:** the first sentence of `engineOils` is unchanged. Its second sentence now says GCD special-orders an oil for an uncovered specification and chooses the Liqui Moly product where Liqui Moly offers one. The earlier sentence was false for vehicles whose specifications have no Liqui Moly US product, including BMW Longlife-14 FE+ and Longlife-22 FE++.

**Schema / migration impact:** none. No database command or evidence import was run. The durable `content_evidence` tables remain unchanged; `npm run evidence:sync` is still an explicit, separately authorized operator action rather than a release side effect.

**Material design decisions:** keep the canonical JSON as the only runtime fact authority; preserve field-level provenance in its human note rather than falsely attributing owner-attested facts to the website; use the existing deterministic field-to-record projection; and classify the oil inventory as a business fact with an automotive-capability tag rather than changing its epistemic kind.

**Rejected alternatives:** claiming the five facts came from `germancardepot.com` was rejected because it would be false. A one-off adapter branch was rejected because top-level strings are already projected correctly. Automatically importing the changed file into PostgreSQL was rejected because import is not part of this authorization and would alter external durable state.

**Regression and pinned-fixture impact:** `J2` deliberately changes from a loose `> 5` assertion to the exact 27-record count. `J7` pins the five new deterministic record ids and proves they exist in both identical adaptations; `J8` proves `engineOils` carries the automotive-capability tag. No fixture or test pinned the previous file SHA; `K3` computes the SHA from the exact current bytes and remains dynamic. The affected empirical count/maximum commentary in `payloadContract.ts`, the local evaluation description here, and current test totals in [Testing](TESTING.md) are updated in the same change.

**Rollout / production impact:** merging alone changes nothing live. The next production release carrying this commit will make the five new facts citable by the existing live copywriter and available to the existing brand-compliance critic as support for faithful claims. The same runtime brief is also visible to the existing image, hashtag/SEO/timing, and platform-formatter agents; no new URL is introduced, so CTA allowlisting is unchanged. The worker caches the checked-in facts after its first read, so the expanded set takes effect only in a new process running a release that contains the change. `skills/compliance-checklist` remains a checked-in rubric rather than an automatically injected runtime skill; the current critic prompt refers to it, but current orchestration injects the critic prompt and `brief.approvedFacts`, not the skill file. The operator-only adapter consumers (`evidence:sync` and the local evaluation CLI) will project 27 records when explicitly run. No deploy, migration, evidence import, provider request, approval action, or publication is authorized or performed by this change.

**Replay compatibility:** a replay of the 2026-09-23 run must use the pre-change file from `git show e812ba4:config/approved-facts.json`, because that replay checks the file hash and refuses a mismatch. The current expanded file is not a valid input for reproducing that earlier run. *(Clarified 2026-09-24: "the 2026-09-23 run" here is `2026-09-23T12-22-23-782Z`, produced before this change. The later run `2026-09-23T17-07-15-470Z` was produced after it and replays against the current file; see the narrow critic panel record.)*

**Rollback / recovery:** before deployment, closing or reverting the repository change restores the prior file. After a separately authorized deployment, an ordinary application rollback to a release containing the prior file restores the former runtime fact set. No schema or durable evidence rollback is required because this change performs no import.

**Security and privacy:** the added text is business-owner-attested shop policy and inventory. It contains no token, webhook, OAuth material, approval secret, customer record, actual VIN, analytics export, or database data. The phrase “by VIN” describes a review practice; it does not add a vehicle identifier.

**Accepted limitations and unresolved follow-ups:** these five facts rely on the named CTO attestation rather than website evidence. PR #86 review and merge remain outstanding; deployment requires separate authorization; production validation does not exist; and a future `evidence:sync`, if desired, requires its own authorization and review. The eventual merge SHA is a mutable identifier to record when known.

**Automated validation:** build and typecheck pass; all nine offline suites pass at 1,597 checks, including 1,094 content-intelligence checks; the simulated dry run passes without posting; deployment-controller fixtures pass; all 355 payload-contract mutations pass; `npm audit --omit=dev` reports zero vulnerabilities; Markdown validation passes for 63 files; environment coverage passes for 35 variables; the sensitive-content scan passes for 181 tracked text files; and AgentShield 1.4.0 exits zero at grade A/92 with no critical or high findings. Its six medium oversized-agent and six low unspecified-model findings are pre-existing and outside this diff, which changes no agent definition. Final whitespace and complete-diff review remain the pre-commit checks.

**Documents updated with implementation:** `README.md`, `docs/ROADMAP.md`, `docs/STATUS.md`, and `docs/TESTING.md`. Each is reread in full before review.

## Completed / durable history

### Phase 0A — Integrity Hardening

**State:** `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED`.

**PR / merge:** PR #33, merge `30d06f95f32c46f9952bc63f0bc34a6040d40a09`.

**Delivered:** protected controls; exact canonical approval/hash binding; hash-only decision-token storage; expiry and revocation; append-only atomic decisions; durable PostgreSQL publication authority; reviewer/provider parity; live target and immutable-media revalidation before every provider request; bounded trusted-media handling; fail-closed QC; and durable startup prerequisites.

**Schema:** migration 005 applied these database guarantees and invalidated incompatible legacy approvals.

**Accepted limitations:** no provider-side exactly-once guarantee; the approval bearer URL and generic reviewer identity remain; `session_state` still persists a default-path Instagram token in plaintext.

**Follow-ups still open:** provider operation ledger and reconciliation; control/reviewer identity; token lifecycle.

### Phase 0D — CI and Deployment Control Foundation

**State:** `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED` as an application release. The GitHub controller itself is `CONFIGURED` but **not** `ENABLED` and **not** `PRODUCTION-VALIDATED` as the deployment authority.

**PR / merge:** PR #34, merge `10098de73667797120da8c7dfa4da83f336ff6ba`. Deployed through the previous Render native auto-deploy path, not through the controller it introduced.

**Delivered:** comprehensive Node 22 CI; disposable PostgreSQL 16 and 18 integration; AgentShield and workflow validation; exact CI provenance; stale-release rejection; exact live/target ancestry and migration-range gates; serialized API, worker, and scheduler release control; release-bound health and readiness; bounded diagnostics; and fail-closed redaction/rendering.

**Schema:** none.

**Design decision:** deployment authority is exact-SHA and serialized, and a migration-bearing range stops the release rather than running a migration automatically. Exactly one migration runner remains the invariant.

**Rejected alternative:** allowing the controller to execute migrations. The Phase 0A rollout had already proven that a schema-dependent consumer racing its migration authority fails; giving the controller that authority would have created a second migration runner.

**Production evidence:** all three services observed live at the merge SHA on 2026-08-24; exact `/healthz` identity and the exact target-bound worker readiness marker passed. A normal scheduled run of this SHA was subsequently observed on 2026-08-25, closing the previously open current-SHA scheduler observation; the run evidence is recorded in [Status](STATUS.md).

**Accepted limitation:** the controller has never performed a release. Being deployed is not being proven.

### PR #35 — documentation reconciliation and zero-context handoff modernization

**State:** `MERGED`. Documentation-only; no runtime, schema, workflow, or deployment effect.

**PR / merge:** PR #35, merge `a797f4cbd85c477c1b558168b0a07018120adf64`.

**Delivered:** created `docs/AI_HANDOFF.md`, `docs/ROADMAP.md`, and `docs/START_HERE.md`; rewrote the root README as a zero-context handoff; reconciled the runbook set against source.

**Schema:** none. **Production evidence:** not applicable — nothing was deployed.

**Accepted limitation, recorded honestly:** this change introduced a roadmap without introducing a rule binding anyone to update it, and it recorded the repository `main` SHA in prose that its own merge immediately invalidated. Both defects are corrected by the documentation-governance change that adds this record.

### PR #36 — worker ownership and interrupted-brief recovery

**State:** `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED`.

**Production evidence — operator-reported 2026-08-27.** The manual bootstrap was performed by the operator, not by this engineering session, which has no Render or production database access; the following is recorded as reported and was not independently verified here. The new worker waited approximately 58 seconds for exclusive ownership before emitting readiness — the zero-downtime overlap behaving exactly as designed. The August 10 stranded brief was reconciled by startup recovery with `providerMutation = impossible` and no provider replay. Authenticated Instagram, Facebook, and Google Business Profile history had been checked beforehand and the target post was not found on any destination, so the reconciliation rested on account evidence rather than database absence.

**PR / merge:** PR #36, reviewed head `281eb8f232995e58e404c916c3ec0a23b62c7acc`, merge `0828cc91c41c9cd10ad709db30491ada0a52c811`.

**Delivered:** exclusive worker ownership through a PostgreSQL session-level advisory lock held on a dedicated client for the process lifetime; the `pending → running` claim executed on that ownership session; durable phase markers committed before each side effect as safety state rather than best-effort telemetry; refuse-don't-resume terminalization of work abandoned by a previous owner; a startup orphan-approval sweep; ownership loss as a side-effect fence that ends the process nonzero; a widened and truncation-aware worker readiness window in the deployment controller; and readiness redefined to assert durable state initialized, exclusive ownership held, abandoned work reconciled, and required initialization complete.

**Schema / migrations:** **none.** The advisory key is runtime state, `failed` was already permitted by the 002 constraint, the `events` table already stored the markers, and approval revocation columns already existed from migration 005. The change therefore ships through the controller's ordinary path instead of tripping its own migration gate.

**Material design decisions:** ownership is established, never assumed, because Render zero-downtime worker deploys keep the old instance alive for roughly a minute after the new one starts. Recovery runs only after ownership is held, because recovery is destructive. Markers commit before the side effect they describe, so an interrupted brief is classified exactly rather than guessed at. A former owner declines every terminal write so it cannot overwrite a successor's recovery.

**Material rejected alternative — a time-based worker lease or reaper.** Rejected on correctness for the current single-instance topology, not on effort. A brief legitimately remains `running` while waiting up to 24 hours for a human approval decision, so no TTL can distinguish a crashed worker from a waiting one. A lease row also survives its holder, whereas a session-level advisory lock is released by PostgreSQL the instant the owning session ends, making clean exit, SIGKILL, OOM, and host loss identical and requiring no expiry at all.

**Re-entry condition for that decision:** reconsider the lease/fencing architecture if worker scale or topology changes — more than one concurrent worker, a partitioned queue, or any deployment model in which two owners are intended to run at once.

**Automated validation (on the reviewed head, before merge):** Node 22 typecheck and build; the offline suite including `test:ownership` at 112 checks; deployment-controller fixtures including new truncation and pagination cases; disposable local PostgreSQL 16 integration at 114 checks, including two real sessions contending for the real advisory lock, automatic release on session death, and a `pg_terminate_backend` of the owning session proving a claim cannot commit afterwards; the bound HTTP end-to-end suite at 54 checks; simulated dry run; Markdown links; environment coverage; credential/PII scan; `npm audit --omit=dev` clean; AgentShield 1.4.0 clean. Exact-head GitHub CI was green across all five jobs before merge.

**Production evidence:** **none, by design.** Nothing was deployed.

**Rollback / recovery status:** no migration, so there is no forward-only schema commitment to unwind. Rollback is an ordinary application-release decision. Recovery itself is refuse-don't-resume: it never returns a brief to `pending`, never retries, and issues no provider request.

**Security and privacy implications:** an interrupted brief's approval is now revoked rather than left live, and a startup sweep revokes pending approvals with no owning brief marker — closing an approval-integrity gap in which a human could approve a post that nothing was waiting to publish. Ownership is mutual exclusion, not a fencing token: the Phase 0A publication guard remains the actual fence. Marker error text is bounded to 300 characters so provider response bodies do not accumulate in durable state.

**Accepted limitations:** interruption during a provider attempt still yields an outcome the system cannot resolve alone — it is surfaced and nothing retries automatically, but a human must reconcile against the platform. The Render log-truncation fallback remains a heuristic wherever the CLI exposes no `hasMore` or cursor; it is conservative and can fail a healthy release, but cannot pass an unproven one.

**Unresolved follow-ups:** the durable provider operation ledger and idempotency work below; the manual bootstrap release; reconciliation of the August 10 stranded row under separate production authorization.

**Documents updated at completion:** in the implementing PR — `README.md`, `docs/AI_HANDOFF.md`, `docs/DATA_MODEL.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/ROADMAP.md`, `docs/SECURITY_AND_CONTINUITY.md`, `docs/STATUS.md`, `docs/TESTING.md`. In the follow-up governance change that added this record — all of the above plus `AGENTS.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/ENVIRONMENT.md`, and `docs/credentials-setup.md`.

`docs/ARCHITECTURE.md` should have been in the first list and was not: PR #36 changed worker readiness semantics, the claim path, and runtime ownership while leaving the document that describes them untouched, which left it contradicting three other runbooks. That miss is what the roadmap-continuity and reread rules now exist to prevent.

### Phase 0B.0 — content evidence and agent registry foundation

**State:** `MERGED` · **`DEPLOYED`** — API, worker, and scheduler all live at the target with migration 006 applied 2026-08-28 (independently verified 2026-08-28 by a separate final-inspection session with Render and read-only PostgreSQL access).

**Merge:** PR #40, merged 2026-08-27 as `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`, base `a6a4316…`, reviewed head `4891bf3…`. Merged by the repository owner after all five CI jobs passed on the exact head.

**Carried a security fix from independent inspection.** Commit `4891bf3` made the `/console/*` gate drain and close an unread request body on auth or rate-limit failure, matching what `/triggers` already did. Without it, a rejected body-bearing request left declared-but-unsent bytes on a keep-alive connection, so a pipelined follow-up could be consumed as the first request's remainder. That gate also fronts the already-live `/console/state` and `/console/stream`, so the fix closes an exposure present in production until this release ships.

**Delivered:** the typed evidence contract with eight kinds and per-kind validation; `state/migrations/006_content_evidence.sql` with `content_evidence` and `content_evidence_relations`; a deterministic, provenance-preserving adapter from `config/approved-facts.json`; an idempotent operator-only sync command; the evidence pack builder that surfaces conflicts and stale evidence without resolving them; `AgentRegistry` with all six target stages registered and allowlist-rooted asset loading; `ContentIntelligenceContext`; and a deterministic, inert preview endpoint.

**Schema / migrations:** migration **006**, integration-tested against disposable PostgreSQL 16 and 18 and **applied to production on 2026-08-28 at `15:24:18Z`**, exactly once, by the API pre-deploy runner. Its rollout was a separately authorized migration-bearing release under the existing discipline: exactly one migration authority, and no schema-dependent consumer racing it. The runbook is [ROLLOUT_PHASE_0B0.md](ROLLOUT_PHASE_0B0.md) — executed to completion with all three services at the target, and with one documented, authorization-governed variance at step 13: exactly one production preview call was made, as authorized, and the deterministic-equality check was satisfied by the existing automated fixed-input test rather than by a second production call.

**Rollout safety, independently established 2026-08-28.** Migration 006 creates 34 catalog objects — 2 tables, 10 indexes (2 of them primary-key-backed), 16 CHECK constraints, 3 foreign keys, 2 primary-key constraints, 1 trigger — and is purely additive; applied inside a transaction it took **zero locks** on any pre-existing table and completed in about **50 ms**. Old `a6a4316…` code was built and **tested** against a runner-migrated `001–006` database: its durable startup probe, console snapshot, and event read all succeeded. Rolling application code back while leaving 006 applied is therefore a proven-safe recovery, and no destructive down migration should be written.

**Rollout outcome — operator-performed 2026-08-28; current-state results later independently reverified.** The operator deployed the API and applied migration 006 exactly once at `15:24:18.56508Z` in about 53 ms, with both evidence tables empty and zero active briefs and approvals. The rollout then stopped at step 6 under S8/S18 because the runbook stated 9 indexes where the catalog reports 10 — the two primary-key-backed indexes being separate catalog objects from the two primary-key constraints. **The schema was correct; the document was wrong**, and stopping on an inventory discrepancy rather than proceeding is exactly what those stop conditions exist to produce. §2 was corrected, independently inspected, and the operator resumed the rollout at the worker deployment under fresh authorization: the worker acquired exclusive ownership and clean readiness on two separate deploys (58,142 ms, then 60,094 ms on an authorized same-SHA handoff proof), the scheduler deployed with its cron unchanged and un-triggered, and a single authenticated preview call left all database row counts unchanged. **A separate final-inspection session later independently reverified the resulting current state** — all three services reporting `44d7336…`, migration 006 applied exactly once, and the unchanged row counts — on 2026-08-28; migration 006 must not be rerun. See [ROLLOUT_PHASE_0B0.md §0](ROLLOUT_PHASE_0B0.md) for the full record.

**Material design decisions:** epistemic class is a database constraint, not a convention; conflicts are reported and never auto-resolved; the approved-facts adapter is a projection rather than a second source of truth, so the JSON stays authoritative until a later reviewed cutover; and registration is deliberately separated from execution.

**Material rejected alternative — resolving conflicts by confidence or recency.** Rejected because it is precisely how a content engine starts asserting things nobody verified. A human resolves a conflict by authoring an explicit supersession, which stays auditable.

**Automated validation:** 362 offline assertions across eight suites; PostgreSQL 16 and 18 integration at 154 checks each, including database-level rejection of malformed evidence and proof that repeating the sync changes nothing; bound HTTP end-to-end at 64 assertions, including that the preview creates no approval and enqueues no brief. These are the counts as validated at PR #40's merge; the corrective delta that followed (`4891bf3`) added four more HTTP e2e assertions — see [Testing](TESTING.md).

**Production evidence — independently verified 2026-08-28** by a separate final-inspection session with Render and read-only PostgreSQL access: all three application services deployed at the target; migration 006 applied to the shared database exactly once; both evidence tables empty; every database row count unchanged (71 briefs, 62 approvals, 168 media, 0 evidence, 0 relations). The exact number and execution of production preview calls — that exactly one was made, returning the six-stage plan with execution disabled, `assetsVerified=true`, and no invariant violations — the ~53 ms migration duration, and that the API pre-deploy runner performed the application are **operator-reported**, not independently re-derived; the step-13 two-call comparison was satisfied instead by the existing automated fixed-input test. See [ROLLOUT_PHASE_0B0.md §0](ROLLOUT_PHASE_0B0.md).

**Accepted limitations:** the six stages are registered but not executed; the live publishing pipeline still cites `config/approved-facts.json` directly and is unchanged by this work; and no performance evidence exists yet, so the empirical half of "research is the prior, performance is the posterior" is still unpopulated.

## Resolved production incident — media publication normalization

**State:** `MERGED` in PR #38 · `DEPLOYED` · `PRODUCTION-VALIDATED`. **The incident is closed.**

**Production evidence — operator-reported 2026-08-27**, recorded as reported and not independently verified in this session: a controlled brief ran the full content path, the provider returned a PNG at 896x1120, normalization scaled it uniformly to a 1080x1350 JPEG, image QC passed, and the brief reached a real human approval. Nothing was published automatically. That is the exact failure path from 2026-08-25 executing correctly end to end.

**Symptom.** From 2026-08-25, scheduled briefs stopped reaching human approval. Slack reported `Content generation failed before an approval was created` and `image dimensions 1024x1024 are not an approved cross-platform feed profile`. The Land Rover brief and BMW brief `19811e5f-8899-4134-9634-3dd9a9a90827` both escalated. Because the image agent routes essentially every branded post to `text-graphic`, this blocked normal scheduled posting outright.

**Root cause.** The exact publication-profile allowlist was asserted against the **raw provider download**, not against the artifact this application produces. Image providers guarantee composition, not exact publication pixels, and no resize existed anywhere in `src/`, so any provider-native size was fatal. The request shape dated from 2026-06-24; the allowlist arrived on 2026-08-24 with Phase 0A, and the next scheduled briefs failed. Phase 0A behaved correctly — it exposed a latent mismatch rather than causing one.

**Provider evidence (one authorized live diagnostic, 2026-08-27).** A single `fal-ai/ideogram/v3` call requesting `image_size: {width: 1024, height: 1280}` returned HTTP 200 with `images[0]` carrying only `url`, `content_type`, `file_name`, `file_size` — **no width or height** — with `content_type: image/png` despite `output_format: "jpeg"`, and downloaded bytes of **896x1120**, exactly 4:5. Requested pixels were not honored; the requested **aspect** was. Production had requested 1080x1350 and received 1024x1024 (1:1), so the requested value decides whether the composition survives at all.

**Fix.** Separate decode safety from publication policy; request a provider-friendly source size per profile; normalize by **pure uniform scale only** to the exact reviewed profile before QC, hashing, hosting, and approval. Cropping and padding are refused, not unimplemented — cropping 1:1 into 4:5 would cut 20% of the frame through the headline.

**Explicitly not done:** no provider size was added to the allowlist, and the durable publication guard is unchanged in strength.

**Accepted limitation:** only the 4:5 source mapping is proven against the live provider. The other three are exact by arithmetic and fail closed if the provider composes something else.

## Current cursor — Phase 0D.1

Phase 0D.1 is the deployment-authority cutover. It is **paused, deliberately, between authorities**, and PR #36 changed what the next safe step is.

The ownership bootstrap is **complete** (operator-reported 2026-08-27): the protected worker is live and its handoff behaviour was proven under real zero-downtime overlap. That unblocks the remaining cutover steps, which were always gated behind it.

**This is an operational follow-up and is not a blocker to Phase 0B product work.** Phase 0B.0 shipped without touching deployment authority, and later Phase 0B slices can do the same. The remaining proof is worth doing on its own schedule, not ahead of the product.

Each step below requires its own explicit authorization. None of them is authorized by this document.

1. **PR #36 merged with exact-head CI green — COMPLETE.**
2. **Read-only production reverification — COMPLETE** (operator, 2026-08-27). Confirm current `main`, all three live SHAs, all three Render native auto-deploy settings off, the GitHub gate `false`, the GitHub `production` environment configuration, and no deployment or migration in flight. Stop on any discrepancy.
3. **Reconcile the August 10 incident against provider account history — COMPLETE.** Checked on Instagram, Facebook, and GBP; the target post was not found on any destination. Check Instagram, Facebook, and Google Business Profile directly for the 2026-08-11 Mini Cooper check-engine content before any production row is mutated. Public search was inconclusive and is not sufficient evidence.
4. **Stale `running` row resolved — COMPLETE**, by startup recovery with `providerMutation = impossible`. Original wording: (`c5e53afe-2657-4e11-811d-53ce5e793245`), so the reconciler's first firing is not performing an unexplained production mutation as a side effect of a deployment.
5. **Manual bootstrap release — COMPLETE.** Original wording:, with native auto-deploy still off and `RENDER_DEPLOY_AUTOMATION_ENABLED` still `false`. Preflight requires zero `running` briefs and **zero pending approvals** — approvals created before this change carry no `brief:approval_requested` marker, so the startup orphan sweep would revoke them on first boot. Draining them first makes that sweep a no-op rather than a surprise.
6. **Bootstrap verified at its exact SHA — COMPLETE.** Original wording: API deployed and exact health identity confirmed; worker ownership acquisition, reconciliation, and readiness observed; scheduler artifact confirmed; all three services reporting the bootstrap SHA.
7. **Worker handoff and contention proof — COMPLETE**, new instance waited ~58s for ownership before readiness. Original wording: performed once both the old and new worker versions contain ownership code: observe the new instance waiting, the old instance shutting down, ownership transferring only afterwards, and readiness appearing only after that.
8. **Now eligible, not yet done:** enabling `RENDER_DEPLOY_AUTOMATION_ENABLED`. Requires its own authorization and immediate re-verification.
9. **Then prove the GitHub controller path** — the already-current/no-deploy route first if possible, then one harmless migration-free real release. Note that migration 006 makes the next Phase 0B release migration-bearing, so it must go through the separately authorized migration rollout rather than the ordinary controller path.

Never re-enable Render native auto-deploy while the GitHub gate is true. Do not combine this cutover with database networking work or with Phase 0B. `IMPLEMENTED`, `MERGED`, `CONFIGURED`, `ENABLED`, `DEPLOYED`, and `PRODUCTION-VALIDATED` remain distinct milestones throughout.

## Next hardening

Keep these changes separable unless a reviewed design shows they must be atomic.

1. **Durable provider operation ledger and idempotency.** Model at least `not_attempted`, `attempted`, `provider_accepted`, `result_unknown`, `published`, `reconciled`, and `failed_safely`. This is the highest-priority remaining item: PR #36's durable phase markers are deliberately its precursor, but they make an ambiguous provider outcome *visible*, not *impossible*. Provider-level `withRetry` can still reissue a request after an ambiguous network outcome, so duplicate publication remains possible.
2. **Provider reconciliation.** Reconcile internal intent and result records with provider-side post identities, and safely resolve unknown outcomes before another attempt is permitted.
3. **PostgreSQL network restriction.** Remove the `0.0.0.0/0` external allowlist — still in place, independently reverified 2026-08-28 — after confirming every required access path. Do not combine with the deployment cutover.
4. **Provider-token lifecycle.** Encrypt or relocate the plaintext default Instagram token and session state, define rotation/expiry/recovery, and review log and outcome redaction.
5. **Control and approval identity.** Replace the shared `CONSOLE_TOKEN`, process-local direct-socket limits, generic reviewer label, and the bearer token in browser/Slack URL history with scoped authenticated identities and a safer review/revocation flow.
6. **Retention, backup, and restore.** Set retention for briefs, approvals, events, sessions, scorecards, proposals, and media; design the reviewed forward migration needed for media deletion; verify backup policy and conduct an isolated restore drill with external-side-effect reconciliation.
7. **External readiness register.** Verify provider account ownership, scopes, app review, versions, quotas, billing, test assets, recovery contacts, and the accuracy and freshness of approved business facts.

The former worker lease/reaper item is `SUPERSEDED` and is no longer active work. Its rationale and re-entry condition are preserved in the PR #36 record above.

## Legacy agent model migration — current-generation ids and explicit thinking — `MERGED`

**State:** `MERGED` on merge. **Not `DEPLOYED` and not `PRODUCTION-VALIDATED`.** The running worker
stays at artifact **R** (`44d7336f2c75ff880cff0d8205d2fafe13eb91b5`) until a separately authorized
release. This change is repository state only; it authorizes no release, and a time-bounded
partial-release interval prohibits any release of any service until **2026-09-24T18:52Z**. No
production state was verified or changed, and [Status](STATUS.md)'s production tables are untouched.

**PR / merge:** PR #76, base `c1c004e5d5524cb5b0dfe0407fd9694bd35244a8` (PR #75 merge), merge
`b3805ce0f19d0e6d78c41d99d83c48a74ae945c6`, whose ordered parents are
`9392b9e9bc1d38cde004ffc511521971063888d2` then the reviewed head
`dcddfd26a7e931d7d0444934b6691ab51ddcc1df`, verified by direct Git inspection. **The blocking
follow-up this record opened under the mutable-identifier exception in
[`AGENTS.md`](../AGENTS.md) is hereby closed.** These are historical, immutable identifiers; they
say nothing about deployment, and the state above is unchanged.

**Why this is roadmap state.** `src/worker/index.ts` imports `runBrief` from
`src/harness/orchestrator.ts`, whose `loadAgent()` parses `model:` out of each agent's frontmatter
with `/^model:\s*(.+)\s*$/m` and passes it to `runAgent`. These ids are therefore what the deployed
worker sends, not documentation.

**Delivered scope.**

- Six legacy agent pins moved to current-generation ids: `analytics`, `platform-formatter`, and
  `posting` from `claude-haiku-4-5-20251001` to the canonical **`claude-haiku-4-5`**; `copywriter`,
  `hashtag-seo-timing`, and `image` from `claude-sonnet-4-6` to **`claude-sonnet-5`**. The
  `model: <id>` frontmatter shape is preserved exactly, because that regex is load-bearing.
- The image QC vision inspector in `src/harness/imageQc.ts` moved to `claude-sonnet-5`, with
  `thinking: { type: "disabled" }` passed explicitly at the call site.
- `resolveLegacyThinking()` added to `src/harness/sdk.ts` and applied in **both** legacy request
  builders — `buildRequest()` (text) and `runVision()` (image QC), which builds its own request and
  would otherwise have had no way to be pinned at all.
- `PRICE` gained a `claude-haiku-4-5` row; `legacyModelPriceUsdPerMTok()` exported so a regression
  can prove every id this module can send is metered.

**Migrations/schema impact:** **none.** No SQL, no migration, no database read or write.

**Material design decisions.**

1. **Thinking is pinned, not inherited.** Omitting the `thinking` parameter runs **adaptive
   thinking** on `claude-sonnet-5`, where `claude-sonnet-4-6` ran none. The legacy path is
   non-streaming, defaults to `max_tokens: 3000`, and times out at 90 seconds; `max_tokens` bounds
   thinking tokens and visible text together, and `collect()` accumulates only `text` blocks. A
   silently thinking legacy request would therefore spend part of a small ceiling on tokens no
   caller reads, and `parseAgentJson()` degrades a truncated reply to `{_raw: ...}` rather than
   throwing — a quiet, downstream failure on a live path. Every moved agent returns strict JSON and
   is given no tools, so none depends on thinking.
2. **The rule lives in `sdk.ts`, not at each call site.** A model-id change alone can no longer
   change request semantics, and any future legacy caller inherits the protection. An explicit
   caller value always wins, so Content Intelligence stages — which set their own disabled policy
   through `modelPolicy.ts` — are byte-for-byte unaffected.
3. **Models that do not think by omission still send no `thinking` key.** The Haiku move is
   therefore behaviour-neutral: same model, canonical unsuffixed id, identical published rate,
   identical wire request.
4. **`claude-opus-5` is deliberately excluded from the omission set**, though it also thinks by
   omission. Only the dormant `agentLoop.ts` manager sends it through this path, and that path is
   owned separately (PR #75) with the consequence recorded as deliberately open under
   `MANAGER_MODEL` in [Environment](ENVIRONMENT.md). Including it would have closed that open
   decision from outside its scope.
5. **Both `opts.model || ...` fallbacks stay at `claude-sonnet-4-6`.** See rejected alternatives.

**Material rejected alternatives.**

- **Letting adaptive thinking run and raising `max_tokens`/the timeout.** Rejected because no
  evidence supports a new ceiling. Choosing one would have been a guess on a live path, and this
  change makes no live model call by which to measure one. Recorded as an open follow-up below.
- **Moving the `sdk.ts` fallbacks to `claude-sonnet-5`.** Rejected for this change. The fallback is
  the "no model pinned" path, and `agents/brand-compliance-critic.md` still pins
  `claude-sonnet-4-6`, so the fallback continues to match a live pin rather than naming a model
  nothing uses. Moving it would also have made the least-controlled path — an undeclared model
  under a 3000-token ceiling — the one newly running adaptive thinking. It belongs to the change
  that routes that agent.
- **Routing `agents/brand-compliance-critic.md` in this change.** Rejected deliberately. It is the
  independent evaluator feeding the Phase-A approval path, and [`AGENTS.md`](../AGENTS.md) forbids
  weakening that gate as an incidental change. It stays on `claude-sonnet-4-6` and is routed
  separately; a regression pins its request as byte-identical.
- **Adding an injectable message-creator seam to `runVision`.** Rejected as incidental surface on a
  safety-critical path that already carries an explicit anti-injection guard. See the accepted
  limitation below.

**Automated validation.** `typecheck`, `build`, `test:offline` (eight suites), `dryrun` (simulated,
never `dryrun:live`), `test:deployment-controller`, `check:markdown-links`, `check:env-coverage`,
`scan:sensitive`, `npm audit`, and `git diff --check` all pass. Eleven new offline assertions
(`MR1`–`MR7` in `src/harness/orchestrator.selftest.ts`) inspect the exact SDK request through the
`runAgentWithMessageCreator` seam — no credential, no provider call — and pin, per moved surface,
the exact model id and the exact thinking configuration on the wire, plus the critic's unchanged
request, the absence of any dated or previous-generation pin, and a price row for every introduced
id. Orchestrator suite checks rise 108 → 119; combined `PASS` lines 1,261 → 1,272; eight-suite
total 1,374 → 1,385. **No live model call was made.**

**Production evidence:** **none, and none was sought.** Nothing here has executed against a
provider.

**Rollback/recovery:** revert the commit. There is no schema, configuration, external identifier, or
durable state to unwind, and the running worker is unaffected until a separately authorized release.

**Security and privacy implications:** none identified. No credential, token, endpoint, prompt text,
or data-flow boundary changed. The image QC gate keeps its fail-closed contract and its production
rejection of injected inspector runners; pinning thinking off protects the visible-output budget
that gate's strict-JSON contract depends on.

**Accepted limitations.**

- `runVision` has no injectable message-creator seam, so its wire request cannot be inspected
  offline the way the text path's can. The vision assertions instead pin the options `imageQc`
  passes (`MR5`) and `resolveLegacyThinking` itself (`MR6`), which is the exact value `runVision`
  spreads — three lines a reviewer can check by reading. This is weaker than byte inspection.
- Model behaviour under the new ids is not measured. `claude-sonnet-5` uses a new tokenizer
  (~30% more tokens for the same text than `claude-sonnet-4-6`) and follows instructions more
  literally; neither effect is observable without a live run.

**Unresolved follow-ups.**

1. **Blocking:** reconcile this entry's PR number and merge SHA after merge.
2. Route `agents/brand-compliance-critic.md`, and decide the two `sdk.ts` fallbacks with it.
3. Re-baseline `max_tokens: 3000` against the `claude-sonnet-5` tokenizer before any change that
   would enable thinking on this path, and measure before choosing a ceiling.
4. Re-validate copy quality on `claude-sonnet-5` when a live run is authorized — literal
   instruction-following may land holdover style directives in `agents/copywriter.md` differently.

**Documents updated at completion:** [`agents/README.md`](../agents/README.md),
[`skills/model-routing/SKILL.md`](../skills/model-routing/SKILL.md),
[Architecture](ARCHITECTURE.md), [Environment](ENVIRONMENT.md), [Testing](TESTING.md), and this
file. [Status](STATUS.md) is deliberately untouched — this change verifies no production state.

## Stage-prompt contract limits — prompts now state the ceilings their validators enforce — `MERGED`

**State:** `MERGED` and present on `main`. **Not `DEPLOYED`, not `ENABLED`,
not `PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false` and no production path
reaches any of them, so this changes repository state only. It authorizes no release, and the
time-bounded partial-release interval prohibits any release of any service until
**2026-09-24T18:52Z**. No production state was verified or changed, and [Status](STATUS.md)'s
production tables and the M1→M2 interval record are untouched.

**PR / merge:** PR #78, base `b3805ce0f19d0e6d78c41d99d83c48a74ae945c6` (PR #76 merge), reviewed
head `b21dd674777b57784c5492c1f71d1c8500c38e86`, merge
`23fc1fcb91cfc5455be022308a4c8849b30636d2`, whose ordered parents are the recorded base first and
the exact reviewed head second, verified by direct Git inspection. All five CI jobs passed on the
reviewed head. **The blocking follow-up this record opened under the mutable-identifier exception
in [`AGENTS.md`](../AGENTS.md) is hereby closed.** These are historical, immutable identifiers;
they say nothing about deployment, and the state above is otherwise unchanged.

**Live outcome, recorded because it revises this record's own open question.** The follow-up below
asked whether stating the ceiling is sufficient against the operator's real 42-fact pack. Two
authorized live runs on 2026-09-21 answered the id half: **stage 1 cited within
`STRATEGY_LIMITS.maxIds` on a 42-fact pack**, the harder case than the 22-fact pack that first
failed. The reported defect is therefore fixed in practice, not only in prompt text. Both runs then
failed at a *different* ceiling — `"concept" exceeds 1200 characters` — which is the residual this
record's own accepted limitations named: stating a ceiling does not guarantee a model respects it.
That failure is carried forward in the section below; it is not a regression of this change.

**The defect, and how it was found.** A live evaluation run on **2026-09-21**, over an evidence pack
of 22 facts, failed at stage 1 with:

```
StageExecutionError: stage strategy-concept: "supportingFactIds" exceeds 12 entries
```

The validator was correct: `requireIdArray` in `src/harness/agents/strategyConcept.ts` enforces
`STRATEGY_LIMITS.maxIds` (12) on each of the three id channels. The prompt was wrong —
`agents/strategy-concept.md` named **no ceiling anywhere**, so the model had no way to know one
existed and cited more ids than the contract allows.

**What that cost, and why it is not merely cosmetic.** `src/harness/agents/stageExecution.ts` makes
**exactly one provider request with no retry and no repair pass** — a deliberate property, recorded
in its own header and asserted by the offline suite. Validation runs *after* the call returns.
So the rejection **discarded a completed, paid-for Opus 5 response in full**: the run paid for the
tokens and kept nothing. This is the specific, recurring cost of the omission, and it grows with the
evidence pack — the operator's real pack is **42 facts**, so a stage-1 answer that cites what the
pack offers is now considerably more likely to cross a 12-id ceiling than the 22-fact pack that
already crossed it.

**Scope, established before changing anything.** `maxIds` was not the only case. Auditing all six
stage prompts against `STRATEGY_LIMITS`, `TRUTH_FIELD_LIMITS`, `SCRIPT_FIELD_LIMITS`,
`DIRECTION_FIELD_LIMITS`, `PACKAGING_FIELD_LIMITS`, `CRITIC_FIELD_LIMITS` and
`PLATFORM_PACKAGING_POLICY` found **52 validator-enforced output limits that no prompt stated**:
8 in `strategy-concept`, 9 in `automotive-truth`, 8 in `hook-story-script`, 14 in
`production-direction`, 7 in `packaging-adaptation`, and 6 in `final-critic`. Only stage 5 stated
any limit at all, and even there Facebook's caption ceiling was one of the seven: the prompt said “tighter
caption” while the validator applies `Math.min(63,206 provider limit, 2,200 pipeline narrowing)`
— 2,200, about a twenty-eighth of what the prompt implied. The six inter-stage handoff guards
(`evidencePackChars`, `strategyOutputChars`, `truthOutputChars`, `scriptOutputChars`,
`directionOutputChars`, `packagingOutputChars`) and `maxRequestedPlatforms` are deliberately
excluded: they bound **inputs** a stage is handed, not anything a model chooses.

**Delivered.** Each of the six prompts in `agents/` now states, in its own voice and format, the
limits its own validator enforces — once beside the output schema where the model acts, and once as
a **Size ceilings the validator enforces** block inside the existing rules list. Stage 5's
per-platform caption and hashtag ceilings are stated at the **effective** number the validator
applies, not the raw provider policy. Every ceiling is framed as a ceiling and not a target
(“cite what genuinely supports the angle, and never more than N”), and each prompt says plainly
that the rejection is final because there is no retry and no repair pass.

**Migrations / schema impact:** none.

**Design decision — the prompt was changed, never a limit.** No value in
`src/harness/agents/payloadContract.ts` moved. The numbers there are derived from measured shape
witnesses and are load-bearing for every downstream ceiling, so raising one to accommodate a model's
behaviour would silently widen every derivation built on it. Nothing observed in this work suggests
any value is genuinely too low: 12 ids per channel, 12 permitted claims, and 20 findings are all
generous for a single piece of short-form content, and a run that wants more of them is usually a
run that should have chosen. If a value ever does need to change, it changes in `payloadContract.ts`
under its own derivation review, and the new offline assertions will then require the prompt to move
with it.

**Rejected alternatives.**

- *Add a retry or a repair pass so an over-cap answer can be corrected.* Rejected. The single-request
  guarantee is an explicit safety property, not an oversight: a silent retry turns one budgeted
  decision into unbounded spend, and a repair pass is a second chance for a model to argue itself
  into an unsupported claim. Both are asserted against in the offline suite.
- *Truncate an over-cap array in the validator instead of failing.* Rejected. Silently dropping
  citations changes which evidence the answer rests on, which is exactly the class of quiet
  corruption this pipeline's validators exist to prevent.
- *Hardcode the expected numbers in the new tests.* Rejected. That reproduces the defect one layer
  up: the test would pass while the prompt and the contract drifted apart. The assertions read the
  validators' own limit objects.

**Automated validation.** `src/harness/contentIntelligence.selftest.ts` gains the `CD0`–`CD8` group
(37 checks), keyed off `LIMITS`, `TRUTH_LIMITS`, `SCRIPT_LIMITS`, `DIRECTION_LIMITS`,
`PACKAGING_LIMITS`, `FINAL_CRITIC_LIMITS`, `PLATFORM_PACKAGING_POLICY` and `STRATEGY_ID_CHANNELS`.
It asserts per-field pairing inside each prompt's ceiling block, set-closure over every
`at most N <unit>` phrase in the file (which catches a number left behind after a limit moves),
ceiling-not-target framing, the finality of the rejection, stage 5's per-platform effective caption
and hashtag policy, and that the pre-existing “an empty array is honest” guidance survived in all
six prompts. `npm run test:offline` reports **ALL PASS** on all eight suites, 1,422 checks
(content-intelligence 1,013). The group was mutation-checked three ways: changing
`STRATEGY_LIMITS.maxIds` from 12 to 13 fails `CD2`/`CD3` — **and no other check in any suite** —
so without this group that edit would have desynchronised the prompt silently; editing a stated
number in a prompt fails `CD2`/`CD3`; deleting a ceiling line fails `CD2`. All three mutations were
reverted. The group is offline: it reads checked-in Markdown, makes no provider call, and needs no
credential.

**Production evidence:** none, and none is possible — no stage is enabled or reachable. The
2026-09-21 failure is **local evaluation evidence** from the out-of-band CLI, not production
evidence.

**Security and privacy implications.** None. Agent prompt text is executable input under
[`AGENTS.md`](../AGENTS.md), so this was treated as a code change and tested as one; the changes add
only size statements. No claim, tool, model id, thinking configuration, capability, approval rule,
autonomy boundary, or publishing instruction was touched, and the untrusted-data framing and
evidence-class rules in every prompt are unchanged.

**Accepted limitations.**

- Stating a ceiling does not guarantee a model respects it. This removes the case where the model
  could not have known; it does not remove the failure mode, and one rejection still ends the run.
- The offline assertions prove a prompt *states* each limit at the right value. They cannot prove the
  wording is persuasive, and they do not read the schema-block comments field by field — those are
  covered by set-closure (`CD3`) rather than by pairing.
- The `at most N <unit>` phrasing is now load-bearing for `CD2`/`CD3`. A future editor who rewords a
  ceiling into free prose will fail the suite; that is intentional, and the failure line names the
  field.

**Unresolved follow-ups.**

- ~~The PR number and merge SHA above (blocking follow-up, mutable-identifier exception).~~
  **Closed** in the section's `PR / merge` block above, reconciled in the first change after merge
  as [`AGENTS.md`](../AGENTS.md) requires.
- ~~A stage-1 run against the operator's real 42-fact pack has still not been made.~~ **Answered
  for the id channels** by two authorized live runs on 2026-09-21: stage 1 cited within `maxIds` on
  a 42-fact pack. The character ceilings were not sufficient in the same run, and that is carried
  forward in the section below.

**Documents updated at completion:** the root [README](../README.md),
[Architecture](ARCHITECTURE.md), [Testing](TESTING.md), and this file. [Status](STATUS.md) is deliberately untouched — this change verifies no production
state, and its production tables and the M1→M2 interval record are out of scope.

## Paid-call preconditions — no stage is bought before a free check can fail — `MERGED`

**State:** `MERGED` and present on `main`. **Not `DEPLOYED`, not `ENABLED`, not
`PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false` and no production path
reaches any of them, so this changes repository state and one operator-local CLI only. It
authorizes no release, and the time-bounded partial-release interval prohibits any release of any
service until **2026-09-24T18:52Z**. [Status](STATUS.md)'s production tables and the M1→M2 interval
record are untouched.

**PR / merge:** PR #79, base `23fc1fcb91cfc5455be022308a4c8849b30636d2` (PR #78 merge), reviewed
head `5b6c83efd0d8757d1cfe53105b6d9f26d60af8c8`, merge
`8407d71`, whose ordered parents are the recorded base first and the reviewed head second, verified
by direct Git inspection. **The blocking follow-up this record opened under the mutable-identifier
exception in [`AGENTS.md`](../AGENTS.md) is hereby closed.**

**The defect, and how it was found.** Three authorized live runs on 2026-09-21, from
`scripts/local/content-run.mjs`, each paid for a stage-1 Opus 5 call and kept nothing. Every one was
preventable for free, before the request, from information the run already had:

1. **The evidence pack was silently incomplete.** `config/automotive-facts.local.json` was absent,
   which the CLI reported as a `console.warn` and then continued past — into the cost gate, the
   operator's confirmation, and a billed call. The pack held 22 business facts and **zero**
   automotive facts. The operator confirmed spend for a 42-fact run and bought a 22-fact one.
2. **The run was doomed before it started.** `automotive-truth` declares
   `requiredEvidenceKinds: ["verified_automotive_fact", "verified_business_fact"]` statically in the
   registry, and the pack is fully built before stage 1. But `stageExecution.ts` checks that
   requirement **per stage, as each stage runs**, so a class only stage 2 needs is discovered after
   stage 1 has been paid for. With the facts file absent the run could never have reached stage 3,
   and everything needed to know that was available for free.
3. **The paid response was destroyed.** `writeStage` only runs after a stage validates, and the CLI's
   failure handler printed the error and exited. A response the operator had already paid for was
   never written to disk — not even for inspection or manual salvage.

A fourth, smaller defect compounded all three: `"concept" exceeds 1200 characters` reported the
bound but not the measurement, so the operator could not tell whether the model overran by fifty
characters or by two thousand — which is exactly the distinction between "nudge the prompt" and
"this ceiling is too low for the work".

**Delivered.**

- **A live run refuses an incomplete evidence pack.** The missing-facts warning becomes a fatal
  error under `--runner live`, raised **before** the cost estimate and before any runner is
  constructed. `--runner fake` still warns and proceeds, because inspecting a partial pack for free
  is the point of the fake runner.
- **All six stages' evidence classes are checked up front.** The CLI now iterates
  `TARGET_STAGE_IDS`, reads each stage's `requiredEvidenceKinds` from the registry, and fails before
  the cost gate if the pack cannot satisfy every stage. Same rule and same source of truth as
  `stageExecution.ts`; only the timing moved, and only in the CLI.
- **Raw provider responses are persisted on failure.** The CLI wraps its runner, records every
  response as it arrives, and on any failure writes them to `rejected-responses.json` beside the
  run. Nothing recorded is read back as stage output and no validation outcome changes — a rejected
  payload is still rejected, it is simply no longer incinerated.
- **Bounded-string rejections report the measurement.** All six stage validators now emit
  `"<field>" exceeds <max> characters (actual <n>)`.

**Migrations / schema impact:** none.

**Design decision — the harness contract was not touched.** `stageExecution.ts` keeps its per-stage
check, its single-request guarantee, and its no-retry, no-repair posture. The preflight is additive
and lives in the operator CLI, so it cannot weaken a boundary the dormant executors rely on. The
response capture is likewise a CLI-side runner wrapper rather than a change to
`StageExecutionError`, which carries no payload by design.

**Design decision — no limit value moved.** `payloadContract.ts` is unchanged. The `concept`
overrun is real evidence that `STRATEGY_LIMITS.conceptChars` may be too low for this goal shape, but
the overrun was never measured, because the error did not report it. Measuring it is what this
change enables; changing the number is a separate decision under its own derivation review, and is
**not** taken here.

**Rejected alternatives.**

- *Add a retry or repair pass so an over-cap answer can be corrected.* Rejected, for the reasons
  PR #78 already recorded: the single-request guarantee is a safety property, a silent retry turns
  one budgeted decision into unbounded spend, and a repair pass is a second chance for a model to
  argue itself into an unsupported claim.
- *Raise `conceptChars` so the observed response fits.* Rejected as premature. Sizing a derived,
  load-bearing bound to one unmeasured overrun is how a contract stops meaning anything.
- *Move the per-stage evidence check out of `stageExecution.ts` into the pack builder.* Rejected.
  The per-stage check is the boundary's own guarantee and must hold for any caller; the CLI's
  preflight is an additional courtesy to the operator, not a replacement.

**Automated validation.** `AB2b` asserts behaviorally that an over-limit string reports its actual
length, keyed off `LIMITS.conceptChars` rather than a literal. The `CE1`–`CE5` group asserts the CLI
wires the three preconditions and that the two free checks precede the cost gate — index order plus
presence, since `indexOf` returns `-1` for a deleted marker and `-1` sorts before every real index.
`CE3` drives the preflight assertion off `TARGET_STAGE_IDS`, so a seventh stage cannot be added
without being covered. `npm run test:offline` reports **ALL PASS** on all eight suites, 1,428 checks
(content-intelligence 1,019). Mutation-checked: removing the live refusal fails `CE1` and `CE4`;
both were reverted. Every assertion is offline — no provider call, no credential, no network.

**Production evidence:** none, and none is possible — no stage is enabled or reachable. The
2026-09-21 runs are **local evaluation evidence** from the out-of-band CLI, not production evidence.

**Security and privacy implications.** One consideration, stated plainly:
`rejected-responses.json` contains raw model output, written under `local-output/`, which is
gitignored and operator-local. It is model prose about the operator's own evidence pack, not
credentials and not customer data, and it is written only on the operator's own machine by a
manually invoked CLI. No claim, tool, model id, thinking configuration, capability, approval rule,
autonomy boundary, or publishing instruction was touched.

**Accepted limitations.**

- The `CE` group reads the CLI's checked-in source rather than executing it. The script is an
  executable `.mjs` that loads from `dist/` at runtime and is not importable by the suite, so this
  follows the same static-wiring precedent as the worker boundary assertions. The three behaviors
  were additionally verified by hand against the real CLI.
- The preflight proves a pack *can* satisfy every stage's declared evidence classes. It cannot
  prove a stage will succeed; a validation ceiling can still reject a paid response, which is the
  failure that remains open below.
- `scripts/local/content-run.mjs` was, and to a large extent remains, **undocumented** outside this
  record — it appears in no README, Architecture or Testing prose. That gap predates this change;
  this record and the new Architecture paragraph narrow it but do not close it.

**Unresolved follow-ups.**

- ~~The PR number and merge SHA above (blocking follow-up, mutable-identifier exception).~~
  **Closed**: the PR / merge line above records PR #79 and merge `8407d71`. This bullet was left
  unstruck when that line was filled in; corrected here.
- **`"concept" exceeds 1200 characters` is unresolved, and this record's own reading of it was
  wrong.** It said two identical failures made the overrun "reproducible and not sampling variance".
  A third authorized live run on 2026-09-21 passed stage 1, which refutes that: the behaviour is
  variance around a boundary, not a deterministic overrun. The measurement that run produced says
  why — **`concept` came back at 1,196 characters against a 1,200 ceiling**, four characters clear.
  The model is not disregarding the stated ceiling; it is writing *to* it, which is what the
  prompt's own "a ceiling is not a quota" guidance exists to prevent and evidently does not. So the
  open question is no longer "how far over does it go" but whether `conceptChars` is sized for this
  goal shape at all, and whether an anti-target instruction can work when the number is stated.
  **No value should be changed before that is decided on its own terms.**
- Whether the six stage prompts should state ceilings more forcefully than they now do — for
  instance beside the field rather than only in a ceilings block — is open, and depends on the same
  measurement.

**Documents updated at completion:** [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), and
this file. [Status](STATUS.md) is deliberately untouched — this change verifies no production state.

## Stage response format — the provider is constrained to the shape, not asked for it — `MERGED`

**State:** `MERGED`. **Not `DEPLOYED`, not `ENABLED`, not
`PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false` and no production path
reaches any of them. It authorizes no release, and the time-bounded partial-release interval
prohibits any release of any service until **2026-09-24T18:52Z**. [Status](STATUS.md)'s production
tables and the M1→M2 interval record are untouched.

**PR / merge:** PR #80, base `8407d71d688193165aa56f87b91a97b5a83dd32a` (PR #79 merge), reviewed
head `d1cea69f09147ca950d4a575b19560e8ad5c1b27`, merge
`45e2e614fbf09ce2a0576d7ac490dbacf732df2c`, whose ordered parents are exactly
`8407d71d688193165aa56f87b91a97b5a83dd32a` then `d1cea69f09147ca950d4a575b19560e8ad5c1b27` —
verified by direct Git inspection (`git rev-list --parents -n 1 45e2e61`), not read from the pull
request. **The blocking follow-up this record opened under the mutable-identifier exception in
[`AGENTS.md`](../AGENTS.md) is hereby closed.** These are historical, immutable identifiers; they
say nothing about deployment, and the state above is unchanged.

**The defect.** An authorized live run on 2026-09-21 failed at stage 3 with
`output was not strict JSON`. The saved response — saved because PR #79 made that possible — opened
with ` ```json ` and closed with ` ``` `. The model had wrapped correct JSON in a markdown fence.

This is **not** the PR #78 defect class, and the distinction is the whole point of this change.
Every stage prompt already says, in these words, *"No prose before or after it, no markdown fence,
no commentary."* The instruction was present, explicit, and disregarded. Stages 1 and 2 (Opus 5)
returned bare JSON in the same run; stage 3 (Sonnet 5) did not. Adding more prompt text about
fences would have been writing a fourth copy of an instruction that already exists twice and did
not work.

**Delivered.** Each stage now sends a JSON Schema as `output_config.format`, so a non-JSON or
wrong-shaped response is impossible at generation time rather than forbidden in prose. Each schema
lives beside the validator that enforces it and is built from the same `ALLOWED_OUTPUT_FIELDS` array
that the validator's `requireExactKeys` reads, and from the same exported enums
(`HYPOTHESIS_BASES`, `CLAIM_CLASSES`, `STORY_BEAT_ROLES`, `SHOT_PURPOSES`, `CRITIC_VERDICTS` and the
rest). `responseFormatKit.ts` holds the builders and imports nothing.

**What this does not do, stated plainly.** Anthropic's structured outputs support `type`,
`properties`, `required`, `additionalProperties: false`, `enum`, `const`, `anyOf`/`allOf`, internal
`$ref` and string formats. They do **not** support `maxLength`, `minLength`, `maxItems` (beyond
`minItems` 0 or 1), `minimum`, `maximum` or `pattern`. **Every size ceiling is therefore untouched
by this change** and stays exactly where it was: stated in the prompt, enforced by the validator
after the response arrives. The schemas carry ceilings in `description` text only, as a third
instruction channel, and `CF3` fails the suite if any schema ever claims an unenforceable keyword —
because a schema that looks like a guarantee and is not one is the confusion that produced the
original defect.

**Migrations / schema impact:** none.

**Design decision — the schema lives beside its validator.** A central schema module would have to
import all six stage modules, which import `stageExecution.ts`, which needs the schemas: a cycle.
Worse, it would put the schema somewhere the `requireExactKeys` list is not, which is precisely how
the two drift. Beside the validator they are built from one constant and `CF1` proves they agree.

**Design decision — the field is `responseFormatSchema`, not `outputSchema`.** `registry.ts` already
has an `outputSchema` field and it is a **validator function**, not a JSON Schema. Two unrelated
things under one name in one directory is a defect waiting to be written; the wire concept is
`output_config.format`, so the field is named for it.

**Rejected alternatives.**

- *Strengthen the prompt again.* Rejected. The instruction is already explicit and was disregarded;
  a fourth statement of it is not a fix, it is a hope.
- *Prefill the assistant turn with `{`.* Rejected because it is unavailable: assistant prefill
  returns a 400 on Opus 5 and Sonnet 5 alike.
- *Strip fences in `parseStrictJsonObject`.* Rejected. That parser refuses fence-stripping and
  "find the first `{`" deliberately, and relaxing it would hide a model not following its contract
  — the opposite of what this pipeline's validators exist to do.
- *Put `maxLength` in the schemas anyway.* Rejected: unsupported, so it would read as enforcement
  while enforcing nothing. `CF3` now makes that unmergeable.

**Automated validation.** The `CF0`–`CF7` group (24 checks) asserts every stage declares a format;
that each schema's `required` set equals the validator's own field array (`CF1`); that every object
is closed with `additionalProperties: false` and `required` covering all properties, mirroring
`requireExactKeys` (`CF2`); that no schema claims an unenforceable keyword (`CF3`); that enums are
the validators' exported constants rather than restatements (`CF4`); that ceilings reach the
descriptions, keyed off the contract (`CF5`); that the SDK request really carries
`output_config.format` as a `json_schema` (`CF6`); and that a caller declaring no schema still sends
no `output_config`, so the legacy path is unchanged (`CF7`). `AF5b` records that
`responseFormatKit.ts` is a helper and not a seventh executor. `npm run test:offline` reports
**ALL PASS** on all eight suites, 1,452 checks (content-intelligence 1,043). Mutation-checked:
adding `maxLength` to a schema fails `CF3`; adding a field the validator does not accept fails
`CF1`; both reverted.

**Verified against real model output.** The three responses captured by PR #79 during the
2026-09-21 live runs — genuine Opus 5 and Sonnet 5 stage output — were validated against the new
schemas for stages 1, 2 and 3. All three are accepted, including the fenced stage-3 payload once
unwrapped. That is the evidence that the schemas are not over-strict, and it is the closest this
change can get to proof without a live call.

**Production evidence:** none, and none is possible — no stage is enabled or reachable.

**Security and privacy implications.** None. No claim, tool, model id, thinking configuration,
capability, approval rule, autonomy boundary, or publishing instruction was touched. Thinking is
already `disabled` at the stage boundary via `modelPolicy.ts`, so no interaction between structured
outputs and thinking arises here.

**Accepted limitations.**

- **Not verified against the live API** *at the time of this record*. No live call was made from
  that session, so that the provider accepts these exact schemas and honours them was
  **unverified**. Everything asserted here is offline: the request bytes, the schema/validator
  agreement, and acceptance of previously captured real responses. The first authorized live run is
  what confirms it — **and it has since run; see the follow-up below, which is now closed for
  stage 1 only.**
- The schemas constrain shape only. A response can be perfectly shaped and still exceed a character
  ceiling, and that is still a discarded paid call.
- `CF2` requires every object to be closed. A stage that legitimately needed an open object would
  have to change this assertion deliberately, which is intended.

**Unresolved follow-ups — all three closed by the `conceptChars` change recorded immediately
below, which is the first change after this merge.**

- ~~The PR number and merge SHA above (blocking follow-up, mutable-identifier exception).~~
  **Closed** in the **PR / merge** line above, by direct Git inspection of the ordered parents.

- ~~Whether the provider accepts and honours these schemas — needs one authorized live run.~~
  **Closed for what one run can close, and no further.** An authorized live run on
  **2026-09-21 at `20:25:34Z`, against reviewed head `d1cea69`**, established two things:

  1. **The provider accepted the schemas.** No `400`, no complaint about `output_config`. The
     request was served and billed. The `output_config.format` shape this change introduced is
     therefore valid on the wire, not merely valid against the documentation.
  2. **Structured outputs worked.** The run failed at
     `StageExecutionError: stage strategy-concept: "concept" exceeds 1200 characters (actual
     1259)`. That is a **validator** error, and stage 1's validator runs only *after*
     `parseStrictJsonObject` has already succeeded. So the response was strict, unfenced JSON:
     exactly the defect this change existed to make impossible, made impossible. No markdown
     fence, no prose, no repair.

  **What it does not prove, stated as plainly.** Nothing whatsoever about stages 2 through 6. The
  run failed inside stage 1 and **never reached them**, so their five schemas remain exactly as
  unverified against the live provider as they were at this merge. It also proves nothing about
  whether the provider *honours* a schema under adversarial or unusual input — one accepted,
  well-shaped response is one data point, not a guarantee. The offline `CF0`–`CF7` evidence is
  unchanged and is still the reason to believe the other five are correct.

- ~~`STRATEGY_LIMITS.conceptChars` at 1,200, measured at 1,196 on a passing run.~~ **Resolved** by
  the change recorded immediately below: the figure the prompt states (1,200) and the ceiling the
  validator enforces (1,500) are now separate constants with a declared 1.25× minimum margin
  between them. The reasoning, and the rejected alternative of simply raising the number, are in
  that record.

**Documents updated at completion:** [Architecture](ARCHITECTURE.md), [Testing](TESTING.md), and
this file. [Status](STATUS.md) is deliberately untouched — this change verifies no production state.

## Stage 1 `concept` — the stated figure and the enforced ceiling are separated — `MERGED`

**State:** `MERGED`. **Not `DEPLOYED`, not `ENABLED`, not
`PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false` and no production path
reaches any of them. It authorizes no release, and the time-bounded partial-release interval
prohibits any release of any service until **2026-09-24T18:52Z**. [Status](STATUS.md)'s production
tables, live SHAs, M1→M2 interval record and cursor are untouched; the single clause it does change
is a derived repository constant inside the PR #54 merge record, and verifies no production state.

**PR / merge:** PR #81, base `45e2e614fbf09ce2a0576d7ac490dbacf732df2c` (PR #80 merge), reviewed
head `7d0d93f4a6cadfc9bba6d65c6f93ad6af066e515`, merge
`5e7e2f036e79192a8ebd05c702921988eee81088`, whose ordered parents are exactly
`45e2e614fbf09ce2a0576d7ac490dbacf732df2c` then `7d0d93f4a6cadfc9bba6d65c6f93ad6af066e515` —
verified by direct Git inspection (`git rev-list --parents -n 1 5e7e2f0`), not read from the pull
request. **The blocking follow-up this record opened under the mutable-identifier exception in
[`AGENTS.md`](../AGENTS.md) is hereby closed.** These are historical, immutable identifiers; they
say nothing about deployment, and the state above is unchanged.

**The defect — and it is a measurement, not an impression.** Two authorized live runs on
2026-09-21 measured stage 1's `concept` field against a ceiling that was both stated in the prompt
and enforced by the validator at 1,200 characters:

| Run | `concept` length | `conceptChars` | Result |
|---|---|---|---|
| earlier 2026-09-21 | 1,196 | 1,200 | passed, by four characters |
| 2026-09-21T20:25:34Z | 1,259 | 1,200 | failed, by fifty-nine |

99.7% and 104.9% of the stated number. The model is **not disregarding the ceiling — it is aiming
at it**, and landing within roughly ±5%. The prompt's `**A ceiling is not a quota.**` guidance,
which exists precisely to prevent this, does not prevent it; nor does the schema `description`,
which is a third statement of the same thing.

**Delivered.** The figure the prompt states is now a separate constant from the ceiling the
validator enforces.

- `STATED_FIELD_CEILINGS` in `payloadContract.ts` declares, per field, a stated figure lower than
  the enforced limit. Keys are `<stage id>.<field token>` — exactly the tokens the `CD2`/`CD3`
  drift assertions already pair against — so a second field joins by adding one entry and nothing
  else. `statedCeiling(key, enforced)` returns the declared figure or falls back to the enforced
  value, so every field that declares nothing is untouched by the mechanism.
- `CEILING_SLACK_MULTIPLIER` is **1.25**, and `CD0c` fails the suite if any enforced limit drops
  below `stated × 1.25`.
- `STRATEGY_LIMITS.conceptChars` moves **1,200 → 1,500**. Exactly 1.25× the stated figure, and the
  only limit value in `payloadContract.ts` this change touches.
- `agents/strategy-concept.md` is **unchanged**. It still says `at most 1,200 characters`, in those
  words, framed as a ceiling. The model should still aim at 1,200; the slack is deliberately
  something it is never told.
- Stage 1's response-schema `description` for `concept` now reads through `statedCeiling` rather
  than the raw limit, because a `description` is a model-facing channel like the prompt. Leaving it
  on the enforced value would have told the model 1,500 through one channel and 1,200 through
  another — and the larger number is the one it would have aimed at.

**Migrations / schema impact:** none.

**Material design decision — the slack is secret, and that is the whole mechanism.** A stated
figure the model can see is a target it will approach. A margin it cannot see is a boundary it will
not approach. Separating them is the only arrangement in which both properties hold at once: the
prompt keeps asking for roughly 1,200 characters of concept — which is a product decision about
how long a concept should be — while a response that lands at 1,259 is no longer thrown away.

**Material rejected alternative — simply raising `conceptChars` to a larger number.** Rejected on
the measurement, not on taste. The stated number *is* the aim point: 1,196 and 1,259 are 99.7% and
104.9% of 1,200. Restating the ceiling as 1,500 moves the aim point to 1,500 and reproduces the
same proportional overshoot at roughly 1,575 — a larger ceiling, an identical failure, and one
more discarded paid call to discover it. Every number in this pipeline is derived; a number chosen
to make today's observation fit would have been the first that was not.

**Other rejected alternatives.**

- *Reword the prompt to "about 1,200" or "aim for 1,200".* Rejected. `CD4` requires the ceiling to
  be framed as a ceiling, and rightly: softening it invites a response at 1,400 as readily as one
  at 1,100, and the validator would still be the thing that decides. The wording is not the
  problem; a boundary sitting inside the model's ordinary variance is.
- *A fifth restatement of "a ceiling is not a quota".* Rejected for the reason PR #80 rejected the
  fourth: the instruction is present, explicit and measurably ineffective. More of it is a hope.
- *Truncate an over-length `concept` instead of rejecting it.* Rejected. The validators exist to
  refuse a response that does not meet its contract, not to repair one; silently truncating a
  concept is the same class of error as stripping a markdown fence, which PR #80 rejected for the
  same reason.
- *Generalize the target/ceiling split across all 53 bounded limits.* Rejected as unevidenced. One
  field has been measured against a live model. The other fifty-two have not, and giving every one
  of them an invisible margin would widen fifty-two contracts on the strength of two observations
  of a fifty-third. The mechanism is built to take a second field without redesign; a second field
  should arrive with its own measurement.

**Derived consequences, recorded because they are derived and not chosen.** Raising `conceptChars`
by 300 raises stage 1's serialized output ceiling by `300 × MAX_JSON_ESCAPE_EXPANSION` = 600, and
every value downstream of it follows:

| Derived value | Before | After |
|---|---|---|
| `STRATEGY_OUTPUT.transportChars` | 32,422 | 33,022 |
| `STRATEGY_OUTPUT.contractChars` | 16,822 | 17,122 |
| `HANDOFF_GUARDS.strategyOutputChars` | 32,422 | 33,022 |
| `STAGE_ASSEMBLED_CEILINGS["automotive-truth"]` | 369,964 | 370,564 |
| `STAGE_ASSEMBLED_CEILINGS["hook-story-script"]` | 105,030 | 105,630 |
| `MAX_PAYLOAD_CHARS` | 370,000 | 380,000 |
| `POLICY_OUTPUT_TOKEN_FLOORS["reasoning-heavy"]` | 40,000 | **40,000 — unchanged** |

The output-token floor is unchanged because it is the maximum over stages 1 and 2, and stage 2's
39,459 still dominates stage 1's 33,022; 40,000 remains far below the 128,000-token output cap both
configured models offer. `MAX_PAYLOAD_CHARS` moved because `automotive-truth` assembles stage 1's
output and its ceiling crossed a ten-thousand boundary. No guard, ceiling or budget was
hand-adjusted to accommodate any of this — the derivation regressions recompute all of it.

**Automated validation.** `npm run build` clean. `npm run test:offline` **ALL PASS** on all eight
suites. The `CD` group gains `CD0c` (every declared stated figure is enforced at ≥ 1.25×) and
`CD0d` (every declared key names a field a prompt specification actually pairs); `CD2` and `CD3`
now compare against the stated figure where one is declared and the enforced limit otherwise, so
both still fail on a stale prompt number; `CD4` passes unchanged, because the prompt wording did
not change. `CF5` reads the stated figure for the same reason the schema does. Every assertion
keys off the constants; no test carries a literal 1,200 or 1,500. Mutation-checked, each reverted:
lowering `conceptChars` to 1,400 fails `CD0c`; raising the prompt's stated number to 1,500 fails
`CD2` and `CD3`; renaming the `STATED_FIELD_CEILINGS` key fails `CD0d`; pointing the schema
`description` back at the enforced limit fails `CF5`.

**Production evidence:** none, and none is possible — no stage is enabled or reachable. **No live
model call was made by this change**, by instruction.

**Rollback / recovery status:** no migration and no durable state. Reverting the commit restores
the previous constants exactly.

**Security and privacy implications.** None. No claim, tool, model id, thinking configuration,
capability, approval rule, autonomy boundary, or publishing instruction was touched.
`stageExecution.ts`, its single-request guarantee and its no-retry behaviour are untouched.

**Accepted limitations.**

- **1.25× is a judgement calibrated on two measurements, not a proof.** It is five times the ±5%
  spread those two runs showed, which is a deliberate margin rather than a tight one, but two
  observations cannot establish a distribution. A response at 1,501 characters is still a
  discarded paid call, and nothing here makes that impossible.
- **The mechanism does not make the model shorter.** It widens the boundary so ordinary variance
  around an unchanged target no longer crosses it. If a later measurement shows the model aiming
  well past the stated figure rather than around it, this is the wrong fix and the stated figure
  itself is what should change.
- **Only `concept` is covered.** Every other bounded field in all six stages still states and
  enforces one number, and none has been measured against a live model. A second overshoot in a
  different field is not prevented by this change; it is made one line cheaper to fix.
- **Stages 2–6 have still never returned a response to a live validator.** Nothing here changes
  that, and the `conceptChars` evidence says nothing about whether their ceilings are sized right.

**Unresolved follow-ups.**

- ~~The PR number and merge SHA above (blocking follow-up, mutable-identifier exception).~~
  **Closed in the change recorded below**, the first change after this merge: PR #81, merge
  `5e7e2f036e79192a8ebd05c702921988eee81088`, ordered parents verified by direct Git inspection.
- ~~[`docs/STATUS.md`](STATUS.md) states the shared payload boundary as `370,000`, which this
  change makes stale at `380,000`.~~ **Closed inside this change.** It was opened as a **blocking
  documentation follow-up** because the instruction under which this change was made forbade
  touching that file; on being shown the consequence, its author confirmed the instruction was
  meant to protect the production tables and the M1→M2 interval record, not a derived repository
  constant, and authorized the edit here. The clause now reads as what that authority derives
  **now** — `380,000` — with `370,000` labelled as the value **at PR #54's merge** and a pointer
  to this file for why it moved, because the sentence sits inside a PR #54 merge record but was
  written in the present tense. Nothing else in [Status](STATUS.md) changed: the production
  tables, the M1→M2 interval record, and the current cursor are untouched, and the `120,000`
  recorded one paragraph earlier stays as the historical pre-reconciliation value it describes.
  **This is the only sanctioned way that follow-up could close** — by making the edit, not by
  restating the constraint.
- Whether the provider accepts and honours the five schemas for stages 2 through 6 — carried
  forward from the PR #80 record above, still open, still needing a live run that reaches them.
- Whether the other bounded output ceilings are sized for real model output. Unmeasured, and
  deliberately not guessed at here.
- **Superseded in part by the output-field classification recorded below** (*Output-field
  classification — product limits kept, internal-plumbing limits given hidden margins*). A second
  measured field — `rationale`, 2,580 against a stated 2,000, +29% — showed that a margin sized on
  `concept`'s ±5% does not transfer. That change classifies every bounded field, gives every
  internal-plumbing character field (`concept` included, now 3,600) a hidden margin sized from
  budget headroom, raises `CEILING_SLACK_MULTIPLIER` from 1.25 to 2, and leaves every
  product-bearing field without one. This record is preserved as written; the 1.25× figures above
  describe the state at PR #81's merge.

**Documents updated at completion:** [README](../README.md), [Architecture](ARCHITECTURE.md),
[AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md),
[Testing](TESTING.md), [Status](STATUS.md), and this file. The [Status](STATUS.md) edit is one
clause on one line, correcting and re-tensing a derived repository constant inside the PR #54
record; **no production table, no live SHA, no M1→M2 interval record and no cursor was touched**,
and this change still verifies no production state.

## Disabled thinking and effort — the pairing a model rejects cannot be configured — `MERGED`

**State:** `MERGED` through PR #82 (reconciled 2026-09-22; recorded at implementation as "`IMPLEMENTED` on a branch; `MERGED` only on merge"). **Not `DEPLOYED`, not `ENABLED`, not
`PRODUCTION-VALIDATED`.** All six stages remain `executionEnabled: false` and no production path
reaches any of them. It authorizes no release, and the time-bounded partial-release interval
prohibits any release of any service until **2026-09-24T18:52Z**. [Status](STATUS.md) is **not
modified by this change at all** — no production table, no live SHA, no M1→M2 interval record, no
cursor, and no other clause; nothing it states became stale, because no value it records moved.

**PR / merge:** base `5e7e2f036e79192a8ebd05c702921988eee81088` (PR #81 merge). **Closed 2026-09-22:**
PR #82, merge `0c45c0a676db6b07ae7e34df76c980a854ee9d72`, whose ordered parents are that base
`5e7e2f036e79192a8ebd05c702921988eee81088` then `d13fa79939521a594e20f531d1941532849214bc`,
verified by direct Git inspection. The original text follows. **PR number and
merge SHA are not knowable before merging** — recorded here as a **blocking follow-up** under the
mutable-identifier exception in [`AGENTS.md`](../AGENTS.md), to be reconciled in the first change
after merge.

**The defect — a precondition that announces itself only after money is spent.**
`POLICY_THINKING` pins all three policies to `{type: "disabled"}`. On Claude Opus 5 — which
`reasoning-heavy` resolves to, and which serves stages 1 and 2 — disabled thinking is accepted
**only at effort `high` or below**; pairing it with `xhigh` or `max` returns a **400**. No effort
is set anywhere in the repository today, so `output_config.effort` is absent and the provider
default applies, and the configuration is valid. Nothing prevented a later edit from adding one.
Had it added `xhigh`, the pipeline would have failed on its first paid call, with no offline check
catching it. This is the same defect shape as the rest of this sequence: a knowable precondition
discovered at the provider rather than at review.

**Delivered.**

- **`EFFORT_LEVELS`** — the five levels in increasing order, so comparisons are by position and a
  sixth level is placed once rather than in every comparison.
- **`MAX_EFFORT_WITH_THINKING_DISABLED`** is `high`.
- **`MODELS_REJECTING_DISABLED_THINKING_ABOVE_HIGH`** holds `claude-opus-5` and nothing else,
  commented with the source and the exact rule.
- **`POLICY_EFFORT`** — a per-policy effort declaration, **added empty**. An absent declaration
  means the request carries no `output_config.effort` key, so behaviour is unchanged. Its purpose
  is to be the place a future effort is declared, where the invariant can read it.
- **One invariant in `resolveModelPolicy()`**, throwing the `ModelPolicyError` that file already
  defines when a policy's thinking is disabled **and** its model is in the restricted set **and**
  its declared effort ranks above the limit. The message names the policy, the model, the effort
  level, and that the combination returns a 400, so it is actionable without reading the source.
- `ResolvedModelPolicy` gains `effort`, `undefined` for all three policies today.

**Design decision — model-aware, not blanket, and one condition rather than two guards.** The
restriction is recorded against **model ids**, because it is a property of the model: repointing
`reasoning-heavy` at another id must carry the restriction away with the id, and pointing another
policy at `claude-opus-5` must pick it up. A rule keyed to the policy name would do neither.
Expressed as a single condition, the invariant catches **both** edit directions — raising the
effort of a disabled-thinking policy, and disabling the thinking of a policy that already declares
a high effort — which is why it is not written as two direction-named guards: those would state one
condition twice and invite a reviewer to delete whichever their edit did not trip.

**Widening beyond an offline assertion, stated plainly.** This adds a runtime throw, not only a
test. It is justified narrowly: resolution runs **before** the request is built and before anything
is billed, it reuses the error type the file already throws, and it converts a paid failure into a
free one. It cannot make a previously working configuration fail, because no policy declares an
effort.

**Rejected alternatives.**

- **A test-only assertion over the constants, with no runtime throw.** Rejected: it would catch the
  edit only when the suite runs, and the failure it prevents is a paid provider call. The throw
  costs nothing on a valid configuration and fires at the last point before a request exists.
- **Blanket-disallowing effort above `high` whenever thinking is disabled, for every model.**
  Rejected as over-broad: it is documented for Claude Opus 5, and would wrongly block a valid
  `reasoning-standard` or `critic` configuration. `CC22d` exists specifically to fail if anyone
  implements it this way.
- **Adding `claude-sonnet-5` to the restricted set "for symmetry".** Rejected: no such restriction
  is documented for it. The comment states that adding any model requires a documented provider
  source, precisely so symmetry is not mistaken for evidence.
- **Setting an effort now** (for example `high`, the documented default). Rejected: it would change
  the request — adding a key it does not currently carry — for no measured benefit, on stages that
  have never run.
- **Two separate guards, one per edit direction.** Rejected for the reason given above.

**Automated validation.** `CC22a`–`CC22g`, keyed entirely off the exported constants — no model id
and no effort-level name appears in a test body, so a future model or level is covered without
editing them. They prove: the current configuration resolves cleanly and declares no effort
(`CC22a`); a restricted policy throws at **every** level above the limit (`CC22b`); it still
resolves at every level at or below it (`CC22c`); **unrestricted policies resolve at every level,
including above the limit** — the over-broadness test (`CC22d`); the reverse edit direction throws
under the same assertion (`CC22e`); with nothing declared the built stage request carries no
`output_config.effort`, proven through the real stage seam, and every table the suite mutated was
restored (`CC22f`); and the restriction is recorded against ids with its source and rule stated
(`CC22g`).

**Mutation-checked, each reverted and re-confirmed green.** Guard neutered → `CC22b` and `CC22e`
fail; `>` weakened to `>=` → `CC22c` fails; the model-set test dropped → `CC22d` fails; the
thinking test dropped → `CC22e` fails; `claude-sonnet-5` added to the set → `CC22a` fails, because
it empties the unrestricted group and would make the over-broadness test vacuous; `POLICY_EFFORT`
silently defaulted instead of left absent → `CC22a` fails.

**Schema / migrations:** none. **`stageExecution.ts`, its single-request guarantee and its no-retry
behaviour are untouched.** No model id, no existing thinking policy and no token budget changed.

**Accepted limitations.**

- **The declared effort is not yet wired into the request.** `POLICY_EFFORT` is read by the
  invariant and surfaced on `ResolvedModelPolicy`, but `stageExecution.ts` — explicitly out of
  scope here — does not pass it to `sdk.ts`, and `sdk.ts` has no `effort` option. So an effort
  declared today would be validated and then ignored rather than sent. This is recorded as an
  unresolved follow-up below, not presented as complete.
- **The set is as good as its source, and covers one model.** Any other model with the same
  restriction is unguarded until someone with a documented source adds it.
- **The rule is a documented provider behaviour, not one this repository has observed.** No live
  call was made; a 400 has not been reproduced here, and doing so would cost the call this change
  exists to prevent.
- **Nothing here makes a stage more likely to succeed.** It removes one way to make it fail.

**Unresolved follow-ups.**

- ~~The PR number and merge SHA above (blocking follow-up, mutable-identifier exception).~~
  **Closed** in the **PR / merge** line above: PR #82, merge `0c45c0a`.
- **Wiring a declared effort through to `output_config.effort`** — `stageExecution.ts` and
  `sdk.ts`, both deliberately untouched here. Required before `POLICY_EFFORT` can carry a value
  that does anything.
- **The invariant only sees an effort that travels through `POLICY_EFFORT`, and that is a
  residual gap, not a closed one.** `resolveModelPolicy()` reads that table and nothing else. An
  `effort` option added straight to `sdk.ts` and set at a call site would never pass the table, so
  the guard would be skipped in silence and the 400 would return on a paid call — the exact failure
  this change exists to prevent, reappearing through a door it does not watch. Whoever plumbs
  effort through to the request therefore owes one of two things: route every effort through
  `POLICY_EFFORT`, so the declaration stays the single place the invariant reads; or re-site the
  invariant to where the request is actually built, so it covers every path that can set the field.
  A per-call effort that bypasses both is not an acceptable outcome. Recorded here so that
  constraint is inherited rather than rediscovered.
- Whether the provider accepts and honours the five schemas for stages 2 through 6 — carried
  forward from the PR #81 record above, still open, still needing a live run that reaches them.
- Whether the other bounded output ceilings are sized for real model output — carried forward,
  still unmeasured.

**Documents updated at completion:** [README](../README.md), [Architecture](ARCHITECTURE.md),
[AI handoff](AI_HANDOFF.md), [Security and continuity](SECURITY_AND_CONTINUITY.md),
[Testing](TESTING.md), and this file. [Status](STATUS.md) is deliberately **not** modified: no
value it records moved, and its existing sentence that the stage policy explicitly disables
thinking remains exactly true. [Environment](ENVIRONMENT.md) and [Operations](OPERATIONS.md) were
reviewed and need no change — the former's `MANAGER_MODEL` note describes the **legacy** path's
thinking resolution, which this change does not touch, and the latter describes no model policy.

## Output-field classification — product limits kept, internal-plumbing limits given hidden margins — `MERGED`

*Dated addition, 2026-09-26 (stage 5 caption-target change, at the top of this file):* the rule below that "a product-bearing field states exactly what it enforces" gains a second, listed exception. `STATED_BELOW_ENFORCED_FIELDS` — exactly stage 5's per-platform caption — may be **stated below** its enforced limit (85% of it, floored), and is **never enforced above** it. The enforced figure stays the platform limit less the contact reserve. `CQ5` pins the set.

**State:** `MERGED` through PR #85 (reconciled 2026-09-23; recorded at implementation as
"`IMPLEMENTED` on branch `claude/upbeat-heisenberg-qmitew` … `MERGED` only on merge"). **Not
`DEPLOYED`, not `ENABLED`, not `PRODUCTION-VALIDATED`.** All
six stages remain `executionEnabled: false` and no production path reaches any of them. It
authorizes no release; the partial-release interval recorded in [Status](STATUS.md) (current bound
`2026-10-22T18:52Z`) still prohibits any release of any service. [Status](STATUS.md)'s production
tables, live SHAs, M1→M2 interval record and cursor are untouched; it changes two derived repository
constants inside the PR #54 record on one line — the `MAX_PAYLOAD_CHARS` figure (as PR #81 did) and
the three output budgets — because this change makes both stale.

**PR / merge:** base `32e265cf6ce230efac0791ff0712ee71842fbd03` (PR #84 merge; `origin/main` had not
moved from the SHA the instruction named). **Closed 2026-09-23:** PR #85, merge
`e812ba4007070caf06a51736599b787290612e89`, whose ordered parents are that base
`32e265cf6ce230efac0791ff0712ee71842fbd03` then the reviewed head
`d92a18b630f30f07ed89335fbb37c03e5e81471f`, verified by direct Git inspection
(`git rev-list --parents -n 1 e812ba4`). The original text follows. **The PR number and merge SHA
are not knowable before merging** — recorded here as a **blocking follow-up** under the
mutable-identifier exception in [`AGENTS.md`](../AGENTS.md), to be reconciled in the first change
after merge.

**The defect — measured, and about to recur.** Authorized live runs paid for a stage-1 Opus 5 call
and discarded it on a character ceiling that was both stated and enforced:

| Field | Stated | Observed | Overshoot |
|---|---|---|---|
| `concept` | 1,200 | 1,196, then 1,259 | 0%, then +5% |
| `rationale` | 2,000 | 2,580 | +29% |

PR #81 gave `concept` a hidden 1.25× margin sized on its own ±5% spread. Applied to `rationale`
that margin is 2,500 — still short of 2,580 — and `STATED_FIELD_CEILINGS` had exactly one entry, so
`rationale` had no margin at all. Five of the six stages have never returned a live response, so
roughly fifty further limits were untested. Discovering them one paid, discarded call at a time is
what this change exists to stop.

**The principle — and it is the durable part.** *The skills govern craft; the payload contract
governs size; and where the skills deliberately say nothing, the budget decides.* Bounded output
fields are of two kinds, and only one has research behind it. **Product-bearing** limits are
product decisions: some are platform maxima, and `skills/platform-specs` is in places deliberately
stricter than the platform (Instagram permits 30 hashtags; the skill specifies 8–15, "not 30
generic tags") — a researched decision that outranks the platform maximum. **Internal-plumbing**
limits are a stage explaining itself or handing off to the next; no customer, platform or reviewer
sees them, which is why no research specifies their length — `skills/script-craft` states that it
is "craft only" and excludes "character-count trimming". The two fields that kept failing,
`rationale` and `concept`, are plumbing: they were failing for no product reason at all.

**How fields were classified — traced, not assumed.** A field is product-bearing if its content
reaches a human reviewer, a platform payload, or a filming instruction, established by one of four
traced bases: **review surface** — rendered in `markdownSummary` in `scripts/local/content-run.mjs`,
the only place this pipeline renders stage output for a person (the CLI also writes every stage's
full JSON as a run record; a record of everything is not a review surface, or nothing could be
plumbing); **human reader** — the stage prompt names a human as the field's reader;
**platform** — the text becomes, or is validated as, provider-visible text, or a skill governs it
as platform copy; **filming** — part of the shot plan, on-screen wording, or a production
requirement. Otherwise a field is plumbing: a **handoff** (later stages receive it as untrusted
context and nothing else reads it) or a **binding gloss** (the model's own wording beside an
evidence-id binding, which every such prompt says is never where the claim's text is read from).
Borderline fields were resolved toward product-bearing, because mislabelling a product field
plumbing widens a product decision, while the reverse only forgoes a margin. The classification
and its basis live in code, as `OUTPUT_FIELD_BOUNDS` in `payloadContract.ts`, beside the limits.

**The classification, in full** (55 bounded output fields; cardinalities included; "×" is the
enforced-to-stated ratio for fields given a margin):

| Field | Kind | Basis | Stated | Enforced |
|---|---|---|---:|---:|
| `strategy-concept.angle` | plumbing | handoff to stages 2–3 | 400 | 1,200 (3×) |
| `strategy-concept.concept` | plumbing | handoff to stages 2–3 | 1,200 | 3,600 (3×) |
| `strategy-concept.rationale` | plumbing | handoff; stage 1 explaining itself | 2,000 | 6,000 (3×) |
| `strategy-concept.supportingFactIds` | plumbing | handoff; id channel | 12 | 12 |
| `strategy-concept.observationIds` | plumbing | handoff; id channel | 12 | 12 |
| `strategy-concept.performanceSignalIds` | plumbing | handoff; id channel | 12 | 12 |
| `strategy-concept.hypotheses` | plumbing | handoff to stages 2–3 | 6 | 6 |
| `strategy-concept.hypotheses[].statement` | plumbing | handoff to stages 2–3 | 400 | 1,200 (3×) |
| `strategy-concept.assumptions` | plumbing | handoff to stages 2–3 | 6 | 6 |
| `strategy-concept.assumptions[]` | plumbing | handoff to stages 2–3 | 400 | 1,200 (3×) |
| `automotive-truth.assessment` | plumbing | handoff to stage 3; no human reader named | 2,000 | 6,000 (3×) |
| `automotive-truth.allowedClaims` | plumbing | handoff; sizes stage 3's `PERMITTED_CLAIMS` | 12 | 12 |
| `automotive-truth.allowedClaims[].restatement` | plumbing | binding gloss | 400 | 1,200 (3×) |
| `automotive-truth.forbiddenClaims` | product | human reader: "tells later stages and human reviewers" | 12 | 12 |
| `automotive-truth.forbiddenClaims[].claim` | product | human reader: as above | 400 | 400 |
| `automotive-truth.requiredCaveats` | plumbing | handoff to stage 3; no human reader named | 6 | 6 |
| `automotive-truth.requiredCaveats[]` | plumbing | handoff to stage 3; no human reader named | 300 | 900 (3×) |
| `automotive-truth.openQuestions` | product | human reader: "what a human would have to verify" | 6 | 6 |
| `automotive-truth.openQuestions[]` | product | human reader: as above | 300 | 300 |
| `hook-story-script.hook` | product | review surface: summary "Hook" | 300 | 300 |
| `hook-story-script.storyBeats` | plumbing | handoff to stages 4–6 | 8 | 8 |
| `hook-story-script.storyBeats[].beat` | plumbing | handoff to stages 4–6; not rendered | 400 | 1,200 (3×) |
| `hook-story-script.script` | product | review surface: summary "Script" | 6,000 | 6,000 |
| `hook-story-script.claimUse` | plumbing | handoff; sizes `SCRIPT_CLAIMS` | 12 | 12 |
| `hook-story-script.claimUse[].paraphrase` | plumbing | binding gloss | 400 | 1,200 (3×) |
| `hook-story-script.openQuestions` | product | human reader: "what a human would have to verify" | 6 | 6 |
| `hook-story-script.openQuestions[]` | product | human reader: as above | 300 | 300 |
| `production-direction.visualApproach` | product | filming: the sequence's one visual idea | 1,500 | 1,500 |
| `production-direction.shots` | product | filming; review surface: summary "Shot list" | 10 | 10 |
| `production-direction.shots[].subject` | product | filming | 300 | 300 |
| `production-direction.shots[].action` | product | filming; review surface: summary "Shot list" | 400 | 400 |
| `production-direction.shots[].composition` | product | filming | 400 | 400 |
| `production-direction.shots[].continuityNote` | product | filming | 300 | 300 |
| `production-direction.overlayText` | product | filming: on-screen wording a viewer reads | 10 | 10 |
| `production-direction.overlayText[].text` | product | filming: on-screen wording a viewer reads | 200 | 200 |
| `production-direction.productionRequirements` | product | filming; human reader: "what a human must provide" | 12 | 12 |
| `production-direction.productionRequirements[].requirement` | product | filming; human reader: as above | 300 | 300 |
| `production-direction.claimVisuals` | plumbing | handoff; id-to-shot binding | 12 | 12 |
| `production-direction.claimVisuals[].directionSummary` | plumbing | binding gloss | 400 | 1,200 (3×) |
| `production-direction.openQuestions` | product | human reader: "what a human must verify before production" | 6 | 6 |
| `production-direction.openQuestions[]` | product | human reader: as above | 300 | 300 |
| `packaging-adaptation.packages[].caption` | product | platform; review surface: summary "Captions" | per platform (2,200 / 2,200 / 1,500) | same |
| `packaging-adaptation.packages[].hashtags` | product | platform; review surface: summary "Captions" | per platform (8–15 / ≤2 / 0) | same |
| `packaging-adaptation.packages[].localKeywords` | product | platform: SEO copy governed by `skills/local-seo` | 6 | 6 |
| `packaging-adaptation.packages[].localKeywords[]` | product | platform: as above | 120 | 120 |
| `packaging-adaptation.packages[].openQuestions` | product | human reader: "what a human must decide" | 6 | 6 |
| `packaging-adaptation.packages[].openQuestions[]` | product | human reader: as above | 300 | 300 |
| `packaging-adaptation.claimUse` | plumbing | handoff; sizes `PLATFORM_CLAIMS` | 24 | 24 |
| `packaging-adaptation.claimUse[].summary` | plumbing | binding gloss | 400 | 800 (2×) |
| `final-critic.summary` | product | review surface: summary "Critic verdict" | 1,500 | 1,500 |
| `final-critic.findings` | product | review surface: summary "Critic verdict" | 20 | 20 |
| `final-critic.findings[].issue` | product | review surface: summary "Critic verdict" | 400 | 400 |
| `final-critic.findings[].suggestedAction` | product | review surface: summary "Critic verdict" | 300 | 300 |
| `final-critic.claimFindingUse` | plumbing | handoff; id-to-finding binding | 24 | 24 |
| `final-critic.claimFindingUse[].summary` | plumbing | binding gloss | 400 | 1,000 (2.5×) |

Totals: 30 product-bearing, 25 internal plumbing; 13 of the plumbing fields are character fields,
and all 13 now carry a margin. Bounded values outside the table, and why: `goalChars` (2,000),
`maxRequestedPlatforms` (3) and every `EVIDENCE_LIMITS` bound are caller or evidence **input**, not
model output; the evidence-id strings a model echoes (`factId`, the id channels) are bounded at
`EVIDENCE_LIMITS.idChars` but copy an existing id rather than author a length; and stage 5's
`recommendedTime` is bounded at 16 by a closed `HH:MM ET` pattern — product-bearing ("a note for a
human reviewer"), but a format, not a length a model aims at. All are unchanged.

**The classification departs from the premise the work was framed on, and that is recorded, not
reconciled.** The request's own measurement table grouped stages 1, 2 and 6 as "internal". Traced,
they are not wholly internal: stage 2's `forbiddenClaims` and `openQuestions` name human reviewers
as their readers, and stage 6's `summary`, `findings[].issue` and `findings[].suggestedAction` are
rendered on the review surface. Those five stayed product-bearing and unchanged. Conversely,
stages 3, 4 and 5 each carry plumbing — beats, paraphrases, direction summaries, claim-use
summaries — which the "internal stages" framing left out.

**Delivered.**

- **`OUTPUT_FIELD_BOUNDS`** — the classification and its basis, per field, keyed
  `<stage id>.<field token>`, in `payloadContract.ts` beside the limits, carrying each field's
  enforced value, unit and class.
- **Every internal-plumbing character field states a lower figure than it enforces.**
  `STATED_FIELD_CEILINGS` grows from 1 entry to 13. No prompt changed; each still states its
  original figure. Every plumbing field's response-schema `description` now reads through
  `statedCeiling`, since a description is a model-facing channel.
- **`CEILING_SLACK_MULTIPLIER` 1.25 → 2**, the declared minimum margin: comfortably clear of the
  largest overshoot measured (1.29×).
- **Margins sized from budget headroom, not a uniform multiplier.** Each stage takes the widest
  margin its policy can afford while every policy keeps at least a fifth of its model's
  128,000-token output cap unallocated (≤ 102,400):
  - **3×** for stages 1 and 2 (`reasoning-heavy`), and for stages 3 and 4, which stay below stage 5
    and so do not move the `reasoning-standard` budget at all;
  - **2×** for stage 5, which *sets* the `reasoning-standard` budget — 2.5× would take it to
    107,684;
  - **2.5×** for stage 6 (`critic`) — 3× would take it to 110,606.
  Three is the ceiling on purpose: past it, the budget rather than any measurement would be doing
  the deciding.
- **Per-run field measurement in `scripts/local/content-run.mjs`.** Every run — fake or live,
  passing or failing — measures each bounded output field of every raw provider response against
  its enforced limit and its stated figure, and writes `field-measurements.md` and
  `field-measurements.json` to the run directory. It measures the raw response text rather than the
  validated output, so a rejected response is measured too, and on failure it prints the fields
  that went over. Sizes are UTF-8 bytes (every bound caps code units and bytes with one number,
  and bytes are never fewer); stage 5's caption and hashtag count are measured per platform
  against that platform's effective cap, the caption as the provider-visible text the validator
  compares (`proposedProviderText`, now exported for exactly that purpose). No new flag, no mode.
  It changes no validation outcome.

**Every number changed, before → after.** Stated figures (the prompt) are unchanged in every row.

| Limit | Field | Stated | Enforced before | Enforced after |
|---|---|---:|---:|---:|
| `STRATEGY_LIMITS.angleChars` | `angle` | 400 | 400 | 1,200 |
| `STRATEGY_LIMITS.conceptChars` | `concept` | 1,200 | 1,500 | 3,600 |
| `STRATEGY_LIMITS.rationaleChars` | `rationale` | 2,000 | 2,000 | 6,000 |
| `STRATEGY_LIMITS.hypothesisChars` | `hypotheses[].statement` | 400 | 400 | 1,200 |
| `STRATEGY_LIMITS.assumptionChars` | `assumptions[]` | 400 | 400 | 1,200 |
| `TRUTH_FIELD_LIMITS.assessmentChars` | `assessment` | 2,000 | 2,000 | 6,000 |
| `TRUTH_FIELD_LIMITS.restatementChars` | `allowedClaims[].restatement` | 400 | 400 | 1,200 |
| `TRUTH_FIELD_LIMITS.caveatChars` | `requiredCaveats[]` | 300 | 300 | 900 |
| `SCRIPT_FIELD_LIMITS.beatChars` | `storyBeats[].beat` | 400 | 400 | 1,200 |
| `SCRIPT_FIELD_LIMITS.paraphraseChars` | `claimUse[].paraphrase` | 400 | 400 | 1,200 |
| `DIRECTION_FIELD_LIMITS.directionSummaryChars` | `claimVisuals[].directionSummary` | 400 | 400 | 1,200 |
| `PACKAGING_FIELD_LIMITS.summaryChars` | `claimUse[].summary` | 400 | 400 | 800 |
| `CRITIC_FIELD_LIMITS.claimFindingSummaryChars` | `claimFindingUse[].summary` | 400 | 400 | 1,000 |
| `CEILING_SLACK_MULTIPLIER` | — | — | 1.25 | 2 |

**Derived consequences, recorded because they are derived and not chosen.**

| Derived value | Before | After |
|---|---:|---:|
| `STRATEGY_OUTPUT` transport / contract | 33,022 / 17,122 | 66,022 / 33,622 |
| `TRUTH_OUTPUT` transport / contract | 39,459 / 21,859 | 73,859 / 39,059 |
| `SCRIPT_OUTPUT` transport / contract | 40,621 / 22,121 | 72,621 / 38,121 |
| `DIRECTION_OUTPUT` transport / contract | 68,331 / 38,231 | 87,531 / 47,831 |
| `PACKAGING_OUTPUT` transport / contract | 78,884 / 43,724 | 98,084 / 53,324 |
| `CRITIC_OUTPUT` transport / contract | 72,206 / 42,306 | 101,006 / 56,706 |
| `HANDOFF_GUARDS` stage 1 / 2 / 3 / 4 | 33,022 / 39,459 / 40,621 / 68,331 | 66,022 / 73,859 / 72,621 / 87,531 |
| `HANDOFF_GUARDS.evidencePackChars` | 337,376 | 337,376 — unchanged |
| `STAGE_ASSEMBLED_CEILINGS["strategy-concept"]` | 341,520 | 341,520 — unchanged |
| `STAGE_ASSEMBLED_CEILINGS["automotive-truth"]` | 370,564 | 403,564 |
| `STAGE_ASSEMBLED_CEILINGS["hook-story-script"]` | 105,630 | 173,030 |
| `STAGE_ASSEMBLED_CEILINGS["production-direction"]` | 73,675 | 105,675 |
| `STAGE_ASSEMBLED_CEILINGS["packaging-adaptation"]` | 142,289 | 193,489 |
| `STAGE_ASSEMBLED_CEILINGS["final-critic"]` | 251,101 | 321,501 |
| `MAX_PAYLOAD_CHARS` | 380,000 | 410,000 |
| `POLICY_OUTPUT_TOKEN_FLOORS["reasoning-heavy"]` | 40,000 | **74,000** (cap 128,000) |
| `POLICY_OUTPUT_TOKEN_FLOORS["reasoning-standard"]` | 79,000 | **99,000** (cap 128,000) |
| `POLICY_OUTPUT_TOKEN_FLOORS.critic` | 73,000 | **102,000** (cap 128,000) |
| `POLICY_STREAM_DEADLINE_MS` heavy / standard / critic | 35 / 67 / 62 min | 63 / 84 / 86 min |
| CLI "estimated ceiling for one full six-stage run" | ~$6.81 | ~$9.54 |

All three budgets stay under `POLICY_MODEL_OUTPUT_CAPS`, with 54,000 / 29,000 / 26,000 tokens of
headroom. The budget is a `max_tokens` ceiling, not a spend: a real response is billed for what it
emits, and the CLI's estimate is the rough worst case it has always printed.

**Product-bearing fields — verified against the governing skill, and against the platform research
the operator supplied on 2026-09-22.** No product-bearing value changed. Where a skill and the
contract disagree, the skill wins and the discrepancy is a finding, recorded here and **not**
reconciled.

| Platform / field | Operator research | Skill | Contract | Verdict |
|---|---|---|---|---|
| Instagram caption | 2,200 | `platform-specs`: "up to 2,200" | `INSTAGRAM_CAPTION_MAX` 2,200; effective 2,200 | agree |
| Instagram visible | ~125 before "more" | `platform-specs`: "first ~125 chars" — front-load | not a limit | agree |
| Instagram hashtags | 30 permitted | `platform-specs`: 8–15, "not 30 generic tags" | 8–15 | agree — the skill is deliberately stricter than the platform, and the contract follows the skill |
| Facebook post | 63,206 | `platform-specs`: no number ("long is allowed but keep it tight") | `FACEBOOK_TEXT_MAX` 63,206; stage 5 effective **2,200** | **finding 1** |
| Facebook truncation | ~125–477 | not stated ("front-load value") | not a limit | **finding 2** (informational) |
| Facebook hashtags | — | `platform-specs`: "few or none"; rejects "more than two" | ≤ 2 | agree |
| GBP post | 1,500 | `platform-specs` 1,500; `local-seo` ~1,500 | `GBP_SUMMARY_MAX` 1,500; effective 1,500 | agree |
| GBP visible | ~150 | not stated ("front-load the offer/tip") | not a limit | **finding 2** (informational) |
| GBP business description / name | 750 / 125 | not stated | no field produces either | not applicable |
| GBP hashtags | — | `platform-specs`, `local-seo`: none | 0 | agree |
| GBP local keywords | — | `local-seo`: "work 1–2 local keyword phrases in naturally" | `maxLocalKeywords` **6**, on every platform | **finding 3** |
| Stage 2, 3, 4, 6 product fields | — | `claim-boundaries`, `script-craft`, `production-craft`, `critique-discipline` state no length | as tabled above | no disagreement possible: the skills are silent on size by design |

- **Finding 1 — Facebook's 2,200 is enforced but recorded in no skill.** `platform-specs` gives
  Facebook no numeric limit and the legacy canonical builder still accepts 63,206, which matches the
  operator's research. Stage 5's effective 2,200 is a pipeline narrowing (`pipelineCaptionChars`,
  PR #54), stated in the stage 5 prompt and in `payloadContract.ts` but not in the skill that governs
  platform format. This is not a contradiction — "keep it tight" points the same way — but the
  number has no skill behind it. Unchanged.
- **Finding 2 — the visible-before-truncation figures are recorded only for Instagram.** The
  operator's Facebook (~125–477) and GBP (~150) figures appear nowhere in the repository. Nothing
  enforces a visible length on any platform, and nothing should; the skill's instruction for both is
  to front-load. Informational.
- **Finding 3 — GBP local keywords: the skill says 1–2, the contract permits 6.** `local-seo`'s
  GBP rule is "work 1–2 local keyword phrases in naturally", and the legacy
  `agents/hashtag-seo-timing.md` says the same; stage 5 accepts up to 6 `localKeywords` on every
  platform, GBP included. Stage 5 loads only `skills/adaptation-craft`, which states no number, and
  the registry deliberately does not load `local-seo` for it, so the 1–2 rule never reaches that
  model. **The skill wins: this is a discrepancy for a product decision, not a margin to adjust, and
  it is not changed here.**
- **Also noted, out of scope:** `platform-specs` and `local-seo` refer to a `hashtag-seo-timing`
  *skill*; no such skill exists — it is `agents/hashtag-seo-timing.md`.

**A latent defect in `CD0c`/`CD0d`, fixed because this change needs it.** Both split a key into
stage and field at its **last** dot. With `concept` the only entry that never mattered; every
nested token (`hypotheses[].statement`) would have been mis-split and reported as a key no prompt
pairs. The split is now at the first dot — stage ids contain none. No other assertion was
loosened.

**Migrations / schema impact:** none. No SQL, no durable state.

**Material design decisions.**

- **Product-bearing limits get no margin — ever.** A product-bearing limit is a product decision,
  and a hidden margin would silently widen it; `CD0f` fails if one is given.
- **Only character fields get a margin, cardinalities do not.** The measured failure is a model
  landing near a stated *length*. A count is discrete and has not been observed to overshoot, and
  several counts (`maxIds`, `maxAllowedClaims`, the claim-use counts) also size the claim blocks the
  next stage receives — widening one is an authority change, not slack.
- **The review surface is the code, not a description of it.** `CD0g` reads `markdownSummary` and
  fails if any plumbing field's token appears there. A plumbing field that starts being shown to a
  person has become product-bearing by definition, and must be reclassified rather than given slack.

**Material rejected alternatives.**

- *A uniform multiplier.* Rejected, as instructed and on the arithmetic the request measured: 2×
  across every field takes the floors to 75,000 / 150,000 / 133,000 — two of three over the cap —
  and even 1.5× everywhere, which fits, spends margin on product fields that must have none.
- *Stages 1, 2 and 6 at 2×, as framed.* Rejected on the trace, not the budget: it would have given
  margins to five product-bearing fields (stage 2's forbidden claims and open questions, stage 6's
  summary, issue and suggested action), and missed the plumbing in stages 3–5.
- *Raising the stated figures.* Rejected for the reason PR #81 recorded: the stated figure is the
  aim point, so raising it moves the aim and reproduces the same proportional overshoot above it.
- *Reversing PR #81's refusal to generalize — on what evidence.* PR #81 rejected generalizing the
  split across every limit as unevidenced: one measured field could not justify widening fifty-two
  contracts. That is now reversed, deliberately and only for plumbing. There is now a second
  measured field, `rationale`, which overshot by six times `concept`'s spread and showed that a
  margin sized on one field's variance does not transfer; and the classification removes the
  original objection, because the widened contracts are exactly the ones with no product decision
  behind them. Product-bearing fields stay unwidened, which is the half of PR #81's reasoning that
  still holds.
- *A reserve assertion in the suite.* The one-fifth reserve is a sizing rule, not an invariant, and
  asserting it would block a legitimate future product-bearing change. The invariant asserted is the
  one the budget really has: every floor strictly below its model's cap (`CC19a`).

**Automated validation.** `npm run build` and `npm run typecheck` clean. `npm run test:offline`
**ALL PASS** on all nine suites — 1,560 checks: content-intelligence **1,057** (was 1,052), posting
52, image 18, orchestrator 119, gate 56, API 51, render-identity one invariant pass, ownership/recovery
112, interval monitor 94. New checks: `CD0e` (every bounded output field is classified at its
validator's own value and unit, with a basis), `CD0f` (every plumbing character field has a margin
and no product-bearing field does), `CD0g` (no plumbing field on the review surface), `CC19a`
(every derived output-token floor strictly below its model's cap), and `CE6` (every run writes
field measurements, on success and on failure, from the raw responses). `CF5` is generalized from
`concept` to every declared stated figure: each description must state the stated figure and must
not state the enforced one. `npm run test:payload-mutation` **ALL PASS — 346 mutations** (341
before; the five new ones, `M342`–`M346`, are appended after every earlier group so no existing id
moves). Also clean: `test:m1-readiness` (461 checks), simulated dry run, deployment-controller
fixtures, `npm audit --omit=dev` (0 vulnerabilities), Markdown links, environment coverage (35
variables), the credential/PII scan, and `git diff --check`.

**Mutation-checked, each reverted.** In the harness: narrowing `rationaleChars` to 3,000 (1.5×)
fails `CD0c`; widening stage 5's `summaryChars` to 3,000 pushes `reasoning-standard` past the cap and
fails `CC19a` and `CC22`; giving `final-critic.summary` a stated figure fails `CD0f`; reclassifying
`rationale` product-bearing while it keeps its margin fails `CD0f`; deleting `assessment`'s stated
figure fails `CD0f` and `CD2`. By hand, outside the harness's captured paths: restoring `concept` to
PR #81's 1,500 (1.25×) fails `CD0c`; pointing stage 1's `rationale` or stage 5's summary `description`
at the enforced limit fails `CF5`; rendering `storyBeats` in `markdownSummary` fails `CD0g`; dropping
the failure-path measurement fails `CE6`; deleting a classification entry fails `CD0e`.

**CLI verified by hand, offline.** A fake run against a clearly labelled synthetic facts file wrote
`field-measurements.md` with 55 rows. A fake run whose stage-1 `rationale` was forced to 6,187
characters failed as it must (`"rationale" exceeds 6000 characters (actual 6187)`), wrote the
measurements, printed `over: strategy-concept.rationale 6187/6000`, and still saved
`rejected-responses.json`. No live call was made.

**Production evidence:** none, and none is possible — no stage is enabled or reachable. **No live
model call was made by this change.**

**Rollback / recovery status:** no migration and no durable state. Reverting the commit restores
every limit exactly; field-measurement files already written under `local-output/` are local run
records and are not read back by anything.

**Security and privacy implications.** No claim, tool, model id, thinking or effort configuration,
approval rule, autonomy boundary, publishing instruction or prompt text changed.
`additionalProperties: false`, the strict-JSON parse, `stageExecution.ts`'s single-request
guarantee and its no-retry behaviour are untouched; no validator was removed or loosened other than
by the enforced ceilings tabled above. The measurement files hold lengths and field names only —
no response text — and live beside `rejected-responses.json` under the git-ignored `local-output/`.

**Accepted limitations.**

- **The margins are sized on two fields' measurements and a budget, not on a distribution.** A
  response that exceeds even a 3× margin is still a discarded paid call. What changes is that it
  now leaves a measurement behind.
- **Product-bearing fields keep no slack, so they can still discard a paid call** — the hook at
  301 characters, a critic summary at 1,501. That is the correct trade: those numbers are product
  decisions, and the right response to an overshoot there is a product decision too, informed by
  the measurements this change starts collecting.
- **Worst-case input grew.** `MAX_PAYLOAD_CHARS` is now 410,000 characters. Nothing in the
  repository compares an assembled input against a model's context window; that gap predates this
  change (the evidence pack alone is 337,376) and is noted, not closed.
- **The measurement reads bytes, not the validators' own verdict.** It reports a field over its
  limit exactly as the validator would for length; it does not re-run any other validation rule.

**Unresolved follow-ups.**

- ~~The PR number and merge SHA above (blocking follow-up, mutable-identifier exception).~~
  **Closed** in the **PR / merge** line above: PR #85, merge `e812ba4`.
- ~~Finding 3, GBP local keywords (1–2 in the skill, 6 in the contract), awaits a product decision.~~
  **Decided and implemented** in the record immediately below: Google Business Profile is capped at
  two local keywords, Instagram and Facebook stay at six. Findings 1 and 2 remain recorded for the
  same owner.
- **Amended narrowly by the record immediately below.** This record's rule that product-bearing
  fields get no margin — "ever" — now carries one listed exception: a field whose sole reader is the
  internal human reviewer, with no platform or provider consumer (`REVIEWER_ONLY_MARGIN_FIELDS`,
  exactly `final-critic.findings[].issue`). The critic's policy also moved; the `critic` rows in the
  tables above describe the state at PR #85's merge.
- Whether the provider accepts and honours the five schemas for stages 2 through 6 — carried
  forward, still open.
- Whether the product-bearing ceilings are sized for real model output — still unmeasured, and
  now measurable for free on every run.

**Documents updated at completion:** [README](../README.md), [Architecture](ARCHITECTURE.md),
[Testing](TESTING.md), [AI handoff](AI_HANDOFF.md) (the shared payload boundary and the three
budgets), [Security and continuity](SECURITY_AND_CONTINUITY.md) (the shared payload boundary),
[Status](STATUS.md) (two derived constants on one line of the PR #54 record, as above), and this
file, including a forward pointer in the PR #81 record and a pointer in the local-CLI entry.
Security and continuity's description of stage 1's prose as "length-bounded and not checked for
meaning" remains exactly true.

## Critic on Claude Opus 5.5, reviewer-only issue margin, stop-reason handling, GBP keyword cap, critic-only replay — `MERGED`

**State:** `MERGED` through PR #87 at `dcde85baeaa3f2422f0499cb694c40eb5bb18e8f`.
It remains **not `DEPLOYED` and not `PRODUCTION-VALIDATED`**: no deployed code path resolves the `critic`
policy. All six stages remain `executionEnabled: false` and no production path reaches any of them.
The `critic` policy runs only from the operator-local CLI. It authorizes no release; the
partial-release interval in [Status](STATUS.md) (current bound `2026-10-22T18:52Z`) still prohibits
any release of any service. The deployed legacy path — `runAgent`, `runVision`, `collect()`,
`LEGACY_DEFAULT_MODEL`, `agents/brand-compliance-critic.md`, `orchestrator.ts` and `agentLoop.ts`
— is untouched; that is Lane S work.

**PR / merge:** PR #87, base `e812ba4007070caf06a51736599b787290612e89`, reviewed head
`d9e3145666ea9d77c3e870801f1441244c913c0d`, merge
`dcde85baeaa3f2422f0499cb694c40eb5bb18e8f`; the merge parents are that base then that reviewed head.

**The evidence — the 2026-09-23 six-stage run.** The first authorized live run to reach stage 6
produced three findings this change acts on:

1. **The critic's `issue` field.** It wrote findings of 419 and 397 characters against a stated and
   enforced 400. The 419-character finding was its only blocking finding, and it was correct; the
   whole stage was discarded for 19 characters. `summary` and `suggestedAction` measured at 55% and
   67% of their ceilings and are not changed.
2. **The critic's model.** The Sonnet 5 critic, thinking disabled, missed the most serious defect
   in the package — the stage-3 misattribution recorded under the *Narrow critic panel* entry
   (now `MERGED` through PR #89; its record is under *Merged repository change awaiting rollout* above). The owner chose Claude Opus 5.5 for the critic.
3. **Google Business Profile local keywords.** `skills/local-seo/SKILL.md` says "work 1–2 local
   keyword phrases in"; stage 5 accepted six on every platform and returned three for GBP — finding
   3 of the output-field classification record below, now decided.

**Delivered.**

- **`issue` — stated 400, enforced 600.** `CRITIC_FIELD_LIMITS.issueChars` 400 → 600;
  `"final-critic.findings[].issue": 400` added to `STATED_FIELD_CEILINGS`; `agents/final-critic.md`
  still states 400 and was not edited; the schema `description` reads through `statedCeiling`.
- **The PR #85 rule, amended narrowly.** PR #85 held that a product-bearing field states exactly
  what it enforces. That stands, with one listed exception: a product-bearing field may carry a
  margin only if its **sole reader is the internal human reviewer** and it has **no platform or
  provider consumer**. Text sent to a platform never gets one. `REVIEWER_ONLY_MARGIN_FIELDS` in
  `payloadContract.ts` is that list, with its own minimum `REVIEWER_ONLY_SLACK_MULTIPLIER` (1.5×). The
  regression that forbids product-bearing stated figures (`CD0f`) is kept, not deleted: it now
  exempts the allow-list, and `CD0f2` asserts the allow-list is exactly
  `{"final-critic.findings[].issue"}`.
- **The critic on `claude-opus-5-5`, adaptive thinking, effort `high`.**
  `POLICY_MODELS.critic = "claude-opus-5-5"`; `StageThinkingPolicy` widened to
  `{type: "disabled"} | {type: "adaptive"}`; `POLICY_THINKING.critic = {type: "adaptive"}`;
  `POLICY_EFFORT.critic = "high"`, set explicitly because the model's own default is `medium`, and
  commented as a starting point to tune from measured replays. `reasoning-heavy` (Opus 5) and
  `reasoning-standard` (Sonnet 5) are unchanged, thinking still disabled, no effort declared.
- **`MODELS_REQUIRING_THINKING = {"claude-opus-5-5"}`**, beside
  `MODELS_REJECTING_DISABLED_THINKING_ABOVE_HIGH` and commented the same way: the quoted documented
  source, and the rule that adding an id requires a documented provider source. The single
  resolve-time invariant now also throws `ModelPolicyError` when thinking is `disabled` on a model
  in this set, before anything is billed. The existing high-effort guard is intact. The rule is
  written once, as `thinkingEffortViolation()`, and enforced in two places: `resolveModelPolicy()`,
  and the stage request builder in `sdk.ts` — which also closes the residual gap PR #82 recorded,
  that an effort set anywhere but `POLICY_EFFORT` would skip the guard.
- **Effort reaches the wire.** The PR #82 follow-up is closed for the stage path:
  `POLICY_EFFORT` → `resolveModelPolicy` → `invokeStage` → `StageRunnerRequest.effort` →
  `createAnthropicStageRunner` → `runStageAgent` → `output_config.effort`. `effort` exists only on the
  new `StageRunOptions`, not on the legacy `AgentRunOptions`, so no legacy request can carry it; the
  stage builder adds it on top of the unchanged shared `buildRequest`.
- **The critic's budget is its model's cap.** Thinking tokens count against `max_tokens`, so
  `POLICY_MAX_TOKENS.critic = POLICY_MODEL_OUTPUT_CAPS.critic` (128,000). A named
  `THINKING_RESERVE_TOKENS` (16,000) — **labelled a heuristic, not a guarantee** — must remain
  between the critic's contract floor and that cap (`CC19b`).
- **No false visible-output guarantee.** `ResolvedModelPolicy` is now a union:
  `visibleOutputTokens` exists, equal to `maxTokens`, only when thinking is disabled. The adaptive
  branch has none, and every comment claiming a guarantee for all policies was rewritten.
- **Stop-reason handling, stage path only.** In `runStageAgentWithStreamOpener`, before `collect()`
  reads any content: `"max_tokens"` → `StageOutputTruncatedError` (model, `max_tokens`, usage);
  `"refusal"` → `StageRefusalError` (`stop_details.category` and `explanation`, guarded because
  `stop_details` may be `null`); anything else but `"end_turn"` → `StageUnexpectedStopError`. Each
  carries the provider's complete message, and the local CLI saves it to `rejected-responses.json`
  exactly as it saves a response a validator rejected. `collect()` is unchanged.
- **No fallback, anywhere.** No `fallbacks` parameter, no server-side-fallback beta, no refusal
  middleware. A fallback silently answers with a different model; a refusal must be a visible
  failure. `CH7` fails if any appears in `sdk.ts`.
- **GBP local keywords — at most 2.** `PLATFORM_LOCAL_KEYWORD_MAX` in `packagingAdaptation.ts`:
  `google_business_profile` 2 (`GBP_LOCAL_KEYWORD_MAX`), Instagram and Facebook unchanged at 6. The
  effective cap is `Math.min(platform, PACKAGING_FIELD_LIMITS.maxLocalKeywords)`, like hashtags.
  `agents/packaging-adaptation.md` states the per-platform figure; `CD7a` pairs each platform's
  prompt line with the validator's value. The derivation still counts every package at the
  pipeline ceiling of 6, so **no budget moves** — the narrower platform is over-approximated, which
  is safe.
- **Critic-only replay.** `node scripts/local/content-run.mjs --replay-critic <run-dir>` runs only
  `final-critic` against a run directory's saved stage 1–5 outputs. Free fake runner by default;
  live only after `--i-understand-this-costs-money` **and** the word `LIVE` typed at the prompt —
  the same shared guard a full live run now uses. It writes a new sibling directory
  (`<run>-critic-replay-<timestamp>`) and never writes to the source run. It fails closed, before
  any model call, unless `config/approved-facts.json` has the sha256 the run recorded (from
  `run-meta.json`, or, for older runs, the per-asset sha256 in every stage's metadata —
  `917eff30…c86c44c` for the 2026-09-23 run); the automotive facts file matches the run's recorded
  fingerprint; the rebuilt pack's projection fingerprint matches; and every saved prior output
  revalidates through its owning stage's own validator. **Every full run now writes
  `run-meta.json`** — goal, instant, attributed review time, platforms, the approved-facts sha256, a
  sha256 of the automotive facts file, and a sha256 of the evidence-pack projection. For a run that
  predates it, the replay prints that the automotive file's identity cannot be proven and requires
  the word `UNPROVEN` typed at the prompt.

**Pre-PR #87 replay prerequisite:** runs created before PR #87 have no `run-meta.json`, and a run
that failed has no `summary.md`; replaying one therefore requires the original goal to be passed on
the command line. This is a recorded compatibility prerequisite, not a code change in this follow-up.

**Every derived number, before → after.**

| Value | Before | After |
|---|---:|---:|
| `CRITIC_FIELD_LIMITS.issueChars` (enforced) | 400 | **600** |
| `final-critic.findings[].issue` stated figure | 400 | 400 — unchanged |
| `CRITIC_OUTPUT` transport / contract | 101,006 / 56,706 | 109,006 / 60,706 |
| `PACKAGING_OUTPUT` transport / contract | 98,084 / 53,324 | 98,084 / 53,324 — unchanged |
| `STAGE_ASSEMBLED_CEILINGS` (all six) | 341,520 / 403,564 / 173,030 / 105,675 / 193,489 / 321,501 | unchanged |
| `MAX_PAYLOAD_CHARS` | 410,000 | 410,000 — unchanged |
| `reasoning-heavy` floor / `max_tokens` / stream deadline | 74,000 / 74,000 / 63 min | unchanged |
| `reasoning-standard` floor / `max_tokens` / stream deadline | 99,000 / 99,000 / 84 min | unchanged |
| `critic` floor / `max_tokens` / stream deadline | 102,000 / 102,000 / 86 min | **110,000 / 128,000 / 108 min** |
| `critic` model / thinking / effort | `claude-sonnet-5` / disabled / none | **`claude-opus-5-5` / adaptive / `high`** |
| `critic` headroom under cap for thinking | 26,000 (unused: thinking was disabled) | 18,000 at the contract floor; reserve required: 16,000 |
| GBP `localKeywords` maximum | 6 | **2** (Instagram, Facebook: 6) |
| CLI ceiling for one full six-stage run | ~$9.54 | ~$11.28 |
| CLI ceiling for one critic-only replay | — | ~$2.97 |

The critic's stream deadline is now derived from the `max_tokens` its request sends (128,000),
not from its floor (which would give 93 minutes): the deadline must cover what the request may
actually stream. `POLICY_STREAM_DEADLINE_MS` moved from `payloadContract.ts` to `modelPolicy.ts`
for that reason. The critic's floor, 110,000, exceeds the one-fifth-reserve sizing rule PR #85
applied (≤ 102,400); that rule sized plumbing margins for thinking-disabled budgets and is
superseded for the critic by `THINKING_RESERVE_TOKENS`, which bounds the same headroom directly.

**Material design decision — reversing "thinking disabled = visible-output guarantee", for the
critic only.** PR #54 disabled thinking on every stage so that `max_tokens` was exactly the
visible budget. Claude Opus 5.5 cannot run that way — disabled thinking is a 400 at every effort
— so choosing it for the critic means giving up that guarantee for the critic. The other two
policies keep it. Rejected alternatives:

- *(a) Keep Sonnet 5 with thinking disabled.* It keeps the guarantee, but it missed the most
  serious defect in the 2026-09-23 package.
- *(b) Opus 5 with thinking disabled.* It keeps the guarantee — Opus 5 accepts disabled thinking at
  effort `high` or below — but Opus 5 is now the legacy Opus, and the owner chose Opus 5.5.
- *Server-side or middleware refusal fallbacks.* Rejected: a fallback answers silently with a
  different model, which a stage whose metadata records its model must not do.

**What the reference says — quoted from the `claude-api` skill, `shared/model-migration.md` →
"Migrating to Claude Opus 5.5".**

- Thinking: "On Claude Opus 5.5 thinking is **always on**: `{"type": "disabled"}` and `{"type":
  "enabled", "budget_tokens": N}` both return a 400 `invalid_request_error` at every effort level".
- Effort: "The API default is `medium` (Claude Opus 5 and earlier Opus models default to `high`), so
  a request that omits `effort` now runs one level lower than it did. **Set `effort` explicitly**".
- `max_tokens`: "**Size `max_tokens` for the thinking as well as the reply.** Thinking counts toward
  `max_tokens` even though its text isn't returned under the default `display`, so a limit sized for
  a no-thinking route cuts replies off."
- Refusals: "A classifier decline arrives as a normal HTTP 200 with `stop_reason: "refusal"` and a
  `stop_details` object naming the category (`"cyber"`, `"bio"`, `"reasoning_extraction"`, ...)";
  and "a prompt that pushes the model to reproduce its internal reasoning in the response can be
  **declined** with `stop_details.category: "reasoning_extraction"`".
- The same section recommends shipping a fallback opt-in; that advice is **deliberately not
  followed**, for the reason above.

**`agents/final-critic.md` audit.** No line tells the model not to think or reason, so nothing was
deleted. No line asks it to reproduce its reasoning in the answer, so no line is flagged as a
`reasoning_extraction` risk. The three lines nearest either rule, and why neither applies: line 22 ("No
semantic truth-checking you cannot back up") limits claims, not thinking; line 58 ("No prose before
or after it, no markdown fence, no commentary") constrains the output shape; line 105 ("say in
`summary` that you ran out of room") asks for a fact about the review, not its reasoning. The file
is unchanged.

**Migrations / schema impact:** none.

**Automated validation.** Build and typecheck clean; `npm run test:offline` ALL PASS on all nine
suites — 1,595 checks (1,560 before): content-intelligence **1,092** (was 1,057), posting 52,
image 18, orchestrator 119, gate 56, API 51, render-identity one invariant pass, ownership/recovery
112, interval monitor 94. `npm run test:payload-mutation` **ALL PASS — 355 mutations** (346 before),
the nine new ones (`M347`–`M355`) appended after every earlier group so no existing id moves, each
reported by name, and the authoritative checkout's bytes and Git status unchanged throughout. New checks: `CC19b` (thinking
reserve), `CD0f2` (allow-list), `CD7a` (per-platform keywords), `BQ36a`/`BQ36b` (GBP cap, others
unchanged), `CI1`–`CI8` (critic model, thinking, effort on the wire, re-sited invariant, pricing),
`CH1`–`CH8` (every stop reason; legacy request and `collect()` unchanged), `CE7` and `CG1`–`CG10`
(replay ordering, and the real CLI driven offline through every refusal). `MR7` in the orchestrator
suite now covers every id a stage policy resolves to, `claude-opus-5-5` included, in `sdk.ts` and in
the CLI's estimate table.

**Production evidence:** none, and none is possible — no stage is enabled or reachable. **No live
model call was made by this change.**

**Rollback / recovery:** revert the commit. No migration and no durable state; `run-meta.json`
and replay directories already written under `local-output/` are local run records.

**Security and privacy implications.** The critic now thinks; its thinking is billed as output and
bounded only by `max_tokens`. Refusals surface as named failures rather than being answered by
another model. The replay reads only operator-local files and writes only a new directory. The
full live run gains a typed `LIVE` confirmation — a behaviour change for a spend path, which only
makes spending harder. No claim, tool, approval rule, autonomy boundary or publishing instruction
changed; the Phase-A approval gate and the live `brand-compliance-critic` are untouched.

**Accepted limitations.**

- **The critic has no visible-output guarantee.** If it thinks past the reserve and writes a
  maximal answer, the response stops at `max_tokens` and the stage fails closed.
- **`THINKING_RESERVE_TOKENS` and effort `high` are unmeasured starting points.**
- **A replay of a run that predates `run-meta.json` proves less**: the automotive file's identity
  and the pack projection cannot be checked, only confirmed and revalidated.
- **Opus 5.5's own refusal behaviour on this critic prompt is untested.** The broader classifier set
  (`bio`, `reasoning_extraction`) could decline a benign critique; that is now a visible failure.

**Unresolved follow-ups.**

- ~~**Blocking:** the PR number and merge SHA above (mutable-identifier exception).~~ **Closed:**
  PR #87 and merge `dcde85b` are recorded above.
- Tune `POLICY_EFFORT.critic` and `THINKING_RESERVE_TOKENS` from measured critic-only replays of
  the 2026-09-23 run.
- Findings 1 and 2 of the output-field classification record remain open for the same owner.

**Documents updated at completion:** [README](../README.md), [Status](STATUS.md) (the stage
policy sentence inside the PR #54 record, and the dated three-budget clause beside it),
[Environment](ENVIRONMENT.md), [Architecture](ARCHITECTURE.md), [Testing](TESTING.md),
[AI handoff](AI_HANDOFF.md) (including a pre-existing stale "zero commits after `A`" clause, re-tensed
as the dated snapshot it is), [Security and continuity](SECURITY_AND_CONTINUITY.md),
`agents/packaging-adaptation.md`, and this file.

## Decided — stage 1 `maxIds` stays 12 — `DECIDED`

**Dated addition, 2026-09-25: stage 2's `maxAllowedClaims` is raised to 16 by the owner; `maxIds` stays 12.** After the run of 2026-09-25, in which stage 2's twelve-claim whitelist squeezed out the makes, the oil specification and the records, the owner raised stage 2's cap only — stage 1's `maxIds` and stage 3's `maxClaimUses` stay 12 — and had the identity records attached by code (*Evidence-pack scoping in the local CLI …*, at the top of this file). That supersedes the half of the rejected alternative below that concerned `maxAllowedClaims`; the rest of this decision stands.

**Decided 2026-09-23 by the owner: keep `STRATEGY_LIMITS.maxIds` at 12.** This closes the item
previously recorded here as *Open — decide stage 1 `maxIds` (12) after the next complete run*,
whose text is preserved below.

**Evidence.**

- **Run 1:** stage 1 used 12 of 12; the call-to-action facts went uncited; 5 of stage 2's 12 allowed
  facts went unused downstream.
- **Run 2 (`2026-09-23T17-07-15-470Z`):** stage 1 used 12 of 12; stage 2 permitted 12 of 12, and said
  it "dropped … only for the ceiling"; stage 3 used 10 of the 12; stage 5 used 22 of its 24
  claim-use bindings.
- **Raising stage 1 or stage 2 only moves the bottleneck.** Stage 3 already used fewer than it was
  permitted, and stage 5 sat near its own ceiling; a wider stage 1 would hand downstream stages more
  than they spend.
- **The missing call to action is fixed structurally**, by the deterministic contact line (`MERGED`
  through PR #88; its record is under *Merged repository change awaiting rollout* above): contact
  details no longer compete for citation slots.

**Rejected alternative: raising `maxIds` and `maxAllowedClaims` to 16.** The code treats widening
an id channel as an authority change, not slack — `maxIds` sizes what later stages may cite — and the
measurements above show the extra room would not be used where the defect was; the defect was the
contact facts competing for slots at all.

*Preserved as written before the decision:* On 2026-09-23 `supportingFactIds` was 12 of 12. The
facts the close needed — `approved-facts:perks`, `approved-facts:phone`, `approved-facts:bookingurl`
— went uncited, and 5 of stage 2's 12 allowed facts went unused downstream. The code treats widening
an id channel as an **authority change, not slack** (see the output-field classification record):
`maxIds` sizes what later stages may cite. Decide after the next complete run, on its measurements,
not before.

## Open — the evidence pack is at its 64-record cap — `OPEN`

**Observed 2026-09-23:** the operator's evidence pack held **64 records — 37 local automotive facts
and 27 approved facts — exactly `EVIDENCE_LIMITS.maxProjectedRecords` (64).** `buildEvidencePack`
refuses a pack of more than 64 records, and the local CLI passes no subject or tag scope, so it
projects every record it loads. **The next fact added to either file will be refused** until the
CLI scopes the pack to the brief or the cap changes. Which of those to do — and, for a cap change,
its derivation review, since the cap sizes the `EVIDENCE` block and the stage 1 and 2 payloads — is
**open, and not decided here.**

*Dated addition, 2026-09-25:* the CLI can now scope the pack (`--scope-tags`, with the contact-line
and identity records always included, and `--list-tags` to see what each tag would bring in); see
*Evidence-pack scoping in the local CLI …* at the top of this file. The cap is unchanged at 64, and
an unscoped run still projects every loaded record, so this item stays open until the owner chooses
scopes — or a cap change — for the facts files as they grow.

*Dated addition, 2026-09-26:* Lane S raises approved facts from 27 to 30. With the owner's 37 local
automotive facts, an unscoped run now projects 67 and is intentionally refused before any paid
call. Local runs therefore need `--scope-tags` including `approved-facts` and at least one relevant
automotive tag; the cap remains unchanged. A fake-runner run scoped to `approved-facts,lane-s-auto`
built 31 records and completed all six stages.

*Dated addition, 2026-09-26 (stage 5 `claimUse` cap change):* the owner's scoped dry pass
`2026-09-26T14-27-21-098Z` built a 44-record pack under its recorded `--scope-tags`, and the live
run that followed reached stage 5, where the separate `claimUse` defect refused it (see the record
at the top of this file). Scoping is working as intended; the cap remains 64 and this item stays
open for the same reason as before.

## Model lineage — Claude Opus 5 is now legacy

Claude Opus 5.5 succeeds Claude Opus 5 in the Opus line. Opus 5 remains served and still backs
`reasoning-heavy` (stages 1 and 2), unchanged; the legacy path's pins are unchanged. New Opus-tier
work should name Opus 5.5 explicitly.

## PR #57 — CC5 proposition-bound reconciliation and bounded closeout — `MERGED`

**PR / merge:** PR #57. Base `53e2c2bb6115e457670c1f99956d11a1a54530cd`; reviewed head
`6afe6ce91914de0b2eb45d4257e10bb784f0d0b3`; merge `2f76679afa78721ad9751ea7ce3124c5307b090c`.
**Ordered parents: `8cd14f92df3b2ffcfcf33ff6b2e526c4875983bd` then `6afe6ce9…`.** The first parent is
the merge of **PR #59**, which landed on `main` between this PR's base and its merge; the recorded
base `53e2c2bb…` remains an ancestor of that first parent. Nineteen commits, linear, zero merge
commits within the branch.

**Delivered scope.** `CC5` made proposition-bound in both claim directions; unmatched closing
parentheses made a **structural** failure before predicate classification, with the unsafe
recovery-through-`)` removed; 152 mutation payloads corrected from a literal `\n` escape to real
newlines; the remaining 007 live-state claims corrected; and three documentation defects fixed
(the `M268`–`M285` breakdown, the offline-suite count in `AGENTS.md`, and a malformed guarantee
sentence in this file and in the runtime `CC5` label).

**Migrations/schema impact:** **none.** Executable SQL is byte-identical to base — comment-stripped
SHA-256 `6e3972267fe95e99…` (migration) and `21a8ac8b479e309e…` (rollback).

**Automated validation at the reviewed head.** Typecheck, build, eight offline suites (1,367
assertions), 285 mutations ALL PASS (239 prohibited, 206 naming `CC5`, 46 `mustPass`, 252 `CC5`
total; 285 byte-for-byte restores, 0 FAIL), dry run, controller fixtures, Markdown links, environment
coverage, sensitive scan, dependency audit, YAML, whitespace. Exact-head CI run
[34630277875](https://github.com/Caposhi/GCD-Agents/actions/runs/34630277875) — five of five jobs
`success`, each `run_attempt: 1`, no re-runs.

**Bounded-closeout verdict at that merge.** The PR closed out **bounded**: the reconciliation landed
and the remaining `CC5` syntax-hardening work was **explicitly deferred**, not completed. The
subsequent whole-file authority replacement recorded immediately below resolves that follow-up in
repository source without rewriting this historical verdict.

**Accepted limitation at that merge — `CC5-SYNTAX-001`, then `OPEN` and deferred.** `CC5` does **not** reject past
`remain`/`stay` application-state declarations (*"Migration 007 remained unapplied."*, *"… has
remained unapplied."*, *"… stayed unapplied."*, *"… has stayed unapplied."*) or their contextual-*It*
shapes, because `FINITE_AUX` matches only the present `remains?`/`stays?`. It is **not fixed, not
resolved, not harmless, and not production-validated.** Compensating controls and the mandatory
completion trigger are recorded in
[Known issues and hardening](KNOWN_ISSUES_AND_HARDENING.md) and summarized in the backlog below.

**Production evidence: none.** Merge changed repository state only. It authorizes no production
wiring, no enablement, no migration application, and no operator milestone.

**Documents updated at completion:** `README.md`, `AGENTS.md`, `docs/AI_HANDOFF.md`,
`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/KNOWN_ISSUES_AND_HARDENING.md` (new),
`docs/PRODUCTION_WIRING_DESIGN.md`, `docs/ROADMAP.md`, `docs/SECURITY_AND_CONTINUITY.md`,
`docs/STATUS.md`, `docs/TESTING.md`, `docs/credentials-setup.md`.

**Unresolved follow-ups at that merge.** `CC5-SYNTAX-001`, subsequently resolved by the replacement
control below; and the M1 readiness prerequisites below, none of which this merge advanced.

## Completed — CC5 whole-file SQL-authority hardening (PR #63)

**State / provenance.** `MERGED` through PR #63. The independently reviewed head
`c89f38a6f11805cb609deed89ef42cf86b95931b` merged as
`9e1efc2ae47761f3e2d3d4230c84ff314e745ab4`, whose ordered parents are exactly
`1c9e89ee514c7e88189ef0c385ad6403bfd9b0ab` then that reviewed head. The original package branch
was created from `ed17e6acb5f08e5ccf242ca4a4129f307b642809` (PR #61's merge); the final merge
used the independently validated updated `main` parent `1c9e89ee514c7e88189ef0c385ad6403bfd9b0ab`.
The source was independently accepted as a prototype at exact head
`0904c1ecbc682aa6e1b97f82051ab1deddf67419`, based on
`2f76679afa78721ad9751ea7ce3124c5307b090c`, with verdict `PROTOTYPE READY FOR PR PACKAGING`.
The historical prototype branch remains preserved at that head, unmerged, unrebased, and
unrepurposed inspection evidence. Independent packaging-PR inspection gave the reviewed package
its merge verdict. The merged scope is exactly 10 files, `+1,572/−252`.

**Defect and threat.** `CC5-SYNTAX-001` demonstrated that an English recogniser could miss a
categorical application-state claim in either authoritative SQL comment. Past
`remain`/`stay` forms were the reproduced bypass, but the defect class was any unrecognised
English construction or parser boundary that allowed an unreviewed byte change to survive while
the grammar test stayed green.

**Delivered scope.** A versioned, closed `src/harness/sqlAuthority.json` owns exactly, and in
order, migration 007 and its rollback. Each entry pins the raw whole-file SHA-256; the manifest's
own raw SHA-256 is independently pinned in `src/harness/sqlAuthority.ts`. Identity is calculated
without SQL parsing, comment filtering, trimming, normalization, newline conversion, or
decode/re-encode. The manifest is hashed before fatal UTF-8 decoding and recursive,
duplicate-decoded-key-aware parsing. Literal and escaped-equivalent duplicates are rejected at
every object depth; schema keys and ordered paths are closed; manifest and SQL inputs must be
regular files opened without following symlinks.

The two SQL artifacts are unchanged. Their raw digests remain migration
`fb5128b4ae207e75b7c6b2798519594c72b7d91191b7055a674c22fafdf2ddca` and rollback
`31e0ab0c1f92ccafbd30fb827b4ece9856257a997c39ad5fb031bc18cebfe122`; the raw manifest
digest is `a420015da9d25133b6572f93eeb83e5a70109589fbafce77fbffbbce2e296121`.

**Migrations/schema impact:** **none.** Neither SQL artifact changes and this work applies
nothing. Migration 007 is now production **`APPLIED`**, independently verified via M1
(2026-09-18) — see [Status](STATUS.md). This work executes no M1 step and contacts no
production database or Render service.

**Material design decisions.** Repository authority is raw whole-file identity, so there is no
grammar insertion zone and no byte outside review. A legitimate SQL or comment change is one
coordinated review-visible update to the artifact bytes, its manifest digest, and the external
manifest pin. The mutation harness copies the repository to a disposable no-Git workspace and
performs raw-buffer mutation/restoration there; the authoritative checkout is never a mutation
target. A bounded child is killed with `SIGKILL` while its disposable target is modified, and the
parent proves authoritative bytes and Git status remained unchanged during and after interruption.

**Material rejected alternatives.** Expanding the English grammar was rejected because it
repeats the bypass class instead of removing it. Comment-stripped or parsed-SQL identity was
rejected because comments, whitespace, encoding, line endings, and parser boundaries would remain
outside authority. A canonical insertion zone or sentence allowlist was rejected because
placement, concatenation, and residual bytes recreate an interpretation boundary. A self-pinned
manifest was rejected because it could redefine its own authority. Decode-before-hash was rejected
because normalization or lossy replacement can collapse distinct bytes. Mutation of the
authoritative checkout with best-effort cleanup was rejected because `SIGKILL` is uncatchable.

**Automated validation and mutation evidence.** The source inventory contains **341 unique
mutations: 339 prohibited and 2 coordinated-authority-update cases**. The 46 former grammar
`mustPass` cases are now prohibited uncoordinated byte changes. The only positive cases change
one SQL artifact and update its manifest digest and the independent source pin together. The run
also proves no-Git workspace isolation, raw-buffer restoration, regular-file/symlink enforcement,
raw manifest hashing before fatal decode, recursive literal/escaped duplicate rejection, closed
schema/order, representative raw-byte identity changes, and bounded `SIGKILL` isolation.

On the packaging branch, Node 22.23.2 passed locked install, typecheck, build, the eight offline
suites (**1,374 checks**), simulated dry run, deployment-controller fixtures, Markdown links,
environment coverage, sensitive-content scan, production dependency audit (**zero
vulnerabilities**), and the complete 341-mutation suite. The independent source derivation found
317 legacy definitions plus 24 raw-identity cases, 46 former allowances, the same 339/2 split, and
12 captured paths. Disposable PostgreSQL 16.15 and 18.6 each passed **208** integration checks;
after migrations 001–007 were applied to separate dedicated databases, each passed the bound HTTP
suite (**68/68**). Both disposable containers were removed. Checksum-verified actionlint 1.7.12
and independent checked-in-YAML parsing passed. AgentShield 1.4.0 exited successfully with grade A,
score 93, zero critical and zero high findings; its five medium oversized-agent and six low
unspecified-model findings pre-exist this scope. Original exact-head CI run `34861663186` completed
five successful first-attempt jobs. The updated-base validation was conflict-free, applied exactly
the reviewed 10-file change, preserved the three newer-main files byte-for-byte, and passed the
complete 341-case mutation harness against the prospective combined tree. Post-merge CI run
[`34874131925`](https://github.com/Caposhi/GCD-Agents/actions/runs/34874131925) completed five
successful first-attempt jobs at merge commit `9e1efc2ae47761f3e2d3d4230c84ff314e745ab4`.
Deployment workflow run [`34875056304`](https://github.com/Caposhi/GCD-Agents/actions/runs/34875056304)
accepted CI provenance and then refused at the disabled-automation gate. Release selection was
skipped; the serialized API, worker, scheduler release job was skipped and executed zero steps;
`scripts/render/deployment-controller.mjs` did not run. This observes no GitHub-driven deployment
through that workflow; unrelated Render-side activity is `NOT ESTABLISHED`.

**Trust boundary and limitations.** This is repository-content authority, not proof of production
database state. It cannot prevent a reviewer-approved coordinated malicious change, authenticate a
reviewer, prove deployment, or establish the live `_migrations` set. The bounded legacy grammar
checks remain defence-in-depth and historical regression coverage; they are **not semantic truth
verification** and still do not recognise arbitrary English. Production evidence is **none**. All
six executors remain disabled and unreachable.

**Rollback/recovery status.** Revert the repository control while leaving the SQL artifacts
unchanged. That reopens the repository-authority defect but applies or rolls back no migration and
requires no Render, provider, approval, or production cleanup. Migration 007's production state is
now established `APPLIED`, independently verified via M1 (2026-09-18, see [Status](STATUS.md)). Any
database rollback of migration 007 remains separately authorized and must begin by confirming that
applied state read-only.

**Security/privacy implications.** An unreviewed byte change anywhere in either SQL artifact now
fails closed. The control reads repository files only; no credential, PII, provider, database, or
network boundary is added. A coordinated malicious review remains inside the trust boundary and is
an accepted limitation, not a claim this mechanism can solve.

**Follow-up ownership.** Packaging and independent inspection are complete. Future legitimate SQL
changes are owned by their author and reviewer as one coordinated artifact/manifest/source-pin
change. Production and migration operations remain separately owned and separately authorized.

**Documents updated for packaging and post-merge reconciliation:** `README.md`,
`docs/KNOWN_ISSUES_AND_HARDENING.md`, `docs/M1_READINESS_DECISION_RECORD.md`,
`docs/ROADMAP.md`, `docs/STATUS.md`, and `docs/TESTING.md`. No other active document
changes meaning or becomes contradictory.

## Completed — M1 readiness evidence package (PR #60)

**`MERGED`.** Base `2f76679afa78721ad9751ea7ce3124c5307b090c`, reviewed head
`d67dcb5158bc2847cc8f1b6190a649c89546e26b`, merge `2a9edb7f86a07ddb7c27bc91e3c214052d0a2dc4` —
**ordered parents exactly that base then that reviewed head**. Five files, +1138/−1; five linear
commits, zero merges.

**Delivered.** The [M1 readiness decision record](M1_READINESS_DECISION_RECORD.md); this roadmap and
[Status](STATUS.md) reconciliation; and two checked-in read-only operator scripts —
`scripts/ops/evidence-aggregate-audit.mjs` (§4.1 aggregate-only audit) and
`scripts/ops/migration-state-read.mjs` (§4.4.2 complete migration-state reading, all seven
comparisons).

**Migrations/schema impact: none.** No `src/`, `state/`, workflow, `render.yaml`, or mutation-harness
path was touched. Migrations remain `001`–`007` with no `008`.

**Material design decisions.** Migration identity is the **complete filename compared byte for
byte** — never a numeric prefix, never a trimmed form — because `_migrations` stores the filename and
`src/state/migrate.ts` applies exactly the entries whose real name ends in `.sql`. Filenames are read
NUL-delimited (`git ls-tree -z`) so git's path quoting cannot corrupt them. `--artifact` must name a
**commit object**, verified with `git cat-file -t`. Failure output emits only a **fixed category
chosen in the script**, never the driver's message and never its server-chosen SQLSTATE. Bounds are
read from `payloadContract.ts` → `EVIDENCE_LIMITS` so the audit cannot drift from the contract it
checks, and `GCD_AUDIT_DATABASE_URL` is deliberately not `DATABASE_URL`.

**Material rejected alternatives.** Comparing the pending set `P` alone was rejected: an unexpected
already-applied migration appears in both `F(A)` and `D`, cancels out of `P`, and is invisible to the
pending difference — which is why `D` is validated in its own right. Pattern-matching the shape of an
error code was rejected as a sanitizer, because a SQLSTATE is chosen by the server.

**Automated validation at the reviewed head.** typecheck 0 · build 0 · eight offline suites all pass
(1,367 assertions; 1,254 `PASS`-prefixed lines) · dry run 0 · controller fixtures 0 · Markdown links
60 files · env coverage 35
· sensitive scan 151 files · `npm audit --omit=dev` 0 · `git diff --check` clean. Exact-head CI run
`34700377391`: five jobs, all `success`, each attempt 1, no re-run.

**Production evidence: none, by design.** Neither script has been run against production. Both were
exercised only against a disposable PostgreSQL 16.13 cluster, which was removed.

**Rollback/recovery status.** Documentation and two unreferenced operator scripts; no workflow
invokes either. Reverting the merge would remove the record and the tooling and would change no
runtime behaviour, because nothing calls them.

**Security and privacy implications.** Both scripts enforce a read-only session *and* a read-only
transaction, select counts/existence/maxima only, and print no claim text, subject text, connection
string, user, host, port, or password — including on the failure path. Verified by leak scan: zero
occurrences of a supplied user, password, host, port, or database name in either script's output.

**Accepted limitations.** `_migrations` stores no checksum or content column, so every comparison is
an **identity** claim, never content integrity — byte-exact filename comparison closes the rename and
whitespace bypasses but cannot detect a file edited in place under an unchanged name. **Every
functional defect in this tooling was found by independent inspection, not by the author's own
testing** — four across two inspections, two of which returned `decision: pass` with exit 0 on inputs
that should have stopped.

**Unresolved follow-ups.** At this merge, `CC5-SYNTAX-001` remained open; the subsequent
whole-file authority replacement above resolves it in repository source. Every M1 readiness
prerequisite below remains outstanding; PR #60 advanced none of them.

**Documents updated at completion.** `docs/M1_READINESS_DECISION_RECORD.md` (new), `docs/ROADMAP.md`,
`docs/STATUS.md`; and post-merge, `docs/AI_HANDOFF.md`.

## Active product cursor — M1 complete and independently verified; M2 not authorized

**M1 is complete and has been independently verified against live provider state (2026-09-18).**
The prior verdict recorded immediately below in this section — `M1 BLOCKED / NO-GO` — was accurate
at the time it was written, when no read-only production access existed. That access was
subsequently obtained and the milestone was performed. **M1 did not authorize and did not begin
M2.** Nothing below grants authority for migration `008`, executor enablement, or any other M2
step; **P1–P8, migration `008`, production wiring, executor enablement, and the proposed Google
Business Profile expansion remain not begun and not authorized.**

**Tier 1 — verified directly against live GitHub/Render/Postgres state.**

- API service `gcd-social-api` (`srv-d8u0qtpo3t8c73c5o44g`) is live at exact artifact `A` =
  `d5015236672a02bf8f58d342625c32a4f5acc8a1`, via deploy `dep-dam3dfv40ujc73fgidhg`
  (status `live`, `trigger: "manual"`, started `2026-09-17T18:51:43.364952Z`, finished
  `2026-09-17T18:52:47.893627Z`). The previously live deploy at exact artifact `R` =
  `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`, `dep-da8sbq0n74is73e0hgcg`, was deactivated at
  `2026-09-17T18:52:47.892086Z`.
- **Migration 007 is production `APPLIED`.** `_migrations` records `007_evidence_bounds.sql` with
  `applied_at 2026-09-17T18:52:22.268131Z` — inside the deploy window, consistent with the API's
  `preDeployCommand: npm run migrate`. The applied set is exactly `001`–`007`, each appearing
  exactly once; no migration `008` exists. No database rollback occurred, and deploy history shows
  no redeploy of `R` after `A`.
- Worker `gcd-social-worker` (`srv-d8u0qtpo3t8c73c5o440`) and scheduler `gcd-social-scheduler`
  (`crn-d8ulb4rtqb8s73bdjctg`) remain live at exact artifact `R`, via `dep-da8sjmp42hec73dvhk30` and
  `dep-da8siupsrm7s73afv6u0` respectively; no deploy on either since 2026-08-28. **This was
  deliberate: M1 deployed the API only**, so migration 007 applied while worker and scheduler stayed
  at `R`.
- All three services report `autoDeploy: "no"` / `autoDeployTrigger: "off"` — native Render
  auto-deploy is disabled. The API's `preDeployCommand` is exactly `npm run migrate`.
- CI run `35235152957` (attempt 1, `head_sha` = `A`) passed all five required jobs, completing
  `2026-09-17T14:50:12Z`.
- **The M1 deploy was not produced by GitHub deployment automation.** The service's own deploy
  history distinguishes `new_commit` (auto-deploy), `api` (Render API call), and `manual`
  (dashboard); the M1 deploy record is `manual`.
- The scheduler's cron continues to run on its normal daily schedule (`0 13 * * *`), most recently
  `2026-09-18T13:01:23Z`. **Correction:** this is expected behavior at `R` with all six executors
  disabled; any statement elsewhere asserting no scheduler runs occur is wrong and has been
  corrected wherever found in this sweep.

**Tier 2 — established by the prior independent inspection, not re-verified here.** All 11
migration-007 constraints validated; all 23 canonical aggregate checks within bounds; all six
executors remain disabled and unreachable; no provider call, approval, or publication occurred.

**Tier 3 — open limitations, recorded rather than resolved.**

- Render exposes no field recording whether the operator selected an immutable specific commit or
  "latest commit" when triggering the manual deploy. This is permanently unanswerable from provider
  evidence. It has no effect on the deployed artifact: the deploy record immutably names commit `A`,
  and **as a dated snapshot at the 2026-09-17 deploy** `main` was at `A` with no commit after it, so
  either selection resolved to `A`. **`main` has since advanced well beyond `A`** — the exact
  current `main` and the exact distance are a Git/GitHub lookup, not fields this file maintains: run
  `git rev-parse origin/main` and `git rev-list --count <A>..origin/main`; see [Status](STATUS.md)
  for the current record. That advance carries documentation and **dormant, undeployed**
  `src/harness/` stage-executor source; it is not documentation alone. It still cannot reach the
  service: auto-deploy is off on all three services, so the deployed artifact cannot drift from `A`
  without a new authorized deploy. The Tier 3 limitation itself is unchanged — which selection the
  operator made is still unanswerable, and still immaterial.
- Render exposes no deploy-level actor-identity field. Who performed the deploy cannot be
  established from provider evidence.
- The repository-scoped GitHub Actions variable `RENDER_DEPLOY_AUTOMATION_ENABLED` was read in the
  authenticated GitHub UI on 2026-09-18 as exact lowercase `false`. Its last-updated timestamp
  predates M1 (2026-09-17), so the variable was not changed by or during M1. This document does
  not claim GitHub deployment automation is currently disabled as a system; the evidenced claims
  are the gate variable's value and the narrower Tier 1 one above, that the M1 deploy specifically
  was not produced by automation.

**The authorized recovery path is unchanged should it ever be needed: redeploy exact `R` to the API
only, leaving migration 007 applied.**

### M1→M2 interval — owner, bound, and monitoring (recorded 2026-09-18)

[PRODUCTION_WIRING_DESIGN.md's M1 exit conditions](PRODUCTION_WIRING_DESIGN.md) state that for the
whole M1→M2 interval, the interval must be **explicitly time-bounded**, actively **monitored**, and
**owned by the named operator** who performed M1. None of those three had been recorded until now.
This section records them; it does not begin, schedule, or imply M2, and it does not authorize
P1–P8, migration `008`, or executor enablement.

**Owner.** Michael Capote, CTO, Alan Gelfand Inc. DBA German Car Depot, attests accountability for
this interval as the operator who performed M1. This is recorded as the operator's own attestation
of accountability, made to satisfy the design's named-owner requirement. **It does not make the M1
deploy attributable in provider logs.** Render exposes no deploy-level actor-identity field (Tier 3,
above), so provider evidence does not and cannot independently establish who performed the M1
deploy; the attestation and that evidentiary gap are separate facts, and this attestation does not
close it.

#### M1→M2 interval — re-authorization (recorded 2026-09-22)

Authorized by: Michael Capote, CTO, Alan Gelfand Inc. DBA German Car Depot — the named operator who performed M1 and the owner of record for this interval.

Action taken: outcome (b), explicit re-authorization of the partial-release interval under a new bound, decided on 2026-09-22, two days before the `2026-09-24T18:52Z` decision point rather than at it. M2 was not performed and is not declared complete. The worker and scheduler remain at exact artifact `R` = `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`; the API remains at exact artifact `A` = `d5015236672a02bf8f58d342625c32a4f5acc8a1`. The recovery path was not taken.

New bound: `2026-10-22T18:52Z`. This supersedes the `2026-09-24T18:52Z` bound and nothing else. Every other term of the interval remains in force unchanged.

Stated reason. The partial-release state has been verified twice: a read-only human pass on `2026-09-21T15:28:38Z` covering all four required checks, and an automated six-check pass on `2026-09-22T17:08:36Z`. Both found the state unchanged. M2 is a controlled reconciliation requiring its own preflight, gates and post-deployment verification, and is not work that should be compressed to meet a calendar date. Extending the bound is therefore preferred to performing M2 under time pressure, or to performing a production deploy on a demonstrably healthy system in order to take the recovery path.

Monitoring — the condition is now met, for the first time since M1. The prior interval's monitoring requirement went unmet: no daily check was ever established and none ran on any day. That is not retroactively fixable and is not claimed to be. For this interval:

* A daily read-only check runs as the `Interval monitor` GitHub Actions workflow (.github/workflows/interval-monitor.yml, merged in PR #83 at `b8f12f3`), scheduled `0 14 * * *`. It outlives any session and keeps a durable, inspectable run history — the two properties the previous attempt lacked.
* It performs six checks: the API's live artifact and health via `/healthz`; the applied migration set; scheduler liveness via `brief_queue`; the deployment-automation gate variable; the `deploy-production` refusal history; and interval context. A check that cannot be performed reports `NOT CHECKED` and fails the run; it never reports a pass on incomplete evidence.
* That behaviour was demonstrated rather than assumed. Run #1 on `2026-09-22T16:52:36Z` failed because the database credential was wrong, reporting two checks as `NOT CHECKED` and refusing an all-clear. Run #2 on `2026-09-22T17:08:36Z` returned ALL CLEAR: API live at exact `A` and healthy; `_migrations` holding exactly `001`–`007` with no `008`; newest `brief_queue` row `2026-09-22T13:00:52.389Z`, 4.1 hours before database `now()`; `RENDER_DEPLOY_AUTOMATION_ENABLED` exactly `false`; and no `deploy-production` run concluding `success` across 48 runs inspected.
* Two things the automated check does not cover, stated plainly rather than implied: the deploy identity of the worker and scheduler, and the Render native auto-deploy setting. Both require Render credentials the workflow deliberately does not hold, because the only Render API key available is account-wide with write authority and does not belong in an unattended job. Both remain covered by human verification passes.
* Two full read-only verification passes with Render and PostgreSQL access are scheduled: one at approximately `2026-10-08`, and one before the `2026-10-22T18:52Z` decision point. The expiry decision requires the second, exactly as the prior interval's did.
* The compensating controls remain in force and are not a substitute for monitoring: Render native auto-deploy is `no`/`off` on all three services, and the `deploy-production` workflow has refused at its "Refuse while production automation is disabled" step on every `main` merge since the interval began.

Standing prohibitions, unchanged and in force for the whole extended interval: ordinary automated deployment is prohibited and the controller must not be forced past it; no unrelated release may occur, of any service, for any reason; the interval remains explicitly time-bounded, owned as recorded above, and monitored as scoped above.

This re-authorization authorizes nothing else. It does not begin, schedule or imply M2. It does not authorize P1–P8, migration `008`, production wiring, executor enablement, or the Google Business Profile expansion. It does not authorize the recovery path. Each requires its own explicit authorization. The recovery path remains available and unchanged: redeploy the API to exact `R`, leaving migration 007 applied.

Open follow-ups recorded with this authorization:

* The `0 14 * * *` scheduled trigger has never fired. Only `workflow_dispatch` is proven. Confirm the first scheduled run lands on 2026-09-23; a scheduled workflow that silently never runs is the failure mode that ended the previous attempt.
* docs/STATUS.md line 126 still states that `main` "remains at `A` with zero commits after." That is false — `main` has advanced well beyond `A` — and it is corrected by this change.
* The monitor connects with `sslmode=require`, which the current `pg` driver treats as `verify-full` and which will adopt weaker libpq semantics in `pg` v9. Pin the intended mode explicitly before that upgrade.

#### Interval record as first set (recorded 2026-09-18) — bound superseded above

**Interval bound.**
- Start: `2026-09-17T18:52:47.893627Z` — the finish time of the M1 API deploy
  `dep-dam3dfv40ujc73fgidhg`.
- Expiry: `2026-09-24T18:52Z` — **superseded** by the 2026-09-22 re-authorization above, which
  set the new bound `2026-10-22T18:52Z` under outcome (b). Preserved as history.

Expiry is a decision point, not a cliff. On or before expiry, exactly one of the following three
outcomes must occur, and **none of them is automatic**:

  (a) M2 is complete; or
  (b) the interval is explicitly re-authorized by the named owner, with a new stated bound and a
      stated reason; or
  (c) the recovery path (below) is taken.

Each of (a), (b), and (c) requires its own explicit authorization from the owner. **Reaching the
expiry date does not, by itself, authorize M2, and does not, by itself, authorize the recovery
path — it obliges a decision, nothing more.**

**Recovery path.** Exact-`R` post-007 compatibility was established in the 2026-09-16
rollback-compatibility review, so the available recovery path is to redeploy the API to exact
artifact `R` = `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`, returning all three services to
agreement. **This does not unapply migration 007** — the database stays ahead of the code until
007's rollback file (`state/rollback/007_evidence_bounds_rollback.sql`) is separately authorized
and applied.

**Monitoring — prior interval, to the superseded `2026-09-24T18:52Z` bound; preserved as history.** For the extended interval, the monitoring condition is recorded as met in the re-authorization above. The M1 exit conditions require this interval be actively monitored. **That condition is unmet.** No daily automated check was ever established, and none has run on any day of the interval. A Routine was created self-bound to the originating session, fired once as a test whose result was never seen, and does not exist now — a current listing of this account's Routines, including completed ones, returns zero.

In its place, two preventive controls have held, with evidence:

  - Render native auto-deploy off on all three services (`gcd-social-api`, `gcd-social-worker`, `gcd-social-scheduler`) and `RENDER_DEPLOY_AUTOMATION_ENABLED` exactly `false`, both as of the 2026-09-18 verification — a dated observation, not current truth.
  - The `deploy-production` workflow has refused at its "Refuse while production automation is disabled" step on every `main` merge since the interval began: eight runs, run `35368071350` (run #33, 2026-09-18T16:22Z) through run `35448454979` (run #40, 2026-09-19T14:21Z), each failing at exactly that step.

These are compensating controls, not the promised monitoring, and neither one checks the migration set or the API's live artifact/health on any cadence. **An implementation of the promised daily check now exists and is `IMPLEMENTED` — see [the interval monitor record](#m1m2-interval-monitoring--daily-read-only-drift-check--merged) below. It does not by itself close this condition:** it is not merged, and it has never fired. A green pull request proves the monitor's logic and its agreement with this record; it does not prove that GitHub schedules the workflow, that the `monitoring` environment resolves its secret, or that the read-only role can read what it is granted. The condition stays **unmet** until a real firing is observed. **Update 2026-09-22:** the monitor has since merged through PR #83 (`b8f12f3`) and fired twice by `workflow_dispatch` on `main`; the re-authorization above records the monitoring condition as met for the extended interval, as scoped there, and records that its `0 14 * * *` scheduled trigger has not yet fired. A single read-only verification of the four checks below is scheduled before the 2026-09-24T18:52Z decision point, and the expiry decision requires it. The re-authorization above records that verification as a read-only human pass on `2026-09-21T15:28:38Z` covering all four checks. The four checks that verification must cover:

  1. no new deploy on `gcd-social-api`, `gcd-social-worker`, or `gcd-social-scheduler`;
  2. the applied migration set is still exactly `001`–`007`, with no `008`;
  3. the API is still live at exact artifact `A` = `d5015236672a02bf8f58d342625c32a4f5acc8a1` and
     reporting healthy;
  4. the scheduler cron is still completing successfully on its `0 13 * * *` schedule.

As of 2026-09-18, the scheduler had completed one full daily cycle after migration 007 was applied
(last success `2026-09-18T13:01:23Z`), so the split has survived at least one cycle.

**Standing prohibition, in force for the whole interval** — quoted from the design's own terms:
"ordinary automated deployment is prohibited" and the controller "must not be forced past it"; and
"no unrelated release may occur, of any service, for any reason."

**`main`/production divergence.** The deployed API artifact is exact `A` =
`d5015236672a02bf8f58d342625c32a4f5acc8a1`. `main` is ahead of `A` by commits that are not
documentation-only — they include `src/harness/` and `agents/` changes, among others — but nothing
under `src/api`, `src/worker`, `src/scheduler`, `state/migrations` or `render.yaml` has changed
since `A`, so none of the advance reaches a deployed service. The exact current `main` is a
Git/GitHub lookup, not a field this file maintains: run `git rev-parse origin/main`. **"Deploy `main`" and "deploy `A`" are not the same instruction**, and
any preflight must name which one it means. `main` must not be described as deployed.

### Prior verdict, superseded above — recorded for history

The following was the accurate verdict between PR #60's merge and the read-only production access
obtained for M1. It is preserved as the historical record of that interval and is superseded by the
verified state recorded above.

**M1 had not begun, was not authorized, and was not complete.** Merging PR #60 delivered the *evidence
package*; it did **not** complete M1 readiness and it authorized nothing. **Current verdict at that
time: `M1 BLOCKED / NO-GO`.** `L` (the commit the live api serves), the three service
commits, `D` (the production `_migrations` identifier set), `P`, comparisons 2–7 of §4.4.2, the A/L
ancestry decision, same-commit `preDeployCommand` behaviour, the §4.1 aggregate audit, and the
rollback artifact `R` with its executed compatibility evidence were all **`NOT YET EXECUTED`** —
there was no read-only production access.

The checked-in operator tooling for the two readings is delivered and exercised against a disposable
database: `scripts/ops/evidence-aggregate-audit.mjs` (§4.1, read-only, aggregate-only) and
`scripts/ops/migration-state-read.mjs` (§4.4.2, all seven comparisons).

**Successive independent inspections found four functional defects in the operator tooling, all now
corrected and all covered by regression cases.** Migration identity was compared by numeric prefix,
so an artifact whose `007` had been renamed returned `decision: pass` with all seven comparisons
`true`; every comparison now uses the complete filename. And **A1** validated only 40 hex characters,
so a Git *tree* SHA was accepted as the artifact; the object type must now be exactly `commit`. A
previous revision's claim that the scripts had **no functional defect** was false and is withdrawn.
A second inspection found two more. Filenames were **trimmed** before comparison, so an artifact whose
`007` carried a trailing space read as canonical and passed — while the runner, which selects on the
real name, would have skipped it and **never applied migration 007**; filenames are now read
NUL-delimited and compared byte for byte. And the failure path echoed a **server-chosen** SQLSTATE,
so a custom `ERRCODE` reached operator logs; both scripts now emit only fixed categories defined in
the script, and `UNKNOWN` for anything unrecognised.

## M1→M2 interval monitoring — daily read-only drift check — `MERGED`

**Update 2026-09-22 — `MERGED`, and fired by manual dispatch; the scheduled trigger is not yet
observed.** Two `workflow_dispatch` runs on `main` followed the merge recorded below: run #1
(`35756897890`) failed on a wrong database credential and refused an all-clear, and run #2
(`35758714546`) returned ALL CLEAR. The 2026-09-22 re-authorization in the M1→M2 interval section
above records the monitoring condition as met for the extended interval, as scoped there, and
records as an open follow-up that the `0 14 * * *` scheduled trigger has never fired. The rest of
this record is preserved as written at implementation; where it says *not merged*, *never fired*
or *unmet*, that was true then and is superseded by this update.

**Same change: the expiry constant and its guard.** `INTERVAL_EXPIRY` in
`scripts/ops/interval-monitor/expected.mjs` moves to the re-authorized `2026-10-22T18:52Z`. The
offline assertion that bound it to [Status](STATUS.md) was containment (`STATUS_DOC.includes`),
which cannot detect a stale constant once Status keeps superseded bounds as history — it passed with
the constant still at `2026-09-24T18:52Z`. The claim below that editing any one value alone fails CI
was therefore overstated for every containment check, and false for the expiry once a bound was
superseded. The expiry check now binds to the *current* bound (the first `New bound:` line in the
interval section, else the original `- Expiry:` line), a second check requires the original line to
be marked superseded once re-authorized. Five mutations, each
reverted, confirm it; see [Testing](TESTING.md). The other `status` checks remain containment, and
the suite comment, the `expected.mjs` header and the workflow file's header comment now say so.

**Same change: one `status` check removed, rationale relocated here and to [Testing](TESTING.md).**
The check asserting that Status still contains "**That condition is unmet.**" existed so that the
monitor's own merge or green run could not be read as closing the M1 exit conditions' monitoring
requirement — evidence is not the decision. Its premise was superseded by the named owner's
2026-09-22 re-authorization, which recorded the condition as met: **closed by an owner
authorization, with the workflow as its evidence, not by the workflow or by code.** From then on
the phrase survived only in preserved prior-interval history, and the check passed identically
whether Status recorded the current condition as met or unmet — demonstrated both ways before
removal. It is removed rather than re-pointed because nothing true remains for it to assert, and the
suite reports **94 checks**.

**State:** `IMPLEMENTED` on a branch; `MERGED` only on merge. **Not `DEPLOYED`, not `ENABLED`, not
`PRODUCTION-VALIDATED`, and explicitly not yet proof that the M1 exit conditions' monitoring
requirement is met.** It authorizes no release. The standing prohibition for the interval — *no
unrelated release may occur, of any service, for any reason* — is in force until
**2026-09-24T18:52Z** or its explicit re-authorization, and nothing here changes that.
[Status](STATUS.md)'s production tables, live SHAs, M1→M2 interval record and current cursor are
**untouched** by this change.

**PR / merge:** based on `main` at `5e7e2f036e79192a8ebd05c702921988eee81088`. **Closed 2026-09-22:**
PR #83, merge `b8f12f3fb2a43ae88d595eeee79528376b170195`, whose ordered parents are
`0c45c0a676db6b07ae7e34df76c980a854ee9d72` (the PR #82 merge) then
`5283c4aca763db7e1ec488085752b81af340883f`, verified by direct Git inspection. The original text
follows. **PR number and merge
SHA are not knowable before merging** — recorded here as a **blocking follow-up** under the
mutable-identifier exception in [`AGENTS.md`](../AGENTS.md), to be reconciled in the first change
after merge.

**The defect this closes.** [Status](STATUS.md) records that the M1 exit conditions require this
interval to be actively monitored, and that **the condition is unmet**: no daily automated check
was ever established, and none ran on any day of the interval. The prior attempt was a Routine
bound to the originating chat session. The session ended, the Routine went with it, and its single
test firing produced a result nobody ever saw. Two failure modes, both structural: the monitor did
not outlive its creator, and its output had no durable, inspectable home.

**Delivered.** `.github/workflows/interval-monitor.yml`, a scheduled GitHub Actions workflow, plus
`scripts/ops/interval-monitor/`.

- **Triggers.** `schedule` at `0 14 * * *` UTC — after the production scheduler's `0 13 * * *` run,
  so the day's `brief_queue` row exists when liveness is evaluated — and `workflow_dispatch`. There
  is **no `pull_request` trigger**, so a fork's pull request can never reach the secret.
- **Permissions.** `contents: read` and `actions: read`. Nothing else. No write of any kind.
- **Secret.** `GCD_MONITOR_DATABASE_URL`, an **environment** secret on the `monitoring` GitHub
  environment, which the job declares with `environment: monitoring`. It is a read-only PostgreSQL
  role with `SELECT` on `_migrations` and on four columns of `brief_queue`. It is never echoed,
  never placed in a URL or on a command line, and never included in any report.
- **Five gating checks**, each evaluated independently with every result reported before the job
  exits: the API's `/healthz` artifact and health against exact `A`; the applied migration set
  against `001`–`007` with no `008`; `brief_queue` liveness within 25 hours; the
  `RENDER_DEPLOY_AUTOMATION_ENABLED` gate as the exact string `false`; and the absence of any
  `deploy-production` run on `main` concluding `success` since the interval began. A sixth item —
  the current `main` SHA and the days remaining — is **informational and never gates**.
- **One source of truth.** Every expected value lives in `scripts/ops/interval-monitor/expected.mjs`.
  The workflow file carries **no** expected value, and the offline suite proves it carries no copy
  of one. The seven migration filenames are re-exported from `scripts/ops/lib/migrationState.mjs`
  rather than re-listed.
- **An offline assertion that the source agrees with the record.** `npm run test:interval-monitor`,
  now the ninth suite in `npm run test:offline`, asserts those constants against what
  [Status](STATUS.md) records **and** against the workflow's schedule, environment, secret name,
  trigger set and permission set. Editing any one of them alone fails CI. This is deliberately the
  same shape as the `CD`/`CF` guards that hold the stage prompts and their validators together.

**One pre-existing correction carried in the same change.** The Tier 3 bullet in the active product
cursor above asserted that `main` "remains at `A` with zero commits after". That was true when
written and is not now — `main` is 36 commits ahead of `A`, verified by `git rev-list --count` at
`5e7e2f0`. The clause is re-tensed to what it always was, a **dated snapshot at the 2026-09-17
deploy**, with a pointer to [Status](STATUS.md) for current truth, following the pattern PR #81 used
for the derived payload boundary. **A second expired fact was found while making that edit and is
deliberately not repeated**: those 36 commits are described elsewhere as "documentation-only", which
is also no longer true — they include 15 files under `src/harness/` and 13 under `agents/`. The
re-tensed clause says what is actually the case. Verified at `5e7e2f0`: **nothing under `src/api`,
`src/worker`, `src/scheduler`, `state/migrations` or `render.yaml` changed since `A`**, so the
substantive point the original clause rested on survives intact — none of the advance is deployed,
and none of it touches a deployed service's behaviour. **The surrounding Tier 3 reasoning is
unchanged and still sound**: which commit selection the operator made remains unanswerable from
provider evidence, and remains immaterial — the deploy record immutably names `A`, either selection
resolved to `A` at that instant, and auto-deploy being off is what prevents drift since. Only the
expired supporting fact moved. This did not become stale because of this change; it is corrected
here because this change already edits this file and [`AGENTS.md`](../AGENTS.md) requires a dated
snapshot be labelled as a snapshot rather than left as mutable current truth.

**Material design decisions.**

- **A workflow, not a scheduled assistant task.** It outlives every session and its run history is
  durable and inspectable — the two properties the first attempt lacked. Actions runners also have
  unrestricted outbound network; an assistant session in this environment reaches neither the
  Render PostgreSQL host nor `gcd-social-api.onrender.com`, which was verified rather than assumed.
- **Failure to check fails as loudly as drift.** Three states: `PASS`, `DRIFT` (checked, mismatched)
  and `ERROR` (**not checked**). Both `DRIFT` and `ERROR` fail the job, `ERROR` outranks `DRIFT` in
  the verdict, and an `ERROR` run's summary says explicitly that nothing was proven. `process.exitCode`
  is set to 1 before any work and cleared only after the verdict is `PASS` **and** the result set is
  proven to contain exactly the registered checks, so a check that vanished cannot narrow what "all
  clear" covers.
- **Reuse of the existing read-only database boundary.** The session runs through
  `scripts/ops/m1-readiness/database.mjs` — `default_transaction_read_only`, `BEGIN TRANSACTION READ
  ONLY`, both verified with `SHOW`, fixed statements, sanitized error categories. That module gained
  one backward-compatible parameter, an optional `applicationName` defaulting to its existing value,
  so the monitor appears in `pg_stat_activity` as `gcd-interval-monitor` rather than impersonating
  the readiness runner.
- **Client-side filtering of the workflow-run listing.** The GitHub API's `branch` and `status`
  filters are deliberately unused: a server-side filter that silently over-restricted would hide a
  breaching run and produce a false `PASS`. The listing is paged back past the interval start and
  filtered from each run's own fields; failing to enumerate that far is an `ERROR`, not a `PASS`.

**Material rejected alternatives.**

- **A Routine or any session-bound schedule** — rejected: it is the exact mechanism that already
  failed, for reasons that are structural rather than incidental.
- **Relaxing the `monitoring` environment's branch restriction, or moving the secret to the
  repository level, so the job could be proven from the branch** — rejected. It would widen the
  credential's reach to buy a convenience, and the fail-closed design already treats an unreachable
  secret as a loud failure.
- **Failing the job once the interval expires** — rejected. Expiry is a decision point, not a cliff,
  and the decision belongs to the named owner; a monitor that failed on the calendar would assert an
  authority it does not have. It reports the remaining days and says whose call it is.
- **Splitting the job so the checks needing no secret still run when the database is unreachable** —
  rejected: partial monitoring reporting green is the defect this change exists to remove.
- **Reusing the deployment controller's health code at run time** — rejected: a read-only observer
  should not hold a reference to the module that performs releases. The agreement that matters —
  that the monitor's health URL is exactly the one the controller accepts — is asserted at **test**
  time by calling that controller's own `validateApiHealthUrl` on the constant.

**Migrations / schema impact:** none. No migration is added, applied, or rolled back, and the
monitor's role cannot write.

**Automated validation.** `npm run build` and `npm run typecheck` clean. `npm run test:offline`
**ALL PASS** across nine suites, the new one reporting **94 checks** (source 15, status 8, workflow
23, drift 26, failclosed 12, report 10). **Ten deliberate mutations confirm the guard is
load-bearing**, each reverted: artifact `A` edited in the constants only; the monitor cron edited in
the constants only; the cron edited in the workflow only; a `pull_request` trigger added; a write
permission added; the `environment: monitoring` line removed; artifact `A` hardcoded into the
workflow; the interval expiry moved in the constants only; the interval expiry rewritten in
[Status](STATUS.md) only; and the secret reference renamed. Every drift state the monitor exists to
catch is exercised offline against fabricated observations, because none can be produced on demand
in production.

**Production evidence: none, and none is possible before merge.** The workflow's `schedule` fires
only on the default branch, and its `monitoring` environment is restricted to `main`, so the job
**cannot run at all from the pull-request branch**. **A green pull request does not prove this
workflow works.** The first genuine end-to-end proof is a manual `workflow_dispatch` on `main`
after merge.

**Rollback / recovery status:** no migration and no durable state. Reverting the commit removes the
workflow and the scripts and restores the previous `test:offline` suite list; nothing in production
depends on it.

**Security and privacy implications.** The change adds one credential reference and grants no new
capability. No claim, tool, model id, thinking configuration, approval rule, autonomy boundary, or
publishing instruction was touched, and the Phase-A approval gate and the self-improvement
core-objective lock are untouched. `ci.yml` and `deploy-production.yml` are unmodified. The new
workflow holds read-only permissions, has no `pull_request` trigger, performs no write to any
system, and deploys nothing. Report values that originate outside this repository — the `/healthz`
document, `_migrations` identifiers, GitHub run fields — are length-bounded, stripped of control
characters and HTML-entity-escaped before reaching the rendered job summary. Database failures are
reported as fixed categories, never the driver's own message, which can carry connection identity.

**Accepted limitations.**

- **The monitor observes; it does not verify every M1 exit check.** [Status](STATUS.md)'s first
  listed check is *no new deploy on `gcd-social-api`, `gcd-social-worker`, or
  `gcd-social-scheduler`*. This workflow has no Render credential, so it proves that only for the
  **API**, and only indirectly, by observing that `/healthz` still reports exact `A`. **Worker and
  scheduler deploys are not covered at all**, and scheduler liveness is inferred from
  `brief_queue` rather than from the cron's own run record. Closing that needs a Render API
  credential, which is a separate, separately authorized change.
- **A green run is evidence for the day it ran.** It says nothing about the hours between runs, and
  a drift that appears and is reverted inside one day is invisible to it.
- **25 hours is a judgement.** It tolerates one hour of cron jitter or a single late run without
  tolerating a missed day. A scheduler that runs but enqueues nothing — or that enqueues a brief
  the worker never claims — passes this check.
- **The `ERROR` path's real-world behaviour is untested.** It is proven offline against fabricated
  failures; whether a real Render PostgreSQL timeout or a real expired credential lands in that path
  rather than escaping as an unhandled rejection has not been observed.
- **It notices; it does not remediate, and it must not.** Every response is an operator decision
  under the standing prohibition.

**Unresolved follow-ups.**

- ~~The PR number and merge SHA above (blocking follow-up, mutable-identifier exception).~~
  **Closed** in the **PR / merge** line above: PR #83, merge `b8f12f3`.
- **The first real firing is what proves this workflow — open until it is observed.** A manual
  `workflow_dispatch` on `main` after merge is the first genuine end-to-end evidence: that GitHub
  schedules the workflow, that `environment: monitoring` resolves `GCD_MONITOR_DATABASE_URL`, that
  the read-only role can read `_migrations` and `brief_queue.created_at`, that `/healthz` and the
  GitHub run listing are reachable from the runner, and that the job's verdict and summary render
  as intended. Until that run is observed, the monitoring condition in [Status](STATUS.md) and in
  the M1→M2 interval section above stays **unmet**, and neither this record nor a green pull request
  may be read as closing it.
  **Update 2026-09-22:** the manual `workflow_dispatch` proof is observed (run #2, ALL CLEAR); the
  first *scheduled* firing is not, and remains open as a follow-up of the re-authorization above.
- **[Status](STATUS.md) is deliberately not updated by this change**, by instruction: its production
  tables, live SHAs, M1→M2 interval record and current cursor are untouched. Its Monitoring
  paragraph therefore does not mention this implementation, while the corresponding paragraph in
  this file now does. Reconciling the two — once the first firing has been observed, and only then
  — is an open documentation follow-up.
  **Closed 2026-09-22** by the re-authorization change, which records the monitor in
  [Status](STATUS.md)'s M1→M2 interval section.
- **The same expired fact survives in [Status](STATUS.md)'s current-cursor paragraph**, which
  states that `main` "remains at `A` with zero commits after" inside its Tier 3 summary. It is the
  same defect corrected in this file above, and it was **not** fixed by PR #81 — that PR re-tensed a
  different clause, the derived payload boundary. It is left untouched here because the instruction
  under which this change was made forbids editing that file's current cursor. Correcting it needs
  its own authorization, and is recorded rather than silently carried.
  **Closed 2026-09-22** by the re-authorization change, which records this correction as one of
  its follow-ups and re-tenses the clause as a dated snapshot.
- **A second expired fact, reported and deliberately not edited: "documentation-only".** The
  `main`/production divergence paragraph in the M1→M2 interval section of this file, and the
  matching paragraph in [Status](STATUS.md), both say `main` is ahead of `A` "by documentation-only
  commits". Verified false at `5e7e2f0`: the 36 commits since `A` touch 15 files under
  `src/harness/` and 13 under `agents/`. The substantive point survives — nothing under `src/api`,
  `src/worker`, `src/scheduler`, `state/migrations` or `render.yaml` changed, so none of it is
  deployed or reaches a deployed service — but the wording is wrong. Both instances sit inside the
  M1→M2 interval record, which the instruction under which this change was made forbids editing, so
  neither is touched here. Correcting them needs its own authorization.
  **Closed 2026-09-22** by the re-authorization change, which corrects both instances and the same
  wording in the [README](../README.md).
- **Worker and scheduler deploy observation** is not covered and needs a Render credential; not
  begun and not authorized.
- Whether the 25-hour liveness bound is the right one has not been calibrated against more than the
  single post-007 cycle [Status](STATUS.md) records.

**Documents updated at completion:** [Operations](OPERATIONS.md), [Testing](TESTING.md),
[Environment](ENVIRONMENT.md), [Deployment control](DEPLOYMENT.md), [README](../README.md),
[`AGENTS.md`](../AGENTS.md) (the offline-suite count, eight to nine), and this file.
**[Status](STATUS.md) was deliberately not modified.**

## Post-MVP hardening backlog

Deferred findings are recorded durably in
[`docs/KNOWN_ISSUES_AND_HARDENING.md`](KNOWN_ISSUES_AND_HARDENING.md), which also
defines the backlog entry template, the finding categories, and the two-lane
workflow.

**This backlog is not the immediate feature cursor.** Items here do **not** block
the MVP implementer from continuing unrelated roadmap work. A finding blocks the
MVP lane only when it affects reachable production behaviour, authorization,
publication, secrets, data integrity, migration safety, rollback safety, or when
it makes a PR's stated guarantees false without those guarantees being narrowed.

**Workflow.** Items are taken by a **separate, fresh hardening implementer**
working with an **independent inspector** — not by the author of the original
finding, so the design is reconsidered rather than extended by reflex.

| ID | Title | Status | Origin | Reachability | Must-fix trigger |
|---|---|---|---|---|---|
| `CC5-SYNTAX-001` | Unrecognised English could bypass SQL-comment authority | **RESOLVED BY REPLACEMENT CONTROL — MERGED through PR #63; not production-validated** | PR #57 origin; preserved independently accepted prototype `0904c1ecbc682aa6e1b97f82051ab1deddf67419` | **Dormant, non-runtime.** Raw whole-file identity now makes every uncoordinated byte change fail, including forms the bounded grammar misses. SQL artifacts unchanged; all six executors disabled. | Future legitimate SQL changes must update artifact digest, manifest, and external pin together under review. |

**`CC5-SYNTAX-001` in brief.** The bounded `CC5` grammar still does not reject
*"Migration 007 remained unapplied."*, *"… has remained unapplied."*,
*"… stayed unapplied."*, *"… has stayed unapplied."*, or their contextual-*It*
shapes. That recogniser was not made semantically complete. The defect is
resolved by a replacement control: appending any such text changes the raw
whole-file digest and fails `CC5F` unless the artifact digest, manifest, and
external pin are updated together under review. This remains repository
authority only, and says nothing by itself about production; separately,
**migration 007 is now production `APPLIED`** — see the M1 cursor above.
Full design, evidence, limitations, and ownership are in
[Known issues and hardening](KNOWN_ISSUES_AND_HARDENING.md).

## Phase 0B prerequisite — fact and evidence contract

**State:** `MERGED` · **`DEPLOYED`**. Delivered by the Phase 0B.0 foundation change (`44d7336…`). Migration 006 was applied **exactly once, to the shared production database, by the API pre-deploy runner** on 2026-08-28; the API, worker, and scheduler were then **separately deployed at the target commit**. A migration is applied to a database, not to a service — the three services share one database and none of them ran the migration except the API's pre-deploy step. The tables are correctly empty until an authorized operator runs `evidence:sync`, which has not yet happened.

The contract is now executable rather than aspirational. `src/harness/evidence/contract.ts` defines the kinds, per-kind validation, and the two forbidden promotions; `state/migrations/006_content_evidence.sql` enforces the same rules as database CHECK constraints so the invariant survives a writer that bypasses the application.

**Design decision — an eighth kind.** The roadmap named seven. `verified_business_fact` was added because `config/approved-facts.json` is almost entirely GCD business identity and policy, and importing "German Car Depot is at 2130 Fillmore Street" as a `verified_automotive_fact` would break the exact semantic separation this contract exists to enforce. All seven roadmap kinds are unchanged and none was renamed.

**Design decision — conflicts key on subject *and attribute*.** An earlier draft keyed on subject alone; disposable PostgreSQL integration caught it immediately, because every approved fact shares the subject `german-car-depot` and the pack therefore reported the shop's warranty and its phone number as contradicting each other, emptying `allowedFacts`. A conflict is two different claims about the same *attribute*. Records with no attribute can only conflict through an explicitly declared relation.

Durable records distinguish:

- verified automotive fact;
- sourced research;
- GCD direct observation;
- GCD empirical performance evidence;
- creative hypothesis;
- causal hypothesis or inference; and
- unsupported assumption.

Support source, source type, provenance, confidence, freshness, `observed_at`, `reviewed_at`, expiry/review-by, conflicting evidence, and supersession. Define review and conflict rules. Content-performance correlation must never silently become automotive fact or causal truth.

### Phase 0B.1 — strategy-concept stage executor

**State:** **`MERGED`** — **not established as `DEPLOYED`, not `PRODUCTION-VALIDATED`.** No model call from this slice is reachable in production.

**PR / merge:** PR #42, reviewed head `2dc416f1a49bb419531549e95cb31052ada28009`, merge `8c8bd5b0fd500f9a28247f472fd6626bb05c6ebd`, base `aec3e805cecc2b99dc7a582292bef536cee8ae21`. Merged 2026-08-29 after all five CI jobs passed on the exact reviewed head.

**Dormancy, restated because merging changes nothing about it.** No worker, scheduler, orchestrator, approval path, image path, Slack path, provider, database, or HTTP route reaches the executor; the preview stays inert and never invokes it. All six registry entries still have `executionEnabled: false`. At that point `strategy-concept` was the only stage with an executor; Phase 0B.2 below adds the second, and both are dormant. The change added no route, migration, environment variable, publishing path, approval path, or provider authority.

**Delivered:** a reusable typed execution boundary (`src/harness/agents/stageExecution.ts`), central model-policy resolution (`modelPolicy.ts`), the `strategy-concept` executor and its output contract (`strategyConcept.ts`), a dedicated prompt (`agents/strategy-concept.md`), and a registry method that loads asset *contents* through the same allowlisted path mechanism.

**Why a dedicated prompt.** The registry pointed `strategy-concept` at `agents/analytics.md` as a placeholder. That file defines a performance-readout subagent: a different output contract (`headline`/`do_more_of`/`timing_rec`), its own pinned model in frontmatter, and declared tools. Executing this stage against it would have meant running one contract while claiming another, so the prompt was written and the registry repointed.

**Material design decisions.**

- **Exactly one provider request per invocation, with no retry and no repair call.** A silent retry turns one budgeted decision into unbounded spend, and a "fix your JSON" round trip is a second chance for the model to argue itself into an unsupported claim. Asserted in source, not just documented — and, since the payload-contract reconciliation, true of the **network** rather than only of the wrapper: the Anthropic SDK defaults `maxRetries` to 2, so the stage request boundary sets it to 0 explicitly.
- **Wrong-class and fabricated ids cannot enter the typed fact-citation channel.** Every cited id is checked against the evidence pack the caller built, in the section the contract assigns it; a performance or hypothesis id placed in `supportingFactIds` fails, because membership is tested against `allowedFacts` and nothing else. **That is the exact guarantee — it covers ids, not prose.**
- **The model's prose is not verified, and the code does not claim to verify it.** `angle`, `concept`, and `rationale` are length-bounded and nothing more. A response can assert a performance correlation as automotive fact in `rationale`, cite an unrelated valid id, and validate. That gap is closed *structurally* rather than by keyword matching: prose is returned as `provisional` — branded `provisional_model_prose`, `verified: false`, `publishable: false` — and `citedFactRecords()` is the only supported evidence accessor, taking ids and never reading prose. Phase 0B.2 receives this complete typed output and structurally whitelists evidence-record ids; it does not semantically prove the prose true. Nothing here is publishable.
- **Conflicted, stale, and inactive ids are rejected even when real**, and are shown to the model as a named exclusion list so it avoids them instead of inventing a replacement.
- **Goal and evidence are framed as untrusted data** in delimited labelled blocks — a mitigation, not the defence. The defences are that no tool is registered, the capability set is closed to `read_evidence_pack`, and the typed citation channel is bound to evidence the model did not select.
- **Reference assets never reach the instruction channel.** Prompts and skills define how the stage works and stay in `system`; references are factual data and are either omitted or placed in an untrusted data block. `strategy-concept` omits its declared `config/approved-facts.json` reference, because the evidence projection is the authoritative factual input and a raw duplicate would compete with it.
- **Model ids resolve in one module.** The registry still names only a policy class; the executor names none. A test asserts no `claude-` string appears in the registry.
- **The evidence projection exposes authoritative `kind` and withholds adjudication internals.** Stages use the recorded class rather than inferring from claim wording. Confidence, provenance, reviewer identity, and internal timestamps stay out; a confidence score in the prompt is an invitation to argue a disputed claim back into use.

**Corrections made under independent review, before merge.** All three findings were real:

1. **The offline credential test could have contacted Anthropic.** `config.anthropicApiKey` is captured from the environment once at module initialization and `getClient()` reads that captured value, so clearing `process.env.ANTHROPIC_API_KEY` in the test changed nothing — on a machine whose parent process exported a real key, the production runner would have issued a live request. CI passed only because CI has no key. The test now clears `config.anthropicApiKey` inside `try/finally`, restores the exact prior value, and asserts the failure is the missing-credential error rather than any network outcome; it is verified to pass with a nonempty key exported.
2. **The evidence guarantee was overclaimed.** The validator binds citation arrays to the pack but only length-bounds `angle`, `concept`, and `rationale`, so prose can assert a performance correlation as automotive fact, cite an unrelated valid id, and validate. "Every output field is validated against evidence" was wrong. Rather than keyword matching, the boundary was made structural and typed: prose returns as `provisional` (branded `provisional_model_prose`, `verified: false`, `publishable: false`) and evidence as a separate branded id channel, with `citedFactRecords()` — which takes ids and never reads prose — the only supported evidence accessor. Every claim was narrowed to the exact guarantee: **wrong-class and fabricated ids cannot enter the typed fact-citation channel**.
3. **Factual references were entering the instruction channel.** `invokeStage` appended reference contents to the system prompt, making `config/approved-facts.json` instruction authority competing with the classified evidence projection. Prompts and skills stay in the instruction channel; references never do — omitted, or placed in an untrusted data block. `strategy-concept` omits its declared reference. Asset metadata gained a per-asset `channel` so it records what was used rather than what was declared. Separately, `skills/brand-voice/SKILL.md` — newly injected as instruction by this slice — claimed **Volvo** and **"two locations"**, neither supported by `config/approved-facts.json`; both were removed and the file now defers to approved facts as the factual authority.

**Accepted limitations.** The stage is dormant: nothing calls it. **Prose truth is not verified** — the typed boundary contains the consequence of a false statement but does not detect one. Phase 0B.2 receives the complete typed result and structurally whitelists evidence-record ids, but it does not semantically prove this prose or its own restatements true. Nothing from this stage is publishable. Determinism is proven for the validator and the boundary with an injected runner — **real model output is not deterministic and is not claimed to be**. At the time of this slice `strategy-concept` was the only stage with an executor; the other five were registered and unwired, and every stage including this one still has `executionEnabled: false`.

### Phase 0B.2 — automotive-truth stage executor

**State:** **`MERGED`** — deliberately dormant. **Not established as `DEPLOYED`; not `PRODUCTION-VALIDATED`.** No model call from this slice is reachable in production, and none is reachable at all without a caller constructing an invocation and supplying a runner.

**PR / merge:** PR #44, base `15e18ecfd5406b0afb4fd8ad2f833581f42451f4`, reviewed head `5b2ed96663643fe68d3cc72a64137cb9abd87e4e`, merge `52050b4d20d03b5cbaf2a98eaab71b2f77685d80`. The merge commit's first parent is the recorded base and its second parent is the exact reviewed head.

**Dormancy.** No worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, or evidence-write path reaches the executor. These boundaries are asserted against the concrete source paths in the offline suite, not inferred from deployment state. All six registry entries still have `executionEnabled: false` — this slice did not change that field for any stage. The change added no route, migration, environment variable, dependency, workflow change, publishing path, approval path, or provider authority. Merge changed repository state only; it is not evidence of deployment or production behavior.

**Delivered:** the `automotive-truth` executor and its output contract (`src/harness/agents/automotiveTruth.ts`), a dedicated prompt (`agents/automotive-truth.md`), a narrowly scoped stage skill (`skills/claim-boundaries/SKILL.md`), and the registry repointing that goes with them. Two helpers moved to where they belong so both stages share one definition rather than diverging: the evidence projection and the unusable-id set now live beside the pack (`renderEvidencePackForStage`, `unusableEvidenceIds`), and the "declared evidence classes must be present" precondition lives on the shared boundary (`assertRequiredEvidenceKinds`). **No second model-call implementation, retry wrapper, repair call, tool mechanism, or model-policy table was created** — the stage reuses `invokeStage` and the central policy resolution unchanged.

**Schema / migrations:** none. No configuration, workflow, dependency, environment contract, route, or deployment-authority change.

**The one thing this stage had to make impossible.** A stage named "automotive-truth" is the obvious place to accidentally build a machine that lets a language model declare things true. **No sentence the model writes becomes a claim the pipeline may make.** A permission is a *binding to an evidence id*, not a sentence:

- Stage 2 receives the complete typed Stage 1 result — angle, concept, rationale, hypotheses, assumptions, and all three typed citation arrays — in one bounded `STRATEGY_OUTPUT` untrusted-data block. Those fields are review input only and never become permissions automatically.
- The model permits a claim by naming the `id` of a fact already in `pack.allowedFacts`. Fabricated ids, ids from any other evidence class, and ids the pack marked conflicted, stale, or inactive are all rejected, as are duplicates.
- The shared evidence projection includes each record's authoritative `kind`, while withholding confidence, provenance, reviewer identity, and internal timestamps. The prompt maps `verified_automotive_fact` to `automotive` and `verified_business_fact` to `business` and forbids inference from prose. The **class recorded by the evidence system wins.** A mismatching model declaration fails; the record is never reclassified to match the model.
- **What may be claimed is read back from the records**, through `allowedClaimRecords()` and `allowedClaimTexts()`. Neither reads model text. A restatement that overstates its fact is contained by exactly this: it never becomes the claim.

**What is NOT guaranteed, stated plainly.** The model's prose is not verified, and a restatement is not checked for faithfulness to the fact it cites. `assessment`, `restatement`, `forbiddenClaims`, `requiredCaveats`, and `openQuestions` are length-bounded and nothing more. A restatement may overstate, mis-round, or add a superlative and still validate. **This stage does not make a language model a semantic prover of factual truth, and nothing in the code or these documents claims it does.** The gap is closed *structurally* rather than by keyword matching — which would be trivially evadable and would imply a check the code does not perform: prose returns branded `provisional_model_prose` (`verified: false`, `publishable: false`), each restatement is separately branded `restatementVerified: false`, and the permission channel is a separate branded type. `forbiddenClaims` is advisory prose in the provisional channel: nothing enforces it, and a claim absent from it is not thereby permitted. *(Since the writer-restriction change — `IMPLEMENTED`, not merged — stages 3–5 are told to honour `forbiddenClaims` and `requiredCaveats` as binding restrictions; still no code enforces either.)* *(Corrected 2026-09-28: `MERGED` through PR #92 at `f2a58785c8a9aa2605dda3c7f7daf34ffdf16007`; not deployed, not enabled.)*

*Dated addition, 2026-09-28 — a consequence of the limitation above, recorded, not fixed.* Because stages 3–5 are bound by `forbiddenClaims` and `requiredCaveats` (PR #92) while both remain unverified model prose, **they can misdescribe the evidence, and a writer that follows the records can then contradict stage 2's text.** In the piece the revision pass's owner-run rounds revised on 2026-09-28, stage 2's assessment said the G-Class list "adds mountainous terrain, poor road surfaces, dusty conditions and air-recirculation", and its second forbidden claim treated mountainous terrain and poor roads as G-Class-only; the owner-verified E-Class record `mb-eclass-arduous-conditions-oil-frequency` includes "use in mountainous terrain or on poor road surfaces", so only dusty conditions and air recirculation are G-Class-only. The writers credited those items to the E-Class correctly, which technically contradicted stage 2's text, and the critic correctly did not flag it. Nothing checks stage 2's restrictions against the records they describe. An open follow-up candidate; no prompt or code changed. See the revision-pass record under *Merged repository change awaiting rollout*.

The limitation applies to **both stages**: Stage 1 does not semantically prove its angle, concept, rationale, hypotheses, or assumptions, and Stage 2 does not semantically prove either that inherited prose or its own assessment, restatements, caveats, questions, and forbidden-claim prose. The typed handoff and evidence-id binding contain what those strings can authorize; they do not make the strings true.

**Missing evidence refuses before the model call.** The registry declares both `verified_automotive_fact` and `verified_business_fact` for this stage, and the shared precondition reads `pack.allowedFacts` only. Sourced research, observations, performance evidence, hypotheses, assumptions, and the raw approved-facts reference are **not** substitutes and cannot satisfy it. A pack missing either class costs no model request.

**Why `skills/compliance-checklist/SKILL.md` was removed from this stage.** It was the registered skill for `automotive-truth` and would have been injected verbatim as its instructions. It is the **final package critic's** rubric — provider payloads, hashtag counts, image profiles and pixel ceilings, WCAG contrast ratios, GBP fields — and it directs a PASS/FAIL verdict on an already-built package. That is a different job from deciding what may be claimed, and a stage told to run it would have been running one contract while claiming another. It also states concrete facts (an address, a city, a slogan) that would have entered the instruction channel of the one stage whose entire purpose is refusing claims that lack evidence. It remains registered on `final-critic`, where it is exactly right, and a test asserts it is registered nowhere else. `skills/claim-boundaries/SKILL.md` replaces it with the claim-level subset that does belong here, written to contain **no facts of its own** — tests assert it names no approved-fact value, no vehicle make, and no automotive figure, and that it stays out of packaging, image, accessibility, and publishing scope. **No new unverified automotive fact was introduced in any prompt or skill.**

**Also decided.** `config/approved-facts.json` stays declared as this stage's reference and is **omitted** from the invocation, with asset metadata recording `channel: "omitted"` — the classified evidence projection is the single factual input, and an unclassified raw duplicate competing with it would matter most in exactly this stage. The complete typed Stage 1 output is passed as one bounded **untrusted data block**, never as instruction; its prose and citations are subjects of review, not sources of truth or automatic permissions.

**Tool-free prompts.** Both `agents/strategy-concept.md` and `agents/automotive-truth.md` explicitly declare `tools: []` and state that the stage cannot browse, read files, call APIs, or run code. The shared boundary registers no tools and refuses capabilities beyond `read_evidence_pack`.

**Material rejected alternatives.** Keyword or semantic-prose matching was rejected because it would be evadable and would overclaim verification the code does not perform. A second model implementation, retry, repair call, model-policy table, or tool mechanism was rejected in favor of the existing single-shot boundary. The publishing-era `skills/compliance-checklist/SKILL.md` was rejected for this stage because it is the final package critic's rubric and contains concrete shop/publishing facts; it remains only on `final-critic`. The replacement `skills/claim-boundaries/SKILL.md` is narrowly claim-scoped and tested to contain no facts of its own.

**Automated validation.** The content-intelligence offline suite grew from 170 to 283 checks, all with an **injected runner**; nothing in it reaches Anthropic or any network, and this executor has no default runner to fall back to. The suite was confirmed to pass with a **nonempty `ANTHROPIC_API_KEY`** exported in the parent process. A pre-existing Phase 0B.1 assertion that read "only strategy-concept has an executor" was a tautology that could not fail; it is replaced with a check against the agents directory listing, so adding a third executor fails the test rather than passing silently. On the exact reviewed head, all five GitHub CI jobs succeeded: Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML static validation.

**Production evidence:** none. Merge is not deployment evidence, and no production path can execute the stage.

**Rollback / recovery:** no migration or external state exists to unwind. Source rollback is an ordinary application-code decision, but no rollback is currently required because the executor is dormant.

**Security and privacy implications:** the complete Stage 1 value and evidence projection are bounded untrusted data; prompts are tool-free; reference data is omitted from the instruction channel; no prompt, evidence, model prose, credential, or unpublished content is logged by the boundary; and no output is publishable. The narrow binding prevents model prose from acquiring claim authority but does not verify its meaning.

**Accepted limitations.** The stage is dormant: nothing calls it. Prose truth is not verified, per the paragraphs above. Determinism is proven for the validator and the boundary **with an injected runner** — real model output is not deterministic and is not claimed to be. No production caller for any stage executor exists in this repository, and every test here used an injected runner; whether any executor has **ever** been invoked against a real model outside this repository is **UNKNOWN / NOT ESTABLISHED**, because neither Render nor provider histories were inspected. No output of this stage or of `strategy-concept` has been reviewed for quality.

**Unresolved follow-up / product cursor at the time of that reconciliation:** Phase 0B.3 — dormant `hook-story-script` executor, by name only. Phase 0B.3 below is that slice.

**Documents updated at completion:** PR #44 updated `README.md`, `agents/automotive-truth.md`, `agents/strategy-concept.md`, `docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY_AND_CONTINUITY.md`, `docs/STATUS.md`, `docs/TESTING.md`, and `skills/claim-boundaries/SKILL.md`. The post-merge reconciliation updates the active handoff, architecture, roadmap, security, and status documents that carry phase state.

### Phase 0B.3 — hook-story-script stage executor

**State:** **`MERGED`** — deliberately dormant. **Not `ENABLED`; not established as `DEPLOYED`; not `PRODUCTION-VALIDATED`.** No model call from this slice is reachable in production, and none is reachable at all without a caller constructing an invocation and supplying a runner.

**PR / merge:** PR #46, base `6c0b889d5e4e4f82dadb3d0cc5d9b4bd93042afe`, reviewed head `b46a70ffbb60711085f5d48679c9a2ad20e5db13`, merge `c129bbf5a1d35e123aa49c1c5349143bb60ae800`. Ordered merge parents: first `6c0b889d5e4e4f82dadb3d0cc5d9b4bd93042afe`, second `b46a70ffbb60711085f5d48679c9a2ad20e5db13`.

**Dormancy.** No worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, or evidence-write path reaches the executor. These boundaries are asserted against the concrete source paths in the offline suite. All six registry entries still have `executionEnabled: false` — this slice did not change that field for any stage. The change added no route, migration, production data, environment variable, credential, dependency, lockfile change, workflow change, or `render.yaml` change. Merge changed repository state only; it is not deployment or production-validation evidence.

**Delivered:** the `hook-story-script` executor and its output contract (`src/harness/agents/hookStoryScript.ts`), a dedicated tool-free prompt (`agents/hook-story-script.md`), a craft-only stage skill (`skills/script-craft/SKILL.md`), and the registry repointing that goes with them. It reuses the existing `invokeStage` boundary, the strict JSON parser, the central model-policy resolver, the shared evidence helpers, and the single-shot runner unchanged. **No second model-call implementation, retry, repair call, tool mechanism, or model-policy table was created.**

**Schema / migrations:** none. No configuration, workflow, dependency, environment contract, route, deployment-authority, or production-state change.

**The authority boundary this stage exists to hold.** Stage 3 writes the copy, which makes it the stage most likely to quietly re-acquire a fact stage 2 refused. Two rules make that structural:

- **Stage 2's whitelist is the boundary, not the pack.** The factual input is derived exclusively from the evidence ids `automotive-truth` permitted. A real, citable, non-conflicted, non-stale fact sitting in `pack.allowedFacts` that stage 2 did not permit is **not available here**: it is absent from the projection the model sees, and citing it fails validation. **Presence in the pack is not permission.**
- **The complete pack is never offered as an alternate claim source.** The model receives `PERMITTED_CLAIMS` — a bounded projection of exactly the whitelisted records, each with the evidence system's own wording and authoritative `kind`. It does not receive the pack's other sections. There is no second list to reach for.

**The typed handoff is complete, and revalidated rather than trusted.** The invocation takes the complete `StrategyConceptOutput`, the complete `AutomotiveTruthOutput`, the same evidence pack that bound them, and an injected runner — **not** free-form `concept` and `allowedClaims` strings. Stage 1 arrives as provisional angle, concept, rationale, typed creative/causal hypotheses, and assumptions, plus the typed `supportingFactIds`, `observationIds`, and `performanceSignalIds` citation arrays. Stage 2 arrives as provisional assessment, forbidden claims with closed reasons, required caveats, and open questions, plus the typed allowed-claim bindings: `factId`, authoritative `factKind`, derived `claimClass`, provisional restatement, and `restatementVerified: false`. The enclosing `kind`, `verified: false`, and `publishable: false` brands are part of both contracts. **Prior-stage values are treated as untrusted and revalidated against the same evidence pack**, using the prior stages' own validators and re-binding every id against it. Values that fail the prior contracts — malformed shape, missing or extra fields, incorrect branding, an oversized handoff, or a citation or permission that does not bind to this pack — are refused **before the model call**. Branding fields are *checked*, never *trusted*. **This is structural validation, not provenance or authenticity verification.** Nothing establishes that a value actually came from a prior stage run, and a structurally valid deserialized or hand-built value can pass — deliberately, since that is what makes a JSON round trip between stages work. What the check buys is that such a value cannot be inconsistent with the evidence, not that it is authentic. All prior-stage material reaches the model only inside bounded, labelled untrusted-data blocks, as review context and never as instruction or factual authority.

**What is NOT guaranteed, stated plainly.** Deterministic validation can verify structure, bounds, enums, ids, and membership in stage 2's whitelist. It **cannot** verify that the script's prose faithfully restates the fact it cites, and it **cannot** detect every uncited factual implication. A script may cite a permitted fact and paraphrase it into something far stronger than the record supports; a script may assert something factual and list nothing in `claimUse`. Neither is caught. **No language model in this pipeline proves a statement true, and nothing in the code or these documents claims one does.** The gap is contained by type rather than by keyword matching — which would be trivially evadable and would imply a check the code does not perform: copy returns branded `provisional_model_prose` (`verified: false`, `publishable: false`), each paraphrase is separately branded `paraphraseVerified: false`, and the claim-use channel is a separate branded type. `scriptClaimRecords()` and `scriptClaimTexts()` take ids and never read copy. A regression test demonstrates both limits directly: a drifting paraphrase and several uncited factual assertions **validate**. The drifting paraphrase and uncited script wording do not appear in either accessor result; the accessors still return the exact permitted evidence record bound by the cited id.

**The zero-permitted-claims decision, made explicitly.** When stage 2 permitted nothing, stage 3 **refuses before the model call**. Both options were weighed. A "clearly non-factual draft" would be a finished-looking script whose every concrete statement is unfounded, handed onward to stages with no mechanism to keep it non-factual — and asking a model for compelling copy with no permitted facts is a direct invitation to supply its own. Refusing costs a model call that could not have produced usable output, surfaces the real problem (the evidence, or stage 2's review — not the copy), and fails closed. **Authority is never widened from the pack to make the script easier to write.** The cost is accepted honestly: a purely stylistic piece that legitimately asserts nothing cannot be produced by this stage, and would need its own authorised contract rather than a silent widening of this one.

**Why `agents/copywriter.md` was rejected as this stage's prompt.** It was the registered placeholder and would have been executed verbatim. It is a different contract: it pins its own model in frontmatter (bypassing central policy resolution), declares `tools: Read, Skill`, reads a runtime brief this stage never receives, and returns per-platform × per-language post bodies with CTAs and character counts — **platform adaptation and translation, both of which belong to later stages**. Executing this stage against it would have meant running one contract while claiming another. The file is preserved unchanged for the current orchestrator flow, which still uses it; a test asserts no registered stage points at it. The replacement, `agents/hook-story-script.md`, explicitly declares `tools: []` and pins no model.

**Why `skills/brand-voice/SKILL.md` was not injected here.** It is a genuine style authority and remains one — but it also carries concrete facts: a founding year, a locality, a street address, a registered slogan, vehicle makes and models, service framing, and booking CTAs. Injecting it as stage 3 instruction would let the stage reacquire, from a style file, a fact stage 2 declined to permit. It is **preserved unchanged** and remains registered on `strategy-concept` and authoritative for the orchestrator's current copywriter path. `skills/script-craft/SKILL.md` replaces it here with the craft-only subset — shape, cadence, anti-slop, and the phrasings that quietly become claims — written to contain **no facts of its own**. Tests assert the injected stage 3 skill contains no approved-fact value, no vehicle make, no address or locality, no warranty or automotive figure, no slogan, no service capability, and no CTA destination. **No new unverified fact was introduced in any prompt or skill.**

**Output contract.** `hook`; ordered `storyBeats` with a closed role enum; a channel-neutral `script`; a separate typed `claimUse` channel binding factual portions to stage 2-permitted ids with a closed location enum; and `openQuestions`. Extra fields are rejected at the top level and inside every entry. Beat order is preserved exactly as returned. The stage performs no platform adaptation, translation, hashtag selection, timing, image direction, approval, or publication — those belong to later stages, and the prompt says so explicitly.

**Independent-review corrections.** The reviewed head narrows the original provenance overclaim: runtime revalidation proves contract structure and pack consistency, not that a value came from a genuine earlier run. It also corrects the accessor description: drifting paraphrase and uncited script wording are absent from accessor results, while the exact permitted evidence record bound by the cited id is returned. Finally, active documentation and tests reconcile the executor count to three. No behavioral or architectural expansion accompanied those corrections.

**Automated validation.** The reviewed head has 418 checks in `test:content-intelligence` and 703 across all eight offline suites, every model call through an **injected runner**. Nothing reaches Anthropic or any network, and this executor has no default runner to fall back to. The suite passed with a **nonempty `ANTHROPIC_API_KEY`** and an unreachable base URL, so any provider request would fail loudly. A dedicated group proves every prior-stage refusal happens with **zero** model requests. All five exact-head GitHub CI jobs succeeded: Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML static validation.

**Production evidence:** none. Merge is not deployment evidence, and no production path can execute the stage.

**Rollback / recovery:** no migration or external state exists to unwind. Source rollback is an ordinary application-code decision; the dormant executor has produced no durable or provider state.

**Security and privacy implications:** both complete prior outputs and the permitted-claim projection are bounded untrusted data; the prompt is tool-free; the fact-free skill is reviewed instruction; factual references stay outside the instruction channel; no prompt, evidence, model prose, credential, or unpublished content is logged; and no output is publishable. Structural validation constrains authority but provides no provenance or semantic-truth proof.

**Accepted limitations.** The stage is dormant: nothing calls it. Script truth is not verified and paraphrase faithfulness is not checked, per the paragraph above. Determinism is proven for the validators and the boundary **with an injected runner** — real model output is not deterministic and is not claimed to be. No production caller for any stage executor exists in this repository, and every test here used an injected runner; whether any executor has **ever** been invoked against a real model outside this repository is **UNKNOWN / NOT ESTABLISHED**, because neither Render nor provider histories were inspected. No output of any of them has been reviewed for quality.

**Documents updated at completion:** PR #46 updated `README.md`, `agents/hook-story-script.md`, `docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY_AND_CONTINUITY.md`, `docs/STATUS.md`, `docs/TESTING.md`, `skills/script-craft/SKILL.md`, `src/harness/agents/hookStoryScript.ts`, `src/harness/agents/registry.ts`, and `src/harness/contentIntelligence.selftest.ts`. The post-merge reconciliation updates the active handoff, architecture, roadmap, security, status, and testing documents that carry phase state or reviewed validation counts.

**Unresolved follow-up / product cursor at the time of that record:** Phase 0B.4 — dormant `production-direction` stage executor, by name only. Phase 0B.4 below is that slice. Its contract was not designed or implemented in this reconciliation. Deployment-authority work remains an independent track.

### Phase 0B.4 — production-direction stage executor

**State:** **`MERGED`** — deliberately dormant. **Not `ENABLED`; not established as `DEPLOYED`; not `PRODUCTION-VALIDATED`.** It is on `main`. No model call from this slice is reachable in production, and none is reachable at all without a caller constructing an invocation and supplying a runner.

**PR / merge:** PR #48, base `3d5c15fcc04128618018f5ff9eb8d642da221ef5`, reviewed head `9be76b0126052150b2d408c6996c7103126d3b46`, merge `5d3b2cafdfe11b5efc94fbc7fafd387d9a1a67f7` (ordered parents: base first, reviewed head second). Merged 2026-08-31 after all five CI jobs passed on the exact reviewed head.

**Production evidence: none.** Merge moved repository state only. Nothing here establishes that Render is running this code, and no deployment or production-validation claim is made or implied.

**Dormancy.** No worker, scheduler, orchestrator, API, preview, approval, publication, provider, image-generation, Slack, database, or evidence-write path reaches the executor; the preview stays inert and never invokes it. All six registry entries still have `executionEnabled: false` — this slice did not change that field for any stage. The change added no route, migration, production data, environment variable, credential, dependency, lockfile change, workflow change, `render.yaml` change, deployment authority, provider mechanism, model-policy table, retry, repair call, second model-call implementation, or tool mechanism.

**Delivered:** the `production-direction` executor and its output contract (`src/harness/agents/productionDirection.ts`), a dedicated tool-free prompt (`agents/production-direction.md`), a craft-only stage skill (`skills/production-craft/SKILL.md`), and the registry correction that goes with them. It reuses `invokeStage`, the strict JSON parser, the central model-policy resolver, the shared evidence helpers, and the injected single-shot runner unchanged.

**One revalidator per owning stage, not another copy.** Stage 4 must revalidate both stage 2 and stage 3 values. Rather than adding a third and fourth copy of that logic, the helpers were factored into the modules that own the contracts: `revalidateAutomotiveTruthOutput` now lives in `automotiveTruth.ts` and `revalidateHookStoryScriptOutput` in `hookStoryScript.ts`. Stage 3 delegates to the former instead of keeping its private copy. Both take the calling stage's id so a refusal is attributed where it happened, and the earlier executors' public behaviour and existing tests are unchanged.

**The Stage 4 authority boundary — narrower again.** Each stage narrows the last, and stage 4 narrows hardest, because a picture asserts as surely as a sentence and is far harder to audit.

- **Stage 3's *used* claims are the boundary** — not stage 2's whitelist, and not the evidence pack. A fact stage 2 permitted but stage 3 never bound is **not available here**: it is absent from the projection the model sees and fails validation if cited. A fact merely sitting in `pack.allowedFacts` is absent for the same reason, one step further out. The factual projection is derived exclusively from `scriptClaimRecords()`.
- **The complete pack is never rendered to this model**, and **neither is stage 2's provisional prose**. Stage 2's output is required here only so stage 3's bindings can be structurally revalidated: it is an input to the *validator*, not to the *model*. Sending its assessment, restatements, caveats and forbidden-claim prose along would hand the model a wider, unused set of claims to reach for. *(2026-09-24: the caveats and forbidden claims are now sent, as binding restrictions that only narrow — see the writer-restriction change (`IMPLEMENTED`, not merged). The assessment and restatements are still withheld.)* *(Corrected 2026-09-28: `MERGED` through PR #92 at `f2a58785c8a9aa2605dda3c7f7daf34ffdf16007`; not deployed, not enabled.)*
- The model receives exactly two bounded, labelled untrusted blocks: `SCRIPT_OUTPUT` — the complete typed stage 3 result — and `SCRIPT_CLAIMS` — the exact evidence records bound by stage 3's claim-use ids, each with the evidence system's own wording and authoritative `kind`.
- Stage 3's hook, script, beats, paraphrases and questions are unverified model prose. They are creative context, never instructions and never factual authority.

**The typed handoff is revalidated, not trusted — and the limit is exact.** The invocation takes the complete `HookStoryScriptOutput`, the complete `AutomotiveTruthOutput`, the same evidence pack, an injected runner, and an optional registry override. **Prior-stage values are treated as untrusted and revalidated against the same evidence pack. Values that fail the prior contracts are refused before the model call. This is structural validation, not provenance or authenticity verification; a structurally valid deserialized or hand-built value can pass.** A regression proves both halves: malformed, wrongly branded, evidence-inconsistent, and incomplete values fail with **zero** model calls, while JSON-round-tripped valid values execute normally with exactly one runner call and a byte-identical result.

**What is NOT guaranteed, stated plainly.** Deterministic validation can check structure, bounds, enums, ids, shot indices, and membership in stage 3's used-claim set. It **cannot**: prove that a shot accurately represents reality; verify that a requested asset exists or is available; establish ownership, releases, consent, location, make or model availability, or safe physical feasibility; prove that overlay wording faithfully restates its cited record; or detect every uncited factual or visual implication. **No language model in this pipeline proves a statement true or an asset real, and nothing in the code or these documents claims one does.** The gap is contained by type rather than keyword matching: direction returns branded `provisional_model_prose` carrying `verified: false`, `publishable: false`, **and `executable: false`**; overlay wording is separately branded `wordingVerified: false`; every production requirement is separately branded `availabilityVerified: false`; and the visual-claim channel is a separate branded type. `visualClaimRecords()` and `visualClaimTexts()` take ids and never read direction prose. A regression demonstrates each limit directly — a drifting overlay, a shot depicting an unestablished before-and-after, an uncited on-camera endorsement, and a requirement asserting an asset is available all **validate**, and none reaches an accessor result.

**Requirements, never assertions of existence.** Production and asset needs are expressed as requirements in a closed category set (location, vehicle, person, equipment, prop, permission), each branded `availabilityVerified: false`. The stage never claims that a person, shop, vehicle, repair, result, asset, location, promotion, or before/after evidence exists, is owned, is available, is safe, or has consent.

**The zero-bound-script-claims decision, made explicitly.** When stage 3 bound no claims, stage 4 **refuses before the model call** rather than producing a finished-looking production plan whose factual or visual implications have no evidence authority — a plan that would go to human producers and to later stages with no mechanism to keep it non-factual, and a picture asserts without anyone writing the claim down. **Authority is never widened back to stage 2's whitelist or to the pack to rescue the request.** Accepted cost, stated honestly: a purely atmospheric piece that depicts nothing factual cannot be directed by this stage, and would need its own authorised contract rather than a silent widening of this one.

**Explicit stage exclusions.** Stage 4 produces direction only. It does not generate, download, inspect, resize, transcode, hash, host, or store media; select an image provider or model; return URLs, digests, QC results, provenance, hosted flags, or approval state; or perform platform adaptation, cropping, feed-profile selection, translation, alt-text localisation, hashtag selection, timing, scheduling, approval, or publication. Those belong to deterministic runtime services, human production, later stages, or existing production code.

**Why `agents/image.md` was rejected as this stage's prompt.** It was the registered placeholder and would have been executed verbatim. Verified from the merged file: it pins `model: claude-sonnet-4-6` in frontmatter, declares `tools: Read, Skill`, expects a runtime brief and a configured `platforms` list, states that copy generation *"runs concurrently and is not an input to this call"* — so it never consumes stage 3 — routes between image providers by content type, requires one of four runtime feed profiles, requests bilingual alt text, writes a CTA and a URL into the frame, and describes runtime generation, fetch, QC and hosting. Executing this stage against it would have meant running one contract while claiming another. It is **preserved unchanged** for the existing image-generation flow. The replacement `agents/production-direction.md` declares `tools: []`, pins no model, and states that the stage cannot browse, read files, call APIs, generate or inspect media, run code, operate a camera, or publish.

**Why `skills/image-brief/SKILL.md` was not injected here.** Verified from the merged file: it mixes genuine production craft with concrete brand assets, exact hex colours, the registered slogan, per-platform feed profiles, provider and model routing, generation, hosting, QC, accessibility and publication-era checklist rules. Injecting it as instruction would let a stage that only directs reacquire factual and platform authority the pipeline deliberately withheld. It is **preserved unchanged** — `agents/image.md` loads it by name, and `compliance-checklist`, `model-routing`, `brand-voice`, `platform-specs` and `MASTER_PROMPT.md` all cross-reference it. `skills/production-craft/SKILL.md` replaces it here with production craft only: sequencing, shot purpose, composition, framing, movement, continuity, legibility, and practical notes. Tests assert it contains **no approved-fact value, vehicle make, address, locality, service fact, warranty or automotive figure, slogan, CTA destination, provider or model name, platform profile, or runtime generation/QC instruction**, and that it asserts no asset ownership or availability.

**Testing.** The offline suite grew from 418 to **560** checks in `test:content-intelligence` (**845** across all eight offline suites, both measured locally on the merged source), every model call through an **injected runner**. Nothing reaches Anthropic or any network, and this executor has no default runner to fall back to. The suite was confirmed to pass with a **nonempty `ANTHROPIC_API_KEY`** *and* `ANTHROPIC_BASE_URL` pointed at an unreachable local port, so any real provider request would have failed loudly rather than passing silently. The executor-module inventory now asserts exactly **four** implemented stage executors, checked against the agents directory listing so a fifth cannot pass silently.

**Corrections made under independent review, before merge.** Both findings were real:

1. **The oversized-handoff regression was not load-bearing.** `BE13` asserted that the aggregate Stage 3 handoff bound *"exists and is enforced"* while never calling `executeProductionDirection` and never asserting a rejection, so deleting the executor's `scriptOutputChars` check would not have failed it. Its setup also built one pack from full-length ids while validating the truth output against a *separate* pack of truncated ids, and its comment claimed Stage 3 leaves ids unbounded — false, since `validateHookStoryScriptOutput` bounds `claimUse[].factId` to 200 characters. Replaced with a genuine execution test over **one matching pack** of twelve distinct valid citable automotive facts (ids 199 characters), a truth output permitting all twelve, and a structurally valid Stage 3 output built from valid per-field maximums only. `BE13` proves the rendered handoff is **22,093 characters** against the 20,000 bound; `BE14` executes the stage and asserts a `StageExecutionError`; `BE15` asserts the injected runner received **exactly zero** calls. Verified load-bearing by mutation: removing the aggregate check makes `BE15` fail, and the executor was then restored byte-for-byte.
2. **Stale remaining-stage counts.** `docs/ARCHITECTURE.md` and `docs/STATUS.md` said three stages remain unwired. The target architecture has six stages and four now have executors, so only **`packaging-adaptation` and `final-critic`** remain. Corrected in both, with a sweep of active Markdown excluding `docs/archive/` finding no other stale count.

**Reviewed exact-head CI.** All five jobs succeeded on `9be76b0126052150b2d408c6996c7103126d3b46`: Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML static validation. **That is repository validation for dormant source, not deployment or production evidence.**

**Rollback / recovery:** revert the merge. No migration, data rollback, Render action, provider reconciliation, or production cleanup is required, because the executor is dormant and nothing in production reaches it.

**Security posture.** The slice added no tool mechanism, provider mechanism, media operation, publication path, approval path, database write, evidence-write path, deployment authority, or production authority. It added no route, migration, environment variable, credential, dependency, lockfile change, workflow change, or `render.yaml` change, and changed no `executionEnabled` flag.

**Accepted limitations.** The stage is dormant: nothing calls it. Visual and factual truth are not verified, per the paragraphs above. Determinism is proven for the validators and the boundary **with an injected runner** — real model output is not deterministic and is not claimed to be. No production caller for any stage executor exists in this repository, and every test here used an injected runner; whether any executor has **ever** been invoked against a real model outside this repository is **UNKNOWN / NOT ESTABLISHED**, because neither Render nor provider histories were inspected. No output of any of them has been reviewed for quality.

### Phase 0B.5 — packaging-adaptation stage executor

**State:** **`MERGED`** through PR #50, **not `ENABLED`, not established as `DEPLOYED`, and not `PRODUCTION-VALIDATED`**. The executor is present on `main` and deliberately dormant. **Production evidence: none.** Merge changed repository state only.

**Merge record.** PR #50, **“Phase 0B.5 — dormant packaging-adaptation stage executor,”** merged base `813b8a0d0a1bd53af4d96dc1b9faf4dfa390bae7` and reviewed head `d901896dda7484b062a0975916ad7a977c4fb904` as merge `360f89a71f3af85155965e65d2f40d6f705bd795`. Its ordered parents are the base followed by the reviewed head. The implementation was first presented at `34c0dce4989f685342c731961c1e3c865d9c83e5`; the sole intervening corrective commit was `d901896dda7484b062a0975916ad7a977c4fb904` (`fix: harden packaging adaptation boundaries`). The reviewed PR changed 14 files with 2,309 additions and 43 deletions. No schema or migration changed.

**Dormancy.** No worker, scheduler, orchestrator, API, preview, approval, publication, provider, media, Slack, database, or evidence-write path reaches the executor; the preview stays inert. All six registry entries still have `executionEnabled: false`. The change added no route, migration, environment variable, credential, dependency, lockfile change, workflow change, or `render.yaml` change, and created no provider payload or scheduling behaviour.

**Delivered:** the `packaging-adaptation` executor and its output contract (`src/harness/agents/packagingAdaptation.ts`), a dedicated tool-free prompt (`agents/packaging-adaptation.md`), a craft-only stage skill (`skills/adaptation-craft/SKILL.md`), the registry correction, and a shared Stage 4 revalidator (`revalidateProductionDirectionOutput`) exported from the owning module. It reuses `invokeStage`, the strict JSON parser, the central model-policy resolver, the shared evidence helpers, and the injected single-shot runner unchanged. **No second model boundary, retry, repair call, policy table, provider mechanism, or tool mechanism.**

**Deterministic policy is reused, not redeclared.** The per-platform caption and hashtag limits are **imported from `packageMap.ts`**, the module that already enforces them on provider text — Instagram 8–15 hashtags and 2,200 provider-visible characters, Facebook at most 2, Google Business Profile zero hashtags and 1,500 characters. Captions may contain no hashtag token; canonical tags belong only in the dedicated array, and the caption plus the same two-newline separator and canonical tag list used by production must fit the imported provider-visible limit. `packageMap.ts` exports the single tokenizer used by both paths as well as the shared limits. **No competing value or parser is defined anywhere.**

**A naming divergence, recorded rather than hidden.** The repository's provider-payload `Platform` union spells Google Business Profile **`gbp`**. This stage's closed enum spells it **`google_business_profile`**, because a stage-5 package is review metadata and must never be mistaken for a publishable payload. `PACKAGING_PLATFORM_PRODUCTION_ID: Record<PackagingPlatform, Platform>` is exhaustive in the forward direction and `PRODUCTION_PLATFORM_PACKAGING_ID: Record<Platform, PackagingPlatform>` is exhaustive in the inverse direction. TypeScript therefore requires an explicit reviewed mapping change when either union adds or renames a member; runtime assertions and tests prove both round trips. Together they establish a bijection without collapsing the two public vocabularies.

**The Stage 5 authority boundary.** **Stage 3's actually used claims remain the complete factual authority for platform copy.** Authority is not widened to stage 2's whitelist, the complete evidence pack, model knowledge, or the rejected platform/local-SEO assets — and **not to stage 4 either**: its direction prose, overlay wording, production requirements and claim-visual summaries are creative and production context, never factual authority. Equally, **stage 4's narrower visual selection does not erase a claim the script used**: captions adapt the *script*, so the available set stays the stage 3 used-claim set. The model receives exactly four bounded, labelled untrusted blocks — `SCRIPT_OUTPUT`, `PRODUCTION_OUTPUT`, `REQUESTED_PLATFORMS`, `SCRIPT_CLAIMS` — *(six since the writer-restriction change, `IMPLEMENTED` and not merged, which adds stage 2's `REQUIRED_CAVEATS` and `FORBIDDEN_CLAIMS` as binding restrictions; corrected 2026-09-28: `MERGED` through PR #92 at `f2a58785c8a9aa2605dda3c7f7daf34ffdf16007`, not deployed)* and never the complete pack, stage 2's provisional prose, stage 2's wider whitelist, raw references, or active environment, provider, account or location configuration.

**The typed handoff is revalidated, not trusted — and the limit is exact.** The invocation requires the complete `HookStoryScriptOutput`, the complete `ProductionDirectionOutput`, the complete `AutomotiveTruthOutput` (used **only** to revalidate the chain), the same evidence pack, a nonempty requested-platform list, and an injected runner. All three prior values are revalidated through the owning modules' own exported revalidators before any model call. **Prior-stage values are treated as untrusted and revalidated against the same evidence pack. Values that fail the prior contracts are refused before the model call. This is structural validation, not provenance or authenticity verification; a structurally valid deserialized or hand-built value can pass.**

**Evidence access remains id-bound.** The supported accessors take the requested platform plus bound evidence ids and return exact evidence records or texts. They never read caption, hashtag, local-keyword, timing, open-question, claim-use-summary, or Stage 4 prose. Model-authored wording therefore cannot become evidence through an accessor.

**What is NOT guaranteed, stated plainly.** The validator does not prove that a caption faithfully preserves the script, that a translation or shortening keeps meaning, that hashtags or local keywords are relevant or truthful, that timing is useful, that every factual implication was cited, or that obfuscated or semantic destination prose is absent. **No language model in this pipeline proves any of those true.** The gap is contained by type and by literal `false` branding, never by semantic keyword matching: packaging returns branded `provisional_model_prose` with `verified`, `publishable` **and `executable`** all false; caption wording is branded `captionVerified: false`, hashtag and keyword selection `selectionVerified: false`, and the timing recommendation both `timingVerified: false` and **`schedulable: false`**. A recommended time is a bounded `HH:MM ET` note carrying no date and no timestamp, so its shape refuses to become a scheduler instruction. A regression demonstrates each semantic limit: a drifting caption, an unsupported local keyword and a useless recommended time all **validate**, and none reaches an accessor result.

**No publication surface.** Dedicated provider, payload, media, destination, account, location, CTA, URL, hosted/provenance/QC, approval, publication, scheduling, executable-timestamp, and API fields are structurally absent. A single reusable guard additionally rejects recognizable URL syntax — explicit URI schemes and `www.` tokens — from all four model-authored prose channels: caption, local keyword, open question, and claim-use summary. Evidence ids and evidence-record text are not rewritten or screened. This is an honest syntactic boundary, not a claim that deliberately obfuscated destinations or indirect prose such as “our booking page” are semantically detectable.

**Independent-review corrections.** Review required three narrow, load-bearing corrections before merge: (1) exhaustive forward `Record<PackagingPlatform, Platform>` and inverse `Record<Platform, PackagingPlatform>` maps plus both runtime round trips, preserving `google_business_profile` for review and `gbp` for provider payloads; (2) refusal of hashtag tokens in caption prose plus enforcement of the combined caption, two-newline separator, and canonical-tag string against the provider-visible limit, all using the shared production tokenizer; and (3) one reusable recognizable-URL syntax guard across caption, local keywords, open questions, and claim-use summaries. These corrections added no semantic truth claim and no publication authority.

**The zero-used-claims decision, made independently.** A legitimate stage 4 run already refuses when stage 3 bound nothing, but stage 5 does not assume it was reached legitimately and **refuses before its own model call**. Authority is never widened back to stage 2, the pack, or stage 4's prose to rescue the request.

**Why all four placeholder assets were rejected, and preserved.** Verified from the merged files. `agents/platform-formatter.md` and `agents/hashtag-seo-timing.md` each pin their own concrete model, declare `tools: Read, Skill`, and describe *separate subagent calls* — registering both would imply two model contracts where this stage has one. They depend on runtime briefs, active-platform configuration, analytics readouts, assembled images, alt text, provider payload behaviour, destinations, CTA URLs, and publication-era application behaviour. `skills/platform-specs/SKILL.md` mixes useful format guidance with media profiles, provider payload construction, `ACTIVE_PLATFORMS` environment state, runtime publication behaviour, CTA behaviour, alt-text handling, scheduling behaviour and current production implementation detail. `skills/local-seo/SKILL.md` states concrete business, location, make and service claims — a street address, city lists, positioning slogans and makes — which the classified stage 3 claim set may not establish; injecting it would let this stage reacquire factual authority from a keyword file. **All four are preserved byte-for-byte** for the orchestrator flow and the subagents that still load them by name, and a test asserts no registered stage points at any of them.

**Testing.** The reviewed head passed **741** checks in `test:content-intelligence` (**1,026** across all eight offline suites), every model call through an **injected runner**. It passed the complete local validation contract under Node 22: `npm ci`, typecheck, build, offline suites, simulated dry run, deployment-controller fixtures, Markdown links, environment coverage, sensitive-content scan with manual triage, production dependency audit (**0 vulnerabilities**), `git diff --check`, and complete diff review. The exact reviewed head passed all five GitHub jobs: Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML static validation. AgentShield reported grade **A**, score **94**, with no critical or high findings. The offline suite was also confirmed to pass with a **nonempty `ANTHROPIC_API_KEY`** and `ANTHROPIC_BASE_URL` pointed at an unreachable local port. Eight deliberate mutations of the executor were used to confirm the safety assertions are load-bearing. The original five removed the zero-claims refusal, platform-order check, aggregate handoff bound, hashtag-array policy, and used-claim membership check. Independent review then removed the caption hashtag-token guard (four named checks failed), the combined provider-visible length guard (the one-over-boundary check failed while the exact boundary still passed), and the reusable URL-shaped prose guard (all four channel checks failed). The executor was restored byte-for-byte after every mutation. The earlier exercise also found and fixed a real test weakness: the claim-binding regressions originally used a catch-any-throw helper and would have passed on an incidental `TypeError`; the whole section now requires the stage's own typed `StageExecutionError`.

**Security, rollback, and accepted limitations.** The stage is dormant: nothing calls it, it receives no provider or deployment authority, and literal `false` brands prevent its result from being treated as publishable, executable, or schedulable. Caption faithfulness, keyword and hashtag relevance or truth, timing usefulness, uncited implications, and obfuscated or semantic destinations are not verified, per the paragraphs above. Determinism is proven for the validators and the boundary **with an injected runner** — real model output is not deterministic and is not claimed to be. No production caller for any stage executor exists in this repository, and every test here used an injected runner; whether any executor has **ever** been invoked against a real model outside this repository is **UNKNOWN / NOT ESTABLISHED**, because neither Render nor provider histories were inspected. Repository rollback is to revert PR #50's merge commit. No migration, database, Render, provider, approval, publication, or production cleanup is required because none was introduced. Documents reconciled after merge: `README.md`, `docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY_AND_CONTINUITY.md`, `docs/STATUS.md`, and `docs/TESTING.md`.

### Phase 0B.6 — final-critic stage executor

**State:** **`MERGED`** through PR #52. **Not `ENABLED`, not established as `DEPLOYED`, and not `PRODUCTION-VALIDATED`.** The executor is on `main` and is deliberately dormant. **Production evidence: none.** This is the sixth and last of the six target stage executors: **all six are now merged to `main`**, all six remain dormant with `executionEnabled: false`, and none is reached by any production path. The existing live `brand-compliance-critic` publishing gate is unchanged.

**PR record — durable identifiers.** PR #52, **“Phase 0B.6 — dormant final-critic stage executor,”** from `codex/phase-0b6-final-critic` into `main`.

| | |
|---|---|
| Pull request | **#52** |
| Base | `0d319f937c5153bafa75b31b8f9b880555560c50` (PR #51's merge, itself following PR #50's merge `360f89a71f3af85155965e65d2f40d6f705bd795`) |
| Reviewed head | `f97425c65d3e5ac37540d3cef8779a84e2be8d29` |
| **Merge commit** | **`ec2a0b78e84386d5491db96418a53c64ee3a8e08`** |
| Ordered parents | first `0d319f937c5153bafa75b31b8f9b880555560c50` (base), second `f97425c65d3e5ac37540d3cef8779a84e2be8d29` (reviewed head) |
| Merged | 2026-09-02, by the repository owner, after independent pre-merge inspection |
| Diff | 13 files changed, 2,529 insertions(+), 46 deletions(−) |
| Commits | `9d1cfe8` (implementation), `6b39485` (first documentation), `f3bb36f` (review round 1), `5370e5e` (review round 2), `d3e7428` (payload-boundary reconciliation), `f97425c` (CI-wording fix) |

The merge is an ordinary merge commit, so the base is the first parent and the reviewed head the second — the reviewed tree is reachable unchanged. Merging performed no deployment: the `Deploy production to Render` workflow fired on the resulting `main` push and refused at its `RENDER_DEPLOY_AUTOMATION_ENABLED` gate, with the release job skipped.

**Dormancy.** No worker, scheduler, orchestrator, API, preview, approval, publication, provider, media, Slack, database, or evidence-write path reaches the executor; the preview stays inert. All six registry entries still have `executionEnabled: false` — this slice did not change that field for any stage. The change added no route, migration, environment variable, credential, dependency, lockfile change, workflow change, or `render.yaml` change, and created no provider payload, approval logic, or scheduling behaviour. **Merge changed repository state only; it is not deployment or production-validation evidence.**

**Delivered:** the `final-critic` executor and its output contract (`src/harness/agents/finalCritic.ts`), a dedicated tool-free prompt (`agents/final-critic.md`), a craft-only stage skill (`skills/critique-discipline/SKILL.md`), the registry correction (this stage's entry only), and a shared Stage 5 revalidator (`revalidatePackagingAdaptationOutput`) exported from `packagingAdaptation.ts`. It reuses `invokeStage`, the strict JSON parser, the central model-policy resolver, the shared evidence helpers, and the injected single-shot runner unchanged. **No second model boundary, retry, repair call, critique/revision loop, policy table, provider mechanism, or tool mechanism.**

**The Stage 6 authority boundary.** **Stage 3's actually used claims remain the complete factual authority, narrowed one step further than stage 5's own boundary.** `PLATFORM_CLAIMS` is not stage 3's whole used-claim set; it is stage 5's own typed, per-platform claim bindings, read only through stage 5's evidence accessor (`packagingClaimRecords`) — never through a caption, a hashtag, a local keyword, or a claim-use summary. The model receives exactly six bounded, labelled untrusted blocks — `SCRIPT_OUTPUT`, `PRODUCTION_OUTPUT`, `PACKAGING_OUTPUT`, `REQUESTED_PLATFORMS`, `SCRIPT_CLAIMS`, `PLATFORM_CLAIMS` — and never the complete pack, stage 2's provisional prose, stage 2's wider whitelist, raw references, `config/approved-facts.json`, active environment/provider/account/location configuration, image or media content, or approval state.

**The typed handoff is revalidated, not trusted, one stage further down the chain.** The invocation requires the complete `HookStoryScriptOutput`, `ProductionDirectionOutput`, `PackagingAdaptationOutput`, the complete `AutomotiveTruthOutput` (used **only** to revalidate the chain), the same evidence pack, and an exact, nonempty, ordered `requestedPlatforms` list. All four prior values are revalidated through the owning modules' own exported revalidators before any model call, in order: automotive-truth → hook-story-script → production-direction → packaging-adaptation. A fifth, distinct check then confirms the requested-platform sequence exactly matches stage 5's own package sequence — membership **and** order, checked against what packaging-adaptation actually produced, not merely a well-formed list. **Prior-stage values are treated as untrusted and revalidated against the same evidence pack. Values that fail the prior contracts are refused before the model call. This is structural validation, not provenance or authenticity verification; a structurally valid deserialized or hand-built value can pass.**

**Never a clearance — structurally, not by convention.** The critique carries five literal-`false` fields on its assessment — `authoritative`, `approvalGranted`, `publishable`, `executable`, `productionValidated` — asserted by the validator, never copied from the model. Each finding and each claim-finding-use entry is separately branded `authoritative: false`. The output contract has **no field** through which a model could set any of the five assessment-level brands true; a model that tries (an extra top-level field, say `approvalGranted: true`) is refused outright, not silently dropped — a regression proves this by feeding exactly that and confirming the whole call fails closed. `verdict` (`provisional_pass` | `needs_revision` | `needs_human_review`) is checked for **structural** self-consistency against each finding's `severity` and `owner` (`hook-story-script` | `production-direction` | `packaging-adaptation` | `human_review`) — never against a separate model-supplied boolean: `provisional_pass` cannot coexist with a blocking finding; `needs_revision` requires a blocking finding owned by a revisable Stage 3/4/5 owner; `needs_human_review` requires a blocking finding owned by human review, and a human-review verdict backed only by advisory findings fails. This is **not** a correctness check — nothing here proves a finding is actually right, that the package really has the problem described, or that the verdict or owner assignment is the right call.

**Claim-finding binding rules.** Every entry in `claimFindingUse` must name a finding the model actually returned (`findingIndex` in range), a platform that was actually requested, and a fact id **stage 5 actually bound for that exact platform** — an id from `SCRIPT_CLAIMS` that stage 5 never bound on that platform still fails, as does a fabricated id. The duplicate identity is the **exact `(findingIndex, platform, factId)` triple**: repeating it fails, but the same `(platform, factId)` pair may legitimately back two different findings — each finding's citation of a claim is its own, independent use. A platform-specific finding's bindings must all name that finding's own platform; a `cross_platform` finding's bindings may name any requested platform, each still independently bound by stage 5 for that platform. `criticClaimRecords()` and `criticClaimTexts()` take a platform plus bound ids and return exact evidence records or texts; they never read a verdict, a summary, a finding's issue, owner, or suggested action, or a claim-finding summary.

**Independent-review corrections.** Three independent review rounds ran before this PR merged, and every finding was corrected without weakening any existing revalidation. Round 1 raised items 1–4 below; round 2 reopened item 1 (recorded inside it) after showing the replacement bound was still defective; round 3 raised items 5–6. All are part of the merged slice.

1. **The aggregate `PACKAGING_OUTPUT` bound rejected valid Stage 5 output.** `FINAL_CRITIC_LIMITS.packagingOutputChars` was 20,000, while a structurally valid Stage 5 package can legitimately carry a Facebook caption up to `FACEBOOK_TEXT_MAX` (63,206 characters) with zero hashtags. It was first raised to a hand-measured 100,000, which **a second review round showed was still wrong**: the measurement used ordinary filler characters, but the check is against `JSON.stringify(...).length`, and Stage 5's validators bound *code units*, not serialized size. A caption of 63,206 quotation marks satisfies every Stage 5 caption, hashtag, URL and combined provider-visible rule while serializing to 126,412 characters. The bound is now a **conservative safe upper bound derived mechanically** from Stage 5's own exported field and array maxima: every string field is counted at its Stage 5 maximum code-unit length and multiplied by the maximum characters `JSON.stringify` can emit per code unit (**six**, for a `\uXXXX` escape of a control character or unpaired surrogate), with generous fixed allowances for short enumerated fields and the JSON skeleton, and with caption and hashtag content each allowed a full `captionMax` per package even though Stage 5 makes them share one. It is deliberately an over-approximation, not the exact mathematical maximum, and is described as such. Regressions prove both an ordinary-character maximal caption and an all-quote caption reach the injected runner exactly once, whole and untruncated.
2. **The output contract had substituted a different design than agreed.** Restored: `verdict` is `provisional_pass` | `needs_revision` | `needs_human_review` (not the prior `no_blocking_findings`/`blocking_findings_present`/`escalate_human_review`); finding `platform` is a requested platform or `cross_platform` (not `"all"`); `severity` is `blocking` | `advisory`; `category` is `claim_fidelity` | `uncited_implication` | `platform_semantics` | `voice_clarity` | `hashtag_keyword_relevance` | `timing` | `production_coherence` | `human_decision` (not the prior five-value set); every finding now carries an `owner` naming a revisable Stage 3/4/5 stage or `human_review`; the invented raw `requiresHumanReview` boolean is removed, with verdict consistency now anchored on `severity` + `owner` instead.
3. **Claim-finding binding semantics were tighter than agreed.** The duplicate identity is now the exact `(findingIndex, platform, factId)` triple rather than the bare `(platform, factId)` pair, so the same claim may legitimately back two different findings. A new platform-coherence check requires a platform-specific finding's bindings to name its own platform, while a `cross_platform` finding may bind any requested platform.
4. **The PR description understated documentation status.** It said documentation "will follow" after the documentation commit was already present; corrected to describe the actual final state.
5. **The quoted packaging envelope was not a universal one.** A design review had computed a `54,460`-character packaging allowance, but that figure assumed nominal-length evidence claims. Because `EvidenceRecord.claim` is unbounded, `SCRIPT_CLAIMS` and `PLATFORM_CLAIMS` have no finite structural maximum, and the allowance is a *difference* — `MAX_PAYLOAD_CHARS` minus the serialized sizes of the other five framed blocks — which is zero or negative for large enough valid claim text even with a minimal Stage 5 package. **No fixed positive packaging allowance exists until evidence text is bounded.** No such figure is encoded as a constant in source, tests or documentation, and none is stated as a contract; where a number appears it is labelled an example computed for particular claim lengths. `BX24`–`BX28` prove this behaviorally, measuring the allowance against the real framed-block construction with the framing overhead taken from an actual assembled prompt rather than a duplicated copy of the delimiter text.
6. **Documentation could be read as claiming Stage 6 accepts the complete valid Stage 5 contract.** The acceptance claim (this stage's per-block bound never rejects what Stage 5 accepts) and the refusal fact (the shared boundary refuses a maximal Stage 5 output) were both true but separated by roughly 1,500 words in `docs/TESTING.md`. They are now stated adjacently everywhere either appears, together with the unbounded-claim consequence, so neither half can be read alone.



**What is NOT guaranteed, stated plainly.** The validator does not prove that a finding is correct, that the package actually has the problem described, that a suggested action would fix it, or that the verdict is the right call — and it does **not** replace the existing, currently-running `brand-compliance-critic` gate the live orchestrator runs against the real provider payload; that critic is unchanged. **No language model in this pipeline proves any of those true.**

**No publication or approval surface.** Dedicated provider, payload, media, destination, account, location, CTA, URL, approval, publication, scheduling, and legacy-subagent-routing fields are structurally absent. The same reusable recognizable-URL syntax guard stage 5 uses is reused (not reimplemented) across every prose field this stage returns: the summary, each finding's issue and suggested action, and each claim-finding summary.

**The zero-used-claims decision, made independently.** Stage 5 already refuses when stage 3 bound nothing, but stage 6 does not assume it was reached legitimately and **refuses before its own model call**. Authority is never widened back to stage 2, the pack, or stage 4/5 prose to rescue the request.

**Why the three registered legacy assets were rejected, and preserved.** Verified from the merged files. `agents/brand-compliance-critic.md` pins a concrete model, declares `tools: Read, Skill`, reads a runtime-injected `brief.approvedFacts`, evaluates the exact provider payloads GCD's live posting path builds, and returns a routing field naming one of the legacy subagents (`copywriter`/`image`/`hashtag-seo-timing`/`platform-formatter`) — none of which exist in this pipeline. `skills/compliance-checklist/SKILL.md` is that critic's rubric and states concrete facts of its own — an address, a city, a warranty term, WCAG contrast numbers, GBP field policy. `config/approved-facts.json` is GCD's raw business-fact reference, already the evidence system's source for `verified_business_fact` records; a second, raw copy would compete with the classified, pack-bound projection. **All three are preserved byte-for-byte** for the orchestrator's existing critic call site, and tests assert the checklist is registered on no stage and the reference is absent from this stage's declaration.

**Testing.** `test:content-intelligence` reports **878** passing checks (directly counted at this head), up from 741 at the Phase 0B.5 record — the Phase 0B.6 group (`BT`–`CB`) contributes the increase, and two pre-existing checks left over from Phase 0B.5 were corrected (`AF5`'s five-executor filesystem count and `AL2`/`AL3`'s expectation that `final-critic` still registers `compliance-checklist`). Across the routine eight-suite offline sequence, directly counted at this head: posting 52, image 18, orchestrator 108, gate 56, API 51, render-identity 1 invariant-suite pass, ownership 112, content-intelligence 878 — **1,276 passing assertions total**. Every model call in the new stage's tests goes through an **injected fake runner**. It passed the complete local validation contract under Node 22: `npm ci`, typecheck, build, offline suites, simulated dry run, deployment-controller fixtures, Markdown links, environment coverage, sensitive-content scan with manual triage, production dependency audit (**0 vulnerabilities**), `git diff --check`. The offline suite was also confirmed to pass with a **nonempty `ANTHROPIC_API_KEY`** and `ANTHROPIC_BASE_URL` pointed at an unreachable local port.

**Thirteen deliberate mutations** of the executor confirmed load-bearing — the first ten below, then three more from the two later review rounds, each restored byte-for-byte afterward: (1) the `provisional_pass`/blocking-finding consistency check — failed `BY11`; (2) the `needs_revision`/`needs_human_review` owner-consistency checks — failed `BY12`–`BY15`; (3) the requested-platform-sequence check — failed `BX9`, `BX10`, `BX13`; (4) the exact-triple duplicate guard — failed `BY25`; (5) the finding-platform coherence guard — failed `BY27`; (6) the zero-used-claims pre-model refusal — failed `CA2`; (7) the per-platform claim-binding check — failed `BY23`, `BY24`; (8) the call to `revalidatePackagingAdaptationOutput` (bypassed, using the raw invocation value directly) — failed `BX3`, `BX5`, `BX13`; (9) a validator-authored literal no-approval brand (`approvalGranted` flipped to `true`) — failed `BT4`, `BY19`; (10) the aggregate bound (reverted to the then-previous 20,000-character value) — reproduced the original defect with `StageExecutionError: stage final-critic: "packagingOutput" exceeds 20000 characters`. A second review round then found the replacement bound still defective, and an **eleventh mutation** proves its correction load-bearing: (11) restoring the hand-measured 100,000-character value failed `BX20`, `BX21`, `BX22` and `BX23`, refusing a valid all-quote-caption Stage 5 output with `StageExecutionError: stage final-critic: "packagingOutput" exceeds 100000 characters`. A third round then added the unbounded-evidence regressions, and **two further mutations** prove those load-bearing: (12) narrowing the `PLATFORM_CLAIMS` projection to a single requested platform — failed `BU8`, `BX25`, `BX26` and `BX27`, because the duplicated projection is exactly what exhausts the shared boundary; and (13) removing the dynamic-envelope wording from the executor's own documentation — failed `BX28`. `BX24` asserts a property of the *evidence contract*, not of this executor, so no executor mutation can exercise it and none is claimed. The executor was restored byte-for-byte after each; its final restored SHA-256 is `e3ab27127287835c828c60f9c365b04b21022f9aaa2e4b655841d1005fe9695d`. AgentShield and the two-version PostgreSQL matrix run in CI only (this session cannot fetch the pinned scanner or the disposable Postgres images) and are **not** represented as locally verified. All five CI jobs — Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and Workflow and YAML static validation — passed at the reviewed head `f97425c65d3e5ac37540d3cef8779a84e2be8d29` (run 33633685872), and again on the resulting `main` push at merge commit `ec2a0b78e84386d5491db96418a53c64ee3a8e08` (run 33634930025). Both are historical, immutable identifiers.

**The boundary limit this correction surfaced, recorded rather than hidden — and the two facts kept adjacent.** *(Durable record of Phase 0B.6 as merged. Every limitation stated in the five paragraphs that follow is addressed by the payload-contract reconciliation recorded in its own section below, which is now `MERGED` through PR #54 and is not established as deployed and not enabled. Read them as the state at PR #52's merge, not as the current state of `main`.)*

*First:* this stage's own `packagingOutputChars` ceiling is now a conservative, escaping-aware upper bound derived mechanically from Stage 5's exported maxima, and it is safely above every Stage 5-valid serialized package. **This stage's per-block bound can no longer be the reason a valid Stage 5 handoff is refused.**

*Second, and inseparable from it:* **Stage 6 as a whole still does not accept every structurally valid Stage 5 handoff**, because the *shared* assembled-payload boundary `MAX_PAYLOAD_CHARS` (120,000) in `stageExecution.ts` — merged infrastructure every stage uses, which this slice deliberately does not change — applies to the whole framed payload. An all-quote caption at the full `FACEBOOK_TEXT_MAX` serializes to 126,412 characters for the caption alone; the refusal comes from that shared boundary, before any model call, and `BX22` asserts exactly that, including which message is raised and that zero runner calls occur.

*Third:* there is **no fixed positive packaging envelope to quote.** `SCRIPT_CLAIMS` and `PLATFORM_CLAIMS` have **no finite structural maximum**, because `EvidenceRecord.claim` is unbounded — the TypeScript contract requires only a non-empty value and `state/migrations/006_content_evidence.sql` enforces only `length(btrim(claim)) > 0` — and a record bound for several platforms is projected once per platform. The relationship is a difference, not a constant:

> available packaging payload = `MAX_PAYLOAD_CHARS` − the serialized sizes of the other five framed blocks

With sufficiently large but currently valid evidence claims that remainder is **zero or negative even for a minimal Stage 5 package**, so no fixed positive packaging allowance exists until evidence text is bounded. `BX24`–`BX28` prove this behaviorally: an oversized claim is contract-valid today, the duplicated projections alone exhaust the boundary, the refusal is a typed `StageExecutionError` from `final-critic` carrying `assembled input exceeds the bound` rather than this stage's own message, it costs **zero** injected-runner calls, and the allowance is measured as a difference from the exported `MAX_PAYLOAD_CHARS` against the real framed-block construction rather than encoded as a constant. Any figure quoted for that allowance is an example computed from particular evidence-claim lengths, never a contract.

**The same mismatch already exists between merged Stages 2 and 5, and on the output side.** Every producer/consumer guard below compares `JSON.stringify(prior, null, 2).length` against a constant smaller than the producer contract's own structural maximum: Stage 1 → Stages 2 and 3, Stage 2 → Stage 3, Stage 3 → Stages 4, 5 and 6, and Stage 4 → Stages 5 and 6. Stage 6's `scriptOutputChars` (20,000) and `directionOutputChars` (24,000) mirror the merged `PACKAGING_LIMITS` values verbatim; diverging here would make stage 6 accept handoffs merged stage 5 refuses, so they stay aligned and the mismatch is recorded instead. Separately, on the **output** side, a structurally valid `final-critic` output is substantially larger than the `critic` policy's configured 2,000-token budget in `modelPolicy.ts`, and Stage 5 has the equivalent problem with its 3,000-token budget and provider-sized captions.

**These are accepted dormant limitations, not production validation.** Every registry entry reports `executionEnabled: false`, no production path reaches any executor, and oversized input fails closed before any model call. Nothing here is claimed to be validated against a real model or a real workload.

**Prerequisite to production wiring and to enabling any stage: a payload-contract reconciliation.** Not a new phase number. **`MERGED` through PR #54; not established as deployed, not enabled, and not production-validated.** It was required to, and does:

1. **bound evidence text in TypeScript and PostgreSQL** — after a read-only audit of existing `content_evidence` rows, so a length `CHECK` cannot fail against data already stored;
2. **handle migration and rollback explicitly** — a `CHECK` constraint on a populated table needs a planned down-migration, stated before the up-migration is written;
3. **derive every producer/consumer handoff guard from the producer contract**, so each consumer's ceiling is provably at least the producer's serialized maximum under worst-case JSON escaping;
4. **derive the shared assembled-payload boundary** rather than carrying an undocumented round number — `MAX_PAYLOAD_CHARS` and `MAX_INSTRUCTION_CHARS` recorded no rationale, derivation, or model;
5. **reconcile output contracts with model `maxTokens`** for `critic`, `reasoning-standard` and `reasoning-heavy`;
6. **add derivation regressions preventing future drift** — recomputed from the exported limits at test time, so no later contract change can silently reintroduce this class of defect;
7. **consider narrower Stage 6 projections** in place of whole serialized prior-stage outputs, where they preserve the critique contract.

Phase 0B.6 performed none of that; changing shared execution behavior, per-stage payload overrides, evidence contracts, migrations, or model token budgets was out of its scope. What the reconciliation itself did is recorded in the section immediately below.

**Security, rollback, limitations, and explicit non-actions.** The stage is dormant: nothing calls it, it receives no provider or deployment authority, and its five literal `false` brands prevent its result from being treated as an approval, a publication, an execution, or production validation. Finding correctness, whether the package actually has a described problem, and suggested-action efficacy are not verified, per the paragraphs above. Determinism is proven for the validators and the boundary **with an injected runner** — real model output is not deterministic and is not claimed to be. No production caller for any stage executor exists in this repository, and every test here used an injected runner; whether any executor has **ever** been invoked against a real model outside this repository is **UNKNOWN / NOT ESTABLISHED**, because neither Render nor provider histories were inspected.

**Rollback** is to revert PR #52's merge commit `ec2a0b78e84386d5491db96418a53c64ee3a8e08`, which removes the executor, its assets, its registry entry and its tests in one step. No migration, database, Render, provider, approval, publication, or production cleanup is required, because none was introduced — the merge added no migration, route, environment variable, credential, dependency, lockfile change, workflow change or `render.yaml` change, and changed no `executionEnabled` field.

**Explicit non-actions in this phase.** Nothing was enabled, deployed, approved, scheduled or published. No Render change, no GitHub variable or settings change, no production SQL, no `evidence:sync`, no provider or model call — every test used an injected runner. The shared execution boundary was not changed: `MAX_PAYLOAD_CHARS` and `MAX_INSTRUCTION_CHARS` are untouched, no per-stage payload override was added, the evidence contract was not tightened, and no model-policy token budget was changed. Stage 1–5 runtime behavior is unchanged, and the existing live `brand-compliance-critic` gate — with its prompt, rubric skill and approved-facts reference — is unchanged and still the only critic in the production path.

Documents reconciled after merge: `README.md`, `docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY_AND_CONTINUITY.md`, `docs/STATUS.md`, and `docs/TESTING.md`. **The payload-contract reconciliation stated above is now `MERGED` through PR #54 — not established as deployed, not enabled. See the section below for its full record.**

### Payload-contract reconciliation — prerequisite to production wiring · `MERGED` (PR #54)

**State:** **`MERGED`** — **not `ENABLED`, not established as `DEPLOYED`, not `PRODUCTION-VALIDATED`.** Not a new phase number. No stage's `executionEnabled` changed; all six remain `false`, and no production path reaches any of them. **Merge changes repository state only; it does not authorize production wiring, enablement, deployment, or the application of migration 007.** **Production evidence: none.**

**PR / merge / ancestry.** PR #54, *"feat: reconcile the Content Intelligence payload contract"*. Base `a000557e4910d84e001d3be9078630542d21bb42`; reviewed head `0362e354bc942416c640e93d403c537421a184e3`; merge commit `0c13ab1af9c7ca796a1d48ed37207715a47166e4`, merged 2026-09-04. The merge commit's **ordered parents are exactly the recorded base then the exact reviewed head** — first parent `a000557e…`, second parent `0362e354…` — verified by direct Git inspection. These are historical, immutable identifiers.

**The prerequisite is satisfied in repository state.** Every stage listed in the seven numbered requirements above is now delivered on `main`. That satisfies the gate this reconciliation was defined to be; it establishes nothing about production. The next product cursor is a **separately reviewed production-wiring design** — named here and, *as of PR #54*, neither designed nor begun. (This is the durable record of PR #54; the design was written afterwards, in PR #56, and did not exist at this merge. It has since been accepted and merged — see its own record below.) Performance ingestion, governed learning, and the proposed future Google Business Profile expansion remain later work and are not begun by this reconciliation.

**The production evidence-data audit, and who ran it.** Before any database bound was chosen, an **operator ran** an aggregate-only, read-only audit against the production database through Render's read-only query capability (`gcd-social-db` / `gcd_social`, PostgreSQL 18, 2026-09-02, read-only transactions). It was **run independently by the operator and not from an agent session**; no database credentials were requested or received, and no raw claim text, subject text, PII, or credential value was retrieved. Results: `_migrations`, `content_evidence` and `content_evidence_relations` all exist; `content_evidence` **0 rows**; `content_evidence_relations` **0 rows**; blank-claim rows 0; blank-subject rows 0; rows carrying `detail` JSON 0; relations carrying notes 0; the aggregate length query returned no populated values because both tables are empty.

**What that audit does and does not justify.** It establishes that **no stored row can violate any new bound**, which is why migration 007 may add immediately validated constraints rather than `NOT VALID` ones. It is **not** the justification for any particular number: every bound below is derived from the product contracts and from mechanically proven worst-case payload requirements, not from guessed production distributions.

**One authority for every bound.** `src/harness/agents/payloadContract.ts` is a new module that imports nothing and reaches nothing. It owns `EVIDENCE_LIMITS`, each stage's field and cardinality limits, each stage's serialized output ceiling, `HANDOFF_GUARDS`, `STAGE_ASSEMBLED_CEILINGS`, `MAX_PAYLOAD_CHARS`, `MAX_INSTRUCTION_CHARS`, and `POLICY_OUTPUT_TOKEN_FLOORS`. Each of the six executors re-exports the block it owns under its established name, so existing imports are unchanged and no stage carries a number of its own.

**How the ceilings are derived.** Each stage's ceiling is the serialized size of a *shape witness* — `JSON.stringify(witness, null, 2).length` of a maximum-cardinality instance of that stage's validated shape with every string empty — plus the stage's total string-content allowance multiplied by `MAX_JSON_ESCAPE_EXPANSION`. That factor is **2**, and it is provable rather than assumed: `JSON.stringify` expands a code unit sixfold only for control characters and unpaired surrogates, and every bounded string field in every stage now refuses both outright through `isSerializableText`. Bounding the character set is what turns an unusable 6× allowance into a provable 2×.

**Derived values.** Output ceilings, serialized (transport / ordinary-character): Stage 1 32,422 / 16,822; Stage 2 39,459 / 21,859; Stage 3 40,621 / 22,121; Stage 4 68,331 / 38,231; Stage 5 78,884 / 43,724; Stage 6 72,206 / 42,306. Framed evidence blocks: `EVIDENCE` 337,376; `PERMITTED_CLAIMS` and `SCRIPT_CLAIMS` 32,882 each; `PLATFORM_CLAIMS` 29,744. Assembled per stage: `automotive-truth` 369,964; `strategy-concept` 341,520; `final-critic` 251,101; `packaging-adaptation` 142,289; `hook-story-script` 105,030; `production-direction` 73,675. `MAX_PAYLOAD_CHARS` is the largest of those rounded up to the next 10,000: **370,000**, replacing the hand-chosen 120,000.

**Every guard equals its producer's ceiling.** Nine adjacent producer/consumer pairs (Stage 1 → 2 and 3, Stage 2 → 3, Stage 3 → 4, 5 and 6, Stage 4 → 5 and 6, Stage 5 → 6). Regressions assert **equality**, not sufficiency: a guard above its producer's ceiling would hide a later contract change instead of failing on it, and a guard below it would refuse a structurally valid handoff.

**Evidence bounds, cardinalities, and the migration pair.** `EVIDENCE_LIMITS` retains the documented text numbers and applies them as both characters/code units and UTF-8 bytes. Every record is revalidated at the real pack builder, durable-row reconstruction, pack projection, and shared pre-model boundaries, so a hand-built pack or malformed database row cannot bypass the owning record contract. `maxProjectedRecords` is an executed 64-record builder contract, not only a derivation input. Exhaustive conflicts have an independent 64-entry consumer contract: 64 valid same-subject/same-attribute facts still produce all 2,016 pairs, after which the real renderer and shared pre-model boundary refuse the intact pack. No conflict is discarded. `detail` is one compatible 4,000-byte PostgreSQL-canonical `jsonb::text` contract; TypeScript conservatively accounts for JSONB formatting and numeric expansion, including the 327-byte canonical representation of the signed finite value `-5e-324`. Relation notes use the 500 bound at TypeScript relation consumption/read boundaries. Migration 007 rejects NULL tag elements and uses the uniquely versioned `gcd_content_evidence_tags_within_v007` helper with plain `CREATE`, so an exact-name collision fails without overwriting an unrelated function. Disposable PostgreSQL 16 and 18 each pass apply, enforcement, documented rollback, compiled reapply, and collision-refusal coverage. **Migration 007 has since been applied to production — independently verified via M1 (2026-09-18), see [Status](STATUS.md); whether its rollback has been applied remains `UNKNOWN` in either direction.** Repository state alone was not production evidence at this merge; the only dated observation then was the 2026-08-28 read-only reading of `_migrations` at `001–006`. Applying the rollback remains separately authorized.

**Output contracts reconciled with token budgets.** The ordinary-prose estimate is gone. Every bounded output string must fit both its code-unit allowance and the same numeric UTF-8 byte allowance. The escaping-aware transport ceiling is therefore also a serialized UTF-8 byte ceiling, and a lossless worst case of one token per byte covers every contract-valid output, including adversarial non-ordinary text. The derived policy budgets are `reasoning-heavy` 40,000, `reasoning-standard` 79,000, and `critic` 73,000, replacing 4,000 / 3,000 / 2,000. Anthropic Opus 5 adaptive thinking shares the request's `max_tokens`; the centralized typed stage policy therefore sends `thinking: { type: "disabled" }` explicitly so the full derived ceiling is available to visible JSON. Model selection, budgets, thinking, and the documented 128,000-token caps stay centralized in `modelPolicy.ts`; legacy `runAgent` callers and `runVision` retain their prior behavior. No tokenizer or provider is contacted and no stage names a model.

**One deliberate narrowing, recorded as one.** Stage 5's pipeline caption cap is 2,200 characters — Instagram's own provider limit, roughly 350 words — rather than Facebook's 63,206. A single caption at the provider limit alone exceeds every other stage's whole assembled payload, and no output budget any model offers could produce three of them. The effective cap for a package is the **smaller** of the provider limit and the pipeline limit, enforced in the validator rather than described in a comment; Google Business Profile keeps its tighter 1,500. The per-platform provider policies in `packageMap.ts` are unchanged. A hashtag-count cap of 15 was added on the same terms. **This is a reduction of a product maximum**: a Stage 5 output valid under the old contract could carry a longer Facebook caption than this one accepts. Stage 5 has never executed, so no stored output is invalidated.

**Stage 6 inputs narrowed, authority contract unchanged.** `PLATFORM_CLAIMS` now carries each requested platform's bound fact **ids** only, instead of repeating each record's full claim text once per platform. The claim text still reaches the model once, through `SCRIPT_CLAIMS`. Nothing about the final-critic authority contract moved: platform membership and order, the exact `(findingIndex, platform, factId)` duplicate-triple guard, fact binding to stage 5's own per-platform bindings, owner consistency, the five literal-`false` brands, and the zero-used-claims refusal all still hold, and **no authority was granted through prose**.

**Semantic pack integrity at every pre-model boundary.** `evidencePackProjectionViolations` validated every record's *fields* and never asked whether a record belonged in the section holding it. Three states reached a stage runner and were accepted: a valid `creative_hypothesis` hand-placed in `allowedFacts` beside a valid business fact, cited through `supportingFactIds` and treated as established fact; an active verified fact whose `reviewBy` predated the pack's own `builtAt`, left in `allowedFacts`; and a hand-built conflict with an invalid `basis`, fabricated ids and a 50,000-character subject, which rendered below `EVIDENCE_PACK_BLOCK_CHARS` because that ceiling *assumed* a bounded conflict subject and nothing enforced one. `evidencePackInvariants` could see the first two and was never called by a stage boundary.

`assertUsableEvidencePack` is now the one authoritative runtime validator, called by the shared executor boundary, the pack renderer, the unusable-id set, and the preview. It checks bounds and meaning together: every record's fields; each section's permitted evidence kinds; lifecycle in both directions (nothing inactive in a usable section, nothing active parked in `inactiveEvidence`); one section per record, so a record cannot appear twice incompatibly; `allowedFacts` restricted to active, fresh verified fact classes; conflicted, stale, inactive and unsupported material barred from remaining usable; every conflict field — `aId`, `bId` against the id bound and the serializable-text rule, `subject` against the subject bound, optional `note` against the relation-note bound, `basis` against its closed enum, distinct and canonically ordered ids, referenced-record existence, and pair uniqueness; the exact `counts` key set with integer, non-negative values equal to the real section lengths; the pack's own `goal`; and `builtAt` itself, which must be an ISO-8601 instant that round-trips. It fails closed as a typed error before any model call.

Two smaller corrections travel with it. The stage citation accessors — `citedFactRecords`, `allowedClaimRecords`, and the id-binding in Stages 1 and 2 — now bind on each record's **own kind** as well as the section it was found in, so a consumer that forgets to call the validator still cannot promote a kind. And `EvidencePackSemanticError` extends `EvidencePackBoundsError` deliberately: the semantic contract is a strict superset of the projection bounds, so no boundary can be made weaker by narrowing its catch.

**Where freshness is evaluated, decided and documented.** At the pack's own **`builtAt`**, never at the moment a validator happens to run. A pack is a self-describing artifact; anchoring there makes the check deterministic, so the same pack is always valid or always invalid and no regression passes or fails by the wall clock. The cost is stated rather than hidden: a pack built before a fact's `reviewBy` and consumed after it would still present that fact as citable. Three things bound that gap — `builtAt` is itself validated as a real instant, every caller in this repository builds the pack inside the operation that consumes it (nothing persists or replays a pack), and a caller holding a pack across time closes it explicitly by passing `now`, which adds an invocation-time freshness check on top. The preview does exactly that.

**One request means one wire request, and the timeout can carry the response.** `runAgentWithMessageCreator` passed only `{ timeout: 90_000 }`, and the Anthropic SDK defaults `maxRetries` to 2 — retrying 408/409/429/5xx, connection errors, and timeouts. One wrapper invocation was therefore up to **three** provider requests and up to 270 seconds of wall clock, so neither the "exactly one model request" guarantee nor the `modelRequests: 1` metadata described the network. Separately, 90 seconds could not carry any stage's declared output: at the derived per-policy budgets a contract-valid maximum response cannot be produced in that time by any model, so the timeout — not the output contract — decided what the pipeline could return.

Content Intelligence stage calls now go through `runStageAgent`, a separate boundary from the legacy `runAgent`/`runVision` paths, which are deliberately unchanged. It sets `maxRetries: 0` explicitly at the real SDK request; it **streams** (`messages.stream(...).finalMessage()`), because the Anthropic SDKs require streaming at these `max_tokens` values and a non-streaming connection cannot hold open long enough to receive one — a streaming request is still exactly one request, and with retries disabled it never opens a second; and its **total stream deadline** is derived from the same budget through `stageStreamDeadlineMs`, at an explicitly assumed floor of 20 output tokens per second plus a minute of connection and queueing allowance, rounded up to a whole minute: 35, 67 and 62 minutes for `reasoning-heavy`, `reasoning-standard` and `critic`. That deadline is enforced by this boundary rather than by the SDK, and the SDK's own `timeout` option is a separate, much smaller request-setup bound — see the streaming-deadline correction below. The complete SDK request options — retry policy included — are now a typed, exhaustive interface, because the retry policy being absent from that type is precisely how the default survived unnoticed under a one-request guarantee. **Those timeout magnitudes are a direct consequence of `minimumOutputTokens` being a lossless one-token-per-byte bound**; an ordinary contract-valid response completes in a small fraction of them, and a timeout that tripped before the declared maximum could be produced would reintroduce the defect being fixed.

**The conflict representation, corrected together with the validator.** The semantic validator's first form rejected every legitimate conflict pack the builder produces, and the refusal-only coverage could not see it. Two routes were broken in opposite directions. An **inferred** fact conflict removed both facts from `allowedFacts` and placed them in no section at all, so the pack carried a conflict naming records it did not hold and the endpoint-existence check answered "not a record in this pack" for correct output. A **declared** conflict over non-fact evidence left both records in their ordinary sections, so the same validator rejected them for being "also usable" — while the builder's own `unusableEvidenceIds` had always treated them as non-citable, making the pack's shape disagree with its semantics.

`EvidencePack` now carries a `conflictedEvidence` section: the authoritative records behind every live conflict endpoint. The builder routes any record named in a live conflict there, whatever its kind, and that takes precedence over every other routing rule. It is a record section — every entry field-validated, counted, and identity-authoritative — and it is deliberately **not** a usable section, so nothing in it may be cited. The validator requires each endpoint to resolve to a record held in `conflictedEvidence` specifically: any usable section would leave a conflicted record citable, and any other unusable section would mean the pack disagreed with itself about why the record is excluded.

Three further rules travel with the representation. A conflict's `aClaim`, `bClaim` and `subject` must be exact snapshots of the records it names — without that, a hand-built pack could show a model claim text no record in the pack ever made, which is the same fabrication the typed citation channel exists to prevent, arriving through the exclusion list instead of through a citation. Every conflict string is bounded in **both** code units and UTF-8 bytes, the same single allowance every record field applies, because the byte bound is the one the payload and token derivations rest on. And the set of ids `conflictedEvidence` holds must be exactly the set the conflict pairs name — an equivalence that is also why the section needs no separate entry in the model projection: the pairs already name every id it holds, so the exclusion is still shown rather than dropped, and the `EVIDENCE` block witness still covers the real projected shape. Canonical pair ordering, pair uniqueness, the closed `basis` enum, record cardinality and independent conflict cardinality are all unchanged, and exhaustive detection still emits every pair — 64 mutually conflicting facts still produce all 2,016 and are still refused intact.

One behavioural consequence, recorded rather than left to be noticed: a conflicted observation, hypothesis, or research record no longer appears in its ordinary section, so its claim text no longer reaches a model. It was already non-citable; now it is also no longer displayed as though it were usable. Its id is still named, through the conflict pair.

**A real end-to-end streaming deadline.** Disabling retries made "one request" true of the network, but the timeout did not bound what it claimed to. In the pinned Anthropic SDK the `timeout` option arms a timer around the underlying `fetch` and clears it in a `finally` the moment that call resolves — which for a streaming request is when response *headers* arrive. Everything after that is `MessageStream` consuming events with no timer of its own, so the derived 35/67/62-minute values bounded request setup and nothing else, and a stalled stream could have stayed open indefinitely. Streaming itself is correct and stays: the Anthropic SDKs require it at these `max_tokens` values.

The two bounds are now separate values with separate names, and the second is enforced here rather than assumed of the SDK. `STAGE_REQUEST_SETUP_TIMEOUT_MS` (one minute) is the SDK's `timeout` option and covers getting the connection. `stageStreamDeadlineMs` is the total deadline for the whole stream, derived from the stage's own output budget; `runStageAgent` opens the stream once, arms its own timer for that duration, aborts the stream if it expires, awaits `finalMessage()`, and clears the timer in a `finally` on both the success and the failure path. A deadline abort is raised as a named `StageStreamDeadlineError` and reaches a caller through `invokeStage`'s existing fail-closed `StageExecutionError`, so it is legible instead of looking like an unexplained cancellation; a failure for any other reason keeps its own reason and is never relabelled a timeout. Exactly one stream is opened and no retry is taken. The stream and timer are behind an injectable seam, so the offline suite proves a completing stream returns and clears its timer, a never-finishing stream is aborted at the deadline with the timer cleared, and legacy `runAgent`/`runVision` are untouched — without waiting the real 35–67 minutes.

**The throughput floor, described honestly.** Twenty output tokens per second is an **explicit operational assumption and safety policy**, not a measurement and not a guarantee: this repository holds no measurement of a real model rate, because no test here reaches one and no production caller exists, so there is nothing in repository evidence to measure (whether any executor was ever invoked against a real model outside this repository is **UNKNOWN / NOT ESTABLISHED**), and the earlier claim that observed model rates are several times it has been removed rather than substantiated. The derivation comment now also records the budgets the policies actually carry — 40,000 / 79,000 / 73,000 — in place of stale 8,000 / 15,000 / 15,000 figures that survived an earlier round of budget changes; a regression compares that comment against `POLICY_MAX_TOKENS` so it cannot go stale again silently.

**Regressions.** `CC1`–`CC81` retain the original derivation, adjacency, dormancy, and no-provider proofs and add the exact production Anthropic request with thinking disabled, the exact 4,000/4,001 JSONB edges, the signed `-5e-324` counterexample, TypeScript relation-note parity, the real 64-record/2,016-conflict builder and renderer path, record validation at builder and pre-model boundaries, durable-row reconstruction refusal, executed record cardinality, adversarial multibyte output, collision-safe helper creation, and NULL-tag rejection. `npm run test:payload-mutation`, **as delivered by that merge**, applied thirty-three focused mutations across nine files, requiring named failures rather than crashes, restoring every byte by SHA-256, and finishing green. It has since been extended — see [Testing](TESTING.md) for the current count. The thinking request, signed JSONB numeric measure, pack record validation, record/conflict cardinalities, canonical-detail measure, relation bound, UTF-8 output bound, NULL-tag rule, and no-overwrite helper rule each have independent mutation evidence.

**Testing.** At the corrected head, `test:content-intelligence` reports **969** passing checks and the routine eight-suite offline sequence reports **1,367 assertions**. The combined output contains **1,254** `PASS`-prefixed lines from posting (52), image (18), orchestrator (108), gate (56), API (51), and content-intelligence (969). Render-identity reports one invariant-suite pass and ownership/recovery reports 112 checks in summary form, bringing the eight-suite total to **1,367**. Counting `PASS`-prefixed lines alone therefore omits those two suites and understates the total. The PostgreSQL suite reports **208 checks per server** (fresh 59, upgrade 80, durable 69) and passed locally on PostgreSQL 16.15 and 18.6. Every model call uses an injected fake runner. The complete validation contract, exact-head GitHub matrix, and final empirical statistics are recorded in PR #54; no provider, production database, or Render service is involved.

**Limitations, stated rather than implied.** One token per serialized UTF-8 byte is a deliberately loose worst-case ceiling, not a measured tokenizer distribution. The `EVIDENCE` ceiling deliberately over-approximates 64 maximum records plus 64 maximum conflict entries; packs with more conflicts fail closed intact. Stage 5 still over-approximates caption and hashtag content separately although the provider-visible rule makes them share one allowance. The JSONB detail upper bound may reject a TypeScript value PostgreSQL would fit, but never accepts one PostgreSQL rejects. Database coverage here is disposable only, not production evidence in itself: migration 007 has since been applied to production, independently verified via M1 (2026-09-18) — see [Status](STATUS.md). No bound has been validated against a real model, real workload, or populated production table.

**The count corrections that followed the last review round.** A review found the mutation harness described as spanning **ten** files in four active documents — `docs/ROADMAP.md`, `docs/TESTING.md`, `docs/STATUS.md` and `docs/AI_HANDOFF.md` — when it spans **nine** distinct physical paths. The figure is enumerated from the `MUTATIONS` array rather than recalled: 33 entries naming nine file constants, each resolving to one of `payloadContract.ts`, `modelPolicy.ts`, `finalCritic.ts`, `packagingAdaptation.ts`, `stageExecution.ts`, `evidence/pack.ts`, `evidence/contract.ts`, `sdk.ts`, and `007_evidence_bounds.sql`. All four were corrected, and a sweep for equivalent stale counts also found the harness's own header calling them *"the two files that must agree with it"* — true when the script covered three files, and eight since the semantic and request-policy mutations were added; it was corrected in the same change. No historical count describing an earlier harness version existed, so none was preserved or rewritten. That correction changed no implementation, test, migration, limit, or mutation definition: five single-line edits, four in Markdown and one in a comment.

**Material rejected alternatives.** *Removing the endpoint-existence checks, or permitting fabricated conflict ids*, was rejected: it would have made the validator accept the builder's output by weakening the property the validator exists to enforce, rather than by correcting the representation the builder produces. *Leaving conflicted records in their ordinary sections and relying on the derived `unusableEvidenceIds` set alone* was rejected because it leaves the pack's shape disagreeing with its own semantics — a record displayed as usable and excluded only by a separate list. *Projecting `conflictedEvidence` as its own block in the model projection* was rejected as duplication: an asserted invariant makes the ids it holds exactly the ids the conflict pairs already name, so the exclusion is shown without a second list and without invalidating the `EVIDENCE` witness. *Trusting the SDK's `timeout` option to bound a streaming response* was rejected on evidence read out of the pinned SDK source, not on preference. *Truncating exhaustive conflict detection to fit a ceiling* was rejected outright: an over-bound pack fails closed intact, and no disagreement is silently dropped. *Skipping, disabling, or relaxing a regression to make a mutation pass* was never available; two mutations that stopped compiling were rewritten into compiling forms instead, because a mutation that fails to build proves nothing.

**Security and privacy implications.** Every control this reconciliation adds fails **closed** and before any model boundary. Record and conflict cardinalities are independently enforced; evidence records are revalidated at pack construction, durable-row reconstruction, pack projection, and the shared pre-model boundary, so neither a hand-built pack nor a malformed direct-database row can bypass the owning contract. A conflict's `aClaim`, `bClaim` and `subject` must be exact snapshots of records the pack holds, which closes a path by which text no record ever made could have reached a model through the exclusion list rather than through a citation. Output text is byte-bounded, so the worst-case token proof covers adversarial non-ordinary text, and the centralized policy disables adaptive thinking because it shares `max_tokens`. Nothing became reachable: no `executionEnabled` changed, and no route, worker wiring, scheduler, retry, repair call, model tool, approval authority, publishing authority, or provider contact was added. A nonempty `ANTHROPIC_API_KEY` still causes no provider call — an injected runner or injected stream remains the only path to a model, asserted by regression. No credential, prompt, evidence text, model prose, or unpublished content is logged by any boundary this change touches, and no database credential was requested or received at any point in the work.

**Unresolved follow-ups.** Migration 007's application to production — its live application state is now established **`APPLIED`**, independently verified via M1 (2026-09-18, see [Status](STATUS.md)); at this merge that application still required the separate authorization, audit, rollout, and verification recorded below. The separately reviewed production-wiring design, which is the next cursor and which, *as of PR #54*, was not begun. (It was written afterwards, in PR #56, and has since been accepted and merged as design while remaining unimplemented — see its own record below. It did not exist at this merge, and neither its writing nor its acceptance authorizes anything.) Everything already open elsewhere in this roadmap is unchanged by this merge: the provider operation ledger and reconciliation, PostgreSQL network restriction, token lifecycle, control/reviewer identity, retention and backup/restore, the external readiness register, and the deployment-authority cutover proof.

**Exact-head CI and independent reinspection.** The final reviewed head `0362e354bc942416c640e93d403c537421a184e3` passed all five GitHub CI jobs — Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and Workflow and YAML static validation — in run `33776745879`, whose recorded `head_sha` is that exact head. The two preceding reviewed heads were each independently reinspected and each returned blocking findings that were corrected rather than argued: `54e409e…` was found to carry a semantic validator that rejected the conflict packs the builder actually produces and a derived deadline that did not bound the stream it was named for; `3cfff64…` was found to overstate the harness file count. Both rounds are recorded above. That is repository validation for a dormant change — **not** deployment or production evidence.

**Explicit non-actions.** Nothing was enabled, deployed, approved, scheduled, or published. No production SQL was applied, no migration was run, no `evidence:sync` was run, no Render or GitHub variable or settings change was made, no brief was created, no automation was enabled, no content was approved, and no provider or model call was made — every test used an injected runner. No production route, worker wiring, scheduler, retry, repair call, model tool, approval authority, or publishing authority was added. PR #39 was left untouched.

**Rollback / recovery status.** Rollback is to revert merge commit `0c13ab1af9c7ca796a1d48ed37207715a47166e4`, which removes the reconciliation in one step. No database, Render, provider, approval, publication, or production cleanup is required, because none was introduced: the merge applied no migration, and added no route, environment variable, credential, dependency, lockfile change, workflow change or `render.yaml` change, and changed no `executionEnabled` field. Migration 007 is **in source**, and **it has since been applied in production**, independently verified via M1 (2026-09-18) — see [Status](STATUS.md). Reverting this merge would remove the file while leaving the schema changed, which is a database question and not a revert. **Confirm the then-current applied state, read-only, before reverting.** If 007 is ever applied and must be reversed, `state/rollback/007_evidence_bounds_rollback.sql` is the documented operation, applied by hand under its own authorization — note that it relaxes the database only: the TypeScript contract still refuses an oversized record, so the system continues to fail closed.

**Migration 007's applied state in production is now established `APPLIED`, independently verified via M1 (2026-09-18, see [Status](STATUS.md)) — merging this reconciliation itself granted no authority to apply it and did not perform the apply.** Reaching that state from `state/migrations/007_evidence_bounds.sql` needed, separately and in order: its own explicit authorization; a fresh read-only production audit establishing that the immediately validated constraints could pass against the data actually stored (the 2026-09-02 audit is a **dated** fact, not a standing one); the separately authorized migration-bearing rollout procedure rather than the ordinary controller path, with exactly one migration runner and no schema-dependent consumer racing it; and post-application verification. None of that was performed or authorized by this merge.

**Documents updated at completion.** In the implementing pull request — `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/STATUS.md`, `docs/TESTING.md`, and `docs/AI_HANDOFF.md`. In the post-merge reconciliation that added this durable record — all of the above plus `docs/DATA_MODEL.md` and `docs/SECURITY_AND_CONTINUITY.md`.

**Next, as of this merge: a separately reviewed production-wiring design.** It follows this reconciliation and does not precede it; neither is a new phase number, and no stage could be enabled before that design was separately reviewed and accepted. **That design has since been accepted and `MERGED` through PR #56**, as [`docs/PRODUCTION_WIRING_DESIGN.md`](PRODUCTION_WIRING_DESIGN.md) — recorded in its own section below. It remains **`UNIMPLEMENTED`** and is **a design only**: it implements no wiring, enables nothing, applies no migration, and **authorizes neither implementation nor operations**. No production wiring, deployment, enablement, migration application, or production validation has occurred. Its load-bearing finding is that `executionEnabled` is currently a declarative registry field that no execution path consults, so today's dormancy rests on there being no caller and no default runner rather than on the flag. Performance ingestion, governed learning, and the proposed future Google Business Profile expansion all remain later work, in that order, and none of them is begun here. Deployment-authority work remains an independent track and must not be combined with any of them.

## Production-wiring design — `MERGED` as accepted design (PR #56), `UNIMPLEMENTED`

**State:** **`MERGED`** as **accepted repository design** — and **`UNIMPLEMENTED`**. Not a new phase
number. **Accepted means exactly one thing: [`docs/PRODUCTION_WIRING_DESIGN.md`](PRODUCTION_WIRING_DESIGN.md)
is present on `main` as this repository's accepted production-wiring design.** It does **not** mean
production wiring is implemented, and it authorizes **no** implementation PR and **no** operator
milestone. At the time of this merge, none of the eight implementation PRs (P1–P8) existed and none
of the seven operator milestones (M1–M7) had been performed. **M1 has since been performed and
independently verified — see the active product cursor above.** None of P1–P8, and none of
M2–M7, has been performed. The merge itself establishes **no**
deployment, production validation, database readiness, migration application, executor enablement,
model execution, approval, or publication. No stage's `executionEnabled` changed; all six remain
`false`, and no production path reaches any of them. **Production evidence: none.**

**PR / merge / ancestry.** PR #56, *"docs: add the production-wiring design as a reviewable
document"*. Base `e6f9b0275fc25f0c508708f5e421a474daeebbae`; reviewed head
`42f83a122910981f6af3bc9b9024d27ac8b839ff`; merge commit
`53e2c2bb6115e457670c1f99956d11a1a54530cd`, merged 2026-09-08. The merge commit's **ordered parents
are exactly the recorded base then the exact reviewed head** — first parent `e6f9b027…`, second
parent `42f83a12…` — verified by direct Git inspection. These are historical, immutable identifiers.

**Documentation-only scope, with empirical statistics.** `6 files changed, 1724 insertions(+), 19
deletions(-)` across 10 commits: `docs/PRODUCTION_WIRING_DESIGN.md` new at **1,702 lines**, plus
one-line and few-line status reconciliations in `README.md`, `docs/AI_HANDOFF.md`,
`docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `docs/STATUS.md`. **Every changed path ends `.md`.** No
source, test, migration, workflow, dependency, lockfile, configuration, `render.yaml`, agent, skill,
or prompt file changed.

**Accepted design boundaries.** The design's own boundary statements are what was accepted, and they
are narrow: it implements nothing, enables nothing, deploys nothing, applies no migration, contacts no
provider, and publishes nothing. It grants no authorization. **Each implementation PR and each
operator milestone still requires its own review, its own explicit authorization, and its own
evidence**, and no single approval covers more than the one unit it names. Every live Render and
database fact it discusses remains **`UNKNOWN` unless separately verified** — a merged document is
repository evidence, never production evidence.

**The load-bearing finding.** `executionEnabled` is a *declarative registry field that no execution
path consults*: `invokeStage` never reads it, nor does any of the six executor modules; its only
consumer is `assertPreviewIsInert`, which keeps the preview inert. **Today's dormancy therefore rests
on two structural facts — no production caller, and no default runner — not on the flag.** An
implementer who treats the flag as the safety mechanism would build on something that is not load-bearing.

**Sequence, and the counts that define it.** **Eight implementation PRs (P1–P8)** and **seven
operator milestones (M1–M7)** — different kinds of thing, numbered separately: a PR is reviewed and
merged, a milestone is performed by an authorized operator and produces an evidence record, not a
diff. **Every source change is a numbered PR, including the one that activates the stages (P8).** M4
is one milestone comprising **five separately authorized single-control acts (M4.1–M4.5)**; those
acts are not additional milestones. **Five enforcement checkpoints** are owned by named PRs:
**C1 → P3**, **C2 → P2**, **C3 → P2**, **C4 → P5**, **C5 → P6**.

**Six controls that must never be collapsed.** The design separates, as independent controls:
**registry activation** (`executionEnabled`, moved by P8 and deployed by M3); the **runtime authority
gate** (durable `OFF`/`SHADOW`/`LIVE`, whose effective mode is the *lower* of the gate, the
deployment-time ceiling `CONTENT_INTELLIGENCE_MAX_AUTHORITY`, and any grant's `max_authority`);
**manual dispatch** (layer 4a — ceiling `CONTENT_INTELLIGENCE_MANUAL_DISPATCH_ENABLED`, plus a
bounded, expiring, transactionally consumed grant, so a ceiling without a grant starts nothing);
**scheduled/queue dispatch** (layer 4b — ceiling `CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED`,
owned by **worker and scheduler only**); **approval** (checkpoint C4, api); and **publication**
(checkpoint C5, worker). The two dispatch ceilings are deliberately separate variables. **No act
changes more than one control** — which is why M3 (registry activation) and M4.1 (authority ceiling)
are separate acts with separate deployments. **Scheduled dispatch implies neither approval nor
publication.**

**Migration 007 / 008 ordering.** **M1 applies 007 first**, while `main` still carries no migration
beyond it, and **P1 must not merge before M1** — that is M1's protecting invariant, not a
convenience. P1 then introduces migration **008** with the control plane and grant schema, and **M2**
is the migration-bearing release that applies 008. The design is explicit that 007's application is
neither authorized nor established by anything in it.

**API `preDeployCommand` is the only migration authority.** `render.yaml` gives
`preDeployCommand: npm run migrate` to `gcd-social-api` **and to no other service**, and the standing
rule in [`ROLLOUT_PHASE_0B0.md §5`](ROLLOUT_PHASE_0B0.md) forbids running `npm run migrate` by hand or
applying the SQL through `psql`. The consequence is load-bearing and easy to get wrong: **applying a
migration *is* an API deployment**, not a standalone database operation. The runner
(`src/state/migrate.ts`) is forward-only and **sweeps every pending file in lexical order** — there is
no per-file selector — so the authorized set must be established before the deployment, never assumed
from intent.

**Complete migration-state validation, not pending-only.** The preflight compares the **whole applied
state**, not just what is pending: the migration files at the artifact commit `F(A)`, the `_migrations` rows
`D`, and the computed pending set `P = F(A) − D`, against four expected sets (`E_files`,
`E_applied_pre`, `E_pending`, `E_applied_post`) under **seven conditions**. The reason is exact: a
pending-set difference **cannot see an unexpected already-applied migration**, because such a file
cancels out of `F(A) − D` and leaves the pending set looking correct. The operator record is in **two
timed parts** — Part 1, the pre-deployment record, completed and passing **before** the deployment is
triggered; Part 2, the post-deployment closure (`D_post`, the comparison outcome, and the
validation-versus-rollback decision), completed **after** it, without which the milestone is not
complete.

**A/L deployment ancestry.** For any api deployment in this rollout, with `A` the artifact commit and
`L` the live api commit **read immediately before**: allow `A == L`, or `L` an ancestor of `A`;
**reject** `A` a proper ancestor of `L` (a runtime rollback) and mutual non-ancestry (divergence);
**stop** if `L` cannot be obtained. Equality is tested **first**, because `git merge-base
--is-ancestor` is reflexive and would otherwise mask the same-commit case. `L` is read, never inferred
from repository ordering.

**Rollback-artifact compatibility is an entry gate, not an assumption.** M1's recovery path redeploys
the previously live image **while leaving 007 applied** — old code against a newer schema. Before M1
may be authorized, the rollback artifact `R` (normally the pre-M1 live api artifact, i.e. `L`, named
by full SHA) must be **proven** compatible by executed evidence against a disposable database migrated
through 007, on **PostgreSQL 16 and 18**: startup and readiness, every production-reachable read,
every production-reachable write path, values at and around each new constraint, ordinary existing
rows, and restart behaviour. **"Additive", "`NOT VALID`", and "the old image starts" are explicitly
not compatibility evidence.** If compatibility cannot be established, redeploying `R` is not an
authorized recovery action and M1 must not begin.

**Partial-release handling.** When `A ≠ L`, M1 deliberately advances the api ahead of the worker and
scheduler, creating exactly the service-identity mismatch the automated controller treats as
`PARTIAL_RELEASE_STATE` and refuses to release from. M2 therefore proceeds from a deliberately partial
state and is executed as an **explicitly authorized manual departure from the controller**, carrying
every obligation the controller would otherwise enforce, and it closes the interval by bringing all
three services to one commit with `/healthz` plus durable readiness evidence.

**Same-commit `preDeployCommand` behaviour remains `UNKNOWN`.** Whether an api deployment requested at
a commit equal to the live one re-invokes `preDeployCommand` is **not established in either
direction**, and the design says so rather than guessing. On the `A == L` path the controller confirms
all three services at target and then **deploys nothing**, so obtaining the migration run requires
requesting an api deployment anyway — a deliberate, explicitly authorized departure. If the equality
path may be used, that behaviour must be confirmed first.

**M7 service ownership.** M7 is three separate single-control acts with **different service targets**:
**M7-a** (`CONTENT_INTELLIGENCE_MAX_AUTHORITY` `SHADOW` → `LIVE`, **worker and api**) is a real api
deployment and takes the full §4.4.2 preflight and both record parts; **M7-b**
(`CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED`, **worker and scheduler only**) restarts no api and
takes no migration gate; **M7-c** is a control-plane row, not a deployment. After M7, manual dispatch
requires a **new** separately authorized bounded grant — M7 issues none.

**Material alternatives rejected.** *Treating `executionEnabled` as the dormancy guarantee* was
rejected on read evidence that no execution path consults it. *Validating only the pending set before
a migration-bearing deployment* was rejected because an unexpected already-applied migration cancels
out of the pending difference and is invisible to it. *Running `npm run migrate` standalone, or
applying the SQL through `psql`*, was rejected as prohibited by the standing rule and by there being
one migration authority. *Inferring the live commit `L` from repository ordering, or assuming `A == L`*
was rejected — `L` is read immediately before, or the milestone stops. *Testing ancestry before
equality* was rejected because `--is-ancestor` is reflexive and would mask the same-commit case.
*Accepting "additive", "`NOT VALID`", or "the old image starts" as rollback-compatibility evidence*
was rejected: none establishes that `R`'s **writes** are still accepted. *One combined dispatch
control* was rejected because it would make a scheduled run reachable by way of enabling a manual one.
*Combining registry activation with the authority ceiling in one act* was rejected under the
one-control-per-act rule. *A single approval covering the whole rollout* was rejected: authorization is
per named PR and per named milestone. *Recording the operator's post-deployment readings in the
pre-deployment step* was rejected as a sequence no operator can perform. *A new Render service* was
rejected in favour of existing infrastructure. *Beginning the GBP expansion alongside this work* was
rejected outright.

**Security and privacy implications.** The design adds nothing executable, so it changes no live
attack surface; its security content is in what it refuses to allow later. Every proposed gate fails
**closed**: an absent, unreadable, or unrecognized authority value is `OFF`; the effective mode is the
*lower* of ceiling, gate and grant; a manual grant is bounded, expiring, and consumed transactionally
in the same transaction that creates the run row, so two simultaneous submissions against
`runs_remaining: 1` yield exactly one accepted run; approval (C4) and publication (C5) are refused
until the gate reaches `LIVE` and remain independent controls even then. The proposed authority gate
sits **in front of — never instead of —** the existing Phase 0A approval gate, which is unchanged.
**Content integrity of applied migrations is not verifiable at all**: `_migrations` stores
`name text PRIMARY KEY` and `applied_at`, with **no checksum column**, so identifiers are verifiable
and contents are not — the design states this limitation rather than implying integrity it cannot
prove. No credential was requested or received at any point, no production database or Render state
was inspected, and the document contains no secret, token, credential, customer datum, or raw
analytics value.

**Automated validation and exact-head CI.** At the reviewed head `42f83a12…`: `npm ci` with 0
vulnerabilities, typecheck, build, the **eight offline suites ALL PASS (1,367 assertions)**, **33
payload-contract mutations ALL PASS** with byte-for-byte restoration across exactly 9 target files,
final rebuild, disposable **PostgreSQL 16 — 208 checks** (fresh 59, upgrade 80, durable 69), simulated
dry run, deployment-controller fixtures, Markdown links, environment coverage (35 variables),
credential/PII scan, `npm audit --omit=dev` with 0 production vulnerabilities, YAML parse, AgentShield
**grade A (93/100)**, and `git diff --check` clean. **Exact-head CI: run `34272982709` — all five jobs
`success`, each on attempt 1, every one reporting `head_sha` `42f83a12…`**: Node 22 offline quality
gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and Workflow and YAML
static validation. Every model call in every suite used an injected fake runner. **That is repository
validation for a documentation-only change — not deployment, not production validation.**

**Independent review before acceptance.** The document was corrected in place across **nine rounds of
independent inspection**, on the same branch, with no replacement PR and no rewritten history. The
corrections were substantive, and each is now part of the accepted design rather than an artifact of
review: the **complete migration-state contract** replaced a pending-set-only check once the
cancelling-out defect was identified; the **A/L ancestry predicate** was generalized from M1 to every
api deployment in the rollout and reordered to test equality first; the **rollback-artifact
compatibility gate** was added after "additive" was found to be doing work it cannot do; the
**migration-versus-deployment contradiction** was resolved once `preDeployCommand` was confirmed as
the sole migration authority; **M3/M4 were split into single-control acts** and **M7 into three acts
with distinct service targets**; the **partial-release interval** M1 creates was named and its
controller departure labelled; **same-commit `preDeployCommand`** was recorded as `UNKNOWN` rather
than assumed; and the **operator record was split into a pre-deployment Part 1 and a post-deployment
Part 2** after a reviewer showed the single-step version described a sequence no operator can perform.
Two of those rounds were opened by findings against the reviewer's own prior corrections, and both
were corrected rather than argued. The full round-by-round diff history is preserved in PR #56.

**Rollback / recovery status.** Rollback of this documentation change is to revert merge commit
`53e2c2bb6115e457670c1f99956d11a1a54530cd`, which removes the design document and the status
reconciliations in one step. **No database, Render, provider, approval, publication, or production
cleanup is required, because none was introduced** — the merge applied no migration and changed no
source, workflow, dependency, configuration, `render.yaml`, or `executionEnabled` value. Reverting it
removes an accepted design; it unwinds no operational state, because none was created.

**Production evidence: none.** No production database was inspected, queried, mutated, or
credentialed; no Render service was inspected; no provider or model was contacted; `evidence:sync` was
not run. The only production evidence anywhere near this work remains the operator's **dated**
2026-09-02 aggregate read-only audit recorded under PR #54, which is a dated observation and not a
statement about now.

**Unresolved questions carried forward by the accepted design, as of this merge.** Live Render service versions, health,
and control settings; **`L`, the commit each service currently runs**; whether a same-commit api
deployment re-invokes `preDeployCommand`; whether the rollback artifact `R` tolerates the post-007
schema; the contents of `_migrations` and of the production evidence tables; whether migration 007
had been applied — not established in either direction at that time (**since resolved: migration 007
is now production `APPLIED`, per M1 in the active product cursor above**); whether any executor has ever been invoked
against a real model historically; whether a shadow run should build its evidence pack from
`config/approved-facts.json` via the adapter or require `evidence:sync` to have populated
`content_evidence` first; per-run and per-day cost ceilings and the behaviour on breach; whether one
brief per day remains the right cadence once six stages run per brief; and retention for
`content_intelligence_stage_results`. **Content integrity of applied migrations is not verifiable at
all**, the migration table carrying no checksum.

**Follow-up — the next cursor, stated narrowly.** The next action is **not** "implement production
wiring" and is **not** the Google Business Profile expansion, which stays deferred. It is the accepted
design's own **first prerequisite: a read-only verification of live production identity and database
state** — the three service commits (which establishes `L`, and with it the candidate rollback
artifact `R`), `/healthz`, the control settings, and **the complete migration-state evidence §4.4.2
requires**: the full `_migrations` identifier set `D` **enumerated**, its row count recorded alongside
its distinct-identifier count, and the artifact's migration files `F(A)` at the commit each service
runs, so that `P = F(A) − D` and all **seven** §4.4.2 conditions can be evaluated rather than assumed.
**Collecting the `_migrations` rows alone is not sufficient**, and neither is the pending set: an
unexpected already-applied migration appears in both `F(A)` and `D` and cancels out of `P`, so the
complete applied set must be validated in its own right against an expected inventory. This
verification is **evidence only** — it is not the §4.1 aggregate audit, not the §4.2 decision record,
not the rollback-artifact compatibility proof, and not M1; each of those remains its own separate gate
requiring its own authorization. Performed by an authorized operator, read-only, and recorded as a
dated observation. Everything else the design gates
on depends on facts that verification produces. Only after it, and each under its own separate
authorization, come: the **migration-007 aggregate read-only audit and its committed decision record**
(§4.1–§4.2); **confirmation of same-commit `preDeployCommand` behaviour**, if the `A == L` path may be
used; and **rollback-artifact compatibility planning and executed evidence** for `R`. **This
reconciliation performs none of them, and M1 is not authorized.**

**Documents updated at completion.** In the implementing pull request (PR #56) — `README.md`,
`docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/STATUS.md`, and the new
`docs/PRODUCTION_WIRING_DESIGN.md`. In this post-merge reconciliation — all ten
documents it changes: `README.md`, `docs/AI_HANDOFF.md`, `docs/ARCHITECTURE.md`,
`docs/DATA_MODEL.md`, `docs/PRODUCTION_WIRING_DESIGN.md`, `docs/ROADMAP.md`,
`docs/SECURITY_AND_CONTINUITY.md`, `docs/STATUS.md`, `docs/TESTING.md`, and
`docs/credentials-setup.md`. That reconciliation also carries three non-documentation paths,
recorded in the next paragraph.

**The reconciliation is not documentation-only, and is classified as migration-touching.** Alongside
the ten documents it corrects three authoritative repository inputs that asserted what the
documentation no longer asserts: the **comments** in `state/migrations/007_evidence_bounds.sql` and
`state/rollback/007_evidence_bounds_rollback.sql`, which declared 007 *"has not been applied to
production"*, and the `CC5` regression in `src/harness/contentIntelligence.selftest.ts`, which
required those exact strings and would therefore have rejected a corrected comment. Both comments
now state that 007's live application state is **`UNKNOWN` in either direction**, keep the
2026-08-28 reading of `_migrations` at `001–006` as an explicitly dated observation, and require
read-only verification and separate authorization. `CC5` no longer pins a sentence, no longer keys
on qualifier keywords, and no longer splits prose on punctuation. It **tokenises** each file's
comment prose once — reassembling hard wraps first, so a line break neither manufactures a fragment
nor hides a declaration — and analyses **every** application predicate in place, making five
judgements independently for that one predicate from its own tokens: its subject, or the contextual
antecedent it modifies; its auxiliary/tense frame; its own proposition boundaries; the governing
conditional or epistemic construction, if any; and whether what remains is a categorical
current-state assertion. **No judgement is measured in characters, and no punctuation mark is a
boundary by itself.** Within the **specifically tested bounded grammar**, a predicate declaring
007's application state is refused **in either direction**: positive or negative, present, perfect or past, verbless elliptical (*"Not applied to
production."*), contracted (*"isn't applied"*), bare past (*ran*, *never ran*) or emphatic (*did
run*, *did not run*), in plain and contextual-*It* shapes, with or without the word *production*,
with the auxiliary at any distance from its participle and across a parenthetical or comma-delimited
aside, and finite application assertions remain categorical regardless of procedural wording
following the verb or a `re-` prefix. **That grammar is bounded, not complete English:** past
*remain*/*stay* declarations (*"remained unapplied"*, *"has stayed unapplied"*, and their
contextual-*It* shapes) are **not** rejected, and are recorded as the accepted deferred issue
**`CC5-SYNTAX-001`** in [`docs/KNOWN_ISSUES_AND_HARDENING.md`](KNOWN_ISSUES_AND_HARDENING.md).
**Qualification must
govern the proposition, which is a structural test rather than a vocabulary one.** A subordinator —
*whether*, *if*, *after*, *once*, *when*, *whenever*, *before*, *until*, *unless* or *should* —
counts only when it introduces the very clause the predicate heads: everything between it and the
predicate must be that clause's own subject, matched against a whitelist, so the rule fails closed.
**Every predicate is judged on its own**, so a subordinator cannot reach across a predicate it
already governs and a governed proposition never covers for a categorical sibling. Conversely a
governed proposition keeps its **own internal qualifiers** (*"Whether migration 007, after read-only
verification, is applied remains `UNKNOWN` in either direction."*), because a comma pair or a
parenthesis whose interior carries no finite verb is an interruption inside one proposition rather
than the end of one. **The guarantee is deliberately narrow**: it recognises the supported
authoritative-comment language of these two files and is not a claim of general natural-language
understanding.

Eight earlier forms did not meet that bar, and every one of them was found by independent review
rather than by us. The first accepted a qualifier that merely **co-occurred** in the clause. The
second accepted any subordinator that merely **preceded** the predicate, which let an unrelated
introductory clause launder the assertion behind it (*"Before we verify, migration 007 is
applied."*). The third stopped at the **earliest** predicate and allowed the whole clause once that
one was governed, which let an authorized proposition carry a categorical sibling (*"Whether
migration 007 is applied is UNKNOWN and migration 007 is applied."*); splitting on `and`/`but` would
not have fixed it, since those conjunctions occur inside governed propositions too. The fourth
exempted a **finite** occurrence claim whenever procedural manner or a `re-` prefix followed the
verb, so *"Migration 007 was applied by hand to production."* and *"Migration 007 was re-applied to
production."* passed; the exemption is now bound to the tense frame, and reaches only a genuinely
non-assertive one. The fifth hunted the auxiliary inside a fixed **twenty-eight-character window**
and treated every comma as a clause boundary, so *"Migration 007 has, according to the operator,
been applied to production."* escaped while *"Whether migration 007, after read-only verification,
is applied …"* was wrongly rejected; both are now decided structurally, by associating an auxiliary
with its verb inside one proposition and by recognising an interruption for what it is. The
epistemic statement (*"whether … is `UNKNOWN`"*), the dated observation, verification and
authorization instructions, adjectival uses (*applied set*) and procedural uses in a non-assertive
frame (*applied by hand*) remain allowed — each tested against the specific predicate rather than
the whole sentence. The sixth recognised a balanced aside only when its interior carried no verb of
its own, so a **subordinate** aside severed the outer frame it interrupts (*"Migration 007 has,
after the report was signed, been applied."* read as a bare participle rather than a perfect
assertion), and treated every coordinator as the end of a governor's reach, which wrongly rejected
the authorized coordinated forms (*"Whether or not migration 007 has been applied is `UNKNOWN` in
either direction."*, *"Whether migration 007 was applied or ran in production is `UNKNOWN` in either
direction."*). A balanced pair opened by a subordinator is now an interruption even when it carries
a finite verb — that verb belongs to the aside, and the aside's own subordinator governs nothing
outside it — while a coordinator is stepped over only inside one governed proposition. **The
seventh** was that correction's own limits, again found by independent review. Its opener list took
a **single** token, so natural asides opened by a phrase (*even though*, *now that*, *provided
that*) still severed the frame; commas were paired **greedily with the nearest** one, so two
consecutive asides or a nested one left overlapping pairs a leftward walk fell back inside; the
coordination gap admitted neither a **serial comma** (*was applied, ran, or was re-applied*) nor an
interruption span of its own; and an imperative *do not run* was classified as a categorical do-
support claim. Openers are now matched over one, two or three leading tokens; comma pairing prefers
the **outermost** qualifying opener and resolves shared endpoints to that outermost start, so nested
and consecutive asides are stepped over as one; the coordination gap admits serial commas and skips
validated spans, while still refusing a new subject, an adversative, a bare imperative *do* or any
other word; and bare *do*/*don't* with no subject of its own is read as an instruction, while *does*
and *did* stay declarative and emphatic. Above all, **finite-frame recovery now fails closed and
depends on no list at all**: `been applied` is not a proposition, so when the walk meets a comma it
does not recognise while holding only a non-finite frame, it crosses that aside and keeps looking
for the finite auxiliary rather than reading the participle as non-assertive. **The eighth** was a
pairing bug in that same correction: an opening parenthesis was matched to the FIRST later `)`, so
with nested parentheses the inner close was recorded as the outer one and the real outer close was
left unmatched — a leftward walk then read it as a proposition boundary and *"Migration 007 has
(according to the operator (per the audit)) been applied."* passed as a bare participle. Parentheses
are now paired **by depth**, with a stack, so nested asides yield nested spans and no close is left
dangling. **The ninth** was that same fix's own fail-open: recovery was also taught to **cross** an
unmatched `)`, so one stray close bought a bypass outright — *"Migration 007 has, according to the
operator) been applied to production."* left the whole suite exiting 0, because the walk skipped the
`)`, halted at the noun `operator` before reaching the outer `has`, and read `been applied` as a bare
participle; an authorized `UNKNOWN` sentence beside it changed nothing. An unmatched close is
**malformed prose**, never an aside, so a depth scan of the normalized comment prose now fails `CC5`
**structurally** on any `)` at depth zero, **before** any application predicate is classified, and the
recovery-through-unmatched-close behaviour is **removed**. Balanced parentheses, single and nested,
still pair by depth. The unmatched **opening** parenthesis remains explicitly **unclaimed**.

**Two hundred and fifty-two mutations** in `npm run test:payload-mutation` prove it load-bearing
in both directions: **two hundred and six prohibited** forms that must make `CC5` fail by name, and
**forty-six authorized** forms that must leave the suite green, so an over-broad guard fails in CI
rather than in review. That brings the harness to **two hundred and eighty-five mutations across ten
target files** — **two hundred and thirty-nine prohibited** in total — enumerated from its own
`MUTATIONS` array and run output rather than recalled. Of the prohibited forms, twenty-six are declaration and masking
classes, fourteen introductory-clause and `ran`/`did run` classes against each file, twelve multi-
proposition classes against each file, twenty-three token/proposition classes against each file
(`M118`–`M163`), fourteen balanced-aside and coordinated-sibling classes against each file
(`M174`–`M201`), sixteen natural-aside and instructional classes against each file (`M210`–`M241`),
and **three NESTED-PARENTHESIS classes against each file** (`M242`–`M247`): a positive and a
negative outer perfect frame split by nested parentheses, and a doubly nested contextual-*It* form.

**What each correction is actually load-bearing for was measured, not assumed.** Against `c189d2b`,
seventeen of the twenty-three token/proposition prohibited classes bypassed `CC5` and three of the
five authorized classes added with them were wrongly rejected. Against `83af628`, both finite-aside
forms bypassed on both SQL files and all four coordinated governed forms were wrongly rejected on
both. Against `3f173d5`, all twelve reported forms were misclassified on both files. Against
`4a4c4b2`, the nested-parenthesis forms were misclassified on both files in **both** directions —
two positive and negative claims passing as non-assertive, and a governed proposition carrying
nested parentheses wrongly refused.

**Twelve focused probes measured the current groups**, each altering the built suite in one way, each
re-running every class against the migration file, each followed by a byte-for-byte
restore. Removing **fail-closed finite-frame recovery** lets the two unlisted-opener classes through
(`M238`–`M241`). Removing **multi-token openers** wrongly rejects the modal-aside allowance
(`M256`–`M257`) while the prohibited classes stay caught by recovery. Removing **both** reopens the
bypass for six classes (`M210`–`M213`, `M224`–`M225`, `M236`–`M241`). Reverting **parenthesis
pairing** to first-later-`)` wrongly rejects both nested-parenthesis allowances (`M264`–`M267`); the
nested-parenthesis prohibited classes (`M242`–`M247`) stay caught, now by the **structural
unmatched-close failure**, which refuses the dangling close that pairing bug produces. The earlier
attribution — that reverting both pairing and recovery is what lets `M242`–`M247` escape — is
**superseded**, because recovery through an unmatched `)` no longer exists. Reverting the
coordination gap to a single coordinator with no serial comma wrongly rejects three serial-list
allowances (`M248`–`M249`, `M258`–`M261`); leaving validated spans in that gap wrongly rejects the
parenthetical-carrying allowance (`M250`–`M251`); removing the imperative/declarative `do`
distinction wrongly rejects both instructional allowances (`M254`–`M255`, `M262`–`M263`); and
letting a coordinated chain reach across an independently asserted sibling lets the new-subject and
hidden-*did run* classes through (`M226`–`M227`, `M232`–`M233`). Eight prohibited classes
(`M214`–`M223`, `M228`–`M231`, `M234`–`M235`) and one allowance (`M252`–`M253`) survive every probe,
caught or preserved by other parts of the analysis; they are retained as coverage and are **not**
claimed as proof of any single correction. Re-running the earliest-predicate-only probe against the
twelve multi-proposition classes reproduced the earlier measurement exactly: **eight classes
(sixteen mutations) go undetected**, while the other four stay caught.

**Eighteen mutations (`M268`–`M285`) cover the unmatched closing parenthesis**, nine classes against
each SQL file: the exact reported comma-opened form beside an authorized `UNKNOWN` sentence, a
contextual-*It* form, more than one unmatched close, an unmatched close inside a sentence carrying an
authorized `UNKNOWN` proposition, one before and one after the application predicate, two **no-comma**
forms, and a balanced **single**-parenthesis authorized counterpart.

**What that group is load-bearing for was measured, and the measurement corrected the claim first made
for it.** With the structural failure disabled and everything else intact, the comma-opened classes
(`M268`–`M275`) are **still rejected** — removing the unsafe `)`-crossing lets the pre-existing
fail-closed **comma** recovery jump to the comma before the stray close and recover the outer `has`, so
for those classes the structural check is **redundant** and is **not** claimed as their protection.
Deleting the comma isolates it: `priorComma` has nothing to jump to, the walk halts at the noun, and the
claim escapes — so the **no-comma classes `M282`–`M285` are this correction's load-bearing evidence**,
and they were added because the probe said so rather than because the shape looked plausible. With the
structural failure removed **and** the old `)`-crossing restored — the reviewed head `05b8c4b` —
`M268`–`M275` and `M282`–`M285` all escape, reproducing the reported bypass. `M276`–`M279` survive both
probes, caught by other parts of the analysis, and are retained as coverage only.

**A harness payload-escaping defect was found and corrected in the same round.** One hundred and
fifty-two payloads (`M106`–`M107`, `M118`–`M267`) wrote a **literal backslash and `n`** instead of a
newline, so they produced **one** physical comment line rather than two and **never exercised the
multi-line comment path**, including the hard-wrap reassembly in `sqlComments`. `M106`–`M107` are
*named* for a **newline between the governed proposition and the categorical one** and delivered none.
All one hundred and fifty-two now use real newlines; `M106`–`M107` take `\n-- ` rather than a bare
`\n`, because the escape sits mid-sentence and a bare newline would have written a line with no `--`
prefix — non-comment text injected into executable SQL and invisible to `sqlComments`. Two other
newline-claiming mutations already used real newlines and were left unchanged.

Separately, a manual adversarial matrix ran **ninety-two prohibited forms and thirty authorized
forms against each of the two SQL files** through the real suite: **one hundred and eighty-four
rejections and sixty allowances, zero misclassifications** across two hundred and forty-four
executions, with both scripts restored byte-for-byte after each (migration `fb5128b4ae207e75…`,
rollback `31e0ab0c1f92ccaf…`), `state/` clean and a green final baseline. Two earlier rounds
reported narrower matrices — one hundred and forty-six rejections with forty allowances, then one
hundred and seventy-eight with fifty-six; each figure was accurate for the matrix it described, and
each was superseded when independent review found variants that matrix did not contain. **That
figure is likewise superseded for this round**: it predates the unmatched-close forms, which it did
not contain. Those were verified separately — **ten classes against each of the two SQL files, twenty
executions, zero misclassifications**, each restoring byte-for-byte: six prohibited unmatched-close
forms rejected, a balanced single- and a balanced nested-parenthesis authorized form allowed, and two
balanced categorical forms rejected for their categorical content rather than for balance. Every
unmatched-close class is now held durably as `M268`–`M285` in the harness rather than by a manual
matrix alone.

**Migration-path classification, accepted and not bypassed.** Because that change touches
`state/migrations/**`, `scripts/render/deployment-controller.mjs` evaluates
`git diff --name-only <live>..<target> -- state/migrations/**`, finds a match, sets
`report.result = "blocked"` and stops with **`MIGRATION_ROLLOUT_REQUIRED`**. The guard uses
`--name-only` and **does not distinguish a comment-only edit** from a schema change. That
classification is **correct and deliberately left intact** — the guard was not suppressed, bypassed,
weakened, or excluded, and the controller, workflows and `render.yaml` are unmodified. **Any release
range containing this change therefore requires the separately authorized migration-bearing rollout.**
**No executable SQL changed:** stripping full-line `--` comments and blank lines leaves both scripts
byte-identical to the base — migration `6e39722…`, rollback `21a8ac8…`, 40 and 19 executable lines
respectively — and the disposable PostgreSQL 16/18 suites still apply, enforce, roll back and reapply
007 at 208 checks each. **None of this implies migration 007 was applied, authorized, or deployed by this change; its
live application state is now established `APPLIED`, independently verified via M1
(2026-09-18) — see [Status](STATUS.md).**

## Phase 0B — Content Intelligence runtime

**State:** foundation `MERGED` and `DEPLOYED`; all six executors — `strategy-concept`, `automotive-truth`, `hook-story-script`, `production-direction`, `packaging-adaptation`, and `final-critic` — **`MERGED`** and dormant, the sixth through PR #52; the payload-contract reconciliation **`MERGED`** through PR #54. **None is `ENABLED`, established as `DEPLOYED`, or `PRODUCTION-VALIDATED`**, and none has production evidence. **All six target stages now have a merged executor on `main`**, and every registry entry reports `executionEnabled: false`. Separately, on the deployment-authority track, **M1 (migration 007's rollout as an API-only deployment) is now complete and independently verified** — see the active product cursor above; this did not enable any stage and did not authorize M2.

**Last merged slice: the payload-contract reconciliation, `MERGED` through PR #54** (merge `0c13ab1af9c7ca796a1d48ed37207715a47166e4`), recorded in its own section above. Before it, Phase 0B.6 — the dormant `final-critic` stage executor — was `MERGED` through PR #52; see its dedicated section for the full record and durable identifiers. The reconciliation that gates production wiring is therefore **satisfied in repository state**: it is present on `main`, and it is not established as deployed, not enabled, and not production-validated. Deployment-authority work remains an independent track and must not be combined with any of this. **The separately reviewed production-wiring design is accepted and `MERGED` through PR #56** (merge `53e2c2bb6115e457670c1f99956d11a1a54530cd`), recorded in its own section above, and is **`UNIMPLEMENTED`** — authorizing neither implementation nor operations. **No implementation PR (P1–P8) exists. M1 was performed 2026-09-17 and independently verified 2026-09-18; no other operator milestone (M2–M7) has been performed** — see the active product cursor above. Not a new phase number, and no production wiring, deployment, enablement, migration application, or production validation has occurred.

Separately, the six stage prompts now state the output limits their own validators enforce —
`MERGED` through PR #78, recorded in its own section above. That is a correctness fix to checked-in
prompt text found by a local evaluation run; it moves no cursor, enables no stage, and authorizes
nothing.

Phase 0B.0 delivered the two runtime primitives the rest of the phase depends on:

- **Content evidence** — typed contract, durable schema, deterministic approved-facts adapter, evidence pack builder with conflict and staleness surfacing, and an explicit idempotent operator sync.
- **AgentRegistry** — all six target stages registered with model policy, prompt/skill/reference assets, allowed capabilities, required evidence kinds, input/output validators, and prerequisites. Asset loading is allowlist-rooted and rejects traversal; a missing mandatory asset fails loudly.
- **ContentIntelligenceContext** and a deterministic preview at `POST /console/content-intelligence/preview`, behind the existing console credential.

`executionEnabled` is `false` on every registered stage and the preview asserts it. Registration is not execution: no stage runs a model call, and the live publishing pipeline is untouched.

**Remaining slices, in order:** the payload-contract reconciliation recorded in its own section above is **`MERGED`**, so that prerequisite is met in repository state and no longer blocks the sequence; the **separately reviewed production-wiring design** is now accepted and `MERGED` through PR #56 and remains **`UNIMPLEMENTED`**, authorizing neither implementation nor operations, so the next work is that design's own **first prerequisite** — a read-only verification of live production identity and database state, recorded in its section above and separately unauthorized; then its eight implementation PRs and seven operator milestones, each under its own authorization; then performance ingestion; then governed learning. The proposed future Google Business Profile expansion sits after those and is not part of this repository's scope today. The roughly 22 originally researched specialist roles remain conceptual capabilities — most belong as deterministic services, references, or policy modules, not as mandatory model calls. After the operational prerequisites are accepted, return to the core mission with approximately six primary model reasoning stages:

1. strategy-concept;
2. automotive-truth;
3. hook-story-script;
4. production-direction;
5. packaging-adaptation; and
6. final-critic.

Continue using the existing `AgentRegistry` and shared execution boundary while completing stage-specific skill/reference handling, research/reference retrieval, structured evidence capture, and deterministic input/output validation around the remaining stages. Treat the roughly 22 originally researched specialist roles as conceptual capabilities: most should be deterministic services, references, policy modules, or optional specialists — not 22 mandatory model calls.

Keep human filming and external editing in the loop. Do not add an in-browser video editor unless a later phase explicitly requires it. Preserve human approval and governed change. Do not implement uncontrolled prompt, skill, agent, process, or publishing-rule rewriting.

## Later / deferred

- ingest platform performance with provenance and freshness;
- build content scorecards around reach, qualified followers, repeat viewing, affinity, retention, engagement, authority, and local relevance;
- track creative and causal hypotheses without confusing them with facts;
- learn from GCD empirical performance while retaining research priors;
- generate governed improvement proposals for human review;
- add paid amplification only after the organic engine and controls are reliable; and
- connect attribution, leads, and revenue after attention and audience quality are measurable.

**`DEFERRED` — browser-based video editing.** Humans film and CapCut or another external editor remains the V1 path. Re-entry condition: an explicit later phase that requires in-browser editing.

## Out-of-band tooling — local Content Intelligence evaluation CLI

**This entry is deliberately outside the P1–P8 / M2–M7 sequence above and does not move the
active product cursor.** It exists so German Car Depot can see real agent output from the six
merged-but-dormant reasoning stages before any production-wiring PR is authorized, not as a step
toward authorizing one.

**State:** `IMPLEMENTED` (repository-local only; nothing here is `MERGED` to a tracked roadmap
phase because it is not phase-scoped work). Not `DEPLOYED`. Not `PRODUCTION-VALIDATED`. Touches no
production system, no database, no scheduler, no worker, and no publishing path.

*Corrected 2026-09-28:* the CLI is on `main` — first merged through PR #71 at
`71f2a133b045ba342d3dd968d4eeb7d2911c32c8`, and extended by later merged changes recorded in this
file — so in this file's vocabulary it is `MERGED`, not merely `IMPLEMENTED`. It is still not
phase-scoped, and still not `DEPLOYED` or `PRODUCTION-VALIDATED`.

**What it is.** `scripts/local/content-run.mjs`, a CLI that drives the six merged stage executors
(`strategy-concept` → `automotive-truth` → `hook-story-script` → `production-direction` →
`packaging-adaptation` → `final-critic`) directly and in sequence, exactly as
`src/harness/contentIntelligence.selftest.ts` already proves the wiring works, threading each
stage's validated output into the next. It loads the 27 adapted business-fact records from
`config/approved-facts.json` through the existing pure `adaptApprovedFactsFile` adapter (not
reimplemented), and loads automotive facts from an operator-supplied, gitignored
`config/automotive-facts.local.json` — never invented, never committed; a placeholder-marked
`config/automotive-facts.local.example.json` template is committed in its place. It builds and
validates an evidence pack with the existing `buildEvidencePack` / `assertUsableEvidencePack`
functions and fails loudly, with the actual violation list, if the pack is unusable.

**What it does not do.** It does not flip any stage's `executionEnabled` (still `false` on every
stage, as merged). It authorizes nothing: no approval, no brief, no worker, no scheduler, no
publishing path is reachable from it. Its default `--runner fake` mode makes no network call and
costs nothing, using canned responses that only ever cite real evidence ids already present in the
caller's own evidence pack or in the immediately preceding stage's own validated output. A
`--runner live` mode exists for later, deliberately gated: it refuses to run without an explicit
`--i-understand-this-costs-money` flag and prints the estimated ceiling cost first. No live model
call has been made from this tool as part of implementing it — that is a separate, separately
authorized step, owned by whoever the business decides should spend real budget on it, and gated on
the same read-only production-identity verification prerequisite the production-wiring design (PR
#56) already requires before any of P1–P8 begins.

**Material design decisions.** Reuse the exact merged executors and validators rather than a
parallel implementation, so this tool can never drift from what P1–P8 will actually wire up. Fail
closed on missing automotive facts (`automotive-truth` refuses with a clear message naming the
missing evidence class) rather than degrading to a strategy-only run, so the tool can never be used
to produce automotive claims with no real source behind them.

**Rejected alternative.** Fabricating placeholder automotive facts so every demo run reaches all
six stages. Rejected because the evidence contract's entire purpose is refusing an automotive claim
that lacks a checkable `sourceRef`, real `provenance`, and a `reviewedAt` — inventing one here would
poison the exact guarantee the contract exists to provide, even in a throwaway local tool.

**Automated validation:** build, typecheck, the eight offline suites (`npm run test:offline`),
simulated dry run, deployment-controller fixtures, dependency audit, Markdown-link validation,
environment-coverage comparison, and the sensitive-content scan all pass unchanged, because no
existing source file was modified. The new CLI itself was run end-to-end with `--runner fake`
against a locally-supplied (non-committed) automotive fact and produced six validated stage JSON
files plus a human-readable Markdown summary; it was also exercised against a missing automotive
facts file, which correctly refused at `automotive-truth` rather than fabricating a claim.

**Accepted limitations.** The `--runner live` path is implemented but has never been exercised
end-to-end (doing so costs real money and requires a real `ANTHROPIC_API_KEY`, neither authorized
here). The fake-runner canned responses are wiring fixtures, not creative or factual review — they
prove the pipeline is connected correctly, not that any particular piece of copy is good or true.

**Follow-ups.** None blocking. Running this tool with `--runner live` for the first time is a
separate, explicitly authorized decision the business makes when it wants to spend real budget
evaluating output quality; it requires its own real `config/automotive-facts.local.json` populated
from manufacturer documentation or another checkable source first.

**Later additions to this tool are recorded in their own entries, not here:** the paid-call
preconditions and the rejected-response capture (*Paid-call preconditions*, above), per-run
field measurement — `field-measurements.md` / `.json` beside every run, fake or live, passing or
failing (*Output-field classification*, above) — `run-meta.json` fingerprints, the typed `LIVE`
confirmation and the critic-only `--replay-critic` mode (*Critic on Claude Opus 5.5*, above), and
the deterministic contact line — its free preflight, `05b-contact-lines.json`, the contacted
packages the critic receives, the contact lines in `summary.md` — and the runner-named summary
footer (*Deterministic contact line*, under *Merged repository change awaiting rollout*). Since
that change the CLI runs `main()` only when executed as a script, so importing it runs nothing. The
critic panel then made full runs and `--replay-critic` run four lens requests, grouped `summary.md`
by lens, tagged every saved response and `field-measurements` row with its lens, and counted four
critic requests in the printed cost ceiling (*Narrow critic panel*, under *Merged repository change awaiting rollout*).
Evidence-pack scoping (`--scope-tags`, recorded in `run-meta.json` and the fingerprint and reused by
`--replay-critic`), `--list-tags`, and the free identity-record preflight were added by
*Evidence-pack scoping in the local CLI …* (now under *Merged repository change awaiting rollout*),
which also made `main` exported and `argv`-driven so the offline suite runs it in-process.
*Dated addition, 2026-09-26:* `--resume-from packaging-adaptation <run-dir>` runs stage 5, the
contact lines and the critic panel against a saved run's revalidated stage 1–4 outputs, after the
replay's own free checks (now shared as `verifySourceRun`), into a new sibling directory
(*Stage 5's caption stated below its enforced budget, and `--resume-from` …*, at the top of this file).

**Documents updated with this entry:** `docs/ROADMAP.md` (this section) and `.gitignore` (excludes
the operator-supplied automotive facts file and the tool's local output directory). `README.md` was
not updated because the production handoff it describes is unchanged by a tool that touches no
production system.

## Out-of-band tooling — local Tekmetric oil-service-interval feasibility probe

**This entry is deliberately outside the P1–P8 / M2–M7 sequence above and does not move the
active product cursor.** It authorizes nothing, deploys nothing, touches no production system,
reads no database, and does not represent a decision to build any Tekmetric-backed feature — it
exists only to answer whether Tekmetric repair-order data can support computing an actual observed
oil-service interval (miles and months) for GCD's BMW and Mercedes-Benz customers.

**State:** `IMPLEMENTED` (repository-local script only; not phase-scoped, so not `MERGED` to any
tracked roadmap phase). Not `DEPLOYED`. Not `PRODUCTION-VALIDATED`. Touches no production system,
no database, no scheduler, no worker, and no publishing path in this repository.

*Corrected 2026-09-28:* the probe is on `main`, merged through PR #73 at
`1ba8e45731eb016e8b2c4fc18a09e208830eca71`, so in this file's vocabulary it is `MERGED`, not
merely `IMPLEMENTED`. It is still not phase-scoped, and still not `DEPLOYED` or
`PRODUCTION-VALIDATED`.

**What it is.** `scripts/local/tekmetric-probe.mjs`, a read-only CLI that, given operator-supplied
Tekmetric OAuth2 client-credentials and a shop id, lists that shop's vehicles, filters client-side
to BMW and Mercedes-Benz (the Tekmetric vehicles list endpoint has no `make` filter, and Tekmetric's
actual make spellings are not assumed — the script reports every distinct spelling it observes so
the match can be verified), then lists each matched vehicle's repair orders with `postedDate` in a
lookback window (default 24 months). It implements the exponential-backoff algorithm the
`tekmetric-api` skill specifies for HTTP 429, and bounds its total request count (default cap 400,
printed alongside every run). No data-mutating request is ever issued. The only non-GET request is
the OAuth2 client-credentials token POST to `/api/v1/oauth/token` required to authenticate; every
data request is a GET. It runs against sandbox by default; a `--live-shop-data` flag is required to
target any non-sandbox (e.g. production) `TEKMETRIC_BASE_URL` — without it, a non-sandbox base URL
is refused before the token request is ever made.

**What it does not do.** It never prints or persists a VIN, customer name, address, phone, email,
an RO number tied to an identifiable customer, a free-text note or job-concern body, or any
monetary figure. Where it needs to check whether a job is an oil service, it inspects only the
structured `job.name` field and reports a match count — it never reads or prints free-text note
bodies, and says explicitly in its output that resolving oil-service identifiability further would
require reading free text, which is out of this script's scope and would need its own PII review.
It emits aggregate counts and fill rates only: total ROs, distinct vehicles, `milesIn`/`milesOut`
fill rates broken out both by make and the year the RO's own `postedDate` falls in (whether mileage
capture improved over time — a vehicle model year cannot answer that; a separate model-year
breakdown is reported alongside it, clearly labeled, for a different purpose), the count of vehicles
with two or more usable ROs (the gating number for any future interval computation) with the
ROs-per-vehicle distribution, and a structural count of consecutive-RO mileage deltas
(positive/plausible, zero, negative-or-absurd) — deliberately without computing a median or any
other interval statistic, since that was out of scope for this feasibility check.

**Credential handling.** The client id, client secret, and shop id are read from the environment
variables `TEKMETRIC_CLIENT_ID`, `TEKMETRIC_CLIENT_SECRET`, and `TEKMETRIC_SHOP_ID` — never
hardcoded, never logged, never echoed, never written to disk, and never committed. These variables
are intentionally **not** added to any `.env.example` file: `scripts/ci/check-environment-coverage.mjs`
scans only `src/**/*.ts`, so omitting them there does not weaken that check, and adding them would
falsely imply a deployed API, worker, or scheduler reads them, when none does. The credential
requirement is documented only in the script's own `--help`/usage text.

**Material design decisions.** Filter to target makes client-side rather than assuming a `make`
list-filter exists on the Tekmetric vehicles endpoint (it does not, per the `tekmetric-api` skill),
and report the raw distinct make spellings observed so a reviewer can verify the match logic rather
than trust it blind. Bound total HTTP requests with a hard cap rather than an unbounded per-vehicle
repair-order fetch, since request volume scales with matched-vehicle count and Tekmetric enforces a
per-minute rate limit. Treat mileage deltas above 60,000 miles between consecutive ROs as "absurd"
for the structural-usability count, without asserting this threshold is the right cutover for any
later statistical treatment.

**Rejected alternative.** Reading job or RO free-text note bodies to identify oil-service jobs more
completely. Rejected for this feasibility probe because note bodies routinely contain PII
(customer-stated concerns, sometimes names or contact details pasted into free text), and this
script's entire purpose is to answer a feasibility question without ever handling identifiable
customer data; if free-text classification turns out to be necessary, that is a separate,
separately authorized piece of work with its own PII-handling review.

**Automated validation:** the script was syntax-checked (`node --check`) and exercised for its
`--help` output and its fail-closed behavior with the required Tekmetric environment variables
unset (exits non-zero before making any HTTP call). No existing source file under `src/` was
modified, so build, typecheck, the offline suites, the simulated dry run, deployment-controller
fixtures, dependency audit, Markdown-link validation, environment-coverage comparison, and the
sensitive-content scan all pass unchanged.

**Accepted limitations.** The live Tekmetric run itself (PHASE 2 of the task that produced this
script) has not been executed as of this entry: it requires both an operator-supplied Tekmetric API
credential and Michael Capote's explicit statement, in his own words, that the read-only probe may
run against live Tekmetric data. Neither was present in the session that authored this script, so
no live HTTP request has been made and no data-feasibility conclusion has been reached yet. Running
it live and reporting the resulting aggregate numbers is a separate, explicitly gated follow-up.
Separately, the default request cap of 400 will likely bind before all matched vehicles' repair
orders are fetched on a real shop's data volume; when it does, the GATING NUMBER (result section 4)
is a **floor**, not the true count, and the vehicle whose pagination was interrupted when the cap
was hit has a truncated repair-order list for that run. `--max-requests` should be raised for a real
run once the shop's true vehicle/RO volume is known; the default itself was left unchanged.

**Follow-ups.** Blocking (for reaching a feasibility conclusion, not for this documentation entry):
obtain a Tekmetric API credential and Michael Capote's explicit authorization to run the probe
against live data, then run `scripts/local/tekmetric-probe.mjs` and record its aggregate output.

**Documents updated with this entry:** `docs/ROADMAP.md` (this section) only. `docs/STATUS.md` was
not updated because no production state was verified or changed. `README.md` was not updated
because the production handoff it describes is unchanged by a tool that touches no production
system.
