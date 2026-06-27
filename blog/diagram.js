/* diagram.js — d3 diagram renderer.
   A diagram is a JSON spec on a 0–10 grid:
     { gridH:6,
       shapes:[{id,x,y,w,h,color,text,sub}],            // color: primary|secondary|accent1|accent2
       connectors:[{from,to,color,label,dash,route}],    // route: auto|over|under
       labels:[{x,y,text,color,anchor}] }                // free-floating text
   Colours resolve to CSS tokens (var(--dg-*)) so a baked SVG is theme-aware.
   Diagram.svgMarkup(spec) → static <svg> string (saved into the page).
   Diagram.render(svgEl, spec, opts) → draw into a live element (the editor). */
window.Diagram = (function () {
  var CELL = 72, GW = 10, MONO = 'ui-monospace,"SF Mono",Menlo,monospace', seq = 0;
  var COLORS = ['primary', 'secondary', 'accent1', 'accent2'];
  function cvar(t) { return 'var(--dg-' + (COLORS.indexOf(t) < 0 ? 'primary' : t) + ')'; }
  function px(u) { return Math.round(u * CELL * 100) / 100; }
  function gridH(spec) { return spec.gridH || 6; }
  function rectOf(s) { return { x: px(s.x), y: px(s.y), w: px(s.w || 2), h: px(s.h || 1) }; }
  function centerOf(s) { var r = rectOf(s); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

  function connectorPath(F, T, route) {
    var fr = rectOf(F), tr = rectOf(T), fc = centerOf(F), tc = centerOf(T);
    if (route === 'over' || route === 'under') {
      var up = route === 'over';
      var peak = up ? Math.min(fr.y, tr.y) - 0.55 * CELL : Math.max(fr.y + fr.h, tr.y + tr.h) + 0.55 * CELL;
      var fy = up ? fr.y : fr.y + fr.h, ty = up ? tr.y : tr.y + tr.h;
      return { d: 'M' + fc.x + ' ' + fy + ' V ' + peak + ' H ' + tc.x + ' V ' + ty, lx: (fc.x + tc.x) / 2, ly: peak + (up ? -6 : 16) };
    }
    var dx = tc.x - fc.x, dy = tc.y - fc.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      var fx = dx > 0 ? fr.x + fr.w : fr.x, tx = dx > 0 ? tr.x : tr.x + tr.w, mx = (fx + tx) / 2;
      if (Math.abs(dy) < 1) return { d: 'M' + fx + ' ' + fc.y + ' H ' + tx, lx: (fx + tx) / 2, ly: fc.y - 7 };
      return { d: 'M' + fx + ' ' + fc.y + ' H ' + mx + ' V ' + tc.y + ' H ' + tx, lx: mx, ly: (fc.y + tc.y) / 2 - 7 };
    }
    var fy2 = dy > 0 ? fr.y + fr.h : fr.y, ty2 = dy > 0 ? tr.y : tr.y + tr.h, my = (fy2 + ty2) / 2;
    if (Math.abs(dx) < 1) return { d: 'M' + fc.x + ' ' + fy2 + ' V ' + ty2, lx: fc.x + 12, ly: (fy2 + ty2) / 2 + 3, anchor: 'start' };
    return { d: 'M' + fc.x + ' ' + fy2 + ' V ' + my + ' H ' + tc.x + ' V ' + ty2, lx: tc.x, ly: my - 7 };
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
    });
    if (opts.grid) {
      var g = svg.append('g').attr('opacity', 0.6);
      for (var gx = 0; gx <= GW; gx++) g.append('line').attr('x1', px(gx)).attr('y1', 0).attr('x2', px(gx)).attr('y2', H).attr('stroke', 'var(--hair)').attr('stroke-width', 0.5);
      for (var gy = 0; gy <= GH; gy++) g.append('line').attr('x1', 0).attr('y1', px(gy)).attr('x2', W).attr('y2', px(gy)).attr('stroke', 'var(--hair)').attr('stroke-width', 0.5);
    }
    var byId = {}; (spec.shapes || []).forEach(function (s) { byId[s.id] = s; });
    (spec.connectors || []).forEach(function (c, i) {
      var F = byId[c.from], T = byId[c.to]; if (!F || !T) return;
      var col = c.color || 'secondary', p = connectorPath(F, T, c.route);
      svg.append('path').attr('d', p.d).attr('fill', 'none').attr('stroke', cvar(col)).attr('stroke-width', 1.7)
        .attr('marker-end', 'url(#' + uid + 'ar-' + col + ')').attr('stroke-dasharray', c.dash ? '5 4' : null);
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

  return { build: build, render: render, svgMarkup: svgMarkup, connectorPath: connectorPath, rectOf: rectOf, COLORS: COLORS, CELL: CELL, GW: GW, gridH: gridH };
})();
