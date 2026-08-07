/* diagram.js — d3 diagram renderer.
   A diagram is a JSON spec on a 0–10 grid (snap 0.25):
     { gridH:6,
       shapes:[{id,x,y,w,h,color,text,sub}],            // color: primary|secondary|accent1|accent2
       connectors:[{from,to,color,label,dash,route}],    // from/to: "id" or {shape,anchor}
       labels:[{x,y,text,color,anchor}] }                // anchor: auto|n|e|s|w|ne|nw|se|sw|c
   Colours resolve to CSS tokens (var(--dg-*)) so a baked SVG is theme-aware.
   Diagram.svgMarkup(spec) → static <svg> string. Diagram.render(el,spec,opts)
   → draw into a live element (the editor, with grid + interactivity). */
window.Diagram = (function () {
  var CELL = 72, GW = 10, MONO = 'ui-monospace,"SF Mono",Menlo,monospace', seq = 0;
  var COLORS = ['primary', 'secondary', 'accent1', 'accent2'];
  var ANCHORS = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw', 'c'];
  function cvar(t) { return 'var(--dg-' + (COLORS.indexOf(t) < 0 ? 'primary' : t) + ')'; }
  function px(u) { return Math.round(u * CELL * 100) / 100; }
  function gridH(spec) { return spec.gridH || 6; }
  function rectOf(s) { return { x: px(s.x), y: px(s.y), w: px(s.w || 2), h: px(s.h || 1) }; }
  function centerOf(s) { var r = rectOf(s); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  function epOf(e) { return (typeof e === 'string') ? { shape: e, anchor: 'auto' } : { shape: e.shape, anchor: e.anchor || 'auto' }; }

  function anchorPoint(S, anchor, towards) {
    var r = rectOf(S), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    switch (anchor) {
      case 'n': return { x: cx, y: r.y }; case 's': return { x: cx, y: r.y + r.h };
      case 'w': return { x: r.x, y: cy }; case 'e': return { x: r.x + r.w, y: cy };
      case 'nw': return { x: r.x, y: r.y }; case 'ne': return { x: r.x + r.w, y: r.y };
      case 'sw': return { x: r.x, y: r.y + r.h }; case 'se': return { x: r.x + r.w, y: r.y + r.h };
      case 'c': return { x: cx, y: cy };
    }
    var dx = towards.x - cx, dy = towards.y - cy;                 // auto: edge centre toward the other end
    if (Math.abs(dx) >= Math.abs(dy)) return { x: dx > 0 ? r.x + r.w : r.x, y: cy };
    return { x: cx, y: dy > 0 ? r.y + r.h : r.y };
  }
  // every snap point on a shape (for endpoint dragging)
  function anchorList(S) { return ANCHORS.map(function (a) { var p = anchorPoint(S, a); p.anchor = a; return p; }); }

  // outward normal of the shape side/corner an endpoint sits on ({0,0} at centre)
  function normalAt(S, P) {
    var r = rectOf(S);
    if (Math.abs(P.x - r.x) < 0.5) return { x: -1, y: 0 };
    if (Math.abs(P.x - (r.x + r.w)) < 0.5) return { x: 1, y: 0 };
    if (Math.abs(P.y - r.y) < 0.5) return { x: 0, y: -1 };
    if (Math.abs(P.y - (r.y + r.h)) < 0.5) return { x: 0, y: 1 };
    return { x: 0, y: 0 };
  }
  function dirOr(n, P, Q) {   // fall back to the dominant axis toward the far end
    if (n.x || n.y) return n;
    return (Math.abs(Q.x - P.x) >= Math.abs(Q.y - P.y)) ? { x: Q.x > P.x ? 1 : -1, y: 0 } : { x: 0, y: Q.y > P.y ? 1 : -1 };
  }

  function connectorPath(F, T, c) {
    var a = epOf(c.from), b = epOf(c.to), fc = centerOf(F), tc = centerOf(T);
    var P1 = anchorPoint(F, a.anchor, tc), P2 = anchorPoint(T, b.anchor, fc);
    if (c.route === 'over' || c.route === 'under') {
      var up = c.route === 'over', fr = rectOf(F), tr = rectOf(T);
      var peak = up ? Math.min(fr.y, tr.y) - 0.55 * CELL : Math.max(fr.y + fr.h, tr.y + tr.h) + 0.55 * CELL;
      return { d: 'M' + P1.x + ' ' + P1.y + ' V ' + peak + ' H ' + P2.x + ' V ' + P2.y, lx: (P1.x + P2.x) / 2, ly: peak + (up ? -6 : 16), p1: P1, p2: P2 };
    }
    var shape = c.shape || 'elbow';
    if (shape === 'straight')
      return { d: 'M' + P1.x + ' ' + P1.y + ' L ' + P2.x + ' ' + P2.y, lx: (P1.x + P2.x) / 2, ly: (P1.y + P2.y) / 2 - 8, p1: P1, p2: P2 };
    var n1 = dirOr(normalAt(F, P1), P1, P2), n2 = dirOr(normalAt(T, P2), P2, P1);
    if (shape === 'curve') {
      var L = Math.max(0.6 * CELL, Math.hypot(P2.x - P1.x, P2.y - P1.y) / 2.4);
      return { d: 'M' + P1.x + ' ' + P1.y + ' C ' + (P1.x + n1.x * L) + ' ' + (P1.y + n1.y * L) + ' ' + (P2.x + n2.x * L) + ' ' + (P2.y + n2.y * L) + ' ' + P2.x + ' ' + P2.y,
        lx: (P1.x + P2.x) / 2, ly: (P1.y + P2.y) / 2 - 8, p1: P1, p2: P2 };
    }
    // elbow: leave/enter perpendicular to the side via short stubs, then turn
    var STUB = 0.3 * CELL, i;
    var S1 = { x: P1.x + n1.x * STUB, y: P1.y + n1.y * STUB }, S2 = { x: P2.x + n2.x * STUB, y: P2.y + n2.y * STUB };
    var mid;
    if (n1.x) mid = n2.x ? [{ x: (S1.x + S2.x) / 2, y: S1.y }, { x: (S1.x + S2.x) / 2, y: S2.y }] : [{ x: S2.x, y: S1.y }];
    else mid = n2.y ? [{ x: S1.x, y: (S1.y + S2.y) / 2 }, { x: S2.x, y: (S1.y + S2.y) / 2 }] : [{ x: S1.x, y: S2.y }];
    var pts = [P1, S1].concat(mid, [S2, P2]), flat = [];
    for (i = 0; i < pts.length; i++) { var q = pts[i], lp = flat[flat.length - 1]; if (!lp || Math.abs(lp.x - q.x) > 0.01 || Math.abs(lp.y - q.y) > 0.01) flat.push(q); }
    for (i = flat.length - 2; i > 0; i--) { var A = flat[i - 1], B = flat[i], C = flat[i + 1];
      if ((Math.abs(A.x - B.x) < 0.01 && Math.abs(B.x - C.x) < 0.01) || (Math.abs(A.y - B.y) < 0.01 && Math.abs(B.y - C.y) < 0.01)) flat.splice(i, 1); }
    var d = 'M' + flat[0].x + ' ' + flat[0].y;
    for (i = 1; i < flat.length; i++) d += ' L ' + flat[i].x + ' ' + flat[i].y;
    var bi = 0, bl = -1;   // label rides the longest segment
    for (i = 0; i < flat.length - 1; i++) { var len = Math.hypot(flat[i + 1].x - flat[i].x, flat[i + 1].y - flat[i].y); if (len > bl) { bl = len; bi = i; } }
    var A2 = flat[bi], B2 = flat[bi + 1], vert = Math.abs(A2.x - B2.x) < 0.01;
    return { d: d, lx: vert ? A2.x + 12 : (A2.x + B2.x) / 2, ly: vert ? (A2.y + B2.y) / 2 + 3 : (A2.y + B2.y) / 2 - 7, anchor: vert ? 'start' : undefined, p1: P1, p2: P2 };
  }

  function build(spec, opts) {
    opts = opts || {};
    var GH = gridH(spec), W = GW * CELL, H = GH * CELL, uid = 'd' + (seq++) + '-';
    var svg = d3.create('svg').attr('viewBox', '0 0 ' + W + ' ' + H).attr('class', 'diagram').attr('role', 'img');
    var defs = svg.append('defs');
    COLORS.forEach(function (c) {
      defs.append('marker').attr('id', uid + 'ar-' + c).attr('markerWidth', 10).attr('markerHeight', 8)
        .attr('refX', 9).attr('refY', 4).attr('orient', 'auto').attr('markerUnits', 'userSpaceOnUse')
        .append('path').attr('d', 'M0,0 L9,4 L0,8 Z').attr('fill', cvar(c));
      defs.append('marker').attr('id', uid + 'ars-' + c).attr('markerWidth', 10).attr('markerHeight', 8)
        .attr('refX', 0).attr('refY', 4).attr('orient', 'auto').attr('markerUnits', 'userSpaceOnUse')
        .append('path').attr('d', 'M9,0 L0,4 L9,8 Z').attr('fill', cvar(c));
    });
    if (opts.grid) {
      var g = svg.append('g').attr('opacity', 0.5);
      for (var gx = 0; gx <= GW * 2; gx++) g.append('line').attr('x1', px(gx / 2)).attr('y1', 0).attr('x2', px(gx / 2)).attr('y2', H).attr('stroke', 'var(--hair)').attr('stroke-width', gx % 2 ? 0.3 : 0.6);
      for (var gy = 0; gy <= GH * 2; gy++) g.append('line').attr('x1', 0).attr('y1', px(gy / 2)).attr('x2', W).attr('y2', px(gy / 2)).attr('stroke', 'var(--hair)').attr('stroke-width', gy % 2 ? 0.3 : 0.6);
    }
    var byId = {}; (spec.shapes || []).forEach(function (s) { byId[s.id] = s; });
    (spec.connectors || []).forEach(function (c, i) {
      var F = byId[epOf(c.from).shape], T = byId[epOf(c.to).shape]; if (!F || !T) return;
      var col = c.color || 'secondary', p = connectorPath(F, T, c), arrows = c.arrows || 'end';
      svg.append('path').attr('d', p.d).attr('fill', 'none').attr('stroke', cvar(col)).attr('stroke-width', 1.7)
        .attr('marker-end', arrows === 'none' ? null : 'url(#' + uid + 'ar-' + col + ')')
        .attr('marker-start', arrows === 'both' ? 'url(#' + uid + 'ars-' + col + ')' : null)
        .attr('stroke-dasharray', c.dash ? '5 4' : null);
      if (opts.interactive) svg.append('path').attr('d', p.d).attr('fill', 'none').attr('stroke', 'transparent').attr('stroke-width', 12).attr('data-conn', i).style('cursor', 'pointer');
      if (c.label) svg.append('text').attr('x', p.lx).attr('y', p.ly).attr('fill', cvar(col)).attr('font-family', MONO).attr('font-size', 10).attr('letter-spacing', '.08em').attr('text-anchor', p.anchor || 'middle').text(c.label);
    });
    (spec.shapes || []).forEach(function (s) {
      var r = rectOf(s), col = cvar(s.color);
      var g2 = svg.append('g'); if (opts.interactive) g2.attr('data-shape', s.id).style('cursor', 'move');
      g2.append('rect').attr('x', r.x).attr('y', r.y).attr('width', r.w).attr('height', r.h)
        .attr('fill', col).attr('fill-opacity', 0.08).attr('stroke', col).attr('stroke-width', 1.5).attr('shape-rendering', 'crispEdges');
      g2.append('text').attr('x', r.x + r.w / 2).attr('y', r.y + r.h * (s.sub ? 0.4 : 0.5)).attr('fill', col)
        .attr('font-family', MONO).attr('font-size', 13).attr('font-weight', 600).attr('text-anchor', 'middle').attr('dominant-baseline', 'middle').text(s.text || '');
      if (s.sub) g2.append('text').attr('x', r.x + r.w / 2).attr('y', r.y + r.h * 0.72).attr('fill', 'var(--dg-secondary)')
        .attr('font-family', MONO).attr('font-size', 9.5).attr('letter-spacing', '.06em').attr('text-anchor', 'middle').attr('dominant-baseline', 'middle').text((s.sub || '').toUpperCase());
    });
    (spec.labels || []).forEach(function (l, i) {
      var t = svg.append('text').attr('x', px(l.x)).attr('y', px(l.y)).attr('fill', cvar(l.color || 'primary'))
        .attr('font-family', MONO).attr('font-size', 11).attr('text-anchor', l.anchor || 'middle').text(l.text || '');
      if (opts.interactive) t.attr('data-label', i).style('cursor', 'move');
    });
    return svg.node();
  }

  function render(elm, spec, opts) {
    var n = build(spec, opts), sel = d3.select(elm);
    sel.selectAll('*').remove();
    sel.attr('viewBox', n.getAttribute('viewBox'));
    Array.prototype.slice.call(n.childNodes).forEach(function (ch) { elm.appendChild(ch); });
    return elm;
  }
  function svgMarkup(spec) { return new XMLSerializer().serializeToString(build(spec)); }

  return { build: build, render: render, svgMarkup: svgMarkup, connectorPath: connectorPath, anchorPoint: anchorPoint, anchorList: anchorList, epOf: epOf, rectOf: rectOf, centerOf: centerOf, COLORS: COLORS, ANCHORS: ANCHORS, CELL: CELL, GW: GW, gridH: gridH };
})();
