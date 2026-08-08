#!/usr/bin/env node
// Plaud 로그인 창을 띄운다. 로그인하면 세션이 크롬 프로필에 저장되고,
// 이후 폴러는 그 프로필로 조용히 돌아간다.
import { readConfig } from './lib/config.mjs';
import { openBrowser, gotoApp, isLoggedIn } from './lib/plaud.mjs';

const cfg = readConfig() || {};
const { ctx, page } = await openBrowser({ headless: false, channel: cfg.browserChannel ?? 'chrome' });

await gotoApp(page).catch(() => {});
console.log('');
console.log('창이 열렸습니다. Plaud에 로그인하세요.');
console.log('  · 쿠키 배너는 아무거나 골라도 됩니다');
console.log('  · 구글 로그인이 막히면 "Sign in with a code"(이메일 코드)를 쓰세요');
console.log('');

const deadline = Date.now() + 10 * 60 * 1000;
let ok = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(5000);
  if (await isLoggedIn(page)) { ok = true; break; }
  process.stdout.write('.');
}
console.log('');
console.log(ok ? '✅ 로그인 확인됨 — 세션을 저장했습니다.' : '❌ 10분 안에 로그인이 확인되지 않았습니다.');

await ctx.close();
process.exit(ok ? 0 : 1);
