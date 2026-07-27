# MyDevBox

> 어느 PC에서든 브라우저 하나로 접속해, AI 에이전트와 함께 개발하는 중앙형 샌드박스 개발 환경

MyDevBox는 하나의 공통 서버(샌드박스)에 여러 PC가 접속해 개발을 이어가는 **중앙 서버 컨셉**의 셀프호스팅 개발 환경입니다. 코드 에디터·터미널·에이전트 채팅을 웹에서 하나로 묶었고, **스스로 유지보수하는 LLM 위키**가 프로젝트의 축적 기억을 관리합니다.

```
┌─────────────────────────────────────────────────────────────┐
│                     MyDevBox Server                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ PostgreSQL │  │  Agent     │  │  Self-maintaining Wiki │ │
│  │ (pgvector) │  │  Loop      │  │  (project + master)    │ │
│  └────────────┘  └─────┬──────┘  └────────────────────────┘ │
│                        │                                      │
│              ┌─────────┴──────────┐                          │
│              │  ~/repos/<project> │  ← git 동기화 · 파일 감시 │
│              └────────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
          ▲                  ▲                  ▲
          │ WebSocket        │ WebSocket        │
     [내 PC - 브라우저]  [노트북]           [태블릿]
```

## 핵심 특징

| 영역 | 기능 |
|------|------|
| **개발** | Monaco 에디터 · 파일 트리 · 터미널 · 코드 실행 프리셋 · git 통합(commit/push/pull/diff) |
| **에이전트** | 도구 사용 에이전트 루프(파일·bash·검색·위키), 실시간 스트리밍, Anthropic/OpenAI 지원 |
| **작업 관리** | 태스크(Tasks) · 계획(Plans) · 문서(Docs) — DB에 저장, 마크다운 파일로 미러 |
| **🧠 자가-유지보수 위키** | 에이전트가 코드를 읽고 위키를 스스로 갱신. git 커밋 워터마크 기반 증분 동기화 |
| **🌍 글로벌 대시보드** | 프로젝트 경계 없이 전체 태스크·로드맵·마스터 위키·활동 타임라인을 한 화면에서 |
| **작업 모드** | **Developer**(에디터 + 채팅) / **Vibe**(에이전트 주도, 에디터 숨김) 토글 |

## 자가-유지보수 위키 (하이라이트)

위키는 **사용자가 매번 "최신화해"라고 지시하지 않아도** 에이전트가 유지보수합니다. Karpathy LLM-Wiki 패턴을 흡수해 세 가지 트리거로 갱신됩니다.

- **부트스트랩** — 프로젝트를 처음 열면 위키가 비어 있을 때 자동으로 5단계 시드 실행(데이터 모델·라우트·아키텍처·결정·갭·인덱스).
- **내부 파일 변경** — MyDevBox 안에서의 코드 수정은 파일 감시 → 8초 디바운스 → 백그라운드 에이전트가 관련 위키 페이지 갱신.
- **외부 git 감지** — 외부에서 push한 커밋은 `git fetch` 후 **워터마크 이후 커밋만** `git diff`로 잡아 증분 갱신(멱등).

위키는 pg `tsvector` 풀텍스트 검색, `[[wikilinks]]` 백링크 그래프, 3계층 `wiki_lint`(안전 수정·기계 보고·판단 보고)를 갖추고 있으며, **사람은 읽기 전용**으로 봅니다(수정은 채팅이나 코드 변경으로).

## 기술 스택

- **백엔드**: Node.js + TypeScript · Fastify · Drizzle ORM · WebSocket
- **프론트엔드**: React + TypeScript · Vite · zustand · Monaco Editor · react-markdown + remark
- **데이터베이스**: PostgreSQL 16 (`pgvector/pgvector`) — tsvector 풀텍스트 검색
- **에이전트**: 도구 사용 루프 + 헤드리스 백그라운드 실행 (Anthropic Claude / OpenAI GPT)
- **풀스택 TypeScript**: `@mydevbox/shared`가 API 스키마·WS 메시지·도구 정의를 양쪽에 공유

## 빠른 시작 (Docker Compose)

> 사전 요구: Docker + Docker Compose

```bash
git clone <repo-url> mydevbox && cd mydevbox

# (선택) 프로덕션 암호화 키 설정 — git 토큰 등 민감 정보 암호화용
cp .env.example .env
# 키 생성: openssl rand -hex 32  → .env의 ENCRYPTION_KEY에 입력

docker compose up -d --build
```

빌드가 끝나면 **http://localhost:3001** 에서 접속합니다. 서버가 API(`/api`, `/ws`)와 프론트엔드 정적 파일을 단일 origin으로 서빙합니다.

### 첫 프로젝트 시작

1. 런처에서 **프로젝트 추가** → 이름 입력(영문+숫자). 프로젝트는 자동으로 `~/repos/<이름>`에 생성됩니다(경로 입력 불필요).
2. 프로젝트를 열고 우상단 **설정**에서 **에이전트 API 키** 입력(Anthropic 또는 OpenAI). 위키 부트스트랩이 즉시 시작됩니다.
3. (선택) git 원격 저장소 연결 시 외부 push를 자동으로 감지해 위키를 갱신합니다.

> DB 마이그레이션은 서버 기동 시 자동 적용됩니다.

## 개발 모드 (기여자용)

로컬에서 핫리로드 개발을 하려면 Node 20+ 와 pnpm이 필요합니다.

```bash
pnpm install
docker compose up -d db          # DB만 컨테이너로
pnpm db:migrate                  # 마이그레이션
pnpm dev                         # server(tsx) + web(vite) 병렬 실행
```

- 웹: http://localhost:5173 (vite가 `/api`·`/ws`를 서버로 프록시)
- 서버 API: http://localhost:3001

## 프로젝트 구조

```
mydevbox/
├── packages/
│   ├── shared/          # 프론트/백 공유 타입·zod 스키마 (@mydevbox/shared)
│   ├── server/          # Fastify 서버 · 에이전트 · 위키 · DB (Drizzle)
│   │   └── src/
│   │       ├── agent/        # 에이전트 루프·도구·시스템 프롬프트
│   │       ├── services/     # wiki-service, wiki-maintenance, git-sync, ...
│   │       ├── routes/       # REST API
│   │       └── ws/           # WebSocket (에이전트 이벤트·파일 감시)
│   └── web/             # React UI
│       └── src/
│           ├── components/   # TopBar, SidePanel, WikiPanel, GlobalDashboard, ...
│           ├── store/        # zustand
│           └── remark/       # [[wikilink]] 플러그인
├── docker-compose.yml
└── packages/server/Dockerfile
```

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DATABASE_URL` | `postgresql://mydevbox:mydevbox@localhost:5432/mydevbox` | PostgreSQL 연결 문자열 |
| `ENCRYPTION_KEY` | (머신별 자동 생성) | git 토큰 등 민감 정보 AES-256-GCM 암호화 키. **프로덕션에서는 반드시 설정** |
| `PORT` | `3000` (dev) / `3001` (compose) | 서버 포트 |
| `MYDEVBOX_REPOS_DIR` | `~/repos` | 프로젝트 생성 베이스 디렉토리 |
| `MYDEVBOX_MASTER_WIKI_DIR` | `~/.mydevbox/master-wiki` | 크로스프로젝트 마스터 위키 파일 미러 |
| `MYDEVBOX_GIT_SYNC_INTERVAL_MS` | `300000` (5분) | 외부 git 커밋 감지 주기 |

> **에이전트 API 키**는 환경 변수가 아니라 UI(프로젝트 설정)에서 프로젝트별로 입력하며, AES-256-GCM으로 암호화해 DB에 저장합니다.

## 라이선스

Private.
