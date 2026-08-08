#!/usr/bin/env node
// 셋업 마법사: 노션 연결 → DB 선택/생성 → Plaud 로그인 → 첫 적재 → 자동 실행 등록
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { execFileSync } from 'node:child_process';
import { readConfig, writeConfig, CONFIG_FILE, HOME } from './lib/config.mjs';
import { notion, searchPages, searchDatabases, createDatabase, resolveSchema } from './lib/notion.mjs';
import { openBrowser, gotoApp, isLoggedIn } from './lib/plaud.mjs';

const rl = readline.createInterface({ input, output });
const ask = (q, d = '') => rl.question(d ? `${q} [${d}] ` : `${q} `).then((a) => a.trim() || d);
const yes = async (q, d = 'y') => /^y/i.test(await ask(`${q} (y/n)`, d));
const line = () => console.log('─'.repeat(60));

console.log('');
console.log('  Plaud → Notion 셋업');
console.log('  요약이 끝난 Plaud 노트를 내 컴퓨터에서 노션으로 자동 적재합니다.');
line();

// 0) 크롬 확인 — 설치된 크롬을 쓰면 브라우저를 따로 받지 않아도 된다
let browserChannel = 'chrome';
const chromePaths = [
  '/Applications/Google Chrome.app',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
if (!chromePaths.some((p) => fs.existsSync(p))) {
  console.log('⚠️  구글 크롬이 안 보입니다. 크로미움을 내려받아 사용합니다(약 150MB).');
  if (await yes('   지금 내려받을까요?')) {
    execFileSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
    browserChannel = null;
  } else {
    console.log('   크롬 설치 후 다시 실행해 주세요.');
    process.exit(1);
  }
}

const existing = readConfig() || {};

// 1) 노션 토큰
line();
console.log('1) 노션 연결');
console.log('   https://www.notion.so/my-integrations 에서 [새 API 통합]을 만들고');
console.log('   "내부 통합 시크릿"(ntn_… 으로 시작)을 복사하세요.');
console.log('   ※ 토큰은 이 컴퓨터의 ' + CONFIG_FILE + ' 에만 저장됩니다.');
const notionToken = await ask('   통합 시크릿:', existing.notionToken || '');
if (!notionToken) { console.error('토큰이 필요합니다.'); process.exit(1); }
const call = notion(notionToken);

// 2) DB 선택 또는 생성
line();
console.log('2) 적재할 노션 데이터베이스');
console.log('   노션에서 대상 페이지(또는 DB)를 열고 ⋯ → [연결] 에서 방금 만든 통합을 추가해야');
console.log('   아래 목록에 나타납니다.');
await ask('   추가했으면 엔터를 누르세요.', '');

let notionDatabaseId = '';
const dbs = await searchDatabases(call);
if (dbs.length) {
  console.log('   접근 가능한 DB:');
  dbs.forEach((d, i) => console.log(`     ${i + 1}. ${d.title}`));
  console.log(`     0. 새 DB 만들기`);
  const pick = Number(await ask('   번호 선택:', '0'));
  if (pick >= 1 && pick <= dbs.length) notionDatabaseId = dbs[pick - 1].id;
}

if (!notionDatabaseId) {
  const pages = await searchPages(call);
  if (!pages.length) {
    console.error('   접근 가능한 페이지가 없습니다. 통합을 페이지에 연결한 뒤 다시 실행하세요.');
    process.exit(1);
  }
  console.log('   새 DB를 만들 위치(부모 페이지):');
  pages.forEach((p, i) => console.log(`     ${i + 1}. ${p.title}`));
  const pick = Number(await ask('   번호 선택:', '1'));
  const parent = pages[Math.min(Math.max(pick, 1), pages.length) - 1];
  const title = await ask('   DB 이름:', 'Plaud 노트');
  const db = await createDatabase(call, parent.id, title);
  notionDatabaseId = db.id;
  console.log(`   ✅ 생성됨: ${title}`);
}

// 기존 DB라면 부족한 속성을 채워 넣는다
const schema = await resolveSchema(call, notionDatabaseId);
console.log('   속성 매핑:', Object.entries(schema)
  .filter(([k]) => k !== 'props')
  .map(([k, v]) => `${k}→${v}`)
  .join(', '));

// 3) 옵션
line();
console.log('3) 옵션');
const includeTranscript = await yes('   전사본 전문도 페이지 본문에 넣을까요?');
const intervalMinutes = Number(await ask('   몇 분마다 확인할까요?', String(existing.intervalMinutes ?? 10)));
const slackWebhookUrl = await ask('   세션 만료 알림용 슬랙 웹훅 URL (없으면 엔터):', existing.slackWebhookUrl || '');

writeConfig({
  notionToken, notionDatabaseId, includeTranscript, intervalMinutes,
  slackWebhookUrl: slackWebhookUrl || undefined,
  browserChannel,
});
console.log(`   설정 저장: ${CONFIG_FILE}`);

// 4) Plaud 로그인
line();
console.log('4) Plaud 로그인');
console.log('   창이 열리면 로그인하세요. 세션은 이 컴퓨터의 크롬 프로필에만 남습니다.');
console.log('   (구글 로그인이 막히면 "Sign in with a code" 사용)');
const { ctx, page } = await openBrowser({ headless: false, channel: browserChannel });
await gotoApp(page).catch(() => {});
let logged = false;
const deadline = Date.now() + 10 * 60 * 1000;
while (Date.now() < deadline) {
  await page.waitForTimeout(5000);
  if (await isLoggedIn(page)) { logged = true; break; }
  process.stdout.write('.');
}
console.log('');
await ctx.close();
if (!logged) { console.error('   ❌ 로그인 확인 실패. `npm run login` 으로 다시 시도하세요.'); process.exit(1); }
console.log('   ✅ 로그인 확인됨');

// 5) 첫 적재
line();
console.log('5) 첫 적재');
const limit = Number(await ask('   최근 몇 건까지 가져올까요? (기존 노트 백필)', '30'));
execFileSync(process.execPath, ['poller.mjs', '--limit', String(limit)], { stdio: 'inherit' });

// 6) 자동 실행
line();
if (process.platform === 'darwin' && await yes('6) 자동 실행을 등록할까요?')) {
  execFileSync(process.execPath, ['schedule.mjs', 'install'], { stdio: 'inherit' });
}

line();
console.log('끝났습니다. 이제 녹음하고 Plaud가 요약을 마치면 알아서 노션에 들어옵니다.');
console.log(`로그: ${HOME}/poller.log`);
rl.close();
