(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  if (!cfg) {
    const s=document.getElementById("connectionStatus");
    if(s){s.className="status error";s.textContent="設定エラー";}
    throw new Error("APP_CONFIG is not loaded");
  }
  document.title = `ギルド対戦管理 v${cfg.VERSION}`;
  const state = {
    mode: localStorage.getItem("gbm-mode") || cfg.DEFAULT_MODE,
    tab: localStorage.getItem("gbm-tab") || "members",
    blockId: Number(localStorage.getItem("gbm-block") || 1),
    theme: localStorage.getItem("gbm-theme") || "system",
    search: "",
    filter: "all",
    data: null,
    version: null,
    loading: false,
    writing: false,
    importGuild: "",
    importFiles: [],
    importRows: [],
    guildRoster: [],
    guildRosterOriginal: [],
    deletedMembers: [],
    editorDirty: false,
    protectUnsavedRoster: false,
    analyzing: false,
    firebaseAttendanceReady: false
  };

  const $ = id => document.getElementById(id);
  const el = {
    status: $("connectionStatus"), firebaseStatus: $("firebaseStatus"), versionLabel: $("versionLabel"), aiServiceStatus: $("aiServiceStatus"), mode: $("modeSelect"), refresh: $("refreshButton"), theme: $("themeButton"),
    battleControls: $("battleControls"), guilds: $("guildSelectors"), search: $("searchInput"), filter: $("statusFilter"),
    summary: $("summary"), members: $("membersPanel"), battle: $("battlePanel"), enemies: $("enemiesPanel"), importPanel: $("importPanel"),
    importGuild: $("importGuild"), newGuildButton: $("newGuildButton"), guildDataButton: $("guildDataButton"),
    imageInput: $("imageInput"), imageQueue: $("imageQueue"), imageQueueSummary: $("imageQueueSummary"), analyzeButton: $("analyzeButton"), addManualButton: $("addManualButton"),
    importResults: $("importResults"), importHint: $("importHint"), importActionBar: $("importActionBar"), importCount: $("importCount"),
    importSummaryText: $("importSummaryText"), saveImportButton: $("saveImportButton"), discardImportButton: $("discardImportButton"), toast: $("toast"),
    newGuildDialog: $("newGuildDialog"), newGuildForm: $("newGuildForm"), newGuildName: $("newGuildName"),
    cancelNewGuildButton: $("cancelNewGuildButton"), cancelNewGuildX: $("cancelNewGuildX"),
    guildDataDialog: $("guildDataDialog"), manageGuildName: $("manageGuildName"), guildRoster: $("guildRoster"),
    clearGuildButton: $("clearGuildButton"), deleteGuildButton: $("deleteGuildButton")
  };

  function init() {
    if (el.versionLabel) el.versionLabel.textContent = `v${cfg.VERSION}`;
    applyTheme(state.theme);
    el.mode.value = state.mode;
    setTab(state.tab);

    el.mode.addEventListener("change", async () => {
      state.mode = el.mode.value;
      localStorage.setItem("gbm-mode", state.mode);
      state.version = null;
      window.GBM_FIREBASE_ATTENDANCE?.subscribe(state.mode);
      await checkAiService();
      loadFull(true);
    });
    el.refresh.addEventListener("click", () => loadFull(true));
    el.theme.addEventListener("click", cycleTheme);
    el.search.addEventListener("input", () => { state.search = el.search.value.trim().toLowerCase(); renderPanels(); });
    el.filter.addEventListener("change", () => { state.filter = el.filter.value; renderPanels(); });
    document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    document.addEventListener("change", handleChange);
    window.addEventListener("gbm-firebase-ready", () => {
      state.firebaseAttendanceReady = true;
      window.GBM_FIREBASE_ATTENDANCE?.subscribe(state.mode);
    });
    window.addEventListener("gbm-firebase-connected", () => {
      if(el.firebaseStatus){el.firebaseStatus.className="status ok";el.firebaseStatus.textContent="点呼即時";}
    });
    window.addEventListener("gbm-firebase-attendance", e => {
      const detail=e.detail||{};
      if(detail.mode!==state.mode || !state.data?.members)return;
      const member=state.data.members.find(m=>Number(m.row)===Number(detail.row));
      if(!member || member.attendance===Boolean(detail.checked))return;
      member.attendance=Boolean(detail.checked);
      renderSummary();
      renderMembers();
    });
    window.addEventListener("gbm-firebase-error", e => {
      console.warn("Firebase点呼同期:", e.detail?.message||e.detail||"利用できません");
      if(el.firebaseStatus){el.firebaseStatus.className="status warn";el.firebaseStatus.textContent="点呼通常";}
    });

    el.importGuild.addEventListener("change",async()=>{
      const nextGuild=el.importGuild.value;
      if(state.editorDirty && nextGuild!==state.importGuild){
        const ok=confirm("未保存の変更があります。ギルドを切り替えると変更内容を破棄します。よろしいですか？");
        if(!ok){
          el.importGuild.value=state.importGuild||"";
          return;
        }
        setEditorDirty(false);
      }
      state.importGuild=nextGuild;
      await loadGuildRoster(true,true);
    });
    el.imageInput.addEventListener("change", onImagesSelected);
    el.analyzeButton.addEventListener("click", analyzeQueuedImages);
    el.addManualButton.addEventListener("click", () => addImportRow({playerName:"", entries:[]}, "manual"));
    el.saveImportButton.addEventListener("click", saveImportedRows);
    if(el.discardImportButton)el.discardImportButton.addEventListener("click",async()=>{
      if(state.editorDirty&&!confirm("未保存の変更を破棄して再読込しますか？"))return;
      setEditorDirty(false);
      await loadGuildRoster(true,true);
    });
    el.newGuildButton.addEventListener("click", () => {
      el.newGuildName.value="";
      el.newGuildDialog.showModal();
      setTimeout(()=>el.newGuildName.focus(),50);
    });
    const cancelNewGuild=()=>{
      el.newGuildName.value="";
      if(el.newGuildDialog.open)el.newGuildDialog.close("cancel");
    };
    el.cancelNewGuildButton.addEventListener("click", cancelNewGuild);
    el.cancelNewGuildX.addEventListener("click", cancelNewGuild);
    el.newGuildDialog.addEventListener("cancel", e=>{
      e.preventDefault();
      cancelNewGuild();
    });
    el.newGuildForm.addEventListener("submit", createGuild);
    el.guildDataButton.addEventListener("click", openGuildData);
    el.clearGuildButton.addEventListener("click", clearGuildData);
    el.deleteGuildButton.addEventListener("click", deleteGuildSheet);
    el.guildRoster.addEventListener("click", e => {
      const btn = e.target.closest("[data-delete-member]");
      if (btn) deleteGuildMember(btn.dataset.deleteMember);
    });

    el.importResults.addEventListener("input", onImportRowEdit);
    el.importResults.addEventListener("change", onImportRowEdit);
    // 手入力を終えて欄から離れた時だけ再描画し、変更色/変更前表示を更新。
    el.importResults.addEventListener("focusout", e => {
      if(e.target.matches("[data-import-key],[data-entry-key]")){
        setTimeout(() => renderImportRows(), 0);
      }
    });
    el.importResults.addEventListener("click", e => {
      const btn=e.target.closest("[data-toggle-delete]");
      if(!btn)return;
      const i=Number(btn.dataset.toggleDelete),row=state.importRows[i];if(!row)return;
      if(row.status==="new"&&!row.playerName){state.importRows.splice(i,1)}else{row.deleted=!row.deleted}
      setEditorDirty(true);refreshImportStatuses();renderImportRows();
    });

    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(true); });

    loadFull(true);
    setInterval(() => {
      if (!document.hidden && !state.loading && !state.writing && !state.analyzing) checkVersion(false);
    }, cfg.VERSION_POLL_MS);
  }

  async function loadFull(showBusy=false) {
    if (state.loading || state.writing) return;
    state.loading = true;
    if (showBusy || !state.data) setStatus("loading","同期中");
    el.refresh.disabled = true;
    try {
      const res = await jsonp({action:"data",mode:state.mode}, cfg.FULL_REQUEST_TIMEOUT_MS);
      if (!res?.ok) throw new Error(res?.error || "データ取得失敗");
      state.data = res.data;
      state.version = res.data.version ?? state.version;
      if (!state.importGuild || !(state.data.options.guilds || []).includes(state.importGuild)) {
        state.importGuild = state.data.options.guilds?.[0] || "";
      }
      render();
      window.GBM_FIREBASE_ATTENDANCE?.subscribe(state.mode);
      if (state.importGuild && !state.protectUnsavedRoster) await loadGuildRoster(false);
      setStatus("ok",`同期 ${timeText()}`);
    } catch(err) {
      console.error(err);
      setStatus(state.data ? "warn" : "error", state.data ? "再接続中" : "接続エラー");
    } finally {
      state.loading = false;
      el.refresh.disabled = false;
    }
  }

  async function checkVersion(force=false) {
    if (state.loading || state.writing) return;
    try {
      const res = await jsonp({action:"version",mode:state.mode,t:Date.now()}, cfg.VERSION_REQUEST_TIMEOUT_MS);
      if (!res?.ok) throw new Error(res?.error || "更新確認失敗");
      if (force || state.version===null || String(res.version)!==String(state.version)) await loadFull(false);
      else if (state.data) setStatus("ok",`同期 ${timeText()}`);
    } catch(err) {
      console.warn(err);
      if (state.data) setStatus("warn","再接続中");
    }
  }

  function jsonp(params, timeoutMs) {
    return new Promise((resolve,reject) => {
      const callback = `__gbm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const timeout = setTimeout(() => cleanup(new Error("通信がタイムアウトしました")), timeoutMs || 20000);
      function cleanup(error,data) {
        clearTimeout(timeout);
        try{delete window[callback]}catch{}
        script.remove();
        error ? reject(error) : resolve(data);
      }
      window[callback] = data => cleanup(null,data);
      script.onerror = () => cleanup(new Error("APIへ接続できませんでした"));
      script.src = `${cfg.API_URL}?${new URLSearchParams({...params,callback})}`;
      document.head.appendChild(script);
    });
  }

  async function analyzeImageViaJob(imageData, filename) {
    const jobId = cryptoId();

    // fetch() を完全に使わず、通常のHTMLフォームPOSTで送信する。
    // cross-origin の Apps Script Web App でも、hidden iframe 宛ての
    // form submit ならCORSの影響を受けずに画像を送れる。
    submitPostJobForm({
      action: "analyzeImageJob",
      jobId,
      imageData,
      filename
    });

    const started = Date.now();
    const timeoutMs = cfg.IMAGE_ANALYZE_TIMEOUT_MS || 90000;
    let lastStage = "";

    while (Date.now() - started < timeoutMs) {
      await sleep(1400);
      const res = await jsonp(
        { action: "analysisResult", jobId, t: Date.now() },
        cfg.VERSION_REQUEST_TIMEOUT_MS || 12000
      );

      if (!res?.ok) throw new Error(res?.error || "画像解析結果の取得に失敗しました。");

      if (res.stage && res.stage !== lastStage) {
        lastStage = res.stage;
        setActiveImageStatus(filename, stageLabel(res.stage));
      }

      if (res.status === "done") return res.data;
      if (res.status === "error") throw new Error(res.error || "画像解析に失敗しました。");
    }

    throw new Error("画像解析がタイムアウトしました。");
  }

  function submitPostJobForm(fields) {
    const iframeName = `gbm_post_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");

    const form = document.createElement("form");
    form.method = "POST";
    form.action = cfg.API_URL;
    form.target = iframeName;
    form.enctype = "application/x-www-form-urlencoded";
    form.acceptCharset = "UTF-8";
    form.style.display = "none";

    Object.entries(fields).forEach(([key, value]) => {
      const input = document.createElement("textarea");
      input.name = key;
      input.value = String(value ?? "");
      form.appendChild(input);
    });

    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();

    setTimeout(() => {
      form.remove();
      iframe.remove();
    }, 120000);
  }

  function setActiveImageStatus(filename, text) {
    const target = state.importFiles.find(f => f.name === filename && f.status !== "完了");
    if (target) {
      target.status = text;
      renderImageQueue();
    }
  }

  function stageLabel(stage) {
    const map = {
      submitted: "送信中",
      received: "GAS受信",
      validating: "画像確認",
      ai: "AI解析中",
      parsing: "結果整形",
      done: "完了"
    };
    return map[stage] || stage;
  }

  async function waitForSaveJob(jobId, timeoutMs=90000) {
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      await sleep(900);
      const res=await jsonp(
        {action:"saveGuildResult",jobId,t:Date.now()},
        cfg.VERSION_REQUEST_TIMEOUT_MS || 12000
      );
      if(!res?.ok)throw new Error(res?.error||"保存結果の取得に失敗しました。");
      if(res.status==="done")return res.data||{ok:true};
      if(res.status==="error")throw new Error(res.error||"保存に失敗しました。");
    }
    throw new Error("保存処理がタイムアウトしました。");
  }

  async function checkAiService() {
    if (!el.aiServiceStatus) return;
    try {
      const res = await jsonp(
        { action: "aiStatus", t: Date.now() },
        cfg.VERSION_REQUEST_TIMEOUT_MS || 12000
      );
      if (!res?.ok) throw new Error(res?.error || "状態取得失敗");
      if (res.configured) {
        el.aiServiceStatus.className = "service-status ok";
        el.aiServiceStatus.textContent = `AI接続: 準備OK / ${res.model}`;
      } else {
        el.aiServiceStatus.className = "service-status error";
        el.aiServiceStatus.textContent = "AI接続: APIキー未設定";
      }
    } catch (err) {
      el.aiServiceStatus.className = "service-status warn";
      el.aiServiceStatus.textContent = "AI接続: 状態確認できません";
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function updateField(target) {
    if (state.writing) return;
    state.writing = true;
    target.disabled = true;
    setStatus("loading","保存中");
    const params = {
      action:"update", mode:state.mode, field:target.dataset.field,
      row:target.dataset.row || "", block:target.dataset.block || "",
      value:target.type==="checkbox" ? String(target.checked) : target.value
    };
    if(params.field==="memberAttendance"){
      window.GBM_FIREBASE_ATTENDANCE?.setAttendance(state.mode, Number(params.row), target.checked)
        .catch(err=>console.warn("Firebase点呼書込失敗（Apps Script保存は継続）:",err));
    }
    try {
      const res = await jsonp(params,cfg.FULL_REQUEST_TIMEOUT_MS);
      if (!res?.ok) throw new Error(res?.error || "更新失敗");
      if (res.data) {
        state.data=res.data; state.version=res.version ?? res.data.version ?? state.version; render();
      } else state.version=res.version ?? state.version;
      setStatus("ok",`保存 ${timeText()}`);
    } catch(err) {
      console.error(err); showToast("保存失敗。再同期します",true); setStatus("warn","再接続中"); await loadFull(false);
    } finally {
      state.writing=false; target.disabled=false;
    }
  }

  function handleChange(e) {
    const target=e.target.closest("[data-field]");
    if (target) updateField(target);
  }

  function render() {
    renderGuilds(); renderSummary(); renderPanels(); renderImportGuildOptions(); renderImageQueue(); renderImportRows();
  }

  function renderGuilds() {
    const opts=state.data?.options?.guilds || [];
    el.guilds.innerHTML=(state.data?.battleBlocks || []).map(b=>`
      <label class="guild-item"><span>${b.id}</span><select data-field="guild" data-block="${b.id}">${options(opts,b.guildName,false)}</select></label>`).join("");
  }

  function renderSummary() {
    const ms=(state.data?.members || []).filter(m=>m.name);
    const vals=[
      ["人数",ms.length,""],["リアタイ",ms.filter(m=>m.attendance).length,"good"],["配置のみ",ms.filter(m=>!m.attendance&&m.realtimeNg).length,"warn"],
      ["①済",ms.filter(m=>m.attack1Done).length,""],["②済",ms.filter(m=>m.attack2Done).length,""],["配置済",ms.filter(m=>m.placement).length,""]
    ];
    el.summary.innerHTML=vals.map(([k,v,c])=>`<div class="sum ${c}"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");
  }

  function renderPanels(){ if(!state.data)return; renderMembers();renderBattle();renderEnemies(); }

  function memberFilter(m){
    if(!matches(m.name))return false;
    if(state.filter==="remaining")return !(m.attack1Done&&m.attack2Done);
    if(state.filter==="done1")return m.attack1Done&&!m.attack2Done;
    if(state.filter==="done2")return m.attack2Done;
    if(state.filter==="unassigned")return !m.placement;
    return true;
  }
  function enemyFilter(r){
    if(!matches(`${r.friendly.name} ${r.enemy.name}`))return false;
    if(state.filter==="remaining")return !r.enemy.attack2Done;
    if(state.filter==="done1")return r.enemy.attack1Done&&!r.enemy.attack2Done;
    if(state.filter==="done2")return r.enemy.attack2Done;
    if(state.filter==="unassigned")return !r.enemy.placement;
    return true;
  }

  function renderMembers(){
    const rows=state.data.members.filter(m=>m.name).filter(memberFilter);
    const desk=`<div class="table-wrap"><table class="data-table"><thead><tr><th>状態</th><th>名前</th><th>点呼</th><th>①</th><th>②</th><th>RT×</th><th>配置</th></tr></thead><tbody>${rows.map(m=>`<tr class="${!m.placement?"unassigned":""}">
      <td>${memberState(m)}</td><td><strong>${esc(m.name)}</strong></td><td>${check("memberAttendance",m.row,m.attendance)}</td>
      <td>${check("memberAttack1",m.row,m.attack1Done)}</td><td>${check("memberAttack2",m.row,m.attack2Done)}</td><td>${check("memberRealtimeNg",m.row,m.realtimeNg)}</td>
      <td><select class="placement-select" data-field="memberPlacement" data-row="${m.row}">${options(state.data.options.placements,m.placement,true,"-")}</select></td></tr>`).join("")}</tbody></table></div>`;
    const mob=`<div class="mobile-list">${rows.map(m=>`<div class="mrow"><div class="mrow-top"><span class="mname">${esc(m.name)}</span>${memberState(m)}
      <select class="mobile-placement" data-field="memberPlacement" data-row="${m.row}">${options(state.data.options.placements,m.placement,true,"配置-")}</select></div>
      <div class="mrow-bottom"><span class="mini">点呼</span>${check("memberAttendance",m.row,m.attendance)}<span class="mini">①</span>${check("memberAttack1",m.row,m.attack1Done)}
      <span class="mini">②</span>${check("memberAttack2",m.row,m.attack2Done)}<span class="mini">RT×</span>${check("memberRealtimeNg",m.row,m.realtimeNg)}</div></div>`).join("")}</div>`;
    el.members.innerHTML=rows.length?desk+mob:empty();
  }

  function renderBattle(){
    const block=activeBlock(); const rows=block.rows.filter(r=>r.friendly.name||r.enemy.name).filter(enemyFilter);
    const desk=`<div class="table-wrap"><table class="data-table"><thead><tr><th>味方</th><th>属</th><th>戦1</th><th>戦2</th><th>相手</th><th>①</th><th>②</th><th>相1</th><th>相2</th><th>デバフ</th><th>補正</th><th>弱1</th><th>弱2</th><th>差1</th><th>差2</th></tr></thead>
      <tbody>${rows.map(battleDesktopRow).join("")}</tbody></table></div>`;
    const mob=`<div class="mobile-list">${rows.map(battleMobileRow).join("")}</div>`;
    el.battle.innerHTML=blockButtons()+(rows.length?desk+mob:empty()); bindBlocks(el.battle);
  }

  function battleDesktopRow(r){
    const d1=num(r.friendly.power1)-num(r.enemy.weakenedPower1),d2=num(r.friendly.power2)-num(r.enemy.weakenedPower2);
    return `<tr class="${r.enemy.attack2Done?"row-two":r.enemy.attack1Done?"row-one":""}">
      <td><select class="name-select" data-field="friendlyName" data-row="${r.row}">${options(state.data.options.friendlyMembers,r.friendly.name,true,"未選択")}</select></td>
      <td><span class="attr">${esc(r.friendly.attribute)}</span></td><td>${esc(r.friendly.power1)}</td><td>${esc(r.friendly.power2)}</td><td><strong>${esc(r.enemy.name)}</strong></td>
      <td>${check("enemyAttack1",r.row,r.enemy.attack1Done)}</td><td>${check("enemyAttack2",r.row,r.enemy.attack2Done)}</td><td>${esc(r.enemy.power1)}</td><td>${esc(r.enemy.power2)}</td><td>${esc(r.enemy.debuff)}</td>
      <td><input class="extra-input" type="number" min="0" max="100" step="1" value="${pctNum(r.enemy.extraCorrection)}" data-field="extraCorrection" data-row="${r.row}"></td>
      <td class="${powerClass(d1)}">${esc(r.enemy.weakenedPower1)}</td><td class="${powerClass(d2)}">${esc(r.enemy.weakenedPower2)}</td><td>${diff(d1)}</td><td>${diff(d2)}</td></tr>`;
  }

  function battleMobileRow(r){
    const d1=num(r.friendly.power1)-num(r.enemy.weakenedPower1),d2=num(r.friendly.power2)-num(r.enemy.weakenedPower2);
    return `<div class="mrow"><div class="mrow-top"><div class="mgrow"><select class="mobile-name" data-field="friendlyName" data-row="${r.row}">${options(state.data.options.friendlyMembers,r.friendly.name,true,"未選択")}</select></div>
      <span class="attr">${esc(r.friendly.attribute)}</span><strong>${esc(r.friendly.power1)}/${esc(r.friendly.power2)}</strong></div>
      <div class="mrow-bottom"><strong class="mgrow">${esc(r.enemy.name)}</strong><span class="mini">①</span>${check("enemyAttack1",r.row,r.enemy.attack1Done)}<span class="mini">②</span>${check("enemyAttack2",r.row,r.enemy.attack2Done)}</div>
      <div class="mrow-bottom"><span class="mini">相</span><strong>${esc(r.enemy.power1)}/${esc(r.enemy.power2)}</strong><span class="mini">弱</span><strong class="${powerClass(d1)}">${esc(r.enemy.weakenedPower1)}</strong>/<strong class="${powerClass(d2)}">${esc(r.enemy.weakenedPower2)}</strong>
      <span class="spacer"></span><span class="mini">DB</span><strong>${esc(r.enemy.debuff)}</strong><input class="extra-input" type="number" min="0" max="100" step="1" value="${pctNum(r.enemy.extraCorrection)}" data-field="extraCorrection" data-row="${r.row}"></div></div>`;
  }

  function renderEnemies(){
    const block=activeBlock(); const rows=block.rows.filter(r=>r.enemy.name).filter(enemyFilter);
    const desk=`<div class="table-wrap"><table class="data-table"><thead><tr><th>相手</th><th>状態</th><th>①</th><th>②</th><th>配置</th></tr></thead><tbody>${rows.map(r=>`<tr class="${!r.enemy.placement?"unassigned":""}">
      <td><strong>${esc(r.enemy.name)}</strong></td><td>${enemyBadge(r)}</td><td>${check("enemyAttack1",r.row,r.enemy.attack1Done)}</td><td>${check("enemyAttack2",r.row,r.enemy.attack2Done)}</td>
      <td><select class="placement-select" data-field="enemyPlacement" data-row="${r.row}">${options(state.data.options.placements,r.enemy.placement,true,"-")}</select></td></tr>`).join("")}</tbody></table></div>`;
    const mob=`<div class="mobile-list">${rows.map(r=>`<div class="mrow"><div class="mrow-top"><span class="mname">${esc(r.enemy.name)}</span>${enemyBadge(r)}
      <select class="mobile-placement" data-field="enemyPlacement" data-row="${r.row}">${options(state.data.options.placements,r.enemy.placement,true,"配置-")}</select></div>
      <div class="mrow-bottom"><span class="mini">①</span>${check("enemyAttack1",r.row,r.enemy.attack1Done)}<span class="mini">②</span>${check("enemyAttack2",r.row,r.enemy.attack2Done)}</div></div>`).join("")}</div>`;
    el.enemies.innerHTML=blockButtons()+(rows.length?desk+mob:empty());bindBlocks(el.enemies);
  }

  function renderImportGuildOptions(){
    if(!state.data)return;
    const guilds=state.data.options.guilds || [];
    el.importGuild.innerHTML=options(guilds,state.importGuild,false);
    if(!state.importGuild && guilds.length){state.importGuild=guilds[0];el.importGuild.value=state.importGuild}
  }

  async function onImagesSelected(e){
    const files=[...e.target.files];
    e.target.value="";
    const max=cfg.MAX_BATCH_IMAGES||50;
    const available=Math.max(0,max-state.importFiles.length);
    if(files.length>available){
      showToast(`一度に保持できるスクショは最大${max}枚です。追加できる${available}枚だけ読み込みます。`,true);
    }
    for(const file of files.slice(0,available)){
      if(!file.type.startsWith("image/"))continue;
      const prepared=await prepareImage(file);
      state.importFiles.push({
        id:cryptoId(),name:file.name,dataUrl:prepared.dataUrl,preview:prepared.preview,
        status:"待機",attempts:0,rounds:0,lastError:"",nextRetryAt:0
      });
    }
    renderImageQueue();
  }

  async function prepareImage(file){
    const dataUrl=await readAsDataURL(file);
    const img=await loadImage(dataUrl);
    const maxW=1600,maxH=2400,ratio=Math.min(1,maxW/img.width,maxH/img.height);
    const w=Math.max(1,Math.round(img.width*ratio)),h=Math.max(1,Math.round(img.height*ratio));
    const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
    canvas.getContext("2d",{alpha:false}).drawImage(img,0,0,w,h);
    const compressed=canvas.toDataURL("image/jpeg",.84);
    return {dataUrl:compressed,preview:compressed};
  }
  function readAsDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})}
  function loadImage(src){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src})}

  function renderImageQueue(){
    el.imageQueue.innerHTML=state.importFiles.map((f,i)=>`<div class="image-chip"><img src="${f.preview}" alt="${esc(f.name)}"><button type="button" data-remove-image="${i}" ${state.analyzing?"disabled":""}>×</button><span class="queue-state">${esc(f.status)}</span></div>`).join("");
    el.imageQueue.querySelectorAll("[data-remove-image]").forEach(btn=>btn.addEventListener("click",()=>{
      if(state.analyzing)return;
      state.importFiles.splice(Number(btn.dataset.removeImage),1);renderImageQueue()
    }));
    el.analyzeButton.disabled=!state.importFiles.some(f=>f.status!=="完了") || state.analyzing;
    updateQueueSummary();
  }

  function updateQueueSummary(){
    if(!el.imageQueueSummary)return;
    const total=state.importFiles.length;
    if(!total){el.imageQueueSummary.textContent="待機中";return}
    const done=state.importFiles.filter(f=>f.status==="完了").length;
    const failed=state.importFiles.filter(f=>f.status==="失敗").length;
    const retry=state.importFiles.filter(f=>String(f.status||"").includes("再試行")).length;
    const active=state.importFiles.filter(f=>["送信中","GAS受信","画像確認","AI解析中","結果整形"].includes(f.status)).length;
    const waiting=Math.max(0,total-done-failed-retry-active);
    el.imageQueueSummary.textContent=`${total}枚中 ${done}完了 / ${active}処理中 / ${retry}再試行 / ${waiting}待機 / ${failed}失敗`;
  }

  async function analyzeQueuedImages(){
    if(state.analyzing)return;
    const targets=state.importFiles.filter(f=>f.status!=="完了");
    if(!targets.length)return;

    // 手動で再実行したときは、前回「失敗」した画像も新しい巡回として復帰。
    targets.forEach(f=>{if(f.status==="失敗")f.status="再試行待ち"});

    state.analyzing=true;
    // 解析開始後に黄色になった未保存結果は、保存/破棄まで自動同期から保護する。
    state.protectUnsavedRoster=true;
    el.analyzeButton.disabled=true;el.imageInput.disabled=true;
    const maxRounds=Math.max(1,Number(cfg.IMAGE_REQUEUE_MAX_ROUNDS)||6);
    const baseWait=Math.max(2000,Number(cfg.IMAGE_REQUEUE_BASE_WAIT_MS)||10000);

    try{
      for(let round=1;round<=maxRounds;round++){
        const queue=state.importFiles.filter(f=>f.status!=="完了"&&f.status!=="失敗");
        if(!queue.length)break;

        for(const f of queue){
          f.rounds=round;
          f.attempts=(f.attempts||0)+1;
          f.status=round===1?"送信中":`再試行 ${round}/${maxRounds}`;
          renderImageQueue();

          try{
            const parsed=await analyzeImageViaJob(f.dataUrl,f.name);
            // 1枚完了するたびに既存テーブルへ即時反映して画面更新。
            addImportRow(parsed,f.name,true);
            f.status="完了";
            f.lastError="";
          }catch(err){
            console.error(err);
            f.lastError=err.message||String(err);
            f.status=round>=maxRounds?"失敗":`再試行待ち ${round}/${maxRounds}`;
          }
          renderImageQueue();
        }

        const remain=state.importFiles.filter(f=>f.status!=="完了"&&f.status!=="失敗");
        if(!remain.length)break;

        if(round<maxRounds){
          const waitMs=Math.min(baseWait*Math.pow(2,round-1),120000);
          remain.forEach(f=>{
            f.status=`再試行待ち ${Math.ceil(waitMs/1000)}秒`;
            f.nextRetryAt=Date.now()+waitMs;
          });
          renderImageQueue();
          await sleep(waitMs);
        }
      }

      refreshImportStatuses();
      renderImportRows();

      const failed=state.importFiles.filter(f=>f.status==="失敗");
      if(failed.length){
        showToast(`${failed.length}枚は自動再解析を使い切りました。もう一度AI解析を押すと、その失敗分だけ再開します。`,true);
      }else{
        showToast(`${state.importFiles.filter(f=>f.status==="完了").length}枚の解析が完了しました`);
      }
    }finally{
      state.analyzing=false;el.imageInput.disabled=false;renderImageQueue();
    }
  }

  function addImportRow(parsed,source="manual",rerender=true){
    const entries=[...(parsed.entries||[])].slice(0,3);
    while(entries.length<3)entries.push({attribute:"",power:"",rawText:"",confidence:1});
    const normalizedEntries=entries.map(x=>({
      attribute:x.attribute||"",
      power:source==="manual"?(x.power??""):toManPower(x.power),
      rawText:x.rawText||"",
      confidence:Number(x.confidence??1)
    }));
    const playerName=String(parsed.playerName||"").trim();
    const existingIndex=state.importRows.findIndex(r=>norm(r.playerName)===norm(playerName) && playerName);
    if(existingIndex>=0){
      const target=state.importRows[existingIndex];
      if(target.originalPlayerName===undefined)target.originalPlayerName=target.playerName||"";
      if(!Array.isArray(target.originalEntries)){
        target.originalEntries=(target.entries||[]).map(e=>({attribute:e.attribute||"",power:e.power??""}));
      }
      target.playerName=playerName||target.playerName;
      target.entries=normalizedEntries;
      target.source=source;
      target.notes=parsed.notes||"";
      target.aiUpdated=true;
      target.deleted=false;
    }else{
      state.importRows.push({
        id:cryptoId(),
        playerName,
        originalPlayerName:"",
        entries:normalizedEntries,
        originalEntries:[{attribute:"",power:""},{attribute:"",power:""},{attribute:"",power:""}],
        source,
        status:"new",
        notes:parsed.notes||"",
        aiUpdated:source!=="manual",
        deleted:false
      });
    }
    setEditorDirty(true);
    refreshImportStatuses();
    if(rerender!==false)renderImportRows();
  }

  function setEditorDirty(flag=true){
    state.editorDirty=!!flag;
    state.protectUnsavedRoster=!!flag;
  }

  function refreshImportStatuses(){
    const names=new Set(state.guildRosterOriginal.map(r=>norm(r.playerName)));
    state.importRows.forEach(r=>{
      r.status=r.deleted?"deleted":(r.playerName&&names.has(norm(r.playerName))?"update":"new");
    });
  }

  function isChangedValue(current, original){
    return String(current??"").trim()!==String(original??"").trim();
  }

  function diffMeta(row,index,key){
    if(row.status==="new")return {changed:true,oldValue:""};
    if(key==="playerName"){
      const oldValue=row.originalPlayerName??"";
      return {changed:isChangedValue(row.playerName,oldValue),oldValue};
    }
    const oldEntry=(row.originalEntries||[])[index]||{};
    const current=(row.entries||[])[index]||{};
    const oldValue=oldEntry[key]??"";
    return {changed:isChangedValue(current[key],oldValue),oldValue};
  }

  function renderImportRows(){
    if(!state.importRows.length){
      el.importResults.innerHTML=`<div class="empty-state"><div>📋</div><strong>登録データがありません</strong><span>スクショを追加するか、手入力で新規メンバーを追加してください。</span></div>`;
      el.importCount.textContent="0件";
      el.importSummaryText.textContent="変更なし";
      el.importActionBar.classList.remove("hidden");
      el.saveImportButton.disabled=true;
      return;
    }

    el.importResults.innerHTML=state.importRows.map((r,i)=>{
      const confVals=r.entries.filter(e=>e.power!=="").map(e=>Number(e.confidence)||0);
      const conf=Math.min(...(confVals.length?confVals:[1]));
      const confClass=conf>=.85?"high":conf>=.6?"mid":"low";
      const confText=conf>=.85?"読取良好":conf>=.6?"要確認":"手修正推奨";

      const nameDiff=diffMeta(r,0,"playerName");
      const changedCells=[
        nameDiff.changed,
        ...r.entries.flatMap((e,j)=>[
          diffMeta(r,j,"attribute").changed,
          diffMeta(r,j,"power").changed
        ])
      ].filter(Boolean).length;

      const rowClass=[
        "import-row",
        r.aiUpdated?"ai-updated":"",
        r.status==="new"?"is-new":"",
        r.deleted?"is-deleted":"",
        changedCells?"has-diff":""
      ].filter(Boolean).join(" ");

      return `<div class="${rowClass}" data-import-index="${i}">
        <div class="import-row-head">
          <div class="field-with-diff name-field-wrap">
            <input class="player-input ${nameDiff.changed?"changed-field":""}" data-import-key="playerName" value="${escAttr(r.playerName)}" placeholder="プレイヤー名" ${r.deleted?"disabled":""}>
            ${nameDiff.changed&&r.status!=="new"?`<div class="old-value">変更前: ${esc(nameDiff.oldValue||"空欄")}</div>`:""}
          </div>
          <div class="row-badges">
            <span class="row-status ${r.status}">${r.deleted?"削除予定":r.status==="update"?"既存":"新規"}</span>
            ${r.aiUpdated&&!r.deleted?`<span class="ai-badge">AI更新</span>`:""}
            ${changedCells&&!r.deleted?`<span class="diff-badge">${changedCells}項目変更</span>`:""}
          </div>
          <button class="remove-row danger" type="button" data-toggle-delete="${i}" aria-label="${r.deleted?"削除取消":"削除"}">${r.deleted?"↩":"🗑"}</button>
        </div>

        <div class="power-grid">${r.entries.map((e,j)=>{
          const attrDiff=diffMeta(r,j,"attribute");
          const powerDiff=diffMeta(r,j,"power");
          return `<div class="power-entry">
            <div class="field-with-diff">
              <select class="${attrDiff.changed?"changed-field":""}" data-entry-index="${j}" data-entry-key="attribute" ${r.deleted?"disabled":""}>
                ${options(["火","水","草"],e.attribute,true,"属性")}
              </select>
              ${attrDiff.changed&&r.status!=="new"?`<div class="old-value">変更前: ${esc(attrDiff.oldValue||"空欄")}</div>`:""}
            </div>
            <div class="field-with-diff">
              <label class="power-man-input ${powerDiff.changed?"changed-field-wrap":""}">
                <input class="${powerDiff.changed?"changed-field":""}" type="number" min="0" step="1" inputmode="numeric" data-entry-index="${j}" data-entry-key="power" value="${escAttr(e.power)}" placeholder="戦力" ${r.deleted?"disabled":""}>
                <span>万</span>
              </label>
              ${powerDiff.changed&&r.status!=="new"?`<div class="old-value">変更前: ${esc(powerDiff.oldValue===""?"空欄":String(powerDiff.oldValue)+"万")}</div>`:""}
            </div>
          </div>`;
        }).join("")}</div>

        <div class="import-meta">
          <span>${esc(r.source||"既存データ")}</span>
          ${r.aiUpdated&&!r.deleted?`<span class="confidence ${confClass}">● ${confText}</span>`:""}
          ${r.notes&&!r.deleted?`<span>${esc(r.notes)}</span>`:""}
        </div>
      </div>`;
    }).join("");

    const active=state.importRows.filter(r=>!r.deleted);
    const updates=active.filter(r=>validImportRow(r)&&r.status==="update").length;
    const news=active.filter(r=>validImportRow(r)&&r.status==="new").length;
    const dels=state.importRows.filter(r=>r.deleted).length;

    el.importCount.textContent=`${active.length}件`;
    el.importSummaryText.textContent=state.editorDirty
      ? `変更あり｜更新 ${updates} / 新規 ${news} / 削除 ${dels}｜未保存データ保護中`
      : `変更なし｜登録 ${active.length}件`;
    el.importActionBar.classList.remove("hidden");
    el.saveImportButton.disabled=!state.editorDirty||!state.importGuild;
  }

  function updateImportSummaryOnly(){
    if(!el.importSummaryText || !el.importCount || !el.saveImportButton)return;
    const active=state.importRows.filter(r=>!r.deleted);
    const updates=active.filter(r=>validImportRow(r)&&r.status==="update").length;
    const news=active.filter(r=>validImportRow(r)&&r.status==="new").length;
    const dels=state.importRows.filter(r=>r.deleted).length;
    el.importCount.textContent=`${active.length}件`;
    el.importSummaryText.textContent=state.editorDirty
      ? `変更あり｜更新 ${updates} / 新規 ${news} / 削除 ${dels}｜未保存データ保護中`
      : `変更なし｜登録 ${active.length}件`;
    el.saveImportButton.disabled=!state.editorDirty||!state.importGuild;
  }

  function onImportRowEdit(e){
    const rowEl=e.target.closest("[data-import-index]");if(!rowEl)return;
    const i=Number(rowEl.dataset.importIndex),row=state.importRows[i];if(!row||row.deleted)return;
    if(e.target.dataset.importKey==="playerName"){
      row.playerName=e.target.value;
    }else{
      const j=Number(e.target.dataset.entryIndex),key=e.target.dataset.entryKey;
      if(!Number.isInteger(j)||!row.entries[j]||!key)return;
      row.entries[j][key]=e.target.value;
    }
    row.aiUpdated=false;
    setEditorDirty(true);
    refreshImportStatuses();
    // 入力中にrenderImportRows()するとinput自体が作り直され、
    // スマホでは1文字ごとにフォーカスとキーボードが閉じる。
    // 入力中はDOMを維持し、件数/保存ボタンだけ更新する。
    updateImportSummaryOnly();
  }

  function validImportRow(r){
    return String(r.playerName||"").trim() && r.entries.some(e=>Number(e.power)>0 && ["火","水","草","不明"].includes(e.attribute));
  }

  async function saveImportedRows(){
    if(!state.importGuild||!state.editorDirty)return;
    const rows=state.importRows.filter(r=>!r.deleted&&validImportRow(r)).map(r=>({
      playerName:r.playerName.trim(),
      entries:r.entries.filter(e=>Number(e.power)>0).slice(0,3).map(e=>({attribute:e.attribute,power:Number(e.power)}))
    }));
    const deletePlayers=state.importRows.filter(r=>r.deleted&&r.status!=="new").map(r=>r.playerName.trim()).filter(Boolean);
    if(!confirm(`${state.importGuild} の変更を保存します。\n登録/更新 ${rows.length}人・削除 ${deletePlayers.length}人\nよろしいですか？`))return;
    el.saveImportButton.disabled=true;el.saveImportButton.textContent="保存中…";
    try{
      // 50人分をJSONP(GET)に載せるとURL長制限を超えるため、保存本体はPOST。
      // 結果だけ短いJSONP(GET)で確認する。
      const saveJobId=cryptoId();
      submitPostJobForm({
        action:"saveGuildEditorJob",
        jobId:saveJobId,
        guild:state.importGuild,
        payload:JSON.stringify({rows,deletePlayers})
      });
      const res=await waitForSaveJob(saveJobId,90000);
      if(!res?.ok)throw new Error(res?.error||"保存失敗");
      showToast(`保存完了：更新 ${res.updated||0} / 新規 ${res.created||0} / 削除 ${res.deleted||0}`);
      setEditorDirty(false);
      await loadGuildRoster(false,true);
      await loadFull(false);
    }catch(err){console.error(err);showToast(err.message,true)}
    finally{el.saveImportButton.disabled=false;el.saveImportButton.textContent="変更をまとめて保存"}
  }

  async function loadGuildRoster(showError=true,forceReload=false){
    // 未保存変更がある間は、通常の同期や再取得で編集内容を上書きしない。
    if(state.protectUnsavedRoster && !forceReload){
      return {ok:true,protected:true};
    }
    if(!state.importGuild){
      state.guildRoster=[];state.guildRosterOriginal=[];state.importRows=[];setEditorDirty(false);renderImportRows();return;
    }
    try{
      const res=await jsonp({action:"guildRoster",guild:state.importGuild,t:Date.now()},20000);
      if(!res?.ok)throw new Error(res?.error||"ギルドデータ取得失敗");
      state.guildRoster=res.rows||[];
      state.guildRosterOriginal=JSON.parse(JSON.stringify(state.guildRoster));
      state.importRows=state.guildRoster.map(r=>({
        id:cryptoId(),
        playerName:r.playerName||"",
        originalPlayerName:r.playerName||"",
        entries:(r.entries||[]).slice(0,3).map(e=>({attribute:e.attribute||"",power:e.power??"",rawText:"",confidence:1})),
        originalEntries:(r.entries||[]).slice(0,3).map(e=>({attribute:e.attribute||"",power:e.power??""})),
        source:"既存データ",status:"update",notes:"",aiUpdated:false,deleted:false
      }));
      setEditorDirty(false);refreshImportStatuses();renderImportRows();
    }catch(err){if(showError)showToast(err.message,true)}
  }

  async function createGuild(e){
    e.preventDefault();
    // 「作成」submit の時だけここへ来る。キャンセル/×/Esc は別処理。
    const name=el.newGuildName.value.trim();if(!name)return;
    try{
      const res=await jsonp({action:"createGuild",name},30000);
      if(!res?.ok)throw new Error(res?.error||"作成失敗");
      el.newGuildDialog.close();showToast(`${name} を作成しました`);
      state.importGuild=name;await loadFull(false);renderImportGuildOptions();el.importGuild.value=name;await loadGuildRoster(false);showToast(`${name} を作成し、プルダウン用K列にも登録しました`);
    }catch(err){showToast(err.message,true)}
  }

  async function openGuildData(){
    if(!state.importGuild)return;
    await loadGuildRoster();
    el.manageGuildName.textContent=state.importGuild;
    renderGuildRoster();
    el.deleteGuildButton.disabled=state.importGuild==="Lealoha";
    el.guildDataDialog.showModal();
  }

  function renderGuildRoster(){
    if(!state.guildRoster.length){el.guildRoster.innerHTML=`<div class="empty">登録データなし</div>`;return}
    el.guildRoster.innerHTML=state.guildRoster.map(r=>`<div class="roster-row">
      <strong>${esc(r.playerName)}</strong>
      <span class="roster-powers">${r.entries.map(e=>`${esc(e.attribute)} ${formatPower(e.power)}万`).join(" / ")}</span>
      <button class="roster-delete" type="button" data-delete-member="${escAttr(r.playerName)}">削除</button>
    </div>`).join("");
  }

  async function deleteGuildMember(playerName){
    if(!confirm(`${playerName} の戦力データを削除しますか？`))return;
    try{
      const res=await jsonp({action:"deleteGuildMember",guild:state.importGuild,player:playerName},30000);
      if(!res?.ok)throw new Error(res?.error||"削除失敗");
      await loadGuildRoster(false);renderGuildRoster();refreshImportStatuses();renderImportRows();showToast(`${playerName} を削除しました`);
    }catch(err){showToast(err.message,true)}
  }

  async function clearGuildData(){
    if(!confirm(`${state.importGuild} のプレイヤー名・属性・戦力データをすべて削除します。\nこの操作は元に戻せません。`))return;
    try{
      const res=await jsonp({action:"clearGuildData",guild:state.importGuild},30000);
      if(!res?.ok)throw new Error(res?.error||"削除失敗");
      await loadGuildRoster(false);renderGuildRoster();refreshImportStatuses();renderImportRows();showToast("戦力データを全削除しました");
    }catch(err){showToast(err.message,true)}
  }

  async function deleteGuildSheet(){
    if(state.importGuild==="Lealoha"){showToast("テンプレートの Lealoha は削除できません",true);return}
    const typed=prompt(`ギルドシート「${state.importGuild}」を削除します。\n確認のためギルド名を入力してください。`);
    if(typed!==state.importGuild)return;
    try{
      const res=await jsonp({action:"deleteGuild",name:state.importGuild},30000);
      if(!res?.ok)throw new Error(res?.error||"削除失敗");
      el.guildDataDialog.close();state.importGuild="";state.guildRoster=[];await loadFull(false);showToast("ギルドシートを削除しました");
    }catch(err){showToast(err.message,true)}
  }

  function memberState(m){const c=m.attendance?"rt":m.realtimeNg?"place":"none";return `<span class="state ${c}">${esc(m.status)}</span>`}
  function enemyBadge(r){return r.enemy.attack2Done?`<span class="badge two">②済</span>`:r.enemy.attack1Done?`<span class="badge one">①済</span>`:`<span class="badge zero">未</span>`}
  function check(field,row,on){return `<label class="check"><input type="checkbox" data-field="${field}" data-row="${row}" ${on?"checked":""}></label>`}
  function activeBlock(){return state.data.battleBlocks.find(b=>b.id===state.blockId)||state.data.battleBlocks[0]}
  function blockButtons(){return `<div class="block-switcher">${state.data.battleBlocks.map(b=>`<button class="block-button ${b.id===state.blockId?"active":""}" data-block-id="${b.id}" type="button">${b.id}. ${esc(b.guildName||"未選択")}</button>`).join("")}</div>`}
  function bindBlocks(root){root.querySelectorAll("[data-block-id]").forEach(b=>b.addEventListener("click",()=>{state.blockId=Number(b.dataset.blockId);localStorage.setItem("gbm-block",state.blockId);renderPanels()}))}
  function setTab(tab){
    state.tab=tab;localStorage.setItem("gbm-tab",tab);
    document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));$(`${tab}Panel`)?.classList.add("active");
    const importing=tab==="import";el.battleControls.style.display=importing?"none":"";el.summary.style.display=importing?"none":"";
    if(importing && state.importGuild && !state.guildRoster.length)loadGuildRoster(false).then(()=>{refreshImportStatuses();renderImportRows()});
  }

  function applyTheme(theme){state.theme=theme;document.documentElement.dataset.theme=theme;localStorage.setItem("gbm-theme",theme);el.theme.textContent=theme==="light"?"☀":theme==="dark"?"☾":"◐";el.theme.title=`テーマ: ${theme==="light"?"ライト":theme==="dark"?"ダーク":"端末設定"}`}
  function cycleTheme(){const seq=["system","light","dark"],i=seq.indexOf(state.theme);applyTheme(seq[(i+1)%seq.length]);showToast(el.theme.title)}
  function options(vals,selected,blank=false,blankLabel=""){const list=[...new Set((vals||[]).map(String).filter(Boolean))];if(selected&&!list.includes(String(selected)))list.unshift(String(selected));return(blank?`<option value="">${esc(blankLabel)}</option>`:"")+list.map(v=>`<option value="${escAttr(v)}" ${String(v)===String(selected)?"selected":""}>${esc(v)}</option>`).join("")}
  function matches(s){return !state.search||String(s||"").toLowerCase().includes(state.search)}
  function pctNum(v){const n=Number(String(v||"").replace("%","").replace(",","."));return Number.isFinite(n)?n:""}
  function num(v){const n=Number(String(v||"").replace(/[^\d.-]/g,""));return Number.isFinite(n)?n:0}
  function diff(v){const c=v>0?"plus":v<0?"minus":"zero";return `<span class="diff ${c}">${v>0?"+":""}${v.toLocaleString("ja-JP")}</span>`}
  function powerClass(v){return v>=0?"power-good":"power-bad"}

  function toManPower(value){
    if(value===""||value==null)return "";
    const n=Number(value);
    if(!Number.isFinite(n)||n<0)return "";
    return Math.floor(n/10000);
  }

  function formatPower(v){const n=Number(v)||0;return n.toLocaleString("ja-JP")}
  function norm(v){return String(v||"").normalize("NFKC").trim().toLowerCase()}
  function cryptoId(){return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}
  function timeText(){return new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
  function setStatus(c,t){el.status.className=`status ${c}`;el.status.textContent=t}
  let toastTimer;function showToast(t,error=false){clearTimeout(toastTimer);el.toast.textContent=t;el.toast.className=`toast show${error?" error":""}`;toastTimer=setTimeout(()=>el.toast.className="toast",2600)}
  function empty(){return `<div class="empty">該当データなし</div>`}
  function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
  function escAttr(v){return esc(v)}

  init();
})();
