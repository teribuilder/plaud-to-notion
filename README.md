# plaud-to-notion

**Plaud 노트를 요약이 끝나는 즉시 노션 DB로 자동 적재합니다.** Make·Zapier 없이 내 맥에서 돕니다.

Plaud 웹훅이 조용히 끊겨서 노션에 아무것도 안 들어오는 상황을 겪었다면, 이건 그 문제를 구조적으로 없앤 버전입니다. 웹훅(Plaud가 보내주길 기다림) 대신 **폴링**(내가 주기적으로 확인)이라, Plaud가 안 보내도 다음 회차에 따라잡습니다.

---

## 뭐가 다른가

| | Make / Zapier 웹훅 | 이 도구 |
|---|---|---|
| 트리거 | Plaud가 웹훅을 쏴야 함 | 10분마다 내가 확인 |
| 끊기면 | **조용히 멈춤** (며칠 뒤 발견) | 다음 회차에 자동 복구 |
| 밀린 노트 | 손으로 백필 | `--limit 200` 한 줄 |
| 월 비용 | 구독 | 0원 |
| 데이터 경로 | 제3자 서버 경유 | 내 컴퓨터 → 노션 |

노트 본문에는 **Plaud가 만든 AI 요약**(마크다운 구조 그대로)과 **전사본 전문**(`[HH:MM:SS] Speaker 1: …`)이 함께 들어갑니다. 요약은 Plaud 것을 그대로 쓰므로 **AI API 비용이 들지 않습니다.**

## 동작 방식

```
스케줄러(10분) → 로그인된 크롬 프로필로 Plaud 열기
               → 전사·요약이 모두 끝난 노트만 선별 (is_trans && is_summary)
               → 이미 적재한 것 제외 (로컬 기록 + 노션 PlaudID 조회)
               → 요약 + 전사본을 노션 페이지로 생성
```

로그인은 **처음 한 번**만 합니다. 토큰을 복사해 붙여넣는 절차가 없고, 세션 갱신은 Plaud 웹앱이 알아서 합니다.

## 요구사항

- **macOS 또는 Windows** (자동 실행 등록까지 지원. 리눅스는 cron에 직접 등록)
- Node.js 20 이상 — `node -v` 로 확인, 없으면 [nodejs.org](https://nodejs.org)
- 구글 크롬 (없으면 셋업이 크로미움을 대신 받습니다)
- Plaud 계정, 노션 계정

## 설치

```bash
git clone https://github.com/teribuilder/plaud-to-notion.git
cd plaud-to-notion
npm install
npm run setup
```

`npm run setup` 이 순서대로 물어봅니다.

1. **노션 통합 시크릿** — [notion.so/my-integrations](https://www.notion.so/my-integrations) 에서 새 통합을 만들고 "내부 통합 시크릿"(`ntn_…`)을 복사
2. **적재할 DB** — 기존 DB를 고르거나, 부모 페이지를 골라 새로 만들기
   - 노션에서 대상 페이지를 열고 `⋯` → **연결** → 방금 만든 통합을 추가해야 목록에 보입니다
   - 기존 DB를 쓰면 부족한 속성만 자동으로 추가합니다 (기존 데이터는 건드리지 않습니다)
3. **옵션** — 전사본 포함 여부, 확인 주기, 슬랙 알림 웹훅(선택)
4. **Plaud 로그인** — 창이 열리면 로그인. 구글 로그인이 막히면 **"Sign in with a code"** 사용
5. **첫 적재** — 기존 노트를 원하는 만큼 백필
6. **자동 실행 등록**

## 노트북에서 써도 되나

됩니다. 스케줄러는 **컴퓨터가 깨어 있는 동안**만 돌고, 절전 중에는 멈췄다가 깨어나면 다시 이어집니다. 폴링 방식이라 몇 회차를 건너뛰어도 다음 실행에서 밀린 것을 전부 따라잡습니다. 노트북을 며칠 안 켰다면 켠 직후 한 번에 들어옵니다.

- macOS: launchd에 등록되고, 잠자는 사이 놓친 회차는 깨어날 때 한 번 실행됩니다.
- Windows: 작업 스케줄러에 N분 간격으로 등록됩니다. **콘솔 창은 뜨지 않습니다**(wscript로 숨김 실행). 로그인 상태에서만 돕니다.

## Windows에서 쓸 때

설치 과정은 동일합니다. 다만 이렇게 하세요.

1. [nodejs.org](https://nodejs.org) 에서 LTS 설치 (설치 중 "Add to PATH" 체크)
2. **PowerShell**을 열고 (cmd 말고) 위 설치 명령 4줄을 그대로 실행
3. 한글이 깨져 보이면 `chcp 65001` 한 번 실행 후 다시 시도

터미널에 `git` 이 없다면 GitHub 페이지에서 **Code → Download ZIP** 으로 받아 압축을 풀고, 그 폴더에서 `npm install` 부터 하셔도 됩니다.

자동 실행 확인·해제:

```powershell
schtasks /Query /TN PlaudToNotion     # 등록 확인
schtasks /Run   /TN PlaudToNotion     # 즉시 1회 실행
npm run unschedule                     # 해제
```

## 명령어

```bash
npm run doctor                 # 안 될 때 어디가 막혔는지 진단
npm start                      # 지금 한 번 확인
npm run dry                    # 노션에 쓰지 않고 대상만 출력
node poller.mjs --limit 200    # 넓게 훑기(백필)
node poller.mjs --since 2026-07-01
npm run login                  # 세션 만료 시 재로그인
npm run schedule               # 자동 실행 등록
npm run unschedule             # 자동 실행 해제
```

설정·로그·세션은 전부 `~/.plaud-to-notion/` 에 있습니다.

| 파일 | 내용 |
|---|---|
| `config.json` | 노션 토큰·DB ID·옵션 (권한 600) |
| `chrome-profile/` | Plaud 로그인 세션 |
| `state.json` | 적재 완료한 노트 ID |
| `poller.log` | 실행 로그 |

## 만들어지는 노션 속성

| 속성 | 타입 | 값 |
|---|---|---|
| 이름 | 제목 | 노트 제목 |
| PlaudID | 텍스트 | 중복 방지 키 |
| 날짜 | 날짜 | 녹음 시각 (녹음 당시 타임존) |
| 재생시간 | 텍스트 | `01:40:22` |
| URL | URL | Plaud 원본 링크 |
| 출처 | 선택 | `플라우드` |
| 요약 | 텍스트 | 요약 앞부분(검색용) |

## 문제 해결

**뭐가 문제인지 모르겠을 때** → `npm run doctor` 를 먼저 돌리세요. Node 버전·크롬·노션 연결·Plaud 세션·자동 실행 등록·마지막 실행 시각을 한 번에 확인해 줍니다.

**`🔴 Plaud 세션이 만료되었습니다`**
→ `npm run login` 으로 다시 로그인하면 됩니다. 슬랙 웹훅을 넣어뒀다면 만료 시 알림이 갑니다.

**노션에서 "Could not find database"**
→ 해당 DB(또는 상위 페이지)에 통합이 연결되지 않았습니다. 노션에서 `⋯` → 연결 → 통합 추가.

**노트가 안 들어옴**
→ `npm run dry` 로 대상에 잡히는지 확인하세요. Plaud에서 **요약 생성이 끝나지 않은** 노트는 일부러 건너뜁니다(다음 회차에 다시 확인).

**이미 있는 노트가 또 생김**
→ `PlaudID` 속성을 지웠는지 확인하세요. 중복 판정에 이 속성을 씁니다.

## 알아두세요

- 이 도구는 Plaud의 **공식 API가 아닌 웹앱 내부 API**를 사용합니다. Plaud가 구조를 바꾸면 동작이 깨질 수 있고, 공식 지원 대상이 아닙니다.
- 각자 **자기 계정으로 자기 데이터**를 옮기는 용도입니다. 로그인 세션과 노션 토큰은 사용자 컴퓨터를 벗어나지 않습니다(노션 API 호출 제외).
- 녹음·전사 내용에는 민감한 정보가 있을 수 있습니다. 적재 대상 노션 페이지의 공유 범위를 확인하세요.

---

## English (short)

Automatically pushes Plaud notes (AI summary + full transcript) into a Notion database, on your own machine — no Make/Zapier, no monthly fee. It **polls** instead of waiting for webhooks, so a missed webhook never means silent data loss, and backfilling is one flag.

Auth works by driving a Chrome profile you log into once; no token copy-pasting, and the session refreshes itself. Requires Node 20+ and Chrome. One-command scheduling on macOS (launchd) and Windows (Task Scheduler); Linux users can add the poller to cron.

```bash
npm install && npm run setup
```

Uses Plaud's **unofficial** internal web API — not affiliated with or supported by Plaud. MIT licensed.
