import fs from "node:fs";
import type { Page } from "@playwright/test";
import { parseSituation, prefillPath, PREFILL_KEY } from "../../../src/lib/client/parse";

const regions = JSON.parse(fs.readFileSync("public/bundles/v1/regions.json", "utf8"));

/** 홈 검색창 제거 뒤에도 기존 해석 확인/판정 회귀를 검사하기 위한 진입 데이터.
 * 새 홈→음성/질문 흐름은 landing.spec.ts와 voice-search.spec.ts에서 별도로 확인한다.
 */
export async function openPrefill(page: Page, text: string) {
  const parsed = parseSituation(text, regions);
  if (!parsed.looksLikeSituation) {
    await page.goto(`/search?q=${encodeURIComponent(text)}`);
    return;
  }
  await page.goto("/");
  await page.evaluate(({ key, text, parsed }) => {
    sessionStorage.setItem(key, JSON.stringify({ text, parsed, at: Date.now() }));
  }, { key: PREFILL_KEY, text, parsed });
  await page.goto(prefillPath(parsed));
}
