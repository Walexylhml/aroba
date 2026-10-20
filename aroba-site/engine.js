// engine.js — Àrọba Sync Engine
// Drives TTS narration in lockstep with video and text highlighting.
// Uses Web Speech API (built into all modern browsers — no API key needed).

class ArobaEngine {
  constructor() {
    this.story = null;
    this.segmentIndex = 0;
    this.isPlaying = false;
    this.synth = window.speechSynthesis;
    this.currentUtt = null;
    this.lang = 'yo';

    // Callbacks set by UI layer
    this.onSegmentChange = null;  // (index) => void
    this.onWordBoundary = null;   // (segIndex, charIndex, charLength) => void
    this.onPlayStateChange= null; // (isPlaying) => void
    this.onStoryEnd = null;       // () => void

    // Guard: Chrome bug — synth stops after ~15s without this ping
    this._keepAliveTimer = null;
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  load(story, lang = 'yo') {
    this.stop();
    this.story = story;
    this.segmentIndex = 0;
    this.lang = lang;
  }

  // ── Playback Controls ───────────────────────────────────────────────────────
  play() {
    if (!this.story) return;
    if (this.synth.paused) {
      this.synth.resume();
      this.isPlaying = true;
      this._notifyPlayState();
      this._startKeepAlive();
      return;
    }
    this.isPlaying = true;
    this._notifyPlayState();
    this._startKeepAlive();
    this._speakSegment(this.segmentIndex);
  }

  pause() {
    this.synth.pause();
    this.isPlaying = false;
    this._notifyPlayState();
    this._stopKeepAlive();
  }

  stop() {
    this.synth.cancel();
    this.isPlaying = false;
    this.segmentIndex = 0;
    this.currentUtt = null;
    this._stopKeepAlive();
    this._notifyPlayState();
  }

  seekTo(index) {
    const wasPlaying = this.isPlaying;
    this.synth.cancel();
    this.currentUtt = null;
    this.segmentIndex = Math.max(0, Math.min(index, this.story.segments.length - 1));
    if (this.onSegmentChange) this.onSegmentChange(this.segmentIndex);
    if (wasPlaying) {
      setTimeout(() => this._speakSegment(this.segmentIndex), 80);
    }
  }

  setLang(lang) {
    this.lang = lang;
    const was = this.isPlaying;
    const idx = this.segmentIndex;
    this.stop();
    this.segmentIndex = idx;
    if (was) setTimeout(() => { this.isPlaying = true; this._speakSegment(idx); }, 80);
  }

  // ── Internal ─────────────────────────────────────────────────────────────────
  _speakSegment(index) {
    if (!this.story || index >= this.story.segments.length) {
      this.isPlaying = false;
      this._notifyPlayState();
      this._stopKeepAlive();
      if (this.onStoryEnd) this.onStoryEnd();
      return;
    }

    const seg = this.story.segments[index];
    // Narrate Yoruba only when a real translation exists; else English.
    const text = (this.lang === 'yo' && seg.yo && seg.yo.trim()) ? seg.yo : seg.en;

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = this.lang === 'yo' ? 'yo' : 'en-NG';
    utt.rate = 0.88;
    utt.pitch = 0.92;
    utt.volume = 1.0;

    // Pick best available voice (warm, male, storytelling where possible)
    const preferred = this._pickVoice();
    if (preferred) utt.voice = preferred;

    // Word-boundary events → live text highlighting
    utt.onboundary = (e) => {
      if (e.name === 'word' && this.onWordBoundary) {
        this.onWordBoundary(index, e.charIndex, e.charLength);
      }
    };

    // Segment end → advance
    utt.onend = () => {
      if (!this.isPlaying) return;
      this.segmentIndex = index + 1;
      if (this.onSegmentChange) this.onSegmentChange(this.segmentIndex);
      setTimeout(() => this._speakSegment(this.segmentIndex), 120);
    };

    utt.onerror = (e) => {
      if (e.error === 'interrupted') return; // Normal on cancel()
      console.warn('[ArobaEngine] TTS error:', e.error);
      // Retry once
      setTimeout(() => this._speakSegment(index), 300);
    };

    this.currentUtt = utt;
    this.synth.speak(utt);
  }

  // Choose the most natural narration voice available.
  // English narration should sound like a warm, male storyteller — not the
  // default (often female) system voice. Nigerian / British English first.
  _pickVoice() {
    const voices = this.synth.getVoices();
    if (!voices || !voices.length) return null;

    if (this.lang === 'yo') {
      // A real Yoruba voice if one exists, else Nigerian English, else male English.
      return voices.find(v => v.lang && v.lang.toLowerCase().startsWith('yo'))
        || voices.find(v => v.lang === 'en-NG')
        || this._pickMaleEnglish(voices)
        || voices.find(v => v.lang && v.lang.startsWith('en'))
        || voices[0];
    }

    // English narration: Nigerian English, then a known male storyteller voice.
    return voices.find(v => v.lang === 'en-NG')
      || this._pickMaleEnglish(voices)
      || voices.find(v => v.lang && v.lang.startsWith('en-GB'))
      || voices.find(v => v.lang && v.lang.startsWith('en'))
      || voices[0];
  }

  // Known male English voices across Chrome, Edge, Safari and Android,
  // ordered with the richer storytelling voices first.
  _pickMaleEnglish(voices) {
    const names = [
      'google uk english male', 'daniel', 'microsoft ryan', 'microsoft guy',
      'microsoft mark', 'microsoft george', 'rishi', 'arthur', 'oliver',
      'alex', 'fred', 'aaron', 'reed', 'male'
    ];
    const en = voices.filter(v => v.lang && v.lang.startsWith('en'));
    for (const n of names) {
      const hit = en.find(v => v.name && v.name.toLowerCase().includes(n));
      if (hit) return hit;
    }
    return null;
  }

  // Chrome bug: SpeechSynthesis silently stops after ~15s of inactivity
  // Workaround: cancel & re-speak current position every 10s
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAliveTimer = setInterval(() => {
      if (!this.synth.speaking && this.isPlaying) {
        this._speakSegment(this.segmentIndex);
      }
    }, 10000);
  }

  _stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
  }

  _notifyPlayState() {
    if (this.onPlayStateChange) this.onPlayStateChange(this.isPlaying);
  }
}

window.ArobaEngine = ArobaEngine;
