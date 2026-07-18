# Android Development

This project can run on an Android device through Tauri v2.

## Campus Network

Campus Wi-Fi often blocks device-to-device traffic. If the phone cannot open `http://<computer-ip>:1420`, do not use the LAN IP flow.

Use USB reverse port forwarding instead:

```bash
adb devices
npm run android:reverse
```

The reverse mapping exposes the computer services to the phone as:

- `http://127.0.0.1:1420` for Vite
- `ws://127.0.0.1:1421` for Vite HMR
- `http://127.0.0.1:3001` for the NestJS backend

The local frontend env is:

```bash
VITE_TERRA_API_URL=http://127.0.0.1:3001
```

This is stored in `.env.local`, which is ignored by git.

## Start Order

Start the backend:

```bash
cd server
npm run start:dev
```

From the project root, set USB reverse ports:

```bash
npm run android:reverse
```

Start Android dev:

```bash
npm run android:dev
```

`android:dev` runs:

```bash
tauri android dev --host 127.0.0.1
```

This matches the USB reverse setup and avoids relying on campus LAN reachability.

## Quick Checks

On the computer:

```bash
curl http://127.0.0.1:1420
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/tasks
```

In the app header:

- `后端已连接`: frontend is using the NestJS backend.
- `后端离线`: frontend is configured for the backend but cannot reach it.
- `本地模式`: `VITE_TERRA_API_URL` was not loaded, so the frontend is using local storage only.

## LAN Mode

Only use LAN mode when the phone can open `http://<computer-ip>:1420` in its browser.

Set `.env.local` to:

```bash
VITE_TERRA_API_URL=http://<computer-ip>:3001
```

Then run:

```bash
tauri android dev --host <computer-ip>
```
