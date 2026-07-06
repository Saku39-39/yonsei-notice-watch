// scripts/parsers/utils.js
// 各パーサーで共通して使うユーティリティ関数集

/**
 * 日付らしき文字列を ISO 8601 (YYYY-MM-DD) に正規化する。
 * 対応形式:
 *   - 2026.07.01 / 2026-07-01 / 2026/07/01 / 2026.7.1
 *   - 26.07.01 のような2桁年 (2000年代とみなす)
 *   - "10:23" のような時刻のみ (掲示板で「今日の投稿」を意味することが多い) → 今日の日付
 * 変換できない場合は null を返す。
 */
export function normalizeDate(text) {
  if (!text) return null;
  const t = String(text).trim();

  // YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD
  let m = t.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  // YY.MM.DD (2桁年)
  m = t.match(/(^|\D)(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(\D|$)/);
  if (m) {
    return toIso(2000 + Number(m[2]), Number(m[3]), Number(m[4]));
  }

  // 時刻のみ (例: "10:23") → 今日の投稿として扱う
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const now = new Date();
    return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  return null;
}

/** 年月日を YYYY-MM-DD 文字列にする。不正な値なら null */
function toIso(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** テキスト内に日付らしき文字列があれば抜き出して正規化する */
export function findDateInText(text) {
  if (!text) return null;
  const m = String(text).match(/\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/);
  return m ? normalizeDate(m[0]) : null;
}

/**
 * 相対URLをベースURLに対して絶対URLへ解決する。
 * 失敗した場合は null。
 */
export function resolveUrl(href, baseUrl) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * URLのクエリパラメータから、候補名リストのうち最初に見つかった値を返す。
 * 例: extractParam(url, ["articleNo", "uid"])
 */
export function extractParam(url, names) {
  try {
    const u = new URL(url);
    for (const name of names) {
      const v = u.searchParams.get(name);
      if (v) return v;
    }
  } catch {
    /* 無効なURLは無視 */
  }
  return null;
}

/** 空白の連続を1つにまとめてトリムする */
export function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * URLから簡易的なハッシュIDを生成する (genericパーサーのフォールバック用)。
 * FNV-1a 32bit。
 */
export function hashId(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "h" + (h >>> 0).toString(16);
}

/** 「공지」「NOTICE」など、固定表示(ピン留め)を示すテキストかどうか */
export function looksPinned(text) {
  const t = cleanText(text);
  if (!t) return false;
  if (/^\d+$/.test(t)) return false; // 純粋な通番はピン留めではない
  return /공지|필독|notice|중요/i.test(t) || !/\d/.test(t);
}
