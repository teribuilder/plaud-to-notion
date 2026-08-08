#!/usr/bin/env node
// 진단: 안 될 때 어디가 막혔는지 한 번에 보여준다.
//   node doctor.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readConfig, readState, HOME, PROFILE_DIR, CONFIG_FILE } from './lib/config.mjs';
import { openBrowser, gotoApp, isLoggedIn } from './lib/plaud.mjs';
import { notion } from './lib/notion.mjs';

const ok = (s) => console.log('  ✅ ' + s);
const no = (s) => console.log('  ❌ ' + s);
const hm = (s) => console.log('  ⚠️  ' + s);

console.log('\nplaud-to-notion 진단\n' + '─'.repeat(50));

console.log(`OS: ${process.platform} ${os.release()} / Node ${process.version}`);
if (Number(process.versions.node.split('.')[0]) < 20) no('Node 20 이상이 필요합니다 (nodejs.org에서 설치)');
else ok('Node 버전 OK');

// 크롬
const chromePaths = process.platform === 'win32'
  ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
     'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
     path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')]
  : ['/Applications/Google Chrome.app'];
if (chromePaths.some((p) => fs.existsSync(p))) ok('구글 크롬 설치됨');
else hm('크롬이 안 보입니다 — 설정에서 크로미움을 쓰고 있다면 정상입니다');

// 설정
const cfg = readConfig();
if (!cfg) { no(`설정 없음 — 먼저 npm run setup 을 실행하세요 (${CONFIG_FILE})`); process.exit(1); }
ok(`설정 파일 있음 (${CONFIG_FILE})`);
console.log(`     확인 주기 ${cfg.intervalMinutes ?? 10}분 / 전사본 포함 ${cfg.includeTranscript !== false ? 'Y' : 'N'} / 슬랙알림 ${cfg.slackWebhookUrl ? 'Y' : 'N'}`);

// 노션
try {
  const call = notion(cfg.notionToken);
  const db = await call('GET', '/databases/' + cfg.notionDatabaseId);
  const title = (db.title || []).map((t) => t.plain_text).join('') || '(제목 없음)';
  ok(`노션 연결됨 — DB "${title}"`);
} catch (e) {
  no(`노션 실패: ${e.message}`);
  console.log('     → 노션에서 해당 DB(또는 상위 페이지) ⋯ → 연결 → 통합 추가를 확인하세요');
}

// Plaud 세션
if (!fs.existsSync(PROFILE_DIR)) {
  no('크롬 프로필 없음 — npm run login 을 실행하세요');
} else {
  process.stdout.write('  ⏳ Plaud 세션 확인 중...');
  let browser = null;
  try {
    browser = await openBrowser({ headless: true, channel: cfg.browserChannel ?? 'chrome' });
    await gotoApp(browser.page);
    const logged = await isLoggedIn(browser.page);
    process.stdout.write('\r');
    if (logged) ok('Plaud 로그인 유효          ');
    else no('Plaud 세션 만료 — npm run login 으로 다시 로그인하세요');
  } catch (e) {
    process.stdout.write('\r');
    no(`브라우저 실행 실패: ${e.message.split('\n')[0]}`);
    console.log('     → 크롬이 이 프로필로 이미 떠 있거나(중복 실행), 크롬이 없을 수 있습니다');
  } finally {
    if (browser) await browser.ctx.close().catch(() => {});
  }
}

// 스케줄러
try {
  if (process.platform === 'darwin') {
    const out = execFileSync('launchctl', ['list'], { encoding: 'utf8' });
    out.includes('com.plaud-to-notion.poller') ? ok('자동 실행 등록됨 (launchd)') : hm('자동 실행 미등록 — npm run schedule');
  } else if (process.platform === 'win32') {
    const out = execFileSync('schtasks', ['/Query', '/TN', 'PlaudToNotion'], { encoding: 'utf8', windowsHide: true });
    out ? ok('자동 실행 등록됨 (작업 스케줄러)') : hm('자동 실행 미등록 — npm run schedule');
  }
} catch { hm('자동 실행 미등록 — npm run schedule'); }

// 실행 이력
const state = readState();
const count = Object.keys(state.seen || {}).length;
if (state.lastRun) {
  const mins = Math.round((Date.now() - Date.parse(state.lastRun)) / 60000);
  ok(`마지막 실행 ${mins}분 전 / 적재한 노트 ${count}건`);
  if (mins > (cfg.intervalMinutes ?? 10) * 3) hm('한동안 실행되지 않았습니다 — 컴퓨터가 꺼져 있었다면 정상입니다');
} else {
  hm('아직 실행 이력이 없습니다 — npm start 로 한 번 돌려보세요');
}

console.log(`\n로그: ${path.join(HOME, 'poller.log')}\n`);
