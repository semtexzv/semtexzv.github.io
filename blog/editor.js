/* editor.js — a small block-based document editor.
   Document = ordered blocks; one registry entry per type defines
   create / render / toHTML / fromHTML, so adding a block touches one place.
   Single WYSIWYG surface: blocks are the real post elements (styled by
   blog.css), so the editing view == the published post. Document-level undo. */
window.BlogEditor = (function () {
  var LANGS = ['text', 'python', 'javascript', 'typescript', 'rust', 'go', 'bash', 'json', 'yaml', 'html', 'css', 'sql', 'c', 'cpp'];
  var _id = 0; function nid() { return 'b' + (++_id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escA(s) { return esc(s).replace(/"/g, '&quot;'); }
  function el(t, a) { var e = document.createElement(t); for (var k in (a || {})) { if (k === 'class') e.className = a[k]; else e.setAttribute(k, a[k]); } return e; }

  function defaultSpec() {
    return { gridH: 4, shapes: [{ id: 's1', x: 0.5, y: 1.5, w: 2, h: 1, color: 'secondary', text: 'input' }, { id: 's2', x: 4, y: 1.5, w: 2, h: 1, color: 'accent1', text: 'agent' }, { id: 's3', x: 7.5, y: 1.5, w: 2, h: 1, color: 'secondary', text: 'output' }], connectors: [{ from: { shape: 's1', anchor: 'auto' }, to: { shape: 's2', anchor: 'auto' }, color: 'accent1' }, { from: { shape: 's2', anchor: 'auto' }, to: { shape: 's3', anchor: 'auto' }, color: 'accent1' }], labels: [] };
  }

  /* ---------- block registry ---------- */
  var REG = {}, MENU = [], PARSE = [];
  function register(def) { REG[def.type] = def; if (def.menu !== false) MENU.push(def); PARSE.push(def); }

  function textDef(type, label, tag, cls, ph, group) {
    register({
      type: type, label: label, group: group || 'text', text: true, tag: tag, cls: cls, ph: ph,
      create: function () { return { id: nid(), type: type, html: '' }; },
      render: function (b) { var e = el(tag); if (cls) e.className = cls; e.contentEditable = 'true'; e.setAttribute('data-ph', ph || label); e.innerHTML = b.html || ''; return e; },
      toHTML: function (b) { return '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>' + (b.html || '') + '</' + tag + '>'; },
      match: function (el2) { var t = el2.tagName.toLowerCase(); if (t !== tag) return false; if (cls) return el2.classList.contains(cls); if (tag === 'p') return !el2.classList.contains('lede'); return true; },
      fromHTML: function (el2) { return { id: nid(), type: type, html: el2.innerHTML.trim() }; }
    });
  }
  textDef('h1', 'Heading 1', 'h1', null, 'Heading 1');
  register({   // numbered section heading; also adopts the old <span class="h2num"> style on open
    type: 'h2num', label: 'Numbered heading', group: 'text', text: true,
    create: function () { return { id: nid(), type: 'h2num', html: '' }; },
    render: function (b) { var e = el('h2'); e.className = 'num'; e.contentEditable = 'true'; e.setAttribute('data-ph', 'Section heading'); e.innerHTML = b.html || ''; return e; },
    toHTML: function (b) { return '<h2 class="num">' + (b.html || '') + '</h2>'; },
    match: function (el2) { return el2.tagName === 'H2' && (el2.classList.contains('num') || !!el2.querySelector('.h2num')); },
    fromHTML: function (el2) { var c = el2.cloneNode(true), sp = c.querySelector('.h2num'); if (sp) sp.remove(); return { id: nid(), type: 'h2num', html: c.innerHTML.trim() }; }
  });
  textDef('h2', 'Heading 2', 'h2', null, 'Heading 2');
  textDef('h3', 'Heading 3', 'h3', null, 'Heading 3');
  textDef('lede', 'Lede', 'p', 'lede', 'Lede paragraph…');
  textDef('p', 'Text', 'p', null, "Write, or press '/' for blocks…");
  textDef('quote', 'Quote', 'blockquote', null, 'Quote');
  textDef('note', 'Note', 'div', 'draft-note', 'Note…');

  function listDef(type, tag, label) {
    register({
      type: type, label: label, group: 'text', text: true, tag: tag,
      create: function () { return { id: nid(), type: type, html: '<li></li>' }; },
      render: function (b) { var e = el(tag); e.contentEditable = 'true'; e.setAttribute('data-ph', 'List'); e.innerHTML = b.html || '<li></li>'; return e; },
      toHTML: function (b) { return '<' + tag + '>' + (b.html || '') + '</' + tag + '>'; },
      match: function (el2) { return el2.tagName.toLowerCase() === tag; },
      fromHTML: function (el2) { return { id: nid(), type: type, html: el2.innerHTML.trim() }; }
    });
  }
  listDef('ul', 'ul', 'Bulleted list'); listDef('ol', 'ol', 'Numbered list');

  register({
    type: 'code', label: 'Code', group: 'block',
    create: function () { return { id: nid(), type: 'code', lang: 'text', code: '' }; },
    render: function (b, ed) {
      var box = el('div', { class: 'cb b-atomic' }), head = el('div', { class: 'cb-head' }), sel = el('select');
      LANGS.forEach(function (l) { var o = el('option', { value: l }); o.textContent = l; if (l === (b.lang || 'text')) o.selected = true; sel.appendChild(o); });
      sel.onchange = function () { ed.snapshot(); b.lang = sel.value; ed.save(); };
      head.appendChild(sel);
      var pre = el('pre'), code = el('code', { 'data-ph': 'code…' }); code.contentEditable = 'plaintext-only'; code.textContent = b.code || '';
      code.addEventListener('input', function () { ed.onTextInput(function () { b.code = code.textContent; }); });
      pre.appendChild(code); box.append(head, pre); return box;
    },
    toHTML: function (b) { return '<pre data-lang="' + escA(b.lang || 'text') + '"><code>' + esc(b.code || '') + '</code></pre>'; },
    match: function (el2) { return el2.tagName === 'PRE'; },
    fromHTML: function (el2) { var c = el2.querySelector('code'); return { id: nid(), type: 'code', lang: el2.getAttribute('data-lang') || 'text', code: (c ? c.textContent : el2.textContent) }; }
  });

  register({
    type: 'image', label: 'Image', group: 'block',
    create: function () { return { id: nid(), type: 'image', src: '', alt: '', caption: '' }; },
    render: function (b, ed) {
      var fig = el('figure', { class: 'imgb fig b-atomic' });
      function pick() { var u = prompt('Image URL', b.src || ''); if (u === null) return; ed.snapshot(); b.src = u; b.alt = prompt('Alt text', b.alt || '') || ''; ed.save(); draw(); }
      function draw() {
        fig.innerHTML = '';
        if (b.src) { var img = el('img', { src: b.src, alt: b.alt || '' }); img.onclick = pick; fig.appendChild(img); }
        else { var ph = el('div', { class: 'img-empty' }); ph.textContent = '+ image — click to set URL'; ph.onclick = pick; fig.appendChild(ph); }
        var cap = el('figcaption', { contenteditable: 'true', 'data-ph': 'caption' }); cap.textContent = b.caption || '';
        cap.addEventListener('input', function () { ed.onTextInput(function () { b.caption = cap.textContent; }); });
        fig.appendChild(cap);
      }
      draw(); return fig;
    },
    toHTML: function (b) { return '<figure class="fig"><img src="' + escA(b.src) + '" alt="' + escA(b.alt || '') + '" />' + (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') + '</figure>'; },
    match: function (el2) { return el2.tagName === 'FIGURE' && el2.querySelector('img') && !el2.hasAttribute('data-spec'); },
    fromHTML: function (el2) { var i = el2.querySelector('img'), c = el2.querySelector('figcaption'); return { id: nid(), type: 'image', src: i.getAttribute('src') || '', alt: i.getAttribute('alt') || '', caption: c ? c.textContent.trim() : '' }; }
  });

  register({
    type: 'divider', label: 'Divider', group: 'block',
    create: function () { return { id: nid(), type: 'divider' }; },
    render: function () { return el('hr', { class: 'b-atomic' }); },
    toHTML: function () { return '<hr />'; },
    match: function (el2) { return el2.tagName === 'HR'; },
    fromHTML: function () { return { id: nid(), type: 'divider' }; }
  });

  register({
    type: 'diagram', label: 'Diagram', group: 'block',
    create: function () { return { id: nid(), type: 'diagram', spec: defaultSpec(), caption: '' }; },
    render: function (b, ed) {
      var fig = el('figure', { class: 'fig dgb b-atomic' }), bar = el('div', { class: 'dg-bar' }), wrap = el('div', { class: 'dg-canvas-wrap' });
      var cap = el('figcaption', { contenteditable: 'true', 'data-ph': 'caption' }); cap.textContent = b.caption || '';
      cap.addEventListener('input', function () { ed.onTextInput(function () { b.caption = cap.textContent; }); });
      fig.append(bar, wrap, cap);
      ed.deMap[b.id] = window.DiagramEditor.create({ wrap: wrap, bar: bar, spec: b.spec, beforeChange: function () { ed.snapshot(); }, onChange: function (sp) { b.spec = sp; ed.save(); }, onActivate: function () { ed.activeBlockId = b.id; } });
      return fig;
    },
    toHTML: function (b) { return '<figure class="fig" data-spec=\'' + JSON.stringify(b.spec).replace(/'/g, '&#39;') + '\'>' + window.Diagram.svgMarkup(b.spec) + (b.caption ? '<figcaption>' + esc(b.caption) + '</figcaption>' : '') + '</figure>'; },
    match: function (el2) { return el2.tagName === 'FIGURE' && el2.hasAttribute('data-spec'); },
    fromHTML: function (el2) { var c = el2.querySelector('figcaption'), s; try { s = JSON.parse(el2.getAttribute('data-spec')); } catch (e) { s = defaultSpec(); } return { id: nid(), type: 'diagram', spec: s, caption: c ? c.textContent.trim() : '' }; }
  });

  register({   // fallback: preserve any hand-written HTML
    type: 'html', label: 'Raw HTML', group: 'block', menu: false,
    create: function () { return { id: nid(), type: 'html', html: '' }; },
    render: function (b) { var d = el('div', { class: 'b-atomic' }); d.innerHTML = b.html || ''; return d; },
    toHTML: function (b) { return b.html || ''; },
    match: function () { return false; },
    fromHTML: function (el2) { return { id: nid(), type: 'html', html: el2.outerHTML }; }
  });

  /* ---------- caret helpers ---------- */
  function caretSplit(node) {
    var s = window.getSelection(); if (!s.rangeCount || !node.contains(s.anchorNode)) return null;
    var r = s.getRangeAt(0);
    var pre = document.createRange(); pre.selectNodeContents(node); pre.setEnd(r.startContainer, r.startOffset);
    var post = document.createRange(); post.selectNodeContents(node); post.setStart(r.endContainer, r.endOffset);
    var d1 = el('div'); d1.appendChild(pre.cloneContents()); var d2 = el('div'); d2.appendChild(post.cloneContents());
    return { before: d1.innerHTML, after: d2.innerHTML };
  }
  function atStart(node) { var s = window.getSelection(); if (!s.rangeCount) return false; var r = s.getRangeAt(0); if (!r.collapsed) return false; var pre = document.createRange(); pre.selectNodeContents(node); pre.setEnd(r.startContainer, r.startOffset); return pre.toString().length === 0; }

  /* ---------- editor ---------- */
  function Editor(host, onSave) {
    this.host = host; this.onSaveCb = onSave || function () {};
    this.doc = []; this.undo = []; this.redo = []; this.elMap = {}; this.deMap = {};
    this.activeBlockId = null; this.selBlockId = null; this.typingRun = false; this._tt = null;
    var self = this;
    document.addEventListener('selectionchange', function () { self.syncInlineToolbar(); });
    document.addEventListener('keydown', function (e) { self.onGlobalKey(e); }, true);
    host.addEventListener('pointerdown', function (e) { var blk = e.target.closest('.block'); if (blk) { var b = self.byId(blk.getAttribute('data-id')); if (b) { self.activeBlockId = b.id; if (REG[b.type] && !REG[b.type].text && b.type !== 'diagram') self.selectBlock(b.id); else self.selectBlock(null); } } });
  }
  var P = Editor.prototype;
  P.byId = function (id) { for (var i = 0; i < this.doc.length; i++) if (this.doc[i].id === id) return this.doc[i]; return null; };
  P.indexOf = function (id) { for (var i = 0; i < this.doc.length; i++) if (this.doc[i].id === id) return i; return -1; };
  P.save = function () { this.onSaveCb(); };
  P.snapshot = function () { this.undo.push(clone(this.doc)); if (this.undo.length > 120) this.undo.shift(); this.redo = []; };
  P.onTextInput = function (sync) { if (!this.typingRun) { this.snapshot(); this.typingRun = true; } sync(); var self = this; clearTimeout(this._tt); this._tt = setTimeout(function () { self.typingRun = false; }, 500); this.save(); };

  P.setDoc = function (doc) { this.doc = doc && doc.length ? doc : [REG.p.create()]; this.undo = []; this.redo = []; this.renderAll(); };
  P.renderAll = function () {
    this.host.innerHTML = ''; this.elMap = {}; this.deMap = {}; this.closePicker(); var self = this;
    this.doc.forEach(function (b, i) { self.host.appendChild(self.gap(i)); self.host.appendChild(self.blockRow(b)); });
    this.host.appendChild(this.gap(this.doc.length));
  };
  P.gap = function (index) {
    var self = this, g = el('div', { class: 'gap' });
    var add = el('button', { class: 'gap-add', type: 'button', title: 'Add a block' }); add.textContent = '+';
    add.onmousedown = function (e) { e.preventDefault(); };
    add.onclick = function () { self.insertGap(index); };
    g.appendChild(add); return g;
  };
  P.insertGap = function (index) {
    this.snapshot(); var nb = REG.p.create(); this.doc.splice(index, 0, nb); this.renderAll(); this.focusBlock(nb.id, false); this.cellPicker(nb.id, false); this.save();
  };
  P.blockRow = function (b) {
    var def = REG[b.type] || REG.html, self = this;
    var row = el('div', { class: 'block', 'data-id': b.id, 'data-type': b.type });
    var g = el('div', { class: 'gutter' });
    var turn = el('button', { class: 'b-turn', title: 'Turn into…' }); turn.textContent = '¶'; turn.onmousedown = function (e) { e.preventDefault(); }; turn.onclick = function () { self.cellPicker(b.id, true); };
    var del = el('button', { class: 'b-del', title: 'Delete block' }); del.textContent = '×'; del.onclick = function () { self.deleteBlock(b.id); };
    g.append(turn, del);
    var content = def.render(b, this);
    if (def.text) this.wireText(b, content);
    row.append(g, content); this.elMap[b.id] = def.text ? content : null;
    return row;
  };
  P.wireText = function (b, node) {
    var self = this;
    node.addEventListener('input', function () { self.onTextInput(function () { b.html = node.innerHTML; }); });
    node.addEventListener('keydown', function (e) { self.onTextKey(e, b, node); });
    node.addEventListener('focus', function () { self.activeBlockId = b.id; });
  };
  P.onTextKey = function (e, b, node) {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (b.type === 'ul' || b.type === 'ol') return;            // native list behaviour
      e.preventDefault(); var parts = caretSplit(node) || { before: node.innerHTML, after: '' };
      this.snapshot(); b.html = parts.before; var nb = REG.p.create(); nb.html = parts.after;
      this.doc.splice(this.indexOf(b.id) + 1, 0, nb); this.renderAll(); this.focusBlock(nb.id, false); this.save();
    } else if (e.key === 'Backspace' && atStart(node)) {
      var i = this.indexOf(b.id);
      if (i <= 0) { if (b.type !== 'p') { this.snapshot(); b.type = 'p'; this.renderAll(); this.focusBlock(b.id, false); this.save(); } e.preventDefault(); return; }
      var prev = this.doc[i - 1];
      if (REG[prev.type].text) { e.preventDefault(); this.snapshot(); prev.html = (prev.html || '') + (b.html || ''); this.doc.splice(i, 1); this.renderAll(); this.focusBlock(prev.id, true); this.save(); }
      else if ((node.textContent || '') === '') { e.preventDefault(); this.snapshot(); this.doc.splice(i, 1); this.renderAll(); this.selectBlock(prev.id); this.save(); }
    } else if (e.key === '/' && (node.textContent || '') === '') {
      e.preventDefault(); this.cellPicker(b.id, true);
    }
  };
  P.focusBlock = function (id, atEnd) { var n = this.elMap[id]; if (!n) return; n.focus(); var r = document.createRange(); r.selectNodeContents(n); r.collapse(!atEnd); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };
  P.selectBlock = function (id) {
    this.selBlockId = id;
    var rows = this.host.querySelectorAll('.block'); for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('sel', rows[i].getAttribute('data-id') === id);
  };
  P.deleteBlock = function (id) {
    var i = this.indexOf(id); if (i < 0) return; this.snapshot(); this.doc.splice(i, 1);
    if (!this.doc.length) this.doc.push(REG.p.create()); this.renderAll(); this.save();
  };

  /* ---------- block menu ---------- */
  // inline "cell" picker — choose a block type from a row of cells (no dropdown)
  P.cellPicker = function (blockId, doSnap) {
    var self = this; this.closePicker();
    var row = this.host.querySelector('.block[data-id="' + blockId + '"]'); if (!row) return;
    var bar = el('div', { class: 'cellpick' });
    MENU.forEach(function (d) { var chip = el('button', { type: 'button', class: 'cell' }); chip.textContent = d.label; chip.onmousedown = function (e) { e.preventDefault(); }; chip.onclick = function () { self.closePicker(); var blk = self.byId(blockId); if (blk) self.convertBlock(blk, d.type, doSnap); }; bar.appendChild(chip); });
    row.appendChild(bar); this._picker = { bar: bar };
    setTimeout(function () { document.addEventListener('pointerdown', self._pickClose = function (ev) { if (!bar.contains(ev.target)) self.closePicker(); }, true); }, 0);
  };
  P.closePicker = function () { if (this._picker) { if (this._picker.bar.parentNode) this._picker.bar.remove(); this._picker = null; } if (this._pickClose) { document.removeEventListener('pointerdown', this._pickClose, true); this._pickClose = null; } };
  P.convertBlock = function (b, type, doSnap) { if (doSnap !== false) this.snapshot(); var nb = REG[type].create(); nb.id = b.id; if (REG[type].text && REG[b.type] && REG[b.type].text) nb.html = b.html || ''; this.doc[this.indexOf(b.id)] = nb; this.renderAll(); if (REG[type].text) this.focusBlock(nb.id, true); this.save(); };

  /* ---------- inline mark toolbar ---------- */
  P.syncInlineToolbar = function () {
    var s = window.getSelection();
    var inText = s.rangeCount && !s.isCollapsed && this.host.contains(s.anchorNode) && (function (n) { while (n && n !== this.host) { if (n.getAttribute && n.getAttribute('contenteditable') === 'true' && n.tagName !== 'FIGCAPTION') return true; n = n.parentNode; } return false; }).call(this, s.anchorNode);
    if (!inText) { if (this._itool) { this._itool.remove(); this._itool = null; } return; }
    if (!this._itool) this._itool = this.buildInlineToolbar();
    var r = s.getRangeAt(0).getBoundingClientRect();
    this._itool.style.left = (window.scrollX + r.left + r.width / 2 - this._itool.offsetWidth / 2) + 'px';
    this._itool.style.top = (window.scrollY + r.top - this._itool.offsetHeight - 8) + 'px';
    this.updateInlineActive();
  };
  P.buildInlineToolbar = function () {
    var self = this, t = el('div', { class: 'itool' }); this._ibtns = [];
    [['B', 'strong'], ['i', 'em'], ['hl', 'mark'], ['<>', 'code'], ['link', 'a']].forEach(function (x) {
      var btn = el('button', { type: 'button' }); btn.innerHTML = x[0]; btn._tag = x[1];
      btn.onmousedown = function (e) { e.preventDefault(); };
      btn.onclick = function () { if (x[1] === 'a') self.toggleLink(); else self.toggleMark(x[1]); };
      t.appendChild(btn); self._ibtns.push(btn);
    });
    document.body.appendChild(t); return t;
  };
  P.enclosingTag = function (tag) { var n = window.getSelection().anchorNode; while (n && n !== this.host) { if (n.nodeType === 1 && n.tagName.toLowerCase() === tag) return n; n = n.parentNode; } return null; };
  P.updateInlineActive = function () {
    if (!this._itool) return; var self = this;
    this._ibtns.forEach(function (b) { b.classList.toggle('on', !!self.enclosingTag(b._tag)); });
  };
  P.toggleMark = function (tag) {
    var sel = window.getSelection(); if (!sel.rangeCount) return; var encl = this.enclosingTag(tag);
    if (!encl && sel.isCollapsed) return;
    this.snapshot();
    if (encl) { var p = encl.parentNode; while (encl.firstChild) p.insertBefore(encl.firstChild, encl); p.removeChild(encl); p.normalize(); }
    else { var range = sel.getRangeAt(0), w = document.createElement(tag); try { range.surroundContents(w); } catch (e) { w.appendChild(range.extractContents()); range.insertNode(w); } var r2 = document.createRange(); r2.selectNodeContents(w); sel.removeAllRanges(); sel.addRange(r2); }
    this.syncActive(); this.save(); this.updateInlineActive();
  };
  P.toggleLink = function () {
    var sel = window.getSelection(); if (!sel.rangeCount) return; var a = this.enclosingTag('a');
    if (a) { this.snapshot(); var p = a.parentNode; while (a.firstChild) p.insertBefore(a.firstChild, a); p.removeChild(a); p.normalize(); }
    else { if (sel.isCollapsed) return; var u = prompt('URL'); if (!u) return; this.snapshot(); document.execCommand('createLink', false, u); }
    this.syncActive(); this.save(); this.updateInlineActive();
  };
  P.syncActive = function () { var n = this.elMap[this.activeBlockId], b = this.byId(this.activeBlockId); if (n && b) b.html = n.innerHTML; };

  /* ---------- keyboard (undo / atomic delete) ---------- */
  P.onGlobalKey = function (e) {
    var z = (e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey);
    if (z) { e.preventDefault(); if (e.shiftKey) this.redoOp(); else this.undoOp(); return; }
    if ((e.key === 'y') && e.ctrlKey) { e.preventDefault(); this.redoOp(); return; }
    var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.key === 'Backspace' || e.key === 'Delete') && this.selBlockId && !typing) { e.preventDefault(); this.deleteBlock(this.selBlockId); this.selBlockId = null; }
  };
  P.undoOp = function () { if (!this.undo.length) return; this.typingRun = false; this.redo.push(clone(this.doc)); this.doc = this.undo.pop(); this.renderAll(); this.save(); };
  P.redoOp = function () { if (!this.redo.length) return; this.undo.push(clone(this.doc)); this.doc = this.redo.pop(); this.renderAll(); this.save(); };

  /* ---------- serialize / parse ---------- */
  P.serialize = function () { return this.doc.map(function (b) { return (REG[b.type] || REG.html).toHTML(b); }).join('\n'); };
  P.parse = function (postBodyEl) {
    var doc = [], kids = postBodyEl ? postBodyEl.children : [];
    for (var i = 0; i < kids.length; i++) {
      var elx = kids[i], def = null;
      for (var j = 0; j < PARSE.length; j++) { if (PARSE[j].match(elx)) { def = PARSE[j]; break; } }
      doc.push(def ? def.fromHTML(elx) : REG.html.fromHTML(elx));
    }
    return doc.length ? doc : [REG.p.create()];
  };

  /* ---------- sample document (one of every feature) ---------- */
  function sampleDoc() {
    var d = [];
    d.push({ id: nid(), type: 'h1', html: 'Kitchen sink' });
    d.push({ id: nid(), type: 'lede', html: 'A sample document that exercises every block — edit any of it in place.' });
    d.push({ id: nid(), type: 'h2num', html: 'Text &amp; emphasis' });
    d.push({ id: nid(), type: 'p', html: 'Body text with <strong>strong</strong>, <em>emphasis</em>, a <mark>highlight</mark>, inline <code>code()</code>, and a <a href="/blog/">link</a>.' });
    d.push({ id: nid(), type: 'h3', html: 'A smaller heading' });
    d.push({ id: nid(), type: 'ul', html: '<li>first bullet</li><li>second bullet</li>' });
    d.push({ id: nid(), type: 'ol', html: '<li>step one</li><li>step two</li>' });
    d.push({ id: nid(), type: 'quote', html: 'A blockquote, for pulled-out asides.' });
    d.push({ id: nid(), type: 'h2num', html: 'Code &amp; media' });
    d.push({ id: nid(), type: 'code', lang: 'python', code: 'def tick(events):\n    for e in events:\n        agent.handle(e)' });
    d.push({ id: nid(), type: 'divider' });
    d.push({ id: nid(), type: 'diagram', caption: 'an agent in a topology', spec: { gridH: 4.4, shapes: [{ id: 'ev', x: 0.3, y: 1.4, w: 2, h: 1, color: 'secondary', text: 'events', sub: 'source' }, { id: 'ag', x: 4, y: 1.4, w: 2, h: 1, color: 'accent1', text: 'agent', sub: 'processor' }, { id: 'ac', x: 7.7, y: 1.4, w: 2, h: 1, color: 'secondary', text: 'actions', sub: 'sink' }, { id: 'mem', x: 4, y: 3.1, w: 2, h: 0.9, color: 'primary', text: 'memory', sub: 'state' }], connectors: [{ from: { shape: 'ev', anchor: 'auto' }, to: { shape: 'ag', anchor: 'auto' }, color: 'accent1' }, { from: { shape: 'ag', anchor: 'auto' }, to: { shape: 'ac', anchor: 'auto' }, color: 'accent1' }, { from: { shape: 'ag', anchor: 's' }, to: { shape: 'mem', anchor: 'n' }, color: 'secondary', label: 'read / write' }, { from: { shape: 'ag', anchor: 'n' }, to: { shape: 'ev', anchor: 'n' }, color: 'accent1', dash: true, route: 'over', label: 'emit · re-enqueue' }], labels: [] } });
    d.push({ id: nid(), type: 'note', html: '<b>note</b> — callouts use the draft-note style; great for asides and drafts.' });
    d.push({ id: nid(), type: 'p', html: 'And a closing paragraph.' });
    return d;
  }

  return {
    create: function (host, onSave) { return new Editor(host, onSave); },
    sampleDoc: sampleDoc,
    blankDoc: function () { return [REG.h1.create(), REG.p.create()]; }
  };
})();
