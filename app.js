(() => {
  'use strict';

  // ---------- DOM ----------
  const el = {
    controlBar: document.getElementById('controlBar'),
    toggleControls: document.getElementById('toggleControls'),
    noteMin: document.getElementById('noteMin'),
    noteMax: document.getElementById('noteMax'),
    beatsPerMeasure: document.getElementById('beatsPerMeasure'),
    totalMeasures: document.getElementById('totalMeasures'),
    subdivision: document.getElementById('subdivision'),
    allowDot: document.getElementById('allowDot'),
    generateBtn: document.getElementById('generateBtn'),
    scoreWrap: document.getElementById('scoreWrap'),
    score: document.getElementById('score'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    pullIndicator: document.getElementById('pullIndicator'),
    metronomeBtn: document.getElementById('metronomeBtn'),
    metronomeModal: document.getElementById('metronomeModal'),
    metronomeClose: document.getElementById('metronomeClose'),
    tempoSlider: document.getElementById('tempoSlider'),
    tempoValue: document.getElementById('tempoValue'),
    tempoMinus: document.getElementById('tempoMinus'),
    tempoPlus: document.getElementById('tempoPlus'),
    subdivRow: document.getElementById('subdivRow'),
    metronomeToggle: document.getElementById('metronomeToggle'),
  };

  // ---------- Helpers ----------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  // ---------- Random background: dark gradient + a subtle texture ----------
  function randomDarkGradient() {
    const h1 = Math.floor(Math.random() * 360);
    const h2 = (h1 + 40 + Math.floor(Math.random() * 100)) % 360;
    const angle = Math.floor(Math.random() * 360);
    const c1 = `hsl(${h1}, 32%, 9%)`;
    const c2 = `hsl(${h2}, 28%, 6%)`;
    return `linear-gradient(${angle}deg, ${c1}, ${c2})`;
  }

  function gridTexture() {
    const gap = 24 + Math.floor(Math.random() * 24);
    const op = (0.035 + Math.random() * 0.025).toFixed(3);
    return `repeating-linear-gradient(to bottom, rgba(255,255,255,${op}) 0 1px, transparent 1px ${gap}px),`
      + `repeating-linear-gradient(to right, rgba(255,255,255,${op}) 0 1px, transparent 1px ${gap}px)`;
  }

  function weaveTexture() {
    const gap = 16 + Math.floor(Math.random() * 16);
    const op = (0.03 + Math.random() * 0.025).toFixed(3);
    return `repeating-linear-gradient(45deg, rgba(255,255,255,${op}) 0 1px, transparent 1px ${gap}px),`
      + `repeating-linear-gradient(-45deg, rgba(255,255,255,${op}) 0 1px, transparent 1px ${gap}px)`;
  }

  function dotTexture() {
    const gap = 20 + Math.floor(Math.random() * 16);
    const op = (0.05 + Math.random() * 0.04).toFixed(3);
    const r = 1.2 + Math.random() * 0.6;
    return `radial-gradient(rgba(255,255,255,${op}) ${r.toFixed(1)}px, transparent ${(r + 0.6).toFixed(1)}px) 0 0/${gap}px ${gap}px`;
  }

  function stripeTexture() {
    const angle = Math.floor(Math.random() * 180);
    const gap = 26 + Math.floor(Math.random() * 24);
    const op = (0.03 + Math.random() * 0.025).toFixed(3);
    return `repeating-linear-gradient(${angle}deg, rgba(255,255,255,${op}) 0 2px, transparent 2px ${gap}px)`;
  }

  function speckleTexture() {
    const count = 6 + Math.floor(Math.random() * 6);
    const layers = [];
    for (let i = 0; i < count; i++) {
      const x = Math.floor(Math.random() * 100);
      const y = Math.floor(Math.random() * 100);
      const r = 8 + Math.random() * 16;
      const op = (0.02 + Math.random() * 0.03).toFixed(3);
      layers.push(`radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,${op}) 0, transparent ${r.toFixed(0)}%)`);
    }
    return layers.join(',');
  }

  const TEXTURES = [gridTexture, weaveTexture, dotTexture, stripeTexture, speckleTexture];

  function randomBackground() {
    const texture = TEXTURES[Math.floor(Math.random() * TEXTURES.length)]();
    return `${texture}, ${randomDarkGradient()}`;
  }

  // ---------- Persistence ----------
  const STORAGE_KEY = 'jianpu-gen-state-v1';

  function saveState(config, rows, background) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, rows, background }));
    } catch (e) { /* localStorage unavailable (private mode, quota, ...) */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // Probability of leaving a node un-split at a given beam depth (deeper
  // levels stop more readily so beats don't turn into a wall of tiny notes).
  const STOP_PROB = [0.4, 0.45, 0.7, 0.85];
  const DOT_PROB = 0.22;
  const TRIPLET_PROB = 0.22;

  // ---------- Rhythm generation ----------
  // Recursively subdivides a beat's ticks (1 tick = one "smallest unit",
  // i.e. 1/subdivision of a beat) into a binary tree of notes. At each
  // splittable node we can stop (single note), split evenly into two
  // notes one beam-level deeper, or - if dots are allowed - turn the pair
  // into a dotted note + a shorter partner one level deeper still. This
  // naturally produces both uniform groupings (eighth notes, sixteenths...)
  // and uneven ones (e.g. eighth + two sixteenths), like real notation.
  function splitNode(ticks, level, allowDot, out) {
    if (ticks === 1 || ticks % 2 !== 0) {
      out.push({ level, dotted: false, tuplet: null });
      return;
    }
    const stopP = STOP_PROB[level] ?? 0.85;
    // A dotted note "borrows" from its would-be sibling (3:1 ratio), so the
    // short partner's duration is ticks/4 of this node - that must still be
    // a whole number of the smallest allowed unit, or it invents a note
    // shorter than the chosen subdivision even allows.
    const dotP = (allowDot && ticks % 4 === 0) ? DOT_PROB : 0;
    const r = Math.random();
    if (r < stopP) {
      out.push({ level, dotted: false, tuplet: null });
    } else if (r < stopP + dotP) {
      const lvl = level + 1;
      if (Math.random() < 0.5) {
        out.push({ level: lvl, dotted: true, tuplet: null });
        out.push({ level: lvl + 1, dotted: false, tuplet: null });
      } else {
        out.push({ level: lvl + 1, dotted: false, tuplet: null });
        out.push({ level: lvl, dotted: true, tuplet: null });
      }
    } else {
      splitNode(ticks / 2, level + 1, allowDot, out);
      splitNode(ticks / 2, level + 1, allowDot, out);
    }
  }

  // Returns an array of note descriptors for one beat:
  // { level, dotted, tuplet } (value assigned separately by the caller)
  function generateBeat(N, allowDot) {
    if (N % 3 === 0 && Math.random() < TRIPLET_PROB) {
      return [1, 2, 3].map(() => ({ level: 1, dotted: false, tuplet: 3 }));
    }
    const notes = [];
    splitNode(N, 0, allowDot, notes);
    return notes;
  }

  // Assigns note values within a beat, avoiding an immediate repeat of the
  // previous note's value when the selected range allows it.
  function assignValues(notes, noteMin, noteMax) {
    let prev = null;
    notes.forEach((n) => {
      let value = randInt(noteMin, noteMax);
      if (noteMax > noteMin) {
        let tries = 0;
        while (value === prev && tries < 10) {
          value = randInt(noteMin, noteMax);
          tries++;
        }
      }
      n.value = value;
      prev = value;
    });
  }

  function generateScore(config) {
    const { noteMin, noteMax, beatsPerMeasure, totalMeasures, subdivision, allowDot } = config;
    const rows = [];
    for (let m = 0; m < totalMeasures; m++) {
      const beats = [];
      for (let b = 0; b < beatsPerMeasure; b++) {
        const notes = generateBeat(subdivision, allowDot);
        assignValues(notes, noteMin, noteMax);
        beats.push(notes);
      }
      rows.push(beats);
    }
    return rows;
  }

  // ---------- Rendering ----------
  function buildLevelRow(notes, level) {
    const row = document.createElement('div');
    row.className = 'beam-row';
    let i = 0;
    while (i < notes.length) {
      if (notes[i].level >= level) {
        let j = i;
        while (j < notes.length && notes[j].level >= level) j++;
        const seg = document.createElement('div');
        seg.className = 'beam-seg';
        seg.style.flexGrow = String(j - i);
        row.appendChild(seg);
        i = j;
      } else {
        const gap = document.createElement('div');
        gap.className = 'beam-gap';
        row.appendChild(gap);
        i++;
      }
    }
    return row;
  }

  function buildTupletRow(notes) {
    // All notes in a tuplet group share the same tuplet size (or null).
    const row = document.createElement('div');
    row.className = 'tuplet-row';
    let i = 0;
    while (i < notes.length) {
      if (notes[i].tuplet) {
        const k = notes[i].tuplet;
        let j = i;
        while (j < notes.length && notes[j].tuplet === k) j++;
        const seg = document.createElement('div');
        seg.className = 'tuplet-seg';
        seg.style.flexGrow = String(j - i);
        const num = document.createElement('span');
        num.className = 'tuplet-num';
        num.textContent = String(k);
        seg.appendChild(num);
        row.appendChild(seg);
        i = j;
      } else {
        const gap = document.createElement('div');
        gap.className = 'tuplet-gap';
        row.appendChild(gap);
        i++;
      }
    }
    return row;
  }

  function buildBeatEl(notes) {
    const beatEl = document.createElement('div');
    beatEl.className = 'beat';

    const hasTuplet = notes.some((n) => n.tuplet);
    if (hasTuplet) {
      beatEl.appendChild(buildTupletRow(notes));
    }

    const notesRow = document.createElement('div');
    notesRow.className = 'notes-row';
    notes.forEach((n) => {
      const noteEl = document.createElement('span');
      noteEl.className = 'note';
      noteEl.textContent = String(n.value);
      if (n.dotted) {
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.textContent = '·';
        noteEl.appendChild(dot);
      }
      notesRow.appendChild(noteEl);
    });
    beatEl.appendChild(notesRow);

    const maxLevel = Math.max(0, ...notes.map((n) => n.level));
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      beatEl.appendChild(buildLevelRow(notes, lvl));
    }

    return beatEl;
  }

  function renderScore(rows, beatsPerMeasure) {
    el.score.innerHTML = '';
    rows.forEach((beats, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'row';

      const gutter = document.createElement('div');
      gutter.className = 'time-sig';
      if (rowIndex === 0) {
        const num = document.createElement('div');
        num.textContent = String(beatsPerMeasure);
        const den = document.createElement('div');
        den.textContent = '4';
        gutter.appendChild(num);
        gutter.appendChild(den);
      }
      rowEl.appendChild(gutter);

      const beatsWrap = document.createElement('div');
      beatsWrap.className = 'beats';
      beats.forEach((notes) => beatsWrap.appendChild(buildBeatEl(notes)));
      rowEl.appendChild(beatsWrap);

      const isLast = rowIndex === rows.length - 1;
      if (isLast) {
        const finalBar = document.createElement('div');
        finalBar.className = 'barline-final';
        const thin = document.createElement('div');
        thin.className = 'thin';
        const thick = document.createElement('div');
        thick.className = 'thick';
        finalBar.appendChild(thin);
        finalBar.appendChild(thick);
        rowEl.appendChild(finalBar);
      } else {
        const bar = document.createElement('div');
        bar.className = 'barline';
        rowEl.appendChild(bar);
      }

      el.score.appendChild(rowEl);
    });
  }

  // ---------- Config reading / validation ----------
  function readConfig() {
    let noteMin = clamp(parseInt(el.noteMin.value, 10) || 1, 1, 7);
    let noteMax = clamp(parseInt(el.noteMax.value, 10) || 7, 1, 7);
    if (noteMin > noteMax) [noteMin, noteMax] = [noteMax, noteMin];
    el.noteMin.value = noteMin;
    el.noteMax.value = noteMax;

    const beatsPerMeasure = clamp(parseInt(el.beatsPerMeasure.value, 10) || 4, 1, 12);
    el.beatsPerMeasure.value = beatsPerMeasure;

    const totalMeasures = clamp(parseInt(el.totalMeasures.value, 10) || 4, 1, 64);
    el.totalMeasures.value = totalMeasures;

    const subdivision = clamp(parseInt(el.subdivision.value, 10) || 4, 1, 8);
    el.subdivision.value = subdivision;

    const allowDot = el.allowDot.checked;

    return { noteMin, noteMax, beatsPerMeasure, totalMeasures, subdivision, allowDot };
  }

  // ---------- Generate flow (with loading animation) ----------
  let generating = false;

  function handleGenerate(opts) {
    const { showOverlay = true, onDone } = opts || {};
    if (generating) return;
    generating = true;
    const config = readConfig();

    el.scoreWrap.classList.remove('has-content');
    if (showOverlay) el.loadingOverlay.classList.remove('hidden');
    el.generateBtn.disabled = true;

    setTimeout(() => {
      const rows = generateScore(config);
      const background = randomBackground();
      renderScore(rows, config.beatsPerMeasure);
      el.scoreWrap.style.background = background;
      el.loadingOverlay.classList.add('hidden');
      el.scoreWrap.classList.add('has-content');
      el.generateBtn.disabled = false;
      generating = false;
      el.scoreWrap.scrollTop = 0;
      saveState(config, rows, background);
      if (onDone) onDone();
    }, 450 + Math.random() * 250);
  }

  el.generateBtn.addEventListener('click', () => handleGenerate());

  el.toggleControls.addEventListener('click', () => {
    el.controlBar.classList.toggle('collapsed');
  });

  // ---------- Pull-to-refresh ----------
  // Short pull (installed PWA has no browser chrome / native refresh):
  // regenerate a new score. Long pull: force-clear caches and reload the
  // page so an installed app can actually pick up a newer deployed version.
  const PULL_REGEN_THRESHOLD = 70;
  const PULL_RELOAD_THRESHOLD = 170;
  const PULL_MAX = 220;
  let pullStartY = null;
  let pulling = false;
  let pullDist = 0;

  function resetPullIndicator() {
    el.pullIndicator.classList.remove('reload-ready');
    el.pullIndicator.style.opacity = 0;
    el.pullIndicator.style.transform = 'translate(-50%, 0)';
    pullDist = 0;
  }

  async function forceReload() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) { /* best-effort; reload anyway */ }
    location.reload();
  }

  el.scoreWrap.addEventListener('touchstart', (e) => {
    if (generating || el.scoreWrap.scrollTop > 0) {
      pullStartY = null;
      pulling = false;
      return;
    }
    pullStartY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  el.scoreWrap.addEventListener('touchmove', (e) => {
    if (!pulling || pullStartY == null) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy <= 0 || el.scoreWrap.scrollTop > 0) {
      pulling = false;
      resetPullIndicator();
      return;
    }
    e.preventDefault();
    pullDist = Math.min(dy * 0.5, PULL_MAX);
    el.pullIndicator.classList.toggle('reload-ready', pullDist >= PULL_RELOAD_THRESHOLD);
    el.pullIndicator.style.opacity = String(Math.min(pullDist / PULL_REGEN_THRESHOLD, 1));
    el.pullIndicator.style.transform = `translate(-50%, ${pullDist}px)`;
  }, { passive: false });

  function endPull() {
    if (!pulling) return;
    pulling = false;
    if (pullDist >= PULL_RELOAD_THRESHOLD) {
      el.pullIndicator.classList.add('spinning');
      el.pullIndicator.style.opacity = '1';
      el.pullIndicator.style.transform = `translate(-50%, ${PULL_RELOAD_THRESHOLD}px)`;
      forceReload();
    } else if (pullDist >= PULL_REGEN_THRESHOLD) {
      el.pullIndicator.classList.add('spinning');
      el.pullIndicator.style.opacity = '1';
      el.pullIndicator.style.transform = `translate(-50%, ${PULL_REGEN_THRESHOLD}px)`;
      handleGenerate({
        showOverlay: false,
        onDone: () => {
          el.pullIndicator.classList.remove('spinning');
          resetPullIndicator();
        },
      });
    } else {
      resetPullIndicator();
    }
  }

  el.scoreWrap.addEventListener('touchend', endPull);
  el.scoreWrap.addEventListener('touchcancel', endPull);

  // ---------- Restore last session ----------
  (function restoreState() {
    const saved = loadState();
    if (!saved || !saved.config || !saved.rows) return;
    const c = saved.config;
    if (c.noteMin != null) el.noteMin.value = c.noteMin;
    if (c.noteMax != null) el.noteMax.value = c.noteMax;
    if (c.beatsPerMeasure != null) el.beatsPerMeasure.value = c.beatsPerMeasure;
    if (c.totalMeasures != null) el.totalMeasures.value = c.totalMeasures;
    if (c.subdivision != null) el.subdivision.value = c.subdivision;
    el.allowDot.checked = !!c.allowDot;

    renderScore(saved.rows, c.beatsPerMeasure);
    if (saved.background) el.scoreWrap.style.background = saved.background;
    el.scoreWrap.classList.add('has-content');
  })();

  // ---------- Metronome ----------
  const METRONOME_KEY = 'jianpu-metronome-v1';
  const SCHEDULE_AHEAD = 0.12; // seconds
  const LOOKAHEAD_MS = 25;

  let metroBpm = 100;
  let metroSubdiv = 1;
  let metroPlaying = false;
  let audioCtx = null;
  let nextNoteTime = 0;
  let clickInBeat = 0;
  let schedulerId = null;

  function loadMetronomeState() {
    try {
      const raw = localStorage.getItem(METRONOME_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveMetronomeState() {
    try {
      localStorage.setItem(METRONOME_KEY, JSON.stringify({ bpm: metroBpm, subdiv: metroSubdiv }));
    } catch (e) { /* ignore */ }
  }

  function setActiveSubdivButton() {
    el.subdivRow.querySelectorAll('.subdiv-option').forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.subdiv, 10) === metroSubdiv);
    });
  }

  function scheduleClick(time, accent) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    gain.gain.setValueAtTime(accent ? 0.9 : 0.45, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function metronomeScheduler() {
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
      scheduleClick(nextNoteTime, clickInBeat === 0);
      const beatDuration = 60 / metroBpm;
      nextNoteTime += beatDuration / metroSubdiv;
      clickInBeat = (clickInBeat + 1) % metroSubdiv;
    }
    schedulerId = setTimeout(metronomeScheduler, LOOKAHEAD_MS);
  }

  function startMetronome() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    clickInBeat = 0;
    nextNoteTime = audioCtx.currentTime + 0.05;
    metronomeScheduler();
    metroPlaying = true;
    el.metronomeToggle.textContent = '⏸ 停止';
    el.metronomeToggle.classList.add('playing');
    el.metronomeBtn.classList.add('playing');
  }

  function stopMetronome() {
    metroPlaying = false;
    if (schedulerId) clearTimeout(schedulerId);
    schedulerId = null;
    el.metronomeToggle.textContent = '▶ 開始';
    el.metronomeToggle.classList.remove('playing');
    el.metronomeBtn.classList.remove('playing');
  }

  (function initMetronome() {
    const saved = loadMetronomeState();
    if (saved) {
      metroBpm = clamp(parseInt(saved.bpm, 10) || 100, 40, 240);
      metroSubdiv = [1, 2, 3, 4].includes(saved.subdiv) ? saved.subdiv : 1;
    }
    el.tempoSlider.value = metroBpm;
    el.tempoValue.textContent = metroBpm;
    setActiveSubdivButton();
  })();

  el.metronomeBtn.addEventListener('click', () => {
    el.metronomeModal.classList.remove('hidden');
  });

  el.metronomeClose.addEventListener('click', () => {
    el.metronomeModal.classList.add('hidden');
  });

  el.metronomeModal.addEventListener('click', (e) => {
    if (e.target === el.metronomeModal) el.metronomeModal.classList.add('hidden');
  });

  function setTempo(bpm) {
    metroBpm = clamp(bpm, 40, 240);
    el.tempoSlider.value = metroBpm;
    el.tempoValue.textContent = metroBpm;
    saveMetronomeState();
  }

  el.tempoSlider.addEventListener('input', () => {
    setTempo(parseInt(el.tempoSlider.value, 10));
  });

  el.tempoMinus.addEventListener('click', () => setTempo(metroBpm - 1));
  el.tempoPlus.addEventListener('click', () => setTempo(metroBpm + 1));

  el.subdivRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.subdiv-option');
    if (!btn) return;
    metroSubdiv = parseInt(btn.dataset.subdiv, 10);
    setActiveSubdivButton();
    saveMetronomeState();
  });

  el.metronomeToggle.addEventListener('click', () => {
    if (metroPlaying) {
      stopMetronome();
    } else {
      startMetronome();
    }
  });

  // ---------- PWA service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
