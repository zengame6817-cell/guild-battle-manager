/**
 * ギルド対戦管理 API v2.1
 * 軽量な更新番号チェック + 変更時のみ全データ取得
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
  versionKey: "GBM_VERSION"
};

function doGet(e) {
  try {
    const p = e && e.parameter ? e.parameter : {};
    const action = String(p.action || "data");
    const mode = normalizeMode_(p.mode);
    let result;

    if (action === "data") {
      result = { ok: true, data: getAppData_(mode) };
    } else if (action === "version") {
      result = { ok: true, version: getVersion_() };
    } else if (action === "update") {
      result = updateAppData_(mode, p);
    } else if (action === "ping") {
      result = { ok: true, message: "API v2.1 is working", version: getVersion_() };
    } else {
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
 * スプレッドシートを直接編集した時にも更新番号を進める。
 * 既存コードに onEdit がなければ、このままでOK。
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const name = e.range.getSheet().getName();
    const watched = [
      APP_CONFIG.sheets.normal,
      APP_CONFIG.sheets.z,
      "Lealoha",
      "プルダウン用"
    ];
    if (watched.includes(name)) bumpVersion_();
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
    mode: mode,
    sheetName: sheetName,
    version: getVersion_(),
    updatedAt: new Date().toISOString(),
    options: {
      guilds: getSheetColumnValues_("プルダウン用", 11, 2, 200),
      friendlyMembers: getSheetColumnValues_("Lealoha", 2, 2, 200),
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
      attendance: attendance,
      attack1Done: r[1] === true,
      attack2Done: r[2] === true,
      name: disp[i][3],
      realtimeNg: realtimeNg,
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
  if (!lock.tryLock(10000)) {
    throw new Error("他の人が更新中です。少し待って再試行してください。");
  }

  try {
    switch (field) {
      case "guild":
        updateGuild_(sheet, blockId, value);
        break;
      case "friendlyName":
        assertBattleRow_(row); setTextOrClear_(sheet.getRange(row, 1), value); break;
      case "enemyAttack1":
        assertBattleRow_(row); sheet.getRange(row, 14).setValue(toBoolean_(value)); break;
      case "enemyAttack2":
        assertBattleRow_(row); sheet.getRange(row, 15).setValue(toBoolean_(value)); break;
      case "enemyPlacement":
        assertBattleRow_(row); setTextOrClear_(sheet.getRange(row, 16), value); break;
      case "extraCorrection":
        assertBattleRow_(row); setPercent_(sheet.getRange(row, 31), value); break;
      case "memberAttendance":
        assertMemberRow_(row); sheet.getRange(row, 38).setValue(toBoolean_(value)); break;
      case "memberAttack1":
        assertMemberRow_(row); sheet.getRange(row, 39).setValue(toBoolean_(value)); break;
      case "memberAttack2":
        assertMemberRow_(row); sheet.getRange(row, 40).setValue(toBoolean_(value)); break;
      case "memberRealtimeNg":
        assertMemberRow_(row); sheet.getRange(row, 42).setValue(toBoolean_(value)); break;
      case "memberPlacement":
        assertMemberRow_(row); setTextOrClear_(sheet.getRange(row, 43), value); break;
      default:
        throw new Error("更新できない項目です：" + field);
    }

    SpreadsheetApp.flush();
    const version = bumpVersion_();

    // 更新した本人は追加の通信なしで最新表示にできるよう、最新データも返す。
    const data = getAppData_(mode);
    data.version = version;

    return { ok: true, version: version, data: data };
  } finally {
    lock.releaseLock();
  }
}

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
  if (!APP_CONFIG.battleBlocks.some(b => row >= b.startRow && row <= b.endRow)) {
    throw new Error("対戦表の行番号が不正です。");
  }
}

function assertMemberRow_(row) {
  if (row < APP_CONFIG.memberStartRow || row > APP_CONFIG.memberEndRow) {
    throw new Error("メンバー表の行番号が不正です。");
  }
}

function setTextOrClear_(range, value) {
  const text = String(value || "").trim();
  if (text === "") range.clearContent();
  else range.setValue(text);
}

function setPercent_(range, value) {
  const text = String(value || "").replace("%", "").trim();
  if (text === "") {
    range.clearContent();
    return;
  }
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error("追加補正は0～100で入力してください。");
  }
  range.setValue(n / 100);
  range.setNumberFormat("0%");
}

function toBoolean_(value) {
  return String(value).toLowerCase() === "true";
}

function normalizeMode_(mode) {
  return String(mode || "normal").toLowerCase() === "z" ? "z" : "normal";
}

function getSheetColumnValues_(sheetName, column, startRow, endRow) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  return [...new Set(
    sheet.getRange(startRow, column, endRow - startRow + 1, 1)
      .getDisplayValues().flat()
      .map(v => String(v).trim())
      .filter(Boolean)
  )];
}

function outputResponse_(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    const safe = String(callback).replace(/[^\w.$]/g, "");
    return ContentService.createTextOutput(`${safe}(${json});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function testGetAppData() {
  console.log(JSON.stringify(getAppData_("normal"), null, 2));
}
