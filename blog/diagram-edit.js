/* diagram-edit.js — inline, direct-manipulation editor for a diagram spec.
   Renders an interactive SVG (via Diagram) and edits it in place:
   drag shapes (snap 0.25), double-click to edit text, connectors are entities
   whose endpoints re-anchor to side-centres / corners, ⌫ deletes the selection.
   Selection draws an overlay (it does NOT rebuild the SVG) so double-click and
   pointer gestures stay intact. Reports edits via beforeChange()/onChange(). */
window.DiagramEditor = (function () {
  var D = window.Diagram, CELL = D.CELL, SNAP = 0.25, NS = 'http://www.w3.org/2000/svg';
  var active = null;

  function snap(v) { return Math.max(0, Math.round(v / SNAP) * SNAP); }
  function svgEl(n, a) { var e = document.createElementNS(NS, n); for (var k in (a || {})) e.setAttribute(k, a[k]); return e; }

  document.addEventListener('keydown', function (e) {
    if (!active) return;
    var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.key === 'Backspace' || e.key === 'Delete') && active.sel && !active.editing && !typing) { e.preventDefault(); e.stopPropagation(); active.del(); }
  }, true);
  document.addEventListener('pointerdown', function (e) { if (active && !active.wrap.parentNode.contains(e.target)) active.deactivate(); }, true);

  function create(o) {
    var inst = {
      wrap: o.wrap, bar: o.bar, spec: o.spec, before: o.beforeChange || function () {}, change: o.onChange || function () {},
      onAct: o.onActivate || function () {}, sel: null, connect: false, connectFrom: null, editing: false, svg: null
    };
    inst.svg = svgEl('svg', { 'class': 'diagram' }); o.wrap.appendChild(inst.svg);
    Object.keys(METHODS).forEach(function (k) { inst[k] = METHODS[k].bind(inst); });
    inst.svg.addEventListener('pointerdown', inst.onDown);
    inst.svg.addEventListener('dblclick', inst.onDbl);
    inst.buildBar(); inst.draw();
    return inst;
  }

  var METHODS = {
    activate: function () { if (active && active !== this) active.deactivate(); active = this; this.wrap.parentNode.classList.add('active'); this.onAct(); },
    deactivate: function () { if (active === this) active = null; this.wrap.parentNode.classList.remove('active'); this.select(null); },
    byId: function (id) { return this.spec.shapes.filter(function (s) { return s.id === id; })[0]; },
    nextId: function () { var n = 1, ids = {}; this.spec.shapes.forEach(function (s) { ids[s.id] = 1; }); while (ids['s' + n]) n++; return 's' + n; },
    toSvg: function (e) { var c = this.svg.getScreenCTM().inverse(), p = this.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; var q = p.matrixTransform(c); return { x: q.x, y: q.y }; },
    toScreen: function (x, y) { var c = this.svg.getScreenCTM(), p = this.svg.createSVGPoint(); p.x = x; p.y = y; var q = p.matrixTransform(c); var r = this.wrap.getBoundingClientRect(); return { x: q.x - r.left, y: q.y - r.top }; },

    draw: function () { D.render(this.svg, this.spec, { grid: true, interactive: true }); this.overlay(); this.updateBar(); },
    overlay: function () {
      var self = this, s = this.sel;
      Array.prototype.slice.call(this.svg.querySelectorAll('.dg-overlay')).forEach(function (n) { n.remove(); });
      if (!s) return;
      if (s.type === 'shape') { var sh = this.byId(s.ref); if (sh) { var r = D.rectOf(sh); this.svg.appendChild(svgEl('rect', { x: r.x - 4, y: r.y - 4, width: r.w + 8, height: r.h + 8, 'class': 'sel-ring dg-overlay' })); this.svg.appendChild(svgEl('rect', { x: r.x + r.w - 5, y: r.y + r.h - 5, width: 10, height: 10, 'class': 'dg-handle dg-overlay', 'data-resize': sh.id })); } }
      else if (s.type === 'connector') {
        var c = this.spec.connectors[s.ref]; if (!c) return; var F = this.byId(D.epOf(c.from).shape), T = this.byId(D.epOf(c.to).shape); if (!F || !T) return;
        var p = D.connectorPath(F, T, c);
        [['from', p.p1], ['to', p.p2]].forEach(function (h) { self.svg.appendChild(svgEl('circle', { cx: h[1].x, cy: h[1].y, r: 6, 'class': 'dg-handle dg-overlay', 'data-handle': h[0] })); });
      }
    },
    select: function (type, ref) { this.sel = type ? { type: type, ref: ref } : null; this.overlay(); this.updateBar(); },
    commit: function () { this.change(this.spec); this.draw(); },

    buildBar: function () {
      var b = this.bar, self = this; b.innerHTML = '';
      function mk(label) { var x = document.createElement('button'); x.type = 'button'; x.textContent = label; return x; }
      this._add = mk('+ box'); this._add.onclick = function () { self.activate(); self.before(); var id = self.nextId(); self.spec.shapes.push({ id: id, x: 1, y: 1, w: 2, h: 1, color: 'primary', text: 'box' }); self.select('shape', id); self.commit(); };
      this._lab = mk('+ label'); this._lab.onclick = function () { self.activate(); self.before(); self.spec.labels.push({ x: 1, y: 0.5, text: 'label', color: 'accent1' }); self.select('label', self.spec.labels.length - 1); self.commit(); };
      this._con = mk('connect'); this._con.onclick = function () { self.activate(); self.connect = !self.connect; self.connectFrom = null; self._con.classList.toggle('on', self.connect); self.updateBar(); };
      b.append(this._add, this._lab, this._con);
      this._ctx = document.createElement('span'); this._ctx.style.cssText = 'display:inline-flex;gap:.3rem;align-items:center;flex-wrap:wrap'; b.appendChild(this._ctx);
    },
    updateBar: function () {
      var ctx = this._ctx, self = this; ctx.innerHTML = '';
      if (this.connect) { ctx.innerHTML = '<span style="font-size:.68rem;color:var(--muted)">click source box, then target</span>'; return; }
      if (!this.sel) return;
      var item = this.sel.type === 'shape' ? this.byId(this.sel.ref) : this.sel.type === 'connector' ? this.spec.connectors[this.sel.ref] : this.spec.labels[this.sel.ref];
      if (!item) return;
      var sep = document.createElement('span'); sep.className = 'sep'; ctx.appendChild(sep);
      D.COLORS.forEach(function (col) {
        var sw = document.createElement('button'); sw.type = 'button'; sw.className = 'dg-sw' + ((item.color || (self.sel.type === 'connector' ? 'secondary' : 'primary')) === col ? ' on' : '');
        sw.style.background = 'var(--dg-' + col + ')'; sw.title = col; sw.onclick = function () { self.before(); item.color = col; self.commit(); }; ctx.appendChild(sw);
      });
      if (this.sel.type === 'connector') {
        var rt = document.createElement('select'); ['auto', 'over', 'under'].forEach(function (r) { var o = document.createElement('option'); o.value = r; o.textContent = r; if ((item.route || 'auto') === r) o.selected = true; rt.appendChild(o); });
        rt.onchange = function () { self.before(); item.route = rt.value; self.commit(); }; ctx.appendChild(rt);
        var dl = document.createElement('button'); dl.type = 'button'; dl.textContent = item.dash ? 'dashed ✓' : 'dashed'; dl.onclick = function () { self.before(); item.dash = !item.dash; self.commit(); }; ctx.appendChild(dl);
      }
      if (this.sel.type === 'shape') {
        var sub = document.createElement('input'); sub.placeholder = 'sub·label'; sub.value = item.sub || '';
        sub.onchange = function () { self.before(); item.sub = sub.value; self.commit(); };
        sub.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') sub.blur(); });
        ctx.appendChild(sub);
      }
      var del = document.createElement('button'); del.type = 'button'; del.textContent = 'delete'; del.onclick = function () { self.del(); }; ctx.appendChild(del);
    },

    del: function () {
      if (!this.sel) return; this.before(); var s = this.sel;
      if (s.type === 'shape') { var id = s.ref; this.spec.shapes = this.spec.shapes.filter(function (x) { return x.id !== id; }); this.spec.connectors = this.spec.connectors.filter(function (c) { return D.epOf(c.from).shape !== id && D.epOf(c.to).shape !== id; }); }
      else if (s.type === 'connector') this.spec.connectors.splice(s.ref, 1);
      else if (s.type === 'label') this.spec.labels.splice(s.ref, 1);
      this.sel = null; this.commit();
    },

    onDown: function (e) {
      this.activate();
      var h = e.target.closest && e.target.closest('[data-handle]'), sh = e.target.closest && e.target.closest('[data-shape]'),
        cn = e.target.closest && e.target.closest('[data-conn]'), lb = e.target.closest && e.target.closest('[data-label]');
      var rz = e.target.closest && e.target.closest('[data-resize]');
      if (this.connect) { if (sh) this.connectClick(sh.getAttribute('data-shape')); return; }
      if (rz) { this.startResize(rz.getAttribute('data-resize'), e); return; }
      if (h) { this.startHandle(h.getAttribute('data-handle'), e); return; }
      if (sh) { this.select('shape', sh.getAttribute('data-shape')); this.startShapeDrag(sh.getAttribute('data-shape'), e); }
      else if (cn) this.select('connector', +cn.getAttribute('data-conn'));
      else if (lb) { this.select('label', +lb.getAttribute('data-label')); this.startLabelDrag(+lb.getAttribute('data-label'), e); }
      else this.select(null);
    },
    connectClick: function (id) {
      if (!this.connectFrom) { this.connectFrom = id; this._ctx.innerHTML = '<span style="font-size:.68rem;color:var(--muted)">source: ' + id + ' — click target</span>'; }
      else if (this.connectFrom !== id) { this.before(); this.spec.connectors.push({ from: { shape: this.connectFrom, anchor: 'auto' }, to: { shape: id, anchor: 'auto' }, color: 'secondary' }); this.connect = false; this.connectFrom = null; this._con.classList.remove('on'); this.select('connector', this.spec.connectors.length - 1); this.commit(); }
    },
    startShapeDrag: function (id, e) {
      var self = this, s = this.byId(id), p0 = this.toSvg(e), r = D.rectOf(s), ox = p0.x - r.x, oy = p0.y - r.y, moved = false;
      function mv(ev) { if (!moved) { self.before(); moved = true; } var p = self.toSvg(ev); s.x = snap((p.x - ox) / CELL); s.y = snap((p.y - oy) / CELL); self.draw(); }
      function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) self.change(self.spec); }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    },
    startResize: function (id, e) {
      var self = this, s = this.byId(id), moved = false;
      function mv(ev) { if (!moved) { self.before(); moved = true; } var p = self.toSvg(ev); s.w = Math.max(0.5, snap(p.x / CELL - s.x)); s.h = Math.max(0.5, snap(p.y / CELL - s.y)); self.draw(); }
      function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) self.change(self.spec); }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    },
    startLabelDrag: function (i, e) {
      var self = this, l = this.spec.labels[i], moved = false;
      function mv(ev) { if (!moved) { self.before(); moved = true; } var p = self.toSvg(ev); l.x = snap(p.x / CELL); l.y = snap(p.y / CELL); self.draw(); }
      function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) self.change(self.spec); }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    },
    startHandle: function (end, e) {
      var self = this, c = this.spec.connectors[this.sel.ref], moved = false;
      function mv(ev) {
        if (!moved) { self.before(); moved = true; }
        var p = self.toSvg(ev), sh = null;
        self.spec.shapes.forEach(function (s) { var r = D.rectOf(s); if (p.x >= r.x - 12 && p.x <= r.x + r.w + 12 && p.y >= r.y - 12 && p.y <= r.y + r.h + 12) sh = s; });
        if (!sh) return;
        var best = null, bd = 1e9; D.anchorList(sh).forEach(function (a) { var d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = a; } });
        c[end] = { shape: sh.id, anchor: best.anchor }; self.draw();
        D.anchorList(sh).forEach(function (a) { self.svg.appendChild(svgEl('circle', { cx: a.x, cy: a.y, r: a.anchor === best.anchor ? 4.5 : 2.5, 'class': 'dg-anchor dg-overlay' })); });
      }
      function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) self.change(self.spec); self.draw(); }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    },
    onDbl: function (e) {
      var sh = e.target.closest && e.target.closest('[data-shape]'), lb = e.target.closest && e.target.closest('[data-label]'),
        cn = e.target.closest && e.target.closest('[data-conn]');
      if (!sh && !lb && !cn) return;
      e.preventDefault();
      if (sh) { var s = this.byId(sh.getAttribute('data-shape')); this.editTextAt(s, 'text', D.centerOf(s)); }
      else if (lb) { var l = this.spec.labels[+lb.getAttribute('data-label')]; this.editTextAt(l, 'text', { x: l.x * CELL, y: l.y * CELL }); }
      else { var c = this.spec.connectors[+cn.getAttribute('data-conn')], F = this.byId(D.epOf(c.from).shape), T = this.byId(D.epOf(c.to).shape); if (!F || !T) return; var p = D.connectorPath(F, T, c); this.editTextAt(c, 'label', { x: p.lx, y: p.ly }); }
    },
    // shared in-view text input: shape text, free label text, connector label
    editTextAt: function (item, prop, at) {
      var self = this; if (!item) return; this.editing = true;
      var pos = this.toScreen(at.x, at.y);
      var inp = document.createElement('input'); inp.className = 'dg-text-edit'; inp.value = item[prop] || '';
      inp.style.left = pos.x + 'px'; inp.style.top = pos.y + 'px'; this.wrap.appendChild(inp);
      setTimeout(function () { inp.focus(); inp.select(); }, 0);
      var finished = false;
      function done(keep) { if (finished) return; finished = true; self.editing = false; if (keep && inp.value !== (item[prop] || '')) { self.before(); item[prop] = inp.value; self.commit(); } if (inp.parentNode) inp.parentNode.removeChild(inp); }
      inp.addEventListener('keydown', function (ev) { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); done(true); } else if (ev.key === 'Escape') done(false); });
      inp.addEventListener('blur', function () { done(true); });
    }
  };
  return { create: create };
})();
