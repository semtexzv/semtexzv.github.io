/* Tabletop shell — the shared framework behind the two-player board games
   (/go, /dama). One game = one Tabletop(cfg) call.

   The shell owns everything that is not game logic:
   - i18n (device language, sk/en) with the game's strings merged over the base
   - persistence (localStorage or a cfg-provided store)
   - PeerJS networking: host/join, wait overlay + QR join links, watchdogs,
     reconnect messaging, name sync
   - the action negotiation protocol (req -> dialog -> res / reqCancel) for
     anything that rewrites shared history, with moveNum staleness pins,
     45s timeout, cancel, busy/simultaneous handling
   - dialogs, toasts, sounds, haptics, wake lock
   - setup + game-over UI flow (instant local rematch, Menu at game over)
   - responsive board sizing (fitBoard) and the PWA service worker with
     auto-update-on-focus + reload-when-safe

   The game supplies: rules engine, board rendering, its message types,
   its extra strings, and hooks (see cfg.hooks below).

   Message protocol (shared frame):
     hello {name}                      guest -> host after connect
     sync  {core, names, x}            host -> guest full state (x = game extra)
     name  {color, name}               either side renames itself
     resign{loser}                     notify + game-over dialog on the other side
     state {core, reason}              authoritative state push (e.g. after takeback)
     req   {action, id, moveNum} / res {id, action, accept[, reason]} / reqCancel {id}
   plus any game types routed to hooks.onGameMsg(m). */
(function(){
"use strict";

window.Tabletop = function(cfg){
  const hooks = cfg.hooks;
  const $ = function(id){ return document.getElementById(id); };

  /* ---------- i18n ---------- */
  const LANG = (function(){
    try{
      const ls = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en"];
      for (let i=0;i<ls.length;i++) if (String(ls[i]).toLowerCase().indexOf("sk") === 0) return "sk";
    }catch(e){}
    return "en";
  })();

  const BASE_STRINGS = {
  en: {
    black:"Black", white:"White", youWord:"You", yourOpp:"Your opponent",
    yes:"Yes", cancel:"Cancel", areYouSure:"Are you sure?",
    newGame:"New game", newShort:"New", menu:"Menu", playAgain:"Play again", leaveOnline:"Leave online",
    undo:"Undo", redo:"Redo", resign:"Resign", leave:"Leave",
    loading:"Loading…", welcomeBack:"Welcome back! Last game is shown — hit Play again for a rematch.",
    statusMove:"Move {n} — {who} to play",
    statusOver:"Game over.",
    turnOf:"It's {name}'s turn.",
    notConnected:"Not connected right now.",
    winResign:"🏆 {name} wins by resignation",
    resignAsk:"{loser}, resign and give {winner} the win?",
    gameOverTitle:"Game over", resignedDlg:"<b>{loser}</b> resigned — {winner} wins! 🏆",
    abandonAsk:"Abandon the current game and start fresh?",
    leaveAsk:"Leave the online game?",
    enterCode:"Enter the 5-character game code.",
    needNet:"Online play needs an internet connection — the networking library didn't load. Same-device play still works.",
    newLuck:"New game — good luck!",
    movedBack:"Move taken back.", tookBack:"{name} took back their move.",
    onlyOwn:"You can only take back your own last move.",
    tooLate:"Too late — the position already changed.",
    declinedT:"{name} declined.", busyT:"{name} is busy with another request.",
    noAnswer:"No answer from {name} — try again in a moment.",
    withdrew:"{name} withdrew the request.",
    joinedT:"{name} joined — game on!",
    connectedGuest:"Connected — you play {color}.",
    connLostGuest:"Connection lost. You can Leave and re-join with the same code.",
    connLostHost:"Connection lost. If they re-join with the same code, the game resumes.",
    netYou:"Online — you play <b>{me}</b> vs {opp}",
    netDiscGuest:"Disconnected. Leave, then re-join with code <b>{code}</b> to resume.",
    netDiscHost:"Disconnected. Waiting — they can re-join with code <b>{code}</b>.",
    netSetup:"Setting up online game (code <b>{code}</b>)…",
    req_new_title:"New game?", req_new_verb:"wants to start a new game", req_new_wait:"Asking {opp} to start a new game…",
    req_undo_title:"Take back?", req_undo_verb:"asks to take back their last move", req_undo_wait:"Asking {opp} to allow the takeback…",
    accept:"Accept", allow:"Allow", decline:"Decline",
    shareCode:"Share this code", joiningGame:"Joining game", tryAgain:"Try again",
    connectingSignal:"Connecting to the signaling service…",
    waitingOpponent:"Waiting for your opponent — they can scan the QR with their phone camera, or type the code into Join online.",
    lookingHost:"Looking for the host…",
    foundService:"Found the service — opening a direct connection…",
    noGameFound:"No game found with code <b>{code}</b>. Double-check it (the host must be on the waiting screen), then hit Try again.",
    failP2P:"Reached the signaling service, but couldn't open a direct connection between your two browsers. Strict firewalls or some mobile networks block peer-to-peer — try putting both devices on the same Wi-Fi, then hit Try again.",
    failSignal:"Can't reach the signaling service. It may be blocked by a firewall or briefly down — check your internet connection and hit Try again.",
    startGame:"Start game", createGame:"Create game", joinGameBtn:"Join game",
    howPlaying:"How are you playing?", sameDevice:"Same device", hostOnline:"Host online", joinOnline:"Join online",
    undoOption:"Undo", undoAllowed:"Allowed", undoOff:"Not allowed",
    backToLobby:"Back to lobby",
    yourName:"Your name", gameCode:"Game code",
    noteLocal:"The game saves itself after every move — close the tab and pick up where you left off.",
    installHint:" <br>Tip: add this page to your home screen (Share → Add to Home Screen) and it plays full-screen like an app."
  },
  sk: {
    black:"Čierny", white:"Biely", youWord:"Ty", yourOpp:"Tvoj súper",
    yes:"Áno", cancel:"Zrušiť", areYouSure:"Naozaj?",
    newGame:"Nová hra", newShort:"Nová", menu:"Menu", playAgain:"Hrať znova", leaveOnline:"Odísť z online",
    undo:"Späť", redo:"Znova", resign:"Vzdať sa", leave:"Odísť",
    loading:"Načítavam…", welcomeBack:"Vitaj späť! Posledná hra je na doske — ťukni na Hrať znova.",
    statusMove:"Ťah {n} — na ťahu: {who}",
    statusOver:"Koniec hry.",
    turnOf:"Na ťahu je {name}.",
    notConnected:"Momentálne nie ste spojení.",
    winResign:"🏆 {name} vyhráva — súper sa vzdal",
    resignAsk:"{loser}, vzdáš sa a prenecháš výhru hráčovi {winner}?",
    gameOverTitle:"Koniec hry", resignedDlg:"<b>{loser}</b> sa vzdal — vyhráva {winner}! 🏆",
    abandonAsk:"Zahodiť rozohranú hru a začať novú?",
    leaveAsk:"Odísť z online hry?",
    enterCode:"Zadaj 5-znakový kód hry.",
    needNet:"Online hra potrebuje internet — sieťová knižnica sa nenačítala. Hra na jednom zariadení funguje ďalej.",
    newLuck:"Nová hra — veľa šťastia!",
    movedBack:"Ťah vrátený.", tookBack:"{name} vrátil svoj posledný ťah.",
    onlyOwn:"Vrátiť môžeš len svoj posledný ťah.",
    tooLate:"Neskoro — pozícia sa už zmenila.",
    declinedT:"{name} odmieta.", busyT:"{name} práve rieši inú požiadavku.",
    noAnswer:"{name} neodpovedá — skús to o chvíľu znova.",
    withdrew:"{name} stiahol požiadavku.",
    joinedT:"{name} sa pripojil — hráme!",
    connectedGuest:"Pripojené — hráš za: {color}.",
    connLostGuest:"Spojenie sa prerušilo. Odíď a pripoj sa znova s rovnakým kódom.",
    connLostHost:"Spojenie sa prerušilo. Ak sa súper vráti s rovnakým kódom, hra pokračuje.",
    netYou:"Online — hráš <b>{me}</b> proti {opp}",
    netDiscGuest:"Odpojené. Odíď a pripoj sa znova s kódom <b>{code}</b>.",
    netDiscHost:"Odpojené — súper sa môže vrátiť s kódom <b>{code}</b>.",
    netSetup:"Zakladám online hru (kód <b>{code}</b>)…",
    req_new_title:"Nová hra?", req_new_verb:"chce začať novú hru", req_new_wait:"Čakám, či {opp} prijme novú hru…",
    req_undo_title:"Vrátiť ťah?", req_undo_verb:"žiada o vrátenie svojho posledného ťahu", req_undo_wait:"Čakám, či {opp} povolí vrátenie ťahu…",
    accept:"Prijať", allow:"Povoliť", decline:"Odmietnuť",
    shareCode:"Zdieľaj tento kód", joiningGame:"Pripájanie", tryAgain:"Skúsiť znova",
    connectingSignal:"Pripájam sa k sprostredkovacej službe…",
    waitingOpponent:"Čakáme na súpera — môže naskenovať QR kód fotoaparátom alebo zadať kód cez „Pripojiť sa“.",
    lookingHost:"Hľadám hostiteľa…",
    foundService:"Služba nájdená — otváram priame spojenie…",
    noGameFound:"Hra s kódom <b>{code}</b> sa nenašla. Skontroluj ho (hostiteľ musí byť na čakacej obrazovke) a ťukni Skúsiť znova.",
    failP2P:"So službou sa podarilo spojiť, ale priame spojenie medzi prehliadačmi sa nepodarilo otvoriť. Prísne firewally a niektoré mobilné siete blokujú P2P — skúste obe zariadenia na rovnakej Wi-Fi a ťukni Skúsiť znova.",
    failSignal:"Nedá sa spojiť so sprostredkovacou službou. Skontroluj internet a ťukni Skúsiť znova.",
    startGame:"Začať hru", createGame:"Vytvoriť hru", joinGameBtn:"Pripojiť sa",
    howPlaying:"Ako hráte?", sameDevice:"Jedno zariadenie", hostOnline:"Založiť online", joinOnline:"Pripojiť sa",
    undoOption:"Vrátenie ťahu", undoAllowed:"Povolené", undoOff:"Vypnuté",
    backToLobby:"Späť do lobby",
    yourName:"Tvoje meno", gameCode:"Kód hry",
    noteLocal:"Hra sa po každom ťahu sama uloží — môžeš zavrieť kartu a pokračovať neskôr.",
    installHint:" <br>Tip: pridaj si stránku na plochu (Zdieľať → Pridať na plochu) a hra pobeží na celú obrazovku ako aplikácia."
  }};

  const STRINGS = { en: {}, sk: {} };
  ["en","sk"].forEach(function(l){
    Object.assign(STRINGS[l], BASE_STRINGS[l], (cfg.strings && cfg.strings[l]) || {});
  });

  function t(key, vars){
    let s = STRINGS[LANG] && STRINGS[LANG][key];
    if (s == null) s = STRINGS.en[key];
    if (s == null) s = key;
    if (vars) for (const k in vars) s = s.split("{"+k+"}").join(vars[k]);
    return s;
  }

  /* Translate the shared chrome; the game translates its own bits in
     hooks.applyStaticLang(). */
  function applyStaticLang(){
    document.documentElement.lang = LANG;
    if (LANG === "en") return;
    if ($("btnLeave")) $("btnLeave").textContent = t("leave");
    if ($("btnUndo")) $("btnUndo").textContent = t("undo");
    if ($("btnRedo")) $("btnRedo").textContent = t("redo");
    if ($("btnResign")) $("btnResign").textContent = t("resign");
    document.querySelectorAll("#modeSeg button").forEach(function(b){
      b.textContent = t({ local:"sameDevice", host:"hostOnline", join:"joinOnline" }[b.dataset.mode]);
    });
    if ($("waitRetry")) $("waitRetry").textContent = t("tryAgain");
    if ($("waitCancel")) $("waitCancel").textContent = t("cancel");
    const fu = $("fieldUndo");
    if (fu){
      fu.querySelector("label").textContent = t("undoOption");
      fu.querySelector('[data-undo="1"]').textContent = t("undoAllowed");
      fu.querySelector('[data-undo="0"]').textContent = t("undoOff");
    }
  }

  /* ---------- storage ---------- */
  const store = cfg.store || (function(){
    let ls = null;
    try { ls = window.localStorage; ls.setItem("__tt_t","1"); ls.removeItem("__tt_t"); } catch(e){ ls = null; }
    if (ls){
      return {
        async get(k){ try{ return ls.getItem(k); }catch(e){ return null; } },
        async set(k,v){ try{ ls.setItem(k,v); }catch(e){} }
      };
    }
    const mem = {};
    return { async get(k){ return (k in mem) ? mem[k] : null; }, async set(k,v){ mem[k]=v; } };
  })();

  /* ---------- shared state ---------- */
  const names = { 1:"", 2:"" };   // player 1 hosts online games
  const tally = { 1:0, 2:0 };
  let setupMode = "local";
  let allowUndo = true;           // per-game setting from the setup screen
  /* display name shared with the lobby page; lobby code to return to */
  function sharedName(){
    try{
      return sessionStorage.getItem("tabletop:name") || localStorage.getItem("tabletop:name") || "";
    }catch(e){ return ""; }
  }
  function lobbyCode(){ try{ return sessionStorage.getItem("tabletop:lobby") || ""; }catch(e){ return ""; } }

  function pname(c){
    return names[c] || t(cfg.colorKeys[c]);
  }

  /* ---------- persistence ---------- */
  let saveTimer = null;
  function writeSave(){
    store.set(cfg.key, JSON.stringify({ S: hooks.getS(), names: names, tally: tally, u: allowUndo }));
  }
  function persist(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeSave, 120);
  }
  // the debounce must not lose the last action when the tab closes or reloads
  window.addEventListener("pagehide", function(){
    if (saveTimer != null){ clearTimeout(saveTimer); saveTimer = null; writeSave(); }
  });
  async function restoreSave(){
    const raw = await store.get(cfg.key);
    if (!raw) return false;
    try{
      const d = JSON.parse(raw);
      if (d && d.names){ names[1] = d.names[1] || ""; names[2] = d.names[2] || ""; }
      if (d && d.tally){ tally[1] = d.tally[1] || 0; tally[2] = d.tally[2] || 0; }
      allowUndo = d.u !== false;
      if (d && d.S) return hooks.setS(d.S);
    }catch(e){}
    return false;
  }

  /* ---------- networking ---------- */
  const net = {
    mode:"local", myColor:0, peer:null, conn:null,
    connected:false, code:"", everConnected:false
  };
  function isOnline(){ return net.mode !== "local"; }
  function isLive(){ return isOnline() && net.connected; }
  function hasPeerLib(){ return typeof Peer !== "undefined"; }

  function makeCode(){
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i=0;i<5;i++) s += A[Math.floor(Math.random()*A.length)];
    return s;
  }
  function sendMsg(m){
    if (net.conn && net.conn.open){ try{ net.conn.send(m); }catch(e){} }
  }
  function teardownNet(){
    clearNegotiation();
    try{ if (net.conn) net.conn.close(); }catch(e){}
    try{ if (net.peer) net.peer.destroy(); }catch(e){}
    net.mode = "local"; net.myColor = 0; net.peer = null; net.conn = null;
    net.connected = false; net.code = ""; net.everConnected = false;
    updateNetBar();
  }

  let hostAttempts = 0;
  let waitTimer = null;
  function armWaitWatchdog(ms, stage){
    clearTimeout(waitTimer);
    $("waitRetry").style.display = "none";
    waitTimer = setTimeout(function(){
      if (!isOnline() || net.connected) return;
      signalFailure(stage);
    }, ms);
  }
  function clearWaitWatchdog(){ clearTimeout(waitTimer); }
  function signalFailure(stage){
    clearWaitWatchdog();
    if (stage === "p2p") setWaitMsg(t("failP2P"));
    else if (cfg.artifactEnv && cfg.strings && STRINGS[LANG].failArtifact) setWaitMsg(t("failArtifact"));
    else setWaitMsg(t("failSignal"));
    $("waitRetry").style.display = "";
  }
  function hostGame(myName, presetCode){
    names[1] = myName; names[2] = "";
    net.mode = "host"; net.myColor = 1;
    net.code = presetCode || makeCode();
    net.preset = !!presetCode;
    hooks.freshForHost();
    persist();
    showWait("host");
    createHostPeer();
  }
  function createHostPeer(){
    try{ if (net.peer) net.peer.destroy(); }catch(e){}
    armWaitWatchdog(9000, "broker");
    const p = new Peer(cfg.peerPrefix + net.code, { debug: 0 });
    net.peer = p;
    p.on("open", function(){
      if (net.mode !== "host") return;
      clearWaitWatchdog();
      setWaitMsg('<span class="waitspin"></span>' + t("waitingOpponent"));
    });
    p.on("connection", function(c){
      if (net.mode !== "host") return;
      if (net.conn && net.conn.open){ try{ c.close(); }catch(e){} return; }
      net.conn = c;
      wireConn(c);
    });
    p.on("error", function(err){
      if (net.mode !== "host") return;
      if (err && err.type === "unavailable-id" && hostAttempts < 3){
        hostAttempts++;
        // a preset code is a rendezvous with the other player — retry the
        // same code (stale claim expiring) instead of minting a new one
        if (!net.preset){
          net.code = makeCode();
          showWait("host");
        }
        setTimeout(createHostPeer, net.preset ? 1200 : 0);
        return;
      }
      if (err && (err.type === "network" || err.type === "server-error" || err.type === "socket-error" || err.type === "socket-closed" || err.type === "browser-incompatible")){
        signalFailure("broker");
      }
    });
    p.on("disconnected", function(){
      try{ if (net.peer && !net.peer.destroyed) net.peer.reconnect(); }catch(e){}
    });
  }
  function joinGame(myName, code, attempt){
    names[2] = myName;
    net.mode = "guest"; net.myColor = 2;
    net.code = code;
    showWait("join");
    armWaitWatchdog(9000, "broker");
    const p = new Peer({ debug: 0 });
    net.peer = p;
    p.on("open", function(){
      if (net.mode !== "guest") return;
      armWaitWatchdog(15000, "p2p");
      setWaitMsg('<span class="waitspin"></span>' + t("foundService"));
      const c = p.connect(cfg.peerPrefix + code, { reliable: true });
      net.conn = c;
      wireConn(c);
    });
    p.on("error", function(err){
      if (net.mode !== "guest") return;
      if (err && err.type === "peer-unavailable"){
        clearWaitWatchdog();
        if ((attempt || 0) < 2){
          // the host may still be setting up (e.g. both sides arriving from a
          // lobby challenge) — retry quietly before declaring it missing
          setTimeout(function(){
            if (net.mode !== "guest" || net.connected) return;
            try{ if (net.peer) net.peer.destroy(); }catch(e2){}
            net.peer = null; net.conn = null;
            joinGame(myName, code, (attempt || 0) + 1);
          }, 1600);
          return;
        }
        setWaitMsg(t("noGameFound", { code: code }));
        $("waitRetry").style.display = "";
      } else if (err && (err.type === "network" || err.type === "server-error" || err.type === "socket-error" || err.type === "socket-closed" || err.type === "browser-incompatible")){
        signalFailure("broker");
      }
    });
  }
  function wireConn(c){
    c.on("open", function(){
      net.connected = true;
      net.everConnected = true;
      clearWaitWatchdog();
      hideWait();
      if (net.mode === "guest"){
        sendMsg({ t:"hello", name: names[2] });
      }
      updateNetBar();
      hooks.renderAll();
    });
    c.on("data", handleMsg);
    c.on("close", function(){
      if (net.conn !== c) return;
      net.connected = false;
      clearNegotiation();
      updateNetBar();
      hooks.renderAll();
      if (isOnline()) toast(t(net.mode === "guest" ? "connLostGuest" : "connLostHost"));
    });
    c.on("error", function(){});
  }

  /* ---------- action negotiation ---------- */
  const REQ_TIMEOUT = 45000;
  let reqSeq = 0;
  let pendingOut = null;
  let pendingIn = null;

  function reqText(action){
    return {
      title: t("req_" + action + "_title"),
      verb: t("req_" + action + "_verb"),
      yes: action === "undo" ? t("allow") : t("accept"),
      waiting: t("req_" + action + "_wait")
    };
  }
  function oppName(){ return pname(3 - net.myColor); }

  function sendRequest(action){
    if (!isLive()){ toast(t("notConnected")); return; }
    if (pendingOut || pendingIn) return;
    pendingOut = { id: net.myColor + "-" + (++reqSeq), action: action, moveNum: hooks.moveNum() };
    sendMsg({ t:"req", action: action, id: pendingOut.id, moveNum: pendingOut.moveNum });
    pendingOut.timer = setTimeout(function(){
      if (!pendingOut) return;
      sendMsg({ t:"reqCancel", id: pendingOut.id });
      pendingOut = null;
      hideDialog();
      toast(t("noAnswer", { name: oppName() }));
    }, REQ_TIMEOUT);
    const rt = reqText(action);
    showDialog({
      title: rt.title,
      msg: '<span class="waitspin"></span>' + escapeHtml(rt.waiting.replace("{opp}", oppName())),
      hideYes: true,
      no: t("cancel"),
      onNo: function(){
        if (!pendingOut) return;
        clearTimeout(pendingOut.timer);
        sendMsg({ t:"reqCancel", id: pendingOut.id });
        pendingOut = null;
      }
    });
  }
  function applyAgreed(action){
    if (action === "new"){
      hooks.resetGame();
      persist();
      hooks.renderAll();
      toast(t("newLuck"));
    } else {
      hooks.applyAgreedExtra(action);
    }
  }
  function handleIncomingReq(m){
    const action = m.action;
    if (cfg.reqActions.indexOf(action) < 0 || typeof m.id !== "string") return;
    if (action === "undo" && !allowUndo){
      sendMsg({ t:"res", id: m.id, action: action, accept: false, reason: "stale" });
      return;
    }
    if (pendingOut && pendingOut.action === action && action !== "undo"){
      // we asked for the same thing — that's an agreement, not a conflict
      clearTimeout(pendingOut.timer);
      pendingOut = null;
      hideDialog();
      sendMsg({ t:"res", id: m.id, action: action, accept: true });
      applyAgreed(action);
      return;
    }
    if (pendingOut || pendingIn){
      sendMsg({ t:"res", id: m.id, action: action, accept: false, reason: "busy" });
      return;
    }
    if (!hooks.reqValid(action, m.moveNum)){
      sendMsg({ t:"res", id: m.id, action: action, accept: false, reason: "stale" });
      return;
    }
    pendingIn = { id: m.id, action: action };
    const rt = reqText(action);
    showDialog({
      title: rt.title,
      msg: "<b>" + escapeHtml(oppName()) + "</b> " + rt.verb + "." + (hooks.reqExtraHtml ? hooks.reqExtraHtml(action) : ""),
      yes: rt.yes,
      no: t("decline"),
      onYes: function(){
        if (!pendingIn) return;
        const id = pendingIn.id; pendingIn = null;
        sendMsg({ t:"res", id: id, action: action, accept: true });
        if (action !== "undo") applyAgreed(action);
        /* undo: nothing here — the requester rewinds and broadcasts state */
      },
      onNo: function(){
        if (!pendingIn) return;
        const id = pendingIn.id; pendingIn = null;
        sendMsg({ t:"res", id: id, action: action, accept: false });
      }
    });
  }
  function handleIncomingRes(m){
    if (!pendingOut || pendingOut.id !== m.id) return;
    const action = pendingOut.action;
    const atMove = pendingOut.moveNum;
    clearTimeout(pendingOut.timer);
    pendingOut = null;
    hideDialog();
    if (!m.accept){
      toast(m.reason === "stale" ? t("tooLate") :
            m.reason === "busy"  ? t("busyT", { name: oppName() }) :
            t("declinedT", { name: oppName() }));
      return;
    }
    if (action === "undo"){
      if (hooks.performTakeback(atMove)){
        toast(t("movedBack"));
        sendMsg({ t:"state", core: hooks.serializeCore(), reason:"undo" });
      } else {
        toast(t("tooLate"));
      }
      return;
    }
    applyAgreed(action);
  }
  function handleReqCancel(m){
    if (pendingIn && pendingIn.id === m.id){
      pendingIn = null;
      hideDialog();
      toast(t("withdrew", { name: oppName() }));
    }
  }
  function clearNegotiation(){
    if (pendingOut){ clearTimeout(pendingOut.timer); pendingOut = null; hideDialog(); }
    if (pendingIn){ pendingIn = null; hideDialog(); }
  }

  function handleMsg(m){
    if (!m || typeof m !== "object") return;
    switch (m.t){
      case "hello":
        if (net.mode !== "host") return;
        if (m.name) names[2] = String(m.name).slice(0,18);
        sendMsg({ t:"sync", core: hooks.serializeCore(), names: names, u: allowUndo, x: hooks.syncExtra() });
        persist();
        hooks.renderAll();
        toast(t("joinedT", { name: names[2] || t("yourOpp") }));
        break;
      case "sync":
        if (net.mode !== "guest") return;
        clearNegotiation();
        allowUndo = m.u !== false;
        hooks.onSync(m);
        if (m.names){
          if (m.names[1]) names[1] = String(m.names[1]).slice(0,18);
          if (m.names[2]) names[2] = String(m.names[2]).slice(0,18);
        }
        persist();
        hooks.renderAll();
        toast(t("connectedGuest", { color: t(cfg.colorKeys[2]) }));
        break;
      case "name":
        if (m.color === 1 || m.color === 2){
          names[m.color] = String(m.name || "").slice(0,18);
          persist();
          hooks.renderAll();
        }
        break;
      case "resign":
        if (m.loser === 1 || m.loser === 2){
          clearNegotiation();
          hooks.applyResign(m.loser);
          showDialog({
            title: t("gameOverTitle"),
            msg: t("resignedDlg", { loser: escapeHtml(pname(m.loser)), winner: escapeHtml(pname(3 - m.loser)) }),
            yes: "OK",
            hideNo: true
          });
        }
        break;
      case "state":
        hooks.snapshot();
        try{ hooks.restoreCore(m.core); }catch(e){}
        persist();
        hooks.renderAll();
        if (m.reason === "undo") toast(t("tookBack", { name: oppName() }));
        break;
      case "req":       handleIncomingReq(m); break;
      case "res":       handleIncomingRes(m); break;
      case "reqCancel": handleReqCancel(m); break;
      default:
        hooks.onGameMsg(m);
    }
  }

  /* ---------- shared action flows ---------- */
  function newGame(){
    if (isOnline()){
      if (net.connected) sendRequest("new"); // opponent gets an Accept/Decline dialog
      else leaveOnline();
      return;
    }
    // local: back-to-back games — fresh board right away, same settings
    if (hooks.moveNum() > 0 || hooks.phase() !== "play"){
      hooks.resetGame();
      persist();
      hooks.renderAll();
      toast(t("newLuck"));
    } else {
      openSetup(); // empty board: nothing to restart — open the menu instead
    }
  }
  function newPressed(){
    if (!isOnline() && hooks.moveNum() > 0 && hooks.phase() === "play"){
      askConfirm(t("abandonAsk"), t("newGame"), newGame);
      return;
    }
    newGame();
  }
  function doResign(){
    if (hooks.phase() !== "play") return;
    const loser = isOnline() ? net.myColor : hooks.currentTurn();
    const winner = 3 - loser;
    askConfirm(t("resignAsk", { loser: pname(loser), winner: pname(winner) }), t("resign"), function(){
      if (hooks.phase() !== "play") return;
      hooks.applyResign(loser);
      if (isLive()) sendMsg({ t:"resign", loser: loser });
    });
  }
  function undoPressed(){
    if (!allowUndo) return;
    if (!isOnline()){ hooks.localUndo(); return; }
    if (!net.connected){ toast(t("notConnected")); return; }
    if (!hooks.canTakeback()){ toast(t("onlyOwn")); return; }
    sendRequest("undo");
  }
  function goLobbyPage(){
    const lby = lobbyCode();
    try{ sessionStorage.removeItem("tabletop:lobby"); }catch(e){}
    // replace, not push: swiping back must not walk through dead game pages
    location.replace("/games/" + (lby ? "?join=" + lby : ""));
  }
  function leaveOnline(){
    if (lobbyCode()){
      goLobbyPage();
      return;
    }
    teardownNet();
    openSetup();
    hooks.renderAll();
  }

  /* ---------- setup UI ---------- */
  function openSetup(){
    hooks.fillSetupFields();
    if ($("setupMyName")) $("setupMyName").value = (net.mode === "guest" ? names[2] : names[1]) || "";
    const seg = $("undoSeg");
    if (seg) seg.querySelectorAll("button").forEach(function(b){
      b.classList.toggle("sel", b.dataset.undo === (allowUndo ? "1" : "0"));
    });
    $("setup").classList.remove("hidden");
  }
  function applySetupMode(){
    $("fieldsLocal").style.display = setupMode === "local" ? "" : "none";
    $("fieldsOnline").style.display = setupMode === "local" ? "none" : "";
    $("fieldJoin").style.display = setupMode === "join" ? "" : "none";
    if ($("fieldSize")) $("fieldSize").style.display = setupMode === "join" ? "none" : "";
    if ($("fieldUndo")) $("fieldUndo").style.display = setupMode === "join" ? "none" : "";
    const btn = $("btnStart");
    const note = $("setupNote");
    const extra = hooks.setupNoteExtra ? hooks.setupNoteExtra(setupMode) : "";
    if (setupMode === "local"){
      btn.textContent = t("startGame");
      const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone;
      const installHint = (!standalone && !cfg.artifactEnv && location.protocol === "https:") ? t("installHint") : "";
      note.innerHTML = t("noteLocal") + installHint;
    } else if (setupMode === "host"){
      btn.textContent = t("createGame");
      note.innerHTML = t("noteHost") + extra;
    } else {
      btn.textContent = t("joinGameBtn");
      note.innerHTML = t("noteJoin") + extra;
    }
  }
  function readUndoChoice(){
    const b = document.querySelector("#undoSeg button.sel");
    allowUndo = !b || b.dataset.undo !== "0";
  }
  function startPressed(){
    if (setupMode === "local"){
      readUndoChoice();
      teardownNet();
      hooks.startLocal();
      $("setup").classList.add("hidden");
      persist();
      hooks.renderAll();
      return;
    }
    if (!hasPeerLib()){
      toast(t("needNet"));
      return;
    }
    const myName = $("setupMyName").value.trim();
    if (setupMode === "host"){
      readUndoChoice();
      teardownNet();
      hostAttempts = 0;
      $("setup").classList.add("hidden");
      hostGame(myName);
      hooks.renderAll();
    } else {
      const code = $("setupCode").value.trim().toUpperCase();
      if (code.length !== 5){ toast(t("enterCode")); return; }
      teardownNet();
      $("setup").classList.add("hidden");
      joinGame(myName, code);
    }
  }

  /* ---------- waiting overlay ---------- */
  function showWait(kind){
    const box = $("waitBox");
    const qr = $("waitQR");
    qr.innerHTML = "";
    $("waitRetry").style.display = "none";
    if (kind === "host"){
      $("waitTitle").textContent = t("shareCode");
      $("waitCode").textContent = net.code;
      setWaitMsg('<span class="waitspin"></span>' + t("connectingSignal"));
      if (typeof QRCode !== "undefined"){
        try{
          new QRCode(qr, { text: joinLink(net.code), width: 148, height: 148,
            colorDark: "#1c1a16", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
        }catch(e){}
      }
    } else {
      $("waitTitle").textContent = t("joiningGame");
      $("waitCode").textContent = net.code;
      setWaitMsg('<span class="waitspin"></span>' + t("lookingHost"));
    }
    box.classList.remove("hidden");
  }
  function setWaitMsg(html){ $("waitMsg").innerHTML = html; }
  function hideWait(){ $("waitBox").classList.add("hidden"); }

  /* ---------- links ---------- */
  function joinLink(code){
    if (location.protocol === "https:" || location.protocol === "http:"){
      return location.origin + location.pathname + "?join=" + code;
    }
    return code;
  }
  function readUrlParams(){
    const out = { join:"", host:"", size:0 };
    try{
      const q = new URLSearchParams(location.search);
      const clean = function(v){ return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5); };
      out.join = clean(q.get("join"));
      out.host = clean(q.get("host"));
      out.size = parseInt(q.get("size"), 10) || 0;
      const lby = clean(q.get("lobby"));
      if (lby){ try{ sessionStorage.setItem("tabletop:lobby", lby); }catch(e){} }
      if (q.toString()) history.replaceState(null, "", location.pathname);
    }catch(e){}
    return out;
  }

  /* ---------- dialogs / toast ---------- */
  let dlgYesCb = null, dlgNoCb = null;
  function showDialog(o){
    $("dlgTitle").textContent = o.title || t("areYouSure");
    $("confirmMsg").innerHTML = o.msg || "";
    const y = $("confirmYes"), n = $("confirmNo");
    y.style.display = o.hideYes ? "none" : "";
    n.style.display = o.hideNo ? "none" : "";
    y.textContent = o.yes || t("yes");
    n.textContent = o.no || t("cancel");
    dlgYesCb = o.onYes || null;
    dlgNoCb = o.onNo || null;
    $("confirmBox").classList.remove("hidden");
  }
  function hideDialog(){
    $("confirmBox").classList.add("hidden");
    dlgYesCb = null; dlgNoCb = null;
  }
  function askConfirm(msg, yesLabel, cb){
    showDialog({ msg: escapeHtml(msg), yes: yesLabel || t("yes"), onYes: cb });
  }
  let toastTimer = null;
  function toast(msg){
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ el.classList.remove("show"); }, 2800);
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  /* ---------- sound / haptics / wake lock ---------- */
  let audioCtx = null;
  function sound(kind){
    try{
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume(); // iOS suspends until a gesture
      const t0 = audioCtx.currentTime;
      const notes = (cfg.sounds && cfg.sounds[kind]) || [[1500, 0, .12]];
      notes.forEach(function(n){
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "triangle"; o.frequency.value = n[0];
        g.gain.setValueAtTime(n[2] != null ? n[2] : .12, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + n[1] + 0.09);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.1);
      });
    }catch(e){}
  }
  function buzz(ms){
    try{ if (navigator.vibrate) navigator.vibrate(ms); }catch(e){}
  }
  let wakeLock = null;
  async function keepAwake(){
    if (!("wakeLock" in navigator)) return;
    try{
      if (document.visibilityState === "visible" && !wakeLock){
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", function(){ wakeLock = null; });
      }
    }catch(e){}
  }
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "visible") keepAwake();
  });

  /* ---------- layout ---------- */
  function fitBoard(){
    try{
      const hdr = document.querySelector("header").offsetHeight;
      const cs = getComputedStyle(document.querySelector(".table"));
      const pads = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      let extra = 0;
      if (window.matchMedia && window.matchMedia("(max-width:820px)").matches){
        extra = document.querySelector(".panel").offsetHeight + (parseFloat(cs.rowGap) || 0);
      }
      const cap = Math.max(240, window.innerHeight - hdr - pads - extra);
      document.documentElement.style.setProperty("--boardcap", cap + "px");
    }catch(e){}
  }
  window.addEventListener("resize", fitBoard);
  window.addEventListener("orientationchange", function(){ setTimeout(fitBoard, 60); });

  /* ---------- service worker with auto-update ---------- */
  function registerSW(){
    if (cfg.artifactEnv || !("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
    try{
      // one site-wide worker: drop any legacy per-app registrations first
      if (navigator.serviceWorker.getRegistrations){
        navigator.serviceWorker.getRegistrations().then(function(regs){
          regs.forEach(function(r){
            if (r.scope !== location.origin + "/") r.unregister();
          });
        }).catch(function(){});
      }
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(function(reg){
        function check(){ try{ reg.update(); }catch(e){} }
        document.addEventListener("visibilitychange", function(){
          if (document.visibilityState === "visible") check();
        });
        setInterval(check, 60 * 60 * 1000);
      }).catch(function(){});
      // when a new version takes over, reload once so it runs right away —
      // but never yank the page out from under a live online game
      let hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", function(){
        if (!hadController){ hadController = true; return; }
        if (reloaded || isLive()) return;
        reloaded = true;
        location.reload();
      });
    }catch(e){}
  }

  /* ---------- shared panel pieces ---------- */
  function updateNetBar(){
    const bar = $("netbar");
    if (!bar) return;
    if (!isOnline()){ bar.style.display = "none"; return; }
    bar.style.display = "flex";
    bar.classList.toggle("down", !net.connected);
    const me = t(cfg.colorKeys[net.myColor] || "white");
    let txt;
    if (net.connected){
      txt = t("netYou", { me: me, opp: escapeHtml(pname(3 - net.myColor)) });
    } else if (net.everConnected){
      txt = t(net.mode === "guest" ? "netDiscGuest" : "netDiscHost", { code: net.code });
    } else {
      txt = t("netSetup", { code: net.code });
    }
    $("netText").innerHTML = txt;
  }

  /* names / you-markers / active card / wins for both player cards.
     cfg.ui maps color -> element ids: { nameInput, youMark, card, wins } */
  function renderPlayersChrome(){
    [1, 2].forEach(function(c){
      const u = cfg.ui[c];
      const inp = $(u.nameInput);
      if (document.activeElement !== inp) inp.value = names[c];
      inp.readOnly = isOnline() && net.myColor !== c;
      $(u.youMark).style.display = (isOnline() && net.myColor === c) ? "" : "none";
      $(u.card).classList.toggle("active", hooks.phase() === "play" && hooks.currentTurn() === c);
      $(u.wins).textContent = tally[c];
    });
    const phone = window.matchMedia && window.matchMedia("(max-width:820px)").matches;
    $("btnNew").textContent = (isOnline() && !net.connected) ? t("menu") : (phone ? t("newShort") : t("newGame"));
    $("btnUndo").style.display = allowUndo ? "" : "none";
    $("btnUndo").disabled = isOnline() ? !(net.connected && hooks.canTakeback()) : !hooks.canLocalUndo();
    $("btnRedo").style.display = (allowUndo && !isOnline()) ? "" : "none";
    $("btnRedo").disabled = !hooks.canLocalRedo();
    updateNetBar();
  }

  /* game-over buttons: Play again + Leave online / Menu, into #overButtons
     (or a container the game passes) */
  function renderOverButtons(container){
    const ob = container || $("overButtons");
    if (!ob) return;
    if (hooks.phase() !== "over"){
      ["btnRematch","btnLeave2","btnMenu2"].forEach(function(id){ const b = $(id); if (b) b.remove(); });
      if (ob.id === "overButtons"){ ob.style.display = "none"; }
      return;
    }
    if (ob.id === "overButtons") ob.style.display = "flex";
    if (!$("btnRematch")){
      const b = document.createElement("button");
      b.id = "btnRematch"; b.className = "btn-primary grow"; b.textContent = t("playAgain");
      b.addEventListener("click", newGame);
      ob.appendChild(b);
      if (isOnline()){
        const b2 = document.createElement("button");
        b2.id = "btnLeave2"; b2.className = "btn-ghost";
        b2.textContent = t(lobbyCode() ? "backToLobby" : "leaveOnline");
        b2.addEventListener("click", leaveOnline);
        ob.appendChild(b2);
      } else {
        const b3 = document.createElement("button");
        b3.id = "btnMenu2"; b3.className = "btn-ghost"; b3.textContent = t("menu");
        b3.addEventListener("click", openSetup);
        ob.appendChild(b3);
      }
    }
  }

  /* ---------- shared wiring + boot ---------- */
  function wire(){
    const titleLink = document.querySelector("header h1 a");
    if (titleLink){
      titleLink.addEventListener("click", function(ev){
        ev.preventDefault();
        if (isLive()) askConfirm(t("leaveAsk"), t("leave"), goLobbyPage);
        else goLobbyPage();
      });
    }
    const svg = $("board");
    svg.addEventListener("contextmenu", function(ev){ ev.preventDefault(); }); // no long-press menu mid-game
    svg.addEventListener("click", function(ev){
      const el = ev.target;
      if (el && el.dataset && el.dataset.i !== undefined) hooks.onBoardClick(+el.dataset.i, ev);
    });

    $("btnUndo").addEventListener("click", undoPressed);
    $("btnRedo").addEventListener("click", function(){ if (!isOnline()) hooks.localRedo(); });
    $("btnResign").addEventListener("click", doResign);
    $("btnNew").addEventListener("click", newPressed);
    $("btnStart").addEventListener("click", startPressed);
    $("btnLeave").addEventListener("click", function(){
      askConfirm(t("leaveAsk"), t("leave"), leaveOnline);
    });
    $("waitRetry").addEventListener("click", function(){
      if (net.mode === "host"){
        showWait("host");
        createHostPeer();
      } else if (net.mode === "guest"){
        try{ if (net.peer) net.peer.destroy(); }catch(e){}
        net.peer = null; net.conn = null; net.connected = false;
        joinGame(names[2], net.code);
      }
    });
    $("waitCancel").addEventListener("click", function(){
      clearWaitWatchdog();
      teardownNet();
      openSetup();
      hideWait();
      hooks.renderAll();
    });

    $("confirmYes").addEventListener("click", function(){
      const cb = dlgYesCb; hideDialog();
      if (cb) cb();
    });
    $("confirmNo").addEventListener("click", function(){
      const cb = dlgNoCb; hideDialog();
      if (cb) cb();
    });

    $("modeSeg").addEventListener("click", function(ev){
      const b = ev.target.closest("button");
      if (!b) return;
      setupMode = b.dataset.mode;
      this.querySelectorAll("button").forEach(function(x){ x.classList.toggle("sel", x === b); });
      applySetupMode();
    });
    if ($("undoSeg")) $("undoSeg").addEventListener("click", function(ev){
      const b = ev.target.closest("button");
      if (!b) return;
      this.querySelectorAll("button").forEach(function(x){ x.classList.toggle("sel", x === b); });
    });

    [1, 2].forEach(function(c){
      $(cfg.ui[c].nameInput).addEventListener("input", function(){
        if (this.readOnly) return;
        names[c] = this.value;
        hooks.renderAll();
        persist();
        if (isOnline() && net.myColor === c){
          // online, this card is *me* — keep the lobby/shared identity in sync
          const nm = names[c].trim();
          if (nm){
            try{ sessionStorage.setItem("tabletop:name", nm); }catch(e){}
            try{ localStorage.setItem("tabletop:name", nm); }catch(e){}
          }
          if (isLive()) sendMsg({ t:"name", color: c, name: names[c] });
        }
      });
    });
    if ($("setupCode")) $("setupCode").addEventListener("input", function(){ this.value = this.value.toUpperCase(); });
  }

  window.addEventListener("pageshow", function(ev){
    if (ev.persisted) location.reload(); // bfcache restore: connections are dead
  });
  window.addEventListener("pagehide", function(ev){
    // real unload: deregister so game-code IDs don't linger on the broker
    if (!ev.persisted){ try{ if (net.peer) net.peer.destroy(); }catch(e){} }
  });

  async function boot(){
    applyStaticLang();
    hooks.applyStaticLang();
    $("status").textContent = t("loading");
    const had = await restoreSave();
    wire();
    hooks.wireExtra();
    fitBoard();
    if (!had) hooks.resetGame();
    hooks.afterRestore(had);
    applySetupMode();
    hooks.renderAll();

    const q = readUrlParams(); // scanned QR / shared join link / lobby challenge
    if (q.host.length === 5 && hasPeerLib() && !cfg.artifactEnv){
      // lobby challenge accepted: host the agreed code right away
      if (q.size && hooks.setUrlSize) hooks.setUrlSize(q.size);
      teardownNet();
      hostAttempts = 0;
      hostGame(names[1] || sharedName(), q.host);
    } else if (q.join.length === 5 && hasPeerLib() && !cfg.artifactEnv){
      // scanned the host's QR: skip the form and join straight away —
      // the name can be typed into the player card at any point
      teardownNet();
      joinGame(names[2] || sharedName(), q.join);
    } else if (q.join.length === 5){
      setupMode = "join";
      document.querySelectorAll("#modeSeg button").forEach(function(b){
        b.classList.toggle("sel", b.dataset.mode === "join");
      });
      applySetupMode();
      $("setupCode").value = q.join;
      openSetup();
    } else if (had){
      if (hooks.phase() === "over") toast(t("welcomeBack"));
    } else {
      openSetup();
    }

    keepAwake();
    registerSW();
  }

  return {
    t: t, LANG: LANG,
    names: names, tally: tally, net: net,
    isOnline: isOnline, isLive: isLive,
    pname: pname, oppName: oppName,
    sendMsg: sendMsg, sendRequest: sendRequest,
    persist: persist,
    toast: toast, showDialog: showDialog, hideDialog: hideDialog, askConfirm: askConfirm,
    escapeHtml: escapeHtml, sound: sound, buzz: buzz,
    fitBoard: fitBoard,
    updateNetBar: updateNetBar, renderPlayersChrome: renderPlayersChrome, renderOverButtons: renderOverButtons,
    openSetup: openSetup, leaveOnline: leaveOnline, newGame: newGame,
    boot: boot
  };
};
})();
