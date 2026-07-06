// scripts/parsers/jwxe.js
// 연세대で広く使われている jwxe 系CMSの掲示板一覧パーサー。
// 一覧テーブルの列構成: 번호 / 제목 / 첨부 / 작성자 / 등록일
// 詳細ページURL: ...notice.do?mode=view&articleNo=ID

import * as cheerio from "cheerio";
import {
  normalizeDate,
  findDateInText,
  resolveUrl,
  extractParam,
  cleanText,
  looksPinned,
} from "./utils.js";

/**
 * jwxe型の一覧HTMLをパースして記事配列を返す。
 * @param {string} html    一覧ページのHTML
 * @param {string} baseUrl 一覧ページのURL (相対リンク解決用)
 * @returns {Array<{id,title,url,date,category,pinned}>}
 */
export function parse(html, baseUrl) {
  const $ = cheerio.load(html);
  const items = [];

  // 「제목」をヘッダに含むテーブルを掲示板テーブルとみなす
  const $table = pickBoardTable($);
  if (!$table) return items;

  // ヘッダから列の位置を特定 (サイトによって微妙に列順が違う場合に備える)
  const headers = $table
    .find("thead th, thead td, tr:first-child th")
    .map((_, el) => cleanText($(el).text()))
    .get();
  const col = {
    no: indexOfHeader(headers, ["번호", "No", "no"]),
    title: indexOfHeader(headers, ["제목", "title"]),
    date: indexOfHeader(headers, ["등록일", "작성일", "날짜", "date"]),
  };

  $table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const $cells = $tr.find("td");
    if ($cells.length === 0) return; // ヘッダ行などはスキップ

    // タイトルセル内の詳細リンク (articleNo付き) を探す
    let $link = $tr.find('a[href*="articleNo="]').first();
    if ($link.length === 0) {
      // articleNoが無いケースは、タイトル列のリンクをフォールバックで使う
      const $titleCell = col.title >= 0 ? $cells.eq(col.title) : $cells.eq(1);
      $link = $titleCell.find("a").first();
    }
    if ($link.length === 0) return;

    const url = resolveUrl($link.attr("href"), baseUrl);
    if (!url) return;

    const id = extractParam(url, ["articleNo"]) || url;
    const title = cleanText($link.text());
    if (!title) return;

    // 番号セル: 「공지」等の固定表示なら pinned 扱い
    const noText =
      col.no >= 0 ? cleanText($cells.eq(col.no).text()) : cleanText($cells.eq(0).text());
    const pinned =
      looksPinned(noText) ||
      $tr.hasClass("notice") ||
      $tr.find(".notice, .c-board-notice").length > 0;

    // 日付: 등록일列 → 行全体のテキストの順で探す
    let date = null;
    if (col.date >= 0 && $cells.eq(col.date).length) {
      date = normalizeDate(cleanText($cells.eq(col.date).text()));
    }
    if (!date) date = findDateInText($tr.text());

    items.push({
      id: String(id),
      title,
      url,
      date,
      category: null, // jwxe型の一覧にはカテゴリ列がない
      pinned,
    });
  });

  return items;
}

/** 掲示板らしいテーブルを1つ選ぶ */
function pickBoardTable($) {
  let found = null;
  $("table").each((_, el) => {
    if (found) return;
    const headText = cleanText($(el).find("thead, tr:first-child").first().text());
    if (headText.includes("제목")) found = $(el);
  });
  // 見つからなければ articleNo リンクを含む最初のテーブル
  if (!found) {
    $("table").each((_, el) => {
      if (found) return;
      if ($(el).find('a[href*="articleNo="]').length > 0) found = $(el);
    });
  }
  return found;
}

/** ヘッダ配列から候補名に一致する列indexを返す (なければ -1) */
function indexOfHeader(headers, candidates) {
  return headers.findIndex((h) => candidates.some((c) => h.includes(c)));
}
