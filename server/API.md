# Terra Server API

Development base URL: `http://localhost:3001/api`

## Todo

- `GET /tasks`
- `GET /tasks/:id`
- `POST /tasks`
- `PUT /tasks`
- `PATCH /tasks/:id`
- `PATCH /tasks/:id/toggle`
- `DELETE /tasks/:id`
- `DELETE /tasks`
- `GET /tasks/events/stream`

## Xiaomi Notes

Xiaomi cloud calls use `XIAOMI_CLOUD_COOKIE` when present. On Windows, if that environment variable is absent, the local Xiaomi Notes page can submit the complete Cookie to a loopback-only endpoint and store it using current-user DPAPI. Credential values are never returned by the API, logged, or placed in browser persistence.

- `GET /xiaomi-notes/status`
- `POST /xiaomi-notes/credentials`
- `GET /xiaomi-notes/audit`
- `GET /xiaomi-notes?cursor=&limit=100&refresh=false`
- `GET /xiaomi-notes/:id`
- `POST /xiaomi-notes`
- `PATCH /xiaomi-notes/:id`
- `DELETE /xiaomi-notes/:id`

Create/update body:

```json
{ "title": "标题", "content": "正文" }
```

Delete uses Xiaomi's non-purge operation and moves the note to the Xiaomi recycle bin.

`GET /xiaomi-notes/status` reports `mode` (`unconfigured`, `ready`, `readonly`, `credentials_invalid`, or `circuit_open`), `writable`, `credentialSource` (`environment`, `windows-dpapi`, or `none`), `credentialWritable`, consecutive failures, retry delay, redacted-audit counters, and history-storage health. `TERRA_XIAOMI_READ_ONLY=true` rejects every Xiaomi mutation before network I/O. A `401/403` marks credentials invalid immediately and suppresses further upstream calls until the Cookie is replaced from the local page or the server is restarted with an updated environment value. Other consecutive upstream failures open a bounded cooldown circuit; successful requests reset it.

`POST /xiaomi-notes/credentials` accepts `{ "cookie": "complete i.mi.com Cookie" }` only from a loopback client on Windows. It rejects environment-variable overrides, malformed values, control characters, oversized input, and Cookies without a valid `serviceToken`. Success returns only refreshed redacted connector status.

`GET /xiaomi-notes/audit` returns at most 100 in-memory operation records. Entries contain only a normalized operation name, outcome, duration, timestamp, error class, and one-way target hash. They never include a Cookie, request/response body, upstream path, title, content, or raw note id.

## Terra note history

History is stored locally by Terra and is independent from Xiaomi's own history implementation.

### `GET /xiaomi-notes/:id/history`

Returns history summaries without full note bodies.

### `GET /xiaomi-notes/:id/history/:historyId`

Returns one history entry including `content`.

### `POST /xiaomi-notes/:id/history`

Creates a manual checkpoint from the current Xiaomi cloud version. Unsaved browser drafts are not included.

### `POST /xiaomi-notes/:id/history/:historyId/restore`

Restores the selected version to Xiaomi Cloud. The current cloud version is snapshotted before restoration.

### `DELETE /xiaomi-notes/:id/history/:historyId`

Deletes one Terra-local version only. It never modifies the Xiaomi cloud note.

### `DELETE /xiaomi-notes/:id/history`

Clears every Terra-local version for one note id. Other note histories are preserved.

History reasons:

```ts
type XiaomiNoteHistoryReason =
  | 'created'
  | 'manual'
  | 'before_update'
  | 'before_delete'
  | 'before_restore'
  | 'restored'
```

## Privacy

- Do not commit packet captures, `server/.env`, `note.png`, or files in `server/data`.
- Node.js 22.12 or newer is required for the built-in SQLite backend.
- Configure `TERRA_HISTORY_ENCRYPTION_KEY` (or the system history/data key) before using history. scrypt derives separate AES-256-GCM row and HMAC-SHA256 lookup subkeys from a per-database salt.
- SQLite stores only random history ids, HMAC note-group keys, sort timestamps, ciphertext sizes, IVs, tags and ciphertext. Note ids, titles, bodies, previews, reasons and source timestamps remain inside authenticated ciphertext.
- Existing encrypted JSON envelopes migrate automatically. Valid plaintext JSON is converted to an encrypted legacy envelope before SQLite import, so migration does not leave a plaintext compatibility copy.
- `TERRA_XIAOMI_HISTORY_DB` selects the canonical database. `TERRA_XIAOMI_HISTORY_FILE` remains an in-place migration compatibility path; `TERRA_XIAOMI_HISTORY_LEGACY_FILE` can point to an additional JSON source.
- If the key is missing or incorrect, the history service becomes read-protected and preserves the original file instead of resetting it. Xiaomi mutations that require a safety snapshot are blocked before upstream write I/O when history is unavailable.
- Error responses and logs do not contain cookies, serviceToken, request bodies, or note content.

## Terra history archive

### `GET /xiaomi-notes/history/archive`

Returns history grouped by original Xiaomi note id. Each group contains the latest title/preview, version count, last history reason, and a `deletedCandidate` hint when the latest snapshot was captured before deletion.

### `POST /xiaomi-notes/history/archive/:historyId/recreate`

Creates a new Xiaomi note using the selected Terra history version. The original history group remains unchanged, and the newly created note receives its own `created` snapshot.

## Xiaomi folders

`GET /xiaomi-notes` now returns both `notes` and Xiaomi `folders`. Folder data is currently read-only because the available packet captures prove folder listing but do not yet prove safe folder create/move/delete request formats.

## Terra Xiaomi note metadata

Metadata is a Terra overlay and does not modify Xiaomi note bodies.

- `GET /xiaomi-notes/metadata/status`
- `GET /xiaomi-notes/metadata`
- `GET /xiaomi-notes/metadata/:id`
- `PATCH /xiaomi-notes/metadata/:id`
- `DELETE /xiaomi-notes/metadata/:id`

Patch body fields:

```json
{
  "favorite": true,
  "archived": false,
  "tags": ["work", "reference"],
  "privacy": "private"
}
```

Privacy levels are `public`, `private`, and `secret`. They are classification metadata only; choosing `public` does not publish the note.

Metadata uses the shared encrypted JSON store with `TERRA_DATA_ENCRYPTION_KEY`, falling back to `TERRA_HISTORY_ENCRYPTION_KEY`. Writes are serialized, size-limited, migrated from plaintext, and protected by temporary/backup replacement.


## Unified Resource index

The encrypted Resource index is the shared search layer for Todo, Xiaomi Notes, RSS, blog posts, trips, and RAG documents.

- `GET /resources/status`
- `GET /resources/conflicts?status=unresolved|resolved|all`
- `GET /resources/conflicts/:id`
- `POST /resources/conflicts/:id/resolve` with `{"resolution":"keep_current|accept_incoming"}`
- `GET /resources`
- `GET /resources/:id`
- `GET /resources/search?q=&type=&source=&privacy=&maxPrivacy=&tag=&project=&location=&fromDate=&toDate=&limit=`
- `POST /resources/sync/tasks`
- `POST /resources/sync/xiaomi-notes?mode=auto|full|incremental`
- `POST /resources/sync/all`
- `DELETE /resources/:id` removes only the index entry, not the source item.

Xiaomi full synchronization starts without a cursor, walks every summary page, rejects missing/repeated cursors, and persists the final `syncTag` only after Resource and conflict writes succeed. Incremental synchronization resumes from that encrypted cursor, upserts only returned notes, and never interprets an omitted note as deleted. `auto` performs a full scan when no cursor exists or `TERRA_RESOURCE_XIAOMI_FULL_SCAN_INTERVAL_MS` has elapsed; otherwise it uses incremental mode. Full scans remain the only path that creates deletion tombstones. An unexpected empty full scan leaves a previously non-empty Xiaomi index unchanged unless `TERRA_XIAOMI_ALLOW_EMPTY_FULL_SYNC=true` is explicitly set.

Details are fetched with concurrency 4 for new/modified/reappearing full-scan notes and for every incremental delta, with a 5,000-note and 1,000-page run limit. A same-timestamp divergent body or a regressed source timestamp does not overwrite the current Resource. Both versions are stored in the encrypted sync store until explicitly resolved. Conflict list responses omit content; the single-conflict endpoint returns both bodies. Accepting an incoming version changes only the Resource index, not Xiaomi Cloud.

`TERRA_RESOURCE_SYNC_FILE` defaults to `resource-sync.json` beside `TERRA_RESOURCE_FILE`. Status responses expose only `cursorPresent`, mode and timestamps, never the raw cursor. Set `TERRA_RESOURCE_SYNC_INTERVAL_MS` to opt into background auto sync; zero disables background network activity. Concurrent Xiaomi index runs and conflict resolution during an active run return `409`.

Resources missing from a completed source snapshot become soft-deletion tombstones rather than being physically removed. Tombstones are excluded from list/search/detail APIs, retain source identity for conflict/reappearance handling, and are capped per source/type. When a source item reappears, the active item replaces its tombstone. `GET /resources/status` reports active, stored, and tombstone counts plus the latest Xiaomi sync outcome.

Every new Resource carries a validated `context` with `projects`, optional exact/date-only `time`, and structured `locations`. Todo dates remain date-only, travel dates retain their IANA timezone, and RSS/blog/document/note resources use exact source timestamps. Existing indexes without `context` remain readable and derive compatible values from legacy metadata. Search/list filters can combine source, exact tag, project/location text, inclusive date overlap, type, and privacy.

The index, incremental cursors, and conflict versions use `TERRA_DATA_ENCRYPTION_KEY` and the common encrypted JSON store. Without an exact `privacy` filter, search defaults to `maxPrivacy=private`; set `maxPrivacy=secret` explicitly to include secret resources.


## RSS / Atom

- `GET /rss/status`
- `GET /rss/subscriptions`
- `POST /rss/subscriptions`
- `GET /rss/subscriptions/:id`
- `PATCH /rss/subscriptions/:id`
- `DELETE /rss/subscriptions/:id`
- `POST /rss/subscriptions/:id/fetch`
- `POST /rss/fetch-all?force=true`
- `GET /rss/items?subscriptionId=&read=&favorite=&offset=&limit=`
- `GET /rss/items/:id`
- `PATCH /rss/items/:id`

Subscription creation validates and fetches the feed by default. RSS and Atom items receive stable SHA-256 ids based on subscription id + guid. Existing read/favorite/tags state survives refreshes.

Conditional requests use ETag and Last-Modified. Failures use exponential backoff from 15 minutes to 24 hours. The scheduler checks due feeds every five minutes and limits concurrent fetches to three. Per-subscription fetches are locked to prevent duplicate requests.

### RSS network security

The fetcher resolves DNS first and pins the native HTTP(S) request to an approved public address while retaining the original Host/SNI. It rejects private/reserved IPv4 and IPv6 ranges, URL credentials, disallowed ports, HTTPS-to-HTTP redirects, more than five redirects, responses over 2 MB, unsupported content types, and requests longer than 15 seconds.

Set `TERRA_RSS_ALLOW_PRIVATE_NETWORKS=true` only for explicitly trusted local feeds. Configure non-standard ports through `TERRA_RSS_ALLOWED_PORTS`.

RSS bodies are converted to safe plain text; script/style elements are removed. RSS items are automatically mirrored into the encrypted Resource index. A Resource index failure is reported separately and never rolls back RSS source data.


## Personal blog

- `GET /blog/status`
- `GET /blog/drafts`
- `POST /blog/drafts`
- `POST /blog/drafts/from-xiaomi/:noteId`
- `GET /blog/drafts/:id`
- `PATCH /blog/drafts/:id`
- `DELETE /blog/drafts/:id`
- `GET /blog/drafts/:id/scan`
- `GET /blog/drafts/:id/preview`
- `POST /blog/drafts/:id/publish`
- `POST /blog/drafts/:id/withdraw`

Drafts are encrypted through the common data store. The Markdown adapter publishes only inside `TERRA_BLOG_CONTENT_DIR`, rejects unsafe slugs and symlink targets, writes through temporary/backup files, and moves withdrawn files into `.terra-trash`.

Publishing requires `privacy=public`. High-severity scanner findings must be acknowledged by id. Rules detect Xiaomi service tokens, API keys, AWS keys, Bearer/JWT tokens, password assignments, private keys, identity numbers, private IPs, phone numbers, and email addresses. Preview HTML is generated from escaped Markdown and displayed in a sandboxed iframe.

Published and draft posts are mirrored into the encrypted Resource index. `publishedAt` preserves the first publication time; `lastPublishedAt` tracks the last deployed revision and identifies local changes after publishing.


## Travel planner

- `GET /travel/status`
- `GET /travel/map/providers`
- `POST /travel/map/link`
- `POST /travel/offline-packages/import`
- `GET /travel/candidates?status=&source=`
- `POST /travel/candidates/import-favorites?maxPrivacy=private|secret`
- `PATCH /travel/candidates/:id`
- `DELETE /travel/candidates/:id`
- `POST /travel/candidates/:id/add-to-trip`
- `GET /travel/trips`
- `POST /travel/trips`
- `GET /travel/trips/:id`
- `PATCH /travel/trips/:id`
- `DELETE /travel/trips/:id`
- `POST /travel/trips/:id/duplicate`
- `GET /travel/trips/:id/summary`
- `GET /travel/trips/:id/export?format=markdown|json`
- `POST /travel/trips/:id/attachments`
- `GET /travel/trips/:id/attachments/:attachmentId`
- `DELETE /travel/trips/:id/attachments/:attachmentId`
- `POST /travel/trips/:id/offline-package`

Create body:

```json
{
  "title": "上海周末",
  "description": "博物馆与西湖",
  "startDate": "2026-08-01",
  "endDate": "2026-08-03",
  "timezone": "Asia/Shanghai",
  "currency": "CNY",
  "privacy": "private",
  "tags": ["周末"],
  "travelers": ["Terra"]
}
```

`PATCH` accepts trip overview fields and complete `days`, `segments`, `bookings`, `budget`, or `checklist` arrays. Attachments can only change through their dedicated endpoints. Nested records use UUIDs. Segment and booking timestamps require an ISO 8601 timezone suffix such as `Z` or `+08:00`.

Linked places with coordinates receive a Haversine `distanceKm`; paired timestamps receive `durationMinutes`. Summary totals are grouped by currency and never converted implicitly. Duplicate creates fresh nested IDs and preserves valid segment-to-place references.

Trips are mirrored into the encrypted Resource index. Dates, timezone, coordinates, references, item counts, text lengths and store size are validated before an atomic write.

Travel candidates are encrypted in the same travel store. Import reads favorite RSS items plus current Xiaomi favorite/privacy metadata, copies only title/summary/tags/source identity, and deduplicates by Resource id. Secret favorites require explicit `maxPrivacy=secret`. Adding a candidate requires an existing trip day and rejects a target trip whose privacy is less restrictive than the candidate. Re-adding the same candidate returns `409`; deleting a candidate card never deletes an already-created trip place.

Map endpoints only validate data and generate provider HTTPS URLs; they never contact a provider. High-deviation WGS84 coordinates are not silently passed into AMap route URLs, so AMap is exposed for place search only. Providers advertise `routeModes`; Apple supports walk/drive/transit/train, Google adds bike, and OSM supports walk/bike/drive. Unsupported modes are rejected instead of being relabelled as driving. Opening a returned URL is the explicit external transfer boundary.

Attachment upload uses `application/octet-stream` with URI-encoded `X-Terra-Attachment-Name` and `X-Terra-Attachment-Mime` headers, plus `X-Terra-Attachment-Scope: trip|day|place|booking` and an optional scope ID. Bodies are limited to 8 MB. Metadata stays in the encrypted travel store; bodies use AES-256-GCM rows in `TERRA_TRAVEL_ATTACHMENTS_DB`. A trip is limited to 100 files and 24 MB. Duplicate/import rebuild attachment and scope IDs, while deletion removes associated rows.

Offline export accepts `{ "passphrase": "..." }` and returns `application/vnd.terra.trip+json`. Import accepts that media type as a raw body and a URI-encoded `X-Terra-Package-Passphrase` header. Packages are capped at 64 MB and use their own scrypt + gzip + AES-256-GCM envelope; a wrong passphrase or mismatched attachment manifest makes no writes.


## RAG knowledge base

- `GET /rag/status`
- `GET /rag/documents`
- `POST /rag/documents`
- `POST /rag/documents/from-resource/:resourceId`
- `GET /rag/documents/:id`
- `PATCH /rag/documents/:id`
- `DELETE /rag/documents/:id`
- `POST /rag/documents/:id/reindex`
- `POST /rag/reindex`
- `POST /rag/query`

Create body:

```json
{
  "title": "江南交通资料",
  "content": "# 高铁\n上海到杭州约 75 分钟。",
  "tags": ["旅行", "交通"],
  "privacy": "private",
  "mimeType": "text/markdown",
  "source": "manual"
}
```

Query body:

```json
{
  "query": "上海到杭州需要多久",
  "maxPrivacy": "private",
  "documentIds": [],
  "limit": 8,
  "includeFlagged": false,
  "provider": "local",
  "externalConsent": false
}
```

The response contains an `answer`, `confidence`, numbered `citations`, query-side injection warnings, privacy/flagged/sensitive/duplicate exclusion counts, and the effective provider policy. `provider=local` is the default and makes no external requests.

`maxPrivacy` defaults to `private`. Secret documents require explicit `secret`; high-risk prompt-injection chunks require `includeFlagged=true` and remain risk-labelled. Document content, findings, terms and sparse vectors share the `terra-rag-state` encrypted envelope.

`provider=external` requires a configured allowlisted OpenAI-compatible endpoint and `externalConsent=true` on that request. It rejects secret scope, flagged inclusion, and high-severity sensitive query text before network I/O; documents with high-severity findings in their title or content are excluded. Terra locally narrows to 24 chunks and sends only that bounded candidate set for embedding rerank and cited generation. Returned citation numbers must refer to supplied evidence. External vectors and answers are not persisted or placed in the local query cache. Provider failures return an error instead of silently changing answer mode.
