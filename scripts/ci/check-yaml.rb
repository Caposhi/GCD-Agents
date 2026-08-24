# frozen_string_literal: true

require "yaml"

ARGV.each do |file|
  YAML.load_file(file)
  puts "parsed #{file}"
end
