# 人防工程管理平台 - 后端 API

一个纯后端的 REST API 服务，用于管理人民防空工程的档案、设备设施、检查维护记录，含登录鉴权与基于角色的权限控制。
本项目作为「功能迭代」类评测题目的基础工程：Node + Express + MySQL，docker compose 一键编排，结构清晰、留有充分扩展点。

## 技术栈

- Node.js (≥ 18) + Express 4
- 数据库：MySQL 8（`mysql2/promise` 连接池）
- 认证：JWT（`jsonwebtoken`）+ scrypt 密码哈希（Node 内置 crypto，无原生依赖）
- 编排：Docker Compose
- 测试：Node 内置 `node:test` + `supertest`

## 快速开始

### docker compose（推荐）

```bash
docker compose up --build
```

- API 暴露在 `http://localhost:5070`
- MySQL 暴露在宿主机 `13346` 端口
- 首次启动 `db/init.sql` 建表，应用检测到空库会自动写入种子数据

### 本地运行

```bash
export DB_HOST=127.0.0.1 DB_PORT=13346 DB_USER=cd DB_PASSWORD=cdpass DB_NAME=civildefense
npm install
npm run seed
npm start
```

### 测试

```bash
npm test
```

测试连接真实 MySQL（默认 `127.0.0.1:13346`），每个用例前重置种子数据。

## 种子账号

| 用户名 | 密码 | 角色 | 说明 |
| --- | --- | --- | --- |
| admin | admin123 | ADMIN | 系统管理员，全部权限（含删除工程、管用户） |
| manager | manager123 | MANAGER | 工程管理员，可建/改工程、加设备、登记检查 |
| inspector | inspect123 | INSPECTOR | 巡检员，可查询、登记检查记录 |

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5070` | API 监听端口 |
| `DB_HOST` | `127.0.0.1` | MySQL 主机 |
| `DB_PORT` | `13346` | MySQL 端口 |
| `DB_USER` | `cd` | MySQL 用户 |
| `DB_PASSWORD` | `cdpass` | MySQL 密码 |
| `DB_NAME` | `civildefense` | 数据库名 |
| `JWT_SECRET` | `civil-defense-dev-secret` | JWT 签名密钥 |
| `SEED_ON_START` | - | 设为 `false` 可禁用空库自动播种 |

## 数据模型

- **users 用户**：`id, username(唯一), password_hash, name, role(ADMIN/MANAGER/INSPECTOR), department, status`
- **projects 人防工程**：`id, code(唯一), name, type, protection_level(防护等级), area_sqm, address, district, peacetime_use(平时用途), status(NORMAL/MAINTENANCE/DECOMMISSIONED), completed_at`
- **equipments 设备设施**：`id, project_id(FK), name, category(防护门/通风/给排水/电力…), model, install_date, status`
- **inspections 检查记录**：`id, project_id(FK), inspector_id(FK), inspect_date, type(ROUTINE/SPECIAL/ANNUAL), result(PASS/FAIL), issues`

## API 一览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公开 | 健康检查 |
| POST | `/api/auth/login` | 公开 | 登录，返回 JWT |
| GET | `/api/auth/me` | 登录 | 当前用户信息 |
| GET | `/api/projects` | 登录 | 工程列表（`status`/`district`/`keyword` 筛选） |
| GET | `/api/projects/:id` | 登录 | 工程详情 |
| POST | `/api/projects` | ADMIN/MANAGER | 新建工程 |
| PUT | `/api/projects/:id` | ADMIN/MANAGER | 更新工程 |
| DELETE | `/api/projects/:id` | ADMIN | 删除工程 |
| GET | `/api/projects/:id/equipments` | 登录 | 工程的设备列表 |
| POST | `/api/projects/:id/equipments` | ADMIN/MANAGER | 新增设备 |
| GET | `/api/inspections` | 登录 | 检查记录（`projectId` 筛选） |
| POST | `/api/inspections` | ADMIN/MANAGER/INSPECTOR | 登记检查记录 |

## 响应约定

- 成功：`{ "data": ... }`，列表附带 `total`
- 失败：`{ "error": { "message": "..." } }`，配合 HTTP 状态码（400/401/403/404/409/500）

## 认证方式

登录拿到 token 后，后续请求在请求头带 `Authorization: Bearer <token>`。
