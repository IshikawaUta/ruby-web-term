document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('terminal-input');
    const outputContainer = document.getElementById('output-container');
    const terminalBody = document.getElementById('terminal-body');
    const promptTop = document.getElementById('prompt-top-container');
    const promptBottomSymbol = document.getElementById('prompt-bottom-symbol');
    const mirroredInput = document.getElementById('mirrored-input');
    
    let commandHistory = JSON.parse(localStorage.getItem('terminal_history') || '[]');
    let historyIndex = -1;
    let currentCommand = '';
    let password = localStorage.getItem('terminal_password') || '';
    let currentDirectory = localStorage.getItem('terminal_cwd') || '~';
    let fullPath = localStorage.getItem('terminal_full_path') || '';
    let gitBranch = '';
    let suggestions = [];
    let suggestionIndex = -1;
    let ghostSuggestion = '';
    let lastValidatedCommand = '';
    let isCommandValid = true;

    // Shortcuts
    document.addEventListener('keydown', async (e) => {
        if (editorModal.classList.contains('active')) return;

        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            await sendSignal('INT');
            appendOutput('<br><span class="error-text">^C (Interrupt sent)</span>');
            // Reset input
            input.value = '';
            updateMirror();
        } else if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            clearTerminal();
        }
    });

    async function sendSignal(sig) {
        try {
            await fetch('/signal', {
                method: 'POST',
                headers: { 'X-Terminal-Password': password }
            });
        } catch (e) {}
    }

    function clearTerminal() {
        outputContainer.innerHTML = '';
        input.value = '';
        updateMirror();
        appendOutput('<span class="info-message">Terminal cleared.</span>');
    }

    function saveHistory(cmd) {
        if (!cmd || cmd.trim() === '') return;
        commandHistory = commandHistory.filter(h => h !== cmd);
        commandHistory.push(cmd);
        if (commandHistory.length > 100) commandHistory.shift();
        localStorage.setItem('terminal_history', JSON.stringify(commandHistory));
    }

    // Drag and Drop Upload
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        terminalBody.classList.add('drag-over');
    });

    document.addEventListener('dragleave', () => {
        terminalBody.classList.remove('drag-over');
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        terminalBody.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        for (let file of files) {
            await handleFileUpload(file);
        }
    });

    async function handleFileUpload(file) {
        appendOutput(`<span class="info-message">Uploading ${file.name}...</span>`);
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('/upload', {
                method: 'POST',
                headers: { 'X-Terminal-Password': password },
                body: formData
            });
            const data = await response.json();
            
            if (data.success) {
                appendOutput(`<span class="success-text">Successfully uploaded ${file.name}</span>`);
            } else {
                appendOutput(`<span class="error-text">Upload failed: ${data.error}</span>`);
            }
        } catch (err) {
            appendOutput(`<span class="error-text">Network error during upload</span>`);
        }
    }

    // Focus input on click anywhere in terminal
    terminalBody.addEventListener('click', () => {
        input.focus();
    });

    // Check for password
    if (!password) {
        appendOutput('<span class="info-message">Password required to start terminal.</span>');
        promptTop.innerHTML = getTopBarHTML('Login');
        input.type = 'password';
    }

    input.addEventListener('input', () => {
        if (!password) return;
        updateMirror();
    });

    async function updateMirror() {
        const val = input.value;
        const firstWord = val.split(/\s+/)[0];
        
        // Autosuggestion logic
        if (val) {
            const match = commandHistory.find(h => h.startsWith(val) && h !== val);
            ghostSuggestion = match ? match.substring(val.length) : '';
        } else {
            ghostSuggestion = '';
        }

        // Syntax highlighting logic (debounced validation)
        if (firstWord && firstWord !== lastValidatedCommand) {
            lastValidatedCommand = firstWord;
            try {
                const response = await fetch(`/validate-command?command=${encodeURIComponent(firstWord)}`, {
                    headers: { 'X-Terminal-Password': password }
                });
                const data = await response.json();
                isCommandValid = data.valid;
            } catch (e) {
                isCommandValid = true; // Fallback to neutral/valid
            }
        }

        renderMirroredText(val);
    }

    function renderMirroredText(val) {
        const words = val.split(/(\s+)/);
        const firstWord = words[0];
        const rest = words.slice(1).join('');
        
        let html = '';
        if (firstWord) {
            const colorClass = isCommandValid ? 'highlight-command-valid' : 'highlight-command-invalid';
            html += `<span class="${colorClass}">${firstWord}</span>`;
        }
        html += `<span class="highlight-arg">${rest}</span>`;
        if (ghostSuggestion) {
            html += `<span class="highlight-ghost">${ghostSuggestion}</span>`;
        }
        mirroredInput.innerHTML = html;
    }

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            handleAutocomplete();
            return;
        }

        // Auto-complete suggestion with Right Arrow or End
        if ((e.key === 'ArrowRight' || e.key === 'End') && ghostSuggestion && input.selectionStart === input.value.length) {
            e.preventDefault();
            input.value += ghostSuggestion;
            updateMirror();
            return;
        }

        // Reset suggestions if any other key is pressed
        if (e.key !== 'Tab') {
            suggestions = [];
            suggestionIndex = -1;
        }
        if (e.key === 'Enter') {
            const val = input.value;
            input.value = '';
            mirroredInput.innerHTML = ''; // Clear mirror on enter

            if (!password) {
                password = val;
                localStorage.setItem('terminal_password', password);
                input.type = 'text';
                appendOutput('<span class="success-text">Password set. Welcome!</span>');
                updateMirror();
                return;
            }

            const command = val.trim();
            if (command) {
                addToHistory(command);
                if (command === 'logout') {
                    logout();
                } else if (command === 'clear') {
                    outputContainer.innerHTML = '';
                } else {
                    await executeCommandStreaming(command);
                }
            }
            scrollToBottom();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                input.value = commandHistory[commandHistory.length - 1 - historyIndex];
                updateMirror();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                input.value = commandHistory[commandHistory.length - 1 - historyIndex];
                updateMirror();
            } else if (historyIndex === 0) {
                historyIndex = -1;
                input.value = '';
                updateMirror();
            }
        }
    });

    function addToHistory(command) {
        if (!command || command.trim() === '') return;
        commandHistory = commandHistory.filter(h => h !== command);
        commandHistory.push(command);
        if (commandHistory.length > 100) commandHistory.shift();
        localStorage.setItem('terminal_history', JSON.stringify(commandHistory));
        historyIndex = -1;
    }

    function logout() {
        localStorage.removeItem('terminal_password');
        password = '';
        input.type = 'password';
        appendOutput('<span class="info-message">Logged out. Enter password to continue.</span>');
    }

    let editor;
    const editorModal = document.getElementById('editor-modal');
    const editorContainer = document.getElementById('editor-container');
    const editorSaveBtn = document.getElementById('editor-save');
    const editorCloseBtn = document.getElementById('editor-close');
    const editorTitle = document.getElementById('editor-title');
    let currentEditingPath = '';

    // Initialize Ace Editor
    if (window.ace) {
        editor = ace.edit("editor-container");
        editor.setTheme("ace/theme/monokai");
        editor.session.setMode("ace/mode/ruby");
        editor.setOptions({
            fontSize: "14px",
            showPrintMargin: false,
            enableBasicAutocompletion: true,
            useSoftTabs: true
        });

        // Shortcuts
        editor.commands.addCommand({
            name: 'save',
            bindKey: {win: 'Ctrl-S',  mac: 'Command-S'},
            exec: () => saveFile()
        });
        editor.commands.addCommand({
            name: 'close',
            bindKey: {win: 'Esc',  mac: 'Esc'},
            exec: () => closeEditor()
        });
    }

    editorSaveBtn.addEventListener('click', saveFile);
    editorCloseBtn.addEventListener('click', closeEditor);

    async function openEditor(filename) {
        if (!editor && window.ace) {
            editor = ace.edit("editor-container");
            editor.setTheme("ace/theme/monokai");
            editor.session.setMode("ace/mode/ruby");
            editor.setOptions({
                fontSize: "14px",
                showPrintMargin: false,
                enableBasicAutocompletion: true,
                useSoftTabs: true
            });
        }

        if (!editor) {
            appendOutput('<span class="error-text">Editor library (Ace) is still loading. Please wait 1-2 seconds and try again.</span>');
            return;
        }

        const basePath = fullPath || '.';
        currentEditingPath = `${basePath}/${filename}`.replace(/\/\//g, '/');
        editorTitle.innerText = `Editing: ${filename}`;
        
        try {
            const params = new URLSearchParams({ path: currentEditingPath });
            appendOutput(`<span class="info-message">Opening ${filename}...</span>`);
            
            const response = await fetch(`/read-file?${params.toString()}`, {
                headers: { 'X-Terminal-Password': password }
            });
            const data = await response.json();
            
            if (data.error) {
                appendOutput(`<span class="error-text">Error reading file: ${data.error}</span>`);
                return;
            }
            
            editor.setValue(data.content, -1);
            
            // Set mode based on extension
            const ext = filename.split('.').pop();
            const modeMap = {
                'rb': 'ruby', 'js': 'javascript', 'html': 'html', 'css': 'css',
                'md': 'markdown', 'json': 'json', 'ru': 'ruby', 'txt': 'text'
            };
            editor.session.setMode(`ace/mode/${modeMap[ext] || 'text'}`);
            
            editorModal.classList.remove('hidden');
            setTimeout(() => {
                editorModal.classList.add('active');
                editor.resize();
                editor.focus();
            }, 10);
            
            // Second resize after animation finishes
            setTimeout(() => editor.resize(), 310);
        } catch (err) {
            appendOutput(`<span class="error-text">Failed to open editor: ${err.message}</span>`);
        }
    }

    async function saveFile() {
        if (!currentEditingPath) return;
        
        try {
            const response = await fetch('/write-file', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Terminal-Password': password
                },
                body: JSON.stringify({
                    path: currentEditingPath,
                    content: editor.getValue()
                })
            });
            const data = await response.json();
            if (data.success) {
                appendOutput(`<span class="success-text">Saved ${currentEditingPath}</span>`);
            } else {
                appendOutput(`<span class="error-text">Save failed: ${data.error}</span>`);
            }
        } catch (err) {
            appendOutput(`<span class="error-text">Network error while saving</span>`);
        }
    }

    function closeEditor() {
        editorModal.classList.remove('active');
        setTimeout(() => editorModal.classList.add('hidden'), 300);
        input.focus();
    }

    async function executeCommandStreaming(command) {
        if (!command.trim()) return;
        addToHistory(command); // Use existing addToHistory function
        // historyIndex = -1; // addToHistory already resets this

        // Echo command: Full bar + Bottom prompt
        appendOutput(`${getTopBarHTML()}<div class="input-wrapper" style="display:flex; align-items:center;"><span class="prompt-bottom">❯</span><span class="command-text">${command}</span></div>`, true);

        const cmdParts = command.trim().split(/\s+/);
        if (cmdParts[0] === 'logout') {
            logout();
            return;
        } else if (cmdParts[0] === 'clear') {
            outputContainer.innerHTML = '';
            return;
        } else if (cmdParts[0] === 'nano' && cmdParts[1]) {
            openEditor(cmdParts[1]);
            return;
        }

        if (command === 'help') {
            appendOutput(`\u001b[36mEksa Web Terminal v1.0.0 Help\u001b[0m
\u001b[32mFitur Utama:\u001b[0m
  - \u001b[33mnano <file>\u001b[0m : Membuka Web Editor premium.
  - \u001b[33mTab\u001b[0m         : Autocomplete nama file/folder.
  - \u001b[33mArrow Up/Dn\u001b[0m : Navigasi riwayat perintah.
  - \u001b[33mRight Arrow\u001b[0m : Melengkapi suggestion (ghost text).
  - \u001b[32mHighlighting\u001b[0m: Hijau (perintah valid), Merah (salah).

\u001b[32mPerintah Dasar:\u001b[0m
  - \u001b[1mhelp\u001b[0m       : Menampilkan bantuan ini.
  - \u001b[1mclear\u001b[0m      : Membersihkan layar terminal.
  - \u001b[1mlogout\u001b[0m     : Keluar dan reset password.
  - \u001b[1mls\u001b[0m         : Melihat daftar file (aman/tersembunyi).
  - \u001b[1mcd <dir>\u001b[0m   : Pindah folder (terkunci di dalam project).
  - \u001b[1mpwd\u001b[0m        : Melihat lokasi folder saat ini.`);
            return;
        }

        const params = new URLSearchParams({
            command: command,
            cwd: fullPath || '',
            password: password
        });

        return new Promise((resolve) => {
            const eventSource = new EventSource(`/stream?${params.toString()}`);
            let lastLineElement = null;

            eventSource.onmessage = (event) => {
                if (event.data === '[DONE]') {
                    eventSource.close();
                    resolve();
                    return;
                }

                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.output) {
                        appendOutput(data.output, false); // false = parse ANSI
                    }
                    
                    if (data.error) {
                        appendOutput(`<span class="error-text">${data.error}</span>`);
                    }
                    
                    if (data.directory) {
                        fullPath = data.directory;
                        localStorage.setItem('terminal_full_path', fullPath);
                        gitBranch = data.git || '';
                        updatePromptUI(data.display_path || fullPath);
                    }
                } catch (e) {
                    console.error("Error parsing SSE data", e);
                }
            };

            eventSource.onerror = (err) => {
                appendOutput('<span class="error-text">Connection error or unauthorized. Type "logout" if you need to reset password.</span>');
                eventSource.close();
                resolve();
            };
        });
    }

    function appendOutput(content, isHtml = false) {
        const div = document.createElement('div');
        div.className = 'output-line';
        if (isHtml) {
            div.innerHTML = content.replace(/\n/g, '<br>');
        } else {
            div.innerHTML = ansiToHtml(content).replace(/\n/g, '<br>');
        }
        outputContainer.appendChild(div);
        scrollToBottom();
    }


    function getTopBarHTML(customDir = null) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const dir = customDir || fullPath || currentDirectory;
        
        return `<div class="prompt-top"><div class="prompt-left"><span class="gradient-blocks">░▒▓</span><span class="directory">${dir}</span>${gitBranch ? `<span class="ansi-yellow"> ${gitBranch}</span>` : ''}</div><div class="prompt-right">at ${timeStr} <span class="gradient-blocks">▓▒░</span></div></div>`;
    }

    function getPromptHTML() {
        return `<span class="prompt-bottom">❯</span>`;
    }

    function ansiToHtml(text) {
        const colorMap = {
            '30': 'ansi-black', '31': 'ansi-red', '32': 'ansi-green', '33': 'ansi-yellow',
            '34': 'ansi-blue', '35': 'ansi-magenta', '36': 'ansi-cyan', '37': 'ansi-white',
            '90': 'ansi-bright-black', '91': 'ansi-bright-red', '92': 'ansi-bright-green',
            '93': 'ansi-bright-yellow', '94': 'ansi-bright-blue', '95': 'ansi-bright-magenta',
            '96': 'ansi-bright-cyan', '97': 'ansi-bright-white'
        };

        // Aggressive regex that handles missing escape character if it looks like an ANSI code
        const regex = /(?:[\u001b\x1b\x1B]|\\x1b|\\u001b)?\[([\d;]*)m/g;
        let openSpans = 0;
        
        let result = text.replace(regex, (match, codes) => {
            let html = '';
            const codeList = codes.split(';');
            
            for (const code of codeList) {
                const c = parseInt(code) || 0;
                if (c === 0) {
                    while (openSpans > 0) {
                        html += '</span>';
                        openSpans--;
                    }
                } else if (c === 1) {
                    html += '<span class="bold">';
                    openSpans++;
                } else if (colorMap[code]) {
                    html += `<span class="${colorMap[code]}">`;
                    openSpans++;
                }
            }
            return html;
        });

        while (openSpans > 0) {
            result += '</span>';
            openSpans--;
        }

        return result;
    }

    async function handleAutocomplete() {
        const text = input.value;
        const words = text.split(' ');
        const lastWord = words[words.length - 1];

        if (suggestions.length === 0) {
            try {
                const params = new URLSearchParams({
                    cwd: fullPath || '',
                    prefix: lastWord
                });
                const response = await fetch(`/autocomplete?${params.toString()}`, {
                    headers: { 'X-Terminal-Password': password }
                });
                const data = await response.json();
                
                if (data.matches && data.matches.length > 0) {
                    suggestions = data.matches;
                    suggestionIndex = 0;
                }
            } catch (err) {
                console.error("Autocomplete error", err);
            }
        } else {
            suggestionIndex = (suggestionIndex + 1) % suggestions.length;
        }

        if (suggestions.length > 0) {
            words[words.length - 1] = suggestions[suggestionIndex];
            input.value = words.join(' ');
        }
    }

    function updatePromptUI(pathOrDisplay) {
        if (pathOrDisplay === '~' || !pathOrDisplay) {
            currentDirectory = '~';
        } else {
            const parts = pathOrDisplay.split('/');
            currentDirectory = parts[parts.length - 1];
        }
        
        localStorage.setItem('terminal_cwd', currentDirectory);
        promptTop.innerHTML = getTopBarHTML();
        promptBottomSymbol.innerHTML = '❯';
    }

    function scrollToBottom() {
        terminalBody.scrollTop = terminalBody.scrollHeight;
    }
});
