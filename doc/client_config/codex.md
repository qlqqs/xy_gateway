# Codex 客户端配置写入逻辑

## 配置文件位置

默认目录：`~/.codex/`（可通过 `CODEX_HOME` 环境变量覆盖）

| 文件 | 路径 | 格式 | 用途 |
|------|------|------|------|
| config.toml | `~/.codex/config.toml` | TOML | provider 路由、endpoint、模型、bearer token |
| auth.json | `~/.codex/auth.json` | JSON | OpenAI 登录凭证（OAuth tokens / API key） |

## 使用官方配置（OFFICIAL 模式）

### 从哪些文件哪些字段生成备份

**config.toml**：
- `model`：使用的模型
- `model_reasoning_effort`：推理努力程度
- `model_provider`：provider ID（固定为 `openai`）

**auth.json**：
- `tokens.access_token`：访问令牌
- `tokens.refresh_token`：刷新令牌
- `tokens.id_token`：身份令牌（必需）
- `auth_mode`：认证模式

### 恢复的时候，写入到哪些文件哪些字段

**config.toml**：
- `model_provider = "openai"`（固定值）
- `model`：使用的模型
- 删除 `model_providers.openai` 和 `model_providers.gt_ai_gateway` 表
- 删除根级别的 `base_url`、`wire_api`、`experimental_bearer_token`

**auth.json**（有 apiKey 时）：
- 保留原始的 `tokens` 对象（包括 `access_token`、`refresh_token`、`id_token`）
- 只更新 `access_token` 字段
- 删除 `OPENAI_API_KEY` 字段

**auth.json**（无 apiKey，即清空为未登录状态）：
- 删除 auth.json 文件（等同于 `codex logout` 的行为）
- 不写入任何内容，`writeConfig` 会自动删除未包含的配置文件

```
正确做法：保留原始 tokens
authObj.tokens = {
    ...existingTokens,
    access_token: apiKey,  // 只更新 access_token
};

错误做法：覆盖整个 tokens 对象
authObj.tokens = { access_token: apiKey };  // 会丢失 id_token, refresh_token
```

**原因**：Codex 期望 auth.json 中的 `tokens` 对象包含 `id_token` 字段。如果只写入 `access_token`，Codex 会报错：`missing field 'id_token'`

## 使用供应商/网关（GATEWAY/VENDOR 模式）

### 从哪些文件读取哪些字段，来生成备份

**config.toml**：
- 新版格式（有 `model_provider`）：
  - `[model_providers.<id>].base_url`：endpoint URL
  - `[model_providers.<id>].experimental_bearer_token`：API key
  - `model`：使用的模型
- 旧版格式（无 `model_provider`）：
  - `base_url`：endpoint URL（根级别）
  - `experimental_bearer_token`：API key（根级别）
  - `model`：使用的模型

**auth.json**：
- `OPENAI_API_KEY`：API key（如果有）
- `tokens.access_token`：访问令牌（如果有）

**Token 提取优先级**：
```
auth.OPENAI_API_KEY > config.toml experimental_bearer_token
```

### 恢复的时候，写哪些文件哪些字段

**config.toml**（根据当前格式选择写入方式）：

**新版格式**（有 `model_provider`）：
- `model_provider = "gt_ai_gateway"`
- `model`：使用的模型
- `[model_providers.gt_ai_gateway]` 表：
  - `name = "XY Gateway"`
  - `base_url`：endpoint URL
  - `wire_api = "responses"`
  - `experimental_bearer_token`：API key
- 删除 `model_providers.openai` 表
- 删除根级别的 `base_url`、`wire_api`、`experimental_bearer_token`

**旧版格式**（无 `model_provider`）：
- `model`：使用的模型
- `base_url`：endpoint URL（根级别）
- `wire_api = "responses"`（根级别）
- `experimental_bearer_token`：API key（根级别）

**auth.json**（默认行为，`preserve_codex_official_auth_on_switch == false`）：
- 写入 `{"OPENAI_API_KEY": "sk-xxx"}`

**auth.json**（保留官方登录，`preserve_codex_official_auth_on_switch == true`）：
- 不修改（保留 ChatGPT 登录缓存）

## 新版 vs 旧版配置格式

Codex 存在两种配置格式，通过 `model_provider` 字段区分：

| 格式 | 特征 | 写入方式 |
|------|------|----------|
| 新版 | 有 `model_provider` 字段 | 写入 `[model_providers.<id>]` 表 |
| 旧版 | 没有 `model_provider` 字段 | 写入根级别字段 |

### 判断逻辑

```
有 model_provider？
├── 是 → 新版格式 → 写入 [model_providers.<id>] 表
└── 否 → 旧版格式 → 写入根级别
```

### 格式升级时的残留问题

当从旧版升级到新版（添加 `model_provider`）时：

1. **旧版残留**：根级别的 `base_url`、`wire_api`、`experimental_bearer_token` 不会被自动删除
2. **新版写入**：新值会写入 `[model_providers.<id>]` 表
3. **结果**：配置中同时存在根级别和表级别的同名字段，导致混乱

**示例（有问题的配置）**：
```toml
model_provider = "gt_ai_gateway"

# 旧版残留（应该删除）
base_url = "http://127.0.0.1:8720/llm/v1"
wire_api = "responses"
experimental_bearer_token = "old-token"

# 新版配置
[model_providers.gt_ai_gateway]
name = "XY Gateway"
base_url = "http://127.0.0.1:8720/llm/v1"
wire_api = "responses"
experimental_bearer_token = "new-token"
```

### 解决方案

在写入配置时，应该：
1. 如果有 `model_provider`，删除根级别的 `base_url`、`wire_api`、`experimental_bearer_token`
2. 只保留 `[model_providers.<id>]` 表中的配置

## 关键配置项

| 设置 | 默认值 | 作用 |
|------|--------|------|
| `preserve_codex_official_auth_on_switch` | `false` | 切换到第三方时是否保留官方 auth.json |
| `unify_codex_session_history` | `false` | 官方和第三方是否共用同一个会话历史桶 |

## 保留的 Provider ID

以下 provider ID 是 Codex 保留的，不能用于自定义 provider：

- `openai`
- `ollama`
- `amazon-bedrock`
- `lmstudio`
- `oss`
- `ollama-chat`

如果 config.toml 中有 `[model_providers.<保留ID>]` 表，Codex 会报错：
```
Error loading config.toml: model_providers contains reserved built-in provider IDs: 'openai'.
Built-in providers cannot be overridden.
```
