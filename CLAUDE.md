# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

- `frontend/` — Next.js 16 (App Router) app, runs on port 3000
- `backend/` — Express + TypeScript API, runs on port 3001
- `backend/schema.sql` — consolidated Supabase schema for fresh databases
- `backend/migrations/` — incremental SQL for existing deployments (directory may not exist yet; create it when shipping schema changes)

User-facing setup (env vars, install, first-run, troubleshooting) lives in `README.md` — don't duplicate it here.

## Common commands

```bash
# dev
npm run dev --prefix backend       # tsx watch on src/index.ts
npm run dev --prefix frontend      # next dev

# build / typecheck (no separate typecheck script)
npm run build --prefix backend     # tsc → dist/
npm run build --prefix frontend    # next build

# lint (frontend only — backend has no lint script)
npm run lint --prefix frontend

# Cloudflare Workers deploy of the frontend (OpenNext)
npm run deploy --prefix frontend
```

There is **no test runner** in either package — don't waste cycles looking for one. If tests are needed, they need to be set up first.

## Backend architecture (`backend/src/`)

- `index.ts` — wires everything together. Order matters: helmet/CORS → `requireAuth` for everything except `/health` → path-specific rate limiters (`chatLimiter`, `uploadLimiter`, `chatCreateLimiter`) → routers. CORS origin is pinned to `FRONTEND_URL`.
- `middleware/auth.ts` — `requireAuth` validates the `Authorization: Bearer <jwt>` header against Supabase using the service-role client and stashes `userId` / `userEmail` / `token` on `res.locals`.
- `routes/` — one file per resource. Mount paths from `index.ts`:
  - `/chat` → `chat.ts` (SSE streaming)
  - `/projects` → `projects.ts`
  - `/projects/:projectId/chat` → `projectChat.ts` (SSE)
  - `/single-documents` → `documents.ts` (uploads, versions)
  - `/tabular-review` → `tabular.ts` (grid generation, per-cell regen, review chat)
  - `/workflows` → `workflows.ts`
  - `/user` and `/users` → `user.ts`
  - `/download` → `downloads.ts` (signed token verification)
- `lib/llm/` — provider abstraction. `index.ts` exposes `streamChatWithTools()` / `completeText()`; `models.ts` maps a model id to one of `claude` | `gemini` | `openai`; the matching `claude.ts` / `gemini.ts` / `openai.ts` does the SDK work. Tool defs are shared in `tools.ts`. **When adding a model, update both `models.ts` and the relevant provider file.**
- `lib/storage.ts` — R2/S3 access via `@aws-sdk/client-s3`. Storage key conventions:
  - `documents/{userId}/{docId}/source.{ext}`
  - `documents/{userId}/{docId}/converted.pdf`
  - `documents/{userId}/{docId}/versions/{slug}.{ext}`
  - `generated/{userId}/{docId}/generated.{ext}`
- `lib/userApiKeys.ts` — AES-256-GCM encryption of per-user provider keys keyed off `USER_API_KEYS_ENCRYPTION_SECRET`. Per-user key wins over the env-level key; env key is the fallback.
- `lib/downloadTokens.ts` — non-expiring HMAC-signed download links signed with `DOWNLOAD_SIGNING_SECRET` (falls back to `SUPABASE_SECRET_KEY`). Consumed by `routes/downloads.ts`.
- `lib/convert.ts` — DOC/DOCX → PDF via `libreoffice-convert`. **Requires the `libreoffice` binary on PATH** (declared as a system dep in `nixpacks.toml` for Linux deploys; install locally for dev).

## Frontend architecture (`frontend/src/`)

- `app/` — App Router. `(pages)/` is the authenticated layout group containing `assistant/`, `projects/`, `tabular-reviews/`, `workflows/`, and `account/`. `login/` and `signup/` sit outside that group.
- `app/lib/mikeApi.ts` — **the** client wrapper for every backend call. Pulls the access token from `supabase.auth.getSession()`, attaches `Authorization: Bearer <token>`, and exports typed helpers (`createChat`, `streamChat`, `uploadProjectDocument`, `listProjects`, …). New backend calls go through this file rather than raw `fetch`.
- `contexts/` — `AuthContext`, `UserProfileContext`. Both are wired up in `components/providers.tsx`.
- `components/` — shadcn/ui (new-york style, neutral base, lucide icons, configured in `components.json`). Path alias `@/*` → `src/*`.
- React Compiler is enabled (`reactCompiler: true` in `next.config.ts`).

## Database

- Fresh DB: paste `backend/schema.sql` into the Supabase SQL editor.
- Existing DB: apply files in `backend/migrations/` in numeric order (`0001_…`, `0002_…`); never re-run `schema.sql` against production data. Always fold the same change into `schema.sql` so fresh installs stay current.
- Tables worth knowing: `user_profiles`, `user_api_keys`, `projects`, `project_subfolders`, `documents`, `document_versions`, `chats`, `chat_messages`, `workflows`, `tabular_reviews`, `tabular_cells`. Document bytes live in R2; Postgres only stores metadata + structured chat content.
- The `projects.template_id` column references the in-process `BUILTIN_PROJECT_TEMPLATES` registry (`backend/src/lib/builtinProjectTemplates.ts`). No FK — registry is code, not data.

### Supabase branching (development DB sandbox)

Supabase Pro and above can spin up a development branch that mirrors prod schema and migrations (`mcp__supabase__create_branch` → `apply_migration` → `merge_branch` → `delete_branch`). **The current org (`rmmain-2176's projects`) is on the free plan, where branching returns `PaymentRequiredException`.** Until the plan is upgraded, schema migrations apply directly to prod (`qkfcrsrtualqdmqqexpf`) via `mcp__supabase__apply_migration`. Prefer reversible changes (additive columns with `if not exists`, nullable defaults) so a bad migration can be rolled back without data loss.

## Env & secrets

See `README.md` for the full env-var list. Two backend secrets aren't obvious from their names:

- `DOWNLOAD_SIGNING_SECRET` — HMAC key for the persistent download-link tokens.
- `USER_API_KEYS_ENCRYPTION_SECRET` — AES-GCM key used to encrypt user-supplied provider API keys at rest.

## Gotchas

- Frontend deploys to Cloudflare Workers via OpenNext — Node-only APIs in server code (e.g. raw `fs`, native bindings) can break the build.
- DOC/DOCX conversion silently fails in dev without LibreOffice installed.
- License is **AGPL-3.0-only**. Keep new files compatible.
