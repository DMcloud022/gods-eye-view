import * as Cesium from 'cesium';
import { createGevActionRunner } from './gevActions.js';

const WEB_VOICE_STATUS = {
  idle: 'OFF',
  listening: 'LISTENING',
  executing: 'PROCESSING',
  error: 'ERROR',
};

const MAX_HISTORY_TURNS = 8;
const MIN_TRANSCRIPT_CHARS = 2;

const SpeechRecognitionAPI =
  typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export class GevWebVoiceController {
  constructor({ runner, ui }) {
    this.runner = runner;
    this.ui = ui;
    this.status = 'idle';
    this.history = [];
    this.abortController = null;

    this._recognition = null;
    this._recognitionActive = false;
    this._speechSupported = Boolean(SpeechRecognitionAPI);

    this._textInput = null;
    this._textInputHandler = null;
    this._clickHandlerInstalled = false;
    this._escapeHandler = null;

    this.spaceKeyHeld = false;
    this.buttonHandler = null;
    this.tierHandler = null;
    this.annotationEventUnsubscribe = null;
  }

  isActive() {
    return this.status === 'listening' || this.status === 'executing';
  }

  async start() {
    if (this.isActive()) return;
    this._ensureTextInput();
    this._installEscapeClose();
    if (this._speechSupported) {
      this._installClickToRecord();
      this.setStatus('listening', 'Tap mic to speak');
      this._startRecognition();
    } else {
      this.setStatus('listening', 'Type a command below (mic unsupported)');
    }
  }

  // ── Text input ───────────────────────────────────────────────────────────────

  _ensureTextInput() {
    if (this._textInput) {
      this._textInput.style.removeProperty('display');
      return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type a command and press Enter…';
    input.className = 'gev-voice-text-input';

    this._textInputHandler = (e) => {
      if (e.key !== 'Enter') return;
      const text = input.value.trim();
      if (!text || this.status === 'executing') return;
      input.value = '';
      this._process(text);
    };
    input.addEventListener('keydown', this._textInputHandler);
    this._textInput = input;

    const readout = this.ui.root?.querySelector('.gev-voice-readout');
    if (readout) readout.after(input);
    else this.ui.root?.appendChild(input);
  }

  // ── Escape to close ──────────────────────────────────────────────────────────

  _installEscapeClose() {
    if (this._escapeHandler) return;
    this._escapeHandler = (e) => {
      if (e.key === 'Escape' && this.isActive()) this.stop();
    };
    document.addEventListener('keydown', this._escapeHandler);
  }

  // ── Click-to-record ──────────────────────────────────────────────────────────

  _installClickToRecord() {
    if (this._clickHandlerInstalled) return;
    const btn = this.ui?.button;
    if (!btn) return;
    const orig = this.buttonHandler;
    if (typeof orig !== 'function') return;

    const wrapped = () => {
      if (this.status === 'listening') {
        if (this._recognitionActive) {
          this._cancelRecognition();
        } else {
          this._startRecognition();
        }
        return;
      }
      orig();
    };

    this.buttonHandler = wrapped;
    btn.removeEventListener('click', orig);
    btn.addEventListener('click', wrapped);
    this._clickHandlerInstalled = true;

    if (this.ui.helpDetail) {
      this.ui.helpDetail.textContent = 'Tap mic to speak · Esc to close';
    }
    if (this.ui.root?.querySelector?.('.gev-voice-help-kicker')) {
      const kicker = this.ui.root.querySelector('.gev-voice-help-kicker');
      if (kicker) kicker.textContent = 'VOICE (FREE)';
    }
  }

  _startRecognition() {
    if (this._recognitionActive || !this._speechSupported) return;
    this._recognition = this._createRecognition();
    if (!this._recognition) return;
    try {
      this._recognitionActive = true;
      this._recognition.start();
      this.setStatus('listening', '● Listening… speak now');
    } catch (err) {
      this._recognitionActive = false;
      console.warn('[GevWebVoice] recognition.start error:', err?.message);
      this.setStatus('listening', 'Tap mic to speak');
    }
  }

  _cancelRecognition() {
    if (!this._recognitionActive) return;
    try { this._recognition?.abort(); } catch {}
    this.setStatus('listening', 'Tap mic to speak');
  }

  // ── Web Speech API ───────────────────────────────────────────────────────────

  _createRecognition() {
    if (!SpeechRecognitionAPI) return null;
    const rec = new SpeechRecognitionAPI();
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(' ')
        .trim();
      if (transcript.length >= MIN_TRANSCRIPT_CHARS) {
        this._process(transcript);
      } else if (this.status !== 'idle') {
        this.setStatus('listening', 'Tap mic to speak');
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'aborted') {
        if (this.status !== 'idle') this.setStatus('listening', 'Tap mic to speak');
        return;
      }
      if (e.error === 'no-speech') {
        if (this.status !== 'idle') this.setStatus('listening', 'No speech heard — tap to try again');
        return;
      }
      if (e.error === 'network') {
        console.warn('[GevWebVoice] Speech API network error — falling back to text input.');
        if (this.status !== 'idle') this.setStatus('listening', 'Network issue — type a command below');
        setTimeout(() => this._textInput?.focus(), 50);
        return;
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        console.warn('[GevWebVoice] Microphone permission denied:', e.error);
        this._speechSupported = false;
        if (this.status !== 'idle') this.setStatus('listening', 'Mic blocked — allow in browser settings, then refresh');
        setTimeout(() => this._textInput?.focus(), 50);
        return;
      }
      console.warn('[GevWebVoice] Speech recognition error:', e.error);
      if (this.status !== 'idle') this.setStatus('listening', 'Tap mic to speak');
    };

    rec.onend = () => {
      this._recognitionActive = false;
      if (this.status === 'listening') {
        this.setStatus('listening', 'Tap mic to speak');
      }
    };

    return rec;
  }

  // ── LLM + tool dispatch ──────────────────────────────────────────────────────

  async _process(transcript) {
    this.setStatus('executing', transcript.slice(0, 60) + (transcript.length > 60 ? '…' : ''));
    const abortCtrl = new AbortController();
    this.abortController = abortCtrl;

    try {
      const response = await fetch('/api/gev-voice/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          history: this.history.slice(-MAX_HISTORY_TURNS * 2),
          context: this._getMapContext(),
        }),
        signal: AbortSignal.any([AbortSignal.timeout(15_000), abortCtrl.signal]),
      });
      if (abortCtrl.signal.aborted) return;

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        const msg = response.status === 429 ? 'Too many requests — wait a moment'
          : response.status >= 500 ? 'Voice service error — tap to retry'
          : 'Voice unavailable — tap to retry';
        if (this.status !== 'idle') this.setStatus('listening', msg);
        return;
      }
      const { reply = '', tool_calls = [] } = data;

      let toolError = null;
      for (const tc of tool_calls) {
        if (abortCtrl.signal.aborted) break;
        try {
          const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : (tc.arguments || {});
          const result = await this.runner(tc.name, args, {
            signal: abortCtrl.signal,
            isCurrent: () => !abortCtrl.signal.aborted,
          });
          if (result && result.ok === false && result.error && !toolError) {
            toolError = result.error;
          }
        } catch (err) {
          console.warn('[GevWebVoice] tool error:', tc.name, err?.message);
          if (!toolError) toolError = err?.message || 'Command failed';
        }
      }

      this.history.push({ role: 'user', content: transcript });
      if (reply) {
        this.history.push({ role: 'assistant', content: reply });
        if (!abortCtrl.signal.aborted) await this._speak(reply, abortCtrl.signal);
      }
      if (this.history.length > MAX_HISTORY_TURNS * 2) {
        this.history = this.history.slice(-MAX_HISTORY_TURNS * 2);
      }

      if (!abortCtrl.signal.aborted && this.status !== 'idle') {
        const nextDetail = toolError && !reply
          ? toolError.slice(0, 80)
          : 'Tap mic to speak';
        this.setStatus('listening', nextDetail);
      }
    } catch (err) {
      if (abortCtrl.signal.aborted) return;
      console.error('[GevWebVoice] chat error:', err?.message);
      if (this.status !== 'idle') this.setStatus('listening', 'Tap mic to speak');
    } finally {
      if (this.abortController === abortCtrl) this.abortController = null;
    }
  }

  // ── TTS ──────────────────────────────────────────────────────────────────────

  _speak(text, signal) {
    if (!window.speechSynthesis || !text) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      const cleanup = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
      const onAbort = () => { window.speechSynthesis.cancel(); cleanup(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      utterance.onend = cleanup;
      utterance.onerror = cleanup;
      window.speechSynthesis.speak(utterance);
    });
  }

  // ── Map context ──────────────────────────────────────────────────────────────

  _getMapContext() {
    try {
      const view = window.__godsEyeView;
      if (!view) return {};
      if (typeof view.getVoiceContext === 'function') return view.getVoiceContext() || {};
      const cart = view.viewer?.camera?.positionCartographic;
      if (!cart) return {};
      return {
        latitude: Math.round(Cesium.Math.toDegrees(cart.latitude) * 1000) / 1000,
        longitude: Math.round(Cesium.Math.toDegrees(cart.longitude) * 1000) / 1000,
        altitudeM: Math.round(cart.height),
      };
    } catch {
      return {};
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  stop({ removeUi = false } = {}) {
    this.abortController?.abort();
    this.abortController = null;

    if (this._recognitionActive) {
      try { this._recognition?.abort(); } catch {}
    }
    this._recognitionActive = false;
    this._recognition = null;

    window.speechSynthesis?.cancel();

    if (this._textInput) this._textInput.style.display = 'none';
    this.setStatus('idle');

    if (removeUi) {
      if (this._escapeHandler) {
        document.removeEventListener('keydown', this._escapeHandler);
        this._escapeHandler = null;
      }
      const btn = this.ui?.button;
      if (btn && this.buttonHandler) btn.removeEventListener('click', this.buttonHandler);
      if (this.tierHandler) this.ui.tierButton?.removeEventListener('click', this.tierHandler);
      if (this._textInput && this._textInputHandler) {
        this._textInput.removeEventListener('keydown', this._textInputHandler);
      }
      this._textInput = null;
      this._textInputHandler = null;
      this._clickHandlerInstalled = false;
      if (this.ui?.root) this.ui.root.remove();
    }
  }

  setStatus(status, detail) {
    this.status = status;
    if (this.ui?.root) {
      this.ui.root.dataset.status = status;
      if (status === 'error') this.ui.root.classList.remove('error-dismissed');
    }
    if (this.ui?.status) this.ui.status.textContent = WEB_VOICE_STATUS[status] || 'OFF';
    const primaryDetail = status === 'error'
      ? 'VOICE UNAVAILABLE'
      : (detail || (status === 'idle' ? 'VOICE STANDBY' : 'VOICE ACTIVE'));
    if (this.ui?.detail) { this.ui.detail.textContent = primaryDetail; this.ui.detail.title = primaryDetail; }
    if (this.ui?.errorDetail) {
      this.ui.errorDetail.textContent =
        status === 'error' ? (detail || 'Voice session could not be started.') : '';
    }
  }

  syncCostUi() {
    if (this.ui?.tierButton) {
      this.ui.tierButton.textContent = 'FREE';
      this.ui.tierButton.title = 'Web Speech API — browser-native, no API cost';
      this.ui.tierButton.disabled = true;
    }
    if (this.ui?.costValue) {
      this.ui.costValue.textContent = '$0.00';
      this.ui.costValue.title = 'Free voice mode — browser speech recognition';
    }
  }

  bindPushToTalkShortcut() {}
  toggleVoiceTier() {}
  notifyMapEvent() {}
}

export function createGevWebVoiceController({
  viewer, styleManager, dataManager, sceneDirector = null, annotations = null, ui,
}) {
  const runner = createGevActionRunner({ viewer, styleManager, dataManager, sceneDirector, annotations });
  return new GevWebVoiceController({ runner, ui });
}
