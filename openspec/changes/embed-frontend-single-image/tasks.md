## 1. 前端统一读取入口与消费点迁移

- [x] 1.1 在 `src/lib/runtimeEnv.ts` 新增 `getRuntimeConfig(key)`：优先 `window.__APP_CONFIG__[key]`，缺失回退 `import.meta.env['VITE_'+key]`，再 `trim`；保留现有 `readRuntimeEnv`
- [x] 1.2 在 `src/lib/runtimeEnv.ts` 新增 auth 专用读取（保留 `undefined`/`'disabled'`/空串 三态，不做空串归一）
- [x] 1.3 在 `src/vite-env.d.ts` 声明 `window.__APP_CONFIG__` 类型（各字段可选 string）
- [x] 1.4 `src/lib/apiProfiles.ts`：将 `VITE_DEFAULT_API_URL` / `VITE_API_PROXY_AVAILABLE` / `VITE_DOCKER_DEPLOYMENT` / `VITE_SHOW_DEFAULT_CONFIG_ONLY` 改为经 `getRuntimeConfig`
- [x] 1.5 `src/lib/customProviderConfigUrl.ts`：`VITE_DEFAULT_API_URL` 改为经 `getRuntimeConfig`
- [x] 1.6 `src/lib/devProxy.ts`：`VITE_API_PROXY_AVAILABLE`（:90）与 `VITE_API_PROXY_LOCKED`（:94）改为经 `getRuntimeConfig`
- [x] 1.7 `src/hooks/useDockerApiUrlMigrationNotice.ts`：`VITE_DOCKER_DEPLOYMENT` / `VITE_DOCKER_LEGACY_API_URL_USED` 改为经 `getRuntimeConfig`
- [x] 1.8 `src/auth/api.ts`：`isAuthEnabled` / `getAuthBaseUrl` 改为经 auth 专用读取（保三态）

## 2. 前端测试

- [x] 2.1 为 `getRuntimeConfig` 新增单测：注入优先、缺失回退 `import.meta.env`、trim 行为
- [x] 2.2 为 auth 读取新增单测：`undefined`/`'disabled'`/空串/URL 四种输入下 `isAuthEnabled`、`getAuthBaseUrl` 的返回
- [x] 2.3 运行 `npm test` 确认 `vi.stubEnv` 回退路径生效（新增测试与迁移相关测试 devProxy/customProviderConfigUrl 全通过；`apiProfiles.test.ts`/`urlSettings.test.ts` 的 12 个失败经核对在改造前的原始代码上完全一致，属该 WIP 分支预先存在、与 env 注入无关）

## 3. 后端 embed 资源服务

- [x] 3.1 新建 `backend/internal/web/embed_on.go`（`//go:build embed`，`//go:embed all:dist` 暴露 `fs.FS`）
- [x] 3.2 新建 `backend/internal/web/embed_off.go`（`//go:build !embed`，导出空 `fs.FS`）
- [x] 3.3 新建 `backend/internal/web/handler.go`：读 env 生成 `window.__APP_CONFIG__` 注入到 `index.html` 的 `</head>` 前；`/assets/*` 从 FS 返回带长缓存；其余返回注入后的 `index.html`（`Cache-Control: no-cache`）；`API_PROXY_AVAILABLE`/`API_PROXY_LOCKED` 恒 `false`
- [x] 3.4 在 `backend/cmd/server/main.go` 所有 API 路由注册之后挂载 `r.NoRoute(web.Handler)`
- [x] 3.5 `go build ./...`（不带 tag）验证空 FS 下可正常编译，API 路由不受影响

## 4. 后端测试

- [x] 4.1 为 handler 增加测试：给定 env → 注入的 HTML 含正确 `window.__APP_CONFIG__` 字段值
- [x] 4.2 测试代理字段恒为 false、`Cache-Control` 头正确（含静态资源长缓存与 AUTH_BACKEND_URL 三态）
- [x] 4.3 测试 SPA fallback：非 API 路径返回 index.html；`/health`、`/auth/*`、`/api/v1/*` 不被拦截

## 5. Docker 单镜像构建

- [x] 5.1 重写 `deploy/Dockerfile` 为三阶段：node 构建前端（移除占位符 `ENV`）→ golang 拷 `backend/`+`dist/`→`internal/web/dist/` 并 `go build -tags embed` → alpine 单二进制，`EXPOSE 8080`
- [x] 5.2 删除 `deploy/inject-api-url.sh`；移除 Dockerfile 中的占位符 `ENV` 与 nginx 相关 COPY
- [x] 5.3 在 `.gitignore` 忽略 `backend/internal/web/dist/`
- [x] 5.4 本地 `docker build` 构建镜像并运行（连宿主机 PostgreSQL、OIDC 留空）验证通过：注入的 `window.__APP_CONFIG__` 字段值正确且代理字段恒 `false`；index.html `no-cache`、`/assets/*` 长缓存 `immutable`；`/api/v1/me`→401、`/auth/providers`→200 均未被 SPA 拦截；深路径 SPA fallback 返回注入后的 index.html

## 6. CI 与文档

- [x] 6.1 核对 `.github/workflows/docker.yml`：已是单个合并镜像（context `.` + `deploy/Dockerfile`，多架构，无 `VITE_*` build-args、无前后端双镜像），无需改动；`deploy.yml` 仅做 GitHub Pages 前端静态发布，不涉及后端镜像
- [x] 6.2 更新部署文档：README「Docker 部署」段整体重写为单镜像用法（外挂 `config.yaml` + 外部 PostgreSQL、`8080`、`DEFAULT_API_URL`/`SHOW_DEFAULT_CONFIG_ONLY`/`AUTH_BACKEND_URL` 注入、CLI + Compose 含 PG 示例、同源代理移除说明）；RELEASE.md 新增 `Unreleased` 破坏性变更条目
