# frozen_string_literal: true

# The payload-contract mutation harness runs as shards (`--shard k/n`; see
# scripts/ci/payload-contract-mutation.mjs). A shard that no job runs is a set
# of mutations that silently stops being tested, so this guard reads the CI
# workflow and fails unless:
#
#   - every command that runs the harness (`test:payload-mutation` or
#     `payload-contract-mutation.mjs`) passes exactly one `--shard k/n`;
#   - every shard uses the same n; and
#   - across every job and every matrix expansion, each k in 0..n-1 runs
#     exactly once.
#
# Matrix values are expanded the way GitHub expands them for the forms this
# workflow uses (lists, and `include` entries that extend or add combinations),
# and `${{ matrix.KEY }}` is substituted per combination. Anything it cannot
# resolve statically -- a matrix expression, `exclude`, an unresolved `${{ }}`
# in a harness command -- is refused, never guessed.
#
# After checking the given workflow, it proves itself: it applies injected
# faults to that workflow's text (a shard missing, a shard duplicated, a
# different n, k out of range, the harness without `--shard`, an unresolved
# shard value, an unsupported matrix form) and requires each to be refused with
# the expected reason. Each fault's anchor text must occur exactly once, so the
# self-test fails rather than passes vacuously if the workflow drifts.
#
# Run: ruby scripts/ci/check-mutation-shards.rb .github/workflows/ci.yml

require "yaml"

HARNESS = /test:payload-mutation|payload-contract-mutation\.mjs/

class ShardError < StandardError; end

def matrix_combinations(job_id, job)
  strategy = job["strategy"]
  return [{}] if strategy.nil?
  raise ShardError, "job #{job_id}: strategy is not a mapping" unless strategy.is_a?(Hash)
  matrix = strategy["matrix"]
  return [{}] if matrix.nil?
  raise ShardError, "job #{job_id}: matrix is not a static mapping" unless matrix.is_a?(Hash)
  raise ShardError, "job #{job_id}: matrix exclude is not supported by this guard" if matrix.key?("exclude")

  axes = matrix.reject { |key, _| key == "include" }
  axes.each do |key, values|
    unless values.is_a?(Array) && values.all? { |value| [String, Integer, Float, TrueClass, FalseClass].include?(value.class) }
      raise ShardError, "job #{job_id}: matrix axis #{key} is not a static list of scalars"
    end
  end
  combos = axes.reduce([{}]) do |acc, (key, values)|
    acc.flat_map { |combo| values.map { |value| combo.merge(key => value.to_s) } }
  end
  combos = [] if axes.empty?

  includes = matrix["include"] || []
  raise ShardError, "job #{job_id}: matrix include is not a list" unless includes.is_a?(Array)
  includes.each do |entry|
    raise ShardError, "job #{job_id}: matrix include entry is not a mapping" unless entry.is_a?(Hash)
    entry = entry.transform_values(&:to_s)
    original = entry.select { |key, _| axes.key?(key) }
    added = entry.reject { |key, _| axes.key?(key) }
    # GitHub's rule: an entry extends every combination whose original values it
    # matches (all of them when it names none); one that matches none is added.
    matching = combos.select { |combo| original.all? { |key, value| combo[key] == value } }
    if matching.empty?
      combos << entry
    else
      matching.each { |combo| combo.merge!(added) }
    end
  end
  combos = [{}] if combos.empty?
  combos
end

def substitute(text, combo, where)
  text.gsub(/\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/) do
    key = Regexp.last_match(1)
    raise ShardError, "#{where}: matrix.#{key} is not defined for #{combo.inspect}" unless combo.key?(key)

    combo[key]
  end
end

# Every harness invocation in the workflow: [where, k, n].
def harness_runs(workflow)
  jobs = workflow["jobs"]
  raise ShardError, "the workflow has no jobs mapping" unless jobs.is_a?(Hash)

  runs = []
  jobs.each do |job_id, job|
    raise ShardError, "job #{job_id} is not a mapping" unless job.is_a?(Hash)

    steps = job["steps"] || []
    harness_steps = steps.select { |step| step.is_a?(Hash) && step["run"].is_a?(String) && step["run"].match?(HARNESS) }
    next if harness_steps.empty?

    matrix_combinations(job_id, job).each do |combo|
      harness_steps.each do |step|
        where = "job #{job_id} #{combo.empty? ? "" : "#{combo.inspect} "}step #{step["name"].inspect}"
        text = substitute(step["run"].gsub(/\\\n/, " "), combo, where)
        text.split("\n").flat_map { |line| line.split(/&&|\|\||;|\|/) }.each do |command|
          next unless command.match?(HARNESS)

          shards = command.scan(/(?:^|\s)--shard(?:\s+|=)(\S*)/).flatten
          raise ShardError, "#{where} runs the harness without --shard" if shards.empty?
          raise ShardError, "#{where} passes --shard more than once" if shards.length > 1
          raise ShardError, "#{where} uses --shard= (the harness takes --shard k/n)" if command.match?(/--shard=/)

          value = shards.first
          raise ShardError, "#{where}: --shard #{value} is not resolved to k/n" if value.include?("${{")

          match = %r{\A(0|[1-9][0-9]*)/([1-9][0-9]*)\z}.match(value)
          raise ShardError, "#{where}: --shard #{value} is not k/n" unless match

          k = Integer(match[1], 10)
          n = Integer(match[2], 10)
          raise ShardError, "#{where}: --shard #{value} has k >= n" if k >= n

          runs << [where, k, n]
        end
      end
    end
  end
  runs
end

# Returns a one-line summary, or raises ShardError with the reason.
def check_workflow(text)
  workflow = YAML.safe_load(text, aliases: false)
  raise ShardError, "the workflow is not a mapping" unless workflow.is_a?(Hash)

  runs = harness_runs(workflow)
  raise ShardError, "no job runs the mutation harness" if runs.empty?

  counts = runs.map { |_, _, n| n }.uniq
  raise ShardError, "shards disagree on n: #{counts.sort.join(", ")}" if counts.length > 1

  n = counts.first
  problems = (0...n).filter_map do |k|
    count = runs.count { |_, shard, _| shard == k }
    if count.zero?
      "shard #{k}/#{n} is not run"
    elsif count > 1
      "shard #{k}/#{n} is run #{count} times"
    end
  end
  raise ShardError, problems.join("; ") unless problems.empty?

  "#{runs.length} harness runs cover shards 0..#{n - 1} of #{n} exactly once: " +
    runs.sort_by { |_, k, _| k }.map { |where, k, _| "#{k} (#{where})" }.join(", ")
end

FAULTS = [
  ["a shard missing: the quality job's step removed",
   "        run: npm run test:payload-mutation -- --shard 0/3\n", "",
   "shard 0/3 is not run"],
  ["a shard duplicated: the PostgreSQL 18 job given shard 1",
   "          - postgres-version: \"18\"\n            mutation-shard: \"2\"",
   "          - postgres-version: \"18\"\n            mutation-shard: \"1\"",
   "shard 1/3 is run 2 times; shard 2/3 is not run"],
  ["a shard duplicated: the quality job given shard 2",
   "--shard 0/3\n", "--shard 2/3\n",
   "shard 0/3 is not run; shard 2/3 is run 2 times"],
  ["a different n in one job",
   "--shard 0/3\n", "--shard 0/4\n",
   "shards disagree on n: 3, 4"],
  ["k out of range",
   "--shard 0/3\n", "--shard 3/3\n",
   "has k >= n"],
  ["the harness run without --shard",
   "npm run test:payload-mutation -- --shard 0/3\n", "npm run test:payload-mutation\n",
   "runs the harness without --shard"],
  ["the harness run directly, without --shard, in another job",
   "          npm run test:studio-worker-postgres\n",
   "          npm run test:studio-worker-postgres && node scripts/ci/payload-contract-mutation.mjs\n",
   "runs the harness without --shard"],
  ["--shard= instead of --shard k/n",
   "--shard 0/3\n", "--shard=0/3\n",
   "uses --shard="],
  ["a shard value no matrix entry defines",
   "--shard ${{ matrix.mutation-shard }}/3", "--shard ${{ matrix.mutation-shards }}/3",
   "matrix.mutation-shards is not defined"],
  ["a shard value left as an expression",
   "--shard ${{ matrix.mutation-shard }}/3", "--shard ${{ github.run_attempt }}/3",
   "is not resolved to k/n"],
  ["an unsupported matrix form",
   "        postgres-version: [\"16\", \"18\"]\n",
   "        postgres-version: [\"16\", \"18\"]\n        exclude:\n          - postgres-version: \"16\"\n",
   "matrix exclude is not supported"],
].freeze

path = ARGV.fetch(0) { abort "usage: ruby scripts/ci/check-mutation-shards.rb .github/workflows/ci.yml" }
text = File.read(path, encoding: "UTF-8")
failures = 0

begin
  puts "PASS  #{path}: #{check_workflow(text)}"
rescue ShardError, Psych::Exception => e
  puts "FAIL  #{path}: #{e.message}"
  failures += 1
end

FAULTS.each do |name, from, to, expected|
  occurrences = text.scan(from).length
  if occurrences != 1
    puts "FAIL  injected fault (#{name}): its anchor occurs #{occurrences} times in #{path}, not once"
    failures += 1
    next
  end
  begin
    check_workflow(text.sub(from) { to })
    puts "FAIL  injected fault (#{name}) was accepted"
    failures += 1
  rescue ShardError => e
    if e.message.include?(expected)
      puts "PASS  injected fault (#{name}) is refused: #{e.message}"
    else
      puts "FAIL  injected fault (#{name}) was refused for the wrong reason: #{e.message} (expected #{expected.inspect})"
      failures += 1
    end
  end
end

puts failures.zero? ? "mutation shards: ALL PASS (#{FAULTS.length} injected faults refused)" : "mutation shards: #{failures} FAILURE(S)"
exit(failures.zero? ? 0 : 1)
