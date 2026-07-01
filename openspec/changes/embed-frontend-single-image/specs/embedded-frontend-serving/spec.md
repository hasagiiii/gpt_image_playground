## ADDED Requirements

### Requirement: Go 后端通过 go:embed 服务前端资源

系统 SHALL 支持将前端构建产物（`dist/`）通过 `go:embed` 嵌入 Go 二进制，并由后端对外服务这些静态资源。嵌入行为 MUST 由 build tag `embed` 控制：带 `-tags embed` 构建时嵌入真实 `dist/`；不带该 tag 时使用空文件系统，使本地 `go run`（无前端产物）仍可编译运行。

#### Scenario: 带 embed tag 构建服务静态资源
- **WHEN** 以 `go build -tags embed` 构建（`dist/` 已拷入 `backend/internal/web/dist/`），请求 `/assets/<hashed>.js`
- **THEN** 后端从嵌入文件系统返回对应资源，状态码 200

#### Scenario: 不带 tag 本地运行可编译
- **WHEN** 以 `go run`（不带 `-tags embed`）启动后端
- **THEN** 程序正常编译启动，前端资源使用空文件系统，不因缺少 `dist/` 而编译失败

### Requirement: 非 API 路由的 SPA fallback

系统 SHALL 对未匹配到既有 API 路由（`/health`、`/auth/*`、`/api/v1/*`）的请求做 SPA fallback：静态资源路径返回对应嵌入文件，其余路径返回注入了运行时配置的 `index.html`。fallback MUST 挂载于所有 API 路由注册之后（`r.NoRoute`），不得拦截既有 API 路由。

#### Scenario: 前端路由回退 index.html
- **WHEN** 请求一个非 API、非静态资源的路径（如 `/settings`）
- **THEN** 后端返回注入了 `window.__APP_CONFIG__` 的 `index.html`，`Cache-Control: no-cache`

#### Scenario: API 路由不被 fallback 拦截
- **WHEN** 请求 `/health`、`/auth/*` 或 `/api/v1/*`
- **THEN** 请求由既有对应 handler 处理，不落入 SPA fallback

#### Scenario: 静态资源带缓存返回
- **WHEN** 请求 `/assets/*` 下的哈希命名资源
- **THEN** 后端从嵌入文件系统返回该资源并附带长期缓存头
