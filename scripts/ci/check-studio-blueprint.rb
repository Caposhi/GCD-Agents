# frozen_string_literal: true

# Content Studio S8's static check over the two Render Blueprint files
# (docs/CONTENT_STUDIO_DESIGN.md §3.2, §3.4, §3.5, §3.6, §9.5), with S6b's
# provider-key rule and S8.1's database-storage rule.
#
# render.yaml declares the live services and is never changed by a Studio PR;
# render.studio.yaml declares the Content Studio and nothing else. This check
# fails unless:
#
#   - render.yaml names no Content Studio resource (gcd-studio-*, gcd_studio).
#     Permanent: it never blocks a later live change, only a Studio leak;
#   - render.studio.yaml names no live resource (gcd-social-*, gcd_social);
#   - no gcd-studio-* block names a forbidden variable: design §3.2's list
#     (held equal to FORBIDDEN_VARIABLES and FORBIDDEN_PREFIXES in
#     src/studio/db/runner.ts, which both Studio services refuse at start)
#     and any IG_, FB_ or GBP_ name;
#   - ANTHROPIC_API_KEY (Content Studio S6b) appears only on gcd-studio-worker,
#     and only as sync: false: on any other block, with a literal value, or
#     without sync: false, it fails (the web refuses the key at start in every
#     phase; the worker's value is entered only in Render, at O4);
#   - every fromDatabase in a Studio block is gcd-studio-db, and every
#     fromService or fromGroup names a Studio resource this file declares;
#   - no gcd-social-* block references gcd-studio-db (or any Studio resource);
#   - every Studio service sets autoDeployTrigger to the STRING "off" (an
#     unquoted off is a YAML 1.1 boolean false, and an omitted field means
#     auto-deploy on), and no autoDeploy key appears anywhere in the file;
#   - gcd-studio-db sets ipAllowList: [] and databaseName: gcd_studio;
#   - gcd-studio-db sets diskSizeGB to exactly the integer 5 (Content Studio
#     S8.1; the owner-approved size for O3). Omitted, Render gives a new
#     Basic-tier database 15 GB, and a disk size can be increased but never
#     decreased (render.com/docs/blueprint-spec, read 2026-10-09);
#   - no cron resource exists (gcd-studio-cron is S9's, never declared here),
#     and the file declares exactly gcd-studio-db, gcd-studio-web (web) and
#     gcd-studio-worker (worker), under databases and services only;
#   - no envVar gives a secret-class name a literal value: those names must be
#     sync: false, and STUDIO_DATABASE_URL must come from gcd-studio-db;
#   - both files are single, plain YAML documents: no alias, anchor merge or
#     duplicate key (Ruby's parser would silently keep the last duplicate);
#   - render.yaml's bytes equal its bytes at the comparison base. In CI that is
#     the pull request's base SHA on pull_request and the first parent of the
#     pushed commit on push; any other event, or a base that cannot be read,
#     FAILS -- the comparison is never skipped. Outside CI, pass --base REV.
#     A later, separately authorized change to render.yaml must amend this
#     rule in the same reviewed PR.
#
# After checking the real files it proves itself: it injects one fault per
# rule into those files' text (each fault's anchor must occur exactly once, so
# the self-test fails rather than passes vacuously if a file drifts) and
# requires each to be refused for its expected reason; it also requires a few
# controls to be accepted, and drives the comparison-base resolution through
# every refusal with a fake environment and a fake git.
#
# Run (CI):    ruby scripts/ci/check-studio-blueprint.rb
# Run (local): ruby scripts/ci/check-studio-blueprint.rb --base origin/main

require "json"
require "open3"
require "yaml"

class BlueprintError < StandardError; end

ROOT = File.expand_path("../..", __dir__)
LIVE_PATH = "render.yaml"
STUDIO_PATH = "render.studio.yaml"
RUNNER_PATH = "src/studio/db/runner.ts"

STUDIO_DB = "gcd-studio-db"
STUDIO_DATABASE_NAME = "gcd_studio"
# Content Studio S8.1: the database's disk size in GB, owner-approved for O3.
# Render: "This value must be either 1 or a multiple of 5"; "You can increase
# disk size, but you can't decrease it"; omitted, a new Basic-tier database
# gets 15 GB (render.com/docs/blueprint-spec, read 2026-10-09).
STUDIO_DISK_SIZE_GB = 5
STUDIO_PREFIX = "gcd-studio-"
LIVE_PREFIX = "gcd-social-"
# The resources render.studio.yaml declares, and their kinds: no more, no fewer.
EXPECTED_RESOURCES = { "gcd-studio-db" => "database", "gcd-studio-web" => "web", "gcd-studio-worker" => "worker" }.freeze
ALLOWED_TOP_LEVEL = %w[databases services].freeze

# Design §3.2: no Studio service carries any of these. Held equal to
# FORBIDDEN_VARIABLES and FORBIDDEN_PREFIXES in src/studio/db/runner.ts.
FORBIDDEN_NAMES = %w[
  DATABASE_URL CONSOLE_TOKEN GOOGLE_ACCESS_TOKEN GOOGLE_REFRESH_TOKEN GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET IMAGEGEN_API_KEY APPROVAL_CHANNEL_WEBHOOK AUTONOMY_PHASE PUBLIC_BASE_URL
  ACTIVE_PLATFORMS
].freeze
FORBIDDEN_PREFIXES = %w[IG_ FB_ GBP_].freeze
# Content Studio S6b (live-runner enablement): the provider key may be declared
# on the worker alone, and only as sync: false. (Until S6b no Studio block could
# name it at all.)
PROVIDER_KEY = "ANTHROPIC_API_KEY"
PROVIDER_KEY_SERVICE = "gcd-studio-worker"

# Names that must be `sync: false` (entered only in Render, never a literal).
SECRET_NAMES = %w[
  STUDIO_PUBLIC_ORIGIN STUDIO_GOOGLE_CLIENT_ID STUDIO_GOOGLE_CLIENT_SECRET
  STUDIO_BOOTSTRAP_OWNER_EMAIL STUDIO_MAX_DAILY_USD STUDIO_MAX_MONTHLY_USD
].freeze
SECRET_PATTERN = /SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|API_KEY|WEBHOOK/
DATABASE_URL_NAME = "STUDIO_DATABASE_URL"

# --- parsing ---------------------------------------------------------------

def duplicate_keys(node, path, found)
  if node.is_a?(Psych::Nodes::Mapping)
    seen = {}
    node.children.each_slice(2) do |key, value|
      if key.is_a?(Psych::Nodes::Scalar)
        found << "#{path}/#{key.value}" if seen.key?(key.value)
        seen[key.value] = true
        duplicate_keys(value, "#{path}/#{key.value}", found)
      else
        duplicate_keys(value, path, found)
      end
    end
  elsif node.respond_to?(:children) && node.children
    node.children.each_with_index { |child, index| duplicate_keys(child, node.is_a?(Psych::Nodes::Sequence) ? "#{path}[#{index}]" : path, found) }
  end
end

# The parsed document, or nil with the reason appended to problems.
def parse_blueprint(text, label, problems)
  stream = Psych.parse_stream(text)
  if stream.children.length != 1
    problems << "#{label} holds #{stream.children.length} YAML documents, not one"
    return nil
  end
  dupes = []
  duplicate_keys(stream, "", dupes)
  problems << "#{label} repeats a key (#{dupes.join(", ")}): a parser keeps one silently" unless dupes.empty?
  doc = YAML.safe_load(text, aliases: false)
  unless doc.is_a?(Hash)
    problems << "#{label} is not a mapping"
    return nil
  end
  doc
rescue Psych::Exception => e
  problems << "#{label} is not plain YAML (#{e.class.name.split("::").last}): aliases and non-plain values are refused"
  nil
end

# --- helpers over parsed blocks ---------------------------------------------

# Every named block under a top-level list: [section, block].
def blocks(doc)
  doc.flat_map do |section, entries|
    entries.is_a?(Array) ? entries.select { |entry| entry.is_a?(Hash) }.map { |entry| [section, entry] } : []
  end
end

# Every reference inside node: [kind, target name].
def references(node, out = [])
  case node
  when Hash
    node.each do |key, value|
      if %w[fromDatabase fromService].include?(key)
        out << [key, value.is_a?(Hash) ? value["name"].to_s : value.to_s]
      elsif key == "fromGroup"
        out << [key, value.is_a?(Hash) ? value["name"].to_s : value.to_s]
      end
      references(value, out)
    end
  when Array
    node.each { |value| references(value, out) }
  end
  out
end

# Every envVar-like entry inside node (a mapping with a "key").
def env_entries(node, out = [])
  case node
  when Hash
    out << node if node.key?("key")
    node.each_value { |value| env_entries(value, out) }
  when Array
    node.each { |value| env_entries(value, out) }
  end
  out
end

def any_key?(node, wanted)
  case node
  when Hash then node.key?(wanted) || node.each_value.any? { |value| any_key?(value, wanted) }
  when Array then node.any? { |value| any_key?(value, wanted) }
  else false
  end
end

def forbidden?(name)
  FORBIDDEN_NAMES.include?(name) || FORBIDDEN_PREFIXES.any? { |prefix| name.start_with?(prefix) }
end

# S6b: the provider key's own rule, beside the generic secret rule (which also
# applies, because the name matches SECRET_PATTERN).
def provider_key_problems(name, entry)
  return [] unless entry["key"].to_s == PROVIDER_KEY
  return ["#{name} names #{PROVIDER_KEY}, which only #{PROVIDER_KEY_SERVICE} may carry"] unless name == PROVIDER_KEY_SERVICE

  problems = []
  if entry.key?("value") || entry.key?("generateValue")
    problems << "#{name}'s #{PROVIDER_KEY} has a literal value; it is entered only in Render (sync: false)"
  end
  problems << "#{name}'s #{PROVIDER_KEY} is not sync: false" unless entry["sync"] == false
  problems
end

def secret_class?(name)
  SECRET_NAMES.include?(name) || name.match?(SECRET_PATTERN)
end

# --- the rules -------------------------------------------------------------

def runner_parity_problems(runner_text)
  lists = { "FORBIDDEN_VARIABLES" => FORBIDDEN_NAMES, "FORBIDDEN_PREFIXES" => FORBIDDEN_PREFIXES }
  lists.filter_map do |constant, ours|
    match = /export const #{constant} = \[(.*?)\] as const;/m.match(runner_text)
    next "cannot read #{constant} from #{RUNNER_PATH}" unless match

    theirs = match[1].scan(/"([^"]*)"/).flatten
    next if theirs.sort == ours.sort

    "the forbidden list differs from #{RUNNER_PATH}'s #{constant}: only here #{(ours - theirs).inspect}, only there #{(theirs - ours).inspect}"
  end
end

def live_problems(live_text, live)
  problems = []
  problems << "#{LIVE_PATH} names a Content Studio resource (gcd-studio-* or gcd_studio)" if live_text.match?(/gcd[-_]studio/i)
  return problems unless live

  blocks(live).each do |_, block|
    name = block["name"].to_s
    problems << "#{LIVE_PATH} declares #{name}, a Studio resource" if name.start_with?(STUDIO_PREFIX)
    next unless name.start_with?(LIVE_PREFIX)

    references(block).each do |kind, target|
      problems << "#{name} references #{target} (#{kind}): a live block references a Studio resource" if target.start_with?(STUDIO_PREFIX)
    end
  end
  problems
end

def auto_deploy_problems(name, block)
  return ["#{name} omits autoDeployTrigger (Render then uses commit: auto-deploy ON)"] unless block.key?("autoDeployTrigger")

  value = block["autoDeployTrigger"]
  return [] if value.is_a?(String) && value == "off"
  return ["#{name}'s autoDeployTrigger is the boolean false (an unquoted off), not the string 'off'"] if value == false

  ["#{name}'s autoDeployTrigger is #{value.inspect}, not the string 'off'"]
end

def env_problems(name, block, declared)
  problems = []
  env_entries(block).each do |entry|
    key = entry["key"].to_s
    problems << "#{name} names forbidden variable #{key}" if forbidden?(key)
    problems.concat(provider_key_problems(name, entry))
    literal = entry.key?("value") || entry.key?("generateValue")
    if secret_class?(key)
      problems << "#{name} gives #{key} a literal value; it must be sync: false" if literal
      problems << "#{name} declares #{key} without sync: false" unless entry["sync"] == false
    end
    if key == DATABASE_URL_NAME
      source = entry["fromDatabase"]
      unless !literal && source.is_a?(Hash) && source["name"] == STUDIO_DB && source["property"] == "connectionString"
        problems << "#{name}'s #{DATABASE_URL_NAME} must come from #{STUDIO_DB}'s connectionString, never a literal value"
      end
    end
  end
  references(block).each do |kind, target|
    if kind == "fromDatabase"
      problems << "#{name} takes a fromDatabase from #{target.inspect}, not #{STUDIO_DB}" unless target == STUDIO_DB
    elsif !(target.start_with?(STUDIO_PREFIX) && declared.include?(target))
      problems << "#{name}'s #{kind} points at #{target.inspect}, which is not a Studio resource in #{STUDIO_PATH}"
    end
  end
  problems
end

def database_problems(block)
  problems = []
  unless block["databaseName"] == STUDIO_DATABASE_NAME
    problems << "#{STUDIO_DB}'s databaseName is #{block["databaseName"].inspect}, not #{STUDIO_DATABASE_NAME}"
  end
  unless block["ipAllowList"].is_a?(Array) && block["ipAllowList"].empty?
    problems << "#{STUDIO_DB} must set ipAllowList: [] (an omitted list allows every external connection)"
  end
  if !block.key?("diskSizeGB")
    problems << "#{STUDIO_DB} omits diskSizeGB: it must be #{STUDIO_DISK_SIZE_GB} (omitted, Render gives a new Basic-tier database 15 GB, and a disk size can never be decreased)"
  elsif !(block["diskSizeGB"].is_a?(Integer) && block["diskSizeGB"] == STUDIO_DISK_SIZE_GB)
    problems << "#{STUDIO_DB}'s diskSizeGB is #{block["diskSizeGB"].inspect}, not #{STUDIO_DISK_SIZE_GB} (the owner-approved size for O3)"
  end
  problems
end

def studio_problems(studio_text, studio)
  problems = []
  problems << "#{STUDIO_PATH} names a live resource (gcd-social-* or gcd_social)" if studio_text.match?(/gcd[-_]social/i)
  if studio_text.match?(/^\s*-?\s*["']?autoDeploy["']?\s*:/) || (studio && any_key?(studio, "autoDeploy"))
    problems << "#{STUDIO_PATH} sets the deprecated autoDeploy key"
  end
  return problems unless studio

  (studio.keys - ALLOWED_TOP_LEVEL).each do |key|
    problems << "#{STUDIO_PATH} has top-level key #{key.inspect}; only databases and services are allowed"
  end
  ALLOWED_TOP_LEVEL.each do |section|
    next if studio[section].is_a?(Array) && studio[section].all? { |entry| entry.is_a?(Hash) }

    problems << "#{STUDIO_PATH}'s #{section} is not a list of mappings"
  end

  found = blocks(studio).map do |section, block|
    [block["name"].to_s, section == "databases" ? "database" : block["type"].to_s]
  end
  names = found.map(&:first)
  names.tally.each { |name, count| problems << "#{STUDIO_PATH} declares #{name} #{count} times" if count > 1 }
  found.each do |name, kind|
    problems << "a cron resource exists (#{name}): the cron is S9's, built disabled, and never declared here" if kind == "cron" || name.include?("cron")
    problems << "#{name} is not a gcd-studio-* resource" unless name.start_with?(STUDIO_PREFIX)
  end
  expected = EXPECTED_RESOURCES.to_a.sort
  unless found.sort == expected
    problems << "#{STUDIO_PATH} declares #{found.sort.map { |n, k| "#{n} (#{k})" }.join(", ")}; expected exactly " +
                expected.map { |n, k| "#{n} (#{k})" }.join(", ")
  end

  blocks(studio).each do |section, block|
    name = block["name"].to_s
    if section == "databases"
      problems.concat(database_problems(block)) if name == STUDIO_DB
    else
      problems.concat(auto_deploy_problems(name, block))
    end
    problems.concat(env_problems(name, block, names))
  end
  problems
end

# Every problem with the two files' content (not the byte comparison).
def content_problems(live_text:, studio_text:, runner_text:)
  problems = []
  live = parse_blueprint(live_text, LIVE_PATH, problems)
  studio = parse_blueprint(studio_text, STUDIO_PATH, problems)
  problems.concat(live_problems(live_text, live))
  problems.concat(studio_problems(studio_text, studio))
  problems.concat(runner_parity_problems(runner_text))
  problems
end

# --- the byte comparison -----------------------------------------------------

SHA = /\A[0-9a-f]{40}\z/

# [sha, description] of the comparison base, or raises BlueprintError.
# git: ->(*args) { stdout or nil }; read_event: ->(path) { text }.
def resolve_base(env:, base_arg:, git:, read_event:)
  if env["GITHUB_ACTIONS"] == "true"
    raise BlueprintError, "--base is refused in CI: the comparison base comes from the event" if base_arg

    event = env["GITHUB_EVENT_NAME"]
    case event
    when "pull_request"
      path = env["GITHUB_EVENT_PATH"].to_s
      raise BlueprintError, "the comparison base cannot be determined: GITHUB_EVENT_PATH is unset" if path.empty?

      payload = begin
        JSON.parse(read_event.call(path))
      rescue JSON::ParserError, SystemCallError
        raise BlueprintError, "the comparison base cannot be determined: the pull_request event cannot be read"
      end
      sha = payload.is_a?(Hash) ? payload.dig("pull_request", "base", "sha") : nil
      raise BlueprintError, "the comparison base cannot be determined: the event's pull_request.base.sha is not a 40-character SHA" unless sha.is_a?(String) && sha.match?(SHA)

      raise BlueprintError, "the comparison base cannot be determined: the pull request's base #{sha} is not in this checkout" unless git.call("cat-file", "-e", "#{sha}^{commit}")

      [sha, "the pull request's base SHA"]
    when "push"
      head = env["GITHUB_SHA"].to_s
      raise BlueprintError, "the comparison base cannot be determined: GITHUB_SHA is not a 40-character SHA" unless head.match?(SHA)

      parent = git.call("rev-parse", "--verify", "--quiet", "#{head}^1^{commit}")
      raise BlueprintError, "the comparison base cannot be determined: #{head} has no first parent in this checkout" unless parent&.match?(SHA)

      [parent, "the first parent of the pushed commit #{head}"]
    else
      raise BlueprintError, "the comparison base cannot be determined for event #{event.inspect}: only pull_request and push are compared, and the check refuses rather than skips"
    end
  else
    raise BlueprintError, "the comparison base cannot be determined: outside CI pass --base <revision>, e.g. --base origin/main (the comparison is never skipped)" unless base_arg

    sha = git.call("rev-parse", "--verify", "--quiet", "#{base_arg}^{commit}")
    raise BlueprintError, "the comparison base cannot be determined: --base #{base_arg} is not a commit here" unless sha&.match?(SHA)

    [sha, "--base #{base_arg}"]
  end
end

def byte_problem(live_bytes, base_bytes, description)
  return "#{LIVE_PATH} does not exist at the comparison base (#{description}); it cannot be compared" if base_bytes.nil?
  return nil if live_bytes == base_bytes

  "#{LIVE_PATH} differs from its bytes at the comparison base (#{description}): a Studio PR never changes it"
end

GIT = lambda do |*args|
  out, _err, status = Open3.capture3("git", *args, chdir: ROOT)
  status.success? ? out.strip : nil
end

def base_bytes(sha)
  out, _err, status = Open3.capture3("git", "show", "#{sha}:#{LIVE_PATH}", chdir: ROOT, binmode: true)
  status.success? ? out.b : nil
end

# --- the self-test -------------------------------------------------------------

# [name, file, anchor, replacement, expected reason]. Each anchor must occur
# exactly once in its file's text.
FAULTS = [
  ["render.yaml given a Studio database", :live,
   "databases:\n  - name: gcd-social-db\n", "databases:\n  - name: gcd-studio-db\n    databaseName: gcd_studio\n  - name: gcd-social-db\n",
   "render.yaml declares gcd-studio-db, a Studio resource"],
  ["a Studio name in a render.yaml comment", :live,
   "# GCD-SOCIAL — Render Blueprint\n", "# GCD-SOCIAL — Render Blueprint (see also gcd_studio)\n",
   "render.yaml names a Content Studio resource"],
  ["a live block pointed at gcd-studio-db", :live,
   "      - key: DATABASE_URL\n        fromDatabase:\n          name: gcd-social-db\n          property: connectionString\n      - key: CONSOLE_TOKEN",
   "      - key: DATABASE_URL\n        fromDatabase:\n          name: gcd-studio-db\n          property: connectionString\n      - key: CONSOLE_TOKEN",
   "gcd-social-api references gcd-studio-db (fromDatabase)"],
  ["render.studio.yaml given a live service's name", :studio,
   "    name: gcd-studio-worker\n", "    name: gcd-social-worker\n",
   "render.studio.yaml names a live resource"],
  ["the live database variable on the web", :studio,
   "      - key: STUDIO_ALLOWED_HD\n", "      - key: DATABASE_URL\n        fromDatabase:\n          name: gcd-studio-db\n          property: connectionString\n      - key: STUDIO_ALLOWED_HD\n",
   "gcd-studio-web names forbidden variable DATABASE_URL"],
  ["the live GBP client id on the web", :studio,
   "      - key: STUDIO_ALLOWED_HD\n", "      - key: GOOGLE_CLIENT_ID\n        sync: false\n      - key: STUDIO_ALLOWED_HD\n",
   "gcd-studio-web names forbidden variable GOOGLE_CLIENT_ID"],
  ["ANTHROPIC_API_KEY on the web", :studio,
   "      - key: STUDIO_ALLOWED_HD\n", "      - key: ANTHROPIC_API_KEY\n        sync: false\n      - key: STUDIO_ALLOWED_HD\n",
   "gcd-studio-web names ANTHROPIC_API_KEY, which only gcd-studio-worker may carry"],
  ["ANTHROPIC_API_KEY on the worker with a literal value", :studio,
   "      - key: ANTHROPIC_API_KEY            # from the GCD-Content-Studio workspace, entered only in Render at O4\n        sync: false\n",
   "      - key: ANTHROPIC_API_KEY            # from the GCD-Content-Studio workspace, entered only in Render at O4\n        value: placeholder-not-a-key\n",
   "gcd-studio-worker's ANTHROPIC_API_KEY has a literal value"],
  ["ANTHROPIC_API_KEY on the worker without sync: false", :studio,
   "      - key: ANTHROPIC_API_KEY            # from the GCD-Content-Studio workspace, entered only in Render at O4\n        sync: false\n",
   "      - key: ANTHROPIC_API_KEY            # from the GCD-Content-Studio workspace, entered only in Render at O4\n",
   "gcd-studio-worker's ANTHROPIC_API_KEY is not sync: false"],
  ["an IG_ name on the worker", :studio,
   "      - key: NODE_OPTIONS         # heap headroom", "      - key: IG_USER_ID\n        sync: false\n      - key: NODE_OPTIONS         # heap headroom",
   "gcd-studio-worker names forbidden variable IG_USER_ID"],
  ["an FB_ name on the web", :studio,
   "      - key: STUDIO_ALLOWED_HD\n", "      - key: FB_PAGE_ID\n        sync: false\n      - key: STUDIO_ALLOWED_HD\n",
   "gcd-studio-web names forbidden variable FB_PAGE_ID"],
  ["a GBP_ name on the web", :studio,
   "      - key: STUDIO_ALLOWED_HD\n", "      - key: GBP_LOCATION_ID\n        sync: false\n      - key: STUDIO_ALLOWED_HD\n",
   "gcd-studio-web names forbidden variable GBP_LOCATION_ID"],
  ["the worker's database taken from another database", :studio,
   "        value: --max-old-space-size=1536\n      - key: STUDIO_DATABASE_URL\n        fromDatabase:\n          name: gcd-studio-db\n",
   "        value: --max-old-space-size=1536\n      - key: STUDIO_DATABASE_URL\n        fromDatabase:\n          name: gcd-studio-db-copy\n",
   "gcd-studio-worker takes a fromDatabase from \"gcd-studio-db-copy\", not gcd-studio-db"],
  ["a fromService pointing at a live service", :studio,
   "      - key: STUDIO_ALLOWED_HD\n", "      - key: STUDIO_LIVE_HOST\n        fromService:\n          type: web\n          name: gcd-social-api\n          property: host\n      - key: STUDIO_ALLOWED_HD\n",
   "gcd-studio-web's fromService points at \"gcd-social-api\""],
  ["a fromGroup pointing at a group outside the file", :studio,
   "      - key: STUDIO_ALLOWED_HD\n", "      - fromGroup: shared-settings\n      - key: STUDIO_ALLOWED_HD\n",
   "gcd-studio-web's fromGroup points at \"shared-settings\""],
  ["autoDeployTrigger written as an unquoted off", :studio,
   "    autoDeployTrigger: 'off'      # web:", "    autoDeployTrigger: off        # web:",
   "gcd-studio-web's autoDeployTrigger is the boolean false (an unquoted off)"],
  ["autoDeployTrigger omitted on the worker", :studio,
   "    autoDeployTrigger: 'off'      # worker:", "    # (no auto-deploy field)",
   "gcd-studio-worker omits autoDeployTrigger"],
  ["autoDeployTrigger set to commit", :studio,
   "    autoDeployTrigger: 'off'      # worker:", "    autoDeployTrigger: commit     # worker:",
   "gcd-studio-worker's autoDeployTrigger is \"commit\""],
  ["autoDeployTrigger set to checksPass", :studio,
   "    autoDeployTrigger: 'off'      # web:", "    autoDeployTrigger: checksPass # web:",
   "gcd-studio-web's autoDeployTrigger is \"checksPass\""],
  ["the deprecated autoDeploy key beside the field", :studio,
   "    autoDeployTrigger: 'off'      # web:", "    autoDeploy: false\n    autoDeployTrigger: 'off'      # web:",
   "render.studio.yaml sets the deprecated autoDeploy key"],
  ["ipAllowList removed from the database", :studio,
   "    ipAllowList: []", "    # (no allow list)",
   "gcd-studio-db must set ipAllowList: []"],
  ["ipAllowList opened to everyone", :studio,
   "    ipAllowList: []", "    ipAllowList:\n      - source: 0.0.0.0/0\n        description: everywhere",
   "gcd-studio-db must set ipAllowList: []"],
  ["diskSizeGB omitted from the database", :studio,
   "    diskSizeGB: 5 ", "    # (no disk size) ",
   "gcd-studio-db omits diskSizeGB: it must be 5"],
  ["diskSizeGB set to a different size", :studio,
   "    diskSizeGB: 5 ", "    diskSizeGB: 15",
   "gcd-studio-db's diskSizeGB is 15, not 5"],
  ["the database's databaseName changed", :studio,
   "    databaseName: gcd_studio ", "    databaseName: gcd_studio_db ",
   "gcd-studio-db's databaseName is \"gcd_studio_db\", not gcd_studio"],
  ["a cron resource added", :studio,
   "services:\n", "services:\n  - type: cron\n    name: gcd-studio-cron\n    runtime: node\n    schedule: \"0 13 * * *\"\n    autoDeployTrigger: 'off'\n    buildCommand: npm ci\n    startCommand: npm run start:studio-cron\n",
   "a cron resource exists (gcd-studio-cron)"],
  ["an extra resource beyond the three", :studio,
   "services:\n", "services:\n  - type: pserv\n    name: gcd-studio-extra\n    runtime: node\n    autoDeployTrigger: 'off'\n    buildCommand: npm ci\n    startCommand: npm run start:studio-web\n",
   "expected exactly gcd-studio-db (database), gcd-studio-web (web), gcd-studio-worker (worker)"],
  ["a literal value for the OAuth client secret", :studio,
   "      - key: STUDIO_GOOGLE_CLIENT_SECRET\n        sync: false\n", "      - key: STUDIO_GOOGLE_CLIENT_SECRET\n        value: placeholder-not-a-secret\n",
   "gcd-studio-web gives STUDIO_GOOGLE_CLIENT_SECRET a literal value"],
  ["a literal value for the bootstrap owner", :studio,
   "      - key: STUDIO_BOOTSTRAP_OWNER_EMAIL # a Workspace user account (O4)\n        sync: false\n",
   "      - key: STUDIO_BOOTSTRAP_OWNER_EMAIL # a Workspace user account (O4)\n        value: owner\n",
   "gcd-studio-web gives STUDIO_BOOTSTRAP_OWNER_EMAIL a literal value"],
  ["a literal value for a ceiling on the worker", :studio,
   "      - key: STUDIO_MAX_MONTHLY_USD       # the same ceiling, enforced again at each paid call\n        sync: false\n",
   "      - key: STUDIO_MAX_MONTHLY_USD       # the same ceiling, enforced again at each paid call\n        value: \"300\"\n",
   "gcd-studio-worker gives STUDIO_MAX_MONTHLY_USD a literal value"],
  ["a literal value for a token-like name", :studio,
   "      - key: STUDIO_ALLOWED_HD\n", "      - key: STUDIO_SESSION_TOKEN\n        value: placeholder\n      - key: STUDIO_ALLOWED_HD\n",
   "gcd-studio-web gives STUDIO_SESSION_TOKEN a literal value"],
  ["a literal STUDIO_DATABASE_URL", :studio,
   "        value: --max-old-space-size=1536\n      - key: STUDIO_DATABASE_URL\n        fromDatabase:\n          name: gcd-studio-db\n          property: connectionString\n",
   "        value: --max-old-space-size=1536\n      - key: STUDIO_DATABASE_URL\n        value: postgresql://example.invalid/gcd_studio\n",
   "gcd-studio-worker's STUDIO_DATABASE_URL must come from gcd-studio-db's connectionString"],
  ["an unsupported top-level section", :studio,
   "databases:\n", "envVarGroups:\n  - name: gcd-studio-shared\n    envVars:\n      - key: NODE_ENV\n        value: production\ndatabases:\n",
   "has top-level key \"envVarGroups\""],
  ["a duplicated key", :studio,
   "    plan: standard ", "    plan: standard\n    plan: standard ",
   "render.studio.yaml repeats a key"],
  ["a YAML alias", :studio,
   "    buildCommand: npm ci --include=dev && npm run build\n    preDeployCommand:",
   "    buildCommand: &build npm ci --include=dev && npm run build\n    previewBuild: *build\n    preDeployCommand:",
   "render.studio.yaml is not plain YAML"],
  ["the forbidden list drifted from the runtime's", :runner,
   "\"ACTIVE_PLATFORMS\",\n] as const;", "] as const;",
   "the forbidden list differs from src/studio/db/runner.ts's FORBIDDEN_VARIABLES"],
  ["a forbidden prefix dropped from the runtime's list", :runner,
   "[\"IG_\", \"FB_\", \"GBP_\"]", "[\"IG_\", \"FB_\"]",
   "the forbidden list differs from src/studio/db/runner.ts's FORBIDDEN_PREFIXES"],
].freeze

# Variants that must be accepted: the check judges values, not spelling.
CONTROLS = [
  ["autoDeployTrigger double-quoted", :studio,
   "    autoDeployTrigger: 'off'      # web:", "    autoDeployTrigger: \"off\"      # web:"],
  # S6b: the key as declared -- on gcd-studio-worker, sync: false -- is accepted (here without its comment).
  ["ANTHROPIC_API_KEY declared on the worker, sync: false", :studio,
   "      - key: ANTHROPIC_API_KEY            # from the GCD-Content-Studio workspace, entered only in Render at O4\n        sync: false\n",
   "      - key: ANTHROPIC_API_KEY\n        sync: false\n"],
].freeze

FAKE_SHA = "0123456789abcdef0123456789abcdef01234567"
FAKE_PARENT = "89abcdef0123456789abcdef0123456789abcdef"

# [name, env, base argument, git result, event text, expected reason or :accept]
BASE_CASES = [
  ["pull_request: the event's base SHA is used", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "pull_request", "GITHUB_EVENT_PATH" => "event.json" },
   nil, "", JSON.generate("pull_request" => { "base" => { "sha" => FAKE_SHA } }), [FAKE_SHA, :accept]],
  ["pull_request whose base is not in this checkout", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "pull_request", "GITHUB_EVENT_PATH" => "event.json" },
   nil, nil, JSON.generate("pull_request" => { "base" => { "sha" => FAKE_SHA } }), "is not in this checkout"],
  ["push: the first parent is used", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "push", "GITHUB_SHA" => FAKE_SHA },
   nil, FAKE_PARENT, nil, [FAKE_PARENT, :accept]],
  ["workflow_dispatch: refused, never skipped", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "workflow_dispatch" },
   nil, FAKE_PARENT, nil, "cannot be determined for event \"workflow_dispatch\""],
  ["pull_request without an event file", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "pull_request" },
   nil, nil, nil, "GITHUB_EVENT_PATH is unset"],
  ["pull_request whose event has no base SHA", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "pull_request", "GITHUB_EVENT_PATH" => "event.json" },
   nil, nil, JSON.generate("pull_request" => { "base" => {} }), "pull_request.base.sha is not a 40-character SHA"],
  ["pull_request whose event cannot be parsed", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "pull_request", "GITHUB_EVENT_PATH" => "event.json" },
   nil, nil, "{not json", "the pull_request event cannot be read"],
  ["push whose commit has no first parent here", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "push", "GITHUB_SHA" => FAKE_SHA },
   nil, nil, nil, "has no first parent in this checkout"],
  ["push without GITHUB_SHA", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "push" },
   nil, FAKE_PARENT, nil, "GITHUB_SHA is not a 40-character SHA"],
  ["--base passed in CI", { "GITHUB_ACTIONS" => "true", "GITHUB_EVENT_NAME" => "push", "GITHUB_SHA" => FAKE_SHA },
   "origin/main", FAKE_PARENT, nil, "--base is refused in CI"],
  ["outside CI with no --base", {}, nil, FAKE_PARENT, nil, "outside CI pass --base"],
  ["outside CI with --base", {}, "origin/main", FAKE_PARENT, nil, [FAKE_PARENT, :accept]],
  ["outside CI with a --base that is not a commit", {}, "no-such-ref", nil, nil, "is not a commit here"],
].freeze

def self_test(texts)
  failures = 0
  passes = 0
  report = lambda do |ok, line|
    puts "#{ok ? "PASS" : "FAIL"}  #{line}"
    ok ? passes += 1 : failures += 1
  end

  FAULTS.each do |name, file, from, to, expected|
    text = texts.fetch(file)
    occurrences = text.scan(from).length
    if occurrences != 1
      report.call(false, "injected fault (#{name}): its anchor occurs #{occurrences} times in #{file}, not once")
      next
    end
    problems = content_problems(**texts.merge(file => text.sub(from) { to }).transform_keys { |k| :"#{k}_text" })
    if problems.empty?
      report.call(false, "injected fault (#{name}) was accepted")
    elsif problems.any? { |problem| problem.include?(expected) }
      report.call(true, "injected fault (#{name}) is refused: #{problems.find { |problem| problem.include?(expected) }}")
    else
      report.call(false, "injected fault (#{name}) was refused for the wrong reason: #{problems.join("; ")} (expected #{expected.inspect})")
    end
  end

  CONTROLS.each do |name, file, from, to|
    text = texts.fetch(file)
    if text.scan(from).length != 1
      report.call(false, "control (#{name}): its anchor does not occur exactly once in #{file}")
      next
    end
    problems = content_problems(**texts.merge(file => text.sub(from) { to }).transform_keys { |k| :"#{k}_text" })
    report.call(problems.empty?, "control (#{name}) is #{problems.empty? ? "accepted" : "refused: #{problems.join("; ")}"}")
  end

  live = texts.fetch(:live)
  byte = byte_problem("#{live} ".b, live.b, "a test base")
  report.call(byte&.include?("render.yaml differs from its bytes at the comparison base"), "injected fault (render.yaml changed by one byte) is #{byte ? "refused: #{byte}" : "accepted"}")
  missing = byte_problem(live.b, nil, "a test base")
  report.call(missing&.include?("does not exist at the comparison base"), "injected fault (render.yaml absent at the base) is #{missing ? "refused: #{missing}" : "accepted"}")
  report.call(byte_problem(live.b, live.b.dup, "a test base").nil?, "control (identical bytes) is accepted")

  BASE_CASES.each do |name, env, base_arg, git_result, event_text, expected|
    git = ->(*_args) { git_result }
    read_event = ->(_path) { event_text.nil? ? raise(Errno::ENOENT) : event_text }
    begin
      sha, = resolve_base(env: env, base_arg: base_arg, git: git, read_event: read_event)
      if expected.is_a?(Array)
        report.call(sha == expected.first, "comparison base (#{name}) resolves to #{sha}")
      else
        report.call(false, "comparison base (#{name}) was accepted as #{sha}; expected a refusal (#{expected})")
      end
    rescue BlueprintError => e
      if expected.is_a?(String) && e.message.include?(expected)
        report.call(true, "comparison base (#{name}) is refused: #{e.message}")
      else
        report.call(false, "comparison base (#{name}) was refused for the wrong reason: #{e.message}")
      end
    end
  end
  [passes, failures]
end

# --- main ----------------------------------------------------------------------

base_arg = nil
args = ARGV.dup
while (arg = args.shift)
  if arg == "--base"
    base_arg = args.shift or abort "usage: ruby scripts/ci/check-studio-blueprint.rb [--base REVISION]"
  else
    abort "usage: ruby scripts/ci/check-studio-blueprint.rb [--base REVISION]"
  end
end

texts = {
  live: File.read(File.join(ROOT, LIVE_PATH), encoding: "UTF-8"),
  studio: File.read(File.join(ROOT, STUDIO_PATH), encoding: "UTF-8"),
  runner: File.read(File.join(ROOT, RUNNER_PATH), encoding: "UTF-8"),
}
failures = 0

problems = content_problems(live_text: texts[:live], studio_text: texts[:studio], runner_text: texts[:runner])
if problems.empty?
  puts "PASS  #{LIVE_PATH} and #{STUDIO_PATH}: every content rule holds"
else
  problems.each { |problem| puts "FAIL  #{problem}" }
  failures += problems.length
end

begin
  sha, description = resolve_base(env: ENV.to_h, base_arg: base_arg, git: GIT, read_event: ->(path) { File.read(path) })
  live_bytes = File.binread(File.join(ROOT, LIVE_PATH))
  problem = byte_problem(live_bytes, base_bytes(sha), "#{description}, #{sha}")
  if problem
    puts "FAIL  #{problem}"
    failures += 1
  else
    puts "PASS  #{LIVE_PATH} is byte-identical to the comparison base (#{description}, #{sha})"
  end
rescue BlueprintError => e
  puts "FAIL  #{e.message}"
  failures += 1
end

passes, self_failures = self_test(texts)
failures += self_failures

puts failures.zero? ? "studio blueprint: ALL PASS (#{passes} self-test checks: #{FAULTS.length + 2} injected faults refused, #{BASE_CASES.length} base cases, #{CONTROLS.length + 1} controls accepted)" : "studio blueprint: #{failures} FAILURE(S)"
exit(failures.zero? ? 0 : 1)
