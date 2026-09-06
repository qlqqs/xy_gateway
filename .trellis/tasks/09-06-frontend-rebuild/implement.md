# 前端重构执行清单

## 变更边界

- 只编辑 `frontend/` 和本任务的 `.trellis/tasks/09-06-frontend-rebuild/` 产物。
- 不编辑 `src/`、`resource/`、后端测试、数据库、部署文件或 `frontend/public/data_viewer` 子项目源码。
- 保留工作区已有的 `AGENTS.md` 修改，不将其与本任务混淆。

## 执行顺序

1. 建立前端领域类型和统一列表结果，拆分实体、表单草稿和 DTO；先搜索所有旧字段引用再删除旧字段。
2. 建立 mock repository 和资源 store，迁移用户/分组数据；加入持久化、加载/错误/空状态和原子写入。
3. 迁移用户和分组页面及对话框，跑通 Key 生命周期、分组关联、删除引用和刷新行为。
4. 迁移供应商和模型页面到统一状态/类型边界，修复分组、调度、可用模型和 billing mode 的字段往返。
5. 统一仪表盘、余额、记录页面的资源读取方式，消除同一资源的本地副本；补齐缺失路由或移除不可达组件。
6. 依据 import/route 结果删除确认无用的旧 store、API、组件和资源；不做无证据的批量删除，也不为旧调用方保留迁移别名。
7. 收紧 ESLint 作用域和新增代码类型，修复本次改动触及的源代码错误，不修改生成 viewer 文件。
8. 为 repository、类型转换和关键 store action 添加最小 Vitest；最后由检查阶段审阅完整 diff。

## 验证命令

```bash
cd frontend && npm run test:run
cd frontend && npx vue-tsc -b
cd frontend && npx eslint src
cd frontend && npm run build
```

优先运行受影响模块的测试；只有在最后检查阶段运行一次前端构建。禁止运行后端测试作为本任务的验收条件。

## 风险点与回退

- 字段迁移若导致模板类型错误，修正当前领域契约和调用方，不恢复旧字段 adapter，也不在组件内增加强制类型断言。
- mock 状态迁移若破坏现有演示数据，使用版本化存储键重新初始化，不修改用户真实后端数据。
- 删除孤立代码前保留 `git diff` 可回退边界；发现外部引用后停止删除并恢复该模块。
- 若构建脚本改写 `frontend/public/data_viewer` 的锁文件或产物，清理这些副作用，不纳入本任务。

## 完成门槛

- 领域模型和页面状态不再存在双轨实现。
- 用户、分组、供应商、模型的当前前端交互均可在无后端环境下完成。
- 最小测试、类型检查、源代码 lint 和前端构建结果已记录。
- 检查阶段确认没有后端文件或本地数据进入 diff；不执行 commit/push。

## 本次执行结果

- 管理资源已切换到 `frontend/src/repositories/` 的本地持久化实现，用户 Key、分组、供应商和模型 CRUD 共用各自唯一状态源。
- 已删除旧 `keyGroups`、`ListResult`、client-config/API playground 孤儿模块及无调用方的管理 CRUD API；没有保留旧字段兼容层。
- 验证命令：`npx vue-tsc -b`、`npm run test:run`、`npx eslint src`、`npm run build`、`git diff --check`。
- 后端测试未运行（本任务明确限定为 frontend-only），未执行 commit/push。
