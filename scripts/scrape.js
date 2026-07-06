// scripts/scrape.js
// docs/sites.config.json を読み込み、各サイトを巡回して data/notices.json を生成する。
//
// 使い方:
//   node scripts/scrape.js                  … 実際にHTTPリクエストを送って取得
//   node scripts/scrape.js --from-fixtures  … test/fixtures/{site_id}.html を入力に使う (テスト用)
//
// 出力:
//   data/notices.json       (正本)
//   docs/data/notices.json  (GitHub Pagesはdocs/配下しか配信しないためコピーを置く)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import iconv from "iconv-lite";

import * as jwxe from "./parsers/jwxe.js";
import * as kboard from "./parsers/kboard.js";
import * as generic from "./parsers/generic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CONFIG_PATH = path.join(ROOT, "docs", "sites.config.json");
const OUTPUT_PATH = path.join(ROOT, "data", "notices.json");
const DOCS_OUTPUT_PATH = path.join(ROOT, "docs", "data", "notices.json");
const FIXTURES_DIR = path.join(ROOT, "test", "fixtures");

const MAX_ITEMS_PER_SITE = 20; // 各サイト直近50件程度
const FETCH_TIMEOUT_MS = 30000;

// typeに応じたパーサーの対応表
const PARSERS = {
  jwxe: jwxe.parse,
  kboard: kboard.parse,
  generic: generic.parse,
};

const useFixtures = process.argv.includes("--from-fixtures");

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});

async function main() {
  // 設定ファイルを読み込む
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
  const sites = Array.isArray(config.sites) ? config.sites : [];

  console.log(
    `${sites.length} サイトを処理します ${useFixtures ? "(フィクスチャモード)" : ""}`
  );

  const results = [];

  // 1サイトの失敗が他に波及しないよう、サイトごとに独立して try-catch する
  for (const site of sites) {
    if (site.status && site.status !== "active") {
      console.log(`- ${site.site_id}: status=${site.status} のためスキップ`);
      continue;
    }

    try {
      const html = useFixtures
        ? await readFixture(site.site_id)
        : await fetchHtml(site.site_url);

      const parser = PARSERS[site.type] || PARSERS.generic;
      let items = parser(html, site.site_url);

      // 新着順 (日付降順、pinnedは先頭) に整えて上限件数まで
      items = sortItems(items).slice(0, MAX_ITEMS_PER_SITE);

      results.push({
        site_id: site.site_id,
        site_name: site.site_name,
        site_url: site.site_url,
        type: site.type,
        status: "ok",
        fetched_at: new Date().toISOString(),
        count: items.length,
        items,
      });
      console.log(`- ${site.site_id}: ${items.length} 件取得 (type=${site.type})`);

      if (items.length === 0) {
        console.warn(
          `  警告: ${site.site_id} の取得件数が0件です。ページ構造が想定と異なる可能性があります。`
        );
      }
    } catch (err) {
      // 失敗したサイトはエラー情報だけ記録して続行
      console.error(`- ${site.site_id}: 取得失敗 → ${err.message}`);
      results.push({
        site_id: site.site_id,
        site_name: site.site_name,
        site_url: site.site_url,
        type: site.type,
        status: "error",
        fetched_at: new Date().toISOString(),
        error: err.message,
        count: 0,
        items: [],
      });
    }
  }

  const output = {
    generated_at: new Date().toISOString(),
    sites: results,
  };

  // data/ と docs/data/ の両方に書き出す
  await writeJson(OUTPUT_PATH, output);
  await writeJson(DOCS_OUTPUT_PATH, output);

  const total = results.reduce((sum, s) => sum + s.count, 0);
  console.log(`完了: 合計 ${total} 件を ${path.relative(ROOT, OUTPUT_PATH)} に保存しました`);
}

/** URLからHTMLを取得する。文字コードはヘッダ/metaタグから推定してデコードする */
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 一部サイトはUAなしのリクエストを拒否するため、一般的なUAを名乗る
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "ko,ja;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());

    // Content-Typeヘッダ → metaタグの順で文字コードを推定 (古いサイトはEUC-KRのことがある)
    let charset = detectCharset(res.headers.get("content-type") || "");
    if (!charset) {
      const head = buf.slice(0, 2048).toString("ascii");
      charset = detectCharset(head);
    }
    charset = (charset || "utf-8").toLowerCase();

    if (charset === "utf-8" || charset === "utf8") {
      return buf.toString("utf-8");
    }
    return iconv.decode(buf, charset);
  } finally {
    clearTimeout(timer);
  }
}

/** 文字列から charset=xxx を抜き出す */
function detectCharset(text) {
  const m = String(text).match(/charset\s*=\s*["']?([\w-]+)/i);
  return m ? m[1] : null;
}

/** テスト用: test/fixtures/{site_id}.html を読む */
async function readFixture(siteId) {
  const p = path.join(FIXTURES_DIR, `${siteId}.html`);
  return fs.readFile(p, "utf-8");
}

/** pinnedを先頭に、それ以外は日付降順に並べる */
function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return String(b.date || "").localeCompare(String(a.date || ""));
  });
}

/** ディレクトリを作りつつJSONを書き出す */
async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
