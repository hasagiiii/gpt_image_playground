/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __DEV_PROXY_CONFIG__: unknown

interface ImportMetaEnv {
  readonly VITE_DEFAULT_API_URL?: string
  readonly VITE_API_PROXY_AVAILABLE?: string
  readonly VITE_API_PROXY_LOCKED?: string
  readonly VITE_DOCKER_DEPLOYMENT?: string
  readonly VITE_DOCKER_LEGACY_API_URL_USED?: string
  readonly VITE_SHOW_DEFAULT_CONFIG_ONLY?: string
  /** OIDC 后端基础地址，例如 https://app.example.com 或同源时填 ""。
   *  设为 "disabled" 时完全跳过登录（兼容纯静态部署）。 */
  readonly VITE_AUTH_BACKEND_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
