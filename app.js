(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  const state = {
    mode: localStorage.getItem("gbm-mode") || cfg.DEFAULT_MODE,
    tab: localStorage.getItem("gbm-tab") || "members",
    blockId: Number(localStorage.getItem("gbm-block") || 1),
    search: "",
    data: null,
    loading: false,
    writing: false,
    refreshTimer: null,
    lastInteractionAt: 0
  };

  const el = {
    status: document.getElementById("connectionStatus"),
    mode: document.getElementById("modeSelect"),
    refresh: document.getElementById("refreshButton"),
    guildSelectors: document.getElementById("guildSelectors"),
    search: document.getElementById("searchInput"),
    summary: document.getElementById("summary"),
    members: document.getElementById("membersPanel"),
    battle: document.getElementById("battlePanel"),
    enemies: document.getElementById("enemiesPanel"),
    toast: document.getElementById("toast")
  };

  function init() {
    el.mode.value = state.mode;
    setActiveTab(state.tab);

    el.mode.addEventListener("change", async () => {
      state.mode = el.mode.value;
      localStorage.setItem("gbm-mode", state.mode);
      await loadData(true);
    });

    el.refresh.addEventListener("click", () => loadData(true));

    el.search.addEventListener("input", () => {
      state.search = el.search.value.trim().toLowerCase();
      renderPanels();
    });

    document.querySelectorAll("[data-tab]").forEach(button => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });

    document.addEventListener("focusin", () => state.lastInteractionAt = Date.now());
    document.addEventListener("change", handleChange);

    loadData(true);
    state.refreshTimer = setInterval(() => {
      const editing = document.activeElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
      if (!editing && !state.writing && Date.now() - state.lastInteractionAt > 1500) {
        loadData(false);
      }
    }, cfg.REFRESH_INTERVAL_MS);
  }

  async function loadData(showLoading) {
    if (state.loading || state.writing) return;
    state.loading = true;
    if (showLoading) setStatus("loading", "読込中");
    el.refresh.disabled = true;

    try {
      const response = await jsonp({
        action: "data",
        mode: state.mode
      });
      if (!response?.ok) throw new Error(response?.error || "データ取得に失敗しました");
      state.data = response.data;
      render();
      setStatus("ok", `最新 ${formatTime(response.data.updatedAt)}`);
    } catch (error) {
      console.error(error);
      setStatus("error", "接続エラー");
      showToast(error.message || "接続に失敗しました", true);
    } finally {
      state.loading = false;
      el.refresh.disabled = false;
    }
  }

  function jsonp(params) {
    return new Promise((resolve, reject) => {
      const callback = `__gbm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const timeout = setTimeout(() => cleanup(new Error("通信がタイムアウトしました")), 20000);

      function cleanup(error, data) {
        clearTimeout(timeout);
        delete window[callback];
        script.remove();
        error ? reject(error) : resolve(data);
      }

      window[callback] = data => cleanup(null, data);
      script.onerror = () => cleanup(new Error("APIへ接続できませんでした"));

      const query = new URLSearchParams({ ...params, callback });
      script.src = `${cfg.API_URL}?${query.toString()}`;
      document.head.appendChild(script);
    });
  }

  async function updateField(target) {
    if (state.writing) return;
    state.writing = true;
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
      const response = await jsonp(params);
      if (!response?.ok) throw new Error(response?.error || "更新に失敗しました");
      showToast("保存しました");
      await loadData(false);
    } catch (error) {
      console.error(error);
      showToast(error.message || "更新に失敗しました", true);
      await loadData(false);
    } finally {
      state.writing = false;
      target.disabled = false;
    }
  }

  function handleChange(event) {
    const target = event.target.closest("[data-field]");
    if (!target) return;
    state.lastInteractionAt = Date.now();
    updateField(target);
  }

  function render() {
    if (!state.data) return;
    renderGuildSelectors();
    renderSummary();
    renderPanels();
  }

  function renderGuildSelectors() {
    const options = state.data.options.guilds || [];
    el.guildSelectors.innerHTML = state.data.battleBlocks.map(block => `
      <div class="guild-card">
        <label>
          <strong>対戦ギルド ${block.id}</strong>
          <select data-field="guild" data-block="${block.id}">
            ${makeOptions(options, block.guildName, true)}
          </select>
        </label>
      </div>
    `).join("");
  }

  function renderSummary() {
    const members = state.data.members.filter(m => m.name);
    const realtime = members.filter(m => m.attendance).length;
    const placementOnly = members.filter(m => !m.attendance && m.realtimeNg).length;
    const attack1 = members.filter(m => m.attack1Done).length;
    const attack2 = members.filter(m => m.attack2Done).length;

    el.summary.innerHTML = [
      ["リアタイ", realtime],
      ["配置のみ", placementOnly],
      ["投1済", attack1],
      ["投2済", attack2]
    ].map(([label, value]) => `
      <div class="summary-card">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${value}</div>
      </div>
    `).join("");
  }

  function renderPanels() {
    if (!state.data) return;
    renderMembers();
    renderBattle();
    renderEnemies();
  }

  function renderMembers() {
    const rows = state.data.members
      .filter(m => m.name)
      .filter(m => matches(m.name));

    const desktop = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>状態</th><th>メンバー</th><th>点呼</th><th>投1</th><th>投2</th><th>リアタイ×</th><th>配置先</th>
          </tr></thead>
          <tbody>${rows.map(memberRowDesktop).join("")}</tbody>
        </table>
      </div>`;

    const mobile = `<div class="mobile-cards">${rows.map(memberCard).join("")}</div>`;
    el.members.innerHTML = rows.length ? desktop + mobile : emptyHtml();
  }

  function memberRowDesktop(m) {
    return `<tr>
      <td>${statusHtml(m)}</td>
      <td>${escapeHtml(m.name)}</td>
      <td>${checkbox("memberAttendance", m.row, m.attendance)}</td>
      <td>${checkbox("memberAttack1", m.row, m.attack1Done)}</td>
      <td>${checkbox("memberAttack2", m.row, m.attack2Done)}</td>
      <td>${checkbox("memberRealtimeNg", m.row, m.realtimeNg)}</td>
      <td><select class="placement-select" data-field="memberPlacement" data-row="${m.row}">
        ${makeOptions(state.data.options.placements, m.placement, true, "未配置")}
      </select></td>
    </tr>`;
  }

  function memberCard(m) {
    return `<article class="card">
      <div class="card-head"><strong>${escapeHtml(m.name)}</strong>${statusHtml(m)}</div>
      <div class="card-grid">
        ${cardCheck("点呼", "memberAttendance", m.row, m.attendance)}
        ${cardCheck("リアタイ×", "memberRealtimeNg", m.row, m.realtimeNg)}
        ${cardCheck("投1済", "memberAttack1", m.row, m.attack1Done)}
        ${cardCheck("投2済", "memberAttack2", m.row, m.attack2Done)}
        <div class="card-field full">
          <div class="label">配置先</div>
          <select data-field="memberPlacement" data-row="${m.row}">
            ${makeOptions(state.data.options.placements, m.placement, true, "未配置")}
          </select>
        </div>
      </div>
    </article>`;
  }

  function renderBattle() {
    const block = activeBlock();
    const rows = block.rows.filter(r => r.friendly.name || r.enemy.name)
      .filter(r => matches(`${r.friendly.name} ${r.enemy.name}`));

    const switcher = blockSwitcher();
    const desktop = `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>味方</th><th>属性</th><th>戦力1</th><th>戦力2</th><th>VS</th>
        <th>相手</th><th>1済</th><th>2済</th><th>相手戦力1</th><th>相手戦力2</th>
        <th>デバフ</th><th>補正%</th><th>弱体1</th><th>弱体2</th>
      </tr></thead>
      <tbody>${rows.map(battleRowDesktop).join("")}</tbody>
    </table></div>`;

    const mobile = `<div class="mobile-cards">${rows.map(battleCard).join("")}</div>`;
    el.battle.innerHTML = switcher + (rows.length ? desktop + mobile : emptyHtml());
    bindBlockButtons(el.battle);
  }

  function battleRowDesktop(r) {
    const good1 = numeric(r.friendly.power1) >= numeric(r.enemy.weakenedPower1);
    const good2 = numeric(r.friendly.power2) >= numeric(r.enemy.weakenedPower2);
    return `<tr class="${r.enemy.attack2Done ? "done-2" : r.enemy.attack1Done ? "done-1" : ""}">
      <td><select class="name-select" data-field="friendlyName" data-row="${r.row}">
        ${makeOptions(state.data.options.friendlyMembers, r.friendly.name, true, "未選択")}
      </select></td>
      <td><span class="attribute">${escapeHtml(r.friendly.attribute)}</span></td>
      <td>${escapeHtml(r.friendly.power1)}</td>
      <td>${escapeHtml(r.friendly.power2)}</td>
      <td>VS</td>
      <td>${escapeHtml(r.enemy.name)}</td>
      <td>${checkbox("enemyAttack1", r.row, r.enemy.attack1Done)}</td>
      <td>${checkbox("enemyAttack2", r.row, r.enemy.attack2Done)}</td>
      <td>${escapeHtml(r.enemy.power1)}</td>
      <td>${escapeHtml(r.enemy.power2)}</td>
      <td>${escapeHtml(r.enemy.debuff)}</td>
      <td><input type="number" min="0" max="100" step="1" value="${percentNumber(r.enemy.extraCorrection)}" data-field="extraCorrection" data-row="${r.row}"></td>
      <td class="${good1 ? "power-good" : "power-bad"}">${escapeHtml(r.enemy.weakenedPower1)}</td>
      <td class="${good2 ? "power-good" : "power-bad"}">${escapeHtml(r.enemy.weakenedPower2)}</td>
    </tr>`;
  }

  function battleCard(r) {
    return `<article class="card">
      <div class="card-field full">
        <div class="label">味方</div>
        <select data-field="friendlyName" data-row="${r.row}">
          ${makeOptions(state.data.options.friendlyMembers, r.friendly.name, true, "未選択")}
        </select>
      </div>
      <div class="card-grid">
        <div class="card-field"><div class="label">属性</div>${escapeHtml(r.friendly.attribute)}</div>
        <div class="card-field"><div class="label">味方戦力</div>${escapeHtml(r.friendly.power1)} / ${escapeHtml(r.friendly.power2)}</div>
      </div>
      <div class="vs">VS</div>
      <div class="card-head"><strong>${escapeHtml(r.enemy.name)}</strong><span>${escapeHtml(r.enemy.debuff)}</span></div>
      <div class="card-grid">
        ${cardCheck("1済", "enemyAttack1", r.row, r.enemy.attack1Done)}
        ${cardCheck("2済", "enemyAttack2", r.row, r.enemy.attack2Done)}
        <div class="card-field"><div class="label">相手戦力</div>${escapeHtml(r.enemy.power1)} / ${escapeHtml(r.enemy.power2)}</div>
        <div class="card-field"><div class="label">弱体後</div>${escapeHtml(r.enemy.weakenedPower1)} / ${escapeHtml(r.enemy.weakenedPower2)}</div>
        <div class="card-field full">
          <div class="label">追加補正 %</div>
          <input type="number" min="0" max="100" step="1" value="${percentNumber(r.enemy.extraCorrection)}" data-field="extraCorrection" data-row="${r.row}">
        </div>
      </div>
    </article>`;
  }

  function renderEnemies() {
    const block = activeBlock();
    const rows = block.rows.filter(r => r.enemy.name)
      .filter(r => matches(r.enemy.name));

    const switcher = blockSwitcher();
    const desktop = `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>相手</th><th>1済</th><th>2済</th><th>配置先</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.enemy.attack2Done ? "done-2" : r.enemy.attack1Done ? "done-1" : ""}">
        <td>${escapeHtml(r.enemy.name)}</td>
        <td>${checkbox("enemyAttack1", r.row, r.enemy.attack1Done)}</td>
        <td>${checkbox("enemyAttack2", r.row, r.enemy.attack2Done)}</td>
        <td><select class="placement-select" data-field="enemyPlacement" data-row="${r.row}">
          ${makeOptions(state.data.options.placements, r.enemy.placement, true, "未配置")}
        </select></td>
      </tr>`).join("")}</tbody>
    </table></div>`;

    const mobile = `<div class="mobile-cards">${rows.map(r => `<article class="card">
      <div class="card-head"><strong>${escapeHtml(r.enemy.name)}</strong></div>
      <div class="card-grid">
        ${cardCheck("1済", "enemyAttack1", r.row, r.enemy.attack1Done)}
        ${cardCheck("2済", "enemyAttack2", r.row, r.enemy.attack2Done)}
        <div class="card-field full">
          <div class="label">配置先</div>
          <select data-field="enemyPlacement" data-row="${r.row}">
            ${makeOptions(state.data.options.placements, r.enemy.placement, true, "未配置")}
          </select>
        </div>
      </div>
    </article>`).join("")}</div>`;

    el.enemies.innerHTML = switcher + (rows.length ? desktop + mobile : emptyHtml());
    bindBlockButtons(el.enemies);
  }

  function activeBlock() {
    return state.data.battleBlocks.find(b => b.id === state.blockId) || state.data.battleBlocks[0];
  }

  function blockSwitcher() {
    return `<div class="block-switcher">${state.data.battleBlocks.map(b => `
      <button type="button" class="block-button ${b.id === state.blockId ? "active" : ""}" data-block-id="${b.id}">
        ${b.id}. ${escapeHtml(b.guildName || "未選択")}
      </button>`).join("")}</div>`;
  }

  function bindBlockButtons(container) {
    container.querySelectorAll("[data-block-id]").forEach(button => {
      button.addEventListener("click", () => {
        state.blockId = Number(button.dataset.blockId);
        localStorage.setItem("gbm-block", String(state.blockId));
        renderPanels();
      });
    });
  }

  function checkbox(field, row, checked) {
    return `<label class="check-control"><input type="checkbox" data-field="${field}" data-row="${row}" ${checked ? "checked" : ""}></label>`;
  }

  function cardCheck(label, field, row, checked) {
    return `<div class="card-field">
      <div class="label">${escapeHtml(label)}</div>
      ${checkbox(field, row, checked)}
    </div>`;
  }

  function statusHtml(m) {
    const cls = m.attendance ? "realtime" : m.realtimeNg ? "placement-only" : "unconfirmed";
    return `<span class="member-status ${cls}">${escapeHtml(m.status)}</span>`;
  }

  function makeOptions(values, selected, allowBlank = false, blankLabel = "") {
    const list = [...new Set((values || []).map(String).filter(Boolean))];
    if (selected && !list.includes(String(selected))) list.unshift(String(selected));
    const blank = allowBlank ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
    return blank + list.map(value =>
      `<option value="${escapeAttr(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(value)}</option>`
    ).join("");
  }

  function setActiveTab(tab) {
    state.tab = tab;
    localStorage.setItem("gbm-tab", tab);
    document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    const panel = document.getElementById(`${tab}Panel`);
    if (panel) panel.classList.add("active");
  }

  function matches(text) {
    return !state.search || String(text || "").toLowerCase().includes(state.search);
  }

  function percentNumber(value) {
    const text = String(value || "").replace("%", "").replace(",", ".");
    const n = Number(text);
    return Number.isFinite(n) ? n : "";
  }

  function numeric(value) {
    const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function formatTime(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "--:--:--" :
      d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function setStatus(type, text) {
    el.status.className = `status status-${type}`;
    el.status.textContent = text;
  }

  let toastTimer;
  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.className = `toast show${error ? " error" : ""}`;
    toastTimer = setTimeout(() => el.toast.className = "toast", 2500);
  }

  function emptyHtml() {
    return `<div class="empty">該当するデータがありません。</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  init();
})();
