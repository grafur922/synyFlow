# Terra Server

用于待办事项同步和私有外部连接器的 NestJS 后端。

## 模块

- `REST /api/tasks` 和 `SSE /api/tasks/events/stream`：本地优先的待办事项同步。
- `REST /api/xiaomi-notes`：服务端小米笔记连接器。
- Terra 小米历史：可查询的 SQLite 快照，行级 AES-GCM 加密，使用 HMAC 笔记查找键。
- `REST /api/resources`：加密的跨模块资源索引与搜索。
- `REST /api/rss`：RSS/Atom 订阅、安全抓取和阅读状态。
- `REST /api/blog`：加密草稿、隐私扫描和静态 Markdown 发布。
- `REST /api/travel`：加密的行程、交通、预订、预算和清单规划。
- `REST /api/rag`：加密文档摄取、本地混合检索和带引用的回答。

## 开发

内置的 `node:sqlite` 历史后端需要 Node.js 22.12 或更高版本。Node 22/24 可能会打印其上游的实验性模块警告；Terra 不会抑制该运行时警告。

```powershell
cd server
Copy-Item .env.example .env
# 可选：在 .env 中填写 XIAOMI_CLOUD_COOKIE。
# 在 Windows 上，未配置的连接器也支持在小米笔记页面安全输入 Cookie。
npm install
npm run start:dev
```

构建并运行独立的旅行 API 回归测试：

```powershell
npm run build
npm run test:travel-smoke
npm run test:rag-smoke
npm run test:rag-external
npm run test:rag-aliyun
npm run test:rag-vector-store
npm run test:rag-hybrid
npm run test:rag-xiaomi-sync
npm run test:rag-migration
npm run test:xiaomi-credentials
npm run test:xiaomi-passport
npm run test:xiaomi-refresh
npm run test:xiaomi-boundary
npm run test:resource-sync
npm run test:xiaomi-history
```

## 环境变量

- `PORT`：后端端口，默认 `3001`。
- `TERRA_API_HOST`：绑定主机，默认 `127.0.0.1`。除非配置了远程访问和强令牌，否则拒绝非回环值。
- `TERRA_ALLOWED_ORIGINS`：逗号分隔的 CORS 白名单。
- `TERRA_ALLOW_REMOTE_API`：明确允许非回环客户端；默认 false。
- `TERRA_REQUIRE_API_TOKEN`：可选，即使对回环客户端也要求 API 令牌。
- `TERRA_API_TOKEN`：远程 API 的 bearer/令牌值，非回环绑定要求至少 32 个字符。
- `TERRA_WINDOWS_SECRETS_FILE`：可选的 Windows DPAPI 密钥文件路径。
- `TERRA_MACOS_KEYCHAIN_SERVICE`：可选的 macOS Keychain 服务名称；默认 `app.terra-hub.server`。
- `TERRA_DATA_FILE`：Todo JSON 路径，默认 `server/data/tasks.json`。
- `XIAOMI_CLOUD_COOKIE`：用户自己已认证 `i.mi.com` 会话的完整 Cookie 请求头。仅服务端使用。
- `TERRA_XIAOMI_READ_ONLY`：在网络 I/O 之前阻止小米的创建/更新/删除/恢复操作；默认 false。
- `TERRA_XIAOMI_FAILURE_THRESHOLD`：熔断开启前的连续上游失败次数；默认 3，范围 1-10。
- `TERRA_XIAOMI_CIRCUIT_COOLDOWN_MS`：熔断开启后的冷却时间；默认 30 秒，范围 5 秒到 10 分钟。
- `TERRA_XIAOMI_AUDIT_STDOUT`：可选，将脱敏的结构化连接器审计事件输出到 stdout；默认 false。内存环形缓冲仍可通过本地 API 获取。
- `TERRA_XIAOMI_ALLOW_EMPTY_FULL_SYNC`：允许一次空的小米扫描将之前非空的索引标记为墓碑；默认 false。
- `TERRA_XIAOMI_HISTORY_DB`：可选的规范 SQLite 历史路径。默认 `server/data/xiaomi-note-history.sqlite`。
- `TERRA_XIAOMI_HISTORY_FILE`：已弃用的规范路径兼容设置和旧版 JSON 迁移源。
- `TERRA_XIAOMI_HISTORY_LEGACY_FILE`：可选的额外明文/加密 JSON 迁移源。
- `TERRA_HISTORY_ENCRYPTION_KEY`：首选稳定密钥，用于 scrypt 派生的 SQLite 行加密和查找键；回退到 `TERRA_DATA_ENCRYPTION_KEY` 或系统数据密钥。请安全备份实际使用的密钥。
- `TERRA_DATA_ENCRYPTION_KEY`：元数据和未来资源存储的共享加密密钥；回退到历史密钥。
- `TERRA_XIAOMI_METADATA_FILE`：可选的小米笔记元数据存储路径。
- `TERRA_RESOURCE_FILE`：可选的加密统一资源索引路径。
- `TERRA_RSS_FILE`：可选的加密 RSS 订阅/条目存储路径。
- `TERRA_RSS_SCHEDULER_ENABLED`：启用到期订阅轮询；默认 true。
- `TERRA_RSS_ALLOWED_PORTS`：逗号分隔的订阅源端口；默认 `80,443`。
- `TERRA_RSS_ALLOW_PRIVATE_NETWORKS`：允许受信任的局域网订阅源；默认 false。
- `TERRA_BLOG_FILE`：可选的加密博客草稿存储路径。
- `TERRA_BLOG_CONTENT_DIR`：发布适配器使用的 Hugo/Hexo/Jekyll 风格 Markdown 内容目录。
- `TERRA_TRAVEL_FILE`：可选的加密旅行规划器存储路径。
- `TERRA_TRAVEL_ATTACHMENTS_DB`：可选的行加密旅行附件 SQLite 路径；默认 `server/data/travel-attachments.sqlite`。
- `TERRA_RAG_FILE`：加密的 RAG v2 文档/分块/同步台账/设置存储路径。
- `TERRA_RAG_VECTOR_PATH`：本地 LanceDB 目录。仅存储向量以及分块/文档 ID 和哈希，绝不存储笔记标题或正文。
- `TERRA_RAG_ALIYUN_API_KEY`：仅服务端的阿里云 Embedding 密钥。在 Windows 上也可以通过设置的 DPAPI 存储；环境变量始终优先。
- `TERRA_RAG_ALIYUN_BASE_URL`、`TERRA_RAG_ALIYUN_MODEL`、`TERRA_RAG_ALIYUN_DIMENSIONS`、`TERRA_RAG_ALIYUN_BATCH_SIZE`、`TERRA_RAG_ALIYUN_TIMEOUT_MS`：可选的已保存 Embedding 设置的环境覆盖。
- `TERRA_RAG_EXTERNAL_PROVIDER`：可选的 `openai-compatible` 适配器；不设置则所有 RAG 工作保持本地。
- `TERRA_RAG_EXTERNAL_BASE_URL`：提供商的 `/v1` 基础 URL。HTTPS 主机必须是 `api.openai.com` 或显式列入 `TERRA_RAG_EXTERNAL_ALLOWED_HOSTS`。
- `TERRA_RAG_EXTERNAL_API_KEY`：仅服务端的外部提供商密钥。切勿使用 `VITE_*` 变量。
- `TERRA_RAG_EXTERNAL_EMBEDDING_MODEL` / `TERRA_RAG_EXTERNAL_ANSWER_MODEL`：外部模式必需的模型 ID。
- `TERRA_RAG_EXTERNAL_ALLOW_LOOPBACK`：明确允许兼容 HTTP 回环的提供商用于本地开发；默认 false。
- `TERRA_BACKUP_DIR`：离线 `.terra-backup` 归档目录。

## 本地 API 边界

- 服务器默认仅绑定 `127.0.0.1`；CORS 不被视为身份认证。
- 改变状态的跨站请求和非白名单 Origin 在控制器运行之前被拒绝。
- 非回环绑定要求 `TERRA_ALLOW_REMOTE_API=true` 和至少 32 字符的 `TERRA_API_TOKEN`。远程请求必须发送 `Authorization: Bearer <token>` 或 `X-Terra-Api-Token`。
- API 响应使用 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 和 `X-Frame-Options: DENY`。
- 常规 Web/Windows/Tauri 工作流应保持远程模式关闭。切勿将 API 令牌放入 `VITE_*` 变量。

## Windows DPAPI 密钥

Windows 辅助工具将密钥存储为当前用户的 DPAPI 密文。包含 `serviceToken` 的有效环境 Cookie 优先。空或占位符环境值会被忽略，以便本地设置表单仍然可用。从本地小米笔记页面保存的小米 Cookie 会立即重新加载；其他外部更改的密钥值在下次服务器启动时加载。

```powershell
cd server
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 set xiaomiCloudCookie
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 set dataEncryptionKey
powershell -ExecutionPolicy Bypass -File scripts/manage-windows-secrets.ps1 list
```

支持的名称为 `xiaomiCloudCookie`、`xiaomiPassportRefreshCredentials`、`aliyunEmbeddingApiKey`、`dataEncryptionKey`、`historyEncryptionKey` 和 `apiToken`。当缺少 `XIAOMI_CLOUD_COOKIE` 时，本地小米笔记页面可以提交包含 `serviceToken` 的完整 Cookie；Passport 刷新凭证可通过 `npm run import:xiaomi-refresh -- --file <myinfo.txt>` 导入 DPAPI，或从设置中更新；后端通过相同的 DPAPI 辅助工具写入，不会将其放入浏览器存储或命令行参数。验证 DPAPI 文件后，从 `.env` 中删除对应的明文值并重启服务器。DPAPI 密文绑定到当前 Windows 用户；请单独保留一份安全恢复副本的加密密钥。

## macOS Keychain 密钥

服务器直接调用固定的 `/usr/bin/security` 可执行文件（不经 shell），并在首次读取后缓存每个值。非空环境变量仍是最高优先级来源。

```sh
cd server
sh scripts/manage-macos-secrets.sh set xiaomiCloudCookie
sh scripts/manage-macos-secrets.sh set dataEncryptionKey
sh scripts/manage-macos-secrets.sh list
```

支持的账户名称与 Windows 相同。默认 Keychain 服务是 `app.terra-hub.server`；仅在需要独立服务命名空间时，才为管理工具和服务器一致设置 `TERRA_MACOS_KEYCHAIN_SERVICE`。Keychain 条目和加密密钥刻意排除在 Terra 数据备份之外。

## 离线备份与恢复

导出或恢复前请先停止 Terra Server。归档将配置的所有服务器数据文件以及完整的 `TERRA_RAG_VECTOR_PATH` 目录用独立的 scrypt 派生 AES-256-GCM 密钥包装。`.env`、DPAPI 负载、API 密钥、小米凭证和加密密钥刻意排除在外。目录归档拒绝符号链接、不安全路径和类似凭证的文件名。

```powershell
cd server
npm run backup -- export
npm run backup -- inspect "data\backups\terra-backup-....terra-backup"
npm run backup -- restore "data\backups\terra-backup-....terra-backup" --confirm <backup-id>
```

该命令在交互式终端中提示输入备份口令；自动化只能在子进程环境中设置 `TERRA_BACKUP_PASSPHRASE`。恢复会校验每个文件和目录的校验和，要求已检查的备份 id，创建恢复前的回滚归档，并在任何替换失败时原子化回滚所有目标。没有 `ragVectors` 的旧备份仍可恢复；知识库随后以 BM25/本地模式启动，直到重建向量索引。请将原始 Terra 数据加密密钥与备份放在一起，因为现有加密存储信封仍需要它。

## 小米连接器边界

- 固定的上游源：`https://i.mi.com`。
- 请求超时：12 秒；上游响应限制：5 MB。
- 标题限制：200 字符；内容限制：80,000 字符。
- 列表/详情内存缓存，带 TTL 和条目限制。
- 云端写入串行化，从不自动重试。
- 默认连续三次上游失败开启 30 秒熔断。熔断开启期间的请求不会到达小米。
- 小米 `401/403` 立即进入 `credentials_invalid` 状态，并在使用更新后的 Cookie 重启前抑制进一步的上游调用。
- 只读模式拒绝云端变更，同时保留列表/详情和本地 Terra 历史读取。
- 审计环形缓冲最多保留 100 条操作/结果/耗时/哈希条目。它从不存储 Cookie、请求体、上游路径或原始笔记 ID。
- 编辑会将小米富笔记标记规范化为纯文本段落。

## Terra 历史边界

- 这是 Terra 本地历史，不是小米官方的服务器历史。
- 在更新、删除和恢复之前都会创建快照；用户也可以创建手动检查点。
- 单笔记限制：60 个版本；全局限制：1,000 个版本；近似存储预算：25 MB。
- 列表端点省略完整内容；仅在选择时加载版本正文。
- 配置 `TERRA_HISTORY_ENCRYPTION_KEY` 后，明文历史会自动迁移到 AES-256-GCM 信封。
- 写入使用临时文件和恢复备份；密钥缺失或错误时绝不会覆盖现有加密文件。
- 没有加密密钥时，历史保持明文，UI 会显示警告。
- `server/data` 下的历史文件被 Git 忽略。
- 单版本删除和单笔记清理只影响 Terra 快照，并保留所有其他笔记组。

## 富内容保留边界

- 当小米内容包含非基础标签、图片、思维导图字段或非常见笔记类型时，详情响应会暴露 `hasRichFormatting`。
- 当规范化正文未变化时，仅标题保存会按字节保留原始上游 `content`。
- 编辑正文仍会将其转换为兼容的纯文本 `<text>` 段落。
- Terra 历史目前存储规范化纯文本；恢复历史版本不会重建小米富格式。

## 旅行规划器边界

- 行程使用真实的 `YYYY-MM-DD` 日历日期、最长 366 天的范围、IANA 时区和三字母货币代码。
- 交通和预订时间戳必须是带显式时区偏移的 ISO 8601 值；支持跨天航段，拒绝反向范围。
- 坐标经过范围检查，关联地点距离使用 Haversine 距离计算。Terra 仅在本地构建 HTTPS 地图链接；坐标在用户打开提供商链接后才离开 Terra。
- 预算总额按货币分开；Terra 不应用隐式汇率。
- 嵌套 ID 唯一，引用经过校验，单个行程限制为 10,000 条嵌套记录。
- 配置 `TERRA_DATA_ENCRYPTION_KEY` 时，旅行数据及其资源索引条目使用通用加密 JSON 存储。
- 附件正文需要数据密钥，并使用 SQLite 中独立的 AES-256-GCM 行。限制为每文件 8 MB，每行程 24 MB 和 100 个文件；下载强制作为附件并禁用 MIME 嗅探。
- `.terra-trip` 包使用独立的 16+ 字符口令、scrypt、gzip 和 AES-256-GCM。导入在写入前验证完整附件清单，并分配新的行程和附件 ID。
- 收藏的 RSS/小米资源可以导入加密候选收件箱，无需复制完整源正文。导入是幂等的，机密候选为选择加入，候选不能进入隐私等级更低的行程。

## 资源上下文边界

- `Resource.context` 规范化项目、精确/仅日期时间、时区和结构化位置，同时保留 source/tags/privacy 作为一级字段。
- 搜索和列表 API 组合来源、标签、项目、位置、包含式日期范围、类型和隐私过滤器。
- 没有上下文的旧资源条目在读取时从现有元数据推导；所有新源写入都要求经过校验的上下文。
- 位置要求成对的、经过范围检查的坐标，每个资源最多 100 个。项目和日期范围有界并去重。

## RAG 边界

- 现有加密文档、本地 BM25/稀疏检索、提示注入隔离、编号引用和可选的外部回答生成仍然可用。
- 刷新小米笔记可以入队一次完整的增量源同步；创建/更新/删除/恢复操作入队定向变更。台账比较小米 `modifyDate`/标签值，只对新笔记或已变更笔记获取详情。缺失笔记的删除仅在完整成功的全量扫描之后运行。
- 小米来源的文档由来源管理：知识库中标题/正文/类型为只读，而隐私和用户标签仍可编辑。
- 阿里云 `text-embedding-v4` 默认 768 维、批次大小 10、超时 20 秒。设置还控制小米笔记默认隐私（默认 `private`）、自动全量同步，以及扫描失败后的一次有界自动重试。提供商调用有界、有重试、经过维度检查，且绝不在模块初始化期间运行。连接测试只发送固定的测试句子。
- 启用密集检索时，`public` 和 `private` 分块可以发送到阿里云生成文档/查询嵌入。`secret` 文档绝不外部嵌入，只能通过本地 BM25/稀疏检索搜索。高风险敏感查询也跳过外部查询嵌入。
- 本地 LanceDB 行仅包含向量、ID、哈希、隐私/风险标志和向量版本元数据；加密的笔记标题/正文保存在 `TERRA_RAG_FILE` 中。
- 当活动向量版本可用时，检索组合规范化本地相关性（45%）和密集相似度（55%）。缺少提供商凭证、LanceDB 缺失或不兼容、提供商错误或敏感查询路由会降级到现有本地检索路径，并在响应中说明原因。
- 模型/维度更改会创建待处理向量版本。重建仅在每个符合条件的文档都成功后切换活动命名空间；失败时保留之前的命名空间。
- 设置/凭证变更和向量重建端点仅限回环访问。API 密钥绝不会返回、存储在浏览器存储中或包含在 Terra 备份中。
- 密集存储需要原生 `@lancedb/lancedb` 依赖。如果缺失，服务器启动和 BM25 检索继续运行，状态会报告降级向量存储。