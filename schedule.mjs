#!/usr/bin/env node
// 자동 실행 등록/해제 — macOS(launchd) / Windows(작업 스케줄러)
//
//   node schedule.mjs install
//   node schedule.mjs uninstall
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig, HOME } from './lib/config.mjs';

const LABEL = 'com.plaud-to-notion.poller';
const TASK_NAME = 'PlaudToNotion';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const POLLER = path.join(ROOT, 'poller.mjs');
const action = process.argv[2] || 'install';
const cfg = readConfig();
const intervalMin = Math.max(1, cfg?.intervalMinutes ?? 10);

// ---------- macOS ----------
function macos() {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  const domain = `gui/${process.getuid()}`;
  const boot = (args) => { try { execFileSync('launchctl', args, { stdio: 'ignore' }); } catch {} };

  if (action === 'uninstall') {
    boot(['bootout', `${domain}/${LABEL}`]);
    if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
    console.log('자동 실행을 해제했습니다.');
    return;
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${POLLER}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>StartInterval</key><integer>${intervalMin * 60}</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${path.join(HOME, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(HOME, 'launchd.err.log')}</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  boot(['bootout', `${domain}/${LABEL}`]);
  fs.writeFileSync(plistPath, plist);
  execFileSync('launchctl', ['bootstrap', domain, plistPath]);
  console.log(`✅ 자동 실행 등록 완료 — ${intervalMin}분마다 확인합니다.`);
  console.log(`   해제: npm run unschedule`);
  console.log(`   즉시 1회: launchctl kickstart ${domain}/${LABEL}`);
}

// ---------- Windows ----------
function windows() {
  const schtasks = (args) => execFileSync('schtasks', args, { stdio: 'pipe', windowsHide: true });

  if (action === 'uninstall') {
    try { schtasks(['/Delete', '/TN', TASK_NAME, '/F']); } catch {}
    console.log('자동 실행을 해제했습니다.');
    return;
  }

  // 10분마다 검은 콘솔 창이 깜빡이면 아무도 안 쓴다 — wscript로 창 없이 띄운다
  const vbs = path.join(HOME, 'run-hidden.vbs');
  fs.writeFileSync(vbs,
    'Set s = CreateObject("WScript.Shell")\r\n' +
    `s.Run """${process.execPath}"" ""${POLLER}""", 0, False\r\n`,
    'utf8');

  try { schtasks(['/Delete', '/TN', TASK_NAME, '/F']); } catch {}
  schtasks([
    '/Create', '/TN', TASK_NAME,
    '/TR', `wscript.exe "${vbs}"`,
    '/SC', 'MINUTE', '/MO', String(intervalMin),
    '/F',
  ]);
  console.log(`✅ 자동 실행 등록 완료 — ${intervalMin}분마다 확인합니다.`);
  console.log(`   해제: npm run unschedule`);
  console.log(`   즉시 1회: schtasks /Run /TN ${TASK_NAME}`);
  console.log('   ※ 로그인 상태에서만 돕니다. 절전 중에는 멈췄다가 깨어나면 다시 이어집니다.');
}

if (process.platform === 'darwin') macos();
else if (process.platform === 'win32') windows();
else {
  console.error('자동 등록은 macOS·Windows만 지원합니다.');
  console.error(`리눅스는 cron에 다음을 등록하세요:\n  */${intervalMin} * * * * ${process.execPath} ${POLLER}`);
  process.exit(1);
}
