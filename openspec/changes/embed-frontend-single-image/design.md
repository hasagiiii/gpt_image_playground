## Context

现状：前端编译产物中，运行时配置以占位符字符串形式 bake 进 `assets/*.js`（如 `__VITE_DEFAULT_API_URL_PLACEHOLDER__`），由 nginx 镜像的 `deploy/inject-api-url.sh` 在容器启动时 `sed` 替换为真实 env 值。后端是独立的 Go/gin 服务（`backend/`），路由已有 `/health`、`/auth/*`、`/api/v1/*`，配置从 `config.yaml` 加载（`config.LoadConfig`），强依赖 PostgreSQL、JWT、OIDC。

约束：
- `go:embed` 只能嵌入模块目录内的文件，`dist/` 在仓库根，需在构建时拷进 `backend/internal/web/dist/`。
- `src/lib/apiProfiles.ts` 与 `src/lib/customProviderConfigUrl.ts` 在**模块加载期（top-level const）**读取配置，故配置注入必须早于 app bundle 执行。
- `index.html` 入口是 `<script type="module">`（天然 defer），只要注入的内联 `<script>` 位于 `<head>` 或 body 中该 module 之前，就先执行——顺序天然成立。
- `npm run dev` 与现有 `vi.stubEnv` 测试依赖 `import.meta.env`，须保留兼容。

## Goals / Non-Goals

**Goals:**
- 产出单个 Go 二进制镜像，用 `go:embed` 服务前端，替换 nginx 前端镜像。
- 保留「部署时用环境变量决定前端配置」的能力，改由 Go 注入 `window.__APP_CONFIG__`。
- `npm run dev` 与现有测试零改动（保留 `import.meta.env` 回退）。
- 本地 `go run`（无前端产物）仍可编译运行。

**Non-Goals:**
- 不提供同源图片代理（`API_PROXY_AVAILABLE` 恒 `false`）。
- 不改后端配置加载逻辑（仍外挂 `config.yaml` + 外部 PostgreSQL，不加 env 覆盖）。
- 不改动业务功能、认证流程本身。

## Decisions

### 决策 1：运行时配置注入方式——注入 `index.html`，不用独立 `/config.js`
Go 在返回 `index.html` 时读 env，在 `</head>` 前插入一行内联 `<script>window.__APP_CONFIG__ = {...}</script>`。
- **为何**：比独立 `/config.js` 少一个文件与一次请求；配置随 HTML 原子下发，天然早于 module 执行。
- **备选**：独立动态 `/config.js`（被否，多一跳请求）；nginx `sed`（被否，embed 只读文件无法改写）。

### 决策 2：前端统一读取入口 `getRuntimeConfig(key)`，保留 `import.meta.env` 回退
在 `src/lib/runtimeEnv.ts` 新增 `getRuntimeConfig(key)`：先读 `window.__APP_CONFIG__[key]`，缺失回退 `import.meta.env['VITE_'+key]`，再 `trim`。所有消费点从 `readRuntimeEnv(import.meta.env.VITE_X)` 改为 `getRuntimeConfig('X')`。
- **为何**：单一收敛点，改动小；回退保证 dev 与测试零改动。
- **备选**：完全切到 `window.__APP_CONFIG__`（被否，dev 需加桩、测试要改 stub 方式）。
- **注意**：`VITE_AUTH_BACKEND_URL` 有三态语义（`undefined`→禁用、`'disabled'`→禁用、其余→启用），迁移时须保持 `undefined` 与空串的区分，读取入口对 auth 键需返回原始值（含 `undefined`），不能一律 `trim` 成空串——`auth/api.ts` 单独走一个不做空串归一的读取路径。

### 决策 3：embed 双 build tag 文件
`backend/internal/web/embed_on.go`（`//go:build embed`，`//go:embed all:dist`）与 `embed_off.go`（`//go:build !embed`，空 `fs.FS`）。Docker 构建用 `-tags embed`；本地 `go run` 不带 tag，用空 FS，不依赖前端产物。
- **为何**：本地后端开发无需先 `npm run build`；CI 镜像才嵌入。
- **备选**：始终 embed（被否，本地开发被迫构建前端）。

### 决策 4：SPA fallback 挂 `r.NoRoute`
在 `main.go` 所有 API 路由注册之后调用 `r.NoRoute(web.Handler)`。Handler 逻辑：`/assets/*` 等静态资源直接从 embed FS 返回并带长缓存；其余未匹配路径返回注入后的 `index.html`（`Cache-Control: no-cache`）。`/health`、`/auth/`、`/api/v1/` 已由既有路由占用，不会落到 NoRoute。
- **为何**：`NoRoute` 天然只接管未匹配路由，无需手写前缀排除逻辑。

### 决策 5：三阶段 Dockerfile 替换 nginx 版
stage1 `node:20` 构建前端 `dist/`（**不再注入占位符 env**）；stage2 `golang` 拷 `backend/` + `dist/`→`internal/web/dist/`，`go build -tags embed`；stage3 `alpine` 单二进制，`EXPOSE 8080`，外挂 `config.yaml`。`docker.yml` 仍指向 `deploy/Dockerfile`，仅产出一个镜像。

## Risks / Trade-offs

- **[top-level const 读取时机]** 若注入脚本晚于 app module 执行，配置会读到回退空值 → 缓解：内联 `<script>` 置于 `index.html` 的 module 引用之前，Go 注入时保证插入位置在 `</head>` 前。
- **[`VITE_AUTH_BACKEND_URL` 三态语义丢失]** 统一读取入口若把 `undefined` 归一为 `''`，会把「禁用认证」误判为「同源启用」→ 缓解：auth 键保留原始值路径（决策 2 注明），并补测试覆盖三态。
- **[`go:embed` 路径约束]** `dist/` 不在后端模块内，直接 build 会失败 → 缓解：Docker 构建拷贝到 `backend/internal/web/dist/`，并在 `.gitignore` 忽略该目录避免误提交。
- **[代理能力移除]** 原 `ENABLE_API_PROXY` 同源图片代理在 embed 形态不再提供 → 已在提案 q3 明确接受；`API_PROXY_AVAILABLE`/`API_PROXY_LOCKED` 恒 `false`，需用户直连或另用 nginx。
- **[单二进制并非自包含]** 仍需外挂 `config.yaml` + 外部 PostgreSQL → 本轮明确不改配置加载，作为独立后续变更。

## Migration Plan

1. 前端读取入口改造 + 消费点替换（保留回退，dev/测试不受影响）。
2. 后端 embed + handler + `NoRoute` 挂载；本地 `go run`（空 FS）验证编译。
3. 重写 Dockerfile 三阶段并本地构建镜像验证：注入正确、SPA 路由可用、API 正常。
4. 更新 `docker.yml` 单镜像；删除 `inject-api-url.sh` 与占位符 env。
5. 回滚策略：保留旧 nginx Dockerfile 于 git 历史；如需回退，恢复 `docker.yml` 指向旧构建即可（前端读取入口的回退设计不影响 nginx sed 形态——占位符路径已删除，故回退需一并 revert 前端 commit）。

## Open Questions

- 无（d1/d2/d3 已敲定：保留回退、`VITE_AUTH_BACKEND_URL` 一并注入、后端配置边界接受现状）。
