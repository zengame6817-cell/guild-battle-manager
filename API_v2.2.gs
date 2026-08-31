/**
 * ギルド対戦管理 API v2.2
 * - v2.1 高速同期
 * - ギルド戦力シート管理
 * - 東京ディバンカー画像解析（OpenAI Responses API）
 *
 * 重要:
 * Apps Script「プロジェクトの設定」→「スクリプト プロパティ」に
 * OPENAI_API_KEY = sk-...
 * を登録してください。GitHub側にはAPIキーを置きません。
 */

const APP_CONFIG = {
  sheets: {
    normal: "(通常)対戦表",
    z: "対戦表（Z用）"
  },
  battleBlocks: [
    { id: 1, guildCell: "M4", startRow: 5, endRow: 50 },
    { id: 2, guildCell: "M56", startRow: 57, endRow: 107 },
    { id: 3, guildCell: "M111", startRow: 112, endRow: 162 }
  ],
  memberStartRow: 6,
  memberEndRow: 50,
  versionKey: "GBM_VERSION",

  guildListSheet: "プルダウン用",
  guildListColumn: 11,       // K
  guildListStartRow: 2,
  guildListEndRow: 200,
  guildTemplateSheet: "Lealoha",

  // ギルドシートの戦力データ:
  // B=名前, C=属性1, D=戦力1, E=属性2, F=戦力2, G=属性3, H=戦力3
  guildDataStartRow: 2,
  guildDataEndRow: 200,
  guildColumns: { name: 2, attr1: 3, power1: 4, attr2: 5, power2: 6, attr3: 7, power3: 8 },

  openAIModel: "gpt-5.6-luna"
};

function doGet(e) {
  try {
    const p = e && e.parameter ? e.parameter : {};
    const action = String(p.action || "data");
    const mode = normalizeMode_(p.mode);
    let result;

    switch (action) {
      case "data":
        result = { ok: true, data: getAppData_(mode) };
        break;
      case "version":
        result = { ok: true, version: getVersion_() };
        break;
      case "update":
        result = updateAppData_(mode, p);
        break;
      case "guildRoster":
        result = { ok: true, rows: getGuildRoster_(String(p.guild || "")) };
        break;
      case "createGuild":
        result = createGuild_(String(p.name || ""));
        break;
      case "deleteGuildMember":
        result = deleteGuildMember_(String(p.guild || ""), String(p.player || ""));
        break;
      case "clearGuildData":
        result = clearGuildData_(String(p.guild || ""));
        break;
      case "deleteGuild":
        result = deleteGuild_(String(p.name || ""));
        break;
      case "savePowerImport":
        result = savePowerImport_(String(p.guild || ""), decodePayload_(p.payload));
        break;
      case "ping":
        result = {
          ok: true,
          message: "API v2.2 is working",
          version: getVersion_(),
          aiConfigured: !!PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY")
        };
        break;
      default:
        result = { ok: false, error: "未対応のactionです。" };
    }
    return outputResponse_(result, p.callback);
  } catch (error) {
    console.error(error);
    return outputResponse_(
      { ok: false, error: error.message || String(error) },
      e && e.parameter ? e.parameter.callback : ""
    );
  }
}

/**
 * 画像解析はPOST。
 * GitHub Pagesからのpreflightを避けるため、ブラウザ側は text/plain でJSONをPOSTします。
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action === "analyzeImage") {
      return jsonTextResponse_({ ok: true, data: analyzeTokyoDebunkerImage_(body.imageData, body.filename) });
    }
    return jsonTextResponse_({ ok: false, error: "未対応のPOST actionです。" });
  } catch (error) {
    console.error(error);
    return jsonTextResponse_({ ok: false, error: error.message || String(error) });
  }
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const name = e.range.getSheet().getName();
    const watched = [APP_CONFIG.sheets.normal, APP_CONFIG.sheets.z, "Lealoha", APP_CONFIG.guildListSheet];
    if (watched.includes(name) || getGuildNames_().includes(name)) bumpVersion_();
  } catch (error) {
    console.warn(error);
  }
}

function getAppData_(mode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = APP_CONFIG.sheets[mode];
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("対象シートが見つかりません：" + sheetName);

  SpreadsheetApp.flush();

  return {
    mode,
    sheetName,
    version: getVersion_(),
    updatedAt: new Date().toISOString(),
    options: {
      guilds: getGuildNames_(),
      friendlyMembers: getSheetColumnValues_(APP_CONFIG.guildTemplateSheet, 2, 2, 200),
      placements: getSheetColumnValues_("プルダウン用", 4, 2, 200)
    },
    members: getMemberData_(sheet),
    battleBlocks: APP_CONFIG.battleBlocks.map(block => getBattleBlockData_(sheet, block))
  };
}

function getBattleBlockData_(sheet, block) {
  const rowCount = block.endRow - block.startRow + 1;
  const range = sheet.getRange(block.startRow, 1, rowCount, 33);
  const raw = range.getValues();
  const disp = range.getDisplayValues();

  return {
    id: block.id,
    guildCell: block.guildCell,
    guildName: sheet.getRange(block.guildCell).getDisplayValue(),
    startRow: block.startRow,
    endRow: block.endRow,
    rows: raw.map((r, i) => ({
      row: block.startRow + i,
      friendly: {
        name: disp[i][0],
        attribute: disp[i][4],
        power1: disp[i][5],
        power2: disp[i][6]
      },
      enemy: {
        name: disp[i][12],
        attack1Done: r[13] === true,
        attack2Done: r[14] === true,
        placement: disp[i][15],
        power1: disp[i][17],
        power2: disp[i][19],
        debuff: disp[i][22],
        extraCorrection: disp[i][30],
        weakenedPower1: disp[i][31],
        weakenedPower2: disp[i][32]
      }
    }))
  };
}

function getMemberData_(sheet) {
  const start = APP_CONFIG.memberStartRow;
  const rows = APP_CONFIG.memberEndRow - start + 1;
  const range = sheet.getRange(start, 38, rows, 6);
  const raw = range.getValues();
  const disp = range.getDisplayValues();

  return raw.map((r, i) => {
    const attendance = r[0] === true;
    const realtimeNg = r[4] === true;
    return {
      row: start + i,
      attendance,
      attack1Done: r[1] === true,
      attack2Done: r[2] === true,
      name: disp[i][3],
      realtimeNg,
      placement: disp[i][5],
      status: attendance ? "リアタイ" : realtimeNg ? "配置のみ" : "未確認"
    };
  });
}

function updateAppData_(mode, p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(APP_CONFIG.sheets[mode]);
  if (!sheet) throw new Error("対象シートが見つかりません。");

  const field = String(p.field || "");
  const row = Number(p.row || 0);
  const blockId = Number(p.block || 0);
  const value = p.value == null ? "" : String(p.value);

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error("他の人が更新中です。少し待って再試行してください。");

  try {
    switch (field) {
      case "guild": updateGuild_(sheet, blockId, value); break;
      case "friendlyName": assertBattleRow_(row); setTextOrClear_(sheet.getRange(row, 1), value); break;
      case "enemyAttack1": assertBattleRow_(row); sheet.getRange(row, 14).setValue(toBoolean_(value)); break;
      case "enemyAttack2": assertBattleRow_(row); sheet.getRange(row, 15).setValue(toBoolean_(value)); break;
      case "enemyPlacement": assertBattleRow_(row); setTextOrClear_(sheet.getRange(row, 16), value); break;
      case "extraCorrection": assertBattleRow_(row); setPercent_(sheet.getRange(row, 31), value); break;
      case "memberAttendance": assertMemberRow_(row); sheet.getRange(row, 38).setValue(toBoolean_(value)); break;
      case "memberAttack1": assertMemberRow_(row); sheet.getRange(row, 39).setValue(toBoolean_(value)); break;
      case "memberAttack2": assertMemberRow_(row); sheet.getRange(row, 40).setValue(toBoolean_(value)); break;
      case "memberRealtimeNg": assertMemberRow_(row); sheet.getRange(row, 42).setValue(toBoolean_(value)); break;
      case "memberPlacement": assertMemberRow_(row); setTextOrClear_(sheet.getRange(row, 43), value); break;
      default: throw new Error("更新できない項目です：" + field);
    }

    SpreadsheetApp.flush();
    const version = bumpVersion_();
    const data = getAppData_(mode);
    data.version = version;
    return { ok: true, version, data };
  } finally {
    lock.releaseLock();
  }
}

/* =========================
   ギルド戦力データ
   ========================= */

function getGuildNames_() {
  return getSheetColumnValues_(
    APP_CONFIG.guildListSheet,
    APP_CONFIG.guildListColumn,
    APP_CONFIG.guildListStartRow,
    APP_CONFIG.guildListEndRow
  );
}

function getGuildRoster_(guildName) {
  guildName = validateGuildName_(guildName);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(guildName);
  if (!sheet) throw new Error("ギルドシートが見つかりません：" + guildName);

  const start = APP_CONFIG.guildDataStartRow;
  const end = Math.min(APP_CONFIG.guildDataEndRow, Math.max(sheet.getLastRow(), start));
  const width = APP_CONFIG.guildColumns.power3 - APP_CONFIG.guildColumns.name + 1;
  const values = sheet.getRange(start, APP_CONFIG.guildColumns.name, end - start + 1, width).getValues();

  return values.map((r, i) => {
    const playerName = String(r[0] || "").trim();
    if (!playerName) return null;
    const entries = [
      { attribute: String(r[1] || "").trim(), power: Number(r[2]) || 0 },
      { attribute: String(r[3] || "").trim(), power: Number(r[4]) || 0 },
      { attribute: String(r[5] || "").trim(), power: Number(r[6]) || 0 }
    ].filter(x => x.attribute || x.power);
    return { row: start + i, playerName, entries };
  }).filter(Boolean);
}

function createGuild_(name) {
  name = validateGuildName_(name);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(name)) throw new Error("同名のシートがすでにあります。");

  const template = ss.getSheetByName(APP_CONFIG.guildTemplateSheet);
  if (!template) throw new Error("テンプレートシートが見つかりません：" + APP_CONFIG.guildTemplateSheet);

  const sheet = template.copyTo(ss).setName(name);

  // 戦力データのみ初期化。書式・数式・他列はテンプレートを維持。
  const rows = APP_CONFIG.guildDataEndRow - APP_CONFIG.guildDataStartRow + 1;
  const width = APP_CONFIG.guildColumns.power3 - APP_CONFIG.guildColumns.name + 1;
  sheet.getRange(APP_CONFIG.guildDataStartRow, APP_CONFIG.guildColumns.name, rows, width).clearContent();

  addGuildToList_(name);
  bumpVersion_();
  return { ok: true, name };
}

function savePowerImport_(guildName, rows) {
  guildName = validateGuildName_(guildName);
  if (!Array.isArray(rows) || !rows.length) throw new Error("登録データがありません。");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(guildName);
  if (!sheet) throw new Error("ギルドシートが見つかりません：" + guildName);

  const start = APP_CONFIG.guildDataStartRow;
  const end = APP_CONFIG.guildDataEndRow;
  const nameCol = APP_CONFIG.guildColumns.name;
  const nameValues = sheet.getRange(start, nameCol, end - start + 1, 1).getDisplayValues().flat();
  const rowByName = new Map();
  let nextEmpty = -1;

  nameValues.forEach((v, i) => {
    const n = normalizeName_(v);
    if (n && !rowByName.has(n)) rowByName.set(n, start + i);
    if (nextEmpty < 0 && !String(v || "").trim()) nextEmpty = start + i;
  });

  let updated = 0;
  let created = 0;

  rows.forEach(item => {
    const playerName = String(item.playerName || "").trim();
    if (!playerName) return;

    const entries = Array.isArray(item.entries) ? item.entries.slice(0, 3) : [];
    const normalized = normalizeName_(playerName);
    let row = rowByName.get(normalized);

    if (!row) {
      if (nextEmpty < 0) throw new Error("空き行がありません。");
      row = nextEmpty;
      created++;
      rowByName.set(normalized, row);

      const idx = row - start + 1;
      nextEmpty = -1;
      for (let i = idx; i < nameValues.length; i++) {
        if (!String(nameValues[i] || "").trim()) {
          nextEmpty = start + i;
          break;
        }
      }
    } else {
      updated++;
    }

    const vals = [playerName];
    for (let i = 0; i < 3; i++) {
      const e = entries[i] || {};
      vals.push(normalizeAttribute_(e.attribute));
      vals.push(sanitizePower_(e.power));
    }

    sheet.getRange(row, nameCol, 1, 7).setValues([vals]);
    nameValues[row - start] = playerName;
  });

  SpreadsheetApp.flush();
  const version = bumpVersion_();
  return { ok: true, updated, created, version };
}

function deleteGuildMember_(guildName, playerName) {
  guildName = validateGuildName_(guildName);
  playerName = String(playerName || "").trim();
  if (!playerName) throw new Error("プレイヤー名が空です。");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(guildName);
  if (!sheet) throw new Error("ギルドシートが見つかりません。");

  const roster = getGuildRoster_(guildName);
  const target = roster.find(r => normalizeName_(r.playerName) === normalizeName_(playerName));
  if (!target) throw new Error("対象プレイヤーが見つかりません。");

  sheet.getRange(target.row, APP_CONFIG.guildColumns.name, 1, 7).clearContent();
  bumpVersion_();
  return { ok: true };
}

function clearGuildData_(guildName) {
  guildName = validateGuildName_(guildName);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(guildName);
  if (!sheet) throw new Error("ギルドシートが見つかりません。");

  const rows = APP_CONFIG.guildDataEndRow - APP_CONFIG.guildDataStartRow + 1;
  sheet.getRange(APP_CONFIG.guildDataStartRow, APP_CONFIG.guildColumns.name, rows, 7).clearContent();
  bumpVersion_();
  return { ok: true };
}

function deleteGuild_(name) {
  name = validateGuildName_(name);
  if (name === APP_CONFIG.guildTemplateSheet) throw new Error("テンプレートシートは削除できません。");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error("対象シートが見つかりません。");

  ss.deleteSheet(sheet);
  removeGuildFromList_(name);
  bumpVersion_();
  return { ok: true };
}

function addGuildToList_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(APP_CONFIG.guildListSheet);
  if (!sheet) throw new Error("プルダウン用シートが見つかりません。");

  const names = sheet.getRange(
    APP_CONFIG.guildListStartRow,
    APP_CONFIG.guildListColumn,
    APP_CONFIG.guildListEndRow - APP_CONFIG.guildListStartRow + 1,
    1
  ).getDisplayValues().flat();

  if (names.some(v => normalizeName_(v) === normalizeName_(name))) return;

  const idx = names.findIndex(v => !String(v || "").trim());
  if (idx < 0) throw new Error("ギルド一覧に空きがありません。");
  sheet.getRange(APP_CONFIG.guildListStartRow + idx, APP_CONFIG.guildListColumn).setValue(name);
}

function removeGuildFromList_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(APP_CONFIG.guildListSheet);
  if (!sheet) return;
  const range = sheet.getRange(
    APP_CONFIG.guildListStartRow,
    APP_CONFIG.guildListColumn,
    APP_CONFIG.guildListEndRow - APP_CONFIG.guildListStartRow + 1,
    1
  );
  const values = range.getValues();
  let changed = false;
  values.forEach(r => {
    if (normalizeName_(r[0]) === normalizeName_(name)) {
      r[0] = "";
      changed = true;
    }
  });
  if (changed) range.setValues(values);
}

/* =========================
   東京ディバンカー画像解析
   ========================= */

function analyzeTokyoDebunkerImage_(imageData, filename) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が未設定です。Apps Scriptのスクリプト プロパティに登録してください。");
  }

  imageData = String(imageData || "");
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageData)) {
    throw new Error("画像データ形式が不正です。");
  }
  if (imageData.length > 12 * 1024 * 1024) {
    throw new Error("画像が大きすぎます。");
  }

  const prompt = [
    "これはスマホゲーム『東京ディバンカー』のプレイヤー戦力スクリーンショットです。",
    "次の情報だけを正確に読み取ってください。",
    "1. 画面上部に表示されるプレイヤー名。",
    "2. 所持キャラカードの各カード直下に表示される属性アイコンと個別戦力。",
    "3. 個別戦力が高い順に上位3カードだけ返す。",
    "",
    "属性アイコン: 赤・橙系の炎アイコン=火、青い水滴アイコン=水、緑の葉アイコン=草。",
    "『第2班 896,575』『第3班 1,475,827』など班全体の戦力は絶対に採用しない。",
    "カードのLvやレアリティも戦力として採用しない。",
    "日本語単位は整数へ変換する。例: 1610万=16100000、430万=4300000、5.2万=52000、8397=8397。",
    "同じ属性が上位3件に複数あっても、そのまま別枠として返す。",
    "判別できない場合は属性を『不明』にし、confidenceを下げる。",
    "推測で数字を補完しない。",
    "filename: " + String(filename || "")
  ].join("\n");

  const payload = {
    model: APP_CONFIG.openAIModel,
    store: false,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: imageData, detail: "high" }
      ]
    }],
    text: {
      format: {
        type: "json_schema",
        name: "tokyo_debunker_power",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            playerName: { type: "string" },
            entries: {
              type: "array",
              minItems: 0,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  attribute: { type: "string", enum: ["火", "水", "草", "不明"] },
                  power: { type: "integer", minimum: 0 },
                  rawText: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 1 }
                },
                required: ["attribute", "power", "rawText", "confidence"]
              }
            },
            notes: { type: "string" }
          },
          required: ["playerName", "entries", "notes"]
        }
      }
    },
    max_output_tokens: 1200
  };

  const response = UrlFetchApp.fetch("https://api.openai.com/v1/responses", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error && parsed.error.message ? parsed.error.message : body;
    } catch (_) {}
    throw new Error("画像解析APIエラー (" + code + "): " + detail);
  }

  const parsed = JSON.parse(body);
  const text = extractResponseText_(parsed);
  if (!text) throw new Error("画像解析結果が空でした。");

  const result = JSON.parse(text);
  result.playerName = String(result.playerName || "").trim();
  result.entries = (result.entries || [])
    .map(e => ({
      attribute: normalizeAttribute_(e.attribute),
      power: sanitizePower_(e.power),
      rawText: String(e.rawText || ""),
      confidence: Math.max(0, Math.min(1, Number(e.confidence) || 0))
    }))
    .sort((a, b) => b.power - a.power)
    .slice(0, 3);
  result.notes = String(result.notes || "");
  return result;
}

function extractResponseText_(response) {
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

/* =========================
   共通
   ========================= */

function getVersion_() {
  const props = PropertiesService.getScriptProperties();
  let value = props.getProperty(APP_CONFIG.versionKey);
  if (!value) {
    value = String(Date.now());
    props.setProperty(APP_CONFIG.versionKey, value);
  }
  return value;
}
function bumpVersion_() {
  const value = String(Date.now());
  PropertiesService.getScriptProperties().setProperty(APP_CONFIG.versionKey, value);
  return value;
}
function updateGuild_(sheet, blockId, value) {
  const block = APP_CONFIG.battleBlocks.find(b => b.id === blockId);
  if (!block) throw new Error("対戦表番号が不正です。");
  if (!value) throw new Error("対戦ギルドを選択してください。");
  sheet.getRange(block.guildCell).setValue(value);
}
function assertBattleRow_(row) {
  if (!APP_CONFIG.battleBlocks.some(b => row >= b.startRow && row <= b.endRow)) throw new Error("対戦表の行番号が不正です。");
}
function assertMemberRow_(row) {
  if (row < APP_CONFIG.memberStartRow || row > APP_CONFIG.memberEndRow) throw new Error("メンバー表の行番号が不正です。");
}
function setTextOrClear_(range, value) {
  const text = String(value || "").trim();
  if (text === "") range.clearContent(); else range.setValue(text);
}
function setPercent_(range, value) {
  const text = String(value || "").replace("%", "").trim();
  if (text === "") { range.clearContent(); return; }
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("追加補正は0～100で入力してください。");
  range.setValue(n / 100);
  range.setNumberFormat("0%");
}
function toBoolean_(value) { return String(value).toLowerCase() === "true"; }
function normalizeMode_(mode) { return String(mode || "normal").toLowerCase() === "z" ? "z" : "normal"; }
function normalizeName_(value) { return String(value || "").normalize("NFKC").trim().toLowerCase(); }
function normalizeAttribute_(value) {
  const v = String(value || "").trim();
  return ["火", "水", "草", "不明"].includes(v) ? v : (v ? "不明" : "");
}
function sanitizePower_(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}
function validateGuildName_(name) {
  name = String(name || "").trim();
  if (!name) throw new Error("ギルド名が空です。");
  if (name.length > 80) throw new Error("ギルド名が長すぎます。");
  if (/[:\\\/\?\*\[\]]/.test(name)) throw new Error("ギルド名にシート名で使えない文字が含まれています。");
  return name;
}
function decodePayload_(payload) {
  try {
    const text = decodeURIComponent(String(payload || ""));
    return JSON.parse(text);
  } catch (_) {
    throw new Error("登録データの形式が不正です。");
  }
}
function getSheetColumnValues_(sheetName, column, startRow, endRow) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  return [...new Set(
    sheet.getRange(startRow, column, endRow - startRow + 1, 1)
      .getDisplayValues().flat().map(v => String(v).trim()).filter(Boolean)
  )];
}
function outputResponse_(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    const safe = String(callback).replace(/[^\w.$]/g, "");
    return ContentService.createTextOutput(`${safe}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
function jsonTextResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function testGetAppData() {
  console.log(JSON.stringify(getAppData_("normal"), null, 2));
}
function testTokyoDebunkerApiConfigured() {
  console.log({
    model: APP_CONFIG.openAIModel,
    apiKeyConfigured: !!PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY")
  });
}
