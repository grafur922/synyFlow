# Xiaomi Cookie DPAPI Setup Design

Date: 2026-07-18
Status: Implemented

## Objective

When the Xiaomi Notes connector cannot obtain `XIAOMI_CLOUD_COOKIE` from the server environment, allow the user to enter the complete Xiaomi Cloud Cookie on the Xiaomi Notes page and persist it with Windows DPAPI. The connector must use the saved credential immediately without restarting Terra Server.

## Security boundaries

- The browser submits the Cookie only to the local Terra Server API.
- The Cookie must never be stored in localStorage, sessionStorage, persisted Pinia state, browser backups, logs, audit events, screenshots, URLs, or API responses.
- The backend accepts credentials only when Windows DPAPI is available.
- `XIAOMI_CLOUD_COOKIE` remains the highest-priority source. A UI submission cannot override an environment-provided Cookie.
- The DPAPI payload is encrypted for the current Windows user, written atomically, and protected by an ACL granting access only to that user.
- Errors expose validation categories but never echo submitted values, upstream response bodies, file paths, or decrypted credentials.

## User experience

### Unconfigured state

The existing Xiaomi Notes unconfigured card will replace the environment-variable-only instructions with:

- a password-style multiline field for the complete Cookie;
- concise guidance that the value must come from the user's own `i.mi.com` session and include `serviceToken`;
- a `安全保存并连接` action;
- a secondary `重新检测` action.

The input remains component-local and is cleared after a successful save and when the component is unmounted.

### Invalid credential state

If an existing DPAPI credential later receives an upstream 401 or 403, the same secure replacement form becomes available. Saving a replacement resets the connector's invalid-credential and circuit-breaker state.

### Environment-configured state

When an environment Cookie exists, the form is not shown. The status response identifies that the environment source is active, and the credential write endpoint rejects replacement attempts with a conflict response.

## API design

### Connector status

`GET /api/xiaomi-notes/status` adds non-secret credential metadata:

- `credentialSource`: `environment`, `windows-dpapi`, or `none`;
- `credentialWritable`: whether this server can accept a DPAPI credential from the UI.

No secret value or identifying Cookie fragment is returned.

### Save credential

`POST /api/xiaomi-notes/credentials`

Request body:

```json
{
  "cookie": "complete i.mi.com Cookie"
}
```

Successful response contains only refreshed connector status. The endpoint:

1. rejects non-Windows systems or unavailable DPAPI storage;
2. rejects the request if `XIAOMI_CLOUD_COOKIE` is non-empty;
3. validates type and bounded length;
4. rejects CR, LF, NUL, and other disallowed control characters;
5. parses semicolon-separated Cookie pairs and requires a non-empty `serviceToken`;
6. encrypts and atomically persists `xiaomiCloudCookie`;
7. clears the in-process secret cache;
8. reloads connector credentials and resets transient failure state;
9. returns redacted status metadata.

The endpoint performs structural validation before persistence. Actual Xiaomi session validity is established by the next bounded connector request; 401/403 transitions the connector to `credentials_invalid` and enables replacement.

## Backend structure

### Secret storage

Extend `server/src/security/secrets.ts` with bounded Windows secret-write support. It invokes the existing management script through a new non-interactive `set-stdin` action, so DPAPI/ACL logic remains centralized while secret material is supplied only through process stdin. The writer will:

- preserve unrelated secrets in the versioned secret file;
- use PowerShell `ConvertFrom-SecureString` under the current user context;
- pass secret material through process stdin rather than command arguments or generated command text;
- write a temporary file in the destination directory and atomically replace the target;
- apply a current-user-only ACL;
- invalidate relevant secret caches after success.

The existing PowerShell management script remains available for operators and uses the same secret names and file format.

### Connector credential lifecycle

Refactor `XiaomiNotesService` so Cookie and `serviceToken` are reloadable fields rather than constructor-only readonly values. A credential reload method obtains the current effective source, derives `serviceToken`, clears list/detail caches, and resets invalid-credential/circuit state only after a successful DPAPI write.

### Validation and DTO

Add a dedicated DTO for the credential request. Runtime validation remains in the credential service because credential-specific character, length, and Cookie-pair rules exceed basic DTO typing.

## Frontend structure

- Extend `XiaomiConnectorStatus` with `credentialSource` and `credentialWritable`.
- Add `saveCredentials(cookie)` to `xiaomiNotesApi`.
- Add a store action that submits the Cookie, replaces status with the returned redacted status, and never retains the Cookie.
- Add component-local input, pending state, validation/error display, and form clearing to `XiaomiNotes.vue`.
- Do not add credential fields to global persistence or backup schemas.

## Error handling

- `400 Bad Request`: malformed, oversized, control-character-containing, or serviceToken-missing Cookie.
- `409 Conflict`: an environment Cookie is active and cannot be overridden.
- `503 Service Unavailable`: DPAPI is unavailable or secure persistence fails.
- Unexpected errors are normalized and must not include submitted Cookie data or private PowerShell stderr.

## Verification

Automated verification will cover:

1. DPAPI output does not contain plaintext Cookie material.
2. Existing secret entries survive Cookie updates.
3. Environment source has priority and rejects UI override.
4. Missing/empty `serviceToken`, control characters, and oversized values are rejected.
5. Successful storage is available through `getXiaomiCloudCookie()` after cache invalidation.
6. A running `XiaomiNotesService` reloads the credential without server restart.
7. Status/API responses never contain the Cookie or token.
8. Frontend and backend typechecks/builds pass.
9. Xiaomi boundary and secret smoke tests continue to pass.

## Out of scope

- Capturing browser Cookies automatically.
- Storing credentials in browser or Tauri frontend storage.
- macOS Keychain production support or Android Keystore support.
- Guessing or adding unsupported Xiaomi Cloud operations.
- Returning, revealing, or partially masking the stored Cookie in the UI.
