/**
 * AetherTranslate - Live Telugu Speech to English Subtitles
 * Main Application Logic
 */

// --- Global Application State ---
const state = {
    isListening: false,
    isAutoRestarting: false,
    recognition: null,
    silenceTimer: null,
    sessionTimer: null,
    sessionSeconds: 0,
    teluguBuffer: '',
    bufferTimeout: null,
    lastTranslationTime: 0,
    localTranslator: null,
    translationInterval: null,
    currentGeminiKeyIndex: 0,
    successfulGeminiModel: null,
    successfulGeminiVersion: null,
    history: [], // Array of { timestamp: string, telugu: string, english: string }
    settings: {
        engine: 'gemini',
        geminiKey: '',
        openaiKey: '',
        sourceLang: 'te-IN',
        fontSize: '1.6rem',
        bgOpacity: 75,
        autoRestart: true
    },
    windowState: {
        x: null,
        y: null,
        width: 600,
        height: 280
    }
};

// --- DOM Element Selectors ---
const elements = {
    // Buttons
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    btnSettings: document.getElementById('btn-settings'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnResetWindow: document.getElementById('btn-reset-window'),
    btnCopyTranscript: document.getElementById('btn-copy-transcript'),
    btnDownloadTranscript: document.getElementById('btn-download-transcript'),
    btnClearTranscript: document.getElementById('btn-clear-transcript'),
    setupKeysLink: document.getElementById('setup-keys-link'),
    
    // Status indicators
    micStatusDot: document.getElementById('mic-status-dot'),
    micStatusText: document.getElementById('mic-status-text'),
    engineStatusText: document.getElementById('engine-status-text'),
    sessionTime: document.getElementById('session-time'),
    
    // Subtitle Floating Window
    subtitleWindow: document.getElementById('subtitle-window'),
    subtitleWindowHeader: document.getElementById('subtitle-window-header'),
    subtitleContainer: document.getElementById('subtitle-container'),
    subtitleList: document.getElementById('subtitle-list'),
    
    // Panels & Modals
    settingsModal: document.getElementById('settings-modal'),
    transcriptHistoryList: document.getElementById('transcript-history-list'),
    toastContainer: document.getElementById('toast-container'),
    
    // Settings inputs
    inputGeminiKey: document.getElementById('gemini-key'),
    inputOpenaiKey: document.getElementById('openai-key'),
    selectSourceLang: document.getElementById('settings-source-lang'),
    selectFontSize: document.getElementById('settings-font-size'),
    inputBgOpacity: document.getElementById('settings-bg-opacity'),
    bgOpacityVal: document.getElementById('bg-opacity-val'),
    checkAutoRestart: document.getElementById('settings-auto-restart'),
    radioEngines: document.getElementsByName('trans-engine'),
    groupGeminiKey: document.getElementById('group-gemini-key'),
    groupOpenaiKey: document.getElementById('group-openai-key')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initSpeechRecognition();
    initDraggableWindow();
    initResizeObserver();
    registerEventHandlers();
    applyUITheme();
    initTestAudioPlayer();
    
    // Show a welcome toast
    showToast('AetherTranslate loaded successfully!', 'info');
});

// --- Settings & State Persistence ---
function loadSettings() {
    // Load general settings
    const savedSettings = localStorage.getItem('aether_settings');
    if (savedSettings) {
        try {
            state.settings = { ...state.settings, ...JSON.parse(savedSettings) };
        } catch (e) {
            console.error('Failed to parse settings', e);
        }
    }
    
    // Load floating window state
    const savedWindowState = localStorage.getItem('aether_window_state');
    if (savedWindowState) {
        try {
            state.windowState = { ...state.windowState, ...JSON.parse(savedWindowState) };
        } catch (e) {
            console.error('Failed to parse window state', e);
        }
    }
    
    // Load transcript history
    const savedHistory = localStorage.getItem('aether_history');
    if (savedHistory) {
        try {
            state.history = JSON.parse(savedHistory);
            renderHistoryList();
        } catch (e) {
            console.error('Failed to parse history', e);
        }
    }
    
    // Sync to UI controls
    elements.inputGeminiKey.value = state.settings.geminiKey || '';
    elements.inputOpenaiKey.value = state.settings.openaiKey || '';
    if (elements.selectSourceLang) {
        elements.selectSourceLang.value = state.settings.sourceLang || 'te-IN';
    }
    elements.selectFontSize.value = state.settings.fontSize || '1.6rem';
    elements.inputBgOpacity.value = state.settings.bgOpacity || 75;
    elements.bgOpacityVal.textContent = `${state.settings.bgOpacity || 75}%`;
    elements.checkAutoRestart.checked = state.settings.autoRestart !== false;
    
    // Sync Engine Radio Buttons
    Array.from(elements.radioEngines).forEach(radio => {
        if (radio.value === state.settings.engine) {
            radio.checked = true;
            radio.closest('.engine-option').classList.add('active');
        } else {
            radio.closest('.engine-option').classList.remove('active');
        }
    });
    
    updateEngineStatusLabel();
    toggleApiKeyInputs(state.settings.engine);
}

function saveSettings() {
    const oldLang = state.settings.sourceLang;

    // Sync from UI controls
    state.settings.geminiKey = elements.inputGeminiKey.value.trim();
    state.settings.openaiKey = elements.inputOpenaiKey.value.trim();
    if (elements.selectSourceLang) {
        state.settings.sourceLang = elements.selectSourceLang.value;
    }
    state.settings.fontSize = elements.selectFontSize.value;
    state.settings.bgOpacity = parseInt(elements.inputBgOpacity.value, 10);
    state.settings.autoRestart = elements.checkAutoRestart.checked;
    
    // Sync engine
    const selectedEngine = Array.from(elements.radioEngines).find(r => r.checked);
    if (selectedEngine) {
        state.settings.engine = selectedEngine.value;
    }
    
    localStorage.setItem('aether_settings', JSON.stringify(state.settings));
    
    // Apply immediately
    applyUITheme();
    updateEngineStatusLabel();
    adjustFontSizeToFit();
    showToast('Settings saved and applied!', 'success');

    // If source language was changed dynamically while listening, trigger restart
    if (state.settings.sourceLang !== oldLang && state.isListening) {
        showToast('Speech language changed. Restarting mic session...', 'info');
        stopListening();
        setTimeout(startListening, 600);
    }
}

function applyUITheme() {
    // Opacity
    document.documentElement.style.setProperty('--window-bg-opacity', (state.settings.bgOpacity / 100).toFixed(2));
    
    // Subtitle base font size
    document.documentElement.style.setProperty('--text-subtitles-base-size', state.settings.fontSize);
    
    // Floating Window position and dimensions
    const win = elements.subtitleWindow;
    if (state.windowState.width) win.style.width = `${state.windowState.width}px`;
    if (state.windowState.height) win.style.height = `${state.windowState.height}px`;
    
    if (state.windowState.x !== null && state.windowState.y !== null) {
        win.style.left = `${state.windowState.x}px`;
        win.style.top = `${state.windowState.y}px`;
        win.style.bottom = 'auto';
        win.style.right = 'auto';
    } else {
        // Default: Bottom Right
        win.style.left = '';
        win.style.top = '';
        win.style.bottom = '40px';
        win.style.right = '40px';
    }
}

function updateEngineStatusLabel() {
    let name = 'Free (Limited)';
    if (state.settings.engine === 'gemini') {
        name = 'Gemini API';
    } else if (state.settings.engine === 'openai') {
        name = 'OpenAI API';
    } else if (state.settings.engine === 'local') {
        name = 'Local AI Model';
    } else if (state.settings.engine === 'googleweb') {
        name = 'Google Translate Web';
    }
    elements.engineStatusText.textContent = name;
}

// --- Speech Recognition Setup ---
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Web Speech API is not supported in this browser. Please use Google Chrome or Microsoft Edge.', 'error');
        elements.micStatusDot.className = 'status-dot error';
        elements.micStatusText.textContent = 'Unsupported Browser';
        elements.btnStart.disabled = true;
        return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = state.settings.sourceLang || 'te-IN';
    
    recognition.onstart = () => {
        state.isListening = true;
        updateListeningUI(true);
        startSessionTimer();
        
        // Only show toast on manual start, not on automatic silent restarts
        if (!state.isAutoRestarting) {
            showToast('Microphone active. Start speaking in Telugu.', 'success');
        }
        state.isAutoRestarting = false; // Reset flag
    };
    
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        
        const fatalErrors = [
            'not-allowed', 
            'audio-capture', 
            'service-not-allowed', 
            'language-not-supported', 
            'bad-grammar',
            'aborted'
        ];
        
        if (fatalErrors.includes(event.error)) {
            let msg = `Speech recognition failed: ${event.error}.`;
            if (event.error === 'not-allowed') {
                msg = 'Microphone access denied. Please check site permissions in your browser.';
            } else if (event.error === 'audio-capture') {
                msg = 'Audio capture failed. Ensure your microphone is connected and not in use by another app.';
            } else if (event.error === 'service-not-allowed') {
                msg = 'Speech recognition service is blocked by the browser.';
            } else if (event.error === 'aborted') {
                msg = 'Speech recognition was aborted. Please check your browser mic permissions or refresh the page.';
            }
            showToast(msg, 'error');
            stopListening();
        } else if (event.error === 'network') {
            showToast('Network error during speech recognition. Re-establishing connection...', 'warning');
            // Try to let the auto-restart loop recover from transient network drops
        }
        // Non-fatal errors like 'no-speech' are ignored here, letting the onend handler restart silently
    };
    
    recognition.onend = () => {
        // Auto-restart loop to support long 2-hour continuous sessions
        if (state.isListening && state.settings.autoRestart) {
            console.log('Audio stream ended. Scheduling safety auto-restart...');
            state.isAutoRestarting = true; // Set flag to suppress toast spam
            
            setTimeout(() => {
                if (state.isListening) {
                    try {
                        recognition.start();
                    } catch (e) {
                        console.error('Failed to restart speech recognition. Retrying with abort...', e);
                        try { recognition.abort(); } catch (abortErr) {}
                        setTimeout(() => {
                            if (state.isListening) {
                                try { 
                                    state.isAutoRestarting = true;
                                    recognition.start(); 
                                } catch (retryErr) {
                                    console.error('Final retry failed:', retryErr);
                                }
                            }
                        }, 1000);
                    }
                }
            }, 300); // 300ms safety gap to let the device state clear
        } else {
            updateListeningUI(false);
            stopSessionTimer();
        }
    };
    
    recognition.onresult = (event) => {
        let finalTranscript = '';
        
        // Loop through results
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript + ' ';
            }
        }
        
        const cleanText = finalTranscript.trim();
        if (cleanText.length > 0) {
            // Append to buffer
            state.teluguBuffer = (state.teluguBuffer + ' ' + cleanText).trim();
            console.log('Buffered Telugu:', state.teluguBuffer);
        }
    };
    
    state.recognition = recognition;
}

// Periodically flushes the speech buffer to avoid API call blockages and rate limit hits during continuous speech
function periodicBufferCheck() {
    if (!state.teluguBuffer) return;
    
    const now = Date.now();
    const timeSinceLast = now - state.lastTranslationTime;
    const minInterval = 4500; // 4.5 seconds safety window (15 RPM protection)
    
    if (timeSinceLast >= minInterval) {
        const textToTranslate = state.teluguBuffer;
        state.teluguBuffer = '';
        state.lastTranslationTime = now;
        handleFinalTeluguSentence(textToTranslate);
    }
}

function startListening() {
    if (!state.recognition) return;
    try {
        state.isListening = true; // Set active immediately to prevent double starts
        state.recognition.lang = state.settings.sourceLang || 'te-IN'; // Apply current language preference
        state.recognition.start();
        
        // Start the periodic buffer check loop (every 3 seconds)
        if (state.translationInterval) clearInterval(state.translationInterval);
        state.translationInterval = setInterval(periodicBufferCheck, 3000);
    } catch (e) {
        console.error('Failed to start recognition:', e);
        state.isListening = false;
        try { state.recognition.abort(); } catch (abortErr) {}
        updateListeningUI(false);
        stopSessionTimer();
        showToast('Microphone initialization failed or device busy.', 'error');
    }
}

function stopListening() {
    state.isListening = false;
    
    // Clear buffer check interval
    if (state.translationInterval) {
        clearInterval(state.translationInterval);
        state.translationInterval = null;
    }
    
    // Clear any fallback timeout
    if (state.bufferTimeout) {
        clearTimeout(state.bufferTimeout);
        state.bufferTimeout = null;
    }
    
    // Flush remaining text immediately, bypassing the rate limit delay
    if (state.teluguBuffer) {
        const textToTranslate = state.teluguBuffer;
        state.teluguBuffer = '';
        state.lastTranslationTime = Date.now();
        handleFinalTeluguSentence(textToTranslate);
    }
    
    if (state.recognition) {
        state.recognition.stop();
    }
    updateListeningUI(false);
    stopSessionTimer();
    showToast('Subtitles stopped.', 'info');
}

function updateListeningUI(active) {
    if (active) {
        elements.micStatusDot.className = 'status-dot active';
        elements.micStatusText.textContent = 'Listening (Telugu)';
        elements.btnStart.disabled = true;
        elements.btnStop.disabled = false;
        elements.subtitleWindow.classList.add('is-listening');
        
        // Clear initial tip if starting fresh
        const initialTip = elements.subtitleList.querySelector('.initial-tip');
        if (initialTip) {
            initialTip.remove();
        }
    } else {
        elements.micStatusDot.className = 'status-dot';
        elements.micStatusText.textContent = 'Inactive';
        elements.btnStart.disabled = false;
        elements.btnStop.disabled = true;
        elements.subtitleWindow.classList.remove('is-listening');
    }
}

// --- Session Timer (2 Hours Tracker) ---
function startSessionTimer() {
    if (state.sessionTimer) return;
    state.sessionTimer = setInterval(() => {
        state.sessionSeconds++;
        const hrs = String(Math.floor(state.sessionSeconds / 3600)).padStart(2, '0');
        const mins = String(Math.floor((state.sessionSeconds % 3600) / 60)).padStart(2, '0');
        const secs = String(state.sessionSeconds % 60).padStart(2, '0');
        elements.sessionTime.textContent = `${hrs}:${mins}:${secs}`;
    }, 1000);
}

function stopSessionTimer() {
    if (state.sessionTimer) {
        clearInterval(state.sessionTimer);
        state.sessionTimer = null;
    }
}

// --- Translation Core ---
async function handleFinalTeluguSentence(teluguText) {
    console.log('Received Telugu Speech:', teluguText);
    
    // Show a loading indicator in the subtitles list
    const tempLineId = addSubtitlePlaceholder();
    
    try {
        const translatedText = await translateTeluguToEnglish(teluguText, (progressText) => {
            updateSubtitleLine(tempLineId, progressText);
        });
        updateSubtitleLine(tempLineId, translatedText);
        
        // Log into transcript history
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        logHistoryItem(timestamp, teluguText, translatedText);
    } catch (error) {
        console.error('Translation error:', error);
        updateSubtitleLine(tempLineId, `[Translation Error: ${error.message}]`);
    }
}

async function translateTeluguToEnglish(text, onProgress) {
    const engine = state.settings.engine;
    
    if (engine === 'local') {
        return await translateWithLocalModel(text, onProgress);
    }
    
    if (engine === 'gemini') {
        const rawKey = state.settings.geminiKey;
        if (!rawKey) {
            throw new Error('Gemini API key is missing. Please configure it in Settings.');
        }
        const keys = rawKey.split(',').map(k => k.trim()).filter(Boolean);
        if (keys.length === 0) {
            throw new Error('Gemini API key is invalid or empty.');
        }
        return await translateWithGemini(text, keys);
    } 
    
    if (engine === 'openai') {
        const apiKey = state.settings.openaiKey;
        if (!apiKey) {
            throw new Error('OpenAI API key is missing. Please configure it in Settings.');
        }
        return await translateWithOpenAI(text, apiKey);
    }
    
    if (engine === 'googleweb') {
        return await translateWithGoogleWeb(text);
    }
    
    // Default to free translation engine (MyMemory API)
    return await translateWithFreeAPI(text);
}

// 4. Local AI Model (Using Transformers.js client-side)
async function translateWithLocalModel(text, onProgress) {
    if (!state.localTranslator) {
        if (onProgress) onProgress('[Loading Local AI Engine...]');
        
        try {
            // Import Transformers.js dynamically from CDN
            const module = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2');
            
            // Configure model loading progress
            if (onProgress) onProgress('[Downloading model (~350MB)... 0%]');
            
            // Attempt to load using WebGPU for high-speed hardware acceleration
            try {
                state.localTranslator = await module.pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
                    device: 'webgpu',
                    progress_callback: (info) => {
                        if (info.status === 'progress' && onProgress) {
                            const pct = Math.round(info.progress || 0);
                            onProgress(`[Downloading Local AI (GPU): ${pct}%]`);
                        } else if (info.status === 'ready' && onProgress) {
                            onProgress('[Initializing GPU weights...]');
                        }
                    }
                });
                showToast('Local AI initialized with WebGPU hardware acceleration!', 'success');
            } catch (gpuError) {
                console.warn('WebGPU not supported, falling back to CPU (WASM):', gpuError);
                if (onProgress) onProgress('[WebGPU failed. Falling back to CPU...]');
                
                state.localTranslator = await module.pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
                    device: 'wasm',
                    progress_callback: (info) => {
                        if (info.status === 'progress' && onProgress) {
                            const pct = Math.round(info.progress || 0);
                            onProgress(`[Downloading Local AI (CPU): ${pct}%]`);
                        } else if (info.status === 'ready' && onProgress) {
                            onProgress('[Initializing CPU weights...]');
                        }
                    }
                });
                showToast('Loaded Local AI on CPU (slower). Chrome is recommended for GPU speed.', 'info');
            }
        } catch (err) {
            console.error('Failed to load local model:', err);
            throw new Error(`Local model download failed: ${err.message}. Ensure internet connection.`);
        }
    }
    
    if (onProgress) onProgress('[Translating with local AI...]');
    
    const output = await state.localTranslator(text, {
        src_lang: 'tel_Telu', // Telugu (India) code in NLLB-200
        tgt_lang: 'eng_Latn', // English (Latin) code in NLLB-200
        num_beams: 4,         // Use beam search to choose highly accurate word paths (better quality)
        max_new_tokens: 256   // Prevent sentence truncation
    });
    
    const resultText = output[0]?.translation_text;
    if (!resultText) {
        throw new Error('Local translation output is empty.');
    }
    return resultText;
}

// 1. Google Gemini API Call (With automatic model, version, and error intelligence)
async function translateWithGemini(text, keys) {
    const prompt = `You are an expert real-time translator. First, correct any minor spelling or transcription errors in the input Telugu text to match the spoken context. Then, translate it to SIMPLE, EASY-TO-UNDERSTAND English. Avoid advanced vocabulary or complex words (for example, use "happy/celebrating" instead of "rejoicing", "tell" instead of "indicates", etc.). You MUST output ONLY the direct, natural, and simple English translation. Do NOT output explanations, notes, introductory text, formatting tags, or quotes.
Telugu transcript to translate: "${text}"`;

    const apiVersions = ['v1', 'v1beta'];
    const modelNames = [
        'gemini-1.5-flash',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-pro',
        'gemini-pro'
    ];

    let lastError = null;

    // Loop through all keys provided (for failover/load balancing)
    for (let k = 0; k < keys.length; k++) {
        // Get the key (cycling using a state index to balance requests)
        const keyIndex = (state.currentGeminiKeyIndex + k) % keys.length;
        const activeKey = keys[keyIndex];

        const endpoints = [];
        
        // Prioritize the previously successful model and version at index 0 for speed!
        if (state.successfulGeminiModel && state.successfulGeminiVersion) {
            endpoints.push({
                url: `https://generativelanguage.googleapis.com/${state.successfulGeminiVersion}/models/${state.successfulGeminiModel}:generateContent`,
                model: state.successfulGeminiModel,
                version: state.successfulGeminiVersion
            });
        }
        
        for (const model of modelNames) {
            for (const version of apiVersions) {
                // Avoid duplication of the prioritized endpoint
                if (model === state.successfulGeminiModel && version === state.successfulGeminiVersion) {
                    continue;
                }
                endpoints.push({
                    url: `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`,
                    model,
                    version
                });
            }
        }

        for (const endpoint of endpoints) {
            // Set up a 18-second request timeout to prevent hanging translations
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 18000);

            try {
                const response = await fetch(endpoint.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': activeKey
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: prompt
                            }]
                        }]
                    })
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (resultText) {
                        resultText = resultText.trim().replace(/^["']|["']$/g, '');
                        // Successfully translated! Cache this working endpoint configuration
                        state.successfulGeminiModel = endpoint.model;
                        state.successfulGeminiVersion = endpoint.version;
                        
                        // Advance key index for next call
                        state.currentGeminiKeyIndex = (keyIndex + 1) % keys.length;
                        return resultText;
                    }
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    const errMsg = errorData.error?.message || response.statusText;
                    const errStatus = response.status;

                    lastError = new Error(`Gemini API error: ${errMsg}`);
                    console.warn(`Key index ${keyIndex} failed (${endpoint.model} on ${endpoint.version}, Status ${errStatus}): ${errMsg}`);

                    // If rate limit exceeded, we break and try the next key immediately!
                    if (errStatus === 429) {
                        lastError = new Error(`Rate limit hit on key index ${keyIndex}. Trying next key...`);
                        break; // Breaks endpoints loop to try the next key
                    }

                    // If invalid credentials (401, 403, 400), break to try the next key
                    if (errStatus === 401 || errStatus === 403 || errStatus === 400) {
                        if (errMsg.toLowerCase().includes('key') || errMsg.toLowerCase().includes('credential') || errMsg.toLowerCase().includes('unauthenticated')) {
                            lastError = new Error(`Gemini API key at index ${keyIndex} is invalid.`);
                            break;
                        }
                    }
                }
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    lastError = new Error(`Connection to Gemini timed out on key index ${keyIndex}.`);
                    break; // Try next key
                }
                lastError = err;
                console.warn(`Fetch error for key index ${keyIndex} on ${endpoint.url}:`, err);
            }
        }
    }

    throw lastError || new Error('Failed to translate with Gemini using any of the provided keys.');
}

// 2. OpenAI GPT-4o-mini API Call
async function translateWithOpenAI(text, apiKey) {
    const url = 'https://api.openai.com/v1/chat/completions';
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000); // 18-second timeout
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert real-time speech translator. First, correct any minor spelling or context transcription errors in the input Telugu text. Then, translate it to simple, easy-to-understand English. Avoid advanced vocabulary or complex words (for example, use "happy/celebrating" instead of "rejoicing", "tell" instead of "indicates", etc.). Output ONLY the simple English translation. Do not write anything else. Keep the exact sentence formation. Remove any wrapping quotes.'
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                temperature: 0.3
            })
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errMsg = errorData.error?.message || response.statusText;
            throw new Error(`OpenAI API returned error: ${errMsg}`);
        }
        
        const data = await response.json();
        let resultText = data.choices?.[0]?.message?.content;
        
        if (!resultText) {
            throw new Error('Received empty content from OpenAI.');
        }
        
        resultText = resultText.trim().replace(/^["']|["']$/g, '');
        return resultText;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('OpenAI translation timed out.');
        }
        throw err;
    }
}

// 3. Free Fallback Translation (MyMemory Translated API)
async function translateWithFreeAPI(text) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=te|en`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000); // 18-second timeout
    
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`MyMemory API returned code: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.responseStatus !== 200) {
            throw new Error(data.responseDetails || 'MyMemory translation failed');
        }
        
        return data.responseData.translatedText;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Free Translation API timed out.');
        }
        throw err;
    }
}

// 3b. Google Translate Web API (Free Fallback)
async function translateWithGoogleWeb(text) {
    const sl = 'te'; // Telugu
    const tl = 'en'; // English
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000); // 18-second timeout
    
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Google Web Translation returned code: ${response.status}`);
        }
        
        const data = await response.json();
        if (data && data[0]) {
            // Join segment translations for maximum grammatical coherence
            return data[0].map(segment => segment[0]).filter(Boolean).join('');
        }
        throw new Error('Received unexpected empty data payload from Google Web Translation.');
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Google Web Translation request timed out.');
        }
        throw err;
    }
}

// --- Subtitles Window Render and Autoscrolling ---
function addSubtitlePlaceholder() {
    const lineId = 'line-' + Math.random().toString(36).substr(2, 9);
    
    const lineDiv = document.createElement('div');
    lineDiv.id = lineId;
    lineDiv.className = 'subtitle-line';
    
    // A subtle loading animation inside subtitle window
    lineDiv.innerHTML = `<span class="loading-dots">...</span>`;
    
    elements.subtitleList.appendChild(lineDiv);
    
    // Performance limit: Keep at most 12 elements in DOM to avoid bloating
    while (elements.subtitleList.children.length > 12) {
        elements.subtitleList.firstElementChild.remove();
    }
    
    triggerAutoscroll();
    adjustFontSizeToFit();
    
    return lineId;
}

function updateSubtitleLine(lineId, text) {
    const lineDiv = document.getElementById(lineId);
    if (lineDiv) {
        lineDiv.textContent = text;
        triggerAutoscroll();
        adjustFontSizeToFit();
    }
}

function triggerAutoscroll() {
    // Scroll the container all the way down so only the 5 most recent lines are visible
    elements.subtitleContainer.scrollTop = elements.subtitleContainer.scrollHeight;
}

// --- Responsive Text Sizing ("automatically adjust texts") ---
function adjustFontSizeToFit() {
    const win = elements.subtitleWindow;
    if (!win) return;
    
    const width = win.offsetWidth;
    const height = win.offsetHeight;
    
    // 1. Calculate base size based on window width
    // Width-based size gives readable scale as width expands/contracts
    let calculatedSize = Math.max(14, Math.min(42, width / 24));
    
    // 2. Adjust size based on available window height
    // Header height is roughly 42px. Padding is 2.5rem (40px). 
    // Remaining body height = height - 82px.
    // 5 lines at 1.4 line-height requires: 5 * 1.4 * fontSize = 7.0 * fontSize.
    // So to avoid overflow height-wise, fontSize must be less than (height - 82) / 7.0
    const bodyAvailableHeight = height - 82;
    const maxFontSizeFromHeight = Math.max(12, bodyAvailableHeight / 7.0);
    
    // Choose the smaller size to ensure the text fits both dimensions perfectly!
    calculatedSize = Math.min(calculatedSize, maxFontSizeFromHeight);
    
    // Apply styling to the subtitle container to allow em-based heights to scale
    elements.subtitleContainer.style.fontSize = `${calculatedSize}px`;
}

function initResizeObserver() {
    // Monitor resizes on the subtitle window to dynamically update font sizing
    if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                // Save current dimension changes
                state.windowState.width = entry.contentRect.width;
                state.windowState.height = entry.contentRect.height;
                saveWindowState();
                
                // Adjust text size instantly
                adjustFontSizeToFit();
            }
        });
        resizeObserver.observe(elements.subtitleWindow);
    }
}

// --- Computer Window Draggable System ---
function initDraggableWindow() {
    const win = elements.subtitleWindow;
    const header = elements.subtitleWindowHeader;
    
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    
    header.addEventListener('pointerdown', dragStart);
    
    function dragStart(e) {
        // Exclude button clicks in the header
        if (e.target.closest('button')) return;
        
        isDragging = true;
        win.classList.add('is-dragging');
        
        // Grab current coordinates
        const rect = win.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        
        startX = e.clientX;
        startY = e.clientY;
        
        document.addEventListener('pointermove', dragMove);
        document.addEventListener('pointerup', dragEnd);
        
        header.setPointerCapture(e.pointerId);
    }
    
    function dragMove(e) {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        let newX = initialX + deltaX;
        let newY = initialY + deltaY;
        
        // Boundaries checks to keep window readable on screen
        const maxX = window.innerWidth - win.offsetWidth;
        const maxY = window.innerHeight - win.offsetHeight;
        
        newX = Math.max(0, Math.min(maxX, newX));
        newY = Math.max(0, Math.min(maxY, newY));
        
        win.style.left = `${newX}px`;
        win.style.top = `${newY}px`;
        win.style.right = 'auto';
        win.style.bottom = 'auto';
        
        state.windowState.x = newX;
        state.windowState.y = newY;
    }
    
    function dragEnd(e) {
        if (!isDragging) return;
        isDragging = false;
        win.classList.remove('is-dragging');
        
        document.removeEventListener('pointermove', dragMove);
        document.removeEventListener('pointerup', dragEnd);
        
        header.releasePointerCapture(e.pointerId);
        saveWindowState();
    }
}

function saveWindowState() {
    localStorage.setItem('aether_window_state', JSON.stringify(state.windowState));
}

function resetWindowPosition() {
    state.windowState.x = null;
    state.windowState.y = null;
    state.windowState.width = 600;
    state.windowState.height = 280;
    
    // Reset values in localstorage
    saveWindowState();
    
    // Reapply default theme properties
    applyUITheme();
    adjustFontSizeToFit();
    
    showToast('Window position and size reset!', 'info');
}

// --- History & Transcript Management ---
function logHistoryItem(timestamp, telugu, english) {
    const item = { timestamp, telugu, english };
    state.history.unshift(item); // Add to the top of list
    
    // Persist up to 200 items in localStorage
    if (state.history.length > 200) {
        state.history.pop();
    }
    
    localStorage.setItem('aether_history', JSON.stringify(state.history));
    renderHistoryList();
}

function renderHistoryList() {
    const list = elements.transcriptHistoryList;
    if (state.history.length === 0) {
        list.innerHTML = `<p class="history-empty-state">No transcribed segments yet. Start subtitles and speak in Telugu to begin logging history.</p>`;
        return;
    }
    
    list.innerHTML = state.history.map(item => `
        <div class="history-item">
            <div class="history-meta">
                <span class="history-time">${item.timestamp}</span>
                <span class="history-status">Translated</span>
            </div>
            <div class="history-telugu">${item.telugu}</div>
            <div class="history-english">${item.english}</div>
        </div>
    `).join('');
}

function clearHistory() {
    state.history = [];
    localStorage.removeItem('aether_history');
    renderHistoryList();
    showToast('Transcript history cleared.', 'info');
}

function copyAllTranscript() {
    if (state.history.length === 0) {
        showToast('Nothing to copy.', 'error');
        return;
    }
    
    // Format transcript: timestamp | Telugu | English
    const text = state.history
        .map(item => `[${item.timestamp}] \nTelugu:  ${item.telugu}\nEnglish: ${item.english}\n`)
        .reverse() // Chronological order
        .join('\n');
        
    navigator.clipboard.writeText(text)
        .then(() => showToast('Transcript copied to clipboard!', 'success'))
        .catch(() => showToast('Failed to copy transcript.', 'error'));
}

function downloadTranscriptAsFile() {
    if (state.history.length === 0) {
        showToast('Nothing to download.', 'error');
        return;
    }
    
    const text = state.history
        .map(item => `[${item.timestamp}] \nTelugu:  ${item.telugu}\nEnglish: ${item.english}\n`)
        .reverse()
        .join('\n');
        
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `AetherTranslate-Transcript-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
    
    showToast('Transcript downloaded.', 'success');
}

// --- Toast System ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Add custom icon based on type
    let icon = '';
    if (type === 'success') {
        icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
        icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    } else {
        icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
    
    toast.innerHTML = `${icon}<span>${message}</span>`;
    elements.toastContainer.appendChild(toast);
    
    // Animate and remove
    setTimeout(() => {
        toast.style.animation = 'toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- Event Handlers & Helper Controls ---
function registerEventHandlers() {
    // Listening buttons
    elements.btnStart.addEventListener('click', startListening);
    elements.btnStop.addEventListener('click', stopListening);
    
    // Settings actions
    elements.btnSettings.addEventListener('click', () => {
        elements.settingsModal.classList.add('open');
    });
    
    elements.setupKeysLink.addEventListener('click', (e) => {
        e.preventDefault();
        elements.settingsModal.classList.add('open');
    });
    
    elements.btnCloseSettings.addEventListener('click', () => {
        elements.settingsModal.classList.remove('open');
    });
    
    // Save settings
    elements.btnSaveSettings.addEventListener('click', () => {
        saveSettings();
        elements.settingsModal.classList.remove('open');
    });
    
    // Engine selector radios
    Array.from(elements.radioEngines).forEach(radio => {
        radio.addEventListener('change', (e) => {
            // Update active styling
            Array.from(elements.radioEngines).forEach(r => {
                r.closest('.engine-option').classList.toggle('active', r.checked);
            });
            toggleApiKeyInputs(e.target.value);
        });
    });
    
    // Settings Range Opacity Slider
    elements.inputBgOpacity.addEventListener('input', (e) => {
        elements.bgOpacityVal.textContent = `${e.target.value}%`;
    });
    
    // Reset window position
    elements.btnResetWindow.addEventListener('click', resetWindowPosition);
    
    // Copy / Download / Clear
    elements.btnCopyTranscript.addEventListener('click', copyAllTranscript);
    elements.btnDownloadTranscript.addEventListener('click', downloadTranscriptAsFile);
    elements.btnClearTranscript.addEventListener('click', clearHistory);
    
    // Close modal when clicking background
    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) {
            elements.settingsModal.classList.remove('open');
        }
    });
}

function toggleApiKeyInputs(engineValue) {
    if (engineValue === 'gemini') {
        elements.groupGeminiKey.classList.remove('hidden');
        elements.groupOpenaiKey.classList.add('hidden');
    } else if (engineValue === 'openai') {
        elements.groupGeminiKey.classList.add('hidden');
        elements.groupOpenaiKey.classList.remove('hidden');
    } else {
        elements.groupGeminiKey.classList.add('hidden');
        elements.groupOpenaiKey.classList.add('hidden');
    }
}

// Password toggle helper (referenced directly from index.html)
window.togglePasswordVisibility = function(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    if (input.type === 'password') {
        input.type = 'text';
    } else {
        input.type = 'password';
    }
};

// --- Offline Audio File Testing Player ---
function initTestAudioPlayer() {
    const fileInput = document.getElementById('test-audio-file');
    const fileText = document.getElementById('file-upload-text');
    const playerControls = document.getElementById('player-controls');
    const audioPlayback = document.getElementById('audio-playback');
    const btnPlay = document.getElementById('player-btn-play');
    const btnPause = document.getElementById('player-btn-pause');
    const playSpeed = document.getElementById('player-speed');
    const timeCurrent = document.getElementById('player-time-current');
    const timeDuration = document.getElementById('player-time-duration');
    const progressContainer = document.getElementById('player-progress-container');
    const progressFill = document.getElementById('player-progress-fill');

    if (!fileInput) return;

    // File selection
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
            fileText.textContent = file.name;
            const objectUrl = URL.createObjectURL(file);
            audioPlayback.src = objectUrl;
            playerControls.classList.remove('hidden');
            
            // Reset state
            btnPlay.classList.remove('hidden');
            btnPause.classList.add('hidden');
            progressFill.style.width = '0%';
            timeCurrent.textContent = '0:00';
            timeDuration.textContent = '0:00';
            audioPlayback.playbackRate = parseFloat(playSpeed.value || '1.0');
            
            showToast('Audio file loaded. Start Subtitles and click Play!', 'info');
        }
    });

    // Play button
    btnPlay.addEventListener('click', () => {
        audioPlayback.play()
            .then(() => {
                btnPlay.classList.add('hidden');
                btnPause.classList.remove('hidden');
            })
            .catch(err => {
                console.error('Audio play failed:', err);
                showToast('Failed to play audio file: ' + err.message, 'error');
            });
    });

    // Pause button
    btnPause.addEventListener('click', () => {
        audioPlayback.pause();
        btnPlay.classList.remove('hidden');
        btnPause.classList.add('hidden');
    });

    // Progress updates
    audioPlayback.addEventListener('timeupdate', () => {
        const current = audioPlayback.currentTime;
        const duration = audioPlayback.duration || 0;
        
        if (duration) {
            const percentage = (current / duration) * 100;
            progressFill.style.width = `${percentage}%`;
        }
        timeCurrent.textContent = formatAudioTime(current);
    });

    audioPlayback.addEventListener('loadedmetadata', () => {
        timeDuration.textContent = formatAudioTime(audioPlayback.duration);
    });

    audioPlayback.addEventListener('ended', () => {
        btnPlay.classList.remove('hidden');
        btnPause.classList.add('hidden');
        progressFill.style.width = '0%';
        timeCurrent.textContent = '0:00';
    });

    // Progress bar click scrubbing
    progressContainer.addEventListener('click', (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        const duration = audioPlayback.duration;
        if (duration) {
            audioPlayback.currentTime = (clickX / width) * duration;
        }
    });

    // Speed controls
    playSpeed.addEventListener('change', () => {
        audioPlayback.playbackRate = parseFloat(playSpeed.value);
    });
}

function formatAudioTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const remM = (m % 60).toString().padStart(2, '0');
        return `${h}:${remM}:${s}`;
    }
    
    return `${m}:${s}`;
}
