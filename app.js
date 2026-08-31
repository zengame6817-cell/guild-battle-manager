(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
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
    analyzing: false
  };

  const $ = id => document.getElementById(id);
  const el = {
    status: $("connectionStatus"), mode: $("modeSelect"), refresh: $("refreshButton"), theme: $("themeButton"),
    battleControls: $("battleControls"), guilds: $("guildSelectors"), search: $("searchInput"), filter: $("statusFilter"),
    summary: $("summary"), members: $("membersPanel"), battle: $("battlePanel"), enemies: $("enemiesPanel"), importPanel: $("importPanel"),
    importGuild: $("importGuild"), newGuildButton: $("newGuildButton"), guildDataButton: $("guildDataButton"),
    imageInput: $("imageInput"), imageQueue: $("imageQueue"), analyzeButton: $("analyzeButton"), addManualButton: $("addManualButton"),
    importResults: $("importResults"), importHint: $("importHint"), importActionBar: $("importActionBar"), importCount: $("importCount"),
    importSummaryText: $("importSummaryText"), saveImportButton: $("saveImportButton"), toast: $("toast"),
    newGuildDialog: $("newGuildDialog"), newGuildForm: $("newGuildForm"), newGuildName: $("newGuildName"),
    guildDataDialog: $("guildDataDialog"), manageGuildName: $("manageGuildName"), guildRoster: $("guildRoster"),
    clearGuildButton: $("clearGuildButton"), deleteGuildButton: $("deleteGuildButton")
  };

  function init() {
    applyTheme(state.theme);
    el.mode.value = state.mode;
    setTab(state.tab);

    el.mode.addEventListener("change", async () => {
      state.mode = el.mode.value;
      localStorage.setItem("gbm-mode", state.mode);
      state.version = null;
      await loadFull(true);
    });
    el.refresh.addEventListener("click", () => loadFull(true));
    el.theme.addEventListener("click", cycleTheme);
    el.search.addEventListener("input", () => { state.search = el.search.value.trim().toLowerCase(); renderPanels(); });
    el.filter.addEventListener("change", () => { state.filter = el.filter.value; renderPanels(); });
    document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    document.addEventListener("change", handleChange);

    el.importGuild.addEventListener("change", async () => {
      state.importGuild = el.importGuild.value;
      await loadGuildRoster();
      refreshImportStatuses();
      renderImportRows();
    });
    el.imageInput.addEventListener("change", onImagesSelected);
    el.analyzeButton.addEventListener("click", analyzeQueuedImages);
    el.addManualButton.addEventListener("click", () => addImportRow({playerName:"", entries:[]}, "manual"));
    el.saveImportButton.addEventListener("click", saveImportedRows);
    el.newGuildButton.addEventListener("click", () => { el.newGuildName.value=""; el.newGuildDialog.showModal(); setTimeout(()=>el.newGuildName.focus(),50); });
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
    el.importResults.addEventListener("click", e => {
      const btn = e.target.closest("[data-remove-import]");
      if (!btn) return;
      state.importRows.splice(Number(btn.dataset.removeImport), 1);
      renderImportRows();
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
      if (state.importGuild) await loadGuildRoster(false);
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
    const payload = {
      action: "analyzeImageJob",
      jobId,
      imageData,
      filename
    };

    // Apps Script Web Appへのcross-origin POSTはレスポンス読取で
    // "Failed to fetch" になることがあるため、no-corsで投げて
    // 結果はJSONP(GET)で別取得する。
    fetch(cfg.API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
      keepalive: false
    }).catch(err => console.warn("analysis submit:", err));

    const started = Date.now();
    const timeoutMs = cfg.IMAGE_ANALYZE_TIMEOUT_MS || 90000;

    while (Date.now() - started < timeoutMs) {
      await sleep(1400);
      const res = await jsonp(
        { action: "analysisResult", jobId, t: Date.now() },
        cfg.VERSION_REQUEST_TIMEOUT_MS || 12000
      );

      if (!res?.ok) throw new Error(res?.error || "画像解析結果の取得に失敗しました。");
      if (res.status === "done") return res.data;
      if (res.status === "error") throw new Error(res.error || "画像解析に失敗しました。");
    }

    throw new Error("画像解析がタイムアウトしました。");
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
    for(const file of files){
      if(!file.type.startsWith("image/"))continue;
      const prepared=await prepareImage(file);
      state.importFiles.push({id:cryptoId(),name:file.name,dataUrl:prepared.dataUrl,preview:prepared.preview,status:"待機"});
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
    el.imageQueue.innerHTML=state.importFiles.map((f,i)=>`<div class="image-chip"><img src="${f.preview}" alt="${esc(f.name)}"><button type="button" data-remove-image="${i}">×</button><span class="queue-state">${esc(f.status)}</span></div>`).join("");
    el.imageQueue.querySelectorAll("[data-remove-image]").forEach(btn=>btn.addEventListener("click",()=>{state.importFiles.splice(Number(btn.dataset.removeImage),1);renderImageQueue()}));
    el.analyzeButton.disabled=!state.importFiles.some(f=>f.status!=="完了") || state.analyzing;
  }

  async function analyzeQueuedImages(){
    if(state.analyzing)return;
    const targets=state.importFiles.filter(f=>f.status!=="完了");
    if(!targets.length)return;
    state.analyzing=true;el.analyzeButton.disabled=true;el.imageInput.disabled=true;
    try{
      for(let i=0;i<targets.length;i++){
        const f=targets[i];f.status=`解析 ${i+1}/${targets.length}`;renderImageQueue();
        try{
          const parsed=await analyzeImageViaJob(f.dataUrl,f.name);
          addImportRow(parsed,f.name,false);
          f.status="完了";
        }catch(err){
          console.error(err);f.status="失敗";showToast(`${f.name}: ${err.message}`,true);
        }
        renderImageQueue();
      }
    }finally{
      state.analyzing=false;el.imageInput.disabled=false;renderImageQueue();
    }
  }

  function addImportRow(parsed,source="manual",rerender=true){
    const entries=[...(parsed.entries||[])].slice(0,3);
    while(entries.length<3)entries.push({attribute:"",power:"",rawText:"",confidence:1});
    state.importRows.push({
      id:cryptoId(),playerName:parsed.playerName||"",entries:entries.map(x=>({attribute:x.attribute||"",power:x.power??"",rawText:x.rawText||"",confidence:Number(x.confidence??1)})),
      source,status:"new",notes:parsed.notes||""
    });
    refreshImportStatuses();
    if(rerender!==false)renderImportRows();
  }

  function refreshImportStatuses(){
    const names=new Set(state.guildRoster.map(r=>norm(r.playerName)));
    state.importRows.forEach(r=>{r.status=r.playerName && names.has(norm(r.playerName))?"update":"new"});
  }

  function renderImportRows(){
    if(!state.importRows.length){
      el.importResults.innerHTML=`<div class="empty-state"><div>📸</div><strong>まだ解析データがありません</strong><span>スクショを追加するか、手入力を選んでください。</span></div>`;
      el.importActionBar.classList.add("hidden");return;
    }
    el.importResults.innerHTML=state.importRows.map((r,i)=>{
      const conf=Math.min(...r.entries.filter(e=>e.power!=="").map(e=>Number(e.confidence)||0),1);
      const confClass=conf>=.85?"high":conf>=.6?"mid":"low";
      const confText=conf>=.85?"読取良好":conf>=.6?"要確認":"手修正推奨";
      return `<div class="import-row" data-import-index="${i}">
        <div class="import-row-head">
          <input class="player-input" data-import-key="playerName" value="${escAttr(r.playerName)}" placeholder="プレイヤー名">
          <span class="row-status ${r.status}">${r.status==="update"?"既存 → 更新":"新規"}</span>
          <button class="remove-row" type="button" data-remove-import="${i}" aria-label="削除">×</button>
        </div>
        <div class="power-grid">${r.entries.map((e,j)=>`<div class="power-entry">
          <select data-entry-index="${j}" data-entry-key="attribute">
            ${options(["火","水","草","不明"],e.attribute,true,"属性")}
          </select>
          <input type="number" min="0" step="1" inputmode="numeric" data-entry-index="${j}" data-entry-key="power" value="${escAttr(e.power)}" placeholder="戦力">
        </div>`).join("")}</div>
        <div class="import-meta"><span>${esc(r.source)}</span><span class="confidence ${confClass}">● ${confText}</span>${r.notes?`<span>${esc(r.notes)}</span>`:""}</div>
      </div>`;
    }).join("");
    const valid=state.importRows.filter(validImportRow).length,updates=state.importRows.filter(r=>validImportRow(r)&&r.status==="update").length,news=valid-updates;
    el.importCount.textContent=`${valid}件`;el.importSummaryText.textContent=`更新 ${updates} / 新規 ${news}`;
    el.importActionBar.classList.remove("hidden");el.saveImportButton.disabled=!valid||!state.importGuild;
  }

  function onImportRowEdit(e){
    const rowEl=e.target.closest("[data-import-index]");if(!rowEl)return;
    const i=Number(rowEl.dataset.importIndex),row=state.importRows[i];if(!row)return;
    if(e.target.dataset.importKey==="playerName")row.playerName=e.target.value;
    if(e.target.dataset.entryKey){
      const j=Number(e.target.dataset.entryIndex),key=e.target.dataset.entryKey;
      row.entries[j][key]=key==="power"?(e.target.value===""?"":Math.max(0,Number(e.target.value)||0)):e.target.value;
    }
    refreshImportStatuses();renderImportRows();
  }

  function validImportRow(r){
    return String(r.playerName||"").trim() && r.entries.some(e=>Number(e.power)>0 && ["火","水","草","不明"].includes(e.attribute));
  }

  async function saveImportedRows(){
    const rows=state.importRows.filter(validImportRow).map(r=>({
      playerName:r.playerName.trim(),
      entries:r.entries.filter(e=>Number(e.power)>0).slice(0,3).map(e=>({attribute:e.attribute,power:Number(e.power)}))
    }));
    if(!rows.length||!state.importGuild)return;
    if(!confirm(`${state.importGuild} に ${rows.length}人分の戦力を反映します。よろしいですか？`))return;
    el.saveImportButton.disabled=true;el.saveImportButton.textContent="反映中…";
    try{
      const payload=encodeURIComponent(JSON.stringify(rows));
      const res=await jsonp({action:"savePowerImport",guild:state.importGuild,payload},60000);
      if(!res?.ok)throw new Error(res?.error||"保存失敗");
      showToast(`更新 ${res.updated||0} / 新規 ${res.created||0} を反映しました`);
      state.importRows=[];await loadGuildRoster(false);await loadFull(false);renderImportRows();
    }catch(err){console.error(err);showToast(err.message,true)}
    finally{el.saveImportButton.disabled=false;el.saveImportButton.textContent="スプレッドシートへ反映"}
  }

  async function loadGuildRoster(showError=true){
    if(!state.importGuild){state.guildRoster=[];return}
    try{
      const res=await jsonp({action:"guildRoster",guild:state.importGuild,t:Date.now()},20000);
      if(!res?.ok)throw new Error(res?.error||"ギルドデータ取得失敗");
      state.guildRoster=res.rows||[];refreshImportStatuses();
    }catch(err){if(showError)showToast(err.message,true)}
  }

  async function createGuild(e){
    e.preventDefault();
    const name=el.newGuildName.value.trim();if(!name)return;
    try{
      const res=await jsonp({action:"createGuild",name},30000);
      if(!res?.ok)throw new Error(res?.error||"作成失敗");
      el.newGuildDialog.close();showToast(`${name} を作成しました`);
      state.importGuild=name;await loadFull(false);renderImportGuildOptions();el.importGuild.value=name;await loadGuildRoster(false);
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
      <span class="roster-powers">${r.entries.map(e=>`${esc(e.attribute)} ${formatPower(e.power)}`).join(" / ")}</span>
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