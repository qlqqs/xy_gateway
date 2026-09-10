# Docker 部署文档

本文档描述如何使用 Docker 部署 XY Gateway（星野网关）。

---

## 1. 拉取镜像

本项目推荐使用 GitHub Container Registry (ghcr.io) 提供的官方镜像：

```bash
docker pull ghcr.io/qlqqs/xy_gateway:latest
```

## 2. 启动容器

直接使用 `docker run` 启动服务：

```bash
docker run -d \
    --name xy_gateway \
    -p 8787:8787 \
    -v $(pwd)/data:/app/data \
    -e ROOT_TOKEN=your-secret-root-token \
    -e SECURE_LOGIN_ENTRY=fdsafhdvd \
    ghcr.io/qlqqs/xy_gateway:latest
```

> **注意**：`ROOT_TOKEN` 是系统最高权限 Token，请使用高熵随机值。API Key 回显加密密钥会在首次启动时自动生成并写入数据库，一般无需配置 `KEY_ENCRYPTION_SECRET`。若手动设置该环境变量，则始终以环境变量为准。从旧版本升级时，请先带着原来的 `KEY_ENCRYPTION_SECRET` 启动一次，服务会把它写入数据库，之后可以不再配置；直接丢掉旧值会导致已有 Key 无法回显。备份或迁移时请一并保留数据目录或数据库。

服务启动后，访问 `http://localhost:8787/fdsafhdvd` 即可打开登录页。

> `SECURE_LOGIN_ENTRY` 为可选的安全入口。配置后，只有该路径会返回管理前端；忘记入口时请检查启动命令或容器环境变量。未配置时访问根路径即可打开登录页。

### 数据持久化说明

服务使用单个挂载目录来持久化所有数据：

| 宿主机目录 | 容器目录 | 说明 |
|-----------|---------|------|
| `./data` | `/app/data` | 存放 SQLite 数据库文件和每日应用日志 |

日志文件会自动写入到宿主机的 `./data/log` 目录下，按日期命名（如 `app-2026-03-16.log`）。

---

## 3. 常用操作

```bash
# 实时查看系统运行日志
docker logs -f xy_gateway

# 停止服务容器
docker stop xy_gateway

# 重新启动服务容器
docker start xy_gateway

# 删除容器（不会删除 ./data 挂载目录下的数据）
docker rm -f xy_gateway
```

### 数据库维护工具 (进阶)

如果您需要直接在容器内执行数据库状态检查或升级等维护命令：

```bash
# 检查数据库状态
docker exec -it xy_gateway npx tsx script/db.ts status --env node

# 强制执行数据库表结构升级（通常容器启动时会自动执行，无需手动调用）
docker exec -it xy_gateway npm run db:migrate:node
```

---

## 相关文档

- **后端开发手册**：`../dev/BackendDevManual.md`
- **前端开发手册**：`../dev/FrontendDevManual.md`
- **LLM API 使用指南**：`../usage/LlmApiUsage.md`
