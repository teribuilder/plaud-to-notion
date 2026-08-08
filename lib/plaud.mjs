// Plaud 접근 계층.
//
// 핵심 설계: 토큰을 빼내지 않는다.
// Plaud 웹앱의 인증은 httpOnly 쿠키 세션이고, localStorage의 토큰은 서버가 받아주지 않는다.
// 그래서 "로그인된 크롬 프로필"을 그대로 열어서, 웹앱과 똑같은 자리에서 fetch 한다.
// 세션 갱신도 앱이 알아서 하므로 사람이 토큰을 주기적으로 갈아끼울 일이 없다.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { PROFILE_DIR } from './config.mjs';

const DEFAULT_API = 'https://api-apne1.plaud.ai';

export async function openBrowser({ headless = true, channel = 'chrome' } = {}) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const opts = {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
  };
  if (channel) opts.channel = channel; // 설치된 크롬 사용 (없으면 번들 크로미움)
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, opts);
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

export async function gotoApp(page) {
  await page.goto('https://web.plaud.ai/file-list', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500); // 앱이 세션을 정리할 여유
}

// Plaud는 계정마다 리전 API 도메인이 다르다 (apne1 / use1 …). 앱이 저장해 둔 값을 그대로 쓴다.
async function apiBase(page) {
  return page.evaluate((fallback) => {
    try {
      const raw = localStorage.getItem('plaud_user_api_domain');
      const dom = raw && JSON.parse(raw).domain;
      return dom || fallback;
    } catch { return fallback; }
  }, DEFAULT_API);
}

export class AuthError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthError'; }
}

// 주의: Plaud API는 인증 실패도 HTTP 200 + {status:-3900} 으로 준다. 판정은 본문 status 로 해야 한다.
export async function api(page, endpoint) {
  const base = await apiBase(page);
  const r = await page.evaluate(async ({ base, endpoint }) => {
    const res = await fetch(base + endpoint, { credentials: 'include' });
    return { http: res.status, text: await res.text() };
  }, { base, endpoint });

  if (r.http === 401 || r.http === 403) throw new AuthError('세션이 만료되었습니다');
  let json;
  try { json = JSON.parse(r.text); } catch { throw new Error(`Plaud 응답이 JSON이 아닙니다 (HTTP ${r.http})`); }
  if (json.status !== undefined && json.status !== 0) {
    const msg = `Plaud API 오류 ${json.status}: ${json.msg || ''}`;
    if (/auth|token|login/i.test(json.msg || '')) throw new AuthError(msg);
    throw new Error(msg);
  }
  return json;
}

// 요약·전사본 본문은 S3 presigned URL로 내려온다. gzip이면 브라우저에서 풀어 텍스트로 받는다.
export async function fetchContent(page, url) {
  return page.evaluate(async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error('본문 다운로드 실패 ' + res.status);
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    }
    return new TextDecoder().decode(buf);
  }, url);
}

export async function isLoggedIn(page) {
  try { await listNotes(page, { limit: 1 }); return true; } catch { return false; }
}

export async function listNotes(page, { limit = 30 } = {}) {
  const q = `/file/simple/web?skip=0&limit=${limit}&is_trash=0&sort_by=start_time&is_desc=true`;
  const j = await api(page, q);
  return j.data_file_list || [];
}

export async function noteDetail(page, id) {
  const j = await api(page, '/file/detail/' + id);
  return j.data;
}

// 전사(is_trans)와 요약(is_summary)이 모두 끝난 노트만 대상이 된다
export function isReady(note) {
  return Boolean(note.is_trans && note.is_summary && !note.is_trash);
}

export function pickContent(detail) {
  const list = detail.content_list || [];
  const done = (type) => list.find((c) => c.data_type === type && c.task_status === 1);
  return { summary: done('auto_sum_note'), transcript: done('transaction') };
}

export const noteUrl = (id) => `https://web.plaud.ai/file/${id}`;

export function hhmmss(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

// 녹음 당시 타임존으로 표기한다. UTC로 넣으면 한국 기준 9시간 어긋난다.
export function isoLocal(ms, tzHours = 9) {
  const d = new Date(ms + tzHours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const sign = tzHours >= 0 ? '+' : '-';
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${sign}${p(Math.abs(tzHours))}:00`;
}

// 전사 세그먼트를 "[HH:MM:SS] Speaker 1: 발화" 줄로
export function transcriptLines(json) {
  const segs = JSON.parse(json);
  return segs.map((s) => `[${hhmmss(s.start_time)}] ${s.speaker || 'Speaker'}: ${s.content}`);
}
