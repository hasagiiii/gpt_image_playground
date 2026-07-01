## Unreleased

### 破坏性变更
- **Docker 改为单镜像形态**：Go 后端内嵌前端静态产物并在返回 `index.html` 时注入运行时配置（`window.__APP_CONFIG__`），不再使用 Nginx + 构建期 `VITE_*` 注入。容器默认监听 `8080`，运行时需外挂 `config.yaml` 并连接外部 PostgreSQL（启动自动迁移）。
- **移除容器内置同源代理**：`ENABLE_API_PROXY` / `LOCK_API_PROXY` / `API_PROXY_URL` / `API_URL` 等 Nginx 代理相关变量不再支持，`API_PROXY_AVAILABLE` / `API_PROXY_LOCKED` 恒为 `false`。运行时前端配置改由 `DEFAULT_API_URL` / `SHOW_DEFAULT_CONFIG_ONLY` / `AUTH_BACKEND_URL` 等环境变量注入。

## v0.6.10（2026-06-19）

### 修复
- **修复自定义服务商无法拖拽排序的问题**：当服务商列表已有手动排序记录后，再新增或导入自定义服务商时，新增服务商会被正确补入排序记录末尾，避免因排序状态缺失导致无法拖动调整顺序。
