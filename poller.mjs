#!/usr/bin/env node
// 본체: 요약이 끝난 Plaud 노트를 노션에 적재한다.
//
//   node poller.mjs                     최근 30건 중 미적재분
//   node poller.mjs --limit 200         넓게 훑기(백필)
//   node poller.mjs --since 2026-07-01  특정 날짜 이후만
//   node poller.mjs --dry-run           노션에 쓰지 않고 대상만 출력
import { readConfig, readState, writeState, log, acquireLock, releaseLock } from './lib/config.mjs';
import {
  openBrowser, gotoApp, listNotes, noteDetail, fetchContent, isReady, pickContent,
  noteUrl, hhmmss, isoLocal, transcriptLines, AuthError,
} from './lib/plaud.mjs';
import { notion, resolveSchema, findByPlaudId, createNotePage } from './lib/notion.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : fallback;
};
const DRY = args.includes('--dry-run');
const LIMIT = Number(opt('--limit', 30));
const SINCE = opt('--since', null) ? Date.parse(opt('--since') + 'T00:00:00Z') : null;

const cfg = readConfig();
if (!cfg) {
  console.error('설정이 없습니다. 먼저 `npm run setup` 을 실행하세요.');
  process.exit(1);
}

async function notify(message) {
  log('ALERT', message);
  if (!cfg.slackWebhookUrl) return;
  try {
    await fetch(cfg.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🔴 Plaud→Notion: ${message}` }),
    });
  } catch (e) { log('알림 발송 실패:', e.message); }
}

if (!acquireLock()) {
  log('이전 실행이 아직 진행 중 — 이번 회차는 건너뜁니다');
  process.exit(0);
}

const state = readState();
const call = notion(cfg.notionToken);
let browser = null;
let exitCode = 0;

try {
  browser = await openBrowser({ headless: true, channel: cfg.browserChannel ?? 'chrome' });
  await gotoApp(browser.page);

  const notes = await listNotes(browser.page, { limit: LIMIT });
  const targets = notes.filter((n) =>
    isReady(n) && !state.seen[n.id] && (!SINCE || n.start_time >= SINCE));

  log(`조회 ${notes.length}건 / 신규 대상 ${targets.length}건`);

  if (targets.length) {
    if (DRY) {
      for (const n of [...targets].reverse()) {
        log(`  [dry] ${isoLocal(n.start_time, n.timezone ?? 9).slice(0, 16)} ${hhmmss(n.duration)} ${n.filename}`);
      }
    } else {
      const schema = await resolveSchema(call, cfg.notionDatabaseId);
      if (!schema.title) throw new Error('노션 DB에 제목(title) 속성이 없습니다');

      let created = 0, skipped = 0, failed = 0;
      for (const note of [...targets].reverse()) { // 오래된 것부터
        try {
          if (await findByPlaudId(call, cfg.notionDatabaseId, schema, note.id)) {
            state.seen[note.id] = 'preexisting';
            writeState(state);
            skipped++;
            log(`  = 이미 있음: ${note.filename}`);
            continue;
          }

          const detail = await noteDetail(browser.page, note.id);
          const { summary, transcript } = pickContent(detail);
          if (!summary) { log(`  ~ 요약 아직 준비 안 됨, 다음 회차로: ${note.filename}`); continue; }

          const summaryMd = await fetchContent(browser.page, summary.data_link);
          const lines = transcript && cfg.includeTranscript !== false
            ? transcriptLines(await fetchContent(browser.page, transcript.data_link))
            : [];

          const page = await createNotePage(call, cfg.notionDatabaseId, schema, {
            id: note.id,
            title: note.filename || '(제목 없음)',
            dateIso: isoLocal(note.start_time, note.timezone ?? 9),
            duration: hhmmss(note.duration),
            url: noteUrl(note.id),
          }, {
            summaryMd,
            transcript: lines,
            includeTranscript: cfg.includeTranscript !== false,
          });

          state.seen[note.id] = page.id;
          writeState(state);
          created++;
          log(`  + 생성: ${note.filename} (요약 ${summaryMd.length}자 / 전사 ${lines.length}줄)`);
        } catch (e) {
          if (e instanceof AuthError) throw e;
          failed++;
          log(`  ! 실패: ${note.filename} — ${e.message}`);
        }
      }
      log(`완료: 생성 ${created} / 스킵 ${skipped} / 실패 ${failed}`);
    }
  }

  state.lastRun = new Date().toISOString();
  writeState(state);
} catch (e) {
  exitCode = 1;
  if (e instanceof AuthError) {
    await notify('Plaud 세션이 만료되었습니다. `npm run login` 으로 다시 로그인해 주세요.');
  } else {
    log('ERROR', e.stack || e.message);
  }
} finally {
  if (browser) await browser.ctx.close().catch(() => {});
  releaseLock();
}

process.exit(exitCode);
