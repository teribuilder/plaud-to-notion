#!/usr/bin/env node
// macOS launchd 등록/해제. 노트북이 깨어 있는 동안만 돌고,
// 잠자는 사이 놓친 회차는 깨어날 때 한 번 실행된다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig, HOME } from './lib/config.mjs';

const LABEL = 'com.plaud-to-notion.poller';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const action = process.argv[2] || 'install';

if (process.platform !== 'darwin') {
  console.error('현재 자동 등록은 macOS만 지원합니다.');
  console.error(`다른 OS에서는 스케줄러에 다음 명령을 등록하세요:\n  ${process.execPath} ${path.join(ROOT, 'poller.mjs')}`);
  process.exit(1);
}

const uid = process.getuid();
const domain = `gui/${uid}`;

function uninstall() {
  try { execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' }); } catch {}
  if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
  console.log('자동 실행을 해제했습니다.');
}

if (action === 'uninstall') { uninstall(); process.exit(0); }

const cfg = readConfig();
const intervalSec = Math.max(60, (cfg?.intervalMinutes ?? 10) * 60);

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(ROOT, 'poller.mjs')}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>StartInterval</key><integer>${intervalSec}</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${path.join(HOME, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(HOME, 'launchd.err.log')}</string>
</dict>
</plist>
`;

fs.mkdirSync(path.dirname(PLIST), { recursive: true });
try { execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' }); } catch {}
fs.writeFileSync(PLIST, plist);
execFileSync('launchctl', ['bootstrap', domain, PLIST]);

console.log(`✅ 자동 실행 등록 완료 — ${intervalSec / 60}분마다 확인합니다.`);
console.log(`   해제: npm run unschedule`);
console.log(`   즉시 1회 실행: launchctl kickstart ${domain}/${LABEL}`);
