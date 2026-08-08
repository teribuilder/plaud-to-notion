// 설정·상태·로그는 전부 홈 아래 한 곳에 모은다.
// 레포를 git pull 해도 사용자 데이터가 덮이지 않도록 레포 밖에 둔다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.PLAUD_HOME || path.join(os.homedir(), '.plaud-to-notion');
export const PROFILE_DIR = path.join(HOME, 'chrome-profile');
export const CONFIG_FILE = path.join(HOME, 'config.json');
export const STATE_FILE = path.join(HOME, 'state.json');
export const LOG_FILE = path.join(HOME, 'poller.log');
export const LOCK_FILE = path.join(HOME, '.lock');

fs.mkdirSync(HOME, { recursive: true });

export function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

export function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  fs.chmodSync(CONFIG_FILE, 0o600); // 노션 토큰이 들어있다
}

export function readState() {
  if (!fs.existsSync(STATE_FILE)) return { seen: {}, lastRun: null };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

export function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}

export function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  try {
    // 로그가 무한히 자라지 않게 2MB 넘으면 반으로 자른다
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2_000_000) {
      const kept = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-5000).join('\n');
      fs.writeFileSync(LOG_FILE, kept);
    }
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// 실행이 겹치면 크롬 프로필이 잠기므로 잠금 파일로 막는다
export function acquireLock(maxAgeMs = 20 * 60 * 1000) {
  if (fs.existsSync(LOCK_FILE)) {
    const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (age < maxAgeMs) return false;
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}

export function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}
