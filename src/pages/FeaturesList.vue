<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange, writeJson } from '../utils/JsonOperateUtils'
import { formatTime, resolveUpdatedTime } from '../utils/datetime'
import { CONFIDENCE_TONE, type Tone } from '../constants/inventory'
import type { FeatureInventory } from '../types/inventory'
import type { CompletenessSnapshot, CompletenessStatus, FeatureGap } from '../types/completeness'
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
const completeness = ref<CompletenessSnapshot | null>(null)
const gap = ref<FeatureGap | null>(null)
const viewMode = ref<'list' | 'increment'>('list')
const viewInteracted = ref(false)

const switchView = (mode: 'list' | 'increment'): void => {
  viewInteracted.value = true
  viewMode.value = mode
}

/**
 * 增量语境声明 = feature-gap.json 存在。
 * 首轮全新迁移不派生；增量轮/介入式增量启动时派生，终检后重派生（空闲观测展示最新态势）。
 */
const incrementContext = computed(() => gap.value !== null)

watch(
  incrementContext,
  (value) => {
    if (value && !viewInteracted.value) viewMode.value = 'increment'
  },
  { immediate: true },
)
const statusFilter = ref('')
const fileMtime = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(10)
const stageFilter = ref('')
let stop: (() => void) | undefined
let stopProgress: (() => void) | undefined
let stopCompleteness: (() => void) | undefined
let stopGap: (() => void) | undefined
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
  stopCompleteness = onJsonChange<CompletenessSnapshot>(DATA_FILES.completeness, (d) => {
    completeness.value = d
  })
  stopGap = onJsonChange<FeatureGap>(DATA_FILES.featureGap, (d) => {
    gap.value = d
  })
})

onUnmounted(() => {
  stop?.()
  stopProgress?.()
  stopCompleteness?.()
  stopGap?.()
})

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

/** 进入开发阶段（code-conversion 及之后）后锁定功能清单编辑；全部完成（currentStage=null）时同样锁定 */
const locked = computed(() => {
  const p = progress.value
  if (!p) return false
  const lockStage = p.stages.find((s) => s.id === FEATURE_LOCK_STAGE)
  if (!lockStage) return false
  const cur = p.stages.find((s) => s.id === p.summary?.currentStage)
  if (cur && cur.order >= lockStage.order) return true
  // 终态兜底：code-conversion 已开始/完成/被阻塞 → 已进入开发阶段
  return ['in_progress', 'completed', 'blocked'].includes(lockStage.status)
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
}

/** 确认：写回勾选（implemented）与优先级草稿（release_stage），成功后清草稿；结果弹框提示 */
const confirming = ref(false)
const dialogText = ref('')
const dlg = ref<HTMLDialogElement | null>(null)

const showDialog = (text: string): void => {
  dialogText.value = text
  dlg.value?.showModal()
}

// ---- 二次确认：点击确认先弹总结，用户确认后真正写回 ----
const summaryDlg = ref<HTMLDialogElement | null>(null)
const summaryText = ref('')

const buildSummary = (): string => {
  let added = 0
  let removed = 0
  for (const f of features.value) {
    const k = fkey(f)
    const now = selected.value.has(k)
    const orig = !!f.should_develop
    if (orig && !now) removed++
    else if (!orig && now) added++
  }
  const priorityChanged = features.value.filter((f) => priorityDraft.value[fkey(f)] !== undefined).length
  const parts = [`已选 ${selected.value.size} 项`]
  if (added) parts.push(`新增 ${added} 项`)
  if (removed) parts.push(`取消 ${removed} 项`)
  if (priorityChanged) parts.push(`优先级调整 ${priorityChanged} 项`)
  parts.push('确认写入功能清单？')
  return parts.join(' · ')
}

const openConfirm = (): void => {
  if (locked.value || confirming.value) return
  summaryText.value = buildSummary()
  summaryDlg.value?.showModal()
}

const doConfirm = (): void => {
  summaryDlg.value?.close()
  void confirm()
}

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
  try {
    await writeJson(FILE, { expectedMtime: fileMtime.value, updates })
    priorityDraft.value = {}
    showDialog(
      unstable.size > 0
        ? `已写入功能清单（${unstable.size} 项因缺少唯一标识未写入）`
        : '已写入功能清单',
    )
  } catch (e) {
    showDialog(e instanceof Error ? e.message : '写入失败')
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

// ---- 完备度视图（d2h-feature-completeness 产物 join）----

const STATUS_META: Record<CompletenessStatus, { label: string; cls: string }> = {
  implemented: { label: '已完备', cls: 'green' },
  partial: { label: '部分实现', cls: 'orange' },
  mock: { label: 'UI 壳', cls: 'orange' },
  absent: { label: '缺失', cls: 'red' },
  uncertain: { label: '待定', cls: '' },
  unreachable: { label: '不可达', cls: '' },
}

/** completeness.features[].key 与清单/勾选使用同一键算法，直接建 Map join */
const statusIndex = computed(() => {
  const map = new Map<string, { status: CompletenessStatus; confidence: string }>()
  for (const f of completeness.value?.features ?? []) {
    map.set(f.key, { status: f.status, confidence: f.confidence })
  }
  return map
})

const UNVERIFIED_LABEL = '未核验'

/** 增量条目：渲染真源为 feature-gap.json 的 gap[]，join 清单补展示字段、join 完备度补置信度 */
interface IncrementItem {
  key: string
  path: string[]
  capabilityKey: string | null
  status: CompletenessStatus
  f: Feature | null
  confidence: string
}

const incrementItems = computed<IncrementItem[]>(() => {
  const featureIndex = new Map(features.value.map((f) => [fkey(f), f]))
  return (gap.value?.gap ?? []).map((g) => ({
    key: g.key,
    path: g.path ?? [],
    capabilityKey: g.capability_key ?? null,
    status: g.status,
    f: featureIndex.get(g.key) ?? null,
    confidence: statusIndex.value.get(g.key)?.confidence ?? '—',
  }))
})

const incrementCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = { absent: 0, partial: 0, mock: 0, uncertain: 0, unreachable: 0 }
  for (const item of incrementItems.value) counts[item.status] = (counts[item.status] ?? 0) + 1
  return counts
})

/** 差量条目 join 不到当前清单（完备度重扫后差量待重派生的旁证） */
const orphanCount = computed(() => incrementItems.value.filter((i) => i.f === null).length)

const incrementGroups = computed(() => {
  const out: Array<{ name: string; items: IncrementItem[] }> = []
  const index = new Map<string, { name: string; items: IncrementItem[] }>()
  for (const item of incrementItems.value) {
    if (statusFilter.value && item.status !== statusFilter.value) continue
    const name = item.path[0] || '未分组'
    let g = index.get(name)
    if (!g) {
      g = { name, items: [] }
      index.set(name, g)
      out.push(g)
    }
    g.items.push(item)
  }
  return out
})

/** 完备度重扫晚于差量生成 → 旧差量可能不再反映当前候选 */
const gapStale = computed(() => {
  const g = gap.value
  const c = completeness.value
  if (!g || !c) return false
  return new Date(g.generated_at).getTime() < new Date(c.generated_at).getTime()
})

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'absent', label: '缺失' },
  { value: 'partial', label: '部分实现' },
  { value: 'mock', label: 'UI 壳' },
  { value: 'uncertain', label: '待定' },
  { value: 'unreachable', label: '不可达' },
]

/** 增量分类的页面释义（对齐 d2h-feature-completeness 状态语义） */
const STATUS_HELP_ROWS = [
  { key: 'absent', text: '负向复核后确认鸿蒙侧没有实现，是增量开发的主要对象。' },
  { key: 'partial', text: '主流程已有，但分支、错误路径或部分用户可见结果缺失。' },
  { key: 'mock', text: '只有界面壳，点击后没有真实业务效果（假数据 / 空实现）。' },
  { key: 'uncertain', text: '证据不足，暂无法判定实现与否，需补充核验后再定。' },
  { key: 'unreachable', text: '代码存在但入口不可达，用户实际到不了该功能，等同不可用。' },
].map((row) => ({
  ...row,
  label: STATUS_META[row.key as CompletenessStatus]?.label ?? row.key,
  cls: STATUS_META[row.key as CompletenessStatus]?.cls ?? '',
}))

const STATUS_HELP_TEXT: Record<string, string> = Object.fromEntries(STATUS_HELP_ROWS.map((r) => [r.key, r.text]))

const statusLabel = (status: CompletenessStatus | null): string =>
  status ? (STATUS_META[status]?.label ?? status) : UNVERIFIED_LABEL
const statusCls = (status: CompletenessStatus | null): string =>
  status ? (STATUS_META[status]?.cls ?? '') : ''
</script>

<template>
  <PageHeading kicker="D2H / features" title="功能清单" :note="`功能清单分析 · ${DATA_FILES.inventory} 实时渲染`" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">☷</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…</small>
  </section>

  <template v-else>
    <!-- 视图切换：增量开发语境（完备度已有 + 流程进行中）时增量视图在前并默认选中 -->
    <div class="view-toggle" role="tablist">
      <template v-if="incrementContext">
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'increment'"
          :class="{ active: viewMode === 'increment' }"
          @click="switchView('increment')"
        >增量视图 · {{ incrementItems.length }} 项</button>
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'list'"
          :class="{ active: viewMode === 'list' }"
          @click="switchView('list')"
        >清单视图</button>
      </template>
      <template v-else>
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'list'"
          :class="{ active: viewMode === 'list' }"
          @click="switchView('list')"
        >清单视图</button>
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'increment'"
          :class="{ active: viewMode === 'increment' }"
          @click="switchView('increment')"
        >增量视图 · {{ incrementItems.length }} 项</button>
      </template>
      <span v-if="completeness" class="tag green">完备度快照 {{ formatTime(completeness.generated_at) }}</span>
      <span v-else class="tag">完备度未生成 · 增量按已勾选范围展示</span>
    </div>

    <template v-if="viewMode === 'list'">
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
        <button type="button" class="primary confirm" :disabled="locked || confirming" @click="openConfirm">
          {{ confirming ? '写入中…' : '确认' }}
        </button>
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

    <!-- 增量视图：feature-gap.json 为真源（存在即增量语境声明） -->
    <template v-else>
      <section v-if="!gap" class="panel placeholder">
        <span class="glyph">☷</span>
        <strong>尚无功能差值</strong>
        <small>首轮迁移不派生功能差值；增量开发启动时由 d2h-feature-completeness 生成 feature-gap.json</small>
      </section>

      <template v-else>
        <section class="panel">
          <div class="row">
            <h2>本轮增量功能</h2>
            <span class="tag">以 feature-gap.json 为准 · 生成于 {{ formatTime(gap.generated_at) }}</span>
          </div>
          <div class="summary-counts completeness-counts">
            <div class="stat-card" role="button" tabindex="0" :title="STATUS_HELP_TEXT.absent" @click="statusFilter = 'absent'; scrollToEl('increment-table')" @keyup.enter="statusFilter = 'absent'; scrollToEl('increment-table')">
              <strong class="red-number">{{ incrementCounts.absent }}</strong><small>缺失</small>
            </div>
            <div class="stat-card" role="button" tabindex="0" :title="STATUS_HELP_TEXT.partial" @click="statusFilter = 'partial'; scrollToEl('increment-table')" @keyup.enter="statusFilter = 'partial'; scrollToEl('increment-table')">
              <strong class="orange-number">{{ incrementCounts.partial }}</strong><small>部分实现</small>
            </div>
            <div class="stat-card" role="button" tabindex="0" :title="STATUS_HELP_TEXT.mock" @click="statusFilter = 'mock'; scrollToEl('increment-table')" @keyup.enter="statusFilter = 'mock'; scrollToEl('increment-table')">
              <strong class="orange-number">{{ incrementCounts.mock }}</strong><small>UI 壳</small>
            </div>
            <div class="stat-card" role="button" tabindex="0" :title="STATUS_HELP_TEXT.uncertain" @click="statusFilter = 'uncertain'; scrollToEl('increment-table')" @keyup.enter="statusFilter = 'uncertain'; scrollToEl('increment-table')">
              <strong>{{ incrementCounts.uncertain }}</strong><small>待定</small>
            </div>
            <div class="stat-card" role="button" tabindex="0" :title="STATUS_HELP_TEXT.unreachable" @click="statusFilter = 'unreachable'; scrollToEl('increment-table')" @keyup.enter="statusFilter = 'unreachable'; scrollToEl('increment-table')">
              <strong>{{ incrementCounts.unreachable }}</strong><small>不可达</small>
            </div>
          </div>
          <details class="status-legend">
            <summary>增量分类说明</summary>
            <div class="legend-grid">
              <div v-for="row in STATUS_HELP_ROWS" :key="row.key" class="legend-row">
                <span class="tag" :class="row.cls">{{ row.label }}</span>
                <span class="legend-text">{{ row.text }}</span>
              </div>
            </div>
          </details>
          <small class="completeness-note">
            增量候选 = should_develop 且未完备{{ orphanCount ? ` · ${orphanCount} 条未匹配当前清单` : '' }}
            <span v-if="gapStale" class="tag orange">完备度已更新，差量待重派生</span>
          </small>
        </section>

        <section id="increment-table" class="panel scroll-anchor">
          <div class="toolbar">
            <select v-model="statusFilter" aria-label="筛选完备状态">
              <option v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <span class="selected-info">{{ incrementGroups.length }} 个模块 · {{ incrementItems.length }} 条</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>完备状态</th>
                  <th>功能 / 范围</th>
                  <th>触发 → 效果</th>
                  <th>能力键</th>
                  <th>核验置信度</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="g in incrementGroups" :key="g.name">
                  <tr>
                    <td>—</td>
                    <td class="title"><strong>{{ g.name }}</strong><small>{{ g.items.length }} 项</small></td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                  <tr v-for="row in g.items" :key="row.key">
                    <td>
                      <span class="tag" :class="statusCls(row.status)">{{ statusLabel(row.status) }}</span>
                    </td>
                    <td class="scope title">
                      {{ row.path.slice(1).join(' / ') || row.path[0] || '—' }}
                      <small>{{ row.capabilityKey ?? UNKNOWN }}</small>
                    </td>
                    <td class="title">
                      <template v-if="row.f">
                        {{ row.f.trigger }} → {{ row.f.effect }}
                        <small v-if="row.f.conditions.length">条件：{{ row.f.conditions.join('；') }}</small>
                      </template>
                      <template v-else>—</template>
                    </td>
                    <td class="title"><small>{{ row.capabilityKey ?? UNKNOWN }}</small></td>
                    <td>
                      <span class="tag" :class="tone(CONFIDENCE_TONE, row.confidence)">{{ row.confidence }}</span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div v-if="!incrementGroups.length" class="empty">暂无增量候选（当前筛选下为空）</div>
          <ul v-if="gap.notes.length" class="question-list completeness-note-list">
            <li v-for="(q, i) in gap.notes" :key="i">{{ q }}</li>
          </ul>
        </section>
      </template>
    </template>
  </template>

  <!-- 二次确认总结弹框 -->
  <dialog ref="summaryDlg" class="confirm-dialog" aria-label="确认范围">
    <h2>确认范围</h2>
    <p class="confirm-dialog-text">{{ summaryText }}</p>
    <div class="confirm-dialog-actions">
      <button type="button" @click="summaryDlg?.close()">取消</button>
      <button type="button" class="primary" @click="doConfirm">确认写入</button>
    </div>
  </dialog>

  <!-- 确认结果弹框 -->
  <dialog ref="dlg" class="confirm-dialog" aria-label="确认结果">
    <h2>功能清单</h2>
    <p class="confirm-dialog-text">{{ dialogText }}</p>
    <button type="button" class="primary confirm-dialog-close" @click="dlg?.close()">关闭</button>
  </dialog>
</template>

<style scoped>
/* ---- 视图切换（清单视图 / 完备度视图） ---- */
.view-toggle {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 14px;
}

.view-toggle button {
  padding: 7px 16px;
  font-weight: 600;
}

.view-toggle button.active {
  background: var(--blue);
  color: #fff;
  border-color: var(--blue);
}

.completeness-counts {
  grid-template-columns: repeat(7, 1fr);
}

.green-number {
  color: #15825e;
}

.completeness-note {
  display: block;
  color: var(--muted);
  margin-top: 8px;
}

.status-legend {
  margin-top: 10px;
  border: 1px solid #edf0f4;
  border-radius: 8px;
  overflow: hidden;
}

.status-legend > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: #34445c;
  background: #f7f9fc;
}

.status-legend > summary::-webkit-details-marker {
  display: none;
}

.status-legend > summary::before {
  content: '▸';
  color: #8191a8;
  transition: transform 0.15s;
}

.status-legend[open] > summary::before {
  transform: rotate(90deg);
}

.legend-grid {
  display: grid;
  gap: 6px;
  padding: 8px 12px 10px;
}

.legend-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12.5px;
}

.legend-row .tag {
  flex-shrink: 0;
  min-width: 64px;
  text-align: center;
}

.legend-text {
  color: #48586f;
}

.completeness-note-list {
  margin: 14px 0 0;
  padding-left: 18px;
  color: #48586f;
  line-height: 1.7;
  font-size: 13px;
}

@media (max-width: 900px) {
  .completeness-counts {
    grid-template-columns: repeat(3, 1fr);
  }
}

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

/* 确认按钮（primary 蓝色） */
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

/* 确认弹框样式已提升至全局 style.css（.confirm-dialog*），本页直接复用 */

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
}
</style>
