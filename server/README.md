# Terra Server

NestJS backend for Todo synchronization and private external connectors.

## Modules

- `REST /api/tasks` and `SSE /api/tasks/events/stream`: local-first Todo synchronization.
- `REST /api/xiaomi-notes`: server-side Xiaomi Notes connector.
- Terra Xiaomi history: queryable SQLite snapshots with AES-GCM encrypted rows and HMAC note lookup keys.
- `REST /api/resources`: encrypted cross-module Resource index and search.
- `REST /api/rss`: RSS/Atom subscriptions, safe fetching and reading state.
- `REST /api/blog`: encrypted drafts, privacy scanning and static Markdown publishing.
- `REST /api/travel`: encrypted itinerary, transport, booking, budget and checklist planning.
- `REST /api/rag`: encrypted document ingestion, local hybrid retrieval and cited answers.

## Development

Node.js 22.12 or newer is required for the built-in `node:sqlite` history backend. Node 22/24 may print its upstream experimental-module warning; Terra does not suppress that runtime warning.

```powershell
cd server
Copy-Item .env.example .env
# Optionally fill XIAOMI_CLOUD_COOKIE in .env.
# On Windows, an unconfigured connector also offers secure Cookie entry in the Xiaomi Notes page.
npm install
npm run start:dev
```

Build and run the isolated travel API regression test:

```powershell
npm run build
npm run test:travel-smoke
npm run test:rag-smoke
npm run test:rag-external
npm run test:xiaomi-credentials
npm run test:xiaomi-boundary
npm run test:resource-sync
npm run test:xiaomi-history
```

## Environment

- `PORT`: backend port, default `3001`.
- `TERRA_API_HOST`: bind host, default `127.0.0.1`. Non-loopback values are rejected unless remote access and a strong token are configured.
- `TERRA_ALLOWED_ORIGINS`: comma-separated CORS allowlist.
- `TERRA_ALLOW_REMOTE_API`: explicitly permit non-loopback clients; default false.
- `TERRA_REQUIRE_API_TOKEN`: optionally require the API token even for loopback clients.
- `TERRA_API_TOKEN`: remote API bearer/token value, minimum 32 characters for non-loopback binding.
- `TERRA_WINDOWS_SECRETS_FILE`: optional Windows DPAPI secret file path.
- `TERRA_MACOS_KEYCHAIN_SERVICE`: optional macOS Keychain service name; default `app.terra-hub.server`.
- `TERRA_DATA_FILE`: Todo JSON path, default `server/data/tasks.json`.
- `XIAOMI_CLOUD_COOKIE`: complete Cookie header from the user's own authenticated `i.mi.com` session. Server-side only.
- `TERRA_XIAOMI_READ_ONLY`: block Xiaomi create/update/delete/restore operations before network I/O; default false.
- `TERRA_XIAOMI_FAILURE_THRESHOLD`: consecutive upstream failures before circuit opening; default 3, range 1-10.
- `TERRA_XIAOMI_CIRCUIT_COOLDOWN_MS`: open-circuit cooldown; default 30 seconds, range 5 seconds to 10 minutes.
- `TERRA_XIAOMI_AUDIT_STDOUT`: optionally emit redacted structured connector audit events to stdout; default false. The in-memory ring remains available through the local API.
- `TERRA_XIAOMI_ALLOW_EMPTY_FULL_SYNC`: allow an empty Xiaomi scan to tombstone a previously non-empty index; default false.
- `TERRA_XIAOMI_HISTORY_DB`: optional canonical SQLite history path. Defaults to `server/data/xiaomi-note-history.sqlite`.
- `TERRA_XIAOMI_HISTORY_FILE`: deprecated canonical-path compatibility setting and legacy JSON migration source.
- `TERRA_XIAOMI_HISTORY_LEGACY_FILE`: optional additional plaintext/encrypted JSON migration source.
- `TERRA_HISTORY_ENCRYPTION_KEY`: preferred stable secret for scrypt-derived SQLite row-encryption and lookup keys; falls back to `TERRA_DATA_ENCRYPTION_KEY` or the system data key. Keep the effective key backed up securely.
- `TERRA_DATA_ENCRYPTION_KEY`: shared encryption key for metadata and future Resource stores; falls back to the history key.
- `TERRA_XIAOMI_METADATA_FILE`: optional Xiaomi note metadata store path.
- `TERRA_RESOURCE_FILE`: optional encrypted unified Resource index path.
- `TERRA_RSS_FILE`: optional encrypted RSS subscription/item store path.
- `TERRA_RSS_SCHEDULER_ENABLED`: enable due-feed polling; default true.
- `TERRA_RSS_ALLOWED_PORTS`: comma-separated feed ports; default `80,443`.
- `TERRA_RSS_ALLOW_PRIVATE_NETWORKS`: allow trusted LAN feeds; default false.
- `TERRA_BLOG_FILE`: optional encrypted blog draft store path.
- `TERRA_BLOG_CONTENT_DIR`: Hugo/Hexo/Jekyll-style Markdown content directory used by the publishing adapter.
- `TERRA_TRAVEL_FILE`: optional encrypted travel planner store path.
- `TERRA_TRAVEL_ATTACHMENTS_DB`: optional row-encrypted travel attachment SQLite path; default `server/data/travel-attachments.sqlite`.
- `TERRA_RAG_FILE`: optional encrypted RAG document/chunk/index store path.
- `TERRA_RAG_EXTERNAL_PROVIDER`: optional `openai-compatible` adapter; unset keeps all RAG work local.
- `TERRA_RAG_EXTERNAL_BASE_URL`: provider `/v1` base URL. HTTPS host must be `api.openai.com` or explicitly listed in `TERRA_RAG_EXTERNAL_ALLOWED_HOSTS`.
- `TERRA_RAG_EXTERNAL_API_KEY`: server-only external provider key. Never use a `VITE_*` variable.
- `TERRA_RAG_EXTERNAL_EMBEDDING_MODEL` / `TERRA_RAG_EXTERNAL_ANSWER_MODEL`: required model IDs for external mode.
- `TERRA_RAG_EXTERNAL_ALLOW_LOOPBACK`: explicitly allow an HTTP loopback-compatible provider for local development; default false.
- `TERRA_BACKUP_DIR`: directory for offline `.terra-backup` archives.

## Local API boundary

- The server binds only to `127.0.0.1` by default; CORS is not treated as authentication.
- State-changing cross-site requests and non-allowlisted Origins are rejected before controllers run.
- Non-loopback binding requires `TERRA_ALLOW_REMOTE_API=true` and a `TERRA_API_TOKEN` of at least 32 characters. Remote requests must send `Authorization: Bearer <token>` or `X-Terra-Api-Token`.
- API responses use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`.
- Keep remote mode off for the normal Web/Windows/Tauri workflow. Never put the API token in a `VITE_*` variable.

## Windows DPAPI secrets

The Windows helper stores secrets as current-user DPAPI ciphertext. Non-empty environment variables take priority. Xiaomi Cookies saved from the local Xiaomi Notes page are reloaded immediately; other externally changed secret values are loaded on the next server start.

```powershell
cd server
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 set xiaomiCloudCookie
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 set dataEncryptionKey
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 list
```

Supported names are `xiaomiCloudCookie`, `dataEncryptionKey`, `historyEncryptionKey`, and `apiToken`. When `XIAOMI_CLOUD_COOKIE` is absent, the local Xiaomi Notes page may submit a complete Cookie containing `serviceToken`; the backend writes it through the same DPAPI helper without placing it in browser storage or command arguments. After verifying the DPAPI file, remove the corresponding plaintext value from `.env` and restart the server. DPAPI ciphertext is bound to the current Windows user; retain a separate secure recovery copy of encryption keys.

## macOS Keychain secrets

The server invokes the fixed `/usr/bin/security` executable without a shell and caches each value after its first read. Non-empty environment variables remain the first-priority source.

```sh
cd server
sh scripts/manage-macos-secrets.sh set xiaomiCloudCookie
sh scripts/manage-macos-secrets.sh set dataEncryptionKey
sh scripts/manage-macos-secrets.sh list
```

The supported account names match Windows. The default Keychain service is `app.terra-hub.server`; set `TERRA_MACOS_KEYCHAIN_SERVICE` consistently for both the manager and server only when a separate service namespace is required. Keychain items and encryption keys are deliberately excluded from Terra data backups.

## Offline backup and restore

Stop Terra Server before export or restore. The archive wraps all configured server data files with a separate scrypt-derived AES-256-GCM key. `.env`, DPAPI secrets, Xiaomi credentials and encryption keys are deliberately excluded.

```powershell
cd server
npm run backup -- export
npm run backup -- inspect "data\backups\terra-backup-....terra-backup"
npm run backup -- restore "data\backups\terra-backup-....terra-backup" --confirm <backup-id>
```

The command prompts for the backup passphrase in an interactive terminal; automation can set `TERRA_BACKUP_PASSPHRASE` only in the child process environment. Restore validates every checksum, requires the inspected backup id, creates a pre-restore rollback archive, and atomically rolls back all targets if any replacement fails. Keep the original Terra data-encryption key with the backup because existing encrypted store envelopes still require it.

## Xiaomi connector boundaries

- Fixed upstream origin: `https://i.mi.com`.
- Request timeout: 12 seconds; upstream response limit: 5 MB.
- Title limit: 200 characters; content limit: 80,000 characters.
- List/detail memory cache with TTL and entry limits.
- Cloud writes are serialized and never automatically retried.
- Three consecutive upstream failures open a 30-second circuit by default. Open-circuit requests do not reach Xiaomi.
- A Xiaomi `401/403` enters `credentials_invalid` immediately and suppresses further upstream calls until restart with an updated Cookie.
- Read-only mode rejects cloud mutations while retaining list/detail and local Terra history reads.
- The audit ring retains at most 100 operation/result/duration/hash entries. It never stores cookies, bodies, upstream paths, or raw note IDs.
- Editing normalizes Xiaomi rich-note markup to plain text paragraphs.

## Terra history boundaries

- This is Terra-local history, not Xiaomi's official server history.
- A snapshot is created before update, delete, and restore; users can also create a manual checkpoint.
- Per-note limit: 60 versions; global limit: 1,000 versions; approximate storage budget: 25 MB.
- List endpoints omit full content; a version body is loaded only when selected.
- With `TERRA_HISTORY_ENCRYPTION_KEY`, plaintext history is migrated automatically to an AES-256-GCM envelope.
- Writes use a temporary file and recovery backup; a missing/wrong key never overwrites the existing encrypted file.
- Without an encryption key, history remains plaintext and the UI displays a warning.
- History files under `server/data` are ignored by Git.
- Single-version deletion and per-note cleanup affect only Terra snapshots and preserve every other note group.

## Rich-content preservation boundary

- Detail responses expose `hasRichFormatting` when Xiaomi content contains non-basic tags, images, mind-map fields, or non-common note types.
- A title-only save preserves the original upstream `content` byte-for-byte when the normalized body is unchanged.
- Editing the body still converts it to compatible plain-text `<text>` paragraphs.
- Terra history currently stores normalized plain text; restoring a history version does not reconstruct Xiaomi rich formatting.

## Travel planner boundaries

- Trips use real `YYYY-MM-DD` calendar dates, a maximum 366-day range, IANA timezones and three-letter currency codes.
- Transport and booking timestamps must be ISO 8601 values with an explicit timezone offset; cross-day segments are supported and reversed ranges are rejected.
- Coordinates are range-checked and linked-place distance is calculated with Haversine distance. Terra only builds HTTPS map links locally; coordinates leave Terra after the user opens a provider link.
- Budget totals remain separated by currency; Terra does not apply implicit exchange rates.
- Nested IDs are unique, references are validated, and a trip is limited to 10,000 nested records.
- Travel data and its Resource index entries use the common encrypted JSON store when `TERRA_DATA_ENCRYPTION_KEY` is configured.
- Attachment bodies require the data key and use independent AES-256-GCM rows in SQLite. Limits are 8 MB per file, 24 MB and 100 files per trip; downloads are forced as attachments with MIME sniffing disabled.
- `.terra-trip` packages use a separate 16+ character passphrase, scrypt, gzip and AES-256-GCM. Import validates the complete attachment manifest and assigns a new trip and attachment IDs before writing.
- Favorite RSS/Xiaomi resources can be imported into the encrypted candidate inbox without copying full source bodies. Imports are idempotent, secret candidates are opt-in, and a candidate cannot enter a less-private trip.

## Resource context boundaries

- `Resource.context` normalizes projects, exact/date-only time, timezone and structured locations while keeping source/tags/privacy as first-class fields.
- Search and list APIs combine source, tag, project, location, inclusive date range, type and privacy filters.
- Legacy Resource entries without context are derived from existing metadata at read time; all new source writes require validated context.
- Locations require paired, range-checked coordinates and are capped at 100 per Resource. Projects and date ranges are bounded and deduplicated.

## RAG boundaries

- Text, Markdown, JSON and CSV documents can be pasted, read locally from a browser file, or imported from an existing Resource.
- Per-document limits are 150,000 characters and 460,000 UTF-8 bytes; the store allows 2,000 documents and 50,000 chunks.
- Markdown-aware overlapping chunks reuse unchanged sparse vectors by content hash. Exact duplicate documents and duplicate retrieval chunks are removed.
- Retrieval combines BM25 with deterministic local hashed embeddings. The current answer provider is local extractive synthesis with numbered citations; it makes no external requests.
- The default query and global Resource search scopes include public/private data but exclude secret data. Secret content requires an explicit `maxPrivacy=secret` request.
- High-risk prompt-injection chunks are isolated by default. Explicit inclusion keeps their risk label, and query-side injection patterns are returned as warnings.
- Sensitive-information findings are stored with the encrypted document and never block local indexing; they remain visible for review in the knowledge workspace.
- Updates incrementally rebuild only the changed document. Reindex and deletion propagate to the unified Resource index.
- Local retrieval and extractive answers remain the default. External mode requires a configured allowlisted endpoint and fresh per-query consent, locally selects at most 24 candidates, then performs embedding rerank and cited generation without persisting external vectors.
- External mode rejects `maxPrivacy=secret` and `includeFlagged=true`; chunks from documents with high-severity sensitive findings are excluded before network I/O. Provider errors fail the query and never silently fall back to a local answer.
