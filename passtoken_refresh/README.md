# MiNA micoapi Token 刷新工具

这是一个独立的 Node.js 命令行工具。它通过 Xiaomi Passport 获取新的 `micoapi` service token，并将 token 直接打印到标准输出。

## 环境要求

- Node.js 20 或更高版本
- 可访问 Xiaomi Passport 服务的网络

## 配置

先复制 `config.example.mjs` 为本地配置文件，再编辑 `config.mjs` 填写 3 个变量：

```bash
cp config.example.mjs config.mjs
```

```javascript
export const MI_USER_ID = '小米用户 ID';
export const C_USER_ID = '小米 C 用户 ID';
export const PASS_TOKEN = '小米 passToken';
```

`config.mjs` 已加入忽略规则，不会进入版本库。这些值属于敏感凭证，也不要把终端输出分享给无关人员。

## 运行

```bash
node src/index.mjs
```

也可以运行 `npm start --silent`。成功时 stdout 只输出新的 `micoapi serviceToken`。失败时 stderr 输出脱敏错误，进程退出码为 `1`。

工具不会访问 Django、数据库、Redis 或 MiNA 设备列表，也不会写入文件或刷新 `xiaomiio` 凭证。

## 测试

```bash
npm test
```

测试使用伪造 HTTP 响应，不会访问真实 Xiaomi 服务。
