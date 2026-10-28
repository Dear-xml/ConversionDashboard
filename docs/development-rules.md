# ConversionDashboard 开发规则

本文档记录迁移看板（ConversionDashboard）工程在接入迁移过程产出 JSON 数据时的约定，供后续开发参考。

## 1. 数据接入

迁移过程会持续产出 JSON / JSONL 文件，放在数据根目录下（可含子文件夹）。前端通过 Vite 中间件桥接读取，浏览器不直接访问磁盘。

### 数据目录

- 根目录由环境变量 `DASHBOARD_DATA_DIR` 指定。
- 未配置时默认 `../android-to-hmos-migration/docs/migration-dashboard`（相对工程根目录）。
- 可在 `.env` 中覆盖，例如：`DASHBOARD_DATA_DIR=D:\some\path`。

### 读取 API（`src/utils/JsonOperateUtils.ts`）

| 函数 | 作用 |
| --- | --- |
| `readJson<T>(relPath, signal?)` | 读取单个 JSON；`.json` 自动 `JSON.parse`，`.jsonl` 自动按行解析成数组 |
| `onJsonChange<T>(relPath, callback, options?)` | 监听文件变化：dev 走 Vite WS 推送（毫秒级），否则轮询 manifest 对比（默认 5 分钟，可配 `pollMs`）。返回取消订阅函数 |

- `relPath` 是相对于数据根目录的路径，可带子文件夹，如 `'subdir/foo.json'`。
- `immediate` 默认 `true`（订阅时先读一次）。
- 解析失败会自动重试一次；断线时保留最后成功数据。

### 服务端桥接（`vite.config.ts` 内 `dashboardData` 插件）

- `GET /api/data/manifest` → 递归扫描根目录，返回 `{ root, generatedAt, files: { "<相对路径>": { mtimeMs, size } } }`（仅 `.json`/`.jsonl`）。
- `GET /api/data/file?p=<相对路径>` → 返回文件原文（`no-store`），带路径穿越防护与扩展名白名单。
- `fs.watch` 监听根目录，变化后 debounce 300ms 通过 Vite WS 广播 `dashboard:data-changed` 事件（携带变化文件列表）。

## 2. 新增 JSON 的处理流程

新增一个 JSON 数据源，按以下步骤操作：

1. **确认文件已进入数据目录**（或子文件夹），无需改 vite 配置。
2. **定义 type**：在 `src/types/` 下新建 `xxx.ts`，用一个（或少数几个）interface 完整描述整个 JSON 结构，字段与 JSON 一一对应，不做任何派生。字面量联合用 `type`（如状态枚举）。
3. **（可选）枚举映射**：若 JSON 中有状态/枚举值需要展示中文文案或色调，在 `src/constants/` 下按语义新建或复用文件登记（见第 3 节）。
4. **页面读取**：在页面组件内用 `onJsonChange<T>('relPath', cb)` 订阅，拿到原始数据后**自行挑字段展示**。

> 约定：端侧与 JSON 提供方约定好字段结构；端侧只负责「定义 type + 取字段展示」，不写命令式 mapper。展示逻辑（状态文案、百分比、时间格式化等）写在页面组件的 `computed` 中。

## 3. 常量（constants）规范

- 状态枚举 → 中文文案 / 色调等「数据 → 展示」的映射，统一放在 `src/constants/`。
- 按语义决定是否新建文件：与某个 JSON 强相关的（如迁移阶段状态）放 `src/constants/progress.ts`；通用性强的可单独建文件。
- 页面/组件通过 `STATUS_MAP[status].label` 取值，不要在页面里散落中文映射。

## 4. 样式（CSS）规范

- **页面级 CSS**：写在各自 `.vue` 文件的 `<style scoped>` 中（如 `src/pages/Overview.vue` 的总览布局、阶段条、摘要句等）。
- **组件级 CSS**：写在组件自身 `.vue` 的 `<style scoped>` 中（如 `SideBar.vue`、`PageHeading.vue`）。
- **全局 `src/style.css`**：只保留三部分——
  1. 设计 token（`:root` 变量：颜色、字体、背景）；
  2. 元素 reset 与基础样式（`body`、`button`、`input`、`select`、`a`、`h1/h2`、`p`、`small`）；
  3. 跨页面复用的「原子」类（`.tag`、`.panel`、`.notice`、`.link`、`.row`、`.section-index`、`.bar`、`.placeholder`）。

> 判断原则：一个样式只被单个页面/组件使用 → 放该页面/组件 scoped；被多个地方复用 → 才考虑放进全局原子层。

## 5. 字段值展示规则（禁止枚举值中文映射）

**JSON 中的枚举/状态类字段值，一律原样展示，不做中文翻译映射。**

```ts
// ✅ 正确：直接展示原始值，空值兜底
const stageLabel = (v: string): string => v ?? UNKNOWN

// ❌ 错误：为字段值配置中文标签
const stageLabel = (v: string): string => RELEASE_STAGE[v]?.label ?? v
const runLabel = (v: string): string => ({ not_run: '未运行', passed: '通过' })[v] ?? v
```

原因：
1. 翻译不一定准确，错误翻译比原文更误导；
2. 枚举值随上游持续新增，映射表必然不全，新增值会静默退化；
3. 原始值（如 `in_progress`、`mvp`、`high`）本身就是与上游契约对齐的准确信息。

补充约定：
- 空值/缺失值统一显示 `UNKNOWN`（`src/constants/common.ts`），不自行发明占位文案；
- **色调（tone）映射允许保留**（`Record<string, Tone>` + `?? 'muted'` 兜底）——颜色只是视觉强调，未命中回退灰调，不会产生错误信息；
- 页面结构性文案（表头、按钮、面板标题、分页等 UI 文案）不受此规则限制，正常使用中文；
- 筛选下拉的 option 值与文案直接使用字段原始值（如 `mvp`/`core`/`full`），筛选逻辑按原值匹配。

## 6. 目录结构约定

```
src/
  types/        # 每个 JSON 的完整结构 type（与 JSON 一一对应，纯类型，不派生）
  constants/    # tone 色调映射与通用占位符（按语义分文件；不含枚举值中文标签）
  utils/        # 通用工具（JsonOperateUtils 等）
  components/   # 复用的 UI 组件（样式 scoped 在各自文件内）
  pages/        # 页面（对应路由，样式 scoped 在各自文件内）
  router/       # 路由表（tab 菜单由此派生）
docs/           # 开发规则与文档（本文件所在）
```
