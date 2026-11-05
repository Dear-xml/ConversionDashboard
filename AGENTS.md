# AGENTS

## UI 自适应规则（防内容撑破容器）

编写 Vue 页面（尤其 flex/grid 布局）时强制遵守，避免长文本把面板/卡片撑破：

1. **子项 `min-width: 0`**：flex/grid 子项默认 `min-width: auto`，长内容（长 git hash、路径、URL 等）不会被压缩。凡在 flex/grid 里放文本的子项一律加 `min-width: 0`。
2. **文本换行/截断二选一**：需换行加 `overflow-wrap: anywhere`；需单行截断加 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`。
3. **自适应网格列**：用 `repeat(auto-fit, minmax(min(200px, 100%), 1fr))`，不用固定 `repeat(n, 1fr)`，窄屏自动降列不溢出。
4. **数值/标签不收缩**：行内数字、tag、按钮加 `flex-shrink: 0`，只让可换行文本项承担 `flex: 1; min-width: 0`。

凡新增或修改涉及长文本展示的布局，均需按上述规则自检。

## 数据接入

迁移过程持续产出 JSON / JSONL 文件，放在数据根目录（可含子文件夹）。前端通过 Vite 中间件桥接读取，浏览器不直接访问磁盘。

- 数据根目录由环境变量 `DASHBOARD_DATA_DIR` 指定；未配置时默认 `../android-to-hmos-migration/docs/migration-dashboard`；可在 `.env` 覆盖。
- 读取 API 在 `src/utils/JsonOperateUtils.ts`：
  - `readJson<T>(relPath, signal?)`：读单个 JSON；`.json` 自动 `JSON.parse`，`.jsonl` 按行解析成数组。
  - `onJsonChange<T>(relPath, callback, options?)`：监听变化（dev 走 Vite WS 推送，否则轮询 manifest 对比），返回取消订阅函数。
  - `relPath` 相对数据根目录，可带子文件夹；`immediate` 默认 `true`。
- 服务端桥接（`vite.config.ts` 的 `dashboardData` 插件）：`GET /api/data/manifest` 返回文件清单，`GET /api/data/file?p=<相对路径>` 返回原文（`no-store`，带路径穿越防护与扩展名白名单）；`fs.watch` 监听变化后 debounce 300ms 经 Vite WS 广播 `dashboard:data-changed`。

## 新增 JSON 数据源的处理流程

1. **确认文件已进数据目录**（或子文件夹），无需改 vite 配置。
2. **定义 type**：在 `src/types/` 新建 `xxx.ts`，用一个（或少数几个）interface 完整描述 JSON 结构，字段一一对应、不做派生；字面量联合用 `type`。
3. **（可选）枚举映射**：状态/枚举值需展示中文文案或色调时，在 `src/constants/` 按语义新建或复用文件登记。
4. **页面读取**：页面内用 `onJsonChange<T>('relPath', cb)` 订阅，拿到原始数据后自行挑字段展示。

> 约定：端侧只负责「定义 type + 取字段展示」，不写命令式 mapper；展示逻辑（状态文案、百分比、时间格式化等）写在页面组件的 `computed` 中。

## 常量（constants）规范

- 「数据 → 展示」的映射（状态枚举 → 色调等）统一放 `src/constants/`，按语义分文件（与某 JSON 强相关如 `progress.ts`；通用性强的单独建文件）。
- 页面/组件通过映射表取值，不要在页面里散落中文映射。

## 样式（CSS）规范

- 页面级 CSS 写在各自 `.vue` 的 `<style scoped>` 中；组件级 CSS 写在组件自身 `.vue` 的 `<style scoped>` 中。
- 全局 `src/style.css` 只保留三部分：设计 token（`:root` 变量）、元素 reset 与基础样式、跨页面复用的原子类（`.tag`、`.panel`、`.link`、`.row`、`.section-index`、`.bar`、`.placeholder` 等）。
- 判断原则：一个样式只被单个页面/组件用 → 放该页面/组件 scoped；被多处复用 → 才进全局原子层。

## 字段值展示规则（禁止枚举值中文映射）

**JSON 中的枚举/状态类字段值，一律原样展示，不做中文翻译映射。**

```ts
// ✅ 正确：直接展示原始值，空值兜底
const stageLabel = (v: string): string => v ?? UNKNOWN

// ❌ 错误：为字段值配置中文标签
const stageLabel = (v: string): string => RELEASE_STAGE[v]?.label ?? v
```

原因：翻译不一定准确（错误翻译比原文更误导）；枚举值随上游新增映射必然不全；原始值本身是与上游契约对齐的准确信息。

补充约定：
- 空值/缺失值统一显示 `UNKNOWN`（`src/constants/common.ts`），不自行发明占位文案。
- **色调（tone）映射允许保留**（`Record<string, Tone>` + `?? 'muted'` 兜底）——颜色只做视觉强调，未命中回退灰调。
- 页面结构性文案（表头、按钮、面板标题、分页等 UI 文案）不受限制，正常用中文。
- 筛选下拉的 option 值与文案直接用字段原始值（如 `mvp`/`core`/`full`），筛选逻辑按原值匹配。

## 目录结构约定

```
src/
  types/        # 每个 JSON 的完整结构 type（与 JSON 一一对应，纯类型，不派生）
  constants/    # tone 色调映射与通用占位符（按语义分文件；不含枚举值中文标签）
  utils/        # 通用工具（JsonOperateUtils 等）
  components/   # 复用的 UI 组件（样式 scoped 在各自文件内）
  pages/        # 页面（对应路由，样式 scoped 在各自文件内）
  router/       # 路由表（tab 菜单由此派生）
docs/           # 开发规则与文档（development-rules.md）
```
