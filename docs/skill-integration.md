# skill 集成与调用规范

本工程是迁移实时看板（ConversionDashboard），作为 **d2h-dashboard** skill 的模板源头。构建产物（dist + 零依赖 Node 服务器）嵌入 skill，由 skill 在迁移会话中启动。

## 一、数据契约

数据根目录 = 迁移工程的 `.migration` 目录（**结构固定**，上层路径由外部传参）。页面读取的相对路径：

| 页面 | 相对路径 | 说明 |
| --- | --- | --- |
| 迁移总览 | `progress.json` | 阶段进度（summary + stages） |
| 功能清单 | `feature-analysis/inventory.json` | 功能清单（schema 1.1） |
| Spec 执行 | `page-specs/batch_report.json` | 页面批次报告 |
| 总览·耗时与 token | `.harmonybot/_summary.json` | **服务端虚拟文件**：聚合 `.harmonybot` 会话目录（自动探测数据目录自身/工程根/工程父级）下全部 `ses_*.json` 的总耗时与 token 消耗；无会话时不出现 |

服务器只读，绝不写入数据目录；`.json/.jsonl/.xlsx` 之外的文件不在白名单内。`--sessionDir` 可显式指定会话目录（默认自动探测）。

## 二、三种运行形态

```bash
# ① npm dev（开发，WS 推送毫秒级刷新）
#    注意：Vite 8 CLI 拒绝未知选项，必须用包装脚本传 --dataDir
npm run dev:data -- --dataDir <project>/.migration --port 5173

# ② preview（构建产物 + vite 预览，轮询刷新）
npm run build && npm run preview:data -- --dataDir <project>/.migration

# ③ dist / skill 嵌入（零依赖 Node ≥ 18，轮询刷新）
npm run build && npm run serve -- --dataDir <project>/.migration --port 8080
```

> 变体：`npm run dev:data -- --dataDir <path> --port 5173` 等价于先设 `DASHBOARD_DATA_DIR` 再 `npm run dev`；shell 环境变量与 `.env` 对 dev/preview/serve 全部生效。
> 参数优先级：`--dataDir`/`--data-dir`（CLI，serve.mjs 与包装脚本直读）→ `npm_config_dataDir` → `DASHBOARD_DATA_DIR`（shell）→ `.env` → dev/preview **缺省报错退出**，build 不需要数据目录。

## 三、独立服务器（server/serve.mjs）

```bash
node server/serve.mjs --dataDir <project>/.migration [--port 8080] [--host 127.0.0.1] [--dir ../web]
```

- `--dataDir` 必填；目录不存在 → stderr 报错、exit 1
- `--port` 默认 8080；被占用自动 +1 重试（≤10 次）
- stdout 契约（供 skill 解析）：

```
[dashboard] dataDir=<绝对路径>
[dashboard] http://127.0.0.1:8080
```

- HTTP：静态服务 `--dir`（默认 `../web`）+ SPA 回退 + `/api/data/manifest` + `/api/data/file?p=<相对路径>`

## 四、skill（d2h-dashboard）调用流程

1. 校验 Node ≥ 18、`<project>/.migration` 存在
2. 后台启动：`node <skill>/assets/dashboard/server/serve.mjs --dataDir <project>/.migration`
3. 健康检查：`GET /api/data/manifest` 返回 200 且 `root` 等于传入的 dataDir
4. 解析 stdout 中的实际 URL，告知用户
5. 生命周期：
   - **复用**：若已有同 dataDir 实例在运行（比对 manifest 的 `root`），直接复用 URL，不重复启动
   - **停止**：迁移会话结束时杀进程；服务器只读无状态，随时可杀可重启

## 五、发布到 skill

```bash
# 本仓库构建并拷贝产物到 skill 资产目录
npm run release -- --target <Harmony-Ai-Tool>/android-to-hmos-migration/skills/d2h-dashboard/assets/dashboard
```

产物布局（`web` 命名是为了避开 skill 仓库 gitignore 的 `dist/` 规则）：

```
assets/dashboard/
├── web/          # 前端构建产物（index.html + assets）
└── server/
    ├── dataApi.mjs   # 共享数据 API（manifest/file/watch）
    └── serve.mjs     # 独立服务器
```

## 六、故障排查

| 现象 | 原因与处理 |
| --- | --- |
| stdout 无 URL、exit 1 | `--dataDir` 缺失或目录不存在；看 stderr 提示 |
| 页面「等待数据」 | manifest 里没有对应文件：确认 `.migration` 结构完整；curl `/api/data/manifest` 检查 |
| 端口提示连续占用 | 用 `--port` 显式指定 |
| 数据不刷新 | dist 模式为轮询（默认 5 分钟兜底，页面自带更快间隔）；确认文件 mtime 变化 |
