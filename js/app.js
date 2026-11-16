/**
 * MaestroScroll — Main Application Controller
 * Handles Orchestra MusicXML Viewer, ABC Score Composer,
 * Stage PDF Auto-Scroller & Annotations, Metronome/Tuner, and Library/Setlists.
 */
(() => {
  'use strict';

  const STORAGE_LIBRARY = 'maestroscroll_library_v1';
  const STORAGE_SETLISTS = 'maestroscroll_setlists_v1';

  const audioEngine = new window.MaestroAudioEngine();

  const isMobileViewport = () => window.innerWidth <= 900 || window.innerHeight <= 600;

  // Application State
  const state = {
    activeTab: 'orchestra',
    osmd: null,
    rawXml: '',
    currentTitle: 'Untitled Score',
    currentParts: [],
    selectedPartIds: [], // empty = Full Score
    transposeSemi: 0,
    zoomLevel: isMobileViewport() ? 0.75 : 0.85,
    mixerConfig: {},
    xmlAutoScroll: false,
    xmlScrollPos: 0,
    lastFrameTime: 0,

    // Metronome
    tapTimes: [],
    tunerRunning: false,

    // ABC Composer
    abcRenderTimer: null,
    abcVisualObjs: [],
    abcLoop: false,

    // Stage PDF / Auto-scroll
    stageAutoScroll: false,
    stageScrollFloat: 0,
    stagePagesCount: 0,
    stageCurrentPage: 1,
    drawMode: false,
    drawTool: 'pen',
    drawColor: '#ef4444',
    isCountingIn: false,

    // Library & Setlists
    library: [],
    setlists: [],
    activeSetlistId: null
  };

  // DOM Helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showToast(message, type = 'info') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, 3000);
  }

  // =========================================================================
  // Cache Management & Force Reload
  // =========================================================================
  async function clearAppCacheAndReload(promptConfirm = false) {
    if (promptConfirm && !confirm('ต้องการล้างแคชเครื่องและโหลดเวอร์ชันล่าสุด v1.3.2 ใช่หรือไม่?')) {
      return;
    }
    showToast('กำลังล้างแคชเครื่องและดึงเวอร์ชันล่าสุด v1.3.2...', 'info');

    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          try {
            if (reg.active) reg.active.postMessage({ type: 'CLEAR_ALL_CACHES' });
            await reg.unregister();
          } catch (_) {}
        }
      }

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }

      try {
        sessionStorage.clear();
      } catch (_) {}
    } catch (err) {
      console.warn('Cache purge error:', err);
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.set('_v', Date.now().toString());
    window.location.replace(cleanUrl.href);
  }

  function showUpdateBanner(worker) {
    const container = $('#toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast info toast-update-banner';
    toast.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;">
        <span><i class="fa-solid fa-sparkles text-accent"></i> มีอัปเดตเวอร์ชันใหม่ (v1.3.2)</span>
        <button id="btn-toast-update-now" class="btn btn-primary btn-sm" style="padding:4px 10px;font-size:0.75rem;">
          <i class="fa-solid fa-arrows-rotate"></i> อัปเดตทันที
        </button>
      </div>
    `;
    container.appendChild(toast);

    const updateBtn = toast.querySelector('#btn-toast-update-now');
    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
        clearAppCacheAndReload(false);
      });
    }
  }

  // =========================================================================
  // Initialization & Service Worker
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker
        .register('./sw.js?v=1.3.2', { updateViaCache: 'none' })
        .then((reg) => {
          // Check for newer SW on server immediately
          reg.update().catch(() => {});

          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner(installing);
              }
            });
          });
        })
        .catch(() => {});

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }

    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    initNavigationAndModals();
    initMetronomeAndTuner();
    initOrchestraViewer();
    initAbcComposer();
    initStageViewer();
    initLibraryAndSetlists();
    initGlobalShortcuts();
    initMobileUX();

    // Start unified animation loop for smooth auto-scrolling
    requestAnimationFrame(animationLoop);
  });

  // =========================================================================
  // Navigation, Themes, Fullscreen & Modals
  // =========================================================================
  function initNavigationAndModals() {
    // Cache clearing & version refresh buttons
    const attachCacheRefresh = (el) => {
      if (!el) return;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        clearAppCacheAndReload(false);
      });
    };

    attachCacheRefresh($('#btn-refresh-cache'));
    attachCacheRefresh($('#brand-version-badge'));
    attachCacheRefresh($('#btn-modal-clear-cache'));
    $$('.btn-drawer-refresh').forEach(attachCacheRefresh);

    $$('.nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    $('#btn-toggle-metronome').addEventListener('click', () => {
      const drawer = $('#metronome-drawer');
      drawer.classList.toggle('collapsed');
      $('#btn-toggle-metronome').classList.toggle('active-state', !drawer.classList.contains('collapsed'));
    });

    $('#btn-toggle-theme').addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      const icon = $('#btn-toggle-theme i');
      icon.className = next === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    });

    $('#btn-toggle-night-score').addEventListener('click', () => {
      document.body.classList.toggle('night-score');
      const active = document.body.classList.contains('night-score');
      $('#btn-toggle-night-score').classList.toggle('active-state', active);
      showToast(active ? 'เปิดโหมดกระดาษโน้ตกลางคืน (ถนอมสายตาบนเวที)' : 'กลับสู่กระดาษโน้ตสีขาวปกติ');
    });

    $('#btn-fullscreen').addEventListener('click', toggleFullscreen);
    $('#btn-focus-reader').addEventListener('click', toggleFocusReaderMode);
    $('#btn-shortcuts-help').addEventListener('click', () => openModal('modal-shortcuts'));

    $$('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    $$('.modal-backdrop').forEach((bd) => {
      bd.addEventListener('click', () => bd.closest('.modal').classList.add('hidden'));
    });
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    closeMobileControlsDrawers();
    $$('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
    $$('.tab-view').forEach((v) => v.classList.toggle('active', v.id === `view-${tabName}`));

    if (tabName === 'composer') {
      renderAbcScore();
    } else if (tabName === 'orchestra' && state.osmd) {
      setTimeout(() => {
        try { state.osmd.render(); } catch (_) {}
      }, 60);
    }
    syncFloatingBar();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function openModal(id) {
    $(`#${id}`).classList.remove('hidden');
  }

  function closeModal(id) {
    $(`#${id}`).classList.add('hidden');
  }

  // =========================================================================
  // Metronome & Chromatic Tuner
  // =========================================================================
  function initMetronomeAndTuner() {
    const bpmInput = $('#metro-bpm-input');
    const bpmSlider = $('#metro-bpm-slider');
    const timeSigSelect = $('#metro-timesig');

    function rebuildBeatLeds() {
      const count = parseInt(timeSigSelect.value, 10) || 4;
      const box = $('#metro-beat-leds');
      box.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const dot = document.createElement('div');
        dot.className = 'beat-led' + (i === 0 ? ' accent' : '');
        box.appendChild(dot);
      }
      audioEngine.setMetronomeBeats(count);
    }

    function setMetroBpm(val) {
      const clamped = Math.max(30, Math.min(240, parseInt(val, 10) || 120));
      bpmInput.value = clamped;
      bpmSlider.value = clamped;
      audioEngine.setMetronomeBpm(clamped);
    }

    bpmInput.addEventListener('change', () => setMetroBpm(bpmInput.value));
    bpmSlider.addEventListener('input', () => setMetroBpm(bpmSlider.value));
    $$('.btn-bpm-step').forEach((btn) => {
      btn.addEventListener('click', () => {
        setMetroBpm(parseInt(bpmInput.value, 10) + parseInt(btn.dataset.delta, 10));
      });
    });

    timeSigSelect.addEventListener('change', rebuildBeatLeds);
    rebuildBeatLeds();

    $('#btn-tap-tempo').addEventListener('click', () => {
      const now = performance.now();
      if (state.tapTimes.length && now - state.tapTimes[state.tapTimes.length - 1] > 2200) {
        state.tapTimes = [];
      }
      state.tapTimes.push(now);
      if (state.tapTimes.length > 5) state.tapTimes.shift();
      if (state.tapTimes.length >= 2) {
        let sum = 0;
        for (let i = 1; i < state.tapTimes.length; i++) {
          sum += state.tapTimes[i] - state.tapTimes[i - 1];
        }
        const avgMs = sum / (state.tapTimes.length - 1);
        setMetroBpm(Math.round(60000 / avgMs));
      }
    });

    $('#btn-metro-toggle').addEventListener('click', toggleMetronome);

    // Reference Pitches
    $$('.btn-ref-tone').forEach((btn) => {
      btn.addEventListener('click', () => {
        const freq = parseFloat(btn.dataset.freq);
        const wasActive = btn.classList.contains('active');
        $$('.btn-ref-tone').forEach((b) => b.classList.remove('active'));
        if (wasActive) {
          audioEngine.stopReferenceTone();
        } else {
          btn.classList.add('active');
          audioEngine.startReferenceTone(freq);
        }
      });
    });

    $('#btn-stop-ref-tone').addEventListener('click', () => {
      $$('.btn-ref-tone').forEach((b) => b.classList.remove('active'));
      audioEngine.stopReferenceTone();
    });

    // Live Mic Tuner
    $('#btn-mic-tuner').addEventListener('click', async () => {
      const btn = $('#btn-mic-tuner');
      if (state.tunerRunning) {
        audioEngine.stopTuner();
        state.tunerRunning = false;
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i> เปิดไมค์ตั้งสาย';
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-secondary');
        $('#tuner-note').textContent = '--';
        $('#tuner-freq').textContent = '0.0 Hz';
        $('#tuner-cents-text').textContent = 'ปิดไมค์ตั้งสายแล้ว';
        return;
      }

      state.tunerRunning = true;
      btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i> ปิดไมค์';
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-danger');
      $('#tuner-cents-text').textContent = 'กำลังฟังเสียง...';

      await audioEngine.startTuner(
        ({ freq, note, cents }) => {
          $('#tuner-note').textContent = note;
          $('#tuner-freq').textContent = `${freq.toFixed(1)} Hz`;
          const pct = Math.max(0, Math.min(100, 50 + cents));
          const needle = $('#tuner-needle');
          needle.style.left = `${pct}%`;
          const inTune = Math.abs(cents) <= 6;
          needle.classList.toggle('in-tune', inTune);
          $('#tuner-cents-text').textContent = inTune
            ? `ตรงคีย์เป๊ะ! (${cents >= 0 ? '+' : ''}${cents} cents)`
            : `${cents > 0 ? 'สูงไป +' : 'ต่ำไป '}${cents} cents`;
        },
        () => {
          state.tunerRunning = false;
          btn.innerHTML = '<i class="fa-solid fa-microphone"></i> เปิดไมค์ตั้งสาย';
          btn.classList.add('btn-secondary');
          btn.classList.remove('btn-danger');
          showToast('ไม่สามารถเข้าถึงไมโครโฟนได้ กรุณาอนุญาตสิทธิ์การใช้งานไมค์', 'error');
        }
      );
    });
  }

  function toggleMetronome() {
    const btn = $('#btn-metro-toggle');
    if (audioEngine.metroRunning) {
      audioEngine.stopMetronome();
      btn.innerHTML = '<i class="fa-solid fa-play"></i> เริ่มเคาะ';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-primary');
      $$('#metro-beat-leds .beat-led').forEach((d) => d.classList.remove('active'));
    } else {
      const bpm = parseInt($('#metro-bpm-input').value, 10) || 120;
      const beats = parseInt($('#metro-timesig').value, 10) || 4;
      audioEngine.startMetronome(bpm, beats, (beatIdx) => {
        const leds = $$('#metro-beat-leds .beat-led');
        leds.forEach((d, idx) => d.classList.toggle('active', idx === beatIdx));
      });
      btn.innerHTML = '<i class="fa-solid fa-stop"></i> หยุดเคาะ';
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-danger');
    }
  }

  // =========================================================================
  // Tab 1: Orchestra & Band MusicXML Score Viewer
  // =========================================================================
  function initOrchestraViewer() {
    if (window.opensheetmusicdisplay) {
      state.osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay('osmd-container', {
        autoResize: true,
        backend: 'svg',
        drawingParameters: isMobileViewport() ? 'compacttight' : 'default',
        followCursor: true,
        drawTitle: true,
        drawComposer: true,
        drawPartNames: true,
        drawPartAbbreviations: true
      });
    } else {
      showToast('โหลดไลบรารี OpenSheetMusicDisplay ไม่สำเร็จ (ต้องต่อเน็ตครั้งแรก)', 'error');
    }

    // Sample score switcher
    $('#select-sample-score').addEventListener('change', (e) => {
      const sample = window.MAESTRO_SAMPLES.musicxml[e.target.value];
      if (sample) {
        loadMusicXmlString(sample.xml, sample.title);
        closeMobileControlsDrawers();
      }
    });

    // Upload MusicXML (.xml, .musicxml, .mxl)
    $('#btn-upload-xml').addEventListener('click', () => $('#input-musicxml-file').click());
    $('#input-musicxml-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const xmlText = await window.MusicXMLProcessor.readUploadedFile(file);
        loadMusicXmlString(xmlText, file.name.replace(/\.(xml|musicxml|mxl)$/i, ''));
        closeMobileControlsDrawers();
        showToast(`เปิดไฟล์ "${file.name}" สำเร็จ!`, 'success');
      } catch (err) {
        showToast(`เปิดไฟล์ไม่สำเร็จ: ${err.message}`, 'error');
      }
      e.target.value = '';
    });

    // Transpose Controls
    $('#select-transpose').addEventListener('change', (e) => {
      const customIn = $('#custom-transpose-input');
      if (e.target.value === 'custom') {
        customIn.classList.remove('hidden');
        state.transposeSemi = parseInt(customIn.value, 10) || 0;
      } else {
        customIn.classList.add('hidden');
        state.transposeSemi = parseInt(e.target.value, 10) || 0;
        customIn.value = state.transposeSemi;
        closeMobileControlsDrawers();
      }
      refreshOsmdRender();
    });

    $('#custom-transpose-input').addEventListener('change', (e) => {
      state.transposeSemi = Math.max(-12, Math.min(12, parseInt(e.target.value, 10) || 0));
      refreshOsmdRender();
    });

    // Zoom Controls
    const initPct = `${Math.round(state.zoomLevel * 100)}%`;
    $('#zoom-label').textContent = initPct;
    if ($('#mobile-orch-zoom-badge')) $('#mobile-orch-zoom-badge').textContent = initPct;
    $('#btn-zoom-in').addEventListener('click', () => setOsmdZoom(state.zoomLevel + 0.1));
    $('#btn-zoom-out').addEventListener('click', () => setOsmdZoom(state.zoomLevel - 0.1));

    // Print & Save to Library
    $('#btn-print-score').addEventListener('click', () => window.print());
    $('#btn-save-xml-library').addEventListener('click', () => {
      if (!state.rawXml) return;
      saveScoreToLibrary({
        title: state.currentTitle,
        type: 'musicxml',
        content: state.rawXml
      });
    });

    // Multi-part checkbox
    $('#chk-multi-part').addEventListener('change', (e) => {
      if (!e.target.checked && state.selectedPartIds.length > 1) {
        state.selectedPartIds = [state.selectedPartIds[0]];
        renderPartFilterBar();
        refreshOsmdRender();
      }
    });

    // Transport Controls
    $('#btn-xml-play').addEventListener('click', startXmlPlayback);
    $('#btn-xml-pause').addEventListener('click', pauseXmlPlayback);
    $('#btn-xml-stop').addEventListener('click', stopXmlPlayback);

    $('#xml-tempo-bpm').addEventListener('change', () => {
      audioEngine.setTempo($('#xml-tempo-bpm').value, $('#xml-tempo-mult').value);
    });
    $('#xml-tempo-mult').addEventListener('change', () => {
      audioEngine.setTempo($('#xml-tempo-bpm').value, $('#xml-tempo-mult').value);
    });

    // Auto-Scroll Toggle
    $('#btn-xml-autoscroll').addEventListener('click', toggleXmlAutoScroll);

    // Mixer Modal
    $('#btn-open-mixer').addEventListener('click', () => {
      renderMixerModal();
      openModal('modal-mixer');
    });
    $('#btn-mixer-reset').addEventListener('click', () => {
      Object.values(state.mixerConfig).forEach((m) => {
        m.muted = false;
        m.solo = false;
        m.volume = 0.85;
      });
      audioEngine.updatePartMixer(state.mixerConfig);
      renderMixerModal();
    });

    // Load default initial sample
    const initial = window.MAESTRO_SAMPLES.musicxml.tenor_midnight_ballad || window.MAESTRO_SAMPLES.musicxml.ode_to_joy_orchestra;
    loadMusicXmlString(initial.xml, initial.title);
  }

  function loadMusicXmlString(xmlString, fallbackTitle = 'Untitled Score') {
    stopXmlPlayback();
    try {
      const meta = window.MusicXMLProcessor.parseMetadata(xmlString);
      state.rawXml = xmlString;
      state.currentTitle = meta.title || fallbackTitle;
      state.currentParts = meta.parts;
      // On smartphones, open lead part (P1) cleanly so notes are large & readable;
      // users can switch to Full Score anytime from the slim bar dropdown.
      state.selectedPartIds = isMobileViewport() && meta.parts.length > 0 ? [meta.parts[0].id] : [];
      state.mixerConfig = {};

      meta.parts.forEach((p) => {
        state.mixerConfig[p.id] = {
          name: p.name,
          muted: false,
          solo: false,
          volume: 0.85,
          timbre: window.MaestroAudioEngine.guessTimbre(p.name)
        };
      });

      $('#xml-tempo-bpm').value = meta.tempo;
      $('#xml-measure-progress').textContent = `ห้องที่ 1 / ${meta.totalMeasures || '--'}`;

      renderPartFilterBar();
      refreshOsmdRender();
    } catch (err) {
      showToast(`ไม่สามารถอ่านไฟล์ MusicXML ได้: ${err.message}`, 'error');
    }
  }

  function renderPartFilterBar() {
    const bar = $('#part-filter-bar');
    bar.innerHTML = '';

    const fullBtn = document.createElement('button');
    fullBtn.className = 'part-pill' + (state.selectedPartIds.length === 0 ? ' active' : '');
    fullBtn.textContent = `Full Score (${state.currentParts.length} พาร์ท)`;
    fullBtn.addEventListener('click', () => {
      state.selectedPartIds = [];
      renderPartFilterBar();
      refreshOsmdRender();
    });
    bar.appendChild(fullBtn);

    state.currentParts.forEach((part) => {
      const isActive = state.selectedPartIds.includes(part.id);
      const btn = document.createElement('button');
      btn.className = 'part-pill' + (isActive ? ' active' : '');
      btn.textContent = part.name;
      btn.addEventListener('click', () => {
        const multi = $('#chk-multi-part').checked;
        if (multi) {
          if (state.selectedPartIds.includes(part.id)) {
            state.selectedPartIds = state.selectedPartIds.filter((id) => id !== part.id);
          } else {
            state.selectedPartIds.push(part.id);
          }
        } else {
          state.selectedPartIds = [part.id];
        }
        renderPartFilterBar();
        refreshOsmdRender();
      });
      bar.appendChild(btn);
    });

    // Sync mobile slim-bar part dropdown
    const mobSel = $('#mobile-part-select');
    if (mobSel) {
      mobSel.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = '__ALL__';
      allOpt.textContent = `Full Score (${state.currentParts.length} พาร์ท)`;
      mobSel.appendChild(allOpt);

      state.currentParts.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        mobSel.appendChild(opt);
      });

      mobSel.value = state.selectedPartIds.length === 1 ? state.selectedPartIds[0] : '__ALL__';
    }
  }

  async function refreshOsmdRender() {
    if (!state.osmd || !state.rawXml) return;
    stopXmlPlayback();

    const loading = $('#osmd-loading');
    loading.classList.remove('hidden');

    try {
      let processedXml = window.MusicXMLProcessor.filterParts(state.rawXml, state.selectedPartIds);
      processedXml = window.MusicXMLProcessor.transpose(processedXml, state.transposeSemi);

      const seq = window.MusicXMLProcessor.extractSequence(processedXml);
      audioEngine.loadSequence(seq, state.mixerConfig);
      audioEngine.setTempo($('#xml-tempo-bpm').value, $('#xml-tempo-mult').value);

      state.osmd.Zoom = state.zoomLevel;
      await state.osmd.load(processedXml);
      state.osmd.render();

      if (state.osmd.cursor) {
        state.osmd.cursor.show();
        state.osmd.cursor.reset();
      }
    } catch (err) {
      console.error(err);
      showToast('เกิดข้อผิดพลาดระหว่างจัดเรียงโน้ต: ' + err.message, 'error');
    } finally {
      loading.classList.add('hidden');
    }
  }

  function setOsmdZoom(newZoom) {
    state.zoomLevel = Math.max(0.4, Math.min(1.6, Math.round(newZoom * 100) / 100));
    const pct = `${Math.round(state.zoomLevel * 100)}%`;
    $('#zoom-label').textContent = pct;
    if ($('#mobile-orch-zoom-badge')) $('#mobile-orch-zoom-badge').textContent = pct;
    if (state.osmd && state.rawXml) {
      state.osmd.Zoom = state.zoomLevel;
      try { state.osmd.render(); } catch (_) {}
    }
  }

  function toggleXmlAutoScroll() {
    state.xmlAutoScroll = !state.xmlAutoScroll;
    state.xmlScrollPos = $('#osmd-scroll-wrapper').scrollTop;
    const btn = $('#btn-xml-autoscroll');
    btn.innerHTML = state.xmlAutoScroll
      ? '<i class="fa-solid fa-pause"></i> Auto-Scroll: เปิด'
      : '<i class="fa-solid fa-angles-down"></i> Auto-Scroll: ปิด';
    btn.classList.toggle('btn-success', state.xmlAutoScroll);
    btn.classList.toggle('btn-secondary', !state.xmlAutoScroll);
    syncFloatingBar();
  }

  function startXmlPlayback() {
    if (!audioEngine.sequence || !audioEngine.sequence.events.length) {
      showToast('ไม่มีโน้ตสำหรับเล่นเสียง', 'warning');
      return;
    }

    if (!audioEngine.isPaused && state.osmd && state.osmd.cursor) {
      state.osmd.cursor.show();
      state.osmd.cursor.reset();
    }

    audioEngine.setTempo($('#xml-tempo-bpm').value, $('#xml-tempo-mult').value);
    $('#btn-xml-play').disabled = true;
    $('#btn-xml-pause').disabled = false;
    $('#btn-xml-stop').disabled = false;
    syncFloatingBar();

    const totalMeasures = audioEngine.sequence.totalMeasures || '--';
    const scrollWrapper = $('#osmd-scroll-wrapper');

    audioEngine.startPlayback({
      onProgress: ({ currentBeat, measureNumber }) => {
        if (measureNumber) {
          $('#xml-measure-progress').textContent = `ห้องที่ ${measureNumber} / ${totalMeasures}`;
        }
        // Advance OSMD cursor to match current Beat
        const cursor = state.osmd?.cursor;
        if (cursor && cursor.iterator && !cursor.iterator.EndReached) {
          let guard = 0;
          while (
            !cursor.iterator.EndReached &&
            cursor.iterator.currentTimeStamp &&
            cursor.iterator.currentTimeStamp.RealValue * 4 <= currentBeat &&
            guard < 25
          ) {
            cursor.next();
            guard++;
          }
          // Auto-keep cursor in comfortable reading view
          const cursorEl = cursor.cursorElement;
          if (cursorEl) {
            const cRect = cursorEl.getBoundingClientRect();
            const wRect = scrollWrapper.getBoundingClientRect();
            if (cRect.bottom > wRect.bottom - 90 || cRect.top < wRect.top + 30) {
              scrollWrapper.scrollBy({
                top: cRect.top - wRect.top - wRect.height * 0.28,
                behavior: 'smooth'
              });
            }
          }
        }
      },
      onEnded: () => {
        stopXmlPlayback();
      }
    });
  }

  function pauseXmlPlayback() {
    audioEngine.pausePlayback();
    $('#btn-xml-play').disabled = false;
    $('#btn-xml-pause').disabled = true;
    $('#btn-xml-stop').disabled = false;
    syncFloatingBar();
  }

  function stopXmlPlayback() {
    audioEngine.stopPlayback();
    $('#btn-xml-play').disabled = false;
    $('#btn-xml-pause').disabled = true;
    $('#btn-xml-stop').disabled = true;
    if (state.osmd && state.osmd.cursor) {
      try { state.osmd.cursor.reset(); } catch (_) {}
    }
    const totalMeasures = audioEngine.sequence?.totalMeasures || '--';
    $('#xml-measure-progress').textContent = `ห้องที่ 1 / ${totalMeasures}`;
    syncFloatingBar();
  }

  function renderMixerModal() {
    const container = $('#mixer-channels');
    container.innerHTML = '';

    state.currentParts.forEach((p) => {
      const cfg = state.mixerConfig[p.id];
      if (!cfg) return;

      const row = document.createElement('div');
      row.className = 'mixer-row';
      row.innerHTML = `
        <div>
          <div class="mixer-part-name">${escapeHtml(p.name)}</div>
          <select class="select-sm mixer-timbre" data-part="${p.id}">
            <option value="saxophone" ${cfg.timbre === 'saxophone' ? 'selected' : ''}>เสียงแซกโซโฟน (Saxophone)</option>
            <option value="woodwind" ${cfg.timbre === 'woodwind' ? 'selected' : ''}>เสียงเครื่องลมไม้ (Woodwind)</option>
            <option value="brass" ${cfg.timbre === 'brass' ? 'selected' : ''}>เสียงเครื่องทองเหลือง (Brass)</option>
            <option value="strings" ${cfg.timbre === 'strings' ? 'selected' : ''}>เสียงเครื่องสาย (Strings)</option>
            <option value="percussion" ${cfg.timbre === 'percussion' ? 'selected' : ''}>เสียงเครื่องกระทบ (Percussion)</option>
          </select>
        </div>
        <button class="btn-chip mixer-mute ${cfg.muted ? 'active' : ''}" data-part="${p.id}">Mute</button>
        <button class="btn-chip mixer-solo ${cfg.solo ? 'active' : ''}" data-part="${p.id}">Solo</button>
        <input type="range" class="mixer-vol" min="0" max="100" value="${Math.round(cfg.volume * 100)}" data-part="${p.id}" />
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('.mixer-timbre').forEach((sel) => {
      sel.addEventListener('change', () => {
        state.mixerConfig[sel.dataset.part].timbre = sel.value;
        audioEngine.updatePartMixer(state.mixerConfig);
      });
    });

    container.querySelectorAll('.mixer-mute').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cfg = state.mixerConfig[btn.dataset.part];
        cfg.muted = !cfg.muted;
        btn.classList.toggle('active', cfg.muted);
        audioEngine.updatePartMixer(state.mixerConfig);
      });
    });

    container.querySelectorAll('.mixer-solo').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cfg = state.mixerConfig[btn.dataset.part];
        cfg.solo = !cfg.solo;
        btn.classList.toggle('active', cfg.solo);
        audioEngine.updatePartMixer(state.mixerConfig);
      });
    });

    container.querySelectorAll('.mixer-vol').forEach((slider) => {
      slider.addEventListener('input', () => {
        state.mixerConfig[slider.dataset.part].volume = parseInt(slider.value, 10) / 100;
        audioEngine.updatePartMixer(state.mixerConfig);
      });
    });
  }

  // =========================================================================
  // Tab 2: Score Composer (ABC Studio)
  // =========================================================================
  function initAbcComposer() {
    const editor = $('#abc-editor');

    $('#select-abc-template').addEventListener('change', (e) => {
      const tpl = window.MAESTRO_SAMPLES.abc[e.target.value];
      if (tpl) {
        editor.value = tpl;
        syncMetaFromAbc();
        renderAbcScore();
      }
    });

    editor.addEventListener('input', () => {
      clearTimeout(state.abcRenderTimer);
      state.abcRenderTimer = setTimeout(() => {
        syncMetaFromAbc();
        renderAbcScore();
      }, 150);
    });

    // Metadata two-way sync
    $('#abc-meta-title').addEventListener('input', () => updateAbcHeader('T', $('#abc-meta-title').value));
    $('#abc-meta-composer').addEventListener('input', () => updateAbcHeader('C', $('#abc-meta-composer').value));
    $('#abc-meta-meter').addEventListener('change', () => updateAbcHeader('M', $('#abc-meta-meter').value));
    $('#abc-meta-key').addEventListener('change', () => updateAbcHeader('K', $('#abc-meta-key').value));
    $('#abc-meta-tempo').addEventListener('change', () => updateAbcHeader('Q', `1/4=${$('#abc-meta-tempo').value}`));
    $('#abc-visual-transpose').addEventListener('change', renderAbcScore);

    // Quick-insert buttons
    $$('#abc-quick-toolbar .qi-btn[data-insert]').forEach((btn) => {
      btn.addEventListener('click', () => {
        insertAtCursor(editor, btn.dataset.insert);
        syncMetaFromAbc();
        renderAbcScore();
      });
    });

    $('#btn-abc-add-voice').addEventListener('click', () => {
      const matches = editor.value.match(/^V:\d+/gm) || [];
      const nextNum = matches.length + 1;
      const snippet = `\nV:${nextNum} name="Part ${nextNum}" snm="P${nextNum}" clef=treble\nC D E F | G4 |]`;
      editor.value += snippet;
      renderAbcScore();
      showToast(`เพิ่มพาร์ท V:${nextNum} เรียบร้อย`, 'success');
    });

    // Playback
    $('#btn-abc-play').addEventListener('click', playAbcScore);
    $('#btn-abc-stop').addEventListener('click', stopAbcScore);
    $('#chk-abc-loop').addEventListener('change', (e) => {
      state.abcLoop = e.target.checked;
    });

    // Export & Save
    $('#btn-abc-save-library').addEventListener('click', () => {
      saveScoreToLibrary({
        title: $('#abc-meta-title').value.trim() || 'ABC Score',
        type: 'abc',
        content: editor.value
      });
    });

    $('#btn-abc-export-file').addEventListener('click', () => {
      const title = ($('#abc-meta-title').value.trim() || 'score').replace(/[^\w\u0E00-\u0E7F-]+/g, '_');
      downloadTextFile(`${title}.abc`, editor.value, 'text/plain;charset=utf-8');
    });

    $('#btn-abc-export-svg').addEventListener('click', () => {
      const svgEl = $('#abc-paper svg');
      if (!svgEl) {
        showToast('ยังไม่มีโน้ต SVG ให้ดาวน์โหลด', 'warning');
        return;
      }
      const title = ($('#abc-meta-title').value.trim() || 'score').replace(/[^\w\u0E00-\u0E7F-]+/g, '_');
      const serializer = new XMLSerializer();
      downloadTextFile(`${title}.svg`, serializer.serializeToString(svgEl), 'image/svg+xml;charset=utf-8');
    });

    $('#btn-abc-print').addEventListener('click', () => window.print());

    // Initial template
    const initAbcKey = $('#select-abc-template').value || 'tenor_sax_feature';
    editor.value = window.MAESTRO_SAMPLES.abc[initAbcKey] || window.MAESTRO_SAMPLES.abc.wind_quartet;
    syncMetaFromAbc();
    renderAbcScore();
  }

  function syncMetaFromAbc() {
    const txt = $('#abc-editor').value;
    const getHeader = (code) => {
      const m = txt.match(new RegExp(`^${code}:\\s*(.+)$`, 'm'));
      return m ? m[1].trim() : '';
    };
    const title = getHeader('T');
    const comp = getHeader('C');
    const meter = getHeader('M');
    const key = getHeader('K');
    const tempoRaw = getHeader('Q');

    if (title) $('#abc-meta-title').value = title;
    if (comp) $('#abc-meta-composer').value = comp;
    if (meter && $(`#abc-meta-meter option[value="${meter}"]`)) $('#abc-meta-meter').value = meter;
    if (key && $(`#abc-meta-key option[value="${key}"]`)) $('#abc-meta-key').value = key;
    if (tempoRaw) {
      const tm = tempoRaw.match(/(\d+)\s*$/);
      if (tm) $('#abc-meta-tempo').value = tm[1];
    }
  }

  function updateAbcHeader(code, value) {
    const editor = $('#abc-editor');
    const regex = new RegExp(`^${code}:.*$`, 'm');
    if (regex.test(editor.value)) {
      editor.value = editor.value.replace(regex, `${code}:${value}`);
    } else {
      editor.value = `${code}:${value}\n` + editor.value;
    }
    renderAbcScore();
  }

  function renderAbcScore() {
    if (!window.ABCJS) return;
    const txt = $('#abc-editor').value;
    const visualTranspose = parseInt($('#abc-visual-transpose').value, 10) || 0;
    const warnings = [];

    state.abcVisualObjs = window.ABCJS.renderAbc('abc-paper', txt, {
      responsive: 'resize',
      add_classes: true,
      visualTranspose,
      staffwidth: 820,
      warnings_div: 'abc-warnings'
    });

    if (state.abcVisualObjs[0] && state.abcVisualObjs[0].warnings) {
      warnings.push(...state.abcVisualObjs[0].warnings);
    }
    $('#abc-warnings').innerHTML = warnings.join('<br>');
  }

  function playAbcScore() {
    stopAbcScore();
    const tune = state.abcVisualObjs[0];
    if (!tune) return;

    const bpm = parseInt($('#abc-meta-tempo').value, 10) || 110;
    const events = extractEventsFromAbcVisualObj(tune);
    if (!events.length) {
      showToast('ไม่พบตัวโน้ตสำหรับเล่นเสียงในสกอร์นี้', 'warning');
      return;
    }

    const totalBeats = events.reduce((max, e) => Math.max(max, e.startBeat + e.durationBeats), 0);
    const mixer = {};
    events.forEach((ev) => {
      if (!mixer[ev.partId]) {
        mixer[ev.partId] = {
          muted: false,
          solo: false,
          volume: 0.85,
          timbre: window.MaestroAudioEngine.guessTimbre(ev.partName)
        };
      }
    });

    audioEngine.loadSequence({ tempoBpm: bpm, totalBeats, events }, mixer);
    audioEngine.setTempo(bpm, 1.0);
    audioEngine.startPlayback({
      onEnded: () => {
        if (state.abcLoop && state.activeTab === 'composer') {
          playAbcScore();
        } else {
          syncFloatingBar();
        }
      }
    });
    syncFloatingBar();
  }

  function stopAbcScore() {
    audioEngine.stopPlayback();
    syncFloatingBar();
  }

  function extractEventsFromAbcVisualObj(tune) {
    const events = [];
    if (!tune || !tune.lines) return events;

    const voiceTimes = {}; // track beat offset per voice across lines
    const staffNames = {};

    tune.lines.forEach((line) => {
      if (!line.staff) return;
      line.staff.forEach((staff, sIdx) => {
        if (!staff.voices) return;
        staff.voices.forEach((voice, vIdx) => {
          const partId = `S${sIdx}_V${vIdx}`;
          if (!voiceTimes[partId]) voiceTimes[partId] = 0;

          let partName = staffNames[partId] || `Part ${sIdx + 1}`;

          voice.forEach((elem) => {
            if (elem.el_type === 'staff_extra' || elem.el_type === 'instrument') {
              // skip
            }
            if (elem.el_type === 'note') {
              // ABCJS duration is in whole-note fractions (0.25 = quarter = 1 beat)
              const durBeats = (elem.duration || 0.25) * 4;
              const startBeat = voiceTimes[partId];

              if (elem.pitches && elem.pitches.length > 0 && !elem.rest) {
                elem.pitches.forEach((p) => {
                  const midiPitch = p.midipitch !== undefined ? p.midipitch : abcPitchToMidi(p.pitch, p.accidental);
                  events.push({
                    partId,
                    partName,
                    measureNumber: 1,
                    startBeat,
                    durationBeats: durBeats,
                    midiPitch
                  });
                });
              }
              voiceTimes[partId] += durBeats;
            }
          });
        });
      });
    });

    events.sort((a, b) => a.startBeat - b.startBeat);
    return events;
  }

  function abcPitchToMidi(diatonicStep, accidental) {
    // ABCJS pitch: 0 = C4 (middle C), 1 = D4, ..., 7 = C5
    const scale = [0, 2, 4, 5, 7, 9, 11];
    const octaveOffset = Math.floor(diatonicStep / 7);
    const stepIdx = ((diatonicStep % 7) + 7) % 7;
    let midi = 60 + octaveOffset * 12 + scale[stepIdx];
    if (accidental === 'sharp') midi += 1;
    else if (accidental === 'dblsharp') midi += 2;
    else if (accidental === 'flat') midi -= 1;
    else if (accidental === 'dblflat') midi -= 2;
    return midi;
  }

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    textarea.value = val.slice(0, start) + text + val.slice(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
  }

  // =========================================================================
  // Tab 3: Stage Teleprompter, PDF/Image Auto-Scroller & Annotations
  // =========================================================================
  function initStageViewer() {
    $('#btn-stage-upload').addEventListener('click', () => $('#input-stage-file').click());
    $('#input-stage-file').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      await loadStageFiles(files);
      e.target.value = '';
    });

    $('#btn-stage-demo').addEventListener('click', loadDemoStagePages);

    $('#btn-stage-scroll-toggle').addEventListener('click', toggleStageAutoScroll);
    $('#btn-stage-top').addEventListener('click', () => {
      const vp = $('#stage-scroll-container');
      vp.scrollTo({ top: 0, behavior: 'smooth' });
      state.stageScrollFloat = 0;
    });

    $('#stage-scroll-speed').addEventListener('input', (e) => {
      $('#stage-speed-val').textContent = e.target.value;
    });

    $('#btn-stage-apply-bpm').addEventListener('click', () => {
      const bpm = parseInt($('#stage-sync-bpm').value, 10) || 100;
      const bars = parseInt($('#stage-sync-bars').value, 10) || 24;
      const firstCard = $('.stage-page-card');
      const pageHeight = firstCard ? firstCard.offsetHeight : 1100;
      const secondsPerPage = (bars * 4 * 60) / bpm;
      const pxPerSec = Math.max(5, Math.min(150, Math.round(pageHeight / secondsPerPage)));
      $('#stage-scroll-speed').value = pxPerSec;
      $('#stage-speed-val').textContent = pxPerSec;
      showToast(`ตั้งสปีดเป็น ${pxPerSec} px/s สำหรับ ${bpm} BPM (${bars} ห้อง/หน้า)`, 'success');
    });

    $('#btn-stage-prev-page').addEventListener('click', () => jumpStagePage(-1));
    $('#btn-stage-next-page').addEventListener('click', () => jumpStagePage(1));

    $('#stage-scroll-container').addEventListener('scroll', updateStagePageCounter);

    // Drawing / Annotations
    $('#btn-stage-draw-toggle').addEventListener('click', () => {
      state.drawMode = !state.drawMode;
      $('#btn-stage-draw-toggle').innerHTML = state.drawMode
        ? '<i class="fa-solid fa-pen"></i> โหมดขีดเขียนบนโน้ต: เปิด'
        : '<i class="fa-solid fa-pen"></i> โหมดขีดเขียนบนโน้ต: ปิด';
      $('#btn-stage-draw-toggle').classList.toggle('active-state', state.drawMode);
      $('#stage-draw-tools').classList.toggle('hidden', !state.drawMode);
      $$('.stage-page-card').forEach((card) => card.classList.toggle('draw-enabled', state.drawMode));
    });

    $$('.btn-draw-tool').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.btn-draw-tool').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.drawTool = btn.dataset.tool;
      });
    });

    $$('.color-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        $$('.color-dot').forEach((d) => d.classList.remove('active'));
        dot.classList.add('active');
        state.drawColor = dot.dataset.color;
      });
    });

    $('#btn-stage-clear-draw').addEventListener('click', () => {
      $$('canvas.draw-canvas').forEach((c) => {
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
      });
      showToast('ล้างรอยขีดเขียนทั้งหมดแล้ว');
    });
  }

  async function loadStageFiles(files) {
    const wrapper = $('#stage-pages-wrapper');
    wrapper.innerHTML = '';
    state.stagePagesCount = 0;

    for (const file of files) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        if (!window.pdfjsLib) {
          showToast('ไลบรารี PDF.js ยังไม่พร้อมใช้งาน', 'error');
          return;
        }
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.75 });
          const card = createStagePageCard(viewport.width, viewport.height);
          const baseCanvas = card.querySelector('canvas.base-canvas');
          await page.render({ canvasContext: baseCanvas.getContext('2d'), viewport }).promise;
          wrapper.appendChild(card);
          state.stagePagesCount++;
        }
      } else if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        await new Promise((resolve) => {
          img.onload = resolve;
          img.src = url;
        });
        const card = createStagePageCard(img.naturalWidth, img.naturalHeight, img);
        wrapper.appendChild(card);
        state.stagePagesCount++;
      }
    }

    state.stageCurrentPage = 1;
    updateStagePageCounter();
    showToast(`โหลดโน้ตเข้าโหมดเวทีจำนวน ${state.stagePagesCount} หน้าเรียบร้อย`, 'success');
  }

  function loadDemoStagePages() {
    const wrapper = $('#stage-pages-wrapper');
    wrapper.innerHTML = '';
    state.stagePagesCount = 3;

    for (let page = 1; page <= 3; page++) {
      const w = 850;
      const h = 1120;
      const card = createStagePageCard(w, h);
      const canvas = card.querySelector('canvas.base-canvas');
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#111827';
      ctx.font = 'bold 28px Sarabun, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Demo Concert Band Score — Page ${page} / 3`, w / 2, 65);

      ctx.font = '16px Sarabun, sans-serif';
      ctx.fillStyle = '#4b5563';
      ctx.fillText('ใช้ทดสอบ Auto-Scroll และโหมดขีดเขียนบนโน้ต (ปากกา / ไฮไลต์)', w / 2, 95);

      // Draw 6 staff systems per page
      for (let sys = 0; sys < 6; sys++) {
        const topY = 145 + sys * 155;
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1.4;
        for (let line = 0; line < 5; line++) {
          ctx.beginPath();
          ctx.moveTo(65, topY + line * 12);
          ctx.lineTo(w - 65, topY + line * 12);
          ctx.stroke();
        }
        // Barlines & dummy notes
        ctx.fillStyle = '#111827';
        for (let bar = 0; bar <= 4; bar++) {
          const bx = 65 + bar * ((w - 130) / 4);
          ctx.beginPath();
          ctx.moveTo(bx, topY);
          ctx.lineTo(bx, topY + 48);
          ctx.stroke();
          if (bar < 4) {
            for (let n = 0; n < 4; n++) {
              const nx = bx + 32 + n * 38;
              const ny = topY + ((page + sys + bar + n) % 5) * 12;
              ctx.beginPath();
              ctx.ellipse(nx, ny, 6.5, 4.8, -0.35, 0, Math.PI * 2);
              ctx.fill();
              ctx.beginPath();
              ctx.moveTo(nx + 5.5, ny);
              ctx.lineTo(nx + 5.5, ny - 32);
              ctx.stroke();
            }
          }
        }
      }
      wrapper.appendChild(card);
    }

    state.stageCurrentPage = 1;
    updateStagePageCounter();
    showToast('โหลดโน้ตทดสอบ 3 หน้าเรียบร้อย ลองกด Space เพื่อเริ่มเลื่อนเลยค่ะ', 'success');
  }

  function createStagePageCard(width, height, imgEl = null) {
    const card = document.createElement('div');
    card.className = 'stage-page-card' + (state.drawMode ? ' draw-enabled' : '');

    if (imgEl) {
      imgEl.className = 'base-image';
      card.appendChild(imgEl);
    } else {
      const baseCanvas = document.createElement('canvas');
      baseCanvas.className = 'base-canvas';
      baseCanvas.width = width;
      baseCanvas.height = height;
      card.appendChild(baseCanvas);
    }

    const drawCanvas = document.createElement('canvas');
    drawCanvas.className = 'draw-canvas';
    drawCanvas.width = width;
    drawCanvas.height = height;
    attachDrawingEvents(drawCanvas);
    card.appendChild(drawCanvas);

    return card;
  }

  function attachDrawingEvents(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!state.drawMode) return;
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !state.drawMode) return;
      const pos = getPos(e);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (state.drawTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 28;
      } else if (state.drawTool === 'highlighter') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = hexToRgba(state.drawColor, 0.35);
        ctx.lineWidth = 22;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = state.drawColor;
        ctx.lineWidth = 3.5;
      }
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    });

    const endDraw = () => {
      if (!drawing) return;
      drawing = false;
      ctx.closePath();
      ctx.globalCompositeOperation = 'source-over';
    };

    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);
  }

  function toggleStageAutoScroll() {
    if (state.isCountingIn) return;
    const btn = $('#btn-stage-scroll-toggle');

    if (state.stageAutoScroll) {
      state.stageAutoScroll = false;
      btn.innerHTML = '<i class="fa-solid fa-play"></i> เริ่ม Auto-Scroll (Space)';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-success');
      syncFloatingBar();
      return;
    }

    if (state.stagePagesCount === 0) {
      showToast('กรุณาเปิดไฟล์ PDF หรือกด "โหลดโน้ตทดสอบ" ก่อนค่ะ', 'warning');
      return;
    }

    const activateScroll = () => {
      state.stageScrollFloat = $('#stage-scroll-container').scrollTop;
      state.stageAutoScroll = true;
      btn.innerHTML = '<i class="fa-solid fa-pause"></i> หยุด Auto-Scroll (Space)';
      btn.classList.remove('btn-success');
      btn.classList.add('btn-danger');
      syncFloatingBar();
    };

    if ($('#chk-stage-countin').checked) {
      runCountIn(activateScroll);
    } else {
      activateScroll();
    }
  }

  function runCountIn(callback) {
    state.isCountingIn = true;
    const overlay = $('#stage-countin-overlay');
    const bpm = parseInt($('#stage-sync-bpm').value, 10) || 100;
    const intervalMs = 60000 / bpm;
    let count = 4;

    const step = () => {
      if (count <= 0) {
        overlay.classList.add('hidden');
        state.isCountingIn = false;
        callback();
        return;
      }
      overlay.classList.remove('hidden');
      overlay.textContent = String(count);
      audioEngine.playClick(audioEngine.ensureContext().currentTime, count === 4);
      count--;
      setTimeout(step, intervalMs);
    };
    step();
  }

  function jumpStagePage(delta) {
    const cards = $$('.stage-page-card');
    if (!cards.length) return;
    const nextIdx = Math.max(0, Math.min(cards.length - 1, state.stageCurrentPage - 1 + delta));
    cards[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateStagePageCounter() {
    const cards = $$('.stage-page-card');
    if (!cards.length) {
      $('#stage-page-info').textContent = 'หน้า 0 / 0';
      if ($('#slim-page-text')) $('#slim-page-text').textContent = '0/0';
      return;
    }
    const vpTop = $('#stage-scroll-container').getBoundingClientRect().top;
    let current = 1;
    cards.forEach((c, idx) => {
      if (c.getBoundingClientRect().top - vpTop <= 140) {
        current = idx + 1;
      }
    });
    state.stageCurrentPage = current;
    $('#stage-page-info').textContent = `หน้า ${current} / ${cards.length}`;
    if ($('#slim-page-text')) $('#slim-page-text').textContent = `${current}/${cards.length}`;
  }

  // =========================================================================
  // Smooth Auto-Scroll Animation Loop
  // =========================================================================
  function animationLoop(now) {
    const dt = state.lastFrameTime ? Math.min(0.1, (now - state.lastFrameTime) / 1000) : 0;
    state.lastFrameTime = now;

    if (state.xmlAutoScroll && state.activeTab === 'orchestra') {
      const vp = $('#osmd-scroll-wrapper');
      const speed = parseInt($('#xml-autoscroll-speed').value, 10) || 28;
      state.xmlScrollPos += speed * dt;
      vp.scrollTop = state.xmlScrollPos;
      if (vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2) {
        state.xmlAutoScroll = false;
        const btn = $('#btn-xml-autoscroll');
        btn.innerHTML = '<i class="fa-solid fa-angles-down"></i> Auto-Scroll: ปิด';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-secondary');
        syncFloatingBar();
      }
    }

    if (state.stageAutoScroll && state.activeTab === 'stage') {
      const vp = $('#stage-scroll-container');
      const speed = parseInt($('#stage-scroll-speed').value, 10) || 35;
      state.stageScrollFloat += speed * dt;
      vp.scrollTop = state.stageScrollFloat;
      if (vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2) {
        toggleStageAutoScroll();
      }
    }

    requestAnimationFrame(animationLoop);
  }

  // =========================================================================
  // Tab 4: Band Library & Setlists (localStorage + JSON Export/Import)
  // =========================================================================
  function initLibraryAndSetlists() {
    try {
      state.library = JSON.parse(localStorage.getItem(STORAGE_LIBRARY) || '[]');
      state.setlists = JSON.parse(localStorage.getItem(STORAGE_SETLISTS) || '[]');
    } catch (_) {
      state.library = [];
      state.setlists = [];
    }

    if (state.setlists.length === 0) {
      state.setlists.push({ id: 'default', name: 'เซ็ตลิสต์ซ้อมประจำวัน', items: [] });
      persistStorage();
    }
    state.activeSetlistId = state.setlists[0].id;

    $('#btn-new-setlist').addEventListener('click', () => {
      const name = $('#input-setlist-name').value.trim();
      if (!name) return;
      const newSet = { id: 'sl_' + Date.now(), name, items: [] };
      state.setlists.push(newSet);
      state.activeSetlistId = newSet.id;
      $('#input-setlist-name').value = '';
      persistStorage();
      renderLibraryAndSetlists();
      showToast(`สร้างเซ็ตลิสต์ "${name}" แล้ว`, 'success');
    });

    $('#select-setlist').addEventListener('change', (e) => {
      state.activeSetlistId = e.target.value;
      renderSetlistItems();
    });

    $('#btn-delete-setlist').addEventListener('click', () => {
      if (state.setlists.length <= 1) {
        showToast('ต้องเหลือเซ็ตลิสต์ไว้อย่างน้อย 1 รายการนะคะ', 'warning');
        return;
      }
      state.setlists = state.setlists.filter((s) => s.id !== state.activeSetlistId);
      state.activeSetlistId = state.setlists[0].id;
      persistStorage();
      renderLibraryAndSetlists();
    });

    $('#btn-export-library-json').addEventListener('click', () => {
      const payload = JSON.stringify({ library: state.library, setlists: state.setlists }, null, 2);
      downloadTextFile('maestroscroll_library.json', payload, 'application/json');
    });

    $('#btn-import-library-json').addEventListener('click', () => $('#input-import-library-json').click());
    $('#input-import-library-json').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (Array.isArray(data.library)) state.library = data.library;
        if (Array.isArray(data.setlists) && data.setlists.length) {
          state.setlists = data.setlists;
          state.activeSetlistId = state.setlists[0].id;
        }
        persistStorage();
        renderLibraryAndSetlists();
        showToast('นำเข้าคลังเพลงและเซ็ตลิสต์สำเร็จ!', 'success');
      } catch (_) {
        showToast('ไฟล์ JSON ไม่ถูกต้อง', 'error');
      }
      e.target.value = '';
    });

    renderLibraryAndSetlists();
  }

  function saveScoreToLibrary({ title, type, content }) {
    const entry = {
      id: 'sc_' + Date.now(),
      title: title || 'Untitled',
      type,
      content,
      savedAt: new Date().toLocaleDateString('th-TH')
    };
    state.library.unshift(entry);
    persistStorage();
    renderLibraryAndSetlists();
    showToast(`บันทึก "${entry.title}" ลงคลังเพลงเรียบร้อย!`, 'success');
  }

  function persistStorage() {
    try {
      localStorage.setItem(STORAGE_LIBRARY, JSON.stringify(state.library));
      localStorage.setItem(STORAGE_SETLISTS, JSON.stringify(state.setlists));
    } catch (_) {
      showToast('พื้นที่จัดเก็บเบราว์เซอร์เต็ม แนะนำให้ส่งออกเป็น .json', 'warning');
    }
  }

  function renderLibraryAndSetlists() {
    const libList = $('#library-list');
    libList.innerHTML = '';

    if (state.library.length === 0) {
      libList.innerHTML = '<p class="card-desc">ยังไม่มีเพลงที่บันทึก กดปุ่ม "บันทึก" จากหน้าสกอร์วง หรือหน้าเขียนโน้ตได้เลยค่ะ</p>';
    } else {
      state.library.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
          <div class="list-item-info">
            <div class="list-item-title">${escapeHtml(item.title)}</div>
            <div class="list-item-meta">${item.type.toUpperCase()} • บันทึกเมื่อ ${escapeHtml(item.savedAt || '')}</div>
          </div>
          <div class="list-item-actions">
            <button class="btn-sm btn-primary act-open" title="เปิดเพลงนี้"><i class="fa-solid fa-folder-open"></i> เปิด</button>
            <button class="btn-sm btn-secondary act-add-sl" title="เพิ่มลงเซ็ตลิสต์"><i class="fa-solid fa-plus"></i> คิว</button>
            <button class="btn-sm btn-danger act-del" title="ลบ"><i class="fa-solid fa-trash"></i></button>
          </div>
        `;
        div.querySelector('.act-open').addEventListener('click', () => openSavedItem(item));
        div.querySelector('.act-add-sl').addEventListener('click', () => addItemToActiveSetlist(item.id));
        div.querySelector('.act-del').addEventListener('click', () => {
          state.library = state.library.filter((x) => x.id !== item.id);
          state.setlists.forEach((sl) => {
            sl.items = sl.items.filter((id) => id !== item.id);
          });
          persistStorage();
          renderLibraryAndSetlists();
        });
        libList.appendChild(div);
      });
    }

    const sel = $('#select-setlist');
    sel.innerHTML = '';
    state.setlists.forEach((sl) => {
      const opt = document.createElement('option');
      opt.value = sl.id;
      opt.textContent = sl.name;
      if (sl.id === state.activeSetlistId) opt.selected = true;
      sel.appendChild(opt);
    });

    renderSetlistItems();
  }

  function renderSetlistItems() {
    const list = $('#setlist-list');
    list.innerHTML = '';
    const activeSl = state.setlists.find((s) => s.id === state.activeSetlistId);
    if (!activeSl || activeSl.items.length === 0) {
      list.innerHTML = '<p class="card-desc">เซ็ตลิสต์นี้ยังว่างอยู่ กดปุ่ม "+ คิว" จากคลังเพลงด้านซ้ายเพื่อจัดลำดับการเล่นค่ะ</p>';
      return;
    }

    activeSl.items.forEach((itemId, idx) => {
      const item = state.library.find((x) => x.id === itemId);
      if (!item) return;

      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `
        <div class="list-item-info">
          <div class="list-item-title">${idx + 1}. ${escapeHtml(item.title)}</div>
          <div class="list-item-meta">${item.type.toUpperCase()}</div>
        </div>
        <div class="list-item-actions">
          <button class="btn-sm act-up" ${idx === 0 ? 'disabled' : ''} title="เลื่อนขึ้น"><i class="fa-solid fa-arrow-up"></i></button>
          <button class="btn-sm act-down" ${idx === activeSl.items.length - 1 ? 'disabled' : ''} title="เลื่อนลง"><i class="fa-solid fa-arrow-down"></i></button>
          <button class="btn-sm btn-primary act-open"><i class="fa-solid fa-play"></i></button>
          <button class="btn-sm btn-danger act-rm"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;
      div.querySelector('.act-open').addEventListener('click', () => openSavedItem(item));
      div.querySelector('.act-up').addEventListener('click', () => moveSetlistItem(activeSl, idx, -1));
      div.querySelector('.act-down').addEventListener('click', () => moveSetlistItem(activeSl, idx, 1));
      div.querySelector('.act-rm').addEventListener('click', () => {
        activeSl.items.splice(idx, 1);
        persistStorage();
        renderSetlistItems();
      });
      list.appendChild(div);
    });
  }

  function addItemToActiveSetlist(itemId) {
    const activeSl = state.setlists.find((s) => s.id === state.activeSetlistId);
    if (!activeSl) return;
    activeSl.items.push(itemId);
    persistStorage();
    renderSetlistItems();
    showToast(`เพิ่มเข้าเซ็ตลิสต์ "${activeSl.name}" แล้ว`, 'success');
  }

  function moveSetlistItem(sl, idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= sl.items.length) return;
    const tmp = sl.items[idx];
    sl.items[idx] = sl.items[target];
    sl.items[target] = tmp;
    persistStorage();
    renderSetlistItems();
  }

  function openSavedItem(item) {
    if (item.type === 'musicxml') {
      switchTab('orchestra');
      loadMusicXmlString(item.content, item.title);
    } else if (item.type === 'abc') {
      switchTab('composer');
      $('#abc-editor').value = item.content;
      syncMetaFromAbc();
      renderAbcScore();
    }
  }

  // =========================================================================
  // Global Keyboard & Bluetooth Page Turner Pedal Shortcuts
  // =========================================================================
  function initGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') document.activeElement.blur();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (state.activeTab === 'stage') {
          toggleStageAutoScroll();
        } else if (state.activeTab === 'orchestra') {
          if (audioEngine.isPlaying) pauseXmlPlayback();
          else startXmlPlayback();
        } else if (state.activeTab === 'composer') {
          if (audioEngine.isPlaying) stopAbcScore();
          else playAbcScore();
        }
      } else if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        if (state.activeTab === 'stage') {
          e.preventDefault();
          jumpStagePage(1);
        } else if (state.activeTab === 'orchestra') {
          e.preventDefault();
          const vp = $('#osmd-scroll-wrapper');
          vp.scrollBy({ top: vp.clientHeight * 0.75, behavior: 'smooth' });
        }
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        if (state.activeTab === 'stage') {
          e.preventDefault();
          jumpStagePage(-1);
        } else if (state.activeTab === 'orchestra') {
          e.preventDefault();
          const vp = $('#osmd-scroll-wrapper');
          vp.scrollBy({ top: -vp.clientHeight * 0.75, behavior: 'smooth' });
        }
      } else if (e.key.toLowerCase() === 'm') {
        toggleMetronome();
      } else if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        $$('.modal').forEach((m) => m.classList.add('hidden'));
        if (document.body.classList.contains('focus-reader-mode')) {
          toggleFocusReaderMode();
        }
      }
    });
  }

  // =========================================================================
  // Mobile UX, Ultra-Slim Bar, Overlay Drawers & Focus Reader Mode
  // =========================================================================
  function closeMobileControlsDrawers() {
    $$('.controls-drawer.open').forEach((d) => d.classList.remove('open'));
    $('#btn-slim-settings')?.classList.remove('active-state');
  }

  function handlePrimaryPlayAction() {
    if (state.activeTab === 'orchestra') {
      if (audioEngine.isPlaying) pauseXmlPlayback();
      else startXmlPlayback();
    } else if (state.activeTab === 'composer') {
      if (audioEngine.isPlaying) stopAbcScore();
      else playAbcScore();
    } else if (state.activeTab === 'stage') {
      toggleStageAutoScroll();
    }
  }

  function handlePrimaryScrollAction() {
    if (state.activeTab === 'orchestra') {
      toggleXmlAutoScroll();
    } else if (state.activeTab === 'stage') {
      toggleStageAutoScroll();
    } else if (state.activeTab === 'composer') {
      const pane = $('.composer-preview-pane');
      pane?.scrollBy({ top: pane.clientHeight * 0.6, behavior: 'smooth' });
    }
  }

  function initMobileUX() {
    const composerSplit = $('.composer-split');
    if (composerSplit) {
      composerSplit.setAttribute('data-cmode', isMobileViewport() ? 'preview' : 'split');
    }

    // Slim bar controls
    $('#btn-slim-play')?.addEventListener('click', handlePrimaryPlayAction);
    $('#btn-slim-scroll')?.addEventListener('click', handlePrimaryScrollAction);
    $('#btn-slim-prev-page')?.addEventListener('click', () => jumpStagePage(-1));
    $('#btn-slim-next-page')?.addEventListener('click', () => jumpStagePage(1));

    $('#mobile-part-select')?.addEventListener('change', (e) => {
      const val = e.target.value;
      state.selectedPartIds = val === '__ALL__' ? [] : [val];
      renderPartFilterBar();
      refreshOsmdRender();
    });

    $('#btn-slim-settings')?.addEventListener('click', () => {
      const activeDrawer = $(`#view-${state.activeTab} .controls-drawer`);
      if (!activeDrawer) return;
      const opening = !activeDrawer.classList.contains('open');
      closeMobileControlsDrawers();
      if (opening) {
        activeDrawer.classList.add('open');
        $('#btn-slim-settings').classList.add('active-state');
      }
    });

    $$('.btn-close-mobile-drawer').forEach((btn) => {
      btn.addEventListener('click', closeMobileControlsDrawers);
    });

    // Tapping score viewport closes any open overlay controls drawer automatically
    ['#osmd-scroll-wrapper', '.composer-preview-pane', '#stage-scroll-container'].forEach((sel) => {
      $(sel)?.addEventListener('pointerdown', () => {
        if ($('.controls-drawer.open')) closeMobileControlsDrawers();
      });
    });

    // Composer mobile view switcher (Preview / Edit / Split)
    $$('#composer-mobile-tabs .btn-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('#composer-mobile-tabs .btn-chip').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (composerSplit) composerSplit.setAttribute('data-cmode', btn.dataset.cmode);
        if (btn.dataset.cmode !== 'edit') {
          setTimeout(() => renderAbcScore(), 50);
        }
      });
    });

    // Focus Reader floating bar actions
    $('#btn-float-play')?.addEventListener('click', handlePrimaryPlayAction);
    $('#btn-float-scroll')?.addEventListener('click', handlePrimaryScrollAction);
    $('#btn-float-reader')?.addEventListener('click', toggleFocusReaderMode);

    // Double-tap on score paper to enter/exit 100% full-screen Focus Reader Mode
    ['#osmd-container', '#abc-paper', '#stage-pages-wrapper'].forEach((sel) => {
      let lastTap = 0;
      $(sel)?.addEventListener('touchend', (e) => {
        if (sel === '#stage-pages-wrapper' && state.drawMode) return;
        const now = Date.now();
        if (now - lastTap > 0 && now - lastTap < 300) {
          e.preventDefault();
          toggleFocusReaderMode();
        }
        lastTap = now;
      });
    });

    syncFloatingBar();
  }

  function toggleFocusReaderMode() {
    closeMobileControlsDrawers();
    const active = document.body.classList.toggle('focus-reader-mode');
    $('#btn-focus-reader')?.classList.toggle('active-state', active);
    const floatReaderIcon = $('#btn-float-reader i');
    if (floatReaderIcon) {
      floatReaderIcon.className = active ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    }
    showToast(active ? 'เปิดโหมดอ่านโน้ตเต็มจอ 100% (แตะปุ่มมุมล่างขวาหรือแตะ 2 ครั้งเพื่อออก)' : 'แสดงแถบเครื่องมือปกติแล้ว');
    if (state.activeTab === 'orchestra' && state.osmd) {
      setTimeout(() => {
        try { state.osmd.render(); } catch (_) {}
      }, 80);
    }
  }

  function syncFloatingBar() {
    const slimBar = $('#mobile-slim-bar');
    if (slimBar) {
      slimBar.classList.toggle('hidden-on-library', state.activeTab === 'library');
      $('#mobile-part-select')?.classList.toggle('hidden', state.activeTab !== 'orchestra');
      $('#composer-mobile-tabs')?.classList.toggle('hidden', state.activeTab !== 'composer');
      $('#slim-stage-pages')?.classList.toggle('hidden', state.activeTab !== 'stage');
    }

    const playing =
      state.activeTab === 'stage' ? state.stageAutoScroll : audioEngine.isPlaying;
    const scrolling =
      (state.activeTab === 'orchestra' && state.xmlAutoScroll) ||
      (state.activeTab === 'stage' && state.stageAutoScroll);

    const slimPlay = $('#btn-slim-play');
    if (slimPlay) {
      slimPlay.innerHTML = playing
        ? '<i class="fa-solid fa-pause"></i> <span>หยุด</span>'
        : '<i class="fa-solid fa-play"></i> <span>เล่น</span>';
      slimPlay.classList.toggle('btn-danger', playing);
      slimPlay.classList.toggle('btn-success', !playing);
    }

    const slimScroll = $('#btn-slim-scroll');
    if (slimScroll) {
      slimScroll.classList.toggle('btn-accent', scrolling);
      slimScroll.classList.toggle('btn-secondary', !scrolling);
    }

    const bar = $('#floating-mobile-bar');
    if (!bar) return;
    if (state.activeTab === 'library') {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = '';

    const playBtn = $('#btn-float-play');
    const scrollBtn = $('#btn-float-scroll');

    if (playBtn) {
      playBtn.innerHTML = playing
        ? '<i class="fa-solid fa-pause"></i>'
        : '<i class="fa-solid fa-play"></i>';
    }
    if (scrollBtn) {
      scrollBtn.classList.toggle('active-state', scrolling);
    }
  }

  // =========================================================================
  // Utilities
  // =========================================================================
  function downloadTextFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
})();
