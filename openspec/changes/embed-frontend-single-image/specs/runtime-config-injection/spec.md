## ADDED Requirements

### Requirement: 后端在 index.html 注入运行时配置

系统 SHALL 在返回 `index.html` 时读取部署环境变量，并在文档中注入一段内联脚本，声明全局对象 `window.__APP_CONFIG__`，其字段包含从环境变量派生的运行时配置。注入的脚本 MUST 位于前端应用入口 module 脚本执行之前。

注入的配置字段 SHALL 至少包含：`DEFAULT_API_URL`、`API_PROXY_AVAILABLE`、`API_PROXY_LOCKED`、`DOCKER_DEPLOYMENT`、`DOCKER_LEGACY_API_URL_USED`、`SHOW_DEFAULT_CONFIG_ONLY`、`AUTH_BACKEND_URL`。

在 embed 形态下，`API_PROXY_AVAILABLE` 与 `API_PROXY_LOCKED` SHALL 恒为 `false`。

#### Scenario: 设置了环境变量时下发对应值
- **WHEN** 容器以 `DEFAULT_API_URL=https://example.com/v1`、`SHOW_DEFAULT_CONFIG_ONLY=true` 启动，浏览器请求页面
- **THEN** 返回的 `index.html` 含内联脚本，`window.__APP_CONFIG__.DEFAULT_API_URL` 为 `"https://example.com/v1"`，`window.__APP_CONFIG__.SHOW_DEFAULT_CONFIG_ONLY` 为 `true`

#### Scenario: 代理相关字段恒为 false
- **WHEN** 容器以任意 `ENABLE_API_PROXY` / `LOCK_API_PROXY` 值启动，浏览器请求页面
- **THEN** `window.__APP_CONFIG__.API_PROXY_AVAILABLE` 与 `window.__APP_CONFIG__.API_PROXY_LOCKED` 均为 `false`

#### Scenario: 注入脚本先于应用入口执行
- **WHEN** 浏览器解析返回的 `index.html`
- **THEN** `window.__APP_CONFIG__` 赋值脚本在前端入口 module 脚本之前，前端在模块加载期读取时能取到已注入的值

### Requirement: 前端通过统一入口读取运行时配置并回退 import.meta.env

系统 SHALL 提供统一读取入口 `getRuntimeConfig(key)`：优先读取 `window.__APP_CONFIG__[key]`，当其缺失（`undefined`）时回退到 `import.meta.env['VITE_' + key]`。所有运行时配置消费点 MUST 经由该入口取值，不再直接读取 `import.meta.env.VITE_*`。

对于 `AUTH_BACKEND_URL`，读取路径 MUST 保留其三态语义：`undefined`（未配置）、`'disabled'`（禁用认证）、其余非空字符串（启用），不得将 `undefined` 归一为空串。

#### Scenario: 运行时注入优先
- **WHEN** `window.__APP_CONFIG__.DEFAULT_API_URL` 存在
- **THEN** `getRuntimeConfig('DEFAULT_API_URL')` 返回该注入值，而非 `import.meta.env` 的值

#### Scenario: 缺失时回退 import.meta.env（dev/测试）
- **WHEN** `window.__APP_CONFIG__` 未定义或不含目标 key（如本地 `npm run dev` 或单元测试）
- **THEN** `getRuntimeConfig(key)` 回退返回 `import.meta.env['VITE_' + key]`，现有 `vi.stubEnv` 测试行为不变

#### Scenario: AUTH_BACKEND_URL 未配置时禁用认证
- **WHEN** `window.__APP_CONFIG__.AUTH_BACKEND_URL` 为 `undefined` 且 `import.meta.env.VITE_AUTH_BACKEND_URL` 也为 `undefined`
- **THEN** `isAuthEnabled()` 返回 `false`（不将其误判为同源启用）

#### Scenario: AUTH_BACKEND_URL 为 disabled 时禁用认证
- **WHEN** 注入的 `AUTH_BACKEND_URL` 为 `"disabled"`
- **THEN** `isAuthEnabled()` 返回 `false`
