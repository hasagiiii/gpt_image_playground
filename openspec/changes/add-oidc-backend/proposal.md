# OIDC 后端架构提案

## Why

当前项目是一个纯前端的AI图像生成应用，缺乏用户身份认证和会话管理能力。为了实现强制登录、用户数据隔离以及为后续功能（如用户偏好、历史记录）奠定基础，需要添加OIDC后端支持。

## What Changes

- **新增Go后端服务**：基于gin框架的轻量级OIDC认证服务
- **通用OIDC支持**：支持标准OIDC协议，可配置多个第三方提供商
- **JWT Token认证**：使用JWT token进行用户认证和授权
- **强制登录机制**：所有功能要求用户登录后才能使用
- **用户信息存储**：在PostgreSQL中存储基本的OIDC用户信息
- **前端集成**：添加登录页面和认证状态管理

## Capabilities

### New Capabilities
- **oidc-authentication**: 支持通用OIDC提供商的身份认证流程
- **jwt-token-management**: JWT token的签发、验证和管理
- **user-session-management**: 用户会话状态和认证中间件
- **frontend-auth-integration**: 前端登录页面和认证状态集成

### Modified Capabilities
<!-- 当前项目没有现有能力需要修改 -->

## Impact

- **新增后端服务**：独立的Go后端应用，与前端分离部署
- **数据库变更**：新增PostgreSQL用户表
- **前端路由保护**：所有路由要求登录认证
- **部署架构**：nginx反向代理配置前端和后端
- **第三方依赖**：OIDC客户端库、JWT库、数据库驱动
- **配置管理**：OIDC提供商配置、数据库连接配置