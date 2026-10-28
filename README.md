# ConversionDashboard

Android → HarmonyOS 迁移实时看板。读取迁移工程 `.migration` 目录的产物，实时展示迁移总览（阶段进度）、功能清单、Spec 执行，并聚合会话总耗时与 token 消耗。

## 运行

三种等价方式，都需要指定数据目录（指向迁移工程的 `.migration` 目录）：

### 方式一：CLI 参数（推荐）

```powershell
npm run dev:data -- --dataDir D:\company\app2hm\d2happ\1028\cofi-migration\.migration
```

> Vite 8 CLI 拒绝未知选项，`--dataDir` 需经 `dev:data` 包装脚本转成环境变量再透传。

### 方式二：环境变量

```powershell
$env:DASHBOARD_DATA_DIR = "D:\company\app2hm\d2happ\1028\cofi-migration\.migration"
npm run dev
```

### 方式三：.env 文件

项目根新建 `.env`（参考 `.env.example`）：

```
DASHBOARD_DATA_DIR=D:\company\app2hm\d2happ\1028\cofi-migration\.migration
```

然后：

```powershell
npm run dev
```

启动后打开 `http://localhost:5173`。

## 其他命令

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建前端产物到 `dist/`（不需要数据目录） |
| `npm run serve -- --dataDir <path>` | 用 `dist/` + 零依赖服务器起服务（轮询刷新，dist/skill 模式） |
| `npm run preview:data -- --dataDir <path>` | 构建产物 + vite 预览 |
| `npm run release -- --target <path>` | 构建并发布到 skill 资产目录 |
| `npm publish` | 发布 npm 包（`d2h-dashboard`，自动先 `build`） |

## 数据契约

数据根目录 = 迁移工程的 `.migration`，页面读取的相对路径：

| 页面 | 相对路径 |
| --- | --- |
| 迁移总览 | `progress.json` |
| 功能清单 | `feature-analysis/inventory.json` |
| Spec 执行 | `page-specs/batch_report.json` |
| 总耗时/token | `.harmonybot/_summary.json`（服务端聚合虚拟文件） |

## 文档

- `docs/skill-integration.md` — skill 集成与调用规范
- `docs/development-rules.md` — 开发规则（数据接入、字段值展示、样式等）
