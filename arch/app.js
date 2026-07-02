/* app.js — arch-editor: a GRAPH-PRIMARY dataflow editor for transformer architectures.

   THE PRINCIPLE: the graph (nodes + edges) is the model; layout is a PURE FUNCTION of
   the graph; rendering flows from layout. Positions are DERIVED from topology — never
   authored. Every edit mutates the GRAPH, then layout re-runs and the view re-renders,
   so the picture is always a tidy, fully-connected graph.

      graph (nodes + edges)  ──layout(graph, dir)──▶  positions  ──render──▶  SVG

   Layout is a hand-rolled LAYERED (Sugiyama-style) DAG pass: longest-path ranking,
   barycenter ordering within ranks, a SPINE CONSTRAINT that pins the residual stream
   (in-slot · ⊕ Add merges · out-slot) to one dead-straight axis with branches in a side
   column, and an orthogonal slot-to-slot router so every residual/skip edge is ONE
   continuous connected wire terminating exactly on its slot. Arrays render at the
   parent as ONE collapsed node (×N badge); descending opens the virtual-repeat
   interior. The canvas is a CAMERA (a translate/scale <g>) that centres the content on
   navigation and pans by dragging empty space.

   POSITIONS ARE AUTHORED: the derived layout only SEEDS a level — the first render
   bakes it into the document (`ui: {x,y}` per node), and from then on nodes stay
   exactly where the user puts them. Drags persist, palette drops land under the
   cursor, and edits never reshuffle the rest of the graph or move the camera.
   `✷ tidy` clears a level's authored positions and re-derives. In chain levels the
   edge sequence follows the nodes' vertical order; wires always re-route to follow.

   Data: types.json (op registry) + examples/gqa.json (default IR), fetched at boot —
   single source of truth, no inline copies. No build step, no runtime dependencies.
   Tests: `npm test` (contract in test/TESTS.md). */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var MONO = 'ui-monospace,"SF Mono",Menlo,monospace';

  /* ============================================================ DATA
     Single source of truth: types.json (registry) + examples/gqa.json (default IR),
     fetched at boot. Serve over http (`npm run serve`) — file:// cannot fetch. */
  var REG = null;   // op registry (roles, types, palette)
  var IR = null;    // the current document — an architecture IR

  /* ============================================================ GEOMETRY */
  var SZ = {
    ioW: 64, ioH: 30,
    cardW: 214, cardH: 56,
    rcardW: 150, rcardH: 54,
    mergeR: 21,
    spineX: 180,        // cross-axis position of the residual spine (dir=down)
    branchOffset: 214,  // spineX → centre of the first branch column
    branchColGap: 244,
    rankGapDown: 38,    // gap between consecutive rank slots (edge→edge), dir=down
    colGapRight: 60,    // gap between columns, dir=right
    rowGapRight: 26,
    margin: 54,
    snapR: 12           // wire corner radius
  };

  /* ============================================================ STATE */
  var App = {
    nav: [],          // [{ type, group, key, crumbs:[{label,to}], ... }]
    selected: null,   // { kind:'node'|'wire', id }
    counter: 0,
    ports: {},        // ports[id+'|'+io+'|'+name] = {x,y,side,role,name}
    nodeById: {},
    drag: null,       // { id, x, y } transient visual override during a drag
    cam: { panX: 0, panY: 0, zoom: 1 },   // the CAMERA: content <g> transform translate(pan)·scale(zoom)
    _lastClick: null,
    _lastEmptyTap: 0,
    _suppressClick: false   // swallow the synthetic click that trails a drag (so a drop can't navigate)
  };

  /* ============================================================ SMALL HELPERS */
  function el(id) { return document.getElementById(id); }
  function dims() { return (IR && IR.dims) || {}; }
  function reg(node) { return (node && REG.types[node.type || node.ref]) || null; }
  function roleColor(role) { var r = REG.roles[role]; return "var(--dg-" + ((r && r.color) || "secondary") + ")"; }
  function tint(role, pct) { return "color-mix(in srgb, " + roleColor(role) + " " + pct + "%, transparent)"; }
  function cur() { return App.nav[App.nav.length - 1]; }
  function isNum(v) { return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))); }

  function mk(tag, attrs, kids) {
    var e = document.createElementNS(NS, tag), a = attrs || {};
    for (var k in a) {
      if (k === "style") { for (var s in a.style) e.style[s] = a.style[s]; }
      else if (a[k] != null) e.setAttribute(k, a[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag), a = attrs || {};
    for (var k in a) {
      if (k === "style") { for (var s in a.style) e.style[s] = a.style[s]; }
      else if (k === "text") e.textContent = a[k];
      else if (k === "html") e.innerHTML = a[k];
      else if (a[k] != null) e.setAttribute(k, a[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function txt(s, attrs) { var t = mk("text", attrs); t.textContent = s; return t; }

  function resolve(v) {
    if (typeof v !== "string") return v;
    if (v[0] === "$") { var d = dims()[v.slice(1)]; return d == null ? v : d; }
    return v;
  }
  function fmtNum(v) {
    if (typeof v !== "number") return v;
    if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential();
    return String(v);
  }

  /* ============================================================ ICONS (line-drawn) */
  var ICON = {
    embed: [["rect", { x: 4, y: 4, width: 16, height: 16, rx: 2 }], ["line", { x1: 12, y1: 4, x2: 12, y2: 20 }],
            ["line", { x1: 4, y1: 12, x2: 20, y2: 12 }], ["rect", { x: 5.2, y: 5.2, width: 5.6, height: 5.6, rx: 1, fill: "f" }]],
    norm: [["line", { x1: 7, y1: 5, x2: 7, y2: 19 }], ["line", { x1: 17, y1: 5, x2: 17, y2: 19 }], ["circle", { cx: 12, cy: 12, r: 1.7, fill: "f" }]],
    linear: [["rect", { x: 5, y: 5, width: 14, height: 14, rx: 2 }], ["path", { d: "M8.5 15.5 L15.5 8.5" }], ["path", { d: "M11.5 8.5 H15.5 V12.5" }]],
    matmul: [["circle", { cx: 12, cy: 12, r: 7.5 }], ["line", { x1: 7.3, y1: 7.3, x2: 16.7, y2: 16.7 }], ["line", { x1: 16.7, y1: 7.3, x2: 7.3, y2: 16.7 }]],
    add: [["circle", { cx: 12, cy: 12, r: 7.5 }], ["line", { x1: 12, y1: 7, x2: 12, y2: 17 }], ["line", { x1: 7, y1: 12, x2: 17, y2: 12 }]],
    mul: [["circle", { cx: 12, cy: 12, r: 7.5 }], ["circle", { cx: 12, cy: 12, r: 1.9, fill: "f" }]],
    scale: [["path", { d: "M6 17 L18 7 L18 17 Z" }], ["line", { x1: 5, y1: 17, x2: 19, y2: 17 }]],
    softmax: [["line", { x1: 5, y1: 18, x2: 19, y2: 18 }], ["line", { x1: 8, y1: 18, x2: 8, y2: 14 }],
              ["line", { x1: 12, y1: 18, x2: 12, y2: 8 }], ["line", { x1: 16, y1: 18, x2: 16, y2: 12 }]],
    act: [["path", { d: "M5 17 C9 17 8.5 11.5 12 11.5 C15.5 11.5 15 6.5 19 6.5" }]],
    rope: [["path", { d: "M16.8 8.4 A6 6 0 1 0 18 13" }], ["path", { d: "M14 5.6 L17.2 7.8 L15.4 11" }]],
    attn: [["rect", { x: 4.5, y: 4.5, width: 15, height: 15, rx: 2 }], ["line", { x1: 9.5, y1: 4.5, x2: 9.5, y2: 19.5 }],
           ["line", { x1: 14.5, y1: 4.5, x2: 14.5, y2: 19.5 }], ["line", { x1: 4.5, y1: 9.5, x2: 19.5, y2: 9.5 }],
           ["line", { x1: 4.5, y1: 14.5, x2: 19.5, y2: 14.5 }], ["rect", { x: 5, y: 5, width: 4, height: 4, fill: "f" }],
           ["rect", { x: 10, y: 10, width: 4, height: 4, fill: "f" }], ["rect", { x: 15, y: 15, width: 4, height: 4, fill: "f" }]],
    mlp: [["circle", { cx: 7, cy: 7, r: 1.5, fill: "f" }], ["circle", { cx: 7, cy: 12, r: 1.5, fill: "f" }], ["circle", { cx: 7, cy: 17, r: 1.5, fill: "f" }],
          ["circle", { cx: 17, cy: 9.5, r: 1.5, fill: "f" }], ["circle", { cx: 17, cy: 14.5, r: 1.5, fill: "f" }],
          ["path", { d: "M8.5 7 L15.5 9.5 M8.5 12 L15.5 9.5 M8.5 12 L15.5 14.5 M8.5 17 L15.5 14.5" }]],
    block: [["rect", { x: 5, y: 6, width: 14, height: 3.2, rx: 1.4 }], ["rect", { x: 5, y: 10.4, width: 14, height: 3.2, rx: 1.4 }], ["rect", { x: 5, y: 14.8, width: 14, height: 3.2, rx: 1.4 }]]
  };
  function iconEl(kind, color, glyph) {
    var spec = ICON[kind];
    if (!spec) {
      var t = txt(glyph || "•", { x: 12, y: 12, "text-anchor": "middle", "dominant-baseline": "central", "font-family": MONO, "font-size": 12, style: { fill: color } });
      return mk("g", { transform: "scale(0.92)" }, [t]);
    }
    var kids = spec.map(function (p) {
      var attrs = {}, src = p[1];
      for (var k in src) { if (k !== "fill") attrs[k] = src[k]; }
      attrs.style = { stroke: color, "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", fill: src.fill === "f" ? color : "none" };
      return mk(p[0], attrs);
    });
    return mk("g", null, kids);
  }

  /* ============================================================ SUBLABELS */
  function subOf(node) {
    var t = node.type || node.ref, p = node.params || {}, d = dims();
    switch (t) {
      case "TokenEmbedding": return "d " + resolve(p.d != null ? p.d : "$d") + " · vocab " + resolve(p.vocab != null ? p.vocab : "$vocab");
      case "Unembedding": return "+ softmax" + (p.tie ? " · tie " + p.tie : "");
      case "RMSNorm": case "LayerNorm": return p.eps != null ? "eps " + fmtNum(p.eps) : "[B,T,d]";
      case "Linear": return p.out != null ? "out " + p.out : "affine";
      case "MatMul": return (p.transpose_b ? "Bᵀ" : "A·B") + (p.scale ? " · " + (p.scale === "1/sqrt(d_head)" ? "1/√d_head" : p.scale) : "");
      case "Add": return "residual join";
      case "Mul": return "gate ⊙";
      case "Scale": return p.factor != null ? "× " + p.factor : "scalar";
      case "Softmax": return "axis " + (p.axis != null ? p.axis : -1);
      case "SiLU": return "x·σ(x)";
      case "GELU": return "gaussian";
      case "Rope": return p.theta != null ? "θ " + fmtNum(p.theta) : "rotary";
      case "Attention": return (p.kind || "mha") + " · n_q" + (p.n_q != null ? p.n_q : "?") + " n_kv" + (p.n_kv != null ? p.n_kv : "?");
      case "SwiGLU": return "mlp · ×" + (p.mult != null ? p.mult : d.ffn_mult || 4);
      case "Block": return "norm→attn→mlp";
      default: return "";
    }
  }

  /* ============================================================ NODE FACTORY (palette → IR) */
  function defaultParams(r) {
    var out = {};
    for (var k in (r.params || {})) {
      var t = r.params[k];
      if (t === "int") out[k] = 0;
      else if (t === "float") out[k] = 1e-5;
      else if (t === "bool") out[k] = false;
      else if (t.indexOf("enum:") === 0) out[k] = t.slice(5).split("|")[0];
      else out[k] = "";
    }
    return out;
  }
  /* every id in the document (all levels + repeat bodies) + the view's pseudo ids —
     new nodes must be GLOBALLY unique or selection/delete/wiring hit the wrong node
     (the default IR already uses "n1"/"n2", so a counter alone collides). */
  function allIds(node, set) {
    if (!node) return set;
    set[node.id] = 1;
    (node.children || []).forEach(function (c) { allIds(c, set); });
    if (node.body) allIds(node.body, set);
    return set;
  }
  function newNode(type) {
    var r = REG.types[type]; if (!r) return null;
    var used = allIds(IR.root, { x: 1, x_in: 1, x_out: 1, tokens: 1, logits: 1, gprev: 1, gnext: 1, inst: 1 });
    var base = type.toLowerCase(), n = 1;
    while (used[base + n]) n++;
    var id = base + n;
    var node = { id: id, params: defaultParams(r) };
    if (r.composite) { node.kind = "group"; node.ref = type; node.flow = "graph"; node.children = []; node.edges = []; node.ports = { in: r.in.slice(), out: r.out.slice() }; }
    else { node.kind = "cell"; node.type = type; }
    return node;
  }
  function portsOf(node) {
    var r = reg(node);
    var ins = (r && r.in) || (node.ports && node.ports.in) || [{ name: "in", role: "hidden" }];
    var outs = (r && r.out) || (node.ports && node.ports.out) || [{ name: "out", role: "hidden" }];
    return { in: ins, out: outs };
  }
  function childById(group, id) { return (group.children || []).filter(function (c) { return c.id === id; })[0]; }
  function blockBody() { var t = childById(IR.root, "trunk"); return t && t.body; }
  function openKind(c) {
    if (c.kind === "repeat") return "array";
    if (c.ref === "Attention" || c.ref === "SwiGLU") return "graph";
    if (c.ref === "Block") return "block";
    return null;
  }

  /* ============================================================ GRAPH NODE BUILDERS
     Each navigation level is COMPILED into a graph: { dir, nodes, edges, outId, spine, ... }.
     A graph node = { id, kind:'card'|'merge'|'io', w, h, spine, ghost, title, sub, icon,
                      glyph, role, ins:[{name,role}], outs:[...], irNode, openTo, openNode,
                      badge, special, repeatRef, selectable }. */

  function cardFromChild(c, opts) {
    var r = reg(c) || REG.types.Linear, pp = portsOf(c);
    return {
      id: c.id, kind: "card", w: opts.w, h: opts.h, spine: !!opts.spine, ghost: !!opts.ghost,
      title: r.label, sub: subOf(c), icon: r.icon, glyph: r.glyph,
      role: (pp.out[0] || {}).role || "hidden", ins: pp.in, outs: pp.out, irNode: c,
      selectable: !opts.ghost, openTo: opts.openTo, openNode: opts.openNode,
      badge: opts.badge, special: opts.special, repeatRef: opts.repeatRef
    };
  }
  function mergeNode(c) {
    var r = REG.types.Add;
    return { id: c.id, kind: "merge", w: SZ.mergeR * 2, h: SZ.mergeR * 2, spine: true,
      title: "⊕", glyph: "⊕", icon: "add", role: "resid", ins: r.in, outs: r.out,
      irNode: c, selectable: true, sub: "residual join" };
  }
  function ioIn(id, role, title, sub, portName) {
    return { id: id, kind: "io", w: SZ.ioW, h: SZ.ioH, role: role, title: title, sub: sub, spine: true,
      ins: [], outs: [{ name: portName || "x", role: role }], selectable: false };
  }
  function ioOut(id, role, title, sub, portName) {
    return { id: id, kind: "io", w: SZ.ioW, h: SZ.ioH, role: role, title: title, sub: sub, spine: true,
      ins: [{ name: portName || "x", role: role }], outs: [], selectable: false };
  }
  function instCard(id, body, opts) {
    var r = REG.types.Block, bp = (body && body.ports) || { in: [{ name: "x", role: "resid" }], out: [{ name: "x", role: "resid" }] };
    return { id: id, kind: "card", w: SZ.cardW, h: SZ.cardH, spine: true, ghost: !!opts.ghost,
      title: r.label, sub: opts.sub, icon: r.icon, glyph: r.glyph, role: "resid",
      ins: bp.in, outs: bp.out, irNode: body, selectable: !opts.ghost,
      openTo: opts.openTo, openNode: body, badge: opts.badge, special: opts.special, repeatRef: opts.repeatRef };
  }
  function trunkCard(c) {
    var body = c.body, bp = (body && body.ports) || { in: [{ name: "x", role: "resid" }], out: [{ name: "x", role: "resid" }] };
    var r = REG.types.Block;
    return { id: c.id, kind: "card", w: SZ.cardW, h: SZ.cardH, spine: true,
      title: r.label, sub: "norm→attn→mlp", icon: r.icon, glyph: r.glyph, role: "resid",
      ins: bp.in, outs: bp.out, irNode: c, selectable: true,
      openTo: "array", repeatRef: c, special: "repeat", badge: "×" + c.count };
  }

  function chainEdge(f, t, map, extra) {
    var sn = map[f], tn = map[t];
    var fp = (sn.outs[0] || {}).name || "y", tp = (tn.ins[0] || {}).name || "x";
    var role = (sn.outs[0] || {}).role || "resid";
    var e = { from: f, fromPort: fp, to: t, toPort: tp, role: role };
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  /* ---- ROOT: clean linear dataflow tokens → emb → Trunk(×N) → norm → unembed → logits ---- */
  function deriveRoot() {
    var g = IR.root, nodes = [], seq = [];
    nodes.push(ioIn("tokens", "tokens", "tokens", "[B,T]", "tokens")); seq.push("tokens");
    (g.children || []).forEach(function (c) {
      if (c.kind === "repeat") nodes.push(trunkCard(c));
      else nodes.push(cardFromChild(c, { w: SZ.cardW, h: SZ.cardH, spine: true, selectable: true, openTo: openKind(c), openNode: c }));
      seq.push(c.id);
    });
    nodes.push(ioOut("logits", "logits", "logits", "[B,T,vocab]", "logits")); seq.push("logits");
    var map = {}; nodes.forEach(function (n) { map[n.id] = n; });
    var edges = [];
    for (var i = 0; i < seq.length - 1; i++) edges.push(chainEdge(seq[i], seq[i + 1], map));
    return { dir: "down", nodes: nodes, edges: edges, outId: "logits", spine: true, persist: true,
      decos: function (svg, G) {
        var tk = G.nodeMap.tokens;
        label(svg, tk.x - 12, tk.y + tk.h / 2, "in", "secondary", "end");
      } };
  }

  /* ---- ARRAY interior: scrollable virtual-repeat (boundary-in → ghost/inst/ghost → boundary-out) ---- */
  function deriveArray(level) {
    var trunk = level.group, body = level.body, N = trunk.count;
    var nodes = [
      ioIn("x_in", "resid", "x", "boundary in", "x"),
      instCard("gprev", body, { ghost: true, sub: "norm→attn→mlp" }),
      instCard("inst", body, { ghost: false, sub: "norm→attn→mlp", badge: "×" + N, openTo: "block", special: "repeat", repeatRef: trunk }),
      instCard("gnext", body, { ghost: true, sub: "norm→attn→mlp" }),
      ioOut("x_out", "resid", "x", "boundary out", "x")
    ];
    var seq = ["x_in", "gprev", "inst", "gnext", "x_out"];
    var map = {}; nodes.forEach(function (n) { map[n.id] = n; });
    var edges = [];
    for (var i = 0; i < seq.length - 1; i++) edges.push(chainEdge(seq[i], seq[i + 1], map, { label: "x", carry: true }));
    return { dir: "down", nodes: nodes, edges: edges, outId: "x_out", spine: true, leftLabels: true, sideLabels: true,
      decos: function (svg, G) {
        var xi = G.nodeMap.x_in, xo = G.nodeMap.x_out, gp = G.nodeMap.gprev, ins = G.nodeMap.inst, gn = G.nodeMap.gnext;
        label(svg, xi.x + xi.w + 20, xi.y + xi.h / 2, "init · x ← emb", "accent1", "start");
        label(svg, xo.x + xo.w + 20, xo.y + xo.h / 2, "final · x → finalnorm", "accent1", "start");
        label(svg, gp.x - 16, gp.y + gp.h / 2, "i−1", "secondary", "end");
        label(svg, ins.x - 16, ins.y + ins.h / 2, "i", "accent1", "end");
        label(svg, gn.x - 16, gn.y + gn.h / 2, "i+1", "secondary", "end");
        label(svg, ins.x + ins.w + 20, ins.y + ins.h / 2 + 16, "carry · x ⟳", "secondary", "start");
      } };
  }

  /* ---- BLOCK: straight residual spine + branches that merge into on-spine ⊕ ---- */
  function deriveBlock(level) {
    var b = level.group, nodes = [];
    nodes.push(ioIn("x_in", "resid", "x", "resid in", "x"));
    (b.children || []).forEach(function (c) {
      if (c.type === "Add") nodes.push(mergeNode(c));
      else nodes.push(cardFromChild(c, { w: SZ.cardW, h: SZ.cardH, spine: false, selectable: true, openTo: openKind(c), openNode: c }));
    });
    nodes.push(ioOut("x_out", "resid", "x", "resid out", "x"));
    var map = {}; nodes.forEach(function (n) { map[n.id] = n; });
    var edges = explicitEdges(b, map);
    return { dir: "down", nodes: nodes, edges: edges, outId: "x_out", spine: true, persist: true,
      decos: function (svg, G) {
        var xi = G.nodeMap.x_in;
        label(svg, xi.x - 16, xi.y + xi.h / 2, "spine", "accent1", "end");
      } };
  }

  /* ---- GRAPH (dir=right): Attention / SwiGLU — layered left → right ---- */
  function deriveGraphLevel(level) {
    var group = level.group, nodes = [];
    var inP = (group.ports && group.ports.in && group.ports.in[0]) || { name: "x", role: "resid" };
    var outP = (group.ports && group.ports.out && group.ports.out[0]) || { name: "x", role: "resid" };
    nodes.push({ id: "x_in", kind: "io", w: SZ.ioW, h: SZ.ioH, role: inP.role, title: "x", sub: "in", spine: false, ins: [], outs: [{ name: inP.name || "x", role: inP.role }], selectable: false });
    (group.children || []).forEach(function (c) {
      nodes.push(cardFromChild(c, { w: SZ.rcardW, h: SZ.rcardH, spine: false, selectable: true, openTo: openKind(c), openNode: c }));
    });
    nodes.push({ id: "x_out", kind: "io", w: SZ.ioW, h: SZ.ioH, role: outP.role, title: "x", sub: "out", spine: false, ins: [{ name: outP.name || "x", role: outP.role }], outs: [], selectable: false });
    var map = {}; nodes.forEach(function (n) { map[n.id] = n; });
    var edges = explicitEdges(group, map);
    return { dir: "right", nodes: nodes, edges: edges, outId: "x_out", spine: false, persist: true,
      decos: function (svg, G) {
        label(svg, G.W / 2, 18, (level.title || "graph") + " · left → right", "accent1", "middle");
      } };
  }

  function explicitEdges(group, map) {
    var edges = [];
    (group.edges || []).forEach(function (e) {
      var f = e.from.node === "x" ? "x_in" : e.from.node, t = e.to.node === "x" ? "x_out" : e.to.node;
      if (!map[f] || !map[t]) return;
      var fp = e.from.port || (map[f].outs[0] || {}).name, tp = e.to.port || (map[t].ins[0] || {}).name;
      var fo = map[f].outs.filter(function (o) { return o.name === fp; })[0] || map[f].outs[0] || {};
      edges.push({ from: f, fromPort: fp, to: t, toPort: tp, role: fo.role || "hidden", kind: e.kind, skip: e.kind === "skip" });
    });
    return edges;
  }

  /* ============================================================ LAYOUT ENGINE
     Hand-rolled layered DAG layout. Positions are a PURE FUNCTION of (nodes, edges, dir). */

  function buildAdj(G) {
    var adj = {}; G.nodes.forEach(function (n) { adj[n.id] = []; });
    G.edges.forEach(function (e) { if (adj[e.from] && adj[e.to]) { adj[e.from].push(e.to); adj[e.to].push(e.from); } });
    return adj;
  }
  /* longest-path layering from the source port(s): sources at rank 0, sinks deepest. */
  function rankNodes(G) {
    var ids = G.nodes.map(function (n) { return n.id; });
    var succ = {}, indeg = {};
    ids.forEach(function (id) { succ[id] = []; indeg[id] = 0; });
    G.edges.forEach(function (e) { if (succ[e.from] && indeg[e.to] != null) { succ[e.from].push(e.to); indeg[e.to]++; } });
    var ind = {}; ids.forEach(function (id) { ind[id] = indeg[id]; });
    var q = ids.filter(function (id) { return ind[id] === 0; });
    var rank = {}; ids.forEach(function (id) { rank[id] = 0; });
    var guard = 0;
    while (q.length && guard++ < 9999) {
      var n = q.shift();
      succ[n].forEach(function (m) { if (rank[m] < rank[n] + 1) rank[m] = rank[n] + 1; if (--ind[m] === 0) q.push(m); });
    }
    return rank;
  }

  /* spine layout (dir=down): rank → y, spine pinned to one x, branches in side columns. */
  function layoutSpine(G) {
    var rank = rankNodes(G), maxR = 0;
    G.nodes.forEach(function (n) { maxR = Math.max(maxR, rank[n.id]); });
    if (G.outId && rank[G.outId] != null) rank[G.outId] = maxR;          // pin boundary out to last rank
    maxR = 0; G.nodes.forEach(function (n) { maxR = Math.max(maxR, rank[n.id]); });

    var byRank = {}; for (var r = 0; r <= maxR; r++) byRank[r] = [];
    G.nodes.forEach(function (n) { n._rank = rank[n.id]; byRank[n._rank].push(n); });

    // main axis (Y): stack ranks by max card height + consistent gap; node centres aligned per rank.
    var y = SZ.margin, cyOf = {};
    for (var rr = 0; rr <= maxR; rr++) {
      var hmax = 0; byRank[rr].forEach(function (n) { hmax = Math.max(hmax, n.h); });
      if (!byRank[rr].length) hmax = SZ.cardH;
      cyOf[rr] = y + hmax / 2; y += hmax + SZ.rankGapDown;
    }
    // cross axis (X): spine nodes → spineX; branch nodes ordered out from the spine by barycenter.
    var adj = buildAdj(G), cxOf = {};
    G.nodes.forEach(function (n) { cxOf[n.id] = n.spine ? SZ.spineX : SZ.spineX + SZ.branchOffset; });
    for (var sweep = 0; sweep < 2; sweep++) {
      for (var k = 0; k <= maxR; k++) {
        var branches = byRank[k].filter(function (n) { return !n.spine; });
        branches.forEach(function (n) {
          var s = 0, c = 0; adj[n.id].forEach(function (m) { if (cxOf[m] != null && !G.nodeMap[m].spine) { s += cxOf[m]; c++; } });
          n._bary = c ? s / c : cxOf[n.id];
        });
        branches.sort(function (a, b) { return a._bary - b._bary; });
        branches.forEach(function (n, i) { cxOf[n.id] = SZ.spineX + SZ.branchOffset + i * SZ.branchColGap; });
      }
    }
    G.nodes.forEach(function (n) { n.x = cxOf[n.id] - n.w / 2; n.y = cyOf[n._rank] - n.h / 2; });
    return finalizeBox(G, { l: 60, r: 80, t: 46, b: 56 });
  }

  /* flow layout (dir=right): rank → x columns, barycenter row order, vertically centred. */
  function layoutFlow(G) {
    var rank = rankNodes(G), maxR = 0;
    G.nodes.forEach(function (n) { maxR = Math.max(maxR, rank[n.id]); });
    if (G.outId && rank[G.outId] != null) rank[G.outId] = maxR;
    maxR = 0; G.nodes.forEach(function (n) { maxR = Math.max(maxR, rank[n.id]); });

    var byRank = {}; for (var r = 0; r <= maxR; r++) byRank[r] = [];
    G.nodes.forEach(function (n) { n._rank = rank[n.id]; byRank[n._rank].push(n); });

    var x = SZ.margin, cxOf = {};
    for (var rr = 0; rr <= maxR; rr++) {
      var wmax = 0; byRank[rr].forEach(function (n) { wmax = Math.max(wmax, n.w); });
      if (!byRank[rr].length) wmax = SZ.rcardW;
      cxOf[rr] = x + wmax / 2; x += wmax + SZ.colGapRight;
    }
    function colH(list) { var hh = 0; list.forEach(function (n) { hh += n.h; }); return hh + Math.max(0, list.length - 1) * SZ.rowGapRight; }
    var H = 0; for (var c = 0; c <= maxR; c++) H = Math.max(H, colH(byRank[c]));
    H += SZ.margin * 2;
    var pos = {};
    function place() {
      for (var c2 = 0; c2 <= maxR; c2++) {
        var list = byRank[c2], yy = (H - colH(list)) / 2;
        list.forEach(function (n) { pos[n.id] = yy + n.h / 2; yy += n.h + SZ.rowGapRight; });
      }
    }
    place();
    var adj = buildAdj(G);
    for (var sweep = 0; sweep < 4; sweep++) {
      for (var k = 0; k <= maxR; k++) {
        var list = byRank[k];
        list.forEach(function (n) {
          var s = 0, cc = 0; adj[n.id].forEach(function (m) { if (pos[m] != null) { s += pos[m]; cc++; } });
          n._bary = cc ? s / cc : pos[n.id];
        });
        list.sort(function (a, b) { return a._bary - b._bary; });
        place();
      }
    }
    G.nodes.forEach(function (n) { n.x = cxOf[n._rank] - n.w / 2; n.y = pos[n.id] - n.h / 2; });
    return finalizeBox(G, { l: 44, r: 44, t: 40, b: 52 });
  }

  /* ---- authored positions ----
     Layout only SEEDS positions: the first render of a level bakes the derived spots
     into the document (irNode.ui, or group.ui[id] for io/pseudo nodes) and from then
     on every node stays exactly where the user puts it — drags persist, drops land
     under the cursor, and edits never reshuffle the rest of the graph. `✷ tidy`
     clears the level's authored positions and re-derives a fresh layout. Array
     interiors stay fully derived (nothing to author there). */
  function snapGrid(v) { return Math.round(v / 8) * 8; }
  function storedPos(N) {
    if (N.ghost) return null;
    var u = N.irNode ? N.irNode.ui : (cur().group.ui || {})[N.id];
    return u && typeof u.x === "number" ? u : null;
  }
  function setStoredPos(N, cx, cy) {
    if (N.ghost) return;
    var u = { x: snapGrid(cx), y: snapGrid(cy) };
    if (N.irNode) N.irNode.ui = u;
    else { var g = cur().group; g.ui = g.ui || {}; g.ui[N.id] = u; }
  }

  function finalizeBox(G, pad) {
    if (G.leftLabels) pad.l = Math.max(pad.l, 96);
    if (G.sideLabels) pad.r = Math.max(pad.r, 188);
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    G.nodes.forEach(function (n) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); });
    var ox = pad.l - minX, oy = pad.t - minY;
    G.nodes.forEach(function (n) { n.x += ox; n.y += oy; });
    // authored positions win over the derived seed (and the seed is baked on first sight)
    if (G.persist) G.nodes.forEach(function (n) {
      if (n.ghost) return;
      if (!storedPos(n)) setStoredPos(n, n.x + n.w / 2, n.y + n.h / 2);
      var p = storedPos(n);
      n.x = p.x - n.w / 2; n.y = p.y - n.h / 2;
    });
    // transient drag override — live visual while the pointer is down; committed on drop.
    if (App.drag && G.nodeMap[App.drag.id]) {
      var dn = G.nodeMap[App.drag.id]; dn.x = App.drag.x - dn.w / 2; dn.y = App.drag.y - dn.h / 2;
    }
    G.nodes.forEach(function (n) { computePorts(n, G.dir); });
    // bbox from FINAL positions — authored nodes can sit anywhere
    minX = 1e9; minY = 1e9; maxX = -1e9; maxY = -1e9;
    G.nodes.forEach(function (n) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); });
    G.W = (maxX - minX) + pad.l + pad.r;
    G.H = (maxY - minY) + pad.t + pad.b;
    return G;
  }

  /* ---- port geometry: exact slot points + the side each port faces ---- */
  function computePorts(N, dir) {
    N._in = []; N._out = [];
    var cx = N.x + N.w / 2, cy = N.y + N.h / 2;
    if (N.kind === "merge") {
      N.ins.forEach(function (s) {
        var pt = s.name === "b" ? { x: cx, y: N.y, side: "top" } : { x: N.x + N.w, y: cy, side: "right" };
        store(N, "in", s, pt);
      });
      N.outs.forEach(function (s) { store(N, "out", s, { x: cx, y: N.y + N.h, side: "bottom" }); });
      return;
    }
    if (N.kind === "io") {
      N.ins.forEach(function (s) { store(N, "in", s, dir === "right" ? { x: N.x, y: cy, side: "left" } : { x: cx, y: N.y, side: "top" }); });
      N.outs.forEach(function (s) { store(N, "out", s, dir === "right" ? { x: N.x + N.w, y: cy, side: "right" } : { x: cx, y: N.y + N.h, side: "bottom" }); });
      return;
    }
    if (dir === "right") { spread(N, "in", N.ins, "left"); spread(N, "out", N.outs, "right"); }
    else { spread(N, "in", N.ins, "top"); spread(N, "out", N.outs, "bottom"); }
  }
  function spread(N, io, list, side) {
    var n = list.length;
    for (var i = 0; i < n; i++) {
      var f = (i + 1) / (n + 1), pt;
      if (side === "top") pt = { x: N.x + N.w * f, y: N.y, side: "top" };
      else if (side === "bottom") pt = { x: N.x + N.w * f, y: N.y + N.h, side: "bottom" };
      else if (side === "left") pt = { x: N.x, y: N.y + N.h * f, side: "left" };
      else pt = { x: N.x + N.w, y: N.y + N.h * f, side: "right" };
      store(N, io, list[i], pt);
    }
  }
  function store(N, io, s, pt) {
    pt.role = s.role; pt.name = s.name;
    (io === "in" ? N._in : N._out).push(pt);
    App.ports[N.id + "|" + io + "|" + s.name] = pt;
  }

  /* ============================================================ ORTHOGONAL ROUTER */
  function sideN(side) { return side === "top" ? [0, -1] : side === "bottom" ? [0, 1] : side === "left" ? [-1, 0] : [1, 0]; }
  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function unit(dx, dy) { var l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; }
  function cleanPts(pts) {
    var out = [];
    pts.forEach(function (p) { var q = out[out.length - 1]; if (!q || Math.abs(q.x - p.x) > 0.01 || Math.abs(q.y - p.y) > 0.01) out.push(p); });
    if (out.length <= 2) return out;
    var res = [out[0]];
    for (var i = 1; i < out.length - 1; i++) {
      var a = res[res.length - 1], b = out[i], c = out[i + 1];
      var cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) > 0.5) res.push(b);
    }
    res.push(out[out.length - 1]);
    return res;
  }
  function roundedPath(pts, r) {
    pts = cleanPts(pts);
    if (pts.length < 2) return "";
    if (pts.length === 2) return "M " + pts[0].x + " " + pts[0].y + " L " + pts[1].x + " " + pts[1].y;
    var d = "M " + pts[0].x + " " + pts[0].y;
    for (var i = 1; i < pts.length - 1; i++) {
      var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      var v1 = unit(p1.x - p0.x, p1.y - p0.y), v2 = unit(p2.x - p1.x, p2.y - p1.y);
      var rr = Math.min(r, dist(p0, p1) / 2, dist(p1, p2) / 2);
      var pa = { x: p1.x - v1.x * rr, y: p1.y - v1.y * rr }, pb = { x: p1.x + v2.x * rr, y: p1.y + v2.y * rr };
      d += " L " + pa.x + " " + pa.y + " Q " + p1.x + " " + p1.y + " " + pb.x + " " + pb.y;
    }
    var last = pts[pts.length - 1];
    d += " L " + last.x + " " + last.y;
    return d;
  }
  /* route a → b orthogonally, leaving/entering along each slot's outward normal. */
  function route(a, b) {
    var na = sideN(a.side), nb = sideN(b.side), s = 18;
    var a1 = { x: a.x + na[0] * s, y: a.y + na[1] * s }, b1 = { x: b.x + nb[0] * s, y: b.y + nb[1] * s };
    var pts = [{ x: a.x, y: a.y }, a1];
    var aV = na[0] === 0, bV = nb[0] === 0;
    if (aV && bV) { var my = (a1.y + b1.y) / 2; pts.push({ x: a1.x, y: my }, { x: b1.x, y: my }); }
    else if (!aV && !bV) { var mx = (a1.x + b1.x) / 2; pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y }); }
    else if (aV) pts.push({ x: a1.x, y: b1.y });
    else pts.push({ x: b1.x, y: a1.y });
    pts.push(b1, { x: b.x, y: b.y });
    return roundedPath(pts, SZ.snapR);
  }

  /* ============================================================ DRAW */
  function drawWire(svg, e, G) {
    var a = App.ports[e.from + "|out|" + e.fromPort], b = App.ports[e.to + "|in|" + e.toPort];
    if (!a || !b) return;
    var sp = G.nodeMap[e.from], tp = G.nodeMap[e.to];
    var isSpine = sp && tp && sp.spine && tp.spine;          // continuous residual spine segment
    // spine→spine segments always draw in the residual colour so the stream reads as one
    // continuous ribbon, even where the source port's role is 'hidden' (e.g. norm → head).
    var d = route(a, b), col = roleColor(isSpine ? "resid" : e.role);
    var id = e.from + ":" + e.fromPort + ">" + e.to + ":" + e.toPort;
    var sel = App.selected && App.selected.kind === "wire" && App.selected.id === id;
    var dim = (sp && sp.ghost) || (tp && tp.ghost);
    var residual = isSpine || e.skip || e.kind === "skip";
    var g = mk("g", { "data-wire": id, "data-edge": id, "data-from": e.from, "data-to": e.to, "data-spine": isSpine ? "1" : null, "data-residual": residual ? "true" : null, class: "dg-wire" });
    if (isSpine) g.appendChild(mk("path", { d: d, fill: "none", style: { stroke: col, "stroke-width": 7, "stroke-opacity": 0.14, "stroke-linecap": "round", "stroke-linejoin": "round" } }));
    g.appendChild(mk("path", { d: d, fill: "none", style: { stroke: col, "stroke-width": sel ? 3.4 : (isSpine ? 3 : 2), "stroke-opacity": dim ? 0.32 : (isSpine ? 1 : 0.85), "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": e.carry && dim ? "5 5" : "none" } }));
    g.appendChild(mk("path", { d: d, fill: "none", "data-hit": "1", style: { stroke: "transparent", "stroke-width": 14, cursor: "pointer" } }));
    if (e.label && !dim) {
      var vert = Math.abs(a.x - b.x) < Math.abs(a.y - b.y);
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var lx = vert ? mx + 15 : mx, ly = vert ? my : my - 12;          // labels OFFSET to the side of the wire
      g.appendChild(mk("rect", { x: lx - 8, y: ly - 8, width: 16, height: 15, rx: 4, style: { fill: "var(--bg)", stroke: col, "stroke-opacity": 0.4 } }));
      g.appendChild(txt(e.label, { x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central", "font-family": MONO, "font-size": 9.5, style: { fill: col, "pointer-events": "none" } }));
    }
    svg.appendChild(g);
  }

  function drawSlot(parent, N, io, pt) {
    var col = roleColor(pt.role);
    var c = mk("circle", { cx: pt.x, cy: pt.y, r: 5.5, "data-slot": N.id + "|" + io + "|" + pt.name, "data-role": pt.role, "data-dir": io, class: "dg-slot",
      style: { fill: "var(--bg)", stroke: col, "stroke-width": 2, cursor: io === "out" ? "crosshair" : "pointer" } });
    var role = REG.roles[pt.role] || {};
    c.appendChild(mk("title", null, [document.createTextNode(io + " · " + pt.name + " · " + pt.role + " — " + (role.desc || ""))]));
    parent.appendChild(c);
    parent.appendChild(mk("circle", { cx: pt.x, cy: pt.y, r: 2.2, style: { fill: col, "pointer-events": "none" } }));
    /* slot names sit BESIDE the wire, never on it — top/bottom slots have a vertical
       wire through pt.x, so those labels get a lateral offset (SPEC-3 §1 label rule). */
    var lx = pt.x, ly = pt.y, anchor = "middle", dy = 0;
    if (pt.side === "top") { lx = pt.x + 10; ly = pt.y - 7; anchor = "start"; }
    else if (pt.side === "bottom") { lx = pt.x + 10; ly = pt.y + 12; anchor = "start"; }
    else if (pt.side === "left") { lx = pt.x - 9; anchor = "end"; dy = 3; }
    else { lx = pt.x + 9; anchor = "start"; dy = 3; }
    if (N.kind !== "io" && pt.name && pt.name !== "in" && pt.name !== "out") {
      parent.appendChild(txt(pt.name, { x: lx, y: ly + dy, "text-anchor": anchor, "font-family": MONO, "font-size": 8.5, style: { fill: "var(--muted)", "pointer-events": "none" } }));
    }
  }

  function drawNode(svg, N) {
    var ntype = (N.irNode && (N.irNode.type || N.irNode.ref)) || null;
    var g = mk("g", { "data-node": N.id, "data-type": ntype, "data-kind": N.kind, class: "dg-node" + (N.ghost ? " ghost" : "") });
    if (N.ghost) g.style.opacity = "0.4";
    var selected = App.selected && App.selected.kind === "node" && App.selected.id === N.id;
    var col = roleColor(N.role);

    if (N.kind === "merge") {
      var mcx = N.x + N.w / 2, mcy = N.y + N.h / 2, r = N.w / 2;
      g.appendChild(mk("circle", { cx: mcx, cy: mcy, r: r + 3, class: "sel-ring", style: { fill: "none", stroke: "var(--accent)", "stroke-width": 2, opacity: selected ? 1 : 0 } }));
      g.appendChild(mk("circle", { cx: mcx, cy: mcy, r: r, class: "card-bg", style: { fill: tint(N.role, 18), stroke: col, "stroke-width": 1.9, cursor: "grab" } }));
      g.appendChild(txt(N.glyph || "⊕", { x: mcx, y: mcy + 1, "text-anchor": "middle", "dominant-baseline": "central", "font-family": MONO, "font-size": 19, style: { fill: col, "pointer-events": "none" } }));
    } else if (N.kind === "io") {
      g.appendChild(mk("rect", { x: N.x - 3, y: N.y - 3, width: N.w + 6, height: N.h + 6, rx: 18, class: "sel-ring", style: { fill: "none", stroke: "var(--accent)", "stroke-width": 2, opacity: selected ? 1 : 0 } }));
      g.appendChild(mk("rect", { x: N.x, y: N.y, width: N.w, height: N.h, rx: 15, class: "card-bg",
        style: { fill: tint(N.role, 18), stroke: col, "stroke-width": 1.6, cursor: "default" } }));
      g.appendChild(txt(N.title, { x: N.x + N.w / 2, y: N.y + N.h / 2 + 1, "text-anchor": "middle", "dominant-baseline": "central", "font-family": MONO, "font-size": 13, "font-weight": 700, style: { fill: col, "pointer-events": "none" } }));
      // shape chip offset BESIDE the spine wire that enters/leaves the io pill at centre-x
      if (N.sub) g.appendChild(txt(N.sub, { x: N.x + N.w / 2 + 12, y: N.y + (N._out && N._out.length ? N.h + 13 : -9), "text-anchor": "start", "font-family": MONO, "font-size": 8.5, style: { fill: "var(--muted)", "pointer-events": "none" } }));
    } else {
      g.appendChild(mk("rect", { x: N.x - 3, y: N.y - 3, width: N.w + 6, height: N.h + 6, rx: 13, class: "sel-ring", style: { fill: "none", stroke: "var(--accent)", "stroke-width": 2, opacity: selected ? 1 : 0 } }));
      g.appendChild(mk("rect", { x: N.x, y: N.y, width: N.w, height: N.h, rx: 11, class: "card-bg",
        style: { fill: "var(--bg-elev)", stroke: "var(--hair)", "stroke-width": 1.2, cursor: "grab" } }));
      var bx = N.x + 9, by = N.y + N.h / 2 - 13;
      g.appendChild(mk("rect", { x: bx, y: by, width: 26, height: 26, rx: 7, style: { fill: tint(N.role, 14), stroke: col, "stroke-width": 1.3, "pointer-events": "none" } }));
      var ic = iconEl(N.icon, col, N.glyph);
      ic.setAttribute("transform", "translate(" + (bx + 1) + "," + (by + 1) + ")");
      ic.style.pointerEvents = "none";
      g.appendChild(ic);
      var tx = N.x + 44;
      g.appendChild(txt(N.title, { x: tx, y: N.y + N.h * 0.41, "font-family": MONO, "font-size": 12.5, "font-weight": 600, style: { fill: "var(--fg-strong)", "pointer-events": "none" } }));
      if (N.sub) g.appendChild(txt(N.sub, { x: tx, y: N.y + N.h * 0.72, "font-family": MONO, "font-size": 9.5, style: { fill: "var(--muted)", "pointer-events": "none" } }));
      if (N.openTo) {
        var ox = N.x + N.w - 19, oy = N.y + N.h / 2;
        var ob = mk("g", { "data-open": "1", class: "dg-open", style: { cursor: "pointer" } });
        ob.appendChild(mk("rect", { x: ox - 9, y: oy - 9, width: 18, height: 18, rx: 5, style: { fill: tint(N.role, 10), stroke: col, "stroke-opacity": 0.5, "stroke-width": 1 } }));
        ob.appendChild(mk("path", { d: "M " + (ox - 3) + " " + (oy - 4) + " L " + (ox + 3) + " " + oy + " L " + (ox - 3) + " " + (oy + 4), fill: "none", style: { stroke: col, "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" } }));
        g.appendChild(ob);
      }
      if (N.badge && !N.ghost) {
        var px = N.x + N.w - 6, py = N.y - 4;
        var bg = mk("g", null);
        bg.appendChild(mk("rect", { x: px - 34, y: py - 9, width: 42, height: 19, rx: 5, style: { fill: tint("resid", 18), stroke: "var(--dg-accent1)", "stroke-width": 1.4 } }));
        bg.appendChild(txt(N.badge, { x: px - 13, y: py + 1, "text-anchor": "middle", "dominant-baseline": "central", "font-family": MONO, "font-size": 11, "font-weight": 700, style: { fill: "var(--dg-accent1)" } }));
        g.appendChild(bg);
      }
    }
    if (!N.ghost) {
      (N._in || []).forEach(function (pt) { drawSlot(g, N, "in", pt); });
      (N._out || []).forEach(function (pt) { drawSlot(g, N, "out", pt); });
    }
    svg.appendChild(g);
    wireNodeEvents(g, N);
  }

  function label(svg, x, y, text, role, anchor) {
    svg.appendChild(txt(text, { x: x, y: y, "text-anchor": anchor || "middle", "dominant-baseline": "central", "font-family": MONO, "font-size": 10, "letter-spacing": ".03em", style: { fill: roleColor(role), "pointer-events": "none" } }));
  }

  /* ============================================================ RENDER */
  function build() {
    var G = compile();
    return G.dir === "right" ? layoutFlow(G) : layoutSpine(G);
  }

  /* compile current level → graph (nodes+edges) BEFORE layout (no positions yet). */
  function compile() {
    var f = cur(), G;
    if (f.type === "root") G = deriveRoot();
    else if (f.type === "array") G = deriveArray(f);
    else if (f.type === "block") G = deriveBlock(f);
    else G = deriveGraphLevel(f);
    G.nodeMap = {}; G.nodes.forEach(function (n) { G.nodeMap[n.id] = n; });
    return G;
  }

  function render() {
    App.ports = {}; App.nodeById = {};
    var view = build(); App.view = view;
    var svg = el("canvas");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // The SVG FILLS the wrap (CSS: position:absolute; inset:0). No viewBox / shrink-wrap — the
    // user coordinate system is the pixel viewport; the CAMERA <g> places + scales the content.
    svg.removeAttribute("viewBox"); svg.style.width = ""; svg.style.maxWidth = ""; svg.style.height = "";

    var defs = mk("defs", null, [
      mk("pattern", { id: "grid", width: 22, height: 22, patternUnits: "userSpaceOnUse" }, [mk("circle", { cx: 1, cy: 1, r: 0.9, style: { fill: "var(--hair)" } })]),
      (function () { var fl = mk("filter", { id: "elev", x: "-30%", y: "-30%", width: "160%", height: "160%" }); fl.appendChild(mk("feDropShadow", { dx: 0, dy: 2, stdDeviation: 3, "flood-color": "rgba(0,0,0,.45)" })); return fl; })()
    ]);
    svg.appendChild(defs);
    // fixed full-viewport background: the hit-target for an empty-canvas PAN; its grid parallaxes
    // with the camera via patternTransform so the world reads as moving under a fixed window.
    svg.appendChild(mk("rect", { x: 0, y: 0, width: "100%", height: "100%", fill: "url(#grid)", "data-bg": "1" }));

    // the CAMERA group — everything drawable lives inside it; applyCam() sets its transform.
    var cam = mk("g", { id: "cameraG", "data-cam": "1" });
    svg.appendChild(cam);

    view.nodes.forEach(function (n) { App.nodeById[n.id] = n; });
    // wires first (spine + branches all connected slot→slot), then decos, then nodes on top.
    view.edges.forEach(function (e) { drawWire(cam, e, view); });
    if (view.decos) view.decos(cam, view);
    view.nodes.forEach(function (n) { drawNode(cam, n); });

    applyCam();
    renderCrumbs();
    renderInspector();
    el("modelName").textContent = IR.name || "model";
    svg.setAttribute("aria-label", "dataflow editor — " + cur().key);
    syncArch();
  }

  /* ============================================================ CAMERA
     A pan/zoom window over the laid-out graph. The content lives in <g id="cameraG">;
     applyCam() writes its transform. centerCamera() puts the content's bounding-box centre at
     the canvas centre on each relayout (fit=true also shrinks-to-fit). Pan/zoom never mutate
     the graph or the navigation — they only move the window. */
  function applyCam() {
    var g = el("cameraG");
    var t = "translate(" + App.cam.panX + "," + App.cam.panY + ") scale(" + App.cam.zoom + ")";
    if (g) g.setAttribute("transform", t);
    var pat = el("grid"); if (pat) pat.setAttribute("patternTransform", t);   // parallax world grid
  }
  function canvasSize() {
    var svg = el("canvas"), r = svg.getBoundingClientRect();
    return { w: r.width || svg.clientWidth || 0, h: r.height || svg.clientHeight || 0 };
  }
  function contentBox(view) {
    view = view || App.view;
    if (!view || !view.nodes || !view.nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    view.nodes.forEach(function (n) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  // centre the laid-out content in the canvas. fit=true also scales it down to fit the viewport.
  function centerCamera(fit) {
    var view = App.view; if (!view) return;
    var cs = canvasSize(), b = contentBox(view);
    if (cs.w <= 0 || cs.h <= 0 || b.w <= 0 || b.h <= 0) return;
    var z = 1;
    if (fit) { z = Math.min((cs.w - 64) / b.w, (cs.h - 64) / b.h); z = Math.max(0.3, Math.min(1.5, z)); }
    App.cam.zoom = z;
    App.cam.panX = cs.w / 2 - (b.x + b.w / 2) * z;
    App.cam.panY = cs.h / 2 - (b.y + b.h / 2) * z;
    applyCam();
  }

  /* ============================================================ NAVIGATION */
  function initNav() {
    App.nav = [{ type: "root", group: IR.root, key: "root", crumbs: [{ label: "model", to: 0 }] }];
  }
  function enterArray(trunk) {
    App.nav.push({ type: "array", group: trunk, body: trunk.body, key: "array", crumbs: [{ label: "trunk", to: App.nav.length }] });
    App.selected = null; App.drag = null; render(); centerCamera(false);
  }
  function enterBlock() {
    App.nav.push({ type: "block", group: blockBody(), key: "block", crumbs: [{ label: "Block", to: App.nav.length }] });
    App.selected = null; App.drag = null; render(); centerCamera(false);
  }
  function enterGraph(node, title) {
    App.nav.push({ type: "graph", group: node, dir: "right", title: title, key: "graph:" + node.id, crumbs: [{ label: title, to: App.nav.length }] });
    App.selected = null; App.drag = null; render(); centerCamera(false);
  }
  function ascendTo(i) { App.nav = App.nav.slice(0, i + 1); App.selected = null; App.drag = null; render(); centerCamera(false); }

  function renderCrumbs() {
    var nav = el("crumbs"); nav.innerHTML = "";
    var flat = [];
    App.nav.forEach(function (f, fi) { f.crumbs.forEach(function (c) { flat.push({ label: c.label, to: c.to, fi: fi }); }); });
    flat.forEach(function (c, i) {
      if (i) { var sep = document.createElement("span"); sep.className = "sep"; sep.textContent = "⟩"; nav.appendChild(sep); }
      var last = i === flat.length - 1, node;
      if (last) { node = document.createElement("span"); node.setAttribute("aria-current", "page"); }
      else { node = document.createElement("a"); node.className = "crumb"; node.href = "#"; node.addEventListener("click", function (e) { e.preventDefault(); ascendTo(c.to); }); }
      if (i === 0) node.classList.add("home");
      node.setAttribute("data-crumb", c.label);
      node.textContent = c.label;
      nav.appendChild(node);
    });
  }

  /* ============================================================ INTERACTION */
  /* client → CONTENT coordinates: map through the camera group's CTM so pan/zoom is accounted
     for automatically — node positions, drops, drag and wire math all stay in content space. */
  function svgPoint(clientX, clientY) {
    var svg = el("canvas"), g = el("cameraG") || svg, m = g.getScreenCTM().inverse();
    var p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
    var r = p.matrixTransform(m); return { x: r.x, y: r.y };
  }
  /* TOUCH ROBUSTNESS: capture the pointer to the (stable) canvas SVG for the whole gesture and flag
     `body.dragging` so the surface can't pan while we drag. With `touch-action:none` on the draggable
     elements (CSS) this stops mobile browsers from claiming the gesture for scrolling + firing
     pointercancel. Wrapped in try/catch so synthetic/non-active pointers never throw a pageerror. */
  function beginDrag(e) {
    document.body.classList.add("dragging");
    var svg = el("canvas");
    try { if (e && e.pointerId != null && svg.setPointerCapture) svg.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function endDrag(e) {
    document.body.classList.remove("dragging");
    var svg = el("canvas");
    try { if (e && e.pointerId != null && svg.releasePointerCapture) svg.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  /* SWALLOW THE TRAILING CLICK (Fix A core): after ANY drag that actually moved (palette drop,
     node reorder, slot wire, camera pan) the browser may synthesise a click/tap at the release
     point. That click must NEVER reach a node's open handler — otherwise a drop that lands on a
     composite would navigate. markDrag() arms a one-shot capture-phase guard that eats the next
     click; a short timer disarms it if no click follows (so later real clicks are unaffected). */
  function markDrag() {
    App._suppressClick = true;
    clearTimeout(App._suppressTimer);
    App._suppressTimer = setTimeout(function () { App._suppressClick = false; }, 450);
  }
  document.addEventListener("click", function (e) {
    if (!App._suppressClick) return;
    // Only a drag's own trailing click is swallowed — and that one lands inside the canvas.
    // A real click on a button/palette right after a drag must still work (a re-render can
    // remove the dragged element, in which case no trailing click ever fires to consume the
    // guard — it must not eat the user's next genuine click elsewhere).
    if (el("canvas").contains(e.target)) { e.stopPropagation(); e.preventDefault(); }
    App._suppressClick = false; clearTimeout(App._suppressTimer);
  }, true);

  /* PAN the camera by dragging EMPTY canvas (mouse + one-finger touch). Disambiguated on
     pointerdown: node/slot/open/wire targets are handled by their own gestures (see
     wireCanvasEvents); only the bare surface reaches here. Panning never selects or navigates. */
  function startPan(e) {
    var sx = e.clientX, sy = e.clientY, px = App.cam.panX, py = App.cam.panY, moved = false;
    document.body.classList.add("panning");
    beginDrag(e);
    function move(ev) {
      if (ev.cancelable) ev.preventDefault();
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true; App.cam.panX = px + dx; App.cam.panY = py + dy; applyCam();
    }
    function up(ev) {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      endDrag(ev); document.body.classList.remove("panning");
      if (moved) markDrag();          // a pan must not be read as a tap/select/navigate
      else handleEmptyTap(ev);        // a real tap on empty space: deselect / double-tap to fit
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
  }
  function handleEmptyTap() {
    var now = Date.now();
    if (App._lastEmptyTap && now - App._lastEmptyTap < 360) { App._lastEmptyTap = 0; centerCamera(true); return; }
    App._lastEmptyTap = now;
    if (App.selected) { App.selected = null; render(); }
  }
  function wireNodeEvents(g, N) {
    var openBtn = g.querySelector("[data-open]");
    if (openBtn && N.openTo) {
      openBtn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      openBtn.addEventListener("click", function (e) { e.stopPropagation(); doOpen(N); });
    }
    if (N.ghost) return;
    g.querySelectorAll("[data-slot]").forEach(function (slot) {
      var key = slot.getAttribute("data-slot"), io = key.split("|")[1];
      slot.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); if (io === "out") startWire(key, e); });
    });
    var bg = g.querySelector(".card-bg");
    if (bg) bg.addEventListener("pointerdown", function (e) {
      if (e.target.closest("[data-slot]") || e.target.closest("[data-open]")) return;
      startNodeDrag(N, e);
    });
  }
  function doOpen(N) {
    if (N.openTo === "array") enterArray(N.repeatRef);
    else if (N.openTo === "block") enterBlock();
    else if (N.openTo === "graph") enterGraph(N.openNode, REG.types[N.openNode.ref] ? REG.types[N.openNode.ref].label : "graph");
  }

  /* drag = MOVE. The node stays exactly where you drop it (persisted into the document);
     wires re-route to follow. In a chain level the edge sequence follows vertical order. */
  function startNodeDrag(N, e) {
    if (N.ghost || N.kind === "io") { handleClick(N); return; }
    var start = svgPoint(e.clientX, e.clientY), moved = false;
    var offX = start.x - (N.x + N.w / 2), offY = start.y - (N.y + N.h / 2);   // grab offset — no jump-to-cursor
    beginDrag(e);
    function move(ev) {
      if (ev.cancelable) ev.preventDefault();   // suppress touch-scroll/pan during the active drag
      var p = svgPoint(ev.clientX, ev.clientY);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      moved = true; App.drag = { id: N.id, x: p.x - offX, y: p.y - offY }; render();
    }
    function up(ev) {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      endDrag(ev);
      if (!moved) { handleClick(N); return; }
      markDrag();   // a move drag must not let its trailing click open the node
      var p = svgPoint(ev.clientX, ev.clientY);
      setStoredPos(N, p.x - offX, p.y - offY);        // it STAYS where you put it
      if (cur().type === "root") respliceChainByY();  // chain sequence follows vertical order
      App.drag = null; render();
    }
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up);
  }
  function handleClick(N) {
    var now = Date.now();
    if (N.openTo && App._lastClick && App._lastClick.id === N.id && now - App._lastClick.t < 360) { App._lastClick = null; doOpen(N); return; }
    App._lastClick = { id: N.id, t: now };
    if (N.selectable) { App.selected = { kind: "node", id: N.id }; render(); }
  }
  /* chain levels derive their edges from children order — keep that order = visual top-to-bottom */
  function respliceChainByY() {
    var ch = cur().group.children || [];
    ch.sort(function (a, b) { return ((a.ui && a.ui.y) || 0) - ((b.ui && b.ui.y) || 0); });
  }
  /* ✷ tidy: clear this level's authored positions → the next render re-derives a fresh layout */
  function tidyLevel() {
    var f = cur(); if (!f.group) return;
    (f.group.children || []).forEach(function (c) { delete c.ui; });
    delete f.group.ui;
    App.drag = null; render(); centerCamera(true);
  }

  /* wiring: output-slot → input-slot, with role compatibility + full-input rejection. */
  function startWire(fromKey, e) {
    var parts = fromKey.split("|"), fromId = parts[0], fromPort = parts[2];
    var a = App.ports[fromKey]; if (!a) return;
    var host = el("cameraG") || el("canvas");   // ghost lives INSIDE the camera (content coords)
    var ghost = mk("path", { fill: "none", style: { stroke: roleColor(a.role), "stroke-width": 2, "stroke-dasharray": "5 4", "pointer-events": "none" } });
    host.appendChild(ghost);
    beginDrag(e);
    function move(ev) { if (ev.cancelable) ev.preventDefault(); var p = svgPoint(ev.clientX, ev.clientY); ghost.setAttribute("d", route(a, { x: p.x, y: p.y, side: "top" })); }
    function up(ev) {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      endDrag(ev); markDrag();   // a wire gesture must not let its trailing click reach a node opener
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      var elu = document.elementFromPoint(ev.clientX, ev.clientY);
      var slot = elu && elu.closest && elu.closest("[data-slot]");
      if (slot) { var k = slot.getAttribute("data-slot").split("|"); if (k[1] === "in") tryConnect(fromId, fromPort, a.role, k[0], k[2], slot.getAttribute("data-role")); }
    }
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up);
  }
  function compatible(srcRole, dstRole) { return srcRole === dstRole || dstRole === "hidden" || srcRole === "hidden"; }
  function tryConnect(fromId, fromPort, fromRole, toId, toPort, toRole) {
    if (cur().type === "root" || cur().type === "array") { flashHint("this level is a chain — its edges are derived; drop ops to splice them in"); return reject(toId); }
    if (fromId === toId) return reject(toId);
    if (!compatible(fromRole, toRole)) return reject(toId);
    var group = cur().group;
    // wiring onto an occupied input REWIRES it — the old edge is replaced, not rejected
    group.edges = (group.edges || []).filter(function (e) {
      var tn = e.to.node === "x" ? "x_out" : e.to.node, tp = e.to.port || firstInName(tn);
      return !(tn === toId && tp === toPort);
    });
    var fn = fromId === "x_in" ? "x" : fromId, tn = toId === "x_out" ? "x" : toId;
    group.edges = group.edges || [];
    group.edges.push({ from: { node: fn, port: fromPort }, to: { node: tn, port: toPort } });
    App.selected = { kind: "wire", id: fromId + ":" + fromPort + ">" + toId + ":" + toPort };
    render();
  }
  function firstInName(id) { var n = App.nodeById[id]; return n && n.ins && n.ins[0] ? n.ins[0].name : null; }
  function reject(id) {
    var g = el("canvas").querySelector('[data-node="' + id + '"] .card-bg');
    if (!g) return;
    var ring = el("canvas").querySelector('[data-node="' + id + '"] .sel-ring');
    if (ring) { ring.style.opacity = "1"; ring.style.stroke = "var(--accent)"; }
    g.style.stroke = "var(--accent)"; g.style.strokeWidth = "2.6";
    if (g.animate) g.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 240, iterations: 2 });
    flashHint("rejected — incompatible role or input already wired");
    setTimeout(render, 540);
  }

  /* only the group BOUNDARY (io ports) and the array visualization are undeletable —
     everything else is the user's model: any node can be deleted, swapped, rewired. */
  var CANON = { root: ["tokens", "logits"], array: ["x_in", "gprev", "inst", "gnext", "x_out"], block: ["x_in", "x_out"], graph: ["x_in", "x_out"] };
  function delNode() {
    if (!App.selected || App.selected.kind !== "node") return;
    var id = App.selected.id, group = cur().group;
    if ((CANON[cur().type] || []).indexOf(id) >= 0) { flashHint("the group boundary can't be deleted"); App.selected = null; render(); return; }
    group.children = (group.children || []).filter(function (c) { return c.id !== id; });
    // heal: bridge a single upstream to a single downstream so the flow stays connected
    // (chain levels re-derive their edges from children order, so they heal on their own).
    var ins = (group.edges || []).filter(function (e) { return e.to.node === id; });
    var outs = (group.edges || []).filter(function (e) { return e.from.node === id; });
    group.edges = (group.edges || []).filter(function (e) { return e.from.node !== id && e.to.node !== id; });
    if (ins.length === 1 && outs.length === 1) {
      var dup = group.edges.some(function (e) {
        return e.from.node === ins[0].from.node && e.to.node === outs[0].to.node &&
          (e.to.port || null) === (outs[0].to.port || null);
      });
      if (!dup) group.edges.push({ from: ins[0].from, to: outs[0].to });
    }
    App.selected = null; render();
  }
  function deleteWire(id) {
    var group = cur().group, parts = id.split(">"), f = parts[0].split(":"), t = parts[1].split(":");
    var fn = f[0] === "x_in" ? "x" : f[0], fp = f[1], tn = t[0] === "x_out" ? "x" : t[0], tp = t[1];
    group.edges = (group.edges || []).filter(function (e) {
      var ep = e.to.port || firstInName(e.to.node === "x" ? "x_out" : e.to.node);
      var sp = e.from.port || (App.nodeById[e.from.node === "x" ? "x_in" : e.from.node] && App.nodeById[e.from.node === "x" ? "x_in" : e.from.node].outs[0] || {}).name;
      return !(e.from.node === fn && e.to.node === tn && ep === tp && sp === fp);
    });
  }

  function flashHint(msg) {
    var hb = el("hintBar"); if (!hb) return;
    if (!hb._orig) hb._orig = hb.textContent;
    hb.textContent = msg; hb.classList.add("flash");
    clearTimeout(hb._t);
    hb._t = setTimeout(function () { hb.textContent = hb._orig; hb.classList.remove("flash"); }, 1800);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (App.nav.length > 1) ascendTo(App.nav.length - 2);
      else if (App.selected) { App.selected = null; render(); }
    } else if ((e.key === "Backspace" || e.key === "Delete") && App.selected) {
      if (document.activeElement && /input|select|textarea/i.test(document.activeElement.tagName)) return;
      e.preventDefault();
      if (App.selected.kind === "wire") { deleteWire(App.selected.id); App.selected = null; render(); }
      else delNode();
    }
  });

  /* ============================================================ PALETTE + DnD (splice, never floating) */
  function renderPalette() {
    var pal = el("palette"); pal.innerHTML = "";
    REG.palette.forEach(function (grp) {
      pal.appendChild(h("div", { class: "grp-title", text: grp.group }));
      grp.types.forEach(function (tname) {
        var r = REG.types[tname], role = (r.out[0] || {}).role || "hidden";
        var badge = h("span", { class: "pi-badge" });
        var s = mk("svg", { viewBox: "0 0 24 24", width: 20, height: 20 }, [iconEl(r.icon, roleColor(role), r.glyph)]);
        badge.style.borderColor = roleColor(role); badge.style.background = tint(role, 12); badge.appendChild(s);
        var item = h("div", { class: "pitem", title: r.desc, "data-type": tname, "data-paltype": tname }, [badge, h("span", { class: "pi-label", text: r.label })]);
        item.addEventListener("pointerdown", function (e) { startPaletteDrag(tname, r, e); });
        pal.appendChild(item);
      });
    });
  }
  function startPaletteDrag(type, r, e) {
    e.preventDefault();
    beginDrag(e);
    var ghost = el("dragGhost");
    ghost.hidden = false; ghost.textContent = r.label;
    ghost.style.left = e.clientX + 12 + "px"; ghost.style.top = e.clientY + 12 + "px";
    function move(ev) {
      if (ev.cancelable) ev.preventDefault();   // suppress palette-scroll/page-pan while dragging the op
      ghost.style.left = ev.clientX + 12 + "px"; ghost.style.top = ev.clientY + 12 + "px";
      var rc = el("canvas").getBoundingClientRect();
      ghost.classList.toggle("over", ev.clientX >= rc.left && ev.clientX <= rc.right && ev.clientY >= rc.top && ev.clientY <= rc.bottom);
    }
    function up(ev) {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      endDrag(ev); markDrag();   // CRITICAL: swallow the trailing click so a drop NEVER navigates,
      ghost.hidden = true; ghost.classList.remove("over");   // even when it lands on a composite node
      var rc = el("canvas").getBoundingClientRect();
      if (ev.clientX >= rc.left && ev.clientX <= rc.right && ev.clientY >= rc.top && ev.clientY <= rc.bottom) {
        var p = svgPoint(ev.clientX, ev.clientY); dropNode(type, p);
      }
    }
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up);
  }
  function dropNode(type, pt) {
    var level = cur();
    if (level.type === "array") { flashHint("open an instance to edit the block body"); return; }
    var node = newNode(type); if (!node) return;
    node.ui = { x: snapGrid(pt.x), y: snapGrid(pt.y) };   // lands exactly under the cursor — and stays
    var group = level.group;
    group.children = group.children || [];
    if (level.type === "root") {                          // chain → splice into the sequence at the drop height
      var below = (group.children).filter(function (c) { var n = App.nodeById[c.id]; return n && (n.y + n.h / 2) < pt.y; }).length;
      group.children.splice(below, 0, node);
      respliceChainByY();
    } else {                                              // graph → splice INTO the nearest edge + rewire
      spliceIntoNearestEdge(node, type, pt, group);
    }
    App.selected = { kind: "node", id: node.id };
    render();
    flashHint("added " + REG.types[type].label + " · wired in — it stays where you dropped it");
  }
  function spliceIntoNearestEdge(node, type, pt, group) {
    var r = REG.types[type], inN = (r.in[0] || {}).name || "x", outN = (r.out[0] || {}).name || "y";
    var best = null, bestD = 1e9;
    (group.edges || []).forEach(function (e, i) {
      var f = e.from.node === "x" ? "x_in" : e.from.node, t = e.to.node === "x" ? "x_out" : e.to.node;
      var fp = e.from.port || (App.nodeById[f] && App.nodeById[f].outs[0] || {}).name;
      var tp = e.to.port || (App.nodeById[t] && App.nodeById[t].ins[0] || {}).name;
      var a = App.ports[f + "|out|" + fp], b = App.ports[t + "|in|" + tp];
      if (!a || !b) return;
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dd = Math.hypot(mx - pt.x, my - pt.y);
      if (dd < bestD) { bestD = dd; best = { e: e, i: i }; }
    });
    group.children.push(node);
    if (best) {
      var oldTo = { node: best.e.to.node, port: best.e.to.port };
      best.e.to = { node: node.id, port: inN };
      group.edges.push({ from: { node: node.id, port: outN }, to: oldTo });
    }
  }

  /* ============================================================ INSPECTOR (param edit; $-refs as TEXT) */
  function renderInspector() {
    var ins = el("inspector");
    if (!App.selected || App.selected.kind !== "node") { ins.hidden = true; ins.innerHTML = ""; return; }
    var N = App.nodeById[App.selected.id];
    if (!N || N.ghost) { ins.hidden = true; return; }
    ins.hidden = false; ins.innerHTML = "";
    var node = N.irNode;
    var r = REG.types[(node && (node.type || node.ref)) || ""] || null;
    ins.appendChild(h("div", { class: "ins-head" }, [h("span", { class: "ins-title", text: N.title || N.id }), h("span", { class: "ins-id", text: "#" + N.id })]));
    if (r && r.desc) ins.appendChild(h("div", { class: "ins-desc", text: r.desc }));

    if (N.special === "repeat" && N.repeatRef) {
      ins.appendChild(field("count (×N)", "int", N.repeatRef.count, function (v) { N.repeatRef.count = Math.max(1, parseInt(v, 10) || 1); render(); }));
      ins.appendChild(h("div", { class: "ins-note", text: "virtual repeat — one body, replicated ×N along the residual stream." }));
    }
    if (node && r && r.params && Object.keys(r.params).length) {
      node.params = node.params || {};
      Object.keys(r.params).forEach(function (k) {
        var schema = r.params[k], val = node.params[k];
        ins.appendChild(field(k, schema, val == null ? "" : val, function (v) { node.params[k] = v; render(); }));
      });
    } else if (N.special !== "repeat") {
      ins.appendChild(h("div", { class: "ins-note", text: "no editable params." }));
    }
    var roleLine = h("div", { class: "ins-roles" });
    (N.ins || []).forEach(function (p) { roleLine.appendChild(roleChip("in " + p.name, p.role)); });
    (N.outs || []).forEach(function (p) { roleLine.appendChild(roleChip("out " + p.name, p.role)); });
    ins.appendChild(roleLine);
    ins.appendChild(h("button", { class: "ins-close", text: "deselect", type: "button" }, []))
      .addEventListener("click", function () { App.selected = null; render(); });
  }
  function roleChip(label2, role) {
    var c = h("span", { class: "role-chip", text: label2, title: (REG.roles[role] && REG.roles[role].desc) || role });
    c.style.borderColor = roleColor(role); c.style.color = roleColor(role); c.style.background = tint(role, 10);
    return c;
  }
  /* symbolic dims ($d) / dim-exprs / refs render as TEXT inputs and are NOT coerced (so $d shows + survives). */
  function field(name, schema, val, onChange) {
    var row = h("label", { class: "ins-field" }, [h("span", { class: "ins-key", text: name })]);
    var input;
    var numericSchema = schema === "int" || schema === "float";
    var symbolic = typeof val === "string" && (val[0] === "$" || !isNum(val));
    if (schema === "bool") {
      input = h("input", { type: "checkbox" }); input.checked = !!val;
      input.addEventListener("change", function () { onChange(input.checked); });
    } else if (typeof schema === "string" && schema.indexOf("enum:") === 0) {
      input = h("select"); schema.slice(5).split("|").forEach(function (o) { var op = h("option", { value: o, text: o }); if (o === val) op.selected = true; input.appendChild(op); });
      input.addEventListener("change", function () { onChange(input.value); });
    } else if (numericSchema && !symbolic) {
      input = h("input", { type: "number", value: val }); if (schema === "float") input.step = "any";
      input.addEventListener("input", function () {
        var raw = input.value;
        if (raw === "" || isNaN(Number(raw))) onChange(raw);
        else onChange(schema === "int" ? parseInt(raw, 10) : parseFloat(raw));
      });
    } else {
      input = h("input", { type: "text", value: val });   // dim-expr / $-ref / expr / ref?
      input.addEventListener("input", function () { onChange(input.value); });
    }
    input.className = "ins-input";
    row.appendChild(input);
    return row;
  }

  /* ============================================================ EXPORT / LOAD (pure graph; no _pos) */
  function clean(obj) {
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj && typeof obj === "object") { var o = {}; for (var k in obj) if (k[0] !== "_") o[k] = clean(obj[k]); return o; }
    return obj;
  }
  function exportJSON() {
    var data = JSON.stringify(clean(IR), null, 2);
    var blob = new Blob([data], { type: "application/json" }), url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: (IR.name || "architecture") + ".json" });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    flashHint("exported " + (IR.name || "architecture") + ".json — pure graph, no positions");
  }

  /* ============================================================ DEBUG HOOK (window.__arch)
     Stable, invisible test surface. Mirrors the live render state: the in-memory IR, the
     current breadcrumb id-path, the compiled graph for the current level (BEFORE layout), the
     derived layout (positions), plus deterministic navigation (go) + document replace (load). */
  function levelPath() {
    return App.nav.map(function (f) { return (f.group && f.group.id) || f.key; });
  }
  function portInfo(p) { return { name: p.name, role: p.role }; }
  function edgeInfo(e, G) {
    var sp = G && G.nodeMap[e.from], tp = G && G.nodeMap[e.to];
    var residual = e.skip || e.kind === "skip" || (sp && tp && sp.spine && tp.spine);
    return { from: { node: e.from, slot: e.fromPort }, to: { node: e.to, slot: e.toPort }, role: e.role, residual: !!residual };
  }
  function graphNode(n) {
    return {
      id: n.id, type: (n.irNode && (n.irNode.type || n.irNode.ref)) || null, kind: n.kind,
      role: n.role, spine: !!n.spine, ghost: !!n.ghost,
      ports: { in: (n.ins || []).map(portInfo), out: (n.outs || []).map(portInfo) }
    };
  }
  function archGraph() {
    var G = compile();
    return { nodes: G.nodes.map(graphNode), edges: G.edges.map(function (e) { return edgeInfo(e, G); }) };
  }
  function archLayout() {
    var G = App.view || build();
    return {
      nodes: G.nodes.map(function (n) {
        var b = graphNode(n);
        b.x = n.x; b.y = n.y; b.w = n.w; b.h = n.h;
        return b;
      }),
      edges: G.edges.map(function (e) { return edgeInfo(e, G); })
    };
  }
  function archGo(path) {
    initNav(); App.selected = null; App.drag = null;
    path = path || [];
    for (var i = 1; i < path.length; i++) {
      var id = path[i], f = cur(), c;
      if (f.type === "root") {
        c = childById(f.group, id);
        if (c && c.kind === "repeat") enterArray(c);
        else if (c) { var k = openKind(c); if (k === "graph") enterGraph(c, labelOf(c)); else if (k === "block") enterBlock(); }
      } else if (f.type === "array") {
        enterBlock();
      } else if (f.type === "block" || f.type === "graph") {
        c = childById(f.group, id);
        if (c) { var k2 = openKind(c); if (k2 === "graph") enterGraph(c, labelOf(c)); else if (k2 === "block") enterBlock(); }
      }
    }
    render(); centerCamera(false);
    return levelPath();
  }
  function labelOf(c) { var r = REG.types[c.ref] || REG.types[c.type]; return (r && r.label) || c.id; }
  function archLoad(obj) {
    if (obj && obj.root) { IR = obj; initNav(); render(); centerCamera(false); }
    return window.__arch && window.__arch.ir;
  }
  // camera() → live pan/zoom + the content bounding box (content coords) so tests assert centering
  // and panning without scraping pixels (see test/TESTS.md).
  function archCamera() {
    return { panX: App.cam.panX, panY: App.cam.panY, zoom: App.cam.zoom, contentBox: contentBox(App.view) };
  }
  function exposeArch() {
    window.__arch = { ir: IR, level: levelPath(), graph: archGraph, layout: archLayout, camera: archCamera, go: archGo, load: archLoad };
  }
  function syncArch() { if (window.__arch) { window.__arch.ir = IR; window.__arch.level = levelPath(); } }

  /* ============================================================ THEME */
  function ls(get, k, v) { try { return get ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } }
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); var n = el("themeName"); if (n) n.textContent = t.toUpperCase(); }
  (function initTheme() {
    var saved = ls(true, "cv-theme");
    if (saved !== "dark" && saved !== "light") saved = (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
    applyTheme(saved);
  })();

  /* ============================================================ BOOT */
  function wireCanvasEvents() {
    var svg = el("canvas");
    svg.addEventListener("pointerdown", function (e) {
      // node / slot / open-chevron own their own gestures (node-drag, wire, open) — never pan there.
      if (e.target.closest && (e.target.closest("[data-node]") || e.target.closest("[data-slot]") || e.target.closest("[data-open]"))) return;
      var w = e.target.closest && e.target.closest("[data-wire]");
      if (w) { App.selected = { kind: "wire", id: w.getAttribute("data-wire") }; render(); return; }
      startPan(e);   // bare surface (background / camera group) → PAN the camera
    });
    // wheel: plain wheel/trackpad PANS the camera; ctrl/⌘+wheel (and trackpad pinch) ZOOMS about
    // the cursor (nice-to-have; the camera is structured for it). Never mutates the graph.
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var p = svgPoint(e.clientX, e.clientY);               // content point under cursor (pre-zoom)
        var z = Math.max(0.3, Math.min(2.5, App.cam.zoom * Math.exp(-e.deltaY * 0.0015)));
        App.cam.panX += p.x * (App.cam.zoom - z);             // keep that point fixed under the cursor
        App.cam.panY += p.y * (App.cam.zoom - z);
        App.cam.zoom = z;
      } else {
        App.cam.panX -= e.deltaX; App.cam.panY -= e.deltaY;
      }
      applyCam();
    }, { passive: false });
  }
  function wireChrome() {
    el("themeToggle").addEventListener("click", function () {
      var c = document.documentElement.getAttribute("data-theme"), nx = c === "dark" ? "light" : "dark";
      ls(false, "cv-theme", nx); applyTheme(nx);
    });
    el("btnExport").addEventListener("click", exportJSON);
    el("btnLoad").addEventListener("click", function () { el("fileInput").click(); });
    var fit = el("btnFit"); if (fit) fit.addEventListener("click", function () { centerCamera(true); });
    var tidy = el("btnTidy"); if (tidy) tidy.addEventListener("click", tidyLevel);
    // re-centre on viewport resize so the content never drifts to a corner of a resized window.
    window.addEventListener("resize", function () { if (App.view) centerCamera(false); });
    el("fileInput").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { var obj = JSON.parse(rd.result); if (obj && obj.root) { IR = obj; initNav(); render(); centerCamera(false); } else alert("That JSON has no `root` node — expected an architecture IR."); }
        catch (err) { alert("Could not parse JSON: " + err.message); }
      };
      rd.readAsText(f); e.target.value = "";
    });
  }

  /* ============================================================ BOOT */
  function boot(reg, ir) {
    REG = reg; IR = ir;
    initNav();
    exposeArch();
    renderPalette();
    wireChrome();
    wireCanvasEvents();
    render();
    centerCamera(false);
  }
  function bootFail(err) {
    var box = document.createElement("div");
    box.className = "boot-error";
    box.innerHTML = "<div><b>could not load</b> <code>types.json</code> / <code>examples/gqa.json</code> (" +
      String(err && err.message || err).replace(/[<>]/g, "") + ").<br/>" +
      "Serve this directory over http and reload:<br/><code>npm run serve</code> → <code>http://localhost:8123/</code></div>";
    el("canvasWrap").appendChild(box);
  }
  Promise.all([
    fetch("types.json").then(function (r) { if (!r.ok) throw new Error("types.json → HTTP " + r.status); return r.json(); }),
    fetch("examples/gqa.json").then(function (r) { if (!r.ok) throw new Error("examples/gqa.json → HTTP " + r.status); return r.json(); })
  ]).then(function (res) { boot(res[0], res[1]); }).catch(bootFail);
})();
