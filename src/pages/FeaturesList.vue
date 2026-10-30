<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange, writeJson } from '../utils/JsonOperateUtils'
import { resolveUpdatedTime } from '../utils/datetime'
import { CONFIDENCE_TONE, type Tone } from '../constants/inventory'
import type { FeatureInventory } from '../types/inventory'
import type { RawProgress } from '../types/progress'
import { UNKNOWN, DATA_FILES, FEATURE_IMPLEMENTED_FIELD, FEATURE_LOCK_STAGE } from '../constants/common'

const FILE = DATA_FILES.inventory

type Feature = FeatureInventory['features'][number]

/** 一级模块分组（path[0]，即 excel「一级入口」列；二三四级拼入子行标题） */
interface ModuleGroup {
  name: string
  items: Feature[]
}

const raw = ref<FeatureInventory | null>(null)
const progress = ref<RawProgress | null>(null)
const fileMtime = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(10)
const stageFilter = ref('')
const message = ref('')
let stop: (() => void) | undefined
let stopProgress: (() => void) | undefined
let initialized = false

onMounted(() => {
  stop = onJsonChange<FeatureInventory>(FILE, (d, meta) => {
    raw.value = d
    fileMtime.value = meta.mtimeMs ?? null
    // 首次加载：勾选状态从「是否实现」字段初始化
    if (!initialized) {
      initialized = true
      selected.value = new Set(d.features.filter((f) => f.should_develop).map((f) => f.capability_key ?? JSON.stringify(f.path)))
    }
  })
  stopProgress = onJsonChange<RawProgress>(DATA_FILES.progress, (d) => {
    progress.value = d
  })
})

onUnmounted(() => {
  stop?.()
  stopProgress?.()
})

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

/** 进入开发阶段（code-conversion 及之后）后锁定功能清单编辑 */
const locked = computed(() => {
  const p = progress.value
  if (!p) return false
  const cur = p.stages.find((s) => s.id === p.summary?.currentStage)
  const lockStage = p.stages.find((s) => s.id === FEATURE_LOCK_STAGE)
  if (!cur || !lockStage) return false
  return cur.order >= lockStage.order
})

const features = computed(() => raw.value?.features ?? [])

// ---- 唯一 key 体系 ----
// 语义 key：capability_key（可选，跨入口去重用）优先，缺失时用 JSON.stringify(path) 兜底
// 冲突（无 capability_key 且 path 重复）：追加 '#序号' 临时消歧，标记不稳定并告警，写回时跳过
const keyIndex = computed(() => {
  const counts = new Map<string, number>()
  for (const f of features.value) {
    const k = f.capability_key ?? JSON.stringify(f.path)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const keys = new Map<Feature, string>()
  const unstable = new Set<Feature>()
  const seen = new Map<string, number>()
  for (const f of features.value) {
    const k = f.capability_key ?? JSON.stringify(f.path)
    if ((counts.get(k) ?? 0) > 1) {
      unstable.add(f)
      const n = seen.get(k) ?? 0
      seen.set(k, n + 1)
      keys.set(f, `${k}#${n}`)
    } else {
      keys.set(f, k)
    }
  }
  return { keys, unstable, conflicted: unstable.size }
})

/** feature → 唯一 key（勾选状态 / 优先级草稿 / 写回定位统一使用） */
const fkey = (f: Feature): string => keyIndex.value.keys.get(f) ?? ''

const conflictedCount = computed(() => keyIndex.value.conflicted)

// ---- 优先级草稿（本地修改，不回填 JSON）----
const priorityDraft = ref<Record<string, string>>({})

/** 生效优先级：用户改过用改后值，否则用原始 release_stage */
const effStage = (f: Feature): string => priorityDraft.value[fkey(f)] ?? f.release_stage

const isModified = (f: Feature): boolean =>
  priorityDraft.value[fkey(f)] !== undefined &&
  priorityDraft.value[fkey(f)] !== f.release_stage

const setPriority = (f: Feature, stage: string): void => {
  if (stage === f.release_stage) delete priorityDraft.value[fkey(f)]
  else priorityDraft.value[fkey(f)] = stage
  priorityDraft.value = { ...priorityDraft.value }
}

const stageStats = computed(() => {
  const stats: Record<string, number> = {}
  for (const f of features.value) stats[effStage(f)] = (stats[effStage(f)] ?? 0) + 1
  return stats
})

const filtered = computed(() => {
  const list = features.value
  return stageFilter.value ? list.filter((f) => effStage(f) === stageFilter.value) : list
})

// 合并同类项：一级模块相同的归为一组（父行 + 缩进子行，参照参考 HTML 功能/范围结构）
const groups = computed<ModuleGroup[]>(() => {
  const out: ModuleGroup[] = []
  const index = new Map<string, ModuleGroup>()
  for (const f of filtered.value) {
    const name = f.path[0] || '未分组'
    let g = index.get(name)
    if (!g) {
      g = { name, items: [] }
      index.set(name, g)
      out.push(g)
    }
    g.items.push(f)
  }
  return out
})

// 分页以一级模块为最小单元（模块不被翻页切断）
const totalPages = computed(() => Math.max(1, Math.ceil(groups.value.length / pageSize.value)))

const pagedGroups = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return groups.value.slice(start, start + pageSize.value)
})

const goPage = (p: number): void => {
  page.value = Math.min(Math.max(1, p), totalPages.value)
}

// ---- 勾选状态（按唯一 key 记录，跨分页/筛选保留） ----
const selected = ref<Set<string>>(new Set())

const selectedCount = computed(() => selected.value.size)

const isSelected = (key: string): boolean => selected.value.has(key)

const toggleItem = (f: Feature, checked: boolean): void => {
  const next = new Set(selected.value)
  if (checked) next.add(fkey(f))
  else next.delete(fkey(f))
  selected.value = next
}

/** 父行勾选态：全选 / 半选 / 未选 */
const groupState = (g: ModuleGroup): { checked: boolean; ind: boolean } => {
  const count = g.items.filter((f) => selected.value.has(fkey(f))).length
  return {
    checked: g.items.length > 0 && count === g.items.length,
    ind: count > 0 && count < g.items.length,
  }
}

/** 勾选上层 → 下层全部勾选/取消 */
const toggleGroup = (g: ModuleGroup, checked: boolean): void => {
  const next = new Set(selected.value)
  for (const f of g.items) {
    if (checked) next.add(fkey(f))
    else next.delete(fkey(f))
  }
  selected.value = next
}

// ---- 预设：最小化=mvp 层；核心=core 层；全量=所有能选的 ----
const presetKeys = (target: string): Set<string> => {
  if (target === 'full') {
    return new Set(features.value.map((f) => fkey(f)))
  }
  return new Set(
    features.value.filter((f) => effStage(f) === target).map((f) => fkey(f)),
  )
}

const presetCount = (target: string): number => presetKeys(target).size

/** 预设：替换当前勾选为对应累计集合 */
const applyPreset = (target: string): void => {
  selected.value = presetKeys(target)
  page.value = 1
}

/** 预设按钮选中态：当前选择恰好等于该预设全集 */
const presetActive = (target: string): boolean => {
  const keys = presetKeys(target)
  return keys.size > 0 && keys.size === selected.value.size && [...keys].every((k) => selected.value.has(k))
}

/** 撤回并重载：勾选恢复为「是否实现」字段初始值，清空优先级草稿 */
const resetDraft = (): void => {
  selected.value = new Set(features.value.filter((f) => f.should_develop).map((f) => fkey(f)))
  priorityDraft.value = {}
  message.value = ''
}

/** 确认：写回勾选（implemented）与优先级草稿（release_stage），成功后清草稿；冲突项跳过并提示 */
const confirming = ref(false)

const confirm = async (): Promise<void> => {
  if (locked.value || confirming.value) return
  const unstable = keyIndex.value.unstable
  const updates: Array<{ key: string; fields: Record<string, unknown> }> = []
  for (const f of features.value) {
    if (unstable.has(f)) continue
    const fields: Record<string, unknown> = {
      [FEATURE_IMPLEMENTED_FIELD]: selected.value.has(fkey(f)),
    }
    const stage = priorityDraft.value[fkey(f)]
    if (stage) fields.release_stage = stage
    updates.push({ key: fkey(f), fields })
  }
  confirming.value = true
  message.value = ''
  try {
    await writeJson(FILE, { expectedMtime: fileMtime.value, updates })
    priorityDraft.value = {}
    message.value =
      unstable.size > 0 ? `已写入功能清单（${unstable.size} 项因缺少唯一标识未写入）` : '已写入功能清单'
  } catch (e) {
    message.value = e instanceof Error ? e.message : '写入失败'
  } finally {
    confirming.value = false
  }
}

const android = (f: Feature): { status: string; confidence: string } | null =>
  f.implementations?.android ?? null

const tone = (map: Record<string, Tone>, v: string): Tone => map[v] ?? 'muted'

// 子行标题：二三四级模块路径（去掉一级，一级在父行）
const subPath = (f: Feature): string => f.path.slice(1).join(' / ') || '—'

const scrollToEl = (id: string): void => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 点击统计卡片 → 滚动到功能表格（并应用对应层级筛选）
const jumpToTable = (stage: string): void => {
  stageFilter.value = stage
  page.value = 1
  scrollToEl('features-table')
}
</script>

<template>
  <PageHeading kicker="D2H / features" title="功能清单" :note="`功能清单分析 · ${DATA_FILES.inventory} 实时渲染`" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">☷</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…</small>
  </section>

  <template v-else>
    <section class="panel">
      <div class="row">
        <h2>{{ raw.title || '功能清单' }}</h2>
        <span class="tag">更新于 {{ updatedText }}</span>
      </div>
      <div class="summary-counts">
        <div class="stat-card" role="button" tabindex="0" @click="jumpToTable('')" @keyup.enter="jumpToTable('')">
          <strong>{{ features.length }}</strong><small>功能总数</small>
        </div>
        <div class="stat-card" role="button" tabindex="0" @click="jumpToTable('mvp')" @keyup.enter="jumpToTable('mvp')">
          <strong class="blue-number">{{ stageStats['mvp'] ?? 0 }}</strong><small>mvp</small>
        </div>
        <div class="stat-card" role="button" tabindex="0" @click="jumpToTable('core')" @keyup.enter="jumpToTable('core')">
          <strong class="orange-number">{{ stageStats['core'] ?? 0 }}</strong><small>core</small>
        </div>
        <div class="stat-card" role="button" tabindex="0" @click="jumpToTable('full')" @keyup.enter="jumpToTable('full')">
          <strong>{{ stageStats['full'] ?? 0 }}</strong><small>full</small>
        </div>
        <div class="stat-card" role="button" tabindex="0" @click="scrollToEl('open-questions')" @keyup.enter="scrollToEl('open-questions')">
          <strong class="red-number">{{ raw.open_questions.length }}</strong><small>待确认</small>
        </div>
        <div class="stat-card" role="button" tabindex="0" @click="scrollToEl('excluded-candidates')" @keyup.enter="scrollToEl('excluded-candidates')">
          <strong>{{ raw.excluded_candidates.length }}</strong><small>排除候选</small>
        </div>
      </div>
    </section>

    <section id="features-table" class="panel scroll-anchor">
      <div v-if="locked" class="notice">已进入开发阶段（{{ FEATURE_LOCK_STAGE }}），功能清单已锁定，不可修改。</div>
      <div v-if="conflictedCount" class="notice">
        检测到 {{ conflictedCount }} 个功能缺少唯一标识（path 重复且无 capability_key），已临时按序号区分；这些项确认时不会写入，请上游补 capability_key 或修正 path。
      </div>
      <div class="toolbar">
        <button type="button" :disabled="locked" :class="{ active: presetActive('mvp') }" @click="applyPreset('mvp')">
          最小化实现 · {{ presetCount('mvp') }} 项
        </button>
        <button type="button" :disabled="locked" :class="{ active: presetActive('core') }" @click="applyPreset('core')">
          核心实现 · {{ presetCount('core') }} 项
        </button>
        <button type="button" :disabled="locked" :class="{ active: presetActive('full') }" @click="applyPreset('full')">
          全量实现 · {{ presetCount('full') }} 项
        </button>
        <button type="button" :disabled="locked" @click="resetDraft">撤回并重载</button>
        <select v-model="stageFilter" :disabled="locked" aria-label="筛选交付层" @change="page = 1">
          <option value="">全部层级</option>
          <option value="mvp">mvp</option>
          <option value="core">core</option>
          <option value="full">full</option>
        </select>
        <select v-model="pageSize" :disabled="locked" aria-label="每页模块数" @change="page = 1">
          <option :value="5">5 个模块/页</option>
          <option :value="10">10 个模块/页</option>
          <option :value="20">20 个模块/页</option>
        </select>
        <span class="selected-info">已选 {{ selectedCount }} 项</span>
        <button type="button" class="primary confirm" :disabled="locked || confirming" @click="confirm">
          {{ confirming ? '写入中…' : '确认' }}
        </button>
        <span v-if="message" class="confirm-msg" :class="{ error: message.includes('失败') || message.includes('变化') }">{{ message }}</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="check-col">本次选用</th>
              <th>功能 / 范围</th>
              <th>触发 → 效果</th>
              <th>优先级</th>
              <th>能力键</th>
              <th>置信度</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in pagedGroups" :key="g.name">
              <!-- 一级模块父行：勾选上层 → 下层全部联动 -->
              <tr>
                <td class="check-col">
                  <input
                    type="checkbox"
                    aria-label="选择模块"
                    :disabled="locked"
                    :checked="groupState(g).checked"
                    :indeterminate.prop="groupState(g).ind"
                    @change="toggleGroup(g, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td class="title">
                  <strong>{{ g.name }}</strong>
                  <small>{{ g.items.length }} 项</small>
                </td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td>—</td>
              </tr>
              <!-- 功能子行 -->
              <tr v-for="f in g.items" :key="fkey(f)">
                <td class="check-col">
                  <input
                    type="checkbox"
                    aria-label="选择功能"
                    :disabled="locked"
                    :checked="isSelected(fkey(f))"
                    @change="toggleItem(f, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td class="scope title">
                  {{ subPath(f) }}
                  <small>{{ f.capability_key ?? UNKNOWN }}</small>
                </td>
                <td class="title">
                  {{ f.trigger }} → {{ f.effect }}
                  <small v-if="f.conditions.length">条件：{{ f.conditions.join('；') }}</small>
                  <small v-if="f.notes">{{ f.notes }}</small>
                </td>
                <td>
                  <select
                    class="prio"
                    :class="{ modified: isModified(f) }"
                    :value="effStage(f)"
                    :disabled="locked"
                    aria-label="修改优先级"
                    @change="setPriority(f, ($event.target as HTMLInputElement).value)"
                  >
                    <option value="mvp">mvp</option>
                    <option value="core">core</option>
                    <option value="full">full</option>
                  </select>
                </td>
                <td class="title"><small>{{ f.capability_key ?? UNKNOWN }}</small></td>
                <td>
                  <span class="tag" :class="tone(CONFIDENCE_TONE, android(f)?.confidence ?? '')">
                    {{ android(f)?.confidence ?? '—' }}
                  </span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-if="!filtered.length" class="empty">没有符合条件的功能</div>
      <div v-else class="pagination">
        <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span class="page-info">{{ page }} / {{ totalPages }} · 共 {{ groups.length }} 个模块 {{ filtered.length }} 条</span>
        <button type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      </div>
    </section>

    <section id="open-questions" class="panel scroll-anchor">
      <div class="row">
        <h2>待确认问题</h2>
        <span class="tag" :class="raw.open_questions.length ? 'orange' : 'green'">{{ raw.open_questions.length }}</span>
      </div>
      <div v-if="raw.open_questions.length" class="question-list">
        <div v-for="(q, i) in raw.open_questions" :key="i" class="question-item">
          <span class="summary-no">{{ i + 1 }}</span>
          <span>{{ q }}</span>
        </div>
      </div>
      <div v-else class="empty-inline">无待确认问题</div>
    </section>

    <section id="excluded-candidates" class="panel scroll-anchor">
      <div class="row">
        <h2>排除候选</h2>
        <span class="tag">{{ raw.excluded_candidates.length }}</span>
      </div>
      <div v-if="raw.excluded_candidates.length" class="excluded-list">
        <div v-for="(c, i) in raw.excluded_candidates" :key="i" class="excluded-item">
          <strong>{{ c.name }}</strong>
          <p>{{ c.reason }}</p>
          <small>依据：{{ c.evidence }}</small>
        </div>
      </div>
      <div v-else class="empty-inline">无排除候选</div>
    </section>
  </template>
</template>

<style scoped>
.summary-counts {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
  margin: 18px 0 4px;
}

.summary-counts strong {
  display: block;
  font-size: 24px;
  font-weight: 650;
}

.summary-counts small {
  font-size: 11px;
}

/* 可点击统计卡片 */
.stat-card {
  cursor: pointer;
  border-radius: 7px;
  padding: 6px 8px;
  margin: -6px -8px;
  transition: background 0.15s;
  outline-offset: 2px;
}

.stat-card:hover,
.stat-card:focus-visible {
  background: #f0f4fc;
}

/* 滚动锚点：留出与上方内容的间距 */
.scroll-anchor {
  scroll-margin-top: 16px;
}

.blue-number {
  color: var(--blue);
}

.orange-number {
  color: #986221;
}

.red-number {
  color: #b14646;
}

.toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin: 0 0 18px;
}

.toolbar select {
  padding: 5px 8px;
  border: 1px solid #dce3ec;
  border-radius: 6px;
  background: #fff;
  color: #34445c;
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

th {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
  background: #f9fafc;
  white-space: nowrap;
}

td,
th {
  padding: 12px;
  border-bottom: 1px solid #edf0f4;
  vertical-align: top;
}

td small {
  display: block;
  margin-top: 2px;
}

td.title {
  min-width: 160px;
}

/* 一级模块父行标题（参照参考 HTML 功能行 strong） */
td.title strong {
  font-size: 13px;
  color: #26364d;
}

/* 子行：缩进 + 连接符 + 灰字小号（参照参考 HTML .scope） */
td.scope {
  padding-left: 36px;
  color: #61728a;
  font-size: 12px;
}

td.scope::before {
  content: '—';
  margin-right: 9px;
  color: #acb6c5;
}

.empty {
  text-align: center;
  padding: 35px;
  color: var(--muted);
}

/* 勾选列与复选框（参照参考 HTML accent 样式） */
.check-col {
  width: 44px;
}

input[type='checkbox'] {
  accent-color: var(--blue);
  width: 15px;
  height: 15px;
  cursor: pointer;
}

/* 顶部工具栏：预设按钮（对齐参考 .preset 样式） */
.toolbar button {
  font-size: 13px;
}

.toolbar button.active {
  background: #edf3ff;
  color: #2463eb;
  border-color: #90b2f9;
  font-weight: 600;
}

.selected-info {
  font-size: 12px;
  color: var(--muted);
  margin-left: auto;
  white-space: nowrap;
}

/* 确认按钮与结果提示 */
.toolbar button.confirm {
  background: var(--blue);
  color: #fff;
  border-color: var(--blue);
  font-weight: 600;
}

.toolbar button.confirm:disabled {
  opacity: 0.45;
  cursor: default;
}

.confirm-msg {
  font-size: 12px;
  color: var(--green);
  white-space: nowrap;
}

.confirm-msg.error {
  color: #b14646;
}

/* 锁定态：禁用控件视觉 */
.toolbar button:disabled,
select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 优先级下拉（子行，可修改；改过的高亮蓝框） */
select.prio {
  padding: 3px 6px;
  border: 1px solid #dce3ec;
  border-radius: 5px;
  background: #fff;
  color: #34445c;
  font-size: 12px;
}

select.prio.modified {
  border-color: #90b2f9;
  background: #f0f5ff;
  color: #2463eb;
  font-weight: 600;
}

.empty-inline {
  color: var(--muted);
  font-size: 13px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

.pagination button:disabled {
  opacity: 0.45;
  cursor: default;
}

.page-info {
  font-size: 12px;
  color: var(--muted);
}

.question-list {
  display: grid;
  gap: 2px;
}

.question-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 0;
  border-top: 1px solid #edf0f4;
  font-size: 13px;
}

.question-item:first-child {
  border-top: 0;
}

.summary-no {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #fff0da;
  color: #986221;
  font-weight: 650;
  font-size: 12px;
}

.excluded-list {
  display: grid;
  gap: 4px;
}

.excluded-item {
  padding: 12px 0;
  border-top: 1px solid #edf0f4;
}

.excluded-item:first-child {
  border-top: 0;
}

.excluded-item strong {
  font-size: 13px;
}

.excluded-item p {
  font-size: 12px;
  color: #34445c;
  margin: 4px 0;
}

@media (max-width: 900px) {
  .summary-counts {
    grid-template-columns: repeat(3, 1fr);
  }

  td.scope {
    padding-left: 22px;
  }
}

@media (max-width: 560px) {
  .summary-counts {
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .summary-counts strong {
    font-size: 20px;
  }

  .confirm-msg {
    white-space: normal;
  }
}
</style>
