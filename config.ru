require_relative 'app'

# Serve static files from the 'public' directory
use Rack::Static, 
  urls: ["/css", "/js"],
  root: "public"

run TerminalApp.new
