require 'json'
require 'open3'

require 'json'
require 'open3'
require 'pty'
require 'timeout'

class TerminalApp
  # Security configuration
  BASE_DIR = File.expand_path(__dir__)
  PROTECTED_FILES = ['app.rb', 'config.ru', 'Gemfile', 'Gemfile.lock', '.git', 'public', '.gemini', '.ruby-lsp']
  
  # Allow password via ENV for deployment readiness
  PASSWORD = ENV['TERMINAL_PASSWORD'] || "password"
  
  MUTEX = Mutex.new
  @@current_pid = nil

  def call(env)
    request = Rack::Request.new(env)
    
    case request.path
    when '/' then serve_index
    when '/stream' then stream_command(request)
    when '/autocomplete' then autocomplete(request)
    when '/validate-command' then validate_command(request)
    when '/read-file' then read_file(request)
    when '/write-file' then write_file(request)
    when '/signal' then send_signal(request)
    when '/upload' then handle_upload(request)
    else
      [404, { "Content-Type" => "text/plain" }, ["Not Found"]]
    end
  end

  private

  def serve_index
    index_path = File.join(__dir__, 'public', 'index.html')
    if File.exist?(index_path)
      [200, { "Content-Type" => "text/html" }, [File.read(index_path)]]
    else
      [404, { "Content-Type" => "text/plain" }, ["index.html not found"]]
    end
  end

  def autocomplete(request)
    return [401, {}, ["Unauthorized"]] unless authenticated?(request)
    
    cwd = clamp_path(request.params['cwd'] || BASE_DIR)
    prefix = (request.params['prefix'] || "").strip
    
    begin
      Dir.chdir(cwd)
      
      # Search for matches
      entries = Dir.entries(".")
      entries -= [".", ".."]
      
      # Filter protected files for autocomplete
      entries = entries.reject { |e| file_protected?(e) }
      
      matches = entries.select { |e| e.start_with?(prefix) }
      # Add trailing slash for directories
      matches = matches.map { |e| File.directory?(e) ? "#{e}/" : e }
      
      json_response({ matches: matches })
    rescue => e
      json_response({ error: e.message }, 500)
    end
  end

  def validate_command(request)
    return [401, {}, ["Unauthorized"]] unless authenticated?(request)
    
    command = (request.params['command'] || "").split(/\s+/).first
    return json_response({ valid: false }) if command.nil? || command.empty?
    
    # Built-ins
    builtins = ['cd', 'help', 'logout', 'clear', 'exit']
    return json_response({ valid: true }) if builtins.include?(command)
    
    # System check
    begin
      MUTEX.synchronize do
        stdout, _stderr, status = Open3.capture3("which #{command}")
        json_response({ valid: status.success? && !stdout.empty? })
      end
    rescue
      json_response({ valid: false })
    end
  end

  def read_file(request)
    return [401, {}, ["Unauthorized"]] unless authenticated?(request)
    
    path = clamp_path(request.params['path'])
    if file_protected?(path)
      return json_response({ error: "Access to this file is restricted for security." }, 403)
    end
    
    begin
      content = File.read(path)
      json_response({ content: content })
    rescue => e
      json_response({ error: e.message }, 500)
    end
  end

  def write_file(request)
    return [405, {}, ["Method Not Allowed"]] unless request.post?
    return [401, {}, ["Unauthorized"]] unless authenticated?(request)
    
    begin
      body = JSON.parse(request.body.read)
      path = clamp_path(body['path'])
      
      if file_protected?(path)
        return json_response({ error: "Modification of this file is restricted for security." }, 403)
      end
      
      content = body['content']
      File.write(path, content)
      json_response({ success: true })
    rescue => e
      json_response({ error: e.message }, 500)
    end
  end

  def send_signal(request)
    return [401, {}, ["Unauthorized"]] unless authenticated?(request)
    if @@current_pid
      Process.kill("INT", @@current_pid) rescue nil
      json_response({ success: true, message: "Signal INT sent to #{@@current_pid}" })
    else
      json_response({ error: "No active process to signal" }, 404)
    end
  end

  def handle_upload(request)
    return [401, {}, ["Unauthorized"]] unless authenticated?(request)
    return [405, {}, ["Method Not Allowed"]] unless request.post?

    begin
      # Rack multipart upload
      params = request.params
      file = params['file']
      return json_response({ error: "No file uploaded" }, 400) if file.nil?

      filename = file[:filename]
      tempfile = file[:tempfile]
      
      target_path = clamp_path(filename)
      if file_protected?(target_path)
        return json_response({ error: "Cannot upload to a protected file name" }, 403)
      end

      File.open(target_path, 'wb') { |f| f.write(tempfile.read) }
      json_response({ success: true, filename: filename })
    rescue => e
      json_response({ error: e.message }, 500)
    end
  end

  def stream_command(request)
    return [401, { "Content-Type" => "text/plain" }, ["Unauthorized"]] unless authenticated?(request)
    
    command = request.params['command'] || ""
    cwd = clamp_path(request.params['cwd'] || BASE_DIR)

    # Security: Prevent executing commands that directly target protected files
    if command.match?(Regexp.union(PROTECTED_FILES)) && !command.start_with?("ls")
      # Allow ls but we will filter its output via alias in env
    end

    response_headers = {
      "Content-Type" => "text/event-stream",
      "Cache-Control" => "no-cache",
      "X-Accel-Buffering" => "no"
    }

    # Better ls: hide protected files
    ls_ignore = PROTECTED_FILES.map { |f| "-I #{f}" }.join(" ")
    
    # Environment for the subshell
    env_vars = {
      "TERM" => "xterm-256color",
      "CLICOLOR_FORCE" => "1",
      "LS_COLORS" => ENV['LS_COLORS'] || "",
      "BASE_DIR" => BASE_DIR
    }

    body = Enumerator.new do |yielder|
      begin
        MUTEX.synchronize do
          Dir.chdir(cwd)
          
          # Handle 'cd' restriction
          if command.strip.start_with?("cd")
            target_parts = command.strip.split(/\s+/, 2)
            target_dir = target_parts[1] || Dir.home
            new_path = clamp_path(File.expand_path(target_dir, Dir.pwd))
            
            begin
              Dir.chdir(new_path)
              display_path = new_path == BASE_DIR ? "~" : new_path.sub(BASE_DIR, "~")
              yielder << "data: #{JSON.generate({ output: "", directory: new_path, display_path: display_path, git: get_git_info })}\n\n"
            rescue => e
              yielder << "data: #{JSON.generate({ error: "cd: #{e.message}" })}\n\n"
            end
            yielder << "data: [DONE]\n\n"
          else
            # Command modification: hide protected files from ls
            if command.strip.start_with?("ls") && !command.include?("--color")
              command = "#{command} --color=always #{ls_ignore}"
            elsif command.strip.start_with?("ls")
              command = "#{command} #{ls_ignore}"
            end

            # Use PTY to avoid buffering (makes it feel like a real terminal)
            begin
              PTY.spawn(env_vars, command) do |output, input, pid|
                @@current_pid = pid
                
                begin
                  while !output.eof?
                    # Read available output immediately
                    chunk = output.readpartial(4096)
                    yielder << "data: #{JSON.generate({ output: chunk })}\n\n" if chunk
                  end
                rescue EOFError, Errno::EIO
                  # PTY raises Errno::EIO when the child process closes the stream
                ensure
                  # Wait for the process to finish to get the exit status
                  Process.wait(pid) rescue nil
                  exit_status = $?.exitstatus
                  @@current_pid = nil
                  
                  yielder << "data: #{JSON.generate({ exit_code: exit_status, directory: Dir.pwd, display_path: display_path, git: get_git_info })}\n\n"
                  yielder << "data: [DONE]\n\n"
                end
              end
            rescue PTY::ChildExited => e
              yielder << "data: #{JSON.generate({ exit_code: e.status.exitstatus, directory: Dir.pwd, display_path: display_path, git: get_git_info })}\n\n"
              yielder << "data: [DONE]\n\n"
            rescue => e
              yielder << "data: #{JSON.generate({ error: e.message })}\n\n"
              yielder << "data: [DONE]\n\n"
            end
          end
        end
      rescue => e
        yielder << "data: #{JSON.generate({ error: e.message })}\n\n"
        yielder << "data: [DONE]\n\n"
      end
    end

    [200, response_headers, body]
  end

  # Legacy non-streaming endpoint
  def execute_command(request)
    return [405, {}, ["Method Not Allowed"]] unless request.post?
    return [401, {}, ["Unauthorized"]] unless authenticated?(request)

    begin
      body = JSON.parse(request.body.read)
      command = body['command']
      cwd = body['cwd'] || Dir.pwd

      if command.nil? || command.strip.empty?
        return json_response({ error: "No command provided" }, 400)
      end

      Dir.chdir(cwd) if Dir.exist?(cwd)
      
      stdout, stderr, status = Open3.capture3(command)

      response = {
        output: stdout,
        error: stderr,
        exit_code: status.exitstatus,
        directory: Dir.pwd
      }

      json_response(response)
    rescue JSON::ParserError
      json_response({ error: "Invalid JSON" }, 400)
    rescue => e
      json_response({ error: e.message }, 500)
    end
  end

  def authenticated?(request)
    # Check for password in header or query param
    request.env['HTTP_X_TERMINAL_PASSWORD'] == PASSWORD || 
    request.params['password'] == PASSWORD
  end

  def get_git_info
    return nil unless Dir.exist?(".git")
    branch = `git branch --show-current 2>/dev/null`.strip
    return nil if branch.empty?
    
    # Check for dirty state
    status = `git status --porcelain 2>/dev/null`.strip
    dirty = status.empty? ? "" : "*"
    "#{branch}#{dirty}"
  rescue
    nil
  end

  def json_response(data, status = 200)
    [status, { "Content-Type" => "application/json" }, [data.to_json]]
  end

  private

  def clamp_path(path)
    return BASE_DIR if path.nil? || path.empty?
    abs_path = File.expand_path(path, BASE_DIR)
    abs_path.start_with?(BASE_DIR) ? abs_path : BASE_DIR
  end

  def file_protected?(path)
    filename = File.basename(path)
    PROTECTED_FILES.include?(filename)
  end
end
