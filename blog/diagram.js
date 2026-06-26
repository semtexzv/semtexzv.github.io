/* diagram.js — generic, data-driven topology renderer.
   Any <svg class="diagram" data-topology='{...}'> on the page is drawn from its
   JSON spec, so diagrams are editable as data (the blog editor emits this).
   Theme-aware: colours come from CSS vars, so it follows the dark/light toggle.

   spec = {
     viewBox: [0,0,760,200],
     nodes: [{ id, x, y, w, h, label, sub?, kind? ("accent"|"store") }],
     edges: [{ from, to, kind?("accent"|"flow"), dash?, label?, offset?, side?("start"|"end") }]
   }
*/
(function () {
  if (!window.d3) return;
  var seq = 0;

  function arrow(defs, id, colorVar) {
    defs.append('marker').attr('id', id).attr('markerWidth', 10).attr('markerHeight', 8)
      .attr('refX', 9).attr('refY', 4).attr('orient', 'auto').attr('markerUnits', 'userSpaceOnUse')
      .append('path').attr('d', 'M0,0 L9,4 L0,8 Z').attr('fill', 'var(' + colorVar + ')');
  }
  function crisp(s) { return s.attr('shape-rendering', 'crispEdges'); }
  var cx = function (n) { return n.x + n.w / 2; }, cy = function (n) { return n.y + n.h / 2; };

  function edgePath(F, T, e) {
    var off = e.offset || 0, gap = 4;
    if (e.route === 'over' || e.route === 'under') {     // back-edge routed above/below the row
      var up = e.route === 'over', rise = e.rise || 34;
      var y0 = up ? F.y : F.y + F.h, peak = up ? F.y - rise : F.y + F.h + rise, yEnd = up ? T.y : T.y + T.h;
      return 'M' + (cx(F) + off) + ' ' + y0 + ' V ' + peak + ' H ' + cx(T) + ' V ' + yEnd;
    }
    if (F.y === T.y) {                                   // horizontal
      var ltr = T.x >= F.x;
      var x1 = ltr ? F.x + F.w + gap : F.x - gap, x2 = ltr ? T.x : T.x + T.w, y = cy(F) + off;
      return 'M' + x1 + ' ' + y + ' H ' + x2;
    }
    if (F.x === T.x) {                                   // vertical
      var ttb = T.y >= F.y;
      var y1 = ttb ? F.y + F.h + gap : F.y - gap, y2 = ttb ? T.y : T.y + T.h, x = cx(F) + off;
      return 'M' + x + ' ' + y1 + ' V ' + y2;
    }
    // simple elbow: down/up out of F, across, into T
    var fx = cx(F) + off, tx = cx(T);
    var midY = (F.y > T.y) ? T.y + T.h + (F.y - (T.y + T.h)) / 2 : F.y + F.h + (T.y - (F.y + F.h)) / 2;
    var fy = (T.y >= F.y) ? F.y + F.h : F.y;
    var ty = (T.y >= F.y) ? T.y : T.y + T.h;
    return 'M' + fx + ' ' + fy + ' V ' + midY + ' H ' + tx + ' V ' + ty;
  }

  function render(el) {
    var spec;
    try { spec = JSON.parse(el.getAttribute('data-topology')); } catch (e) { return; }
    var svg = d3.select(el);
    svg.selectAll('*').remove();
    svg.attr('viewBox', (spec.viewBox || [0, 0, 760, 200]).join(' '));
    var p = 'dg' + (seq++) + '-';
    var defs = svg.append('defs');
    arrow(defs, p + 'a', '--accent'); arrow(defs, p + 'd', '--dim');

    var byId = {};
    (spec.nodes || []).forEach(function (n) { byId[n.id] = n; });

    (spec.edges || []).forEach(function (e) {
      var F = byId[e.from], T = byId[e.to]; if (!F || !T) return;
      var acc = e.kind === 'accent';
      var path = crisp(svg.append('path').attr('class', acc ? 'accent' : 'flow')
        .attr('d', edgePath(F, T, e)).attr('marker-end', 'url(#' + p + (acc ? 'a' : 'd') + ')'));
      if (e.dash) path.style('stroke-dasharray', '5 4');
      if (e.label) {
        var lx, ly, anchor = 'middle';
        if (e.route === 'over') { lx = (cx(F) + cx(T)) / 2; ly = F.y - (e.rise || 34) - 6; }
        else if (e.route === 'under') { lx = (cx(F) + cx(T)) / 2; ly = F.y + F.h + (e.rise || 34) + 14; }
        else if (F.y === T.y) { lx = (cx(F) + cx(T)) / 2; ly = cy(F) + (e.offset || 0) - 9; }
        else { var o = e.offset || 0; lx = cx(F) + o + (o < 0 ? -8 : 12); ly = (cy(F) + cy(T)) / 2 + 3; anchor = (o < 0 ? 'end' : 'start'); }
        svg.append('text').attr('class', acc ? 'lbl-acc' : 'lbl').attr('x', lx).attr('y', ly)
          .style('text-anchor', e.side || anchor).text(e.label);
      }
    });

    (spec.nodes || []).forEach(function (n) {
      var g = svg.append('g');
      var cls = n.kind === 'accent' ? 'node-accent' : (n.kind === 'store' ? 'store' : 'node');
      g.append('rect').attr('class', cls).attr('x', n.x).attr('y', n.y).attr('width', n.w).attr('height', n.h);
      g.append('text').attr('class', n.kind === 'accent' ? 't-acc' : 't')
        .attr('x', cx(n)).attr('y', n.y + n.h * (n.sub ? 0.40 : 0.5)).text(n.label);
      if (n.sub) g.append('text').attr('class', 'sub').attr('x', cx(n)).attr('y', n.y + n.h * 0.72).text(n.sub);
    });
  }

  window.renderDiagrams = function (root) {
    (root || document).querySelectorAll('svg.diagram[data-topology]').forEach(render);
  };
  if (document.readyState !== 'loading') window.renderDiagrams();
  else document.addEventListener('DOMContentLoaded', function () { window.renderDiagrams(); });
})();
