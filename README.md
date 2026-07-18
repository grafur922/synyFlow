# Terra Hub

Terra Hub is a local-first personal aggregation system built with Vue 3, Pinia, Tauri v2, and a NestJS companion API.

## Current modules

- **Todo**: local-first task management, optional NestJS synchronization, and SSE updates.
- **Xiaomi Notes**: server-side connector for listing, reading, creating, editing, and soft-deleting notes from the user's own Xiaomi Cloud account. The desktop workspace includes resizable/collapsible primary and secondary sidebars, open-document tabs, H1/H2 outline tabs, queryable row-encrypted SQLite history, snapshot-based note recreation, Xiaomi folder filtering, read-only mode, failure circuit breaking, and redacted audit events.
- **Global Search**: encrypted unified Resource index with persistent Xiaomi delta cursors, periodic complete-scan deletion detection, conflict-version review/resolution, source tombstones, normalized project/time/location context, combined privacy/type/source/context filters, relevance scoring, excerpts, and source navigation.
- **RSS Reader**: encrypted RSS/Atom subscriptions, safe SSRF-resistant fetching, conditional refresh, unread/favorite state, scheduling, and Resource search integration.
- **Blog Editor**: encrypted Markdown drafts, Xiaomi-note import, privacy scanning, sandboxed preview, atomic static-site publishing/update/withdrawal, and Resource indexing.
- **Travel Planner**: encrypted trips, day/place timelines, provider map links, row-encrypted attachments, passphrase-protected offline packages, transport, bookings, multi-currency budgets, checklists, exports, validation, Resource indexing, and a privacy-aware candidate inbox imported from favorite RSS/Xiaomi resources.
- **Knowledge Base**: encrypted document ingestion, local BM25 + sparse-vector retrieval, opt-in bounded external rerank/generation, privacy scopes, prompt-injection isolation, cited answers, and deletion propagation.
- **Settings / backup**: encrypted browser-local Todo/UI backup and restore, plus offline encrypted server backup/inspect/atomic restore tooling.
- **Calendar / insights**: retained alongside the aggregation workspaces.

Legacy routes `/dashboard` and `/tasks` now redirect to the canonical `/todo` route. On mobile, Xiaomi Notes is the second bottom-navigation item.

## Security model

Xiaomi Cloud credentials must only exist in the NestJS process:

- use a server environment variable or the current-user Windows DPAPI file; when no environment Cookie is configured, the Xiaomi Notes page can securely save the complete Cookie through the local-only backend endpoint;
- macOS Keychain helper code is retained for later platform validation, but macOS and Android credential storage are deferred and are not current release guarantees;
- never put the Cookie in `VITE_*`, Vue code, localStorage, screenshots, or Git;
- captured request/response folders are excluded by `.gitignore` because they contain live session tokens and private note text;
- the connector calls a fixed `https://i.mi.com` origin, applies request timeouts and validation, and does not log request bodies or credentials.

The API binds to `127.0.0.1` by default. Remote binding is rejected unless it is explicitly enabled and protected by a minimum 32-character API token. Global search and RAG exclude secret content by default.

The packet capture used to derive this connector contains a reusable `serviceToken`. Revoke/update that Xiaomi session after development if the capture has been shared or backed up outside a trusted encrypted location.

## Development

Frontend:

```powershell
npm install
npm run dev
```

Backend:

Node.js 22.12 or newer is required by the encrypted SQLite history backend.

```powershell
Copy-Item server/.env.example server/.env
# Optional: set XIAOMI_CLOUD_COOKIE to the complete Cookie header.
# On Windows, it can instead be entered securely on the Xiaomi Notes page.
npm run dev:server
```

Frontend API origin (root `.env.local`):

```env
VITE_TERRA_API_URL=http://localhost:3001
```

## Verification

```powershell
npm run build
npm run typecheck:server
npm run build:server
npm --prefix server run test:travel-smoke
npm --prefix server run test:rag-smoke
npm --prefix server run test:rag-external
npm --prefix server run test:access-smoke
npm --prefix server run test:backup-smoke
npm --prefix server run test:secrets-smoke
npm --prefix server run test:xiaomi-credentials
npm --prefix server run test:rag-load
npm --prefix server run test:xiaomi-boundary
npm --prefix server run test:resource-sync
npm --prefix server run test:xiaomi-history
```

See `docs/AGGREGATION_ROADMAP.md` for the staged product backlog, `docs/XIAOMI_CAPTURE_EVIDENCE.md` for the evidence-backed Xiaomi capability boundary, `docs/BACKUP_SECURITY.md` for backup/credential operations, and `server/API.md` for API details.
