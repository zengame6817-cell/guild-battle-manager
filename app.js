
(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  const state = {
    mode: localStorage.getItem("gbm-mode") || cfg.DEFAULT_MODE,
    tab: localStorage.getItem("gbm-tab") || "members",
    blockId: Number(localStorage.getItem("gbm-block") || 1),
    search: "",
    filter: "all",
    data: null,
    version: null,
    loading: false,
    writing: false,
    lastGoodAt: null,
    failedPolls: 0
  };

  const $ = id => document.getElementById(id);
  const el = {
    status: $("connectionStatus"),
    mode: $("modeSelect"),
    refresh: $("refreshButton"),
    guilds: $("guildSelectors"),
    search: $("searchInput"),
    filter: $("statusFilter"),
    summary: $("summary"),
    members: $("membersPanel"),
    battle: $("battlePanel"),
    enemies: $("enemiesPanel"),
    toast: $("toast")
  };

  function init() {
    el.mode.value = state.mode;
    setTab(state.tab);

    el.mode.addEventListener("change", async () => {
      state.mode = el.mode.value;
      localStorage.setItem("gbm-mode", state.mode);
      state.version = null;
      await loadFull(true);
    });
    el.refresh.addEventListener("click", () => loadFull(true));
    el.search.addEventListener("input", () => {
      state.search = el.search.value.trim().toLowerCase();
      renderPanels();
    });
    el.filter.addEventListener("change", () => {
      state.filter = el.filter.value;
      renderPanels();
    });

    document.querySelectorAll("[data-tab]").forEach(b =>
      b.addEventListener("click", () => setTab(b.dataset.tab))
    );
    document.addEventListener("change", handleChange);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkVersion(true);
    });

    loadFull(true);
    setInterval(() => {
      if (!document.hidden && !state.loading && !state.writing) checkVersion(false);
    }, cfg.VERSION_POLL_MS);
  }

  async function loadFull(showBusy = false) {
    if (state.loading || state.writing) return;
    state.loading = true;
    if (showBusy || !state.data) setStatus("loading", "同期中");
    el.refresh.disabled = true;

    try {
      const res = await jsonp(
        { action: "data", mode: state.mode },
        cfg.FULL_REQUEST_TIMEOUT_MS
      );
      if (!res?.ok) throw new Error(res?.error || "データ取得失敗");
      applyFullData(res.data);
      state.failedPolls = 0;
      state.lastGoodAt = Date.now();
      setStatus("ok", `同期 ${timeText()}`);
    } catch (err) {
      console.error(err);
      if (state.data) {
        state.failedPolls++;
        setStatus("warn", "再接続中");
      } else {
        setStatus("error", "接続エラー");
      }
    } finally {
      state.loading = false;
      el.refresh.disabled = false;
    }
  }

  async function checkVersion(force = false) {
    if (state.loading || state.writing) return;
    try {
      const res = await jsonp(
        { action: "version", mode: state.mode, t: Date.now() },
        cfg.VERSION_REQUEST_TIMEOUT_MS
      );
      if (!res?.ok) throw new Error(res?.error || "更新確認失敗");

      state.failedPolls = 0;
      if (force || state.version === null || String(res.version) !== String(state.version)) {
        await loadFull(false);
      } else if (state.data) {
        setStatus("ok", `同期 ${timeText()}`);
      }
    } catch (err) {
      console.warn("version poll:", err);
      state.failedPolls++;
      if (state.data) setStatus("warn", "再接続中");
    }
  }

  function jsonp(params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const callback = `__gbm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const timeout = setTimeout(
        () => cleanup(new Error("通信がタイムアウトしました")),
        timeoutMs || 20000
      );

      function cleanup(error, data) {
        clearTimeout(timeout);
        try { delete window[callback]; } catch {}
        script.remove();
        error ? reject(error) : resolve(data);
      }

      window[callback] = data => cleanup(null, data);
      script.onerror = () => cleanup(new Error("APIへ接続できませんでした"));
      script.src = `${cfg.API_URL}?${new URLSearchParams({ ...params, callback })}`;
      document.head.appendChild(script);
    });
  }

  async function updateField(target) {
    if (state.writing) return;
    state.writing = true;
    const oldDisabled = target.disabled;
    target.disabled = true;
    setStatus("loading", "保存中");

    const params = {
      action: "update",
      mode: state.mode,
      field: target.dataset.field,
      row: target.dataset.row || "",
      block: target.dataset.block || "",
      value: target.type === "checkbox" ? String(target.checked) : target.value
    };

    try {
      const res = await jsonp(params, cfg.FULL_REQUEST_TIMEOUT_MS);
      if (!res?.ok) throw new Error(res?.error || "更新失敗");

      if (res.data) {
        applyFullData(res.data);
      } else {
        state.version = res.version ?? state.version;
      }
      setStatus("ok", `保存 ${timeText()}`);
    } catch (err) {
      console.error(err);
      showToast("保存失敗。再同期します", true);
      setStatus("warn", "再接続中");
      await loadFull(false);
    } finally {
      state.writing = false;
      target.disabled = oldDisabled;
    }
  }

  function handleChange(e) {
    const target = e.target.closest("[data-field]");
    if (target) updateField(target);
  }

  function applyFullData(data) {
    state.data = data;
    state.version = data.version ?? state.version;
    render();
  }

  function render() {
    renderGuilds();
    renderSummary();
    renderPanels();
  }

  function renderGuilds() {
    const opts = state.data.options.guilds || [];
    el.guilds.innerHTML = state.data.battleBlocks.map(b => `
      <label class="guild-item">
        <span>${b.id}</span>
        <select data-field="guild" data-block="${b.id}">
          ${options(opts, b.guildName, false)}
        </select>
      </label>
    `).join("");
  }

  function renderSummary() {
    const ms = state.data.members.filter(m => m.name);
    const total = ms.length;
    const rt = ms.filter(m => m.attendance).length;
    const place = ms.filter(m => !m.attendance && m.realtimeNg).length;
    const a1 = ms.filter(m => m.attack1Done).length;
    const a2 = ms.filter(m => m.attack2Done).length;
    const assigned = ms.filter(m => m.placement).length;
    el.summary.innerHTML = [
      ["人数",total,""],
      ["リアタイ",rt,"good"],
      ["配置のみ",place,"warn"],
      ["①済",a1,""],
      ["②済",a2,""],
      ["配置済",assigned,""]
    ].map(([k,v,c]) => `<div class="sum ${c}"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");
  }

  function renderPanels() {
    renderMembers();
    renderBattle();
    renderEnemies();
  }

  function memberFilter(m) {
    if (!matches(m.name)) return false;
    if (state.filter === "remaining") return !(m.attack1Done && m.attack2Done);
    if (state.filter === "done1") return m.attack1Done && !m.attack2Done;
    if (state.filter === "done2") return m.attack2Done;
    if (state.filter === "unassigned") return !m.placement;
    return true;
  }

  function enemyFilter(r) {
    if (!matches(`${r.friendly.name} ${r.enemy.name}`)) return false;
    if (state.filter === "remaining") return !r.enemy.attack2Done;
    if (state.filter === "done1") return r.enemy.attack1Done && !r.enemy.attack2Done;
    if (state.filter === "done2") return r.enemy.attack2Done;
    if (state.filter === "unassigned") return !r.enemy.placement;
    return true;
  }

  function renderMembers() {
    const rows = state.data.members.filter(m => m.name).filter(memberFilter);

    const desk = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>状態</th><th>名前</th><th>点呼</th><th>①</th><th>②</th><th>RT×</th><th>配置</th></tr></thead>
      <tbody>${rows.map(m => `<tr class="${!m.placement ? "unassigned" : ""}">
        <td>${memberState(m)}</td>
        <td><strong>${esc(m.name)}</strong></td>
        <td>${check("memberAttendance",m.row,m.attendance)}</td>
        <td>${check("memberAttack1",m.row,m.attack1Done)}</td>
        <td>${check("memberAttack2",m.row,m.attack2Done)}</td>
        <td>${check("memberRealtimeNg",m.row,m.realtimeNg)}</td>
        <td><select class="placement-select" data-field="memberPlacement" data-row="${m.row}">
          ${options(state.data.options.placements,m.placement,true,"-")}
        </select></td>
      </tr>`).join("")}</tbody></table></div>`;

    const mob = `<div class="mobile-list">${rows.map(m => `
      <div class="mrow">
        <div class="mrow-top">
          <span class="mname">${esc(m.name)}</span>
          ${memberState(m)}
          <select class="mobile-placement" data-field="memberPlacement" data-row="${m.row}">
            ${options(state.data.options.placements,m.placement,true,"配置-")}
          </select>
        </div>
        <div class="mrow-bottom">
          <span class="mini">点呼</span>${check("memberAttendance",m.row,m.attendance)}
          <span class="mini">①</span>${check("memberAttack1",m.row,m.attack1Done)}
          <span class="mini">②</span>${check("memberAttack2",m.row,m.attack2Done)}
          <span class="mini">RT×</span>${check("memberRealtimeNg",m.row,m.realtimeNg)}
        </div>
      </div>`).join("")}</div>`;

    el.members.innerHTML = rows.length ? desk + mob : empty();
  }

  function renderBattle() {
    const block = activeBlock();
    const rows = block.rows.filter(r => r.friendly.name || r.enemy.name).filter(enemyFilter);

    const desk = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>味方</th><th>属</th><th>戦1</th><th>戦2</th><th>相手</th>
        <th>①</th><th>②</th><th>相1</th><th>相2</th><th>デバフ</th>
        <th>補正</th><th>弱1</th><th>弱2</th><th>差1</th><th>差2</th>
      </tr></thead>
      <tbody>${rows.map(battleDesktopRow).join("")}</tbody>
    </table></div>`;

    const mob = `<div class="mobile-list">${rows.map(battleMobileRow).join("")}</div>`;
    el.battle.innerHTML = blockButtons() + (rows.length ? desk + mob : empty());
    bindBlocks(el.battle);
  }

  function battleDesktopRow(r) {
    const d1 = num(r.friendly.power1) - num(r.enemy.weakenedPower1);
    const d2 = num(r.friendly.power2) - num(r.enemy.weakenedPower2);
    return `<tr class="${r.enemy.attack2Done?"row-two":r.enemy.attack1Done?"row-one":""}">
      <td><select class="name-select" data-field="friendlyName" data-row="${r.row}">
        ${options(state.data.options.friendlyMembers,r.friendly.name,true,"未選択")}
      </select></td>
      <td><span class="attr">${esc(r.friendly.attribute)}</span></td>
      <td>${esc(r.friendly.power1)}</td><td>${esc(r.friendly.power2)}</td>
      <td><strong>${esc(r.enemy.name)}</strong></td>
      <td>${check("enemyAttack1",r.row,r.enemy.attack1Done)}</td>
      <td>${check("enemyAttack2",r.row,r.enemy.attack2Done)}</td>
      <td>${esc(r.enemy.power1)}</td><td>${esc(r.enemy.power2)}</td>
      <td>${esc(r.enemy.debuff)}</td>
      <td><input class="extra-input" type="number" min="0" max="100" step="1"
        value="${pctNum(r.enemy.extraCorrection)}" data-field="extraCorrection" data-row="${r.row}"></td>
      <td class="${powerClass(d1)}">${esc(r.enemy.weakenedPower1)}</td>
      <td class="${powerClass(d2)}">${esc(r.enemy.weakenedPower2)}</td>
      <td>${diff(d1)}</td><td>${diff(d2)}</td>
    </tr>`;
  }

  function battleMobileRow(r) {
    const d1 = num(r.friendly.power1) - num(r.enemy.weakenedPower1);
    const d2 = num(r.friendly.power2) - num(r.enemy.weakenedPower2);
    return `<div class="mrow">
      <div class="mrow-top">
        <div class="mgrow">
          <select class="mobile-name" data-field="friendlyName" data-row="${r.row}">
            ${options(state.data.options.friendlyMembers,r.friendly.name,true,"未選択")}
          </select>
        </div>
        <span class="attr">${esc(r.friendly.attribute)}</span>
        <strong>${esc(r.friendly.power1)}/${esc(r.friendly.power2)}</strong>
      </div>
      <div class="mrow-bottom">
        <strong class="mgrow">${esc(r.enemy.name)}</strong>
        <span class="mini">①</span>${check("enemyAttack1",r.row,r.enemy.attack1Done)}
        <span class="mini">②</span>${check("enemyAttack2",r.row,r.enemy.attack2Done)}
      </div>
      <div class="mrow-bottom">
        <span class="mini">相</span><strong>${esc(r.enemy.power1)}/${esc(r.enemy.power2)}</strong>
        <span class="mini">弱</span><strong class="${powerClass(d1)}">${esc(r.enemy.weakenedPower1)}</strong>/<strong class="${powerClass(d2)}">${esc(r.enemy.weakenedPower2)}</strong>
        <span class="spacer"></span>
        <span class="mini">DB</span><strong>${esc(r.enemy.debuff)}</strong>
        <input class="extra-input" type="number" min="0" max="100" step="1"
          value="${pctNum(r.enemy.extraCorrection)}" data-field="extraCorrection" data-row="${r.row}">
      </div>
    </div>`;
  }

  function renderEnemies() {
    const block = activeBlock();
    const rows = block.rows.filter(r => r.enemy.name).filter(enemyFilter);

    const desk = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>相手</th><th>状態</th><th>①</th><th>②</th><th>配置</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${!r.enemy.placement?"unassigned":""}">
        <td><strong>${esc(r.enemy.name)}</strong></td>
        <td>${enemyBadge(r)}</td>
        <td>${check("enemyAttack1",r.row,r.enemy.attack1Done)}</td>
        <td>${check("enemyAttack2",r.row,r.enemy.attack2Done)}</td>
        <td><select class="placement-select" data-field="enemyPlacement" data-row="${r.row}">
          ${options(state.data.options.placements,r.enemy.placement,true,"-")}
        </select></td>
      </tr>`).join("")}</tbody></table></div>`;

    const mob = `<div class="mobile-list">${rows.map(r => `
      <div class="mrow">
        <div class="mrow-top">
          <span class="mname">${esc(r.enemy.name)}</span>
          ${enemyBadge(r)}
          <select class="mobile-placement" data-field="enemyPlacement" data-row="${r.row}">
            ${options(state.data.options.placements,r.enemy.placement,true,"配置-")}
          </select>
        </div>
        <div class="mrow-bottom">
          <span class="mini">①</span>${check("enemyAttack1",r.row,r.enemy.attack1Done)}
          <span class="mini">②</span>${check("enemyAttack2",r.row,r.enemy.attack2Done)}
        </div>
      </div>`).join("")}</div>`;

    el.enemies.innerHTML = blockButtons() + (rows.length ? desk + mob : empty());
    bindBlocks(el.enemies);
  }

  function memberState(m) {
    const c = m.attendance ? "rt" : m.realtimeNg ? "place" : "none";
    return `<span class="state ${c}">${esc(m.status)}</span>`;
  }
  function enemyBadge(r) {
    return r.enemy.attack2Done ? `<span class="badge two">②済</span>` :
      r.enemy.attack1Done ? `<span class="badge one">①済</span>` :
      `<span class="badge zero">未</span>`;
  }
  function check(field,row,on) {
    return `<label class="check"><input type="checkbox" data-field="${field}" data-row="${row}" ${on?"checked":""}></label>`;
  }
  function activeBlock() {
    return state.data.battleBlocks.find(b => b.id === state.blockId) || state.data.battleBlocks[0];
  }
  function blockButtons() {
    return `<div class="block-switcher">${state.data.battleBlocks.map(b =>
      `<button class="block-button ${b.id===state.blockId?"active":""}" data-block-id="${b.id}" type="button">${b.id}. ${esc(b.guildName||"未選択")}</button>`
    ).join("")}</div>`;
  }
  function bindBlocks(root) {
    root.querySelectorAll("[data-block-id]").forEach(b => b.addEventListener("click", () => {
      state.blockId = Number(b.dataset.blockId);
      localStorage.setItem("gbm-block",state.blockId);
      renderPanels();
    }));
  }
  function setTab(tab) {
    state.tab = tab; localStorage.setItem("gbm-tab",tab);
    document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active",b.dataset.tab===tab));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    $(`${tab}Panel`)?.classList.add("active");
  }
  function options(vals,selected,blank=false,blankLabel="") {
    const list=[...new Set((vals||[]).map(String).filter(Boolean))];
    if(selected && !list.includes(String(selected))) list.unshift(String(selected));
    return (blank?`<option value="">${esc(blankLabel)}</option>`:"") +
      list.map(v=>`<option value="${esc(v)}" ${String(v)===String(selected)?"selected":""}>${esc(v)}</option>`).join("");
  }
  function matches(s){return !state.search || String(s||"").toLowerCase().includes(state.search)}
  function pctNum(v){const n=Number(String(v||"").replace("%","").replace(",","."));return Number.isFinite(n)?n:""}
  function num(v){const n=Number(String(v||"").replace(/[^\d.-]/g,""));return Number.isFinite(n)?n:0}
  function diff(v){const c=v>0?"plus":v<0?"minus":"zero";return `<span class="diff ${c}">${v>0?"+":""}${v.toLocaleString("ja-JP")}</span>`}
  function powerClass(v){return v>=0?"power-good":"power-bad"}
  function timeText(){return new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
  function setStatus(c,t){el.status.className=`status ${c}`;el.status.textContent=t}
  let toastTimer;
  function showToast(t,error=false){clearTimeout(toastTimer);el.toast.textContent=t;el.toast.className=`toast show${error?" error":""}`;toastTimer=setTimeout(()=>el.toast.className="toast",2200)}
  function empty(){return `<div class="empty">該当データなし</div>`}
  function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}

  init();
})();
