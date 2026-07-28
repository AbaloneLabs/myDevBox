# MyDevBox

> A central, self-hosted sandbox where you develop alongside an AI agent — from any PC, through a single browser tab.

MyDevBox is a **central-server** self-hosted development environment. Multiple machines connect to one shared sandbox and pick up right where they left off. It unifies a code editor, terminal, and agent chat in the browser — and ships with a **self-maintaining LLM wiki** that accumulates a project's living memory.

```
┌─────────────────────────────────────────────────────────────┐
│                     MyDevBox Server                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ PostgreSQL │  │  Agent     │  │  Self-maintaining Wiki │ │
│  │ (pgvector) │  │  Loop      │  │  (project + master)    │ │
│  └────────────┘  └─────┬──────┘  └────────────────────────┘ │
│                        │                                      │
│              ┌─────────┴──────────┐                          │
│              │  ~/repos/<project> │  ← git sync · file watch │
│              └────────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
          ▲                  ▲                  ▲
          │ WebSocket        │ WebSocket        │
     [Desktop]          [Laptop]           [Tablet]
```

## Highlights

| Area | Capabilities |
|------|--------------|
| **Development** | Monaco editor · file tree · terminal · run presets · git integration (commit/push/pull/diff) |
| **Agent** | Tool-using agent loop (files · bash · search · wiki), real-time streaming, Anthropic & OpenAI support |
| **Task management** | Tasks · Plans · Docs — persisted in the DB and mirrored to Markdown files |
| **🧠 Self-maintaining wiki** | The agent reads your code and keeps the wiki up to date on its own, with incremental sync keyed off git commit watermarks |
| **🌍 Global dashboard** | A single cross-project view of all tasks, roadmaps, the master wiki, and an activity timeline |
| **Work modes** | **Developer** (editor + chat) / **Vibe** (agent-driven, editor hidden) toggle |

## The Self-Maintaining Wiki

The wiki is maintained by the agent — **you never have to ask it to "bring things up to date."** Inspired by Karpathy's LLM-Wiki, it refreshes on three triggers:

- **Bootstrap** — opening a fresh project with an empty wiki automatically seeds it (data model · routes · architecture · decisions · gaps · index).
- **Internal file changes** — edits made inside MyDevBox trigger a file watcher → 8s debounce → a background agent updates the relevant wiki pages.
- **External git** — commits pushed from outside are caught via `git fetch`; only commits **after the last watermark** are diffed and applied, so updates are incremental and idempotent.

The wiki backs PostgreSQL `tsvector` full-text search, a `[[wikilink]]` backlink graph, and a three-tier `wiki_lint` (safe fixes · mechanical reports · judgment calls). Humans see it **read-only** — changes happen through chat or code edits.

## Tech Stack

- **Backend**: Node.js + TypeScript · Fastify · Drizzle ORM · WebSocket
- **Frontend**: React + TypeScript · Vite · zustand · Monaco Editor · react-markdown + remark
- **Database**: PostgreSQL 16 (`pgvector/pgvector`) — `tsvector` full-text search
- **Agent**: tool-use loop + headless background runs (Anthropic Claude / OpenAI GPT)
- **Full-stack TypeScript**: `@mydevbox/shared` carries API schemas, WS messages, and tool definitions to both sides

## Quick Start (Docker Compose)

> Prerequisite: Docker + Docker Compose

```bash
git clone <repo-url> mydevbox && cd mydevbox

# (Optional) set a production encryption key — used to encrypt git tokens and other secrets
cp .env.example .env
# Generate a key: openssl rand -hex 32  → put it in ENCRYPTION_KEY in .env

docker compose up -d --build
```

Once the build finishes, open **http://localhost:35001**. The server serves the API (`/api`, `/ws`) and the frontend's static assets from a single origin.

### Starting your first project

1. In the launcher, choose **Add project** and enter a name (alphanumeric). Projects are created automatically under `~/repos/<name>` — no path entry needed.
2. Open the project, then in the top-right **Settings**, enter an **agent API key** (Anthropic or OpenAI). Wiki bootstrap starts immediately.
3. (Optional) Link a git remote and MyDevBox will detect external pushes and refresh the wiki.

> Database migrations apply automatically on server boot.

## Development Mode (for contributors)

For local hot-reload development, you need Node 20+ and pnpm.

```bash
pnpm install
docker compose up -d db          # run only the DB in a container
pnpm db:migrate                  # apply migrations
pnpm dev                         # runs server (tsx) + web (vite) in parallel
```

- Web: http://localhost:35173 (Vite proxies `/api` and `/ws` to the server)
- Server API: http://localhost:35001

## Project Structure

```
mydevbox/
├── packages/
│   ├── shared/          # Shared types & zod schemas (@mydevbox/shared)
│   ├── server/          # Fastify server · agent · wiki · DB (Drizzle)
│   │   └── src/
│   │       ├── agent/        # Agent loop · tools · system prompt
│   │       ├── services/     # wiki-service, wiki-maintenance, git-sync, ...
│   │       ├── routes/       # REST API
│   │       └── ws/           # WebSocket (agent events · file watching)
│   └── web/             # React UI
│       └── src/
│           ├── components/   # TopBar, SidePanel, WikiPanel, GlobalDashboard, ...
│           ├── store/        # zustand
│           └── remark/       # [[wikilink]] plugin
├── docker-compose.yml
└── packages/server/Dockerfile
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://mydevbox:mydevbox@localhost:35432/mydevbox` | PostgreSQL connection string |
| `ENCRYPTION_KEY` | (auto-generated per machine) | AES-256-GCM key for encrypting secrets such as git tokens. **Must be set in production.** |
| `PORT` | `35000` (dev) / `35001` (compose) | Server port |
| `MYDEVBOX_REPOS_DIR` | `~/repos` | Base directory for project creation |
| `MYDEVBOX_MASTER_WIKI_DIR` | `~/.mydevbox/master-wiki` | File mirror for the cross-project master wiki |
| `MYDEVBOX_GIT_SYNC_INTERVAL_MS` | `300000` (5 min) | How often external git commits are detected |

> **Agent API keys** are not environment variables. They're entered per project in the UI (project settings) and stored encrypted in the DB with AES-256-GCM.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). Unless required by applicable law or agreed to in writing, this software is distributed on an "AS IS" basis, without warranties or conditions of any kind.
