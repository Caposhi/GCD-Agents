#!/usr/bin/env bash
# =============================================================================
# M1 OPERATOR PACKET  (one file, self-generating)
# =============================================================================
#
# WHAT THIS IS
#   A single file an authorized operator runs from an EMPTY directory. It
#   generates its own tool set (m1-env.sh plus eighteen helpers), binds ONE
#   isolated clone of the repository at an exact artifact commit A, PREPARES
#   DEPENDENCIES INSIDE THAT CLONE, runs the two read-only operator scripts
#   from it, runs five regression groups, writes a fixed-field RETURN_FORM.txt
#   and an evidence report, and removes the isolated clone and its dependency
#   tree.
#
# WHAT THIS IS NOT
#   It is not a deployment, a migration application, a Render operation, or a
#   production database access. It executes nothing on Render, requests no
#   production credential, and enables no executor. It authorizes nothing.
#
# THE BLOCKER THIS REVISION CORRECTS
#   The database-enabled path used to create a fresh isolated clone with no
#   node_modules, discover that `pg` could not be resolved, print an
#   instruction to run `npm ci --omit=dev` inside that clone and rerun — and
#   then, on the rerun, create ANOTHER fresh clone with no node_modules. There
#   was no executable path by which M1_DB_ENABLED=1 could reach either operator
#   script. Both operator scripts `import pg` at module top level, so the DB
#   DISABLED path was blocked by the same defect.
#
#   Corrected here by helper 05, an explicit, automatic dependency-preparation
#   step that runs INSIDE the already-bound isolated clone BEFORE either
#   operator script runs. The manual "install and rerun" instruction is gone.
#
# =============================================================================
set -euo pipefail

M1_PACKET_CONTRACT_VERSION=2

# --- self-identity -----------------------------------------------------------
# The packet records its own bytes and digest, computed from the file on disk,
# so the evidence names exactly which packet produced it.
M1_PACKET_PATH="${BASH_SOURCE[0]}"
case "$M1_PACKET_PATH" in
  /*) ;;
  *) M1_PACKET_PATH="$PWD/$M1_PACKET_PATH" ;;
esac
[ -f "$M1_PACKET_PATH" ] || { echo "FATAL: cannot locate the packet file itself" >&2; exit 1; }
M1_PACKET_BYTES="$(wc -c < "$M1_PACKET_PATH" | tr -d ' ')"
M1_PACKET_SHA256="$(sha256sum "$M1_PACKET_PATH" | cut -d' ' -f1)"

# --- required inputs ---------------------------------------------------------
usage() {
  cat >&2 <<'USAGE'
M1 operator packet.

Run from an EMPTY directory:

  M1_REPO=/path/to/repository \
  M1_ARTIFACT=<40-hex commit sha> \
  M1_DB_ENABLED=0|1 \
  [GCD_AUDIT_DATABASE_URL=postgres://...]        (DB-enabled path only)
  [M1_CI_EXACT_HEAD_JSON=/path/to/capture.json]  (DB-disabled GitHub path)
  [M1_DB_SCENARIO=<label>]                       (fixed-vocabulary label)
  [M1_KEEP_WORKDIR=1]                            (skip cleanup; diagnostics)
  bash /absolute/path/to/m1-operator-packet.sh

The packet never reads a production credential and never contacts Render.
GCD_AUDIT_DATABASE_URL, when set, must name a DISPOSABLE database.
USAGE
  exit 2
}

M1_REPO="${M1_REPO:-}"
M1_ARTIFACT="${M1_ARTIFACT:-}"
M1_DB_ENABLED="${M1_DB_ENABLED:-0}"
M1_DB_SCENARIO="${M1_DB_SCENARIO:-NONE}"
M1_CI_EXACT_HEAD_JSON="${M1_CI_EXACT_HEAD_JSON:-}"
M1_KEEP_WORKDIR="${M1_KEEP_WORKDIR:-0}"

[ -n "$M1_REPO" ] || usage
[ -n "$M1_ARTIFACT" ] || usage
case "$M1_DB_ENABLED" in 0|1) ;; *) usage ;; esac
case "$M1_ARTIFACT" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "FATAL: M1_ARTIFACT must be a full 40-character lowercase commit SHA" >&2; exit 2 ;;
esac

# --- the packet runs from an empty directory ---------------------------------
# It writes only underneath the directory it is invoked from, and refuses to
# start in a directory that already has contents: an operator packet that
# silently mixes its evidence into someone else's files is not auditable.
M1_INVOCATION_DIR="$PWD"
if [ -n "$(ls -A "$M1_INVOCATION_DIR" 2>/dev/null || true)" ]; then
  echo "FATAL: run this packet from an EMPTY directory (current directory is not empty)" >&2
  exit 2
fi

M1_RUN_ID="m1-$(date -u +%Y%m%dT%H%M%SZ)-$$"
M1_WORK="$M1_INVOCATION_DIR/$M1_RUN_ID"
M1_BIN="$M1_WORK/bin"
M1_STATE="$M1_WORK/state"
M1_STREAM_DIR="$M1_WORK/streams"
M1_CLONE="$M1_WORK/isolated-clone"
M1_DEPS_CACHE="$M1_WORK/npm-cache"
M1_OUT="$M1_INVOCATION_DIR/evidence"
mkdir -p "$M1_BIN" "$M1_STATE" "$M1_STREAM_DIR" "$M1_DEPS_CACHE" "$M1_OUT" "$M1_STATE/home"

export M1_PACKET_CONTRACT_VERSION M1_PACKET_PATH M1_PACKET_BYTES M1_PACKET_SHA256
export M1_REPO M1_ARTIFACT M1_DB_ENABLED M1_DB_SCENARIO M1_CI_EXACT_HEAD_JSON
export M1_RUN_ID M1_WORK M1_BIN M1_STATE M1_STREAM_DIR M1_CLONE M1_DEPS_CACHE M1_OUT
export M1_RESULTS="$M1_STATE/results.kv"
: > "$M1_RESULTS"

# --- generation --------------------------------------------------------------
# Every generated file is written here, made read-only, and digested. The
# inventory is part of the evidence: an operator can prove which tool text ran.
M1_INVENTORY="$M1_STATE/inventory.txt"
: > "$M1_INVENTORY"

m1_emit() {
  # usage: m1_emit <relative-path-under-$M1_BIN> <<'M1_FILE_EOF' ... M1_FILE_EOF
  local rel="$1"
  local dest="$M1_BIN/$rel"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest"
  chmod 0500 "$dest"
  printf '%s  %s  %s\n' \
    "$(sha256sum "$dest" | cut -d' ' -f1)" \
    "$(wc -c < "$dest" | tr -d ' ')" \
    "$rel" >> "$M1_INVENTORY"
}

# -----------------------------------------------------------------------------
# GENERATED FILE 1 of 19 — m1-env.sh (shared library; sourced by all helpers)
# -----------------------------------------------------------------------------
m1_emit "m1-env.sh" <<'M1_ENV_EOF'
# shellcheck shell=bash
# m1-env.sh — the packet's shared, immutable library.
#
# Nothing in this file contacts Render, a production system, or any network.
# The only network access anywhere in the packet is the npm registry fetch in
# helper 05, and that is bounded by the repository lockfile's integrity hashes.

[ -n "${M1_ENV_SOURCED:-}" ] && return 0
M1_ENV_SOURCED=1

# --- the immutable bounded-stream limit --------------------------------------
#
# 1 MiB. Assigned HERE and made readonly, so an inherited environment value
# cannot raise it, lower it, or remove it. If a caller has already frozen the
# name to some other value the assignment fails under `set -e` and the packet
# stops: failing closed is correct, silently honouring an outside limit is not.
#
# It bounds CAPTURED STREAMS ONLY. It is deliberately NOT `ulimit -f`: a file
# size rlimit also constrains every file the process writes, which in an
# isolated clone means Git's own object, pack and checkout writes. Bounding
# collection must never bound the repository.
M1_STREAM_LIMIT_BYTES=1048576
readonly M1_STREAM_LIMIT_BYTES

# --- fixed vocabularies -------------------------------------------------------
# Preserved verbatim. These are decisions of record, not findings of this run.
M1_FIXED_DECISION="M1 BLOCKED / NO-GO"
M1_FIXED_MIGRATION_007="UNKNOWN in either direction"
M1_FIXED_RENDER_CONNECTION="NOT ESTABLISHED"
M1_FIXED_RENDER_EXECUTION="NONE"
M1_FIXED_SERVICE_IDENTITIES="UNKNOWN"
M1_FIXED_ROLLBACK="NOT EXECUTED"
M1_FIXED_EXECUTORS="ALL DISABLED"
M1_FIXED_PRODUCTION_ACCESS="NONE"
M1_FIXED_PRODUCTION_CREDENTIAL="NONE"
M1_FIXED_END_TO_END="NOT A COMPLETE END-TO-END RUN"
readonly M1_FIXED_DECISION M1_FIXED_MIGRATION_007 M1_FIXED_RENDER_CONNECTION
readonly M1_FIXED_RENDER_EXECUTION M1_FIXED_SERVICE_IDENTITIES M1_FIXED_ROLLBACK
readonly M1_FIXED_EXECUTORS M1_FIXED_PRODUCTION_ACCESS M1_FIXED_PRODUCTION_CREDENTIAL
readonly M1_FIXED_END_TO_END

# --- immutable exact-head CI workflow identity --------------------------------
#
# The validating workflow's identity is FIXED HERE and compared against, never
# adopted from whatever a CI capture happens to contain. A capture that names a
# different workflow file, or that carries a head_sha other than artifact A, is
# a mismatch to report — not a new identity to accept.
M1_CI_VALIDATION_WORKFLOW_PATH=".github/workflows/ci.yml"
M1_CI_VALIDATION_WORKFLOW_NAME="CI"
M1_CI_DEPLOY_WORKFLOW_PATH=".github/workflows/deploy-production.yml"
M1_CI_DEPLOY_WORKFLOW_NAME="Deploy production to Render"
M1_CI_REQUIRED_JOB_COUNT=5
M1_CI_REQUIRED_JOB_NAMES="AgentShield 1.4.0|Node 22 offline quality gates|PostgreSQL 16 integration|PostgreSQL 18 integration|Workflow and YAML static validation"
readonly M1_CI_VALIDATION_WORKFLOW_PATH M1_CI_VALIDATION_WORKFLOW_NAME
readonly M1_CI_DEPLOY_WORKFLOW_PATH M1_CI_DEPLOY_WORKFLOW_NAME
readonly M1_CI_REQUIRED_JOB_COUNT M1_CI_REQUIRED_JOB_NAMES

# --- the dependency-preparation contract --------------------------------------
# `npm ci`, never `npm install`. Lifecycle scripts off. Audit and funding
# network calls off. Development dependencies omitted. No global installation.
M1_DEP_COMMAND="npm ci --omit=dev --ignore-scripts --no-audit --no-fund"
readonly M1_DEP_COMMAND

# --- approved RETURN_FORM fields ----------------------------------------------
#
# A field name that is not on this list cannot be recorded, and a value
# carrying a character outside the approved set cannot be recorded. Between
# them, uncontrolled prose cannot reach the return form: not from a driver, not
# from npm, not from a CI capture, and not from a helper that forgot itself.
M1_APPROVED_FIELDS="
M1_RETURN_FORM_VERSION PACKET_SHA256 PACKET_BYTES GENERATED_FILE_COUNT
RUN_ID RUN_MODE ARTIFACT_A ARTIFACT_A_TYPE
ISOLATED_CLONE_BOUND ISOLATED_CLONE_HEAD_MATCHES_A ISOLATED_CLONE_TREE_MATCHES_A
PRIMARY_CHECKOUT_EXECUTION PRIMARY_CHECKOUT_NODE_MODULES_REUSE
ENV_SANITIZED_NAMES ENV_REJECTED_NAMES ENV_ALLOWED_TRANSPORT_NAMES
DEP_PREP_STATUS DEP_PREP_COMMAND DEP_PREP_SCOPE DEP_PREP_EXIT_CODE
DEP_NODE_VERSION DEP_NODE_BINARY_REAL DEP_NPM_VERSION DEP_NPM_BINARY_REAL
DEP_LOCKFILE_SHA256 DEP_LOCKFILE_SOURCE DEP_LOCKFILE_MODIFIED
DEP_PACKAGES_ADDED DEP_LIFECYCLE_SCRIPTS DEP_AUDIT_NETWORK DEP_FUND_NETWORK
DEP_GLOBAL_INSTALL DEP_CACHE_SCOPE DEP_DEV_DEPENDENCIES
DEP_PG_RESOLVED DEP_PG_VERSION DEP_PG_RESOLVED_FROM
DEP_STDOUT_CAPTURED_BYTES DEP_STDERR_CAPTURED_BYTES DEP_STREAM_TRUNCATED
OFFLINE_MIGRATION_READ_STATUS OFFLINE_MIGRATION_DECISION OFFLINE_MIGRATION_FILES
GITHUB_CI_VALIDATION_STATUS GITHUB_CI_RUN_ID GITHUB_CI_WORKFLOW_PATH
GITHUB_CI_WORKFLOW_NAME GITHUB_CI_HEAD_SHA_MATCHES_A GITHUB_CI_CONCLUSION
GITHUB_CI_JOB_COUNT GITHUB_CI_JOB_CONCLUSIONS GITHUB_CI_MAX_RUN_ATTEMPT
GITHUB_CI_DEPLOY_WORKFLOW_USED_AS_VALIDATION
DB_ENABLED_MIGRATION_READ_STATUS DB_ENABLED_MIGRATION_DECISION
DB_ENABLED_MIGRATION_FAILED_COMPARISONS DB_ENABLED_MIGRATION_D DB_ENABLED_MIGRATION_P
DB_ENABLED_AUDIT_STATUS DB_ENABLED_AUDIT_VERDICT DB_ENABLED_AUDIT_CHECK_COUNT
DB_ENABLED_AUDIT_FAILING_CHECKS DB_SERVER_VERSION DB_SCENARIO DB_DISPOSABLE
REGRESSION_G1_BOUNDED_COLLECTION REGRESSION_G2_STREAM_LIMIT
REGRESSION_G3_STRICT_JSON REGRESSION_G4_CONTRACTS REGRESSION_G5_CI_IDENTITY
CONTRACT_MIGRATION_EXPECTED_FILES CONTRACT_MIGRATION_EXPECTED_PENDING
CONTRACT_AUDIT_CHECK_COUNT_RECOMPUTED CI_WORKFLOW_IDENTITY_IMMUTABLE
RENDER_EXECUTION RENDER_CONNECTION PRODUCTION_ACCESS PRODUCTION_CREDENTIAL
MIGRATION_007_PRODUCTION_STATE SERVICE_IDENTITIES ROLLBACK_COMPATIBILITY
EXECUTORS M1_DECISION END_TO_END_CLAIM
CLEANUP_ISOLATED_CLONE CLEANUP_DEPENDENCY_TREE CLEANUP_NPM_CACHE
CLEANUP_EVIDENCE_REPORT
"
readonly M1_APPROVED_FIELDS

# --- basic utilities ----------------------------------------------------------
m1_die() { printf 'FATAL: %s\n' "$*" >&2; exit 1; }
m1_note() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
m1_sha256() { sha256sum "$1" | cut -d' ' -f1; }

m1_require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || m1_die "required command not found: $c"
  done
}

# m1_record KEY VALUE — the only way a fact reaches the return form.
m1_record() {
  local key="$1"; shift
  local value="$*"
  case " $(echo $M1_APPROVED_FIELDS) " in
    *" $key "*) ;;
    *) m1_die "refusing to record unapproved field: $key" ;;
  esac
  case "$value" in
    *[!A-Za-z0-9\ ._:/=+,\(\)\#@-]*) m1_die "refusing to record field $key: value carries a character outside the approved set" ;;
  esac
  printf '%s=%s\n' "$key" "$value" >> "$M1_RESULTS"
}

m1_get() {
  local key="$1"
  awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,"");v=$0} END{print v}' "$M1_RESULTS"
}

# -----------------------------------------------------------------------------
# The bounded collector — corrected.
# -----------------------------------------------------------------------------
#
# Captures a command's stdout and stderr, each bounded at exactly
# M1_STREAM_LIMIT_BYTES, and records the exit code and how many bytes were
# discarded beyond the bound.
#
# Three properties the previous collector did not have:
#
#   1. It bounds STREAMS, not FILES. No `ulimit -f` is set, so Git, npm and the
#      operator scripts write repository and dependency files of any size while
#      collection is active. Regression group 1 proves it.
#   2. The bound is exact. Each sink reads exactly 16 x 65536 = 1048576 bytes
#      with `iflag=fullblock` (short reads on a pipe are re-read rather than
#      silently ending the block), then drains and COUNTS the remainder without
#      storing it. Regression group 2 proves it.
#   3. The collected command cannot be killed by the collector. The sinks keep
#      reading after the bound is reached, so the producer never takes SIGPIPE
#      and its own exit status is its own.
m1__sink() {
  local dest="$1" overflow="$2"
  dd bs=65536 count=16 iflag=fullblock status=none of="$dest" 2>/dev/null || true
  [ -f "$dest" ] || : > "$dest"
  cat | wc -c | tr -d ' ' > "$overflow"
}

m1_collect() {
  local slug="$1"; shift
  local d="$M1_STREAM_DIR"
  local fo="$d/.$slug.out.fifo" fe="$d/.$slug.err.fifo"
  rm -f "$fo" "$fe"
  mkfifo -m 0600 "$fo" "$fe"
  m1__sink "$d/$slug.out" "$d/$slug.out.overflow" < "$fo" &
  local po=$!
  m1__sink "$d/$slug.err" "$d/$slug.err.overflow" < "$fe" &
  local pe=$!
  local rc=0
  "$@" > "$fo" 2> "$fe" || rc=$?
  wait "$po" || true
  wait "$pe" || true
  rm -f "$fo" "$fe"
  printf '%s\n' "$rc" > "$d/$slug.rc"
  return 0
}

m1_rc()        { cat "$M1_STREAM_DIR/$1.rc"; }
m1_out_file()  { printf '%s\n' "$M1_STREAM_DIR/$1.out"; }
m1_err_file()  { printf '%s\n' "$M1_STREAM_DIR/$1.err"; }
m1_out_bytes() { wc -c < "$M1_STREAM_DIR/$1.out" | tr -d ' '; }
m1_err_bytes() { wc -c < "$M1_STREAM_DIR/$1.err" | tr -d ' '; }
m1_truncated() {
  local o e
  o="$(cat "$M1_STREAM_DIR/$1.out.overflow" 2>/dev/null || echo 0)"
  e="$(cat "$M1_STREAM_DIR/$1.err.overflow" 2>/dev/null || echo 0)"
  if [ "${o:-0}" -gt 0 ] || [ "${e:-0}" -gt 0 ]; then echo YES; else echo NO; fi
}

# -----------------------------------------------------------------------------
# Environment sanitization for dependency preparation.
# -----------------------------------------------------------------------------
#
# Names only are ever reported. No value of a sanitized or rejected variable is
# printed, logged, or recorded — several of them routinely carry credentials.
#
# SANITIZED (removed from the dependency step's environment entirely):
#   every npm_config_* / NPM_CONFIG_* / npm_* variable except the transport
#   allow-list below, plus NODE_OPTIONS, NODE_PATH, NODE_REPL_*, NPM_TOKEN.
#   These can redirect the registry, the cache, the config files npm reads, the
#   shell npm runs scripts with, the prefix it installs into, or the module
#   resolution order the verification step depends on.
#
# ALLOWED (transport only, passed through so a proxied operator machine can
# reach the registry at all):
#   HTTP_PROXY HTTPS_PROXY NO_PROXY and their lowercase spellings, plus
#   NODE_EXTRA_CA_CERTS.
#   A proxy can see the traffic; it cannot change what gets installed. `npm ci`
#   verifies every tarball against the sha512 integrity hash recorded in the
#   repository lockfile, and the lockfile is proven byte-identical to artifact
#   A before the install and unmodified after it.
#
# REJECTED (the packet stops rather than continuing):
#   a request to run lifecycle scripts, which the packet will not enable to
#   make anything pass.
M1_NPM_TRANSPORT_ALLOW="HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy NODE_EXTRA_CA_CERTS npm_config_proxy npm_config_http_proxy npm_config_https_proxy npm_config_noproxy"
readonly M1_NPM_TRANSPORT_ALLOW

# m1_clone_run — run a command with cwd inside the isolated clone, with the two
# module-resolution overrides removed. Used for every operator-script run, so
# no operator script can ever execute from the primary checkout.
m1_clone_run() {
  (
    unset NODE_OPTIONS NODE_PATH 2>/dev/null || true
    cd "$M1_CLONE" || exit 97
    exec "$@"
  )
}

m1_env_names_to_sanitize() {
  # Prints the NAMES (never the values) of variables the dependency step removes.
  local n
  for n in $(awk 'BEGIN{for(v in ENVIRON) print v}' | sort); do
    case "$n" in
      npm_config_*|NPM_CONFIG_*|npm_package_*|npm_lifecycle_*|npm_execpath|npm_node_execpath|NPM_TOKEN|NODE_OPTIONS|NODE_PATH|NODE_REPL_*)
        case " $M1_NPM_TRANSPORT_ALLOW " in
          *" $n "*) ;;
          *) printf '%s\n' "$n" ;;
        esac
        ;;
    esac
  done
}

m1_env_names_to_reject() {
  # A deliberate request to re-enable lifecycle scripts is refused outright:
  # the packet will not turn package scripts on to make an install succeed.
  local v
  for v in npm_config_ignore_scripts NPM_CONFIG_IGNORE_SCRIPTS; do
    if [ -n "${!v:-}" ]; then
      case "$(printf '%s' "${!v}" | tr 'A-Z' 'a-z')" in
        false|0|no) printf '%s\n' "$v" ;;
      esac
    fi
  done
}

# -----------------------------------------------------------------------------
# Strict decoded-key JSON handling — corrected.
# -----------------------------------------------------------------------------
#
# JSON.parse silently keeps the LAST of a set of duplicate keys, and it
# compares keys only after its own decoding, so a document carrying both "a"
# and "a" reaches a consumer as one key with the second value. An operator
# record read that way can report a decision its own evidence does not contain.
#
# This parser walks the raw text, DECODES each key before comparison, and
# rejects a duplicate decoded key rather than resolving it. It also rejects
# __proto__, constructor and prototype as keys, raw control characters in
# strings, lone surrogates, non-JSON number forms, and trailing content.
M1_JSON_PROGRAM='
const fs=require("fs");
const file=process.argv[1], mode=process.argv[2]||"validate", sel=process.argv[3]||"";
const src=fs.readFileSync(file,"utf8");
let i=0;
function fail(c){process.stderr.write("STRICT_JSON_ERROR "+c+"\n");process.exit(3);}
function ws(){for(;;){const ch=src[i];if(ch===" "||ch==="\t"||ch==="\n"||ch==="\r")i++;else break;}}
function parseString(){
  if(src[i]!=="\"")fail("expected_string");
  i++;let out="";
  for(;;){
    if(i>=src.length)fail("unterminated_string");
    const ch=src[i];
    if(ch==="\""){i++;return out;}
    if(src.charCodeAt(i)<0x20)fail("raw_control_character");
    if(ch==="\\"){
      i++;const e=src[i];i++;
      if(e==="\"")out+="\"";
      else if(e==="\\")out+="\\";
      else if(e==="/")out+="/";
      else if(e==="b")out+="\b";
      else if(e==="f")out+="\f";
      else if(e==="n")out+="\n";
      else if(e==="r")out+="\r";
      else if(e==="t")out+="\t";
      else if(e==="u"){
        const hex=src.substr(i,4);
        if(!/^[0-9a-fA-F]{4}$/.test(hex))fail("bad_unicode_escape");
        i+=4;
        const cp=parseInt(hex,16);
        if(cp>=0xD800&&cp<=0xDBFF){
          if(src[i]!=="\\"||src[i+1]!=="u")fail("lone_high_surrogate");
          const hex2=src.substr(i+2,4);
          if(!/^[0-9a-fA-F]{4}$/.test(hex2))fail("bad_unicode_escape");
          const lo=parseInt(hex2,16);
          if(lo<0xDC00||lo>0xDFFF)fail("lone_high_surrogate");
          i+=6;out+=String.fromCharCode(cp,lo);
        } else if(cp>=0xDC00&&cp<=0xDFFF){fail("lone_low_surrogate");}
        else out+=String.fromCharCode(cp);
      }
      else fail("bad_escape");
    } else {out+=ch;i++;}
  }
}
function parseNumber(){
  const m=/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/.exec(src.slice(i));
  if(!m)fail("bad_number");
  i+=m[0].length;return Number(m[0]);
}
const FORBIDDEN=["__proto__","constructor","prototype"];
function parseValue(depth){
  if(depth>64)fail("too_deep");
  ws();
  const ch=src[i];
  if(ch===undefined)fail("unexpected_end");
  if(ch==="{"){
    i++;const obj=Object.create(null);const seen=new Set();ws();
    if(src[i]==="}"){i++;return obj;}
    for(;;){
      ws();
      const k=parseString();
      if(FORBIDDEN.indexOf(k)>=0)fail("forbidden_key");
      if(seen.has(k))fail("duplicate_decoded_key");
      seen.add(k);
      ws();
      if(src[i]!==":")fail("expected_colon");
      i++;
      const v=parseValue(depth+1);
      Object.defineProperty(obj,k,{value:v,enumerable:true,writable:true,configurable:true});
      ws();
      if(src[i]===","){i++;continue;}
      if(src[i]==="}"){i++;return obj;}
      fail("expected_comma_or_brace");
    }
  }
  if(ch==="["){
    i++;const arr=[];ws();
    if(src[i]==="]"){i++;return arr;}
    for(;;){
      arr.push(parseValue(depth+1));ws();
      if(src[i]===","){i++;continue;}
      if(src[i]==="]"){i++;return arr;}
      fail("expected_comma_or_bracket");
    }
  }
  if(ch==="\"")return parseString();
  if(src.startsWith("true",i)){i+=4;return true;}
  if(src.startsWith("false",i)){i+=5;return false;}
  if(src.startsWith("null",i)){i+=4;return null;}
  if(ch==="-"||(ch>="0"&&ch<="9"))return parseNumber();
  fail("unexpected_token");
}
const root=parseValue(0);
ws();
if(i!==src.length)fail("trailing_content");
function pick(v,s){
  if(s==="")return v;
  const parts=s.split("//");
  let cur=v;
  for(const p of parts){
    if(cur===null||typeof cur!=="object")fail("path_not_found");
    if(Array.isArray(cur)){
      const idx=Number(p);
      if(!Number.isInteger(idx)||idx<0||idx>=cur.length)fail("path_not_found");
      cur=cur[idx];
    } else {
      if(!Object.prototype.hasOwnProperty.call(cur,p))fail("path_not_found");
      cur=cur[p];
    }
  }
  return cur;
}
if(mode==="validate"){process.stdout.write("OK");process.exit(0);}
const v=pick(root,sel);
if(mode==="len"){if(!Array.isArray(v))fail("not_an_array");process.stdout.write(String(v.length));process.exit(0);}
if(mode==="get"){process.stdout.write(typeof v==="string"?v:JSON.stringify(v));process.exit(0);}
fail("bad_mode");
'
readonly M1_JSON_PROGRAM

# m1_json FILE MODE [PATH] — strict read. Never uses JSON.parse.
m1_json() {
  local file="$1" mode="${2:-validate}" sel="${3:-}"
  node -e "$M1_JSON_PROGRAM" "$file" "$mode" "$sel"
}
M1_ENV_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 2 of 19 — helper 01: preflight
# -----------------------------------------------------------------------------
m1_emit "h01-preflight.sh" <<'M1_H01_EOF'
#!/usr/bin/env bash
# helper 01 — preflight. Establishes that the packet may run at all.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

m1_require_cmd git node npm sha256sum dd mkfifo awk sed cut wc cat rm mkdir date tr cmp

# The packet must not run inside, or write into, the primary checkout. Every
# execution happens in the isolated clone; the primary checkout is read as a
# Git object store and in no other way.
case "$M1_WORK/" in
  "$M1_REPO"/*) m1_die "the work directory is inside the primary checkout; run the packet from an empty directory outside it" ;;
esac
[ -d "$M1_REPO/.git" ] || m1_die "M1_REPO is not a Git repository"

# Artifact A must be a COMMIT object in the primary checkout's object store.
# A tree, blob or annotated-tag SHA has no commit ancestry and cannot have an
# exact-head CI run.
a_type="$(git -C "$M1_REPO" cat-file -t "$M1_ARTIFACT" 2>/dev/null || echo ABSENT)"
[ "$a_type" = "commit" ] || m1_die "artifact A is not a commit object in M1_REPO (git reports: $a_type)"

m1_record RUN_ID "$M1_RUN_ID"
m1_record PACKET_SHA256 "$M1_PACKET_SHA256"
m1_record PACKET_BYTES "$M1_PACKET_BYTES"
m1_record M1_RETURN_FORM_VERSION "$M1_PACKET_CONTRACT_VERSION"
m1_record ARTIFACT_A "$M1_ARTIFACT"
m1_record ARTIFACT_A_TYPE "commit"
if [ "$M1_DB_ENABLED" = "1" ]; then m1_record RUN_MODE "DB_ENABLED"; else m1_record RUN_MODE "DB_DISABLED"; fi
m1_record DB_SCENARIO "$M1_DB_SCENARIO"

# Preserved, non-negotiable facts of record. Recorded at preflight so they
# cannot be produced as a conclusion of anything this run observed.
m1_record M1_DECISION "$M1_FIXED_DECISION"
m1_record MIGRATION_007_PRODUCTION_STATE "$M1_FIXED_MIGRATION_007"
m1_record RENDER_CONNECTION "$M1_FIXED_RENDER_CONNECTION"
m1_record RENDER_EXECUTION "$M1_FIXED_RENDER_EXECUTION"
m1_record SERVICE_IDENTITIES "$M1_FIXED_SERVICE_IDENTITIES"
m1_record ROLLBACK_COMPATIBILITY "$M1_FIXED_ROLLBACK"
m1_record EXECUTORS "$M1_FIXED_EXECUTORS"
m1_record PRODUCTION_ACCESS "$M1_FIXED_PRODUCTION_ACCESS"
m1_record PRODUCTION_CREDENTIAL "$M1_FIXED_PRODUCTION_CREDENTIAL"
m1_record END_TO_END_CLAIM "$M1_FIXED_END_TO_END"
m1_record PRIMARY_CHECKOUT_EXECUTION "NONE"
m1_record PRIMARY_CHECKOUT_NODE_MODULES_REUSE "NONE"
M1_H01_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 3 of 19 — helper 02: environment sanitization
# -----------------------------------------------------------------------------
m1_emit "h02-sanitize-environment.sh" <<'M1_H02_EOF'
#!/usr/bin/env bash
# helper 02 — sanitize or reject environment settings that could materially
# redirect or alter dependency installation. NAMES are reported; no value of
# any sanitized or rejected variable is printed, logged or recorded.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

rejected="$(m1_env_names_to_reject | sort | tr '\n' ',' | sed 's/,$//')"
if [ -n "$rejected" ]; then
  m1_record ENV_REJECTED_NAMES "$rejected"
  m1_die "refusing to run: these variables request package lifecycle scripts: $rejected"
fi
m1_record ENV_REJECTED_NAMES "NONE"

sanitized="$(m1_env_names_to_sanitize | sort | tr '\n' ',' | sed 's/,$//')"
[ -n "$sanitized" ] || sanitized="NONE"
m1_record ENV_SANITIZED_NAMES "$sanitized"
printf '%s\n' "$sanitized" > "$M1_STATE/env-sanitized-names.txt"

allowed=""
for n in $M1_NPM_TRANSPORT_ALLOW; do
  if [ -n "${!n:-}" ]; then allowed="${allowed:+$allowed,}$n"; fi
done
[ -n "$allowed" ] || allowed="NONE"
m1_record ENV_ALLOWED_TRANSPORT_NAMES "$allowed"
printf '%s\n' "$allowed" > "$M1_STATE/env-allowed-names.txt"
M1_H02_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 4 of 19 — helper 03: bind the isolated clone
# -----------------------------------------------------------------------------
m1_emit "h03-bind-isolated-clone.sh" <<'M1_H03_EOF'
#!/usr/bin/env bash
# helper 03 — bind exactly one isolated clone at artifact A.
#
# `git clone` transfers committed objects only. It cannot carry an untracked or
# ignored path, so the primary checkout's node_modules — if it has one — cannot
# reach the clone by this route or any other in this packet.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

if [ -e "$M1_CLONE" ]; then m1_die "isolated clone path already exists"; fi

m1_collect clone-create git clone --quiet --no-hardlinks "$M1_REPO" "$M1_CLONE"
[ "$(m1_rc clone-create)" = "0" ] || m1_die "isolated clone could not be created"

m1_collect clone-checkout git -C "$M1_CLONE" checkout --quiet --detach "$M1_ARTIFACT"
[ "$(m1_rc clone-checkout)" = "0" ] || m1_die "isolated clone could not be checked out at artifact A"

m1_record ISOLATED_CLONE_BOUND "YES"
M1_H03_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 5 of 19 — helper 04: verify the isolated clone
# -----------------------------------------------------------------------------
m1_emit "h04-verify-isolated-clone.sh" <<'M1_H04_EOF'
#!/usr/bin/env bash
# helper 04 — prove the clone is the artifact, and that it starts with no
# dependency tree of any provenance.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

head_sha="$(git -C "$M1_CLONE" rev-parse HEAD)"
[ "$head_sha" = "$M1_ARTIFACT" ] || m1_die "isolated clone HEAD is not artifact A"
m1_record ISOLATED_CLONE_HEAD_MATCHES_A "YES"

src_tree="$(git -C "$M1_REPO" rev-parse "$M1_ARTIFACT^{tree}")"
dst_tree="$(git -C "$M1_CLONE" rev-parse "HEAD^{tree}")"
[ "$src_tree" = "$dst_tree" ] || m1_die "isolated clone tree does not match artifact A"
m1_record ISOLATED_CLONE_TREE_MATCHES_A "YES"

# The working tree must be exactly the artifact, with nothing extra.
if [ -e "$M1_CLONE/node_modules" ]; then m1_die "a dependency tree exists in the isolated clone before preparation"; fi
dirty="$(git -C "$M1_CLONE" status --porcelain | wc -l | tr -d ' ')"
[ "$dirty" = "0" ] || m1_die "the isolated clone is not clean at artifact A"

# The two read-only operator scripts must exist at A, or nothing downstream
# means anything.
for f in scripts/ops/migration-state-read.mjs scripts/ops/evidence-aggregate-audit.mjs package.json package-lock.json; do
  [ -f "$M1_CLONE/$f" ] || m1_die "artifact A does not contain $f"
done
M1_H04_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 6 of 19 — helper 05: dependency preparation  (THE CORRECTION)
# -----------------------------------------------------------------------------
m1_emit "h05-prepare-dependencies.sh" <<'M1_H05_EOF'
#!/usr/bin/env bash
# helper 05 — prepare dependencies INSIDE the already-bound isolated clone,
# automatically, before either operator script runs.
#
# Both operator scripts carry `import pg from "pg"` at module top level, so
# neither can start — not even `migration-state-read.mjs --offline`, which
# contacts no database — until `pg` resolves from the clone. That is why the
# previous packet's database-enabled path was unreachable, and why this step is
# unconditional rather than database-only.
#
# Contract, all enforced below rather than documented:
#   - package.json and the lockfile are proven byte-identical to artifact A;
#   - a real Node 22 binary and a real npm binary are required;
#   - the repository lockfile is used and is proven unmodified afterwards;
#   - `npm ci`, never `npm install`;
#   - `--ignore-scripts`: no package lifecycle script runs, for any reason;
#   - `--no-audit --no-fund`: no audit or funding network call;
#   - `--omit=dev`: development dependencies are not installed;
#   - no global installation, and an isolated cache inside the work directory;
#   - the install runs with cwd inside the isolated clone and nowhere else;
#   - stdout and stderr go through the corrected immutable bounded collector;
#   - on failure it stops. It does not print an instruction to install by hand.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

# --- preconditions -----------------------------------------------------------
[ -d "$M1_CLONE/.git" ] || m1_die "no isolated clone is bound"
[ "$(git -C "$M1_CLONE" rev-parse HEAD)" = "$M1_ARTIFACT" ] || m1_die "isolated clone is not at artifact A"
if [ -e "$M1_CLONE/node_modules" ]; then
  m1_die "a dependency tree already exists in the isolated clone; refusing to reuse it"
fi

# --- the manifest and the lockfile come from exact artifact A ----------------
# Read straight out of the object store and compared byte for byte against the
# checked-out files, so neither can have been substituted between checkout and
# install.
for f in package.json package-lock.json; do
  git -C "$M1_CLONE" cat-file blob "$M1_ARTIFACT:$f" > "$M1_STATE/artifactA-$f"
  cmp -s "$M1_STATE/artifactA-$f" "$M1_CLONE/$f" || m1_die "$f in the isolated clone differs from artifact A"
done
lock_before="$(m1_sha256 "$M1_CLONE/package-lock.json")"
m1_record DEP_LOCKFILE_SHA256 "$lock_before"
m1_record DEP_LOCKFILE_SOURCE "ARTIFACT_A_BLOB_VERIFIED"

# --- a real Node 22 binary and a real npm binary -----------------------------
node_bin="$(command -v node || true)"
npm_bin="$(command -v npm || true)"
[ -n "$node_bin" ] && [ -f "$node_bin" ] && [ -x "$node_bin" ] || m1_die "node is not an executable file on PATH"
[ -n "$npm_bin" ] && [ -f "$npm_bin" ] && [ -x "$npm_bin" ] || m1_die "npm is not an executable file on PATH"

node_ver="$("$node_bin" --version 2>/dev/null || true)"
case "$node_ver" in
  v22.*) ;;
  *) m1_die "a Node 22 runtime is required; the node on PATH reports $node_ver" ;;
esac

# A shim that answers `--version` is not a Node runtime. A real one reports a
# V8 version and an execPath that resolves to the very binary that was run.
probe="$("$node_bin" -p 'process.versions.v8 ? process.execPath : ""' 2>/dev/null || true)"
[ -n "$probe" ] || m1_die "the node on PATH did not report a V8 runtime"
[ "$(readlink -f "$probe")" = "$(readlink -f "$node_bin")" ] || m1_die "the node on PATH is not the binary that executed"
m1_record DEP_NODE_VERSION "$node_ver"
m1_record DEP_NODE_BINARY_REAL "YES"

npm_ver="$("$npm_bin" --version 2>/dev/null || true)"
case "$npm_ver" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) m1_die "npm did not report a version" ;;
esac
# A real npm reports its own version and the Node it is running on, as JSON,
# from npm itself rather than from a string this packet composed. `npm version`
# with no semver argument only REPORTS; it changes nothing.
mkdir -p "$M1_STATE/tmp" "$M1_STATE/home"
: > "$M1_STATE/empty-user.npmrc"
: > "$M1_STATE/empty-global.npmrc"

# The sanitized runner. Every name helper 02 identified is removed from the
# child's environment in a subshell, so no value is ever placed on a command
# line, in a file, or in this packet's output. The transport allow-list is left
# alone: a proxy can carry the traffic but cannot change what is installed,
# because `npm ci` verifies every tarball against the sha512 integrity hash in
# the lockfile that was just proven to be artifact A's.
m1_dep_run() {
  (
    while IFS= read -r n; do
      if [ -n "$n" ]; then unset "$n" 2>/dev/null || true; fi
    done < <(m1_env_names_to_sanitize)
    HOME="$M1_STATE/home"
    TMPDIR="$M1_STATE/tmp"
    export HOME TMPDIR
    cd "$M1_CLONE" || exit 97
    exec "$@"
  )
}

m1_dep_run "$npm_bin" version --json > "$M1_STATE/npm-version.json" 2>/dev/null \
  || m1_die "npm did not report its own runtime"
m1_json "$M1_STATE/npm-version.json" validate >/dev/null \
  || m1_die "npm did not report its runtime as strict JSON"
npm_self="$(m1_json "$M1_STATE/npm-version.json" get npm)"
npm_node="$(m1_json "$M1_STATE/npm-version.json" get node)"
[ "$npm_self" = "$npm_ver" ] || m1_die "the npm on PATH does not report its own version consistently"
case "v$npm_node" in
  v22.*) ;;
  *) m1_die "the npm on PATH is not running on Node 22 (it reports $npm_node)" ;;
esac
[ "v$npm_node" = "$node_ver" ] || m1_die "npm is running on a different Node than the one verified"
m1_record DEP_NPM_VERSION "$npm_ver"
m1_record DEP_NPM_BINARY_REAL "YES"

# --- the install -------------------------------------------------------------
# `npm ci`, never `npm install`: `install` may rewrite the lockfile and resolve
# outside it. The flags below are passed on the command line, which outranks
# every configuration file and every remaining environment setting.
m1_collect dep-npm-ci m1_dep_run "$npm_bin" ci \
  --omit=dev \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  --registry=https://registry.npmjs.org/ \
  --cache="$M1_DEPS_CACHE" \
  --userconfig="$M1_STATE/empty-user.npmrc" \
  --globalconfig="$M1_STATE/empty-global.npmrc" \
  --foreground-scripts=false

rc="$(m1_rc dep-npm-ci)"
m1_record DEP_PREP_COMMAND "$M1_DEP_COMMAND"
m1_record DEP_PREP_SCOPE "ISOLATED_CLONE_ONLY"
m1_record DEP_PREP_EXIT_CODE "$rc"
m1_record DEP_STDOUT_CAPTURED_BYTES "$(m1_out_bytes dep-npm-ci)"
m1_record DEP_STDERR_CAPTURED_BYTES "$(m1_err_bytes dep-npm-ci)"
m1_record DEP_STREAM_TRUNCATED "$(m1_truncated dep-npm-ci)"
m1_record DEP_LIFECYCLE_SCRIPTS "DISABLED"
m1_record DEP_AUDIT_NETWORK "DISABLED"
m1_record DEP_FUND_NETWORK "DISABLED"
m1_record DEP_DEV_DEPENDENCIES "OMITTED"
m1_record DEP_CACHE_SCOPE "ISOLATED_WORKDIR"

if [ "$rc" != "0" ]; then
  m1_record DEP_PREP_STATUS "FAILED"
  m1_record DEP_PG_RESOLVED "NO"
  m1_die "dependency preparation failed (exit $rc); no operator script was run"
fi

# --- the lockfile was used, and was not modified -----------------------------
lock_after="$(m1_sha256 "$M1_CLONE/package-lock.json")"
if [ "$lock_after" != "$lock_before" ]; then
  m1_record DEP_LOCKFILE_MODIFIED "YES"
  m1_die "the lockfile changed during installation"
fi
if [ -n "$(git -C "$M1_CLONE" status --porcelain -- package-lock.json package.json)" ]; then
  m1_record DEP_LOCKFILE_MODIFIED "YES"
  m1_die "the lockfile or manifest is dirty after installation"
fi
m1_record DEP_LOCKFILE_MODIFIED "NO"

# --- nothing was installed globally ------------------------------------------
global_flag="$(m1_dep_run "$npm_bin" config get global --userconfig="$M1_STATE/empty-user.npmrc" --globalconfig="$M1_STATE/empty-global.npmrc" 2>/dev/null || echo unknown)"
[ "$global_flag" = "false" ] || m1_die "npm did not resolve global=false for this installation"
m1_record DEP_GLOBAL_INSTALL "NONE"

# --- how many packages, taken as digits only ---------------------------------
added="$(sed -n 's/.*added \([0-9][0-9]*\) package.*/\1/p' "$(m1_out_file dep-npm-ci)" | head -n 1)"
case "$added" in
  ""|*[!0-9]*) added="UNREPORTED" ;;
esac
m1_record DEP_PACKAGES_ADDED "$added"
m1_record DEP_PREP_STATUS "OK"
M1_H05_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 7 of 19 — helper 06: verify pg resolves from the isolated clone
# -----------------------------------------------------------------------------
m1_emit "h06-verify-pg-resolution.sh" <<'M1_H06_EOF'
#!/usr/bin/env bash
# helper 06 — prove `pg` resolves from the isolated clone, by the same route
# the operator scripts take.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

[ "$(m1_get DEP_PREP_STATUS)" = "OK" ] || m1_die "dependency preparation did not succeed"

probe='const {createRequire}=require("module");
const r=createRequire(process.cwd()+"/probe.cjs");
process.stdout.write(r.resolve("pg")+" "+r("pg/package.json").version);'

out="$(cd "$M1_CLONE" && node -e "$probe" 2>/dev/null || true)"
[ -n "$out" ] || m1_die "pg does not resolve from the isolated clone"
pg_path="${out%% *}"
pg_ver="${out##* }"

case "$pg_path" in
  "$M1_CLONE/node_modules/"*) ;;
  *) m1_die "pg resolved from outside the isolated clone" ;;
esac
case "$pg_ver" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) m1_die "pg reported no usable version" ;;
esac

# The operator scripts are ES modules and import pg as a default export. Prove
# that exact form works, not merely that a directory exists.
m1_collect dep-pg-import env -u NODE_OPTIONS -u NODE_PATH \
  bash -c 'cd "$1" && node --input-type=module -e "import pg from \"pg\"; if(!pg.Pool){process.exit(9);}"' _ "$M1_CLONE"
[ "$(m1_rc dep-pg-import)" = "0" ] || m1_die "the ESM import form the operator scripts use does not work"

m1_record DEP_PG_RESOLVED "YES"
m1_record DEP_PG_VERSION "$pg_ver"
m1_record DEP_PG_RESOLVED_FROM "ISOLATED_CLONE_NODE_MODULES"
M1_H06_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 8 of 19 — helper 07: offline migration-state read
# -----------------------------------------------------------------------------
m1_emit "h07-migration-state-offline.sh" <<'M1_H07_EOF'
#!/usr/bin/env bash
# helper 07 — the artifact half of the migration-state read, with no database.
#
# This runs on BOTH paths. It is the artifact-only half of §4.4.2: F(A) and the
# expected sets. It is NOT the production migration state, and computing it
# establishes nothing about what production has applied.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

[ "$(m1_get DEP_PG_RESOLVED)" = "YES" ] || m1_die "dependencies are not prepared"

m1_collect op-migration-offline m1_clone_run node scripts/ops/migration-state-read.mjs \
  --milestone M1 --artifact "$M1_ARTIFACT" --offline

rc="$(m1_rc op-migration-offline)"
out="$(m1_out_file op-migration-offline)"
if [ "$rc" != "0" ]; then
  m1_record OFFLINE_MIGRATION_READ_STATUS "FAILED"
  m1_die "the offline migration-state read failed (exit $rc)"
fi
m1_json "$out" validate >/dev/null || m1_die "the offline migration-state read did not emit strict JSON"

decision="$(m1_json "$out" get decision)"
case "$decision" in
  INCOMPLETE*) m1_record OFFLINE_MIGRATION_DECISION "INCOMPLETE_OFFLINE_D_NOT_READ" ;;
  *) m1_die "the offline migration-state read reported an unexpected decision class" ;;
esac

files="$(m1_json "$out" len 'F(A)')"
m1_record OFFLINE_MIGRATION_FILES "$files"

cmp1="$(m1_json "$out" get 'comparisons//1_F(A)==E_files')"
[ "$cmp1" = "true" ] || m1_die "comparison 1 (F(A)==E_files) is false at artifact A"

m1_record OFFLINE_MIGRATION_READ_STATUS "OK"
M1_H07_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 9 of 19 — helper 08: DB-DISABLED GitHub exact-head CI check
# -----------------------------------------------------------------------------
m1_emit "h08-github-exact-head-ci.sh" <<'M1_H08_EOF'
#!/usr/bin/env bash
# helper 08 — the DB-DISABLED path's GitHub validation.
#
# This path is NOT the database-enabled path and is not a substitute for it. It
# establishes exactly one thing: that a CI run exists for the EXACT artifact A,
# on the workflow identity fixed in m1-env.sh, and how that run concluded. It
# reads a capture the operator took read-only. The packet holds no token,
# performs no write, and reaches no network here.
#
# The workflow identity is compared against, never adopted. A capture naming a
# different workflow file is a mismatch to report.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

if [ -z "${M1_CI_EXACT_HEAD_JSON:-}" ]; then
  m1_record GITHUB_CI_VALIDATION_STATUS "NOT_EXECUTED"
  exit 0
fi
[ -f "$M1_CI_EXACT_HEAD_JSON" ] || m1_die "the CI capture named by M1_CI_EXACT_HEAD_JSON does not exist"

cap="$M1_CI_EXACT_HEAD_JSON"
m1_json "$cap" validate >/dev/null || m1_die "the CI capture is not strict JSON"

cap_head="$(m1_json "$cap" get head_sha)"
[ "$cap_head" = "$M1_ARTIFACT" ] || m1_die "the CI capture is not for artifact A"

n="$(m1_json "$cap" len runs)"
idx=0
found=-1
deploy_as_validation="NO"
while [ "$idx" -lt "$n" ]; do
  p="$(m1_json "$cap" get "runs//$idx//path")"
  nm="$(m1_json "$cap" get "runs//$idx//name")"
  hs="$(m1_json "$cap" get "runs//$idx//head_sha")"
  [ "$hs" = "$M1_ARTIFACT" ] || m1_die "a run in the capture is not at artifact A"
  if [ "$p" = "$M1_CI_VALIDATION_WORKFLOW_PATH" ] && [ "$nm" = "$M1_CI_VALIDATION_WORKFLOW_NAME" ]; then
    found="$idx"
  fi
  if [ "$p" = "$M1_CI_DEPLOY_WORKFLOW_PATH" ]; then
    # Present in the capture is fine. Counted as validation evidence is not.
    deploy_as_validation="NO"
  fi
  idx=$((idx + 1))
done
[ "$found" -ge 0 ] || m1_die "the capture holds no run of the fixed validating workflow identity at artifact A"

m1_record GITHUB_CI_HEAD_SHA_MATCHES_A "YES"
m1_record GITHUB_CI_WORKFLOW_PATH "$M1_CI_VALIDATION_WORKFLOW_PATH"
m1_record GITHUB_CI_WORKFLOW_NAME "$M1_CI_VALIDATION_WORKFLOW_NAME"
m1_record GITHUB_CI_RUN_ID "$(m1_json "$cap" get "runs//$found//id")"
m1_record GITHUB_CI_CONCLUSION "$(m1_json "$cap" get "runs//$found//conclusion")"
m1_record GITHUB_CI_DEPLOY_WORKFLOW_USED_AS_VALIDATION "$deploy_as_validation"

jn="$(m1_json "$cap" len "runs//$found//jobs")"
m1_record GITHUB_CI_JOB_COUNT "$jn"
[ "$jn" = "$M1_CI_REQUIRED_JOB_COUNT" ] || m1_die "the exact-head run does not carry the fixed job count"

j=0
conclusions=""
max_attempt=0
names=""
while [ "$j" -lt "$jn" ]; do
  c="$(m1_json "$cap" get "runs//$found//jobs//$j//conclusion")"
  a="$(m1_json "$cap" get "runs//$found//jobs//$j//run_attempt")"
  jname="$(m1_json "$cap" get "runs//$found//jobs//$j//name")"
  jhs="$(m1_json "$cap" get "runs//$found//jobs//$j//head_sha")"
  [ "$jhs" = "$M1_ARTIFACT" ] || m1_die "a job in the exact-head run is not at artifact A"
  case "$conclusions" in
    *"$c"*) ;;
    *) conclusions="${conclusions:+$conclusions+}$c" ;;
  esac
  if [ "$a" -gt "$max_attempt" ]; then max_attempt="$a"; fi
  names="${names:+$names|}$jname"
  j=$((j + 1))
done
m1_record GITHUB_CI_JOB_CONCLUSIONS "$conclusions"
m1_record GITHUB_CI_MAX_RUN_ATTEMPT "$max_attempt"

# The job set is part of the fixed identity too, compared as a sorted list.
sorted="$(printf '%s\n' "$names" | tr '|' '\n' | sort | tr '\n' '|' | sed 's/|$//')"
[ "$sorted" = "$M1_CI_REQUIRED_JOB_NAMES" ] || m1_die "the exact-head run's job identities do not match the fixed set"

m1_record GITHUB_CI_VALIDATION_STATUS "OK"
M1_H08_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 10 of 19 — helper 09: DB-ENABLED migration-state read
# -----------------------------------------------------------------------------
m1_emit "h09-migration-state-db.sh" <<'M1_H09_EOF'
#!/usr/bin/env bash
# helper 09 — the database-enabled migration-state read: D, P and all seven
# comparisons, against the DISPOSABLE database named by GCD_AUDIT_DATABASE_URL.
#
# The connection string is never printed, never recorded and never echoed. The
# script's own failure path emits a fixed category and no driver text.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

[ "$M1_DB_ENABLED" = "1" ] || { m1_record DB_ENABLED_MIGRATION_READ_STATUS "NOT_EXECUTED"; exit 0; }
[ "$(m1_get DEP_PG_RESOLVED)" = "YES" ] || m1_die "dependencies are not prepared"
[ -n "${GCD_AUDIT_DATABASE_URL:-}" ] || m1_die "M1_DB_ENABLED=1 but GCD_AUDIT_DATABASE_URL is not set"

# Declared by the operator, in a fixed shape, and never read off the wire: the
# packet asks the database nothing beyond the two read-only operator scripts.
sv="${M1_DB_SERVER_VERSION:-UNDECLARED}"
case "$sv" in
  UNDECLARED|[0-9]|[0-9][0-9]|[0-9][0-9].[0-9]|[0-9][0-9].[0-9][0-9]) ;;
  *) m1_die "M1_DB_SERVER_VERSION is not a plain PostgreSQL version" ;;
esac
m1_record DB_SERVER_VERSION "$sv"
m1_record DB_DISPOSABLE "DECLARED_BY_OPERATOR"

m1_collect op-migration-db m1_clone_run node scripts/ops/migration-state-read.mjs \
  --milestone M1 --artifact "$M1_ARTIFACT"

rc="$(m1_rc op-migration-db)"
out="$(m1_out_file op-migration-db)"

# exit 0 = all seven comparisons true; exit 1 = at least one false, with a full
# record on stdout. Both are RESULTS. Anything else is a failure to read.
case "$rc" in
  0|1) ;;
  *) m1_record DB_ENABLED_MIGRATION_READ_STATUS "FAILED"
     m1_die "the migration-state read could not complete (exit $rc)" ;;
esac
m1_json "$out" validate >/dev/null || m1_die "the migration-state read did not emit strict JSON"

decision="$(m1_json "$out" get decision)"
case "$decision" in
  pass) m1_record DB_ENABLED_MIGRATION_DECISION "PASS" ;;
  stop) m1_record DB_ENABLED_MIGRATION_DECISION "STOP" ;;
  *) m1_die "the migration-state read reported an unexpected decision class" ;;
esac

listify() { sed 's/[]["]//g; s/,/,/g' | tr -d ' '; }
failed="$(m1_json "$out" get failed_comparisons | listify)"
[ -n "$failed" ] || failed="NONE"
m1_record DB_ENABLED_MIGRATION_FAILED_COMPARISONS "$failed"
d_list="$(m1_json "$out" get D | listify)"; [ -n "$d_list" ] || d_list="EMPTY"
p_list="$(m1_json "$out" get P | listify)"; [ -n "$p_list" ] || p_list="EMPTY"
m1_record DB_ENABLED_MIGRATION_D "$d_list"
m1_record DB_ENABLED_MIGRATION_P "$p_list"
m1_record DB_ENABLED_MIGRATION_READ_STATUS "OK"
M1_H09_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 11 of 19 — helper 10: DB-ENABLED aggregate evidence audit
# -----------------------------------------------------------------------------
m1_emit "h10-evidence-audit-db.sh" <<'M1_H10_EOF'
#!/usr/bin/env bash
# helper 10 — the database-enabled, read-only, aggregate-only evidence audit.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

[ "$M1_DB_ENABLED" = "1" ] || { m1_record DB_ENABLED_AUDIT_STATUS "NOT_EXECUTED"; exit 0; }
[ "$(m1_get DEP_PG_RESOLVED)" = "YES" ] || m1_die "dependencies are not prepared"
[ -n "${GCD_AUDIT_DATABASE_URL:-}" ] || m1_die "M1_DB_ENABLED=1 but GCD_AUDIT_DATABASE_URL is not set"

m1_collect op-audit-db m1_clone_run node scripts/ops/evidence-aggregate-audit.mjs

rc="$(m1_rc op-audit-db)"
out="$(m1_out_file op-audit-db)"
case "$rc" in
  0|1) ;;
  *) m1_record DB_ENABLED_AUDIT_STATUS "FAILED"
     m1_die "the aggregate audit could not complete (exit $rc)" ;;
esac
m1_json "$out" validate >/dev/null || m1_die "the aggregate audit did not emit strict JSON"

verdict="$(m1_json "$out" get verdict 2>/dev/null || echo ABSENT)"
case "$verdict" in
  "WITHIN BOUNDS") m1_record DB_ENABLED_AUDIT_VERDICT "WITHIN BOUNDS" ;;
  "EXCEEDS BOUNDS") m1_record DB_ENABLED_AUDIT_VERDICT "EXCEEDS BOUNDS" ;;
  *) m1_die "the aggregate audit reported an unexpected verdict class" ;;
esac

count="$(m1_json "$out" len checks)"
m1_record DB_ENABLED_AUDIT_CHECK_COUNT "$count"

failing="$(m1_json "$out" get failing_checks | sed 's/[]["]//g')"
[ -n "$failing" ] || failing="NONE"
m1_record DB_ENABLED_AUDIT_FAILING_CHECKS "$failing"
m1_record DB_ENABLED_AUDIT_STATUS "OK"
M1_H10_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 12 of 19 — helper 11: regression group 1
# -----------------------------------------------------------------------------
m1_emit "h11-regression-bounded-collection.sh" <<'M1_H11_EOF'
#!/usr/bin/env bash
# Regression group 1 — bounded collection WITHOUT constraining Git files.
#
# The defect this guards: bounding output with a file-size rlimit (`ulimit -f`)
# bounds every file the process writes, Git's own object, pack and checkout
# writes included. A collector that does that silently corrupts the artifact it
# is supposed to be observing.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

fail() { m1_record REGRESSION_G1_BOUNDED_COLLECTION "FAIL"; m1_die "regression group 1: $*"; }

big="$M1_STATE/g1-big.bin"
head -c 3145728 /dev/zero | tr '\0' 'x' > "$big"
[ "$(wc -c < "$big" | tr -d ' ')" = "3145728" ] || fail "could not stage a 3 MiB input"

# A collected command that writes a 3 MiB FILE and emits 3 MiB of OUTPUT.
m1_collect g1-mixed bash -c '
  set -e
  cp "$1" "$2"
  cat "$1"
' _ "$big" "$M1_STATE/g1-written.bin"

[ "$(m1_rc g1-mixed)" = "0" ] || fail "the collected command did not succeed"
[ "$(wc -c < "$M1_STATE/g1-written.bin" | tr -d ' ')" = "3145728" ] || fail "a 3 MiB file written under collection was truncated"
[ "$(m1_out_bytes g1-mixed)" = "1048576" ] || fail "the captured stream was not bounded at 1 MiB"

# Git itself must be able to write an object larger than the stream bound while
# collection is active.
m1_collect g1-git-write bash -c 'cd "$1" && git hash-object -w "$2"' _ "$M1_CLONE" "$big"
[ "$(m1_rc g1-git-write)" = "0" ] || fail "git could not write a 3 MiB object under collection"
oid="$(head -c 40 "$(m1_out_file g1-git-write)")"
sz="$(git -C "$M1_CLONE" cat-file -s "$oid")"
[ "$sz" = "3145728" ] || fail "the Git object written under collection is $sz bytes, not 3145728"

# And no file-size rlimit is in force anywhere in the collector.
lim="$(m1_collect g1-ulimit bash -c 'ulimit -f' >/dev/null 2>&1; head -c 32 "$(m1_out_file g1-ulimit)" | tr -d ' \n')"
[ "$lim" = "unlimited" ] || fail "a file-size rlimit ($lim) is in force during collection"

rm -f "$big" "$M1_STATE/g1-written.bin"
m1_record REGRESSION_G1_BOUNDED_COLLECTION "PASS"
M1_H11_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 13 of 19 — helper 12: regression group 2
# -----------------------------------------------------------------------------
m1_emit "h12-regression-stream-limit.sh" <<'M1_H12_EOF'
#!/usr/bin/env bash
# Regression group 2 — the immutable 1 MiB stream limit.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

fail() { m1_record REGRESSION_G2_STREAM_LIMIT "FAIL"; m1_die "regression group 2: $*"; }

# a. the value is exactly 1 MiB
[ "$M1_STREAM_LIMIT_BYTES" = "1048576" ] || fail "the limit is $M1_STREAM_LIMIT_BYTES"

# b. it is readonly — a reassignment cannot succeed
if bash -c '. "$M1_BIN/m1-env.sh"; M1_STREAM_LIMIT_BYTES=7' >/dev/null 2>&1; then fail "the limit could be reassigned"; fi

# c. an inherited environment value does not win
# `env` is used rather than an assignment prefix: the name is readonly in THIS
# shell, and a prefix assignment would be refused here and never reach the
# child — which would make the test pass without ever testing anything.
v="$(env M1_STREAM_LIMIT_BYTES=7 bash -c '. "$M1_BIN/m1-env.sh"; printf %s "$M1_STREAM_LIMIT_BYTES"')"
[ "$v" = "1048576" ] || fail "an environment value overrode the limit ($v)"

# d. the bound is exact: one byte over is captured as exactly 1 MiB, with the
#    overflow counted rather than lost silently
m1_collect g2-exact bash -c 'head -c 1048577 /dev/zero | tr "\0" "y"'
[ "$(m1_out_bytes g2-exact)" = "1048576" ] || fail "capture was $(m1_out_bytes g2-exact) bytes"
[ "$(cat "$M1_STREAM_DIR/g2-exact.out.overflow")" = "1" ] || fail "the overflow byte was not counted"
[ "$(m1_truncated g2-exact)" = "YES" ] || fail "truncation was not reported"

# e. under the bound, nothing is touched
m1_collect g2-under bash -c 'head -c 1024 /dev/zero | tr "\0" "z"'
[ "$(m1_out_bytes g2-under)" = "1024" ] || fail "a small stream was altered"
[ "$(m1_truncated g2-under)" = "NO" ] || fail "a small stream was reported truncated"

# f. stderr is bounded on its own, independently of stdout
m1_collect g2-err bash -c 'head -c 2097152 /dev/zero | tr "\0" "e" >&2'
[ "$(m1_err_bytes g2-err)" = "1048576" ] || fail "stderr was not bounded at 1 MiB"

# g. the producer is never killed by the bound — its own exit status survives
m1_collect g2-exit bash -c 'head -c 3145728 /dev/zero | tr "\0" "q"; exit 42'
[ "$(m1_rc g2-exit)" = "42" ] || fail "the producer's exit status was lost (got $(m1_rc g2-exit))"

m1_record REGRESSION_G2_STREAM_LIMIT "PASS"
M1_H12_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 14 of 19 — helper 13: regression group 3
# -----------------------------------------------------------------------------
m1_emit "h13-regression-strict-json.sh" <<'M1_H13_EOF'
#!/usr/bin/env bash
# Regression group 3 — strict decoded-key JSON handling.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

fail() { m1_record REGRESSION_G3_STRICT_JSON "FAIL"; m1_die "regression group 3: $*"; }

d="$M1_STATE/g3"; rm -rf "$d"; mkdir -p "$d"
q='"'
reject() {
  local name="$1" body="$2"
  printf '%s' "$body" > "$d/$name.json"
  if m1_json "$d/$name.json" validate >/dev/null 2>&1; then fail "$name was accepted"; fi
}
accept_get() {
  local name="$1" body="$2" sel="$3" want="$4" got
  printf '%s' "$body" > "$d/$name.json"
  got="$(m1_json "$d/$name.json" get "$sel" 2>/dev/null || true)"
  [ "$got" = "$want" ] || fail "$name: expected $want, got $got"
}

# The defect: a duplicate key survives JSON.parse, which silently keeps the
# last one — and an escaped spelling of the same key is not even visibly a
# duplicate until it has been DECODED.
# BS holds one backslash, so the escaped spellings below are built here rather
# than written as literals that some intermediate tool might decode on the way in.
BS='\'
reject dup_plain    '{"decision":"stop","decision":"pass"}'
reject dup_escaped  "{${q}decision${q}:${q}stop${q},${q}${BS}u0064ecision${q}:${q}pass${q}}"
reject dup_nested   "{${q}comparisons${q}:{${q}a${q}:true,${q}${BS}u0061${q}:false}}"
reject proto_key    '{"__proto__":{"decision":"pass"}}'
reject ctor_key     '{"constructor":1}'
reject proto_name   '{"prototype":1}'
reject trailing     '{"decision":"pass"} {"decision":"stop"}'
reject lone_high    '{"a":"\ud800"}'
reject lone_low     '{"a":"\udc00"}'
reject bad_escape   '{"a":"\x41"}'
reject leading_zero '{"a":01}'
reject nan_value    '{"a":NaN}'
reject single_quote "{'a':1}"
reject bare_key     '{a:1}'

# And an escaped key that is NOT a duplicate must still be found by its
# decoded name, not by its raw spelling.
accept_get decoded_key  "{${q}${BS}u0064ecision${q}:${q}pass${q}}" 'decision' 'pass'
accept_get nested_ok    '{"comparisons":{"1_F(A)==E_files":true}}' 'comparisons//1_F(A)==E_files' 'true'
accept_get array_index  '{"checks":[{"check":"id chars"},{"check":"tag NULL elements"}]}' 'checks//1//check' 'tag NULL elements'

printf '%s' '{"checks":[1,2,3]}' > "$d/len.json"
[ "$(m1_json "$d/len.json" len checks)" = "3" ] || fail "array length was misread"

# A raw control character inside a string is not JSON.
printf '{"a":"b\tc"}' > "$d/rawctl.json"
if m1_json "$d/rawctl.json" validate >/dev/null 2>&1; then fail "a raw control character was accepted"; fi

rm -rf "$d"
m1_record REGRESSION_G3_STRICT_JSON "PASS"
M1_H13_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 15 of 19 — helper 14: regression group 4, part A
# -----------------------------------------------------------------------------
m1_emit "h14-regression-migration-contract.sh" <<'M1_H14_EOF'
#!/usr/bin/env bash
# Regression group 4 (migration half) — the expected sets are RECOMPUTED from
# artifact A and compared with what the operator script declares. Nothing here
# is copied from the script and then checked against itself.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

fail() { m1_record REGRESSION_G4_CONTRACTS "FAIL"; m1_die "regression group 4: $*"; }

# F(A), recomputed independently: NUL-delimited, never trimmed, basenames only,
# `.sql` only — the rule src/state/migrate.ts itself applies.
recomputed="$(git -C "$M1_CLONE" ls-tree -z --name-only "$M1_ARTIFACT" state/migrations/ \
  | tr '\0' '\n' | sed 's|.*/||' | grep '\.sql$' | LC_ALL=C sort | tr '\n' ',' | sed 's/,$//')"
[ -n "$recomputed" ] || fail "artifact A carries no migration files"

declared="$(node -e '
const fs=require("fs");
const s=fs.readFileSync(process.argv[1],"utf8");
const m=/const CANONICAL\s*=\s*\[([\s\S]*?)\]/.exec(s);
if(!m){process.stderr.write("no CANONICAL");process.exit(3);}
const names=[...m[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
process.stdout.write(names.slice().sort().join(","));
' "$M1_CLONE/scripts/ops/migration-state-read.mjs")"

[ "$declared" = "$recomputed" ] || fail "the declared canonical set does not equal the recomputed F(A)"

pending="$(node -e '
const fs=require("fs");
const s=fs.readFileSync(process.argv[1],"utf8");
const m=/pending:\s*\[([^\]]*)\]/.exec(s);
if(!m){process.stderr.write("no pending");process.exit(3);}
process.stdout.write([...m[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]).join(","));
' "$M1_CLONE/scripts/ops/migration-state-read.mjs")"

# E_applied_pre must be exactly F(A) minus the single pending migration, and
# E_pending exactly that migration — recomputed here, not read from the script.
expected_pre="$(printf '%s' "$recomputed" | tr ',' '\n' | grep -v "^$pending\$" | tr '\n' ',' | sed 's/,$//')"
[ "$pending" = "007_evidence_bounds.sql" ] || fail "the pending set is not exactly migration 007 by filename"
case ",$recomputed," in
  *",$pending,"*) ;;
  *) fail "the pending migration is not present in artifact A" ;;
esac
[ "$(printf '%s' "$expected_pre" | tr ',' '\n' | grep -c .)" = "6" ] || fail "the recomputed applied-baseline is not six files"

# Identity is the COMPLETE FILENAME. A numeric-prefix projection must not exist
# anywhere in the script: it is what let 007_anything_else.sql read as expected.
if grep -qE 'idOf|slice\(0, *3\)|substring\(0, *3\)' "$M1_CLONE/scripts/ops/migration-state-read.mjs"; then
  fail "a numeric-prefix projection is present in the migration-state script"
fi

m1_record CONTRACT_MIGRATION_EXPECTED_FILES "$(printf '%s' "$recomputed" | tr ',' '\n' | grep -c .)"
m1_record CONTRACT_MIGRATION_EXPECTED_PENDING "$pending"
printf 'PASS\n' > "$M1_STATE/g4-migration.status"
M1_H14_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 16 of 19 — helper 15: regression group 4, part B
# -----------------------------------------------------------------------------
m1_emit "h15-regression-audit-contract.sh" <<'M1_H15_EOF'
#!/usr/bin/env bash
# Regression group 4 (audit half) — the 23-check audit contract, recomputed.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

fail() { m1_record REGRESSION_G4_CONTRACTS "FAIL"; m1_die "regression group 4: $*"; }

read -r tabled pushed limits <<EOF
$(node -e '
const fs=require("fs");
const src=fs.readFileSync(process.argv[1],"utf8");
const m=/const checks\s*=\s*\[([\s\S]*?)\]\.map\(/.exec(src);
if(!m){process.stderr.write("no checks table");process.exit(3);}
const rows=[...m[1].matchAll(/\[\s*"([^"]+)"\s*,/g)].map(x=>x[1]);
const pushed=[...src.matchAll(/checks\.push\(\{/g)].length;
const limitSrc=fs.readFileSync(process.argv[2],"utf8");
const lm=/export const EVIDENCE_LIMITS\s*=\s*\{([\s\S]*?)\n\}/.exec(limitSrc);
if(!lm){process.stderr.write("no EVIDENCE_LIMITS");process.exit(3);}
const keys=new Set([...lm[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(x=>x[1]));
const referenced=[...m[1].matchAll(/LIMITS\.([A-Za-z0-9_]+)/g)].map(x=>x[1]);
for(const r of referenced){ if(!keys.has(r)){ process.stderr.write("unknown limit "+r); process.exit(3);} }
process.stdout.write(rows.length+" "+pushed+" "+referenced.length);
' "$M1_CLONE/scripts/ops/evidence-aggregate-audit.mjs" "$M1_CLONE/src/harness/agents/payloadContract.ts")
EOF

[ -n "$tabled" ] || fail "the audit check table could not be recomputed"
total=$((tabled + pushed))
[ "$total" = "23" ] || fail "the audit contract recomputes to $total checks, not 23"
[ "$limits" -ge 1 ] || fail "no bound is read from the payload-contract authority"

# Bounds must come from the single authority, never be restated in the script.
grep -q 'payloadContract.ts' "$M1_CLONE/scripts/ops/evidence-aggregate-audit.mjs" \
  || fail "the audit script does not read its bounds from payloadContract.ts"

m1_record CONTRACT_AUDIT_CHECK_COUNT_RECOMPUTED "$total"

# When the audit actually ran, its emitted check count must equal the
# recomputed contract. A contract that only agrees with itself proves nothing.
if [ "$(m1_get DB_ENABLED_AUDIT_STATUS)" = "OK" ]; then
  [ "$(m1_get DB_ENABLED_AUDIT_CHECK_COUNT)" = "23" ] \
    || fail "the executed audit emitted $(m1_get DB_ENABLED_AUDIT_CHECK_COUNT) checks, not 23"
fi

[ "$(cat "$M1_STATE/g4-migration.status" 2>/dev/null || echo MISSING)" = "PASS" ] \
  || fail "the migration half of group 4 did not pass"
m1_record REGRESSION_G4_CONTRACTS "PASS"
M1_H15_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 17 of 19 — helper 16: regression group 5
# -----------------------------------------------------------------------------
m1_emit "h16-regression-ci-identity.sh" <<'M1_H16_EOF'
#!/usr/bin/env bash
# Regression group 5 — the immutable exact-head CI workflow identity.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

fail() { m1_record REGRESSION_G5_CI_IDENTITY "FAIL"; m1_die "regression group 5: $*"; }

# a. the identity constants cannot be reassigned, and an environment value
#    cannot displace them
for c in M1_CI_VALIDATION_WORKFLOW_PATH M1_CI_VALIDATION_WORKFLOW_NAME M1_CI_REQUIRED_JOB_NAMES; do
  if bash -c ". \"\$M1_BIN/m1-env.sh\"; $c=x" >/dev/null 2>&1; then fail "$c was reassignable"; fi
done
v="$(env M1_CI_VALIDATION_WORKFLOW_PATH=/tmp/evil.yml bash -c '. "$M1_BIN/m1-env.sh"; printf %s "$M1_CI_VALIDATION_WORKFLOW_PATH"')"
[ "$v" = ".github/workflows/ci.yml" ] || fail "an environment value displaced the workflow identity"

# b. artifact A carries exactly the two fixed workflow files, and the
#    validating one declares the fixed name
present="$(git -C "$M1_CLONE" ls-tree -z --name-only "$M1_ARTIFACT" .github/workflows/ \
  | tr '\0' '\n' | grep -v '^$' | LC_ALL=C sort | tr '\n' '|' | sed 's/|$//')"
expected="$(printf '%s\n%s\n' "$M1_CI_VALIDATION_WORKFLOW_PATH" "$M1_CI_DEPLOY_WORKFLOW_PATH" | LC_ALL=C sort | tr '\n' '|' | sed 's/|$//')"
[ "$present" = "$expected" ] || fail "artifact A's workflow set is not the fixed identity"

got_name="$(git -C "$M1_CLONE" show "$M1_ARTIFACT:$M1_CI_VALIDATION_WORKFLOW_PATH" | sed -n 's/^name: *//p' | head -n 1)"
[ "$got_name" = "$M1_CI_VALIDATION_WORKFLOW_NAME" ] || fail "the validating workflow at A is named $got_name"
got_deploy="$(git -C "$M1_CLONE" show "$M1_ARTIFACT:$M1_CI_DEPLOY_WORKFLOW_PATH" | sed -n 's/^name: *//p' | head -n 1)"
[ "$got_deploy" = "$M1_CI_DEPLOY_WORKFLOW_NAME" ] || fail "the deploy workflow at A is named $got_deploy"

# c. if a capture was validated, the identity recorded is the FIXED one — the
#    proof that the capture was compared against, not adopted as, the identity
if [ "$(m1_get GITHUB_CI_VALIDATION_STATUS)" = "OK" ]; then
  [ "$(m1_get GITHUB_CI_WORKFLOW_PATH)" = "$M1_CI_VALIDATION_WORKFLOW_PATH" ] || fail "a capture displaced the recorded workflow path"
  [ "$(m1_get GITHUB_CI_HEAD_SHA_MATCHES_A)" = "YES" ] || fail "the validated run is not at artifact A"
  [ "$(m1_get GITHUB_CI_DEPLOY_WORKFLOW_USED_AS_VALIDATION)" = "NO" ] || fail "the deploy workflow was counted as validation"
fi

m1_record CI_WORKFLOW_IDENTITY_IMMUTABLE "YES"
m1_record REGRESSION_G5_CI_IDENTITY "PASS"
M1_H16_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 18 of 19 — helper 17: cleanup of the isolated tree
# -----------------------------------------------------------------------------
m1_emit "h17-cleanup-isolated-tree.sh" <<'M1_H17_EOF'
#!/usr/bin/env bash
# helper 17 — remove the isolated clone and, with it, the isolated dependency
# tree and the isolated npm cache. The evidence report and the return form live
# outside the work directory and are preserved.
#
# This runs on every exit path, including a failed dependency preparation.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

if [ -d "$M1_CLONE" ]; then
  had_deps="YES"
  [ -e "$M1_CLONE/node_modules" ] || had_deps="ABSENT"
  rm -rf "$M1_CLONE"
  if [ -e "$M1_CLONE" ]; then
    m1_record CLEANUP_ISOLATED_CLONE "NOT_REMOVED"
    m1_record CLEANUP_DEPENDENCY_TREE "NOT_REMOVED"
  else
    m1_record CLEANUP_ISOLATED_CLONE "REMOVED"
    case "$had_deps" in
      YES) m1_record CLEANUP_DEPENDENCY_TREE "REMOVED_WITH_CLONE" ;;
      *)   m1_record CLEANUP_DEPENDENCY_TREE "NONE_TO_REMOVE" ;;
    esac
  fi
else
  m1_record CLEANUP_ISOLATED_CLONE "NONE_TO_REMOVE"
  m1_record CLEANUP_DEPENDENCY_TREE "NONE_TO_REMOVE"
fi

if [ -d "$M1_DEPS_CACHE" ]; then
  rm -rf "$M1_DEPS_CACHE"
  if [ -e "$M1_DEPS_CACHE" ]; then m1_record CLEANUP_NPM_CACHE "NOT_REMOVED"; else m1_record CLEANUP_NPM_CACHE "REMOVED"; fi
else
  m1_record CLEANUP_NPM_CACHE "NONE_TO_REMOVE"
fi

m1_record CLEANUP_EVIDENCE_REPORT "PRESERVED"
M1_H17_EOF

# -----------------------------------------------------------------------------
# GENERATED FILE 19 of 19 — helper 18: the return form and the evidence report
# -----------------------------------------------------------------------------
m1_emit "h18-emit-return-form.sh" <<'M1_H18_EOF'
#!/usr/bin/env bash
# helper 18 — write RETURN_FORM.txt and EVIDENCE_REPORT.txt.
#
# RETURN_FORM.txt carries APPROVED FIXED FIELDS ONLY. Every line is KEY=VALUE
# with a key from the approved list and a value already constrained to the
# approved character set by m1_record. An approved field nothing recorded is
# emitted as NOT_RECORDED rather than omitted, so a missing step is visible
# instead of invisible. No text from npm, from a database driver, from a CI
# capture, or from any other runtime source reaches this file.
set -euo pipefail
. "$M1_BIN/m1-env.sh"

form="$M1_OUT/RETURN_FORM.txt"
report="$M1_OUT/EVIDENCE_REPORT.txt"

{
  echo "# M1 OPERATOR PACKET — RETURN FORM"
  echo "# Approved fixed fields only. KEY=VALUE, one per line."
  echo "# This form records what was executed. It authorizes nothing."
  echo
  for key in $(echo $M1_APPROVED_FIELDS); do
    v="$(m1_get "$key")"
    [ -n "$v" ] || v="NOT_RECORDED"
    printf '%s=%s\n' "$key" "$v"
  done
} > "$form"

# Every emitted line must still be an approved KEY=VALUE. A form that drifted
# is not shipped.
bad="$(grep -v '^#' "$form" | grep -v '^$' | grep -vE '^[A-Z0-9_]+=' || true)"
[ -z "$bad" ] || m1_die "the return form carries a line that is not KEY=VALUE"

{
  echo "M1 OPERATOR PACKET — EVIDENCE REPORT"
  echo
  echo "PACKET"
  printf '  sha256 %s\n' "$M1_PACKET_SHA256"
  printf '  bytes  %s\n' "$M1_PACKET_BYTES"
  printf '  run    %s\n' "$M1_RUN_ID"
  printf '  mode   %s\n' "$(m1_get RUN_MODE)"
  echo
  echo "GENERATED FILE INVENTORY (sha256, bytes, name)"
  sed 's/^/  /' "$M1_STATE/inventory.txt"
  echo
  echo "DEPENDENCY PREPARATION"
  printf '  status            %s\n' "$(m1_get DEP_PREP_STATUS)"
  printf '  command           %s\n' "$(m1_get DEP_PREP_COMMAND)"
  printf '  scope             %s\n' "$(m1_get DEP_PREP_SCOPE)"
  printf '  node              %s\n' "$(m1_get DEP_NODE_VERSION)"
  printf '  npm               %s\n' "$(m1_get DEP_NPM_VERSION)"
  printf '  lockfile sha256   %s\n' "$(m1_get DEP_LOCKFILE_SHA256)"
  printf '  lockfile modified %s\n' "$(m1_get DEP_LOCKFILE_MODIFIED)"
  printf '  pg resolved       %s %s\n' "$(m1_get DEP_PG_RESOLVED)" "$(m1_get DEP_PG_VERSION)"
  printf '  packages added    %s\n' "$(m1_get DEP_PACKAGES_ADDED)"
  printf '  sanitized names   %s\n' "$(m1_get ENV_SANITIZED_NAMES)"
  printf '  rejected names    %s\n' "$(m1_get ENV_REJECTED_NAMES)"
  echo
  echo "CAPTURED STREAMS (slug, stdout bytes, stderr bytes, exit, truncated)"
  for rcf in "$M1_STREAM_DIR"/*.rc; do
    [ -f "$rcf" ] || continue
    s="$(basename "$rcf" .rc)"
    printf '  %-22s %10s %10s %5s %s\n' "$s" "$(m1_out_bytes "$s")" "$(m1_err_bytes "$s")" "$(m1_rc "$s")" "$(m1_truncated "$s")"
  done
  echo
  echo "NON-ACTIONS (fixed)"
  echo "  No Render execution and no Render control-plane contact."
  echo "  No production access and no production credential."
  echo "  No migration was applied. No deployment was triggered."
  echo "  No executor was enabled. No rollback compatibility test was executed."
  echo "  The primary checkout was read as a Git object store and not written to."
  echo "  No operator script was executed from the primary checkout."
  echo "  No node_modules was copied or reused from the primary checkout."
  echo
  echo "STANDING VERDICT (fixed, preserved)"
  printf '  %s\n' "$M1_FIXED_DECISION"
  printf '  migration 007 production state: %s\n' "$M1_FIXED_MIGRATION_007"
  printf '  Render: %s\n' "$M1_FIXED_RENDER_CONNECTION"
  printf '  service identities: %s\n' "$M1_FIXED_SERVICE_IDENTITIES"
  printf '  rollback compatibility: %s\n' "$M1_FIXED_ROLLBACK"
  printf '  executors: %s\n' "$M1_FIXED_EXECUTORS"
  echo
  echo "SCOPE OF THIS RUN (fixed)"
  echo "  $M1_FIXED_END_TO_END"
  echo "  The DB-disabled path validates the artifact half of the migration"
  echo "  state and the exact-head CI identity. It reads no database."
  echo "  The database-enabled path reads D, P and the seven comparisons and"
  echo "  runs the aggregate audit against a DISPOSABLE database only."
} > "$report"

chmod 0444 "$form" "$report"
M1_H18_EOF

# =============================================================================
# ORCHESTRATION
# =============================================================================
#
# One ordered sequence. The dependency step is step 5 — after the isolated
# clone is bound and verified, before any operator script. Nothing downstream
# of it can run without it, and nothing about it is left to the operator.

generated="$(wc -l < "$M1_INVENTORY" | tr -d ' ')"
[ "$generated" = "19" ] || { echo "FATAL: expected 19 generated files, wrote $generated" >&2; exit 1; }

# shellcheck source=/dev/null
. "$M1_BIN/m1-env.sh"
m1_record GENERATED_FILE_COUNT "$generated"

M1_SEQUENCE="
h01-preflight.sh
h02-sanitize-environment.sh
h03-bind-isolated-clone.sh
h04-verify-isolated-clone.sh
h05-prepare-dependencies.sh
h06-verify-pg-resolution.sh
h07-migration-state-offline.sh
h08-github-exact-head-ci.sh
h09-migration-state-db.sh
h10-evidence-audit-db.sh
h11-regression-bounded-collection.sh
h12-regression-stream-limit.sh
h13-regression-strict-json.sh
h14-regression-migration-contract.sh
h15-regression-audit-contract.sh
h16-regression-ci-identity.sh
"

sequence_rc=0
failed_at="NONE"
set +e
for h in $M1_SEQUENCE; do
  m1_note "$h"
  bash "$M1_BIN/$h"
  rc=$?
  if [ "$rc" != "0" ]; then
    sequence_rc=1
    failed_at="$h"
    m1_note "STOPPED at $h (exit $rc)"
    break
  fi
done

# Cleanup and reporting run on every path, including a failed dependency step.
bash "$M1_BIN/h17-cleanup-isolated-tree.sh"
bash "$M1_BIN/h18-emit-return-form.sh"
set -e

# The work directory goes; the evidence directory stays.
if [ "$M1_KEEP_WORKDIR" != "1" ]; then
  chmod -R u+w "$M1_WORK" 2>/dev/null || true
  rm -rf "$M1_WORK"
fi

echo
echo "M1 operator packet finished."
echo "  sequence:        $([ "$sequence_rc" = "0" ] && echo COMPLETE || echo "STOPPED at $failed_at")"
echo "  return form:     $M1_OUT/RETURN_FORM.txt"
echo "  evidence report: $M1_OUT/EVIDENCE_REPORT.txt"
echo
echo "M1 BLOCKED / NO-GO. This run authorized nothing, deployed nothing,"
echo "applied no migration, contacted no Render control plane, and used no"
echo "production credential."
exit "$sequence_rc"
