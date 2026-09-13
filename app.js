(() => {
  'use strict';

  // ---------- DOM ----------
  const el = {
    controlBar: document.getElementById('controlBar'),
    toggleControls: document.getElementById('toggleControls'),
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
    advancedBtn: document.getElementById('advancedBtn'),
    advancedModal: document.getElementById('advancedModal'),
    advancedClose: document.getElementById('advancedClose'),
    allowRest: document.getElementById('allowRest'),
    restProbability: document.getElementById('restProbability'),
    octaveMin: document.getElementById('octaveMin'),
    octaveMax: document.getElementById('octaveMax'),
    twoHandMode: document.getElementById('twoHandMode'),
    allowTie: document.getElementById('allowTie'),
    tieProbability: document.getElementById('tieProbability'),
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
  const STORAGE_KEY = 'jianpu-gen-state-v3';

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

  function cloneShape(notes) {
    return notes.map((n) => ({ level: n.level, dotted: n.dotted, tuplet: n.tuplet }));
  }

  // Decides rests and pitch values within a beat (in place), avoiding an
  // immediate repeat of the previous pitch when the selected range allows
  // it. `noteMin`/`noteMax` are a 1-21 position (7 degrees x 3 octaves),
  // decoded into {degree, octave} for rendering.
  function applyRestsAndValues(notes, config) {
    const { noteMin, noteMax, allowRest, restProbability } = config;
    let prev = null;
    notes.forEach((n) => {
      if (allowRest && Math.random() < restProbability) {
        n.rest = true;
        return;
      }
      n.rest = false;
      let raw = randInt(noteMin, noteMax);
      if (noteMax > noteMin) {
        let tries = 0;
        while (raw === prev && tries < 10) {
          raw = randInt(noteMin, noteMax);
          tries++;
        }
      }
      prev = raw;
      const idx = raw - 1;
      n.degree = (idx % 7) + 1;
      n.octave = Math.floor(idx / 7) - 1; // -1, 0, or 1
    });
  }

  // A tie is only real notation when the sustain can't be written as a
  // single note - i.e. one side of the join is a partial-beat note
  // (syncopation across the beat boundary). If BOTH beats are a single,
  // undivided whole-beat note (`length === 1`, which by construction of
  // splitNode's base case means level 0 / undotted / no tuplet - the note
  // starts exactly on the beat and fills it), jianpu convention holds the
  // pitch with a dash ("2 -") rather than re-striking the digit under a
  // curved tie, so that combination is skipped entirely here.
  function applyTiesAcrossBeats(beats, config) {
    const { allowTie, tieProbability } = config;
    if (!allowTie) return;
    for (let i = 0; i < beats.length - 1; i++) {
      if (beats[i].length === 1 && beats[i + 1].length === 1) continue;
      // Don't chain a tie onto a beat whose own first note is already the
      // receiving end of one - a 3-note tie chain (short-long-short) reads
      // as unusual/rare notation, so keep every tie an isolated pair.
      if (beats[i][0].tied) continue;
      const a = beats[i][beats[i].length - 1];
      const b = beats[i + 1][0];
      if (a.rest || b.rest) continue;
      if (Math.random() < tieProbability) {
        b.degree = a.degree;
        b.octave = a.octave;
        b.tied = true;
      }
    }
  }

  function generateScore(config) {
    const { beatsPerMeasure, totalMeasures, subdivision, allowDot, twoHandMode } = config;
    const voiceCount = twoHandMode ? 2 : 1;
    const rows = [];
    for (let m = 0; m < totalMeasures; m++) {
      const voices = Array.from({ length: voiceCount }, () => []);
      for (let b = 0; b < beatsPerMeasure; b++) {
        const shape = generateBeat(subdivision, allowDot);
        for (let v = 0; v < voiceCount; v++) {
          const notes = cloneShape(shape);
          applyRestsAndValues(notes, config);
          voices[v].push(notes);
        }
      }
      voices.forEach((beats) => applyTiesAcrossBeats(beats, config));
      rows.push(voices);
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
      noteEl.className = n.tied ? 'note tied' : 'note';

      // The digit + octave dot live in their own wrapper so the rhythm
      // dot (appended after, as a sibling) never widens this box and
      // throws off the octave dot's horizontal centering.
      const glyph = document.createElement('span');
      glyph.className = 'note-glyph';
      if (n.rest) {
        noteEl.classList.add('rest');
        glyph.textContent = '0';
      } else {
        glyph.textContent = String(n.degree);
        if (n.octave === 1) {
          const oct = document.createElement('span');
          oct.className = 'oct-dot oct-dot-above';
          glyph.appendChild(oct);
        } else if (n.octave === -1) {
          const oct = document.createElement('span');
          oct.className = 'oct-dot oct-dot-below';
          glyph.appendChild(oct);
        }
      }
      noteEl.appendChild(glyph);
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

  function buildBeatsRow(beats, extraClass) {
    const beatsWrap = document.createElement('div');
    beatsWrap.className = extraClass ? `beats ${extraClass}` : 'beats';
    beats.forEach((notes) => beatsWrap.appendChild(buildBeatEl(notes)));
    return beatsWrap;
  }

  function renderScore(rows, beatsPerMeasure) {
    el.score.innerHTML = '';
    rows.forEach((voices, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.className = voices.length > 1 ? 'row two-hand' : 'row';

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

      if (voices.length > 1) {
        const stack = document.createElement('div');
        stack.className = 'voice-stack';
        voices.forEach((beats, vi) => {
          stack.appendChild(buildBeatsRow(beats, vi === 1 ? 'voice-left' : 'voice-right'));
        });
        rowEl.appendChild(stack);
      } else {
        rowEl.appendChild(buildBeatsRow(voices[0]));
      }

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

    settleTieArcs();
    watchTieArcLayout();
    startTieArcGuard();
    // Mobile browser chrome and text metrics can finish settling well after
    // the DOM insertion. These final passes complement the ResizeObserver
    // for position-only changes that do not emit a resize notification.
    [300, 700, 1200].forEach((delay) => setTimeout(() => settleTieArcs(), delay));
  }

  // A deeply nested flex layout can keep changing after two consecutive
  // frames report the same geometry (notably while the browser settles text
  // metrics). Re-measure for the whole settling window instead of stopping
  // early, otherwise an arc keeps a stale horizontal position.
  function settleTieArcs(remainingFrames) {
    if (remainingFrames === undefined) remainingFrames = 12;
    positionTieArcs();
    if (remainingFrames > 0) {
      requestAnimationFrame(() => settleTieArcs(remainingFrames - 1));
    }
  }

  // A tied note is always the first note of its beat (ties only ever span
  // a beat boundary), so its partner is the last note of the previous beat
  // - a sibling `.beat` element, not a sibling within the same notes-row.
  function findTiePartner(noteEl) {
    const beatEl = noteEl.closest('.beat');
    const prevBeat = beatEl && beatEl.previousElementSibling;
    if (!prevBeat || !prevBeat.classList.contains('beat')) return null;
    const notes = prevBeat.querySelectorAll('.notes-row > .note');
    return notes.length ? notes[notes.length - 1] : null;
  }

  // Ties are drawn as absolutely-positioned arcs spanning the two note
  // elements they connect, sized from actual layout (flex item widths vary
  // with note count/screen size, so this can't be done in pure CSS).
  // Positioned via getBoundingClientRect against the shared `.beats`
  // container since the two notes live in different beats (each their own
  // flex item / offset context).
  const TIE_ARC_GAP = 11; // px of clearance above the higher of the two notes

  // The rhythm dot (e.g. "2˙" for a dotted note) is a sibling appended
  // after `.note-glyph` inside `.note`, so the note box and the beat's
  // equal-width slots do not necessarily share the digit's visual center.
  // Use the rendered glyph's viewport rect. This is converted to the
  // containing `.beats` coordinate system only after the final layout pass.
  function noteAnchor(noteEl) {
    const glyphEl = noteEl.querySelector('.note-glyph');
    const glyphRect = glyphEl.getBoundingClientRect();
    return {
      left: glyphRect.left + glyphRect.width / 2,
      top: glyphRect.top,
    };
  }

  function positionTieArcs() {
    window.__scoreWrapWidthLog = window.__scoreWrapWidthLog || [];
    window.__scoreWrapWidthLog.push({ clientWidth: el.scoreWrap.clientWidth, offsetWidth: el.scoreWrap.offsetWidth, scrollHeight: el.scoreWrap.scrollHeight, clientHeight: el.scoreWrap.clientHeight, t: performance.now() });
    // Clear any existing arcs from a previous render first, then measure
    // everything on that clean slate before creating new ones - interleaving
    // reads (getBoundingClientRect) with writes (removing/creating arcs) for
    // many ties in one pass forces repeated synchronous layout, and some of
    // those in-between reflows were observed to report stale flex geometry.
    el.score.querySelectorAll('.tie-arc').forEach((n) => n.remove());
    const specs = [];
    el.score.querySelectorAll('.note.tied').forEach((noteEl) => {
      const prevEl = findTiePartner(noteEl);
      const beatsRow = noteEl.closest('.beats');
      if (!prevEl || !beatsRow || prevEl.closest('.beats') !== beatsRow) return;
      const prevG = noteAnchor(prevEl);
      const curG = noteAnchor(noteEl);
      const rowRect = beatsRow.getBoundingClientRect();
      const left = prevG.left - rowRect.left;
      const right = curG.left - rowRect.left;
      const top = Math.min(prevG.top, curG.top) - rowRect.top - TIE_ARC_GAP;
      specs.push({ beatsRow, left, right, top, prevCenter: prevG.left, curCenter: curG.left, noteEl, prevEl });
    });

    specs.forEach(({ beatsRow, left, right, top, prevCenter, curCenter, noteEl, prevEl }) => {
      const arc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arc.setAttribute('class', 'tie-arc');
      arc.setAttribute('viewBox', '0 0 100 12');
      arc.setAttribute('preserveAspectRatio', 'none');
      const curve = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // Unlike a CSS border-radius, this path reaches x=0 and x=100 exactly:
      // its visible endpoints are therefore directly over the two numerals.
      curve.setAttribute('d', 'M 0 8 Q 50 0 100 8');
      arc.appendChild(curve);
      arc._debugNoteEl = noteEl;
      arc._debugPrevEl = prevEl;
      arc._debugBeatsRow = beatsRow;
      // `left` and `right` are both relative to this arc's `.beats` parent.
      arc.style.left = `${left}px`;
      arc.style.width = `${Math.max(right - left, 0)}px`;
      arc.style.top = `${top}px`;
      beatsRow.appendChild(arc);

      // The browser can round an SVG/flex offset differently from its parent
      // coordinates. Correct from the arc's *painted* rectangle, so its two
      // visible endpoints match the two glyph centers exactly.
      const painted = arc.getBoundingClientRect();
      arc.style.left = `${left + prevCenter - painted.left}px`;
      arc.style.width = `${Math.max(0, right - left + (curCenter - prevCenter) - painted.width)}px`;
    });
  }

  let tieLayoutObserver = null;
  let tieLayoutFrame = null;
  let tieArcGuard = null;

  // Some mobile browsers adjust the scrollable flex area without emitting a
  // resize event. Keep a lightweight guard while the generated score is
  // visible so a late silent reflow cannot leave a tie behind its numerals.
  function startTieArcGuard() {
    if (tieArcGuard !== null) clearInterval(tieArcGuard);
    tieArcGuard = setInterval(() => {
      if (!document.hidden) positionTieArcs();
    }, 200);
  }

  // The width of a beat controls every numeral center inside it. Observe all
  // beats rather than only #score: a flex redistribution can move a glyph
  // while leaving the score's own dimensions unchanged.
  function watchTieArcLayout() {
    if (!window.ResizeObserver) return;
    if (tieLayoutObserver) tieLayoutObserver.disconnect();
    tieLayoutObserver = new ResizeObserver(() => {
      if (tieLayoutFrame !== null) return;
      tieLayoutFrame = requestAnimationFrame(() => {
        tieLayoutFrame = null;
        settleTieArcs();
      });
    });
    el.score.querySelectorAll('.beats, .beat').forEach((node) => tieLayoutObserver.observe(node));
  }

  window.addEventListener('resize', () => settleTieArcs());
  el.scoreWrap.addEventListener('scroll', () => positionTieArcs(), { passive: true });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => settleTieArcs());
  }

  // ---------- Config reading / validation ----------
  function readConfig() {
    let noteMin = clamp(parseInt(el.octaveMin.value, 10) || 8, 1, 21);
    let noteMax = clamp(parseInt(el.octaveMax.value, 10) || 12, 1, 21);
    if (noteMin > noteMax) [noteMin, noteMax] = [noteMax, noteMin];

    const beatsPerMeasure = clamp(parseInt(el.beatsPerMeasure.value, 10) || 4, 1, 12);
    el.beatsPerMeasure.value = beatsPerMeasure;

    const totalMeasures = clamp(parseInt(el.totalMeasures.value, 10) || 4, 1, 64);
    el.totalMeasures.value = totalMeasures;

    const subdivision = clamp(parseInt(el.subdivision.value, 10) || 4, 1, 8);
    el.subdivision.value = subdivision;

    const allowDot = el.allowDot.checked;

    const allowRest = el.allowRest.checked;
    const restProbability = clamp(parseInt(el.restProbability.value, 10) || 0, 0, 50) / 100;
    el.restProbability.value = Math.round(restProbability * 100);

    const twoHandMode = el.twoHandMode.checked;

    const allowTie = el.allowTie.checked;
    const tieProbability = clamp(parseInt(el.tieProbability.value, 10) || 0, 0, 50) / 100;
    el.tieProbability.value = Math.round(tieProbability * 100);

    return {
      noteMin, noteMax, beatsPerMeasure, totalMeasures, subdivision, allowDot,
      allowRest, restProbability, twoHandMode, allowTie, tieProbability,
    };
  }

  // ---------- Generate flow (with loading animation) ----------
  let generating = false;

  function handleGenerate(opts) {
    const { showOverlay = true, onDone } = opts || {};
    if (generating) return;
    generating = true;
    const config = readConfig();

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

  // ---------- Advanced settings (rests / octave range / two-hand mode) ----------
  const OCTAVE_LABELS = ['低音', '', '高音'];

  function populateOctaveSelect(selectEl, defaultPosition) {
    selectEl.innerHTML = '';
    for (let octIdx = 0; octIdx < 3; octIdx++) {
      for (let degree = 1; degree <= 7; degree++) {
        const position = octIdx * 7 + degree;
        const opt = document.createElement('option');
        opt.value = String(position);
        opt.textContent = `${OCTAVE_LABELS[octIdx]}${degree}`;
        if (position === defaultPosition) opt.selected = true;
        selectEl.appendChild(opt);
      }
    }
  }

  populateOctaveSelect(el.octaveMin, 8); // mid-octave 1
  populateOctaveSelect(el.octaveMax, 12); // mid-octave 5

  el.advancedBtn.addEventListener('click', () => {
    el.advancedModal.classList.remove('hidden');
  });

  el.advancedClose.addEventListener('click', () => {
    el.advancedModal.classList.add('hidden');
  });

  el.advancedModal.addEventListener('click', (e) => {
    if (e.target === el.advancedModal) el.advancedModal.classList.add('hidden');
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
    el.pullIndicator.classList.add('settling');
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
    el.pullIndicator.classList.remove('settling');
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
      el.pullIndicator.classList.add('settling', 'spinning');
      el.pullIndicator.style.opacity = '1';
      el.pullIndicator.style.transform = `translate(-50%, ${PULL_RELOAD_THRESHOLD}px)`;
      forceReload();
    } else if (pullDist >= PULL_REGEN_THRESHOLD) {
      el.pullIndicator.classList.add('settling', 'spinning');
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

    if (c.noteMin != null) el.octaveMin.value = c.noteMin;
    if (c.noteMax != null) el.octaveMax.value = c.noteMax;

    if (c.beatsPerMeasure != null) el.beatsPerMeasure.value = c.beatsPerMeasure;
    if (c.totalMeasures != null) el.totalMeasures.value = c.totalMeasures;
    if (c.subdivision != null) el.subdivision.value = c.subdivision;
    el.allowDot.checked = !!c.allowDot;
    el.allowRest.checked = !!c.allowRest;
    if (c.restProbability != null) el.restProbability.value = Math.round(c.restProbability * 100);
    el.twoHandMode.checked = !!c.twoHandMode;
    el.allowTie.checked = !!c.allowTie;
    if (c.tieProbability != null) el.tieProbability.value = Math.round(c.tieProbability * 100);

    renderScore(saved.rows, c.beatsPerMeasure);
    if (saved.background) el.scoreWrap.style.background = saved.background;
    el.scoreWrap.classList.add('has-content');
  })();

  // ---------- Metronome ----------
  // Playback is a looping <audio> element rather than a Web Audio scheduler:
  // mobile browsers throttle setTimeout/requestAnimationFrame and suspend
  // AudioContext as soon as the page is backgrounded (switching to another
  // app, locking the screen), because pure Web Audio isn't recognized by the
  // OS as "media playback". A real <audio> element handed to the native
  // media pipeline, plus a registered MediaSession, keeps playing through
  // that suspension the way a music app would.
  const METRONOME_KEY = 'jianpu-metronome-v1';

  let metroBpm = 100;
  let metroSubdiv = 1;
  let metroPlaying = false;
  let currentBlobUrl = null;
  let regenTimer = null;
  let regenToken = 0;

  const metroAudio = new Audio();
  metroAudio.loop = true;
  metroAudio.preload = 'auto';
  metroAudio.setAttribute('playsinline', '');
  metroAudio.style.display = 'none';
  document.body.appendChild(metroAudio);

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

  // A run of whole beats (each with its accent + subdivision clicks) is
  // rendered offline and looped natively by <audio> - repeating this unit
  // forever reproduces the same accent-on-every-beat pattern the old live
  // scheduler produced. The unit spans several seconds rather than a single
  // beat because <audio>'s loop isn't guaranteed sample-accurate across
  // browsers - each wrap can add a sliver of gap, and wrapping less often
  // shrinks how much of that error accumulates over time (it can't remove
  // clock drift between two independent devices' audio hardware, only
  // reduce the extra error this implementation itself would add on top).
  // A quiet continuous 20Hz tone is mixed in for the same reason the old
  // keep-alive oscillator existed: true digital silence between clicks
  // reads as "no audio" to a Bluetooth output's power management and it
  // drops the link into standby, causing an audible re-negotiation delay
  // before the next click. A genuinely non-zero (but inaudible) signal
  // keeps the link awake without anyone hearing it.
  const LOOP_TARGET_SECONDS = 6;

  // Rendering at a hardcoded 44100Hz and letting the device's real output
  // hardware (commonly 48000Hz on iPads, often 44100Hz on desktops) play it
  // back is exactly the kind of mismatch that makes a clip run audibly fast
  // or slow if anything along the way - the offline renderer, or the
  // decoder handed the WAV later - ever assumes the hardware rate instead
  // of reading the file's own declared rate. Rendering at the device's own
  // native rate sidesteps that class of bug entirely: requested and actual
  // are the same number, so there's nothing left to silently coerce.
  let cachedSampleRate = null;
  function getDeviceSampleRate() {
    if (cachedSampleRate) return cachedSampleRate;
    try {
      const probe = new (window.AudioContext || window.webkitAudioContext)();
      cachedSampleRate = probe.sampleRate || 44100;
      probe.close();
    } catch (e) {
      cachedSampleRate = 44100;
    }
    return cachedSampleRate;
  }

  async function buildClickLoopBuffer(bpm, subdiv) {
    const sampleRate = getDeviceSampleRate();
    const beatDuration = 60 / bpm;
    const beatsPerLoop = Math.max(1, Math.round(LOOP_TARGET_SECONDS / beatDuration));
    const loopDuration = beatDuration * beatsPerLoop;
    const length = Math.max(1, Math.round(loopDuration * sampleRate));
    const ctx = new OfflineAudioContext(1, length, sampleRate);

    for (let beat = 0; beat < beatsPerLoop; beat++) {
      const beatStart = beat * beatDuration;
      for (let i = 0; i < subdiv; i++) {
        const t = beatStart + (beatDuration / subdiv) * i;
        const accent = i === 0;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = accent ? 1500 : 1000;
        gain.gain.setValueAtTime(accent ? 0.9 : 0.45, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(Math.min(t + 0.06, beatStart + beatDuration));
      }
    }

    const keepAliveOsc = ctx.createOscillator();
    const keepAliveGain = ctx.createGain();
    keepAliveGain.gain.value = 0.003;
    keepAliveOsc.frequency.value = 20;
    keepAliveOsc.connect(keepAliveGain).connect(ctx.destination);
    keepAliveOsc.start(0);
    keepAliveOsc.stop(loopDuration);

    return ctx.startRendering();
  }

  function audioBufferToWavBlob(buffer) {
    const numCh = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const dataSize = buffer.length * numCh * 2;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * 2, true);
    view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    const channelData = [];
    for (let ch = 0; ch < numCh; ch++) channelData.push(buffer.getChannelData(ch));
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  async function regenerateClickLoop(bpm, subdiv) {
    const token = ++regenToken;
    const buffer = await buildClickLoopBuffer(bpm, subdiv);
    if (token !== regenToken) return; // superseded by a newer tempo/subdiv change
    const url = URL.createObjectURL(audioBufferToWavBlob(buffer));
    const oldUrl = currentBlobUrl;
    currentBlobUrl = url;
    const wasPlaying = metroPlaying && !metroAudio.paused;
    metroAudio.src = url;
    if (wasPlaying) {
      metroAudio.currentTime = 0;
      metroAudio.play().catch(() => {});
    }
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }

  function scheduleRegenerate() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(() => regenerateClickLoop(metroBpm, metroSubdiv), 150);
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: '節拍器', artist: '簡譜產生器' });
    navigator.mediaSession.setActionHandler('play', () => { if (!metroPlaying) startMetronome(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (metroPlaying) stopMetronome(); });
    try {
      navigator.mediaSession.setActionHandler('stop', () => { if (metroPlaying) stopMetronome(); });
    } catch (e) { /* not supported everywhere */ }
  }

  function updateMediaSessionState(state) {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
  }

  function startMetronome() {
    metroAudio.currentTime = 0;
    const playPromise = metroAudio.play();
    metroPlaying = true;
    el.metronomeToggle.textContent = '⏸ 停止';
    el.metronomeToggle.classList.add('playing');
    el.metronomeBtn.classList.add('playing');
    updateMediaSessionState('playing');
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        metroPlaying = false;
        el.metronomeToggle.textContent = '▶ 開始';
        el.metronomeToggle.classList.remove('playing');
        el.metronomeBtn.classList.remove('playing');
        updateMediaSessionState('paused');
      });
    }
    ensureShakePermission().then((granted) => {
      if (granted && metroPlaying) attachShakeListener();
    });
  }

  function stopMetronome() {
    metroPlaying = false;
    metroAudio.pause();
    updateMediaSessionState('paused');
    el.metronomeToggle.textContent = '▶ 開始';
    el.metronomeToggle.classList.remove('playing');
    el.metronomeBtn.classList.remove('playing');
    detachShakeListener();
  }

  // ---------- Shake-to-mute: stop the metronome if the device is shaken ----------
  const SHAKE_THRESHOLD = 15; // m/s^2 change between readings
  const SHAKE_COOLDOWN_MS = 1000;
  // Starting the metronome re-arms this listener almost immediately (the
  // permission promise resolves synchronously once already granted), but
  // the device is often still physically settling right after the shake
  // that triggered the previous stop (arm coming down, finger reaching for
  // the button). Without this grace window that leftover motion reads as
  // another shake and immediately stops the metronome right after it starts.
  const SHAKE_ARM_GRACE_MS = 800;
  let lastShakeTime = 0;
  let lastAccel = null;
  let shakeArmedAt = 0;
  let shakePermissionState = 'unknown'; // unknown | granted | denied | unsupported

  function needsMotionPermission() {
    return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  }

  // Must be invoked synchronously from within a user-gesture handler (iOS
  // requirement) - startMetronome() is only ever called from a click.
  async function ensureShakePermission() {
    if (shakePermissionState === 'granted') return true;
    if (!needsMotionPermission()) {
      shakePermissionState = typeof DeviceMotionEvent !== 'undefined' ? 'granted' : 'unsupported';
      return shakePermissionState === 'granted';
    }
    try {
      shakePermissionState = (await DeviceMotionEvent.requestPermission()) === 'granted' ? 'granted' : 'denied';
    } catch (e) {
      shakePermissionState = 'denied';
    }
    return shakePermissionState === 'granted';
  }

  function handleDeviceMotion(e) {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x == null) return;
    if (lastAccel) {
      const dx = acc.x - lastAccel.x;
      const dy = acc.y - lastAccel.y;
      const dz = acc.z - lastAccel.z;
      const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const now = Date.now();
      const armed = now - shakeArmedAt > SHAKE_ARM_GRACE_MS;
      if (armed && delta > SHAKE_THRESHOLD && now - lastShakeTime > SHAKE_COOLDOWN_MS) {
        lastShakeTime = now;
        if (metroPlaying) stopMetronome();
      }
    }
    lastAccel = { x: acc.x, y: acc.y, z: acc.z };
  }

  function attachShakeListener() {
    lastAccel = null;
    shakeArmedAt = Date.now();
    window.addEventListener('devicemotion', handleDeviceMotion);
  }

  function detachShakeListener() {
    window.removeEventListener('devicemotion', handleDeviceMotion);
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
    setupMediaSession();
    regenerateClickLoop(metroBpm, metroSubdiv);
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
    scheduleRegenerate();
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
    scheduleRegenerate();
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
