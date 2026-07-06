// scripts/parsers/kboard.js
// WordPressプラグイン KBoard の掲示板一覧パーサー。
// 一覧テーブルの列構成: 번호 / 카테고리 / 제목 / 작성자 / 파일 / 작성일 / 추천 / 조회
// 詳細ページURL: ...?mod=document&uid=ID

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
 * KBoard型の一覧HTMLをパースして記事配列を返す。
 * @param {string} html    一覧ページのHTML
 * @param {string} baseUrl 一覧ページのURL (相対リンク解決用)
 * @returns {Array<{id,title,url,date,category,pinned}>}
 */
export function parse(html, baseUrl) {
  const $ = cheerio.load(html);
  const items = [];

  const $table = pickBoardTable($);
  if (!$table) return items;

  // ヘッダから列位置を特定
  const headers = $table
    .find("thead th, thead td, tr:first-child th")
    .map((_, el) => cleanText($(el).text()))
    .get();
  const col = {
    no: indexOfHeader(headers, ["번호"]),
    category: indexOfHeader(headers, ["카테고리", "분류"]),
    title: indexOfHeader(headers, ["제목"]),
    date: indexOfHeader(headers, ["작성일", "등록일", "날짜"]),
  };

  $table.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const $cells = $tr.find("td");
    if ($cells.length === 0) return;

    // 詳細リンク: uid付きのリンクを優先
    let $link = $tr.find('a[href*="uid="]').first();
    if ($link.length === 0) {
      const $titleCell = col.title >= 0 ? $cells.eq(col.title) : $cells.eq(2);
      $link = $titleCell.find("a").first();
    }
    if ($link.length === 0) return;

    const url = resolveUrl($link.attr("href"), baseUrl);
    if (!url) return;

    const id = extractParam(url, ["uid"]) || url;

    // KBoardはタイトルリンク内にカテゴリや添付アイコン等のspanが混ざることがあるので、
    // .kboard-default-cut-strings などタイトル専用要素があれば優先する
    const $titleText = $link.find(".kboard-default-cut-strings").first();
    const title = cleanText($titleText.length ? $titleText.text() : $link.text());
    if (!title) return;

    // カテゴリ列
    let category = null;
    if (col.category >= 0 && $cells.eq(col.category).length) {
      category = cleanText($cells.eq(col.category).text()) || null;
    }

    // 番号セルの「공지」やKBoard固有のnoticeクラスで pinned 判定
    const noText =
      col.no >= 0 ? cleanText($cells.eq(col.no).text()) : cleanText($cells.eq(0).text());
    const pinned =
      looksPinned(noText) ||
      $tr.hasClass("kboard-list-notice") ||
      $tr.find(".kboard-list-notice").length > 0;

    // 日付: 작성일列 → 行全体の順で探す (今日の投稿は "10:23" 形式のことがある)
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
      category,
      pinned,
    });
  });

  return items;
}

/** KBoardの一覧テーブルを選ぶ */
function pickBoardTable($) {
  // KBoard標準のクラスを最優先
  const $kb = $(".kboard-list table, table.kboard-list-table").first();
  if ($kb.length) return $kb;

  // ヘッダに「제목」を含むテーブル
  let found = null;
  $("table").each((_, el) => {
    if (found) return;
    const headText = cleanText($(el).find("thead, tr:first-child").first().text());
    if (headText.includes("제목")) found = $(el);
  });
  // それでも無ければ uid リンクを含むテーブル
  if (!found) {
    $("table").each((_, el) => {
      if (found) return;
      if ($(el).find('a[href*="uid="]').length > 0) found = $(el);
    });
  }
  return found;
}

function indexOfHeader(headers, candidates) {
  return headers.findIndex((h) => candidates.some((c) => h.includes(c)));
}
