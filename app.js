/* primer — app.js
   Vanilla JS + Alpine 3.14
   No build step. Runs as-is in the browser.
*/

(function () {
  'use strict';

  /* =========================================================
     Constants
     ========================================================= */

  const HASH16 = '{{INPUT_HASH16}}';
  const LS_KEY = 'primer:' + HASH16;

  const TAB_NAMES = ['original', 'eli5', 'questions', 'diagram'];
  const TAB_LABELS = { original: 'Original', eli5: 'ELI5', questions: 'Questions', diagram: 'Diagram' };

  /* =========================================================
     Data loading
     ========================================================= */

  function loadJson(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  const sections = loadJson('primer-sections') || [];
  const mindmapData = loadJson('primer-mindmap');
  const glossary = loadJson('primer-glossary') || [];

  /* =========================================================
     Persistence
     ========================================================= */

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { darkMode: null, expandedSections: [], lastSection: null };
  }

  function saveState(patch) {
    try {
      const current = loadState();
      localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(current, patch)));
    } catch (_) {}
  }

  /* =========================================================
     Dark mode
     ========================================================= */

  const state = loadState();

  function applyDarkMode(dark) {
    if (dark) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }

  // Determine initial dark mode
  let isDark = false;
  if (state.darkMode !== null) {
    isDark = state.darkMode;
  } else {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  applyDarkMode(isDark);

  /* =========================================================
     URL params
     ========================================================= */

  const urlParams = new URLSearchParams(window.location.search);
  const isPrintMode = urlParams.get('print') === '1';

  /* =========================================================
     Markdown renderer
     ========================================================= */

  let md = null;

  function renderMarkdown(text) {
    if (!text) return '';
    if (!md && window.markdownit) {
      md = window.markdownit({ html: false, linkify: true, typographer: true });
    }
    if (md) return md.render(text);
    // Fallback: plain text in a pre
    return '<pre>' + escapeHtml(text) + '</pre>';
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* =========================================================
     Mindmap — markmap
     ========================================================= */

  function buildHeadingTree(secs) {
    const root = { id: 'root', label: document.title || 'Contents', children: [] };
    secs.forEach(function (s) {
      const node = { id: s.id, label: s.title, children: [] };
      if (s.level === 1 || root.children.length === 0) {
        root.children.push(node);
      } else {
        const last = root.children[root.children.length - 1];
        last.children = last.children || [];
        last.children.push(node);
      }
    });
    return root;
  }

  function isFlatTree(tree) {
    if (!tree || !tree.children || tree.children.length === 0) return true;
    return tree.children.every(function (c) { return !c.children || c.children.length === 0; });
  }

  function buildFlatToc(secs) {
    return { id: 'root', label: document.title || 'Contents', children: secs.map(function (s) {
      return { id: s.id, label: s.title };
    })};
  }

  function resolveTree() {
    if (mindmapData && mindmapData.id === 'root' && mindmapData.children && mindmapData.children.length > 0) {
      return mindmapData;
    }
    const ht = buildHeadingTree(sections);
    if (isFlatTree(ht)) return buildFlatToc(sections);
    return ht;
  }

  function treeToMarkmap(node) {
    // Convert our tree to markmap format
    return {
      content: node.label,
      children: (node.children || []).map(treeToMarkmap)
    };
  }

  function initMindmap() {
    const container = document.getElementById('mindmap-container');
    if (!container) return;

    const tree = resolveTree();

    // markmap-autoloader exposes window.markmap with capital-T `Transformer`
    if (window.markmap && window.markmap.Markmap && window.markmap.Transformer) {
      try {
        const { Markmap } = window.markmap;
        // Build markmap-compatible tree
        const mmTree = treeToMarkmap(tree);

        const svg = container.querySelector('svg') || document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        if (!container.querySelector('svg')) {
          svg.setAttribute('style', 'width:100%;height:100%');
          container.appendChild(svg);
        }

        const mm = Markmap.create(svg, {
          autoFit: true,
          color: function () { return 'var(--accent)'; }
        }, mmTree);

        // Click a node → scroll to section. Markmap renders labels as either <text>
        // or <foreignObject> depending on version/content; accept both.
        svg.addEventListener('click', function (e) {
          const labelEl = e.target.closest('text, foreignObject');
          if (!labelEl) return;
          const label = labelEl.textContent.trim();
          const sec = sections.find(function (s) { return s.title === label; });
          if (sec) scrollToSection(sec.id);
        });

        // Close mobile drawer on node click
        svg.addEventListener('click', function () {
          closeMobileDrawer();
        });

        return;
      } catch (_) {}
    }

    // Fallback to TOC list
    renderTocFallback(tree);
  }

  function renderTocFallback(_tree) {
    // Mindmap tree labels are logical groupings that may not match section titles 1:1,
    // so the flat TOC iterates the sections array directly — that's the only mapping
    // guaranteed to produce live anchors.
    const nav = document.getElementById('toc-fallback');
    if (!nav) return;
    nav.innerHTML = '';
    sections.forEach(function (sec) {
      const li = document.createElement('li');
      li.className = 'depth-' + Math.max(1, sec.level || 1);
      const a = document.createElement('a');
      a.href = '#section-' + sec.id;
      a.textContent = sec.title;
      a.addEventListener('click', function () { closeMobileDrawer(); });
      li.appendChild(a);
      nav.appendChild(li);
    });
  }

  /* =========================================================
     Section rendering
     ========================================================= */

  function sectionHasTab(sec, tab) {
    switch (tab) {
      case 'original': return true; // always has body
      case 'eli5':     return !!sec.eli5;
      case 'questions': return sec.questions && sec.questions.length > 0;
      case 'diagram':   return sec.diagrams && sec.diagrams.length > 0;
      default: return false;
    }
  }

  function buildTabDots(sec) {
    return TAB_NAMES.map(function (t) {
      const avail = sectionHasTab(sec, t);
      return '<span class="tab-dot' + (avail ? ' available' : '') + '" aria-label="' + TAB_LABELS[t] + (avail ? ' available' : ' unavailable') + '"></span>';
    }).join('');
  }

  function buildTabStrip(sec, sectionIdx) {
    const available = TAB_NAMES.filter(function (t) { return sectionHasTab(sec, t); });
    return available.map(function (t, i) {
      return '<button class="tab-btn' + (i === 0 ? ' active' : '') + '" data-tab="' + t + '" aria-selected="' + (i === 0) + '">' + TAB_LABELS[t] + '</button>';
    }).join('');
  }

  function buildOriginalPanel(sec) {
    return '<div class="tab-panel active" data-panel="original"><div class="prose">' + renderMarkdown(sec.bodyMd) + '</div></div>';
  }

  function buildEli5Panel(sec) {
    if (!sec.eli5) return '';
    return '<div class="tab-panel" data-panel="eli5"><div class="eli5-text">' + escapeHtml(sec.eli5) + '</div></div>';
  }

  function buildQuestionsPanel(sec) {
    if (!sec.questions || !sec.questions.length) return '';
    const items = sec.questions.map(function (q) {
      // Accept either a plain string or a {q, a} pair.
      if (typeof q === 'string') return '<li>' + escapeHtml(q) + '</li>';
      if (q && typeof q === 'object') {
        const qt = escapeHtml(String(q.q ?? q.question ?? ''));
        const at = q.a ?? q.answer;
        return '<li><div class="question-q">' + qt + '</div>' +
          (at ? '<div class="question-a">' + escapeHtml(String(at)) + '</div>' : '') +
          '</li>';
      }
      return '';
    }).join('');
    return '<div class="tab-panel" data-panel="questions"><ul class="questions-list">' + items + '</ul></div>';
  }

  function buildDiagramPanel(sec) {
    if (!sec.diagrams || !sec.diagrams.length) return '';
    const diagramHtml = sec.diagrams.map(function (d, i) {
      const uid = sec.id + '-diag-' + i;
      // Accept either {code} (contract) or {mermaid} (alt) for the source.
      const code = d.code ?? d.mermaid ?? '';
      const caption = d.caption ? '<div class="diagram-caption">' + escapeHtml(d.caption) + '</div>' : '';
      return '<div class="diagram-wrap" data-diagram-uid="' + uid + '" data-inferred="' + d.inferred + '">' +
        '<div class="mermaid-src" style="display:none">' + escapeHtml(code) + '</div>' +
        '<div class="mermaid-output" id="mermaid-' + uid + '"></div>' +
        caption +
        '<span class="diagram-click-hint">Click to zoom</span>' +
        '</div>';
    }).join('');
    return '<div class="tab-panel" data-panel="diagram">' + diagramHtml + '</div>';
  }

  function buildSectionCard(sec, idx) {
    const errorMark = sec.error ? '<span class="enrich-error" title="Enrichment failed"></span>' : '';
    const tldrHtml = sec.tldr
      ? '<div class="section-tldr">' + escapeHtml(sec.tldr) + '</div>'
      : '';

    const tabs = buildTabStrip(sec, idx);
    const panels = [
      buildOriginalPanel(sec),
      buildEli5Panel(sec),
      buildQuestionsPanel(sec),
      buildDiagramPanel(sec)
    ].join('');

    const isExpanded = state.expandedSections && state.expandedSections.includes(sec.id);
    const openAttr = (isPrintMode || isExpanded) ? ' open' : '';

    return '<div class="section-card" id="section-' + sec.id + '" data-section-id="' + sec.id + '" data-level="' + sec.level + '">' +
      '<details' + openAttr + '>' +
      '<summary class="section-summary" aria-label="' + escapeHtml(sec.title) + '">' +
        '<div class="section-header-row">' +
          '<span class="section-title">' + escapeHtml(sec.title) + errorMark + '</span>' +
          '<div class="tab-dots" aria-hidden="true">' + buildTabDots(sec) + '</div>' +
        '</div>' +
        tldrHtml +
      '</summary>' +
      '<div class="section-body">' +
        '<div class="tab-strip" role="tablist" aria-label="Section views">' + tabs + '</div>' +
        '<div class="tab-panels">' + panels + '</div>' +
      '</div>' +
      '</details>' +
    '</div>';
  }

  /* =========================================================
     Render sections
     ========================================================= */

  let filteredSections = sections.slice();

  function renderSections(secs) {
    const container = document.getElementById('sections-container');
    if (!container) return;
    container.innerHTML = secs.map(buildSectionCard).join('');
    attachSectionEvents(container);
    // Render diagrams for initially expanded sections
    container.querySelectorAll('details[open]').forEach(function (det) {
      const diag = det.querySelector('[data-panel="diagram"].active') ||
                   det.querySelector('[data-panel="diagram"]');
      // Only render if diagram tab is active
      const activePanel = det.querySelector('.tab-panel.active');
      if (activePanel && activePanel.dataset.panel === 'diagram') {
        runDiagramsIn(det);
      }
    });
  }

  function attachSectionEvents(container) {
    // Tab switching within each section
    container.querySelectorAll('.tab-strip').forEach(function (strip) {
      strip.addEventListener('click', function (e) {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        switchTab(strip, btn.dataset.tab);
      });
    });

    // Track open/close for persistence
    container.querySelectorAll('details').forEach(function (det) {
      det.addEventListener('toggle', function () {
        const card = det.closest('.section-card');
        if (!card) return;
        const id = card.dataset.sectionId;
        const expanded = loadState().expandedSections || [];
        if (det.open) {
          if (!expanded.includes(id)) expanded.push(id);
          saveState({ expandedSections: expanded, lastSection: id });
          // Activate first available tab's diagram if diagram tab is first active
          const activePanel = det.querySelector('.tab-panel.active');
          if (activePanel && activePanel.dataset.panel === 'diagram') {
            runDiagramsIn(det);
          }
        } else {
          const idx = expanded.indexOf(id);
          if (idx >= 0) expanded.splice(idx, 1);
          saveState({ expandedSections: expanded });
        }
      });
    });

    // Diagram click → modal
    container.addEventListener('click', function (e) {
      const wrap = e.target.closest('.diagram-wrap');
      if (!wrap) return;
      const svg = wrap.querySelector('.mermaid-output svg');
      if (!svg) return;
      openDiagramModal(svg);
    });
  }

  function switchTab(strip, tabName) {
    const body = strip.closest('.section-body');
    if (!body) return;

    // Update buttons
    strip.querySelectorAll('.tab-btn').forEach(function (btn) {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active);
    });

    // Update panels
    body.querySelectorAll('.tab-panel').forEach(function (panel) {
      const active = panel.dataset.panel === tabName;
      panel.classList.toggle('active', active);
    });

    // Render mermaid if switching to diagram tab
    if (tabName === 'diagram') {
      runDiagramsIn(strip.closest('details'));
    }
  }

  /* =========================================================
     Mermaid diagram rendering
     ========================================================= */

  const renderedDiagrams = new Set();

  function runDiagramsIn(detailsEl) {
    if (!detailsEl) return;
    const wraps = detailsEl.querySelectorAll('.diagram-wrap');
    wraps.forEach(function (wrap) {
      const uid = wrap.dataset.diagramUid;
      if (renderedDiagrams.has(uid)) return;
      renderedDiagrams.add(uid);

      const srcEl = wrap.querySelector('.mermaid-src');
      const outEl = wrap.querySelector('.mermaid-output');
      if (!srcEl || !outEl) return;

      const code = srcEl.textContent;
      const isInferred = wrap.dataset.inferred === 'true';

      renderOneMermaid(uid, code, outEl, isInferred);
    });
  }

  function renderOneMermaid(uid, code, outEl, isInferred) {
    if (!window.mermaid) return;
    const id = 'mmd-' + uid.replace(/[^a-z0-9]/gi, '-');

    mermaid.render(id, code).then(function (result) {
      outEl.innerHTML = result.svg;
      const svg = outEl.querySelector('svg');
      if (!svg) return;
      svg.style.maxWidth = '100%';
      svg.style.height = 'auto';

      if (isInferred) {
        addInferredBadge(svg);
      }
    }).catch(function (err) {
      outEl.innerHTML = '<div class="no-data">Diagram could not be rendered: ' + escapeHtml(String(err)) + '</div>';
    });
  }

  function addInferredBadge(svg) {
    // Add a <text> element in the top-right corner of the SVG viewport
    const ns = 'http://www.w3.org/2000/svg';

    // Get viewBox dimensions or fallback to width/height attributes
    let vw = parseFloat(svg.getAttribute('width')) || 600;
    let vh = parseFloat(svg.getAttribute('height')) || 400;
    const vb = svg.getAttribute('viewBox');
    if (vb) {
      const parts = vb.split(/[\s,]+/);
      if (parts.length >= 4) {
        vw = parseFloat(parts[2]) || vw;
        vh = parseFloat(parts[3]) || vh;
      }
    }

    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', vw - 120);
    rect.setAttribute('y', 6);
    rect.setAttribute('width', 110);
    rect.setAttribute('height', 20);
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', '#5e6ad2');
    rect.setAttribute('fill-opacity', '0.9');

    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', vw - 65);
    text.setAttribute('y', 20);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-weight', '500');
    text.textContent = 'AI-inferred';

    svg.appendChild(rect);
    svg.appendChild(text);
  }

  /* =========================================================
     Diagram zoom modal
     ========================================================= */

  let panzoomInstance = null;

  function openDiagramModal(originalSvg) {
    const modal = document.getElementById('diagram-modal');
    const wrap = document.getElementById('diagram-modal-svg-wrap');
    if (!modal || !wrap) return;

    // Clone SVG so panzoom doesn't mutate the inline one
    const clone = originalSvg.cloneNode(true);
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.style.width = '100%';
    clone.style.height = 'auto';

    wrap.innerHTML = '';
    wrap.appendChild(clone);

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Init panzoom
    if (window.panzoom) {
      if (panzoomInstance) panzoomInstance.dispose();
      panzoomInstance = panzoom(clone, {
        maxZoom: 8,
        minZoom: 0.3,
        bounds: false
      });
    }

    // Focus close button for a11y
    const closeBtn = document.getElementById('diagram-modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeDiagramModal() {
    const modal = document.getElementById('diagram-modal');
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    if (panzoomInstance) {
      panzoomInstance.dispose();
      panzoomInstance = null;
    }
  }

  /* =========================================================
     Search
     ========================================================= */

  function applySearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      filteredSections = sections.slice();
    } else {
      filteredSections = sections.filter(function (s) {
        return s.title.toLowerCase().includes(q) ||
          (s.bodyMd && s.bodyMd.toLowerCase().includes(q)) ||
          (s.tldr && s.tldr.toLowerCase().includes(q));
      });
    }
    renderSections(filteredSections);
  }

  /* =========================================================
     Keyboard navigation
     ========================================================= */

  function getVisibleSections() {
    return Array.from(document.querySelectorAll('.section-card'));
  }

  function currentFocusedSection() {
    const focused = document.activeElement;
    if (!focused) return null;
    return focused.closest('.section-card');
  }

  function scrollToSection(id) {
    const el = document.getElementById('section-' + id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const summary = el.querySelector('.section-summary');
      if (summary) summary.focus();
    }
  }

  function moveSectionFocus(dir) {
    const cards = getVisibleSections();
    if (!cards.length) return;
    const current = currentFocusedSection();
    let idx = current ? cards.indexOf(current) : -1;
    idx += dir;
    idx = Math.max(0, Math.min(cards.length - 1, idx));
    const target = cards[idx];
    const summary = target.querySelector('.section-summary');
    if (summary) {
      summary.focus();
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function switchActiveTab(n) {
    // 1-based: 1=original, 2=eli5, 3=questions, 4=diagram
    const focused = document.activeElement;
    if (!focused) return;
    const card = focused.closest('.section-card') || getVisibleSections()[0];
    if (!card) return;
    const strip = card.querySelector('.tab-strip');
    if (!strip) return;
    const btns = Array.from(strip.querySelectorAll('.tab-btn'));
    if (n >= 1 && n <= btns.length) {
      btns[n - 1].click();
      btns[n - 1].focus();
    }
  }

  document.addEventListener('keydown', function (e) {
    // Don't intercept when typing in search
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    switch (e.key) {
      case '/':
        e.preventDefault();
        const si = document.getElementById('search-input');
        if (si) si.focus();
        break;
      case 'Escape':
        closeDiagramModal();
        break;
      case 'd':
        toggleDarkMode();
        break;
      case 'j':
        e.preventDefault();
        moveSectionFocus(1);
        break;
      case 'k':
        e.preventDefault();
        moveSectionFocus(-1);
        break;
      case '1': switchActiveTab(1); break;
      case '2': switchActiveTab(2); break;
      case '3': switchActiveTab(3); break;
      case '4': switchActiveTab(4); break;
    }
  });

  /* =========================================================
     Dark mode toggle
     ========================================================= */

  function toggleDarkMode() {
    isDark = !isDark;
    applyDarkMode(isDark);
    saveState({ darkMode: isDark });
    updateDarkToggleLabel();
  }

  function updateDarkToggleLabel() {
    const btn = document.getElementById('dark-toggle');
    if (btn) btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    const icon = document.getElementById('dark-toggle-icon');
    if (icon) icon.textContent = isDark ? '☼' : '☾';
  }

  /* =========================================================
     Hamburger / drawer
     ========================================================= */

  function openDrawer() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('drawer-backdrop');
    if (sidebar) sidebar.classList.add('drawer-open');
    if (backdrop) backdrop.classList.add('visible');
  }

  function closeDrawer() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('drawer-backdrop');
    if (sidebar) sidebar.classList.remove('drawer-open');
    if (backdrop) backdrop.classList.remove('visible');
  }

  function closeMobileDrawer() {
    // On mobile (<640px) the sidebar covers the full screen
    if (window.innerWidth < 640) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.remove('mindmap-view', 'drawer-open');
      document.body.classList.remove('mobile-mindmap-home');
      updateHamburgerIcon();
    } else {
      closeDrawer();
    }
  }

  function isMobile() { return window.innerWidth < 640; }

  function showMindmapHome() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('mindmap-view');
    document.body.classList.add('mobile-mindmap-home');
    updateHamburgerIcon();
  }

  function hideMindmapHome() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('mindmap-view');
    document.body.classList.remove('mobile-mindmap-home');
    updateHamburgerIcon();
  }

  function updateHamburgerIcon() {
    const btn = document.getElementById('hamburger-btn');
    if (!btn) return;
    const onMap = document.body.classList.contains('mobile-mindmap-home');
    btn.innerHTML = onMap ? '&#x2715;' : '&#9776;';
    btn.setAttribute('aria-label', onMap ? 'Close map' : 'Toggle navigation');
  }

  /* =========================================================
     Glossary
     ========================================================= */

  function renderGlossary() {
    const container = document.getElementById('glossary-list');
    if (!container) return;
    if (!glossary || !glossary.length) {
      const section = document.getElementById('glossary-section');
      if (section) section.style.display = 'none';
      return;
    }
    container.innerHTML = glossary.map(function (entry) {
      return '<div class="glossary-entry">' +
        '<dt class="glossary-term">' + escapeHtml(entry.term) + '</dt>' +
        '<dd class="glossary-def">' + escapeHtml(entry.definition) + '</dd>' +
        '</div>';
    }).join('');
  }

  /* =========================================================
     Print mode
     ========================================================= */

  async function preparePrint() {
    if (!isPrintMode) return;

    // Expand all sections
    document.querySelectorAll('details').forEach(function (d) { d.open = true; });

    // Switch all sections to show diagram tab if available, otherwise leave on original
    // We want all panels visible for print — CSS handles this

    // Render all diagrams
    const allWraps = document.querySelectorAll('.diagram-wrap');
    const renderPromises = [];

    allWraps.forEach(function (wrap) {
      const uid = wrap.dataset.diagramUid;
      if (renderedDiagrams.has(uid)) return;
      renderedDiagrams.add(uid);

      const srcEl = wrap.querySelector('.mermaid-src');
      const outEl = wrap.querySelector('.mermaid-output');
      if (!srcEl || !outEl || !window.mermaid) return;

      const code = srcEl.textContent;
      const isInferred = wrap.dataset.inferred === 'true';
      const id = 'mmd-' + uid.replace(/[^a-z0-9]/gi, '-');

      renderPromises.push(
        mermaid.render(id, code).then(function (result) {
          outEl.innerHTML = result.svg;
          const svg = outEl.querySelector('svg');
          if (svg) {
            svg.style.maxWidth = '100%';
            svg.style.height = 'auto';
            if (isInferred) addInferredBadge(svg);
          }
        }).catch(function () {})
      );
    });

    await Promise.all(renderPromises);
  }

  /* =========================================================
     Init
     ========================================================= */

  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose'
  });

  document.addEventListener('DOMContentLoaded', async function () {
    // Wire dark toggle
    const darkToggle = document.getElementById('dark-toggle');
    if (darkToggle) {
      darkToggle.addEventListener('click', toggleDarkMode);
    }
    updateDarkToggleLabel();

    // Wire hamburger
    const hamburger = document.getElementById('hamburger-btn');
    if (hamburger) {
      hamburger.addEventListener('click', function () {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        if (isMobile()) {
          if (document.body.classList.contains('mobile-mindmap-home')) {
            hideMindmapHome();
          } else {
            showMindmapHome();
          }
        } else if (sidebar.classList.contains('drawer-open')) {
          closeDrawer();
        } else {
          openDrawer();
        }
      });
    }

    // Mobile: mindmap-as-home — start on the map. Tap a node → switch to section view.
    if (isMobile()) showMindmapHome();

    // Resize: clean up classes that don't belong at the new breakpoint
    window.addEventListener('resize', function () {
      if (isMobile()) {
        closeDrawer();
      } else {
        document.body.classList.remove('mobile-mindmap-home');
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('mindmap-view');
      }
      updateHamburgerIcon();
    });

    // Backdrop click closes drawer
    const backdrop = document.getElementById('drawer-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeDrawer);
    }


    // Modal close
    const modalClose = document.getElementById('diagram-modal-close');
    if (modalClose) {
      modalClose.addEventListener('click', closeDiagramModal);
    }

    const modal = document.getElementById('diagram-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeDiagramModal();
      });
    }

    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        applySearch(searchInput.value);
      });
    }

    // Print button
    const printBtn = document.getElementById('print-btn');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        window.print();
      });
    }

    // Render sections
    renderSections(sections);

    // Render glossary
    renderGlossary();

    // Init mindmap (defer slightly to let markmap-autoloader settle)
    setTimeout(initMindmap, 100);

    // Restore last section scroll
    if (state.lastSection && !isPrintMode) {
      setTimeout(function () {
        const el = document.getElementById('section-' + state.lastSection);
        if (el) el.scrollIntoView({ block: 'nearest' });
      }, 200);
    }

    // Print mode
    if (isPrintMode) {
      await preparePrint();
    }
  });

})();
