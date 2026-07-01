# OIDC 后端架构设计

## Context

当前项目是一个纯前端的AI图像生成应用，直接调用第三方API（OpenAI、fal.ai等）。用户通过API Key进行认证，缺乏统一的用户身份管理系统。为实现强制登录、用户数据隔离和后续功能扩展，需要添加独立的OIDC后端服务。

## Goals / Non-Goals

**Goals:**
- 支持通用OIDC提供商的标准认证流程
- 实现JWT token的签发、验证和管理
- 提供强制登录机制，所有功能要求认证
- 存储基本的OIDC用户信息
- 与现有前端应用无缝集成
- 支持配置多个第三方OIDC提供商

**Non-Goals:**
- 不实现自定义用户注册/密码管理
- 不处理复杂的权限系统（RBAC等）
- 不存储用户敏感信息（密码等）
- 不实现多租户架构

## Decisions

### 1. 后端技术栈：Go + gin
- **选择理由**：高性能、轻量级、良好的并发支持
- **替代方案**：Node.js + Express（性能稍差）、Python + FastAPI（生态相对复杂）
- **关键依赖**：
  - `golang.org/x/oauth2` - OIDC客户端
  - `github.com/gin-gonic/gin` - Web框架
  - `github.com/golang-jwt/jwt/v4` - JWT处理
  - `github.com/lib/pq` - PostgreSQL驱动

### 2. 认证策略：JWT Token
- **选择理由**：无状态、易于扩展、前端友好
- **替代方案**：Session + Cookie（需要状态管理、CORS复杂）
- **实现细节**：
  - Token有效期：24小时
  - 刷新机制：支持token刷新
  - 签名算法：HS256

### 3. 数据库设计：PostgreSQL
- **选择理由**：关系型、事务支持、成熟稳定
- **替代方案**：MongoDB（文档型，但关系查询复杂）
- **表结构**：
  ```sql
  CREATE TABLE users (
      id UUID PRIMARY KEY,
      oidc_sub TEXT UNIQUE NOT NULL,
      oidc_provider TEXT NOT NULL,
      email TEXT,
      name TEXT,
      picture_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
  );
  ```

### 4. 部署架构：同域名部署
- **选择理由**：避免CORS问题、简化配置
- **替代方案**：跨域部署（需要复杂的CORS配置）
- **nginx配置**：
  ```nginx
  location /api/ { proxy_pass http://backend:8080/; }
  location /auth/ { proxy_pass http://backend:8080/auth/; }
  ```

### 5. OIDC流程：Authorization Code + PKCE
- **选择理由**：安全性最高、OAuth 2.1推荐
- **替代方案**：Implicit Flow（已废弃）、Hybrid Flow（复杂）
- **流程**：前端重定向 → 第三方认证 → 回调后端 → 交换token → 签发JWT

## Risks / Trade-offs

### 风险与缓解措施
- **[风险]** 第三方OIDC服务商宕机 → **[缓解]** 支持多个提供商，提供备用方案
- **[风险]** JWT token泄露 → **[缓解]** 短有效期、HTTPS强制、刷新机制
- **[风险]** 数据库连接问题 → **[缓解]** 连接池、重试机制、监控告警
- **[风险]** 前端路由保护失效 → **[缓解]** 后端双重验证、错误处理

### 权衡考虑
- **复杂度 vs 功能**：选择通用OIDC而非自定义认证，降低开发复杂度
- **性能 vs 安全性**：JWT无状态提升性能，但需要妥善处理token安全
- **灵活性 vs 标准化**：支持通用OIDC协议，确保与各种提供商兼容