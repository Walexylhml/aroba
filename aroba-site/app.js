// app.js — Àrọba UI Manager
'use strict';

class ArobaApp {
  constructor() {
    this.engine = new ArobaEngine();
    // Default to English: real bilingual Yoruba content is being rolled out
    // story by story. Stories without a full Yoruba translation yet fall back
    // to English with a visible "translation in progress" note (never silently).
    this.lang = localStorage.getItem('aroba_lang') || 'en';
    this.engine.lang = this.lang;
    this.theme = 'dark';
    this.filter = 'all';
    this.currentStory = null;
    this.chatHistory = [];
    this.apiKey = localStorage.getItem('aroba_api_key') || '';
    this.isListening = false;
    this.recognition = null;
    this._wordsMap = []; // [{start, end, el}] per segment
    // Category label lookup, built from the generated nav payload
    this._catLabels = {};
    (window.STORY_NAV || []).forEach(n => { this._catLabels[n.key] = n; });
  }

  // Pick Yoruba text when a real translation exists, else fall back to English.
  _txt(obj) {
    if (this.lang === 'yo' && obj && obj.yo && obj.yo.trim()) return obj.yo;
    return (obj && obj.en) || '';
  }
  _segTxt(seg) {
    if (this.lang === 'yo' && seg && seg.yo && seg.yo.trim()) return seg.yo;
    return (seg && seg.en) || '';
  }
  _catLabel(key) {
    const n = this._catLabels[key];
    if (!n) return key;
    return this.lang === 'yo' ? n.yo : n.en;
  }
  _isPending(story) {
    // Yoruba selected but this story has no full Yoruba translation yet
    return this.lang === 'yo' && !story.yo_full;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  init() {
    this._buildDOM();
    this._bindEngine();
    this._bindUI();
    this._registerSW();
    // Sync splash + lang toggles to the active language
    if (this.splashLang) this.splashLang(this.lang);
    // Preload voices
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  // ── Service Worker ────────────────────────────────────────────────────────
  _registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // ── DOM Builder ───────────────────────────────────────────────────────────
  _buildDOM() {
    this._buildNav();
    this._renderGrid();
  }

  _buildNav() {
    const nav = window.STORY_NAV || [{ key: 'all', yo: 'Gbogbo', en: 'All' }];
    document.getElementById('filter-tabs').innerHTML = nav.map(n => {
      const label = this.lang === 'yo' ? n.yo : n.en;
      const on = n.key === this.filter ? ' on' : '';
      return `<button class="ftab${on}" data-cat="${n.key}">${label}</button>`;
    }).join('');
  }

  _renderGrid() {
    const list = this.filter === 'all'
      ? window.STORIES
      : window.STORIES.filter(s => s.category === this.filter);
    document.getElementById('story-grid').innerHTML =
      list.map(s => this._storyCardHTML(s)).join('');
  }

  _storyCardHTML(s) {
    const title = this._txt(s.title);
    const desc = this._txt(s.desc) || (s.desc && s.desc.en) || '';
    const pending = this._isPending(s)
      ? `<span class="yo-pending" title="Yoruba translation in progress">🔸 YO</span>` : '';
    return `
    <div class="story-card" onclick="app.openStory('${s.id}')">
      <div class="card-art" style="background:${s.grad}">${s.emoji}</div>
      <div class="card-body">
        <div class="card-cat">${s.emoji} ${this._catLabel(s.category)} ${pending}</div>
        <div class="card-title">${title}</div>
        <div class="card-desc">${desc}</div>
        <div class="card-meta">
          <span>⭐ ${s.rating}</span>
          <span>🕐 ${s.duration}</span>
        </div>
      </div>
      <div class="card-play">▶</div>
    </div>`;
  }

  // ── Engine Callbacks ──────────────────────────────────────────────────────
  _bindEngine() {
    this.engine.onSegmentChange = (idx) => {
      if (!this.currentStory) return;
      if (idx >= this.currentStory.segments.length) return;
      this._activateSegment(idx);
    };

    this.engine.onWordBoundary = (segIdx, charIndex, charLen) => {
      this._highlightWord(segIdx, charIndex, charLen);
    };

    this.engine.onPlayStateChange = (playing) => {
      const btn = document.getElementById('play-pause-btn');
      if (btn) btn.textContent = playing ? '⏸' : '▶';
    };

    this.engine.onStoryEnd = () => {
      this._showToast(this.lang === 'yo' ? 'Ìtàn pàrí! ✓' : 'Story complete! ✓');
    };
  }

  // ── UI Bindings ──────────────────────────────────────────────────────────
  _bindUI() {
    // Player controls
    document.getElementById('play-pause-btn').onclick = () => this._togglePlay();
    document.getElementById('prev-btn').onclick = () => this._prevSeg();
    document.getElementById('next-btn').onclick = () => this._nextSeg();
    document.getElementById('rewind-btn').onclick = () => this._rewind();
    document.getElementById('forward-btn').onclick = () => this._forward();
    document.getElementById('back-btn').onclick = () => this._goHome();
    document.getElementById('mic-btn').onclick = () => this._toggleMic();
    document.getElementById('send-btn').onclick = () => this._sendChat();
    document.getElementById('lang-yo').onclick = () => this._setLang('yo');
    document.getElementById('lang-en').onclick = () => this._setLang('en');
    document.getElementById('theme-btn').onclick = () => this._toggleTheme();
    document.getElementById('settings-btn').onclick = () => this._openSettings();
    document.getElementById('settings-save').onclick = () => this._saveSettings();
    document.getElementById('filter-tabs').onclick = (e) => {
      const tab = e.target.closest('[data-cat]');
      if (tab) this._filterStories(tab.dataset.cat);
    };
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
    });
    // Lang tabs in home
    document.getElementById('home-lang-yo').onclick = () => this._setLang('yo');
    document.getElementById('home-lang-en').onclick = () => this._setLang('en');
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  openStory(id) {
    const story = window.STORIES.find(s => s.id === id);
    if (!story) return;
    this.currentStory = story;
    this.chatHistory = [];

    // Set header
    document.getElementById('story-title-bar').textContent = this._txt(story.title);
    document.getElementById('story-cat-tag').textContent =
      `${story.emoji} ${this._catLabel(story.category)}`;

    // Build text panel
    this._buildTextPanel(story);

    // Setup the visual stage (themed gradient backdrop)
    this._setupStage(story);

    // Load engine
    this.engine.load(story, this.lang);
    this.engine.segmentIndex = 0;

    // Clear chat
    document.getElementById('chat-log').innerHTML = '';
    this._addAIMsg(this.lang === 'yo'
      ? 'Àrọba ti ṣetan. Tẹ ▶ láti bẹ̀rẹ̀ ìtàn, tàbí béèrè ìbéèrè.'
      : 'Àrọba is ready. Tap ▶ to begin the story, or ask me anything.');

    this.showScreen('player');
    this._activateSegment(0);
  }

  _goHome() {
    this.engine.stop();
    this.showScreen('home');
  }

  // ── Text Panel ────────────────────────────────────────────────────────────
  _buildTextPanel(story) {
    const panel = document.getElementById('text-panel');
    panel.innerHTML = '';
    this._wordsMap = [];

    if (this._isPending(story)) {
      const note = document.createElement('div');
      note.className = 'yo-banner';
      note.textContent = 'Yorùbá ìtumọ̀ ń bọ̀ — a ó fi Gẹ̀ẹ́sì hàn fún ìsinsìnyí · Yoruba translation in progress — showing English for now.';
      panel.appendChild(note);
    }

    story.segments.forEach((seg, si) => {
      const text = this._segTxt(seg);
      const div = document.createElement('div');
      div.className = 'segment-block';
      div.id = `seg-${si}`;
      div.setAttribute('data-seg', si);
      div.onclick = () => this.engine.seekTo(si);

      // Split into word spans for karaoke highlight
      const segWords = [];
      let charPos = 0;
      const words = text.split(/(\s+)/);
      words.forEach(token => {
        if (/\s+/.test(token)) {
          div.appendChild(document.createTextNode(token));
          charPos += token.length;
        } else {
          const span = document.createElement('span');
          span.className = 'word-span';
          span.dataset.start = charPos;
          span.dataset.end = charPos + token.length;
          span.textContent = token;
          div.appendChild(span);
          segWords.push({ start: charPos, end: charPos + token.length, el: span });
          charPos += token.length;
        }
      });
      this._wordsMap[si] = segWords;
      panel.appendChild(div);
    });
  }

  // ── Segment Activation ────────────────────────────────────────────────────
  _activateSegment(idx) {
    if (!this.currentStory || idx >= this.currentStory.segments.length) return;
    const seg = this.currentStory.segments[idx];

    // Update text highlight
    document.querySelectorAll('.segment-block').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('inactive', i !== idx);
    });
    // Clear all word highlights
    document.querySelectorAll('.word-span.lit').forEach(s => s.classList.remove('lit'));

    // Scroll segment into view
    const segEl = document.getElementById(`seg-${idx}`);
    if (segEl) segEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Shift the themed backdrop
    this._swapStage(this.currentStory, idx);

    // Update badges
    document.getElementById('scene-tag').textContent = seg.scene;
    document.getElementById('mood-tag').textContent = seg.mood;
    document.getElementById('seg-indicator').textContent =
      `${idx + 1} / ${this.currentStory.segments.length}`;
  }

  // ── Word Highlight ────────────────────────────────────────────────────────
  _highlightWord(segIdx, charIndex, charLen) {
    const words = this._wordsMap[segIdx];
    if (!words) return;
    // Remove previous lit
    document.querySelectorAll('.word-span.lit').forEach(s => s.classList.remove('lit'));
    // Find matching word
    const w = words.find(w => charIndex >= w.start && charIndex < w.end);
    if (w) w.el.classList.add('lit');
  }

  // ── Visual Stage (themed gradient; no external video dependency) ───────────
  _setupStage(story) {
    const stage = document.getElementById('video-stage');
    stage.style.transition = 'background 0.6s ease';
    stage.style.backgroundSize = 'cover';
    stage.style.background = this._stageGradient(story, 0);
    const emoji = document.getElementById('stage-emblem') || (() => {
      const e = document.createElement('div');
      e.id = 'stage-emblem';
      e.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;' +
        'justify-content:center;font-size:76px;opacity:.28;filter:drop-shadow(0 4px 24px rgba(0,0,0,.6));' +
        'pointer-events:none;';
      stage.appendChild(e);
      return e;
    })();
    emoji.textContent = story.emoji || '⚡';
  }

  _stageGradient(story, segIdx) {
    // Subtly shift the themed gradient per segment for visual movement.
    const base = story.grad || 'linear-gradient(135deg,#1a0a00,#4a2800)';
    const angle = 120 + (segIdx * 18) % 90;
    return base.replace(/linear-gradient\(([^,]+),/, `linear-gradient(${angle}deg,`);
  }

  _swapStage(story, segIdx) {
    const stage = document.getElementById('video-stage');
    if (stage) stage.style.background = this._stageGradient(story, segIdx);
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  _togglePlay() {
    if (this.engine.isPlaying) this.engine.pause();
    else this.engine.play();
  }
  _prevSeg() { this.engine.seekTo(this.engine.segmentIndex - 1); }
  _nextSeg() { this.engine.seekTo(this.engine.segmentIndex + 1); }
  _rewind() { this.engine.seekTo(Math.max(0, this.engine.segmentIndex - 1)); }
  _forward() { this.engine.seekTo(Math.min(this.engine.segmentIndex + 1, (this.currentStory?.segments.length||1)-1)); }

  // ── Language ──────────────────────────────────────────────────────────────
  _setLang(l) {
    this.lang = l;
    try { localStorage.setItem('aroba_lang', l); } catch (e) {}
    document.querySelectorAll('[data-lang]').forEach(el => {
      el.classList.toggle('on', el.dataset.lang === l);
    });
    // Nav labels are language-specific
    this._buildNav();
    // Rebuild text if story open
    if (this.currentStory) {
      this._buildTextPanel(this.currentStory);
      this._activateSegment(this.engine.segmentIndex);
      document.getElementById('story-title-bar').textContent = this._txt(this.currentStory.title);
    }
    // Rebuild home cards
    this._renderGrid();
    // Update engine lang
    this.engine.setLang(l);
  }

  // ── Theme ─────────────────────────────────────────────────────────────────
  _toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.theme);
    const btn = document.getElementById('theme-btn');
    btn.textContent = this.theme === 'dark' ? '☀️' : '🌙';
    this._showToast(this.theme === 'dark' ? '🌙 Dark mode' : '☀️ Light mode');
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  _filterStories(cat) {
    this.filter = cat;
    document.querySelectorAll('[data-cat]').forEach(t => t.classList.toggle('on', t.dataset.cat === cat));
    this._renderGrid();
  }

  // ── Voice Input ───────────────────────────────────────────────────────────
  _toggleMic() {
    if (this.isListening) {
      this._stopMic();
    } else {
      this._startMic();
    }
  }

  _startMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this._showToast('Voice not supported — type instead'); return; }
    this.recognition = new SR();
    this.recognition.lang = this.lang === 'yo' ? 'yo-NG' : 'en-NG';
    this.recognition.interimResults = false;
    this.recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      document.getElementById('chat-input').value = text;
      this._sendChat();
    };
    this.recognition.onerror = () => this._stopMic();
    this.recognition.onend = () => this._stopMic();
    this.recognition.start();
    this.isListening = true;
    document.getElementById('mic-btn').classList.add('listening');
    document.getElementById('island').classList.add('live');
    this._showToast(this.lang === 'yo' ? '🎙️ Àrọba ń gbọ́ rẹ...' : '🎙️ Listening...');
  }

  _stopMic() {
    this.isListening = false;
    this.recognition?.stop();
    document.getElementById('mic-btn').classList.remove('listening');
    document.getElementById('island').classList.remove('live');
  }

  // ── AI Chat ───────────────────────────────────────────────────────────────
  async _sendChat() {
    const inp = document.getElementById('chat-input');
    const q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    this._addUserMsg(q);

    // Prompt Àrọba AI (Claude API)
    if (!this.apiKey) {
      // Graceful fallback — built-in wisdom without API
      const fallbacks = {
        yo: [
          'Àrọba gbọ́ ọ. Ìtàn ń tẹ̀síwájú nínú ọkàn rẹ́ bí omi odò tó ń ṣàn...',
          'Ọmọ mi, ìmọ̀ tó dára jù kò wà nínú ìwé — ó wà nínú ìtàn tí a ń sọ pẹ̀lú ọkàn.',
          'Béèrè ìbéèrè rẹ pẹ̀lú ọkàn tó ṣí sílẹ̀, ìdáhùn yóò wá bí òjò ní àárọ̀.'
        ],
        en: [
          'Àrọba hears you. The story continues in your heart like a river flowing...',
          'My child, the deepest wisdom is not in books — it lives in the stories we tell with open hearts.',
          'Ask your question with an open mind, and the answer will come like morning rain.'
        ]
      };
      const arr = fallbacks[this.lang];
      const reply = arr[Math.floor(Math.random() * arr.length)];
      this._addAIMsg(reply, true);
      this._showToast('Add API key in ⚙️ settings for full AI responses');
      return;
    }

    const loadEl = this._addAIMsg('...', false, true);
    document.getElementById('island').classList.add('live');

    const story = this.currentStory;
    const system = `You are Àrọba, the Father of Stories — an ancient Yoruba AI storyteller.
You have deep knowledge of Yoruba history, mythology, culture and literature.
Currently narrating: "${story?.title?.[this.lang] || 'Yoruba Stories'}".
Speak poetically and wisely, like a griot elder around a moonlit fire.
- If user writes Yoruba, reply ENTIRELY in Yoruba with correct diacritics (à,á,è,é,ì,í,ò,ó,ù,ú,ẹ,ọ,ṣ).
- If user writes English, reply in English but weave Yoruba words in naturally.
- 2-3 sentences max. Stay in character. Draw from authentic Yoruba oral tradition.`;

    try {
      this.chatHistory.push({ role: 'user', content: q });
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          system,
          messages: this.chatHistory
        })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || 'Àrọba hears you...';
      this.chatHistory.push({ role: 'assistant', content: reply });
      loadEl.textContent = reply;
      // Speak the response
      const utt = new SpeechSynthesisUtterance(reply);
      utt.lang = this.lang === 'yo' ? 'yo' : 'en-NG';
      utt.rate = 0.88;
      window.speechSynthesis.speak(utt);
    } catch (e) {
      loadEl.textContent = this.lang === 'yo'
        ? 'Àrọba gbọ́ ọ — ṣùgbọ́n ìsopọ̀ kò ṣiṣẹ́. Ṣàyẹ̀wò kọ́kọ́ rẹ.'
        : 'Àrọba hears you — but the connection failed. Check your API key in settings.';
    } finally {
      document.getElementById('island').classList.remove('live');
    }
  }

  _addUserMsg(text) {
    const log = document.getElementById('chat-log');
    const d = document.createElement('div');
    d.className = 'msg user';
    d.innerHTML = `<div class="bubble user-bubble">${this._esc(text)}</div>`;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  _addAIMsg(text, speak = false, loading = false) {
    const log = document.getElementById('chat-log');
    const d = document.createElement('div');
    d.className = 'msg ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble ai-bubble';
    bubble.textContent = text;
    d.innerHTML = `<div class="ai-orb">🔥</div>`;
    d.appendChild(bubble);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    if (speak) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.lang === 'yo' ? 'yo' : 'en-NG';
      u.rate = 0.88;
      window.speechSynthesis.speak(u);
    }
    return bubble;
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  _openSettings() {
    document.getElementById('api-key-input').value = this.apiKey;
    document.getElementById('settings-panel').classList.add('open');
  }

  _saveSettings() {
    const k = document.getElementById('api-key-input').value.trim();
    this.apiKey = k;
    localStorage.setItem('aroba_api_key', k);
    document.getElementById('settings-panel').classList.remove('open');
    this._showToast(k ? '✓ API key saved' : 'API key cleared');
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  _showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ── Utils ─────────────────────────────────────────────────────────────────
  _esc(t) {
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  window.app = new ArobaApp();
  app.init();
});
