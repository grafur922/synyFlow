# Terra backup and security operations

## Client backup

The Settings page exports browser-local Todo state and Terra UI preferences as a `.terra-client-backup` file. The browser derives an AES-256-GCM key with PBKDF2-SHA256 (310,000 iterations). Restore validates every allowlisted key and task record, downloads an encrypted pre-restore snapshot, applies localStorage changes with rollback, and synchronizes restored Todo data when the backend is configured.

Client backups do not contain Xiaomi cookies, server drafts, RSS, travel, RAG documents, or server encryption keys.

## Server backup

Stop Terra Server before export or restore.

```powershell
cd server
npm run backup -- export
npm run backup -- inspect "data\backups\<file>.terra-backup"
npm run backup -- restore "data\backups\<file>.terra-backup" --confirm <backup-id>
```

The command prompts for a passphrase and wraps all configured Todo, Resource index, Resource cursor/conflict, RSS, blog, travel, row-encrypted travel-attachment SQLite, RAG, Xiaomi-history, and Xiaomi-metadata files using scrypt + AES-256-GCM. Restore verifies hashes, requires the inspected backup ID, creates a pre-restore backup, and rolls back every target if any replacement fails.

The Xiaomi-history entry now contains the canonical SQLite database as binary data. If the new database does not exist yet but the old default JSON history does, export selects that legacy source so an upgrade-before-first-start does not omit it. Restoring an old JSON history entry to the canonical path is supported; Terra detects and migrates it on the next server start.

The archive excludes `.env`, the Xiaomi Cookie, DPAPI files and encryption keys. Keep a secure recovery copy of the data-encryption key; encrypted store files remain unreadable without it.

Legacy eight- and nine-store backups remain restorable. Missing Resource cursor/conflict or travel-attachment stores are removed during restore so they cannot remain inconsistent with the restored travel/index state. The next Xiaomi Resource sync performs a fresh full scan when its cursor store was absent.

## Windows DPAPI

```powershell
cd server
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 set xiaomiCloudCookie
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 set dataEncryptionKey
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 list
```

Available names: `xiaomiCloudCookie`, `dataEncryptionKey`, `historyEncryptionKey`, `apiToken`.

The file uses Windows current-user DPAPI. The Xiaomi Notes page can also save `xiaomiCloudCookie` through a loopback-only backend endpoint when no environment Cookie is active; the Cookie never enters browser persistence or backups. After testing DPAPI storage, remove matching plaintext values from `server/.env` and restart. Copying the DPAPI file to another Windows account does not make it decryptable.

## macOS Keychain (deferred)

```sh
cd server
sh scripts/manage-macos-secrets.sh set xiaomiCloudCookie
sh scripts/manage-macos-secrets.sh set dataEncryptionKey
sh scripts/manage-macos-secrets.sh list
```

The helper and server reader are retained as experimental code, but production macOS validation is paused for the current iteration. Do not treat this path as a release guarantee until it has passed native macOS integration, packaging, upgrade, and recovery tests. Environment variables still take explicit priority. Keychain entries are credentials, not server data, so offline Terra backups exclude them; retain a separate secure recovery copy of encryption keys.

## API exposure

- Default: `TERRA_API_HOST=127.0.0.1`, remote access disabled.
- Remote mode requires `TERRA_ALLOW_REMOTE_API=true` and a `TERRA_API_TOKEN` of at least 32 characters.
- Remote clients send `Authorization: Bearer <token>` or `X-Terra-Api-Token`.
- Do not place API tokens, Xiaomi cookies, or encryption keys in `VITE_*` variables.
- Keep `TERRA_ALLOWED_ORIGINS` restricted to the actual Web/Tauri origins.

## Recovery checks

Run the automated boundaries after changing storage or security code:

```powershell
npm --prefix server run test:access-smoke
npm --prefix server run test:backup-smoke
npm --prefix server run test:secrets-smoke
npm --prefix server run test:rag-smoke
```
