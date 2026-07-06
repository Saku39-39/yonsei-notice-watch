// scripts/parsers/generic.js
// CMSタイプが不明なサイト向けのベストエフォート・フォールバックパーサー。
// 方針:
//   1. <table> があれば行ごとに「リンク + 日付らしき文字列」を探す
//   2. なければ <ul>/<ol> の <li> 単位で同様に探す
//   3. それも無ければ、ページ内の全リンクのうち親要素テキストに日付を含むものを拾う
// 結果には必ず confidence: "low" を付与する (取得漏れ・誤検出の可能性があるため)。

import * as cheerio from "cheerio";
import {
  findDateInText,
  resolveUrl,
  extractParam,
  cleanText,
  hashId,
  looksPinned,
} from "./utils.js";

// idとして使えそうな代表的なクエリパラメータ名
const ID_PARAMS = ["articleNo", "uid", "id", "no", "seq", "idx", "num", "bbsId", "nttId"];

/**
 * generic型のHTMLをパースして記事配列を返す。
 * @param {string} html    一覧ページのHTML
 * @param {string} baseUrl 一覧ページのURL
 * @returns {Array<{id,title,url,date,category,pinned,confidence}>}
 */
export function parse(html, baseUrl) {
  const $ = cheerio.load(html);

  // ナビゲーション等のノイズを軽減
  $("nav, header, footer, script, style").remove();

  let items = [];

  // --- 戦略1: テーブル行から抽出 ---
  $("table").each((_, table) => {
    const rows = extractFromRows($, $(table).find("tr"), baseUrl);
    if (rows.length > items.length) items = rows; // 一番「記事らしい」テーブルを採用
  });

  // --- 戦略2: リスト(<li>)から抽出 ---
  if (items.length === 0) {
    $("ul, ol").each((_, list) => {
      const rows = extractFromRows($, $(list).children("li"), baseUrl);
      if (rows.length > items.length) items = rows;
    });
  }

  // --- 戦略3: 日付を伴うリンクを総当たりで抽出 ---
  if (items.length === 0) {
    const seen = new Set();
    $("a[href]").each((_, a) => {
      const $a = $(a);
      const url = resolveUrl($a.attr("href"), baseUrl);
      const title = cleanText($a.text());
      if (!url || !title || title.length < 4) return;
      // リンクの親要素のテキストに日付らしき文字列があるものだけ拾う
      const date = findDateInText($a.parent().text());
      if (!date) return;
      if (seen.has(url)) return;
      seen.add(url);
      items.push(buildItem({ url, title, date }));
    });
  }

  return items;
}

/** tr / li の集合から「リンク+日付」ペアを抽出する共通処理 */
function extractFromRows($, $rows, baseUrl) {
  const results = [];
  const seen = new Set();

  $rows.each((_, row) => {
    const $row = $(row);
    const $link = $row.find("a[href]").first();
    if ($link.length === 0) return;

    const url = resolveUrl($link.attr("href"), baseUrl);
    const title = cleanText($link.text());
    if (!url || !title || title.length < 2) return;

    // ページ内リンク・javascriptリンクは除外
    if (url.includes("javascript:") || $link.attr("href")?.startsWith("#")) return;

    const date = findDateInText($row.text());
    if (!date) return; // 日付が見つからない行は「記事」とみなさない

    if (seen.has(url)) return;
    seen.add(url);

    // 行頭テキストが「공지」等なら pinned とみなす
    const leading = cleanText($row.children().first().text());
    results.push(buildItem({ url, title, date, pinned: looksPinned(leading) }));
  });

  return results;
}

/** 共通の記事オブジェクトを組み立てる */
function buildItem({ url, title, date, pinned = false }) {
  const id = extractParam(url, ID_PARAMS) || hashId(url);
  return {
    id: String(id),
    title,
    url,
    date,
    category: null,
    pinned,
    confidence: "low", // genericパーサーの結果は常に低信頼としてマークする
  };
}
