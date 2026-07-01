## Why

当前部署形态是「nginx 前端镜像 + 独立 Go 后端」两个镜像，前端的运行时配置靠 nginx 容器启动时用 `sed` 改写 `assets/*.js` 里的占位符注入。这套依赖可写的静态文件目录与 nginx entrypoint 脚本，运维形态偏重，且前后端分离部署。目标是产出**单个 Go 二进制镜像**：用 `go:embed` 把前端产物打进后端，由 Go 统一对外服务，同时保留「部署时用环境变量决定前端配置」的能力。

## What Changes

- **BREAKING（部署形态）**：`docker.yml` 只产出一个合并镜像，用 embed 单二进制镜像**替换**现有 nginx 前端镜像。
- Go 后端新增前端资源服务能力：`go:embed` 嵌入 `dist/`，对非 API 路由做 SPA fallback 返回 `index.html`。
- 前端运行时配置改由 Go 注入：Go 在返回 `index.html` 时读环境变量，在 `<head>` 注入一行 `<script>window.__APP_CONFIG__ = {...}</script>`；前端改读 `window.__APP_CONFIG__`，缺失时**回退** `import.meta.env`（保证 `npm run dev` 与现有测试零改动）。
- 迁移的运行时配置项（原 nginx `sed` 注入的 6 项 + `VITE_AUTH_BACKEND_URL`）全部走 `window.__APP_CONFIG__`。
- 移除前端的 `sed` 占位符注入链路（`deploy/inject-api-url.sh` 及 Dockerfile 中的占位符 `ENV`）。
- 三阶段 Dockerfile：node 构建前端 → golang 编译（`-tags embed`，含 `dist/`）→ alpine 单二进制。
- **不做**：embed 形态不提供同源图片代理（原 `ENABLE_API_PROXY` 的 nginx 代理能力，`API_PROXY_AVAILABLE` 恒为 `false`）；本轮**不改**后端配置加载（仍外挂 `config.yaml` + 外部 PostgreSQL，不加 env 覆盖）。

## Capabilities

### New Capabilities
- `runtime-config-injection`: 运行时把部署环境变量下发到前端——Go 在 `index.html` 注入 `window.__APP_CONFIG__`，前端统一从中读取配置并在缺失时回退 `import.meta.env`。
- `embedded-frontend-serving`: Go 后端通过 `go:embed` 服务嵌入的前端静态资源，并对非 API 路由做 SPA fallback。

### Modified Capabilities
<!-- 无既有 spec 的需求变更 -->

## Impact

- **前端消费点**（7 个变量，均改为经统一读取入口取值）：
  - `src/lib/apiProfiles.ts`（`VITE_DEFAULT_API_URL` / `VITE_API_PROXY_AVAILABLE` / `VITE_DOCKER_DEPLOYMENT` / `VITE_SHOW_DEFAULT_CONFIG_ONLY`）
  - `src/lib/customProviderConfigUrl.ts`（`VITE_DEFAULT_API_URL`）
  - `src/lib/devProxy.ts`（`VITE_API_PROXY_AVAILABLE` / `VITE_API_PROXY_LOCKED`）
  - `src/hooks/useDockerApiUrlMigrationNotice.ts`（`VITE_DOCKER_DEPLOYMENT` / `VITE_DOCKER_LEGACY_API_URL_USED`）
  - `src/auth/api.ts`（`VITE_AUTH_BACKEND_URL`，含 `disabled`/空串语义）
  - `src/lib/runtimeEnv.ts`（新增统一读取入口 `getRuntimeConfig`）
  - `index.html`（无需静态占位；注入点由 Go 处理）
- **后端**：`backend/cmd/server/main.go`（挂载 `NoRoute` fallback），新增 `backend/internal/web/`（embed 双 build tag 文件 + handler）。
- **构建与 CI**：`deploy/Dockerfile`（三阶段重写）、`deploy/inject-api-url.sh`（删除）、`.github/workflows/docker.yml`（单镜像）、`.gitignore`（忽略 `backend/internal/web/dist/`）。
- **依赖**：无新增前端依赖；后端使用标准库 `embed`。
