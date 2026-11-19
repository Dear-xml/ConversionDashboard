<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { listDataFiles, onJsonChange, readJson } from '../utils/JsonOperateUtils'
import { formatTime, resolveUpdatedTime } from '../utils/datetime'
import { UNKNOWN, DATA_FILES } from '../constants/common'
import type { CodeStats, CodeStatsSide, DeltaSide, IncrementDelta } from '../types/codeStats'

const FILE = DATA_FILES.codeStats
const BASELINE_ANDROID_FILE = DATA_FILES.codeStatsBaselineAndroid
const BASELINE_HARMONY_FILE = DATA_FILES.codeStatsBaselineHarmony
const DELTA_FILE = DATA_FILES.incrementDelta
const HISTORY_PREFIX = 'code-audit/history/'

const raw = ref<CodeStats | null>(null)
const fileMtime = ref<number | null>(null)
const baselineAndroid = ref<CodeStats | null>(null)
const baselineHarmony = ref<CodeStats | null>(null)
const delta = ref<IncrementDelta | null>(null)
const histories = ref<Array<{ relPath: string; data: CodeStats }>>([])
let stop: (() => void) | undefined

/** 从 manifest 发现 history/ 归档（动态命名，一次性读取；终检文件变化时刷新） */
async function loadHistories(): Promise<void> {
  try {
    const listed = await listDataFiles(HISTORY_PREFIX)
    const loaded = await Promise.all(
      listed.map(async ({ relPath }) => {
        try {
          return { relPath, data: await readJson<CodeStats>(relPath) }
        } catch {
          return null
        }
      }),
    )
    histories.value = loaded
      .filter((x): x is { relPath: string; data: CodeStats } => x !== null)
      .sort((a, b) => (a.data.generated_at || '').localeCompare(b.data.generated_at || ''))
  } catch (err) {
    console.warn('[CodeAudit] 读取 history 归档失败:', err)
  }
}

onMounted(() => {
  const stops = [
    onJsonChange<CodeStats>(FILE, (d, meta) => {
      raw.value = d
      fileMtime.value = meta.mtimeMs ?? null
      void loadHistories()
    }),
    onJsonChange<CodeStats>(BASELINE_ANDROID_FILE, (d) => {
      baselineAndroid.value = d
    }),
    onJsonChange<CodeStats>(BASELINE_HARMONY_FILE, (d) => {
      baselineHarmony.value = d
    }),
    onJsonChange<IncrementDelta>(DELTA_FILE, (d) => {
      delta.value = d
    }),
  ]
  stop = () => stops.forEach((s) => s())
  void loadHistories()
})

onUnmounted(() => stop?.())

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

const SIDE_KEYS = ['android', 'harmony'] as const

const sides = computed(() => {
  if (!raw.value?.sides) return []
  return SIDE_KEYS.filter((k) => raw.value?.sides[k]).map((k) => ({ key: k, ...raw.value!.sides[k] }))
})

const sideLabel = (key: string): string => {
  const repo = raw.value?.repositories.find((r) => r.id === key)
  return repo?.label ?? (key === 'android' ? 'Android' : 'HarmonyOS')
}

const sideCount = (s: CodeStatsSide | null): string => {
  if (!s) return UNKNOWN
  return `${s.code.total_files} 文件 / ${s.code.total_lines} 行`
}

const barWidth = (s: CodeStatsSide, lines: number): string => {
  const max = Math.max(1, ...s.code.by_language.map((l) => l.lines))
  return `${Math.round((100 * lines) / max)}%`
}

/** 双端对照行（指标 → 各端数值） */
const compareRows = computed(() => {
  const c = raw.value?.comparison
  if (!c) return []
  return [
    { label: '模块数', values: [c.modules.android, c.modules.harmony] },
    { label: '三方依赖', values: [c.third_party_dependencies.android, c.third_party_dependencies.harmony] },
    { label: '原生库', values: [c.native_libraries.android, c.native_libraries.harmony] },
    { label: '物理行数', values: [c.total_lines.android, c.total_lines.harmony] },
    { label: `超大文件（≥${raw.value!.thresholds.oversized_file_lines} 行）`, values: [c.oversized.android_count, c.oversized.harmony_count] },
  ]
})

// ---- 分析快照时间线 ----

interface TimelineNode {
  key: string
  kind: 'baseline' | 'history' | 'current'
  title: string
  time: string
  revision: string
  lines: string
  ghost?: boolean
  active?: boolean
}

const nodeRevision = (d: CodeStats): string =>
  d.repositories.map((r) => `${r.id}: ${r.revision || UNKNOWN}`).join(' · ')

const nodeLines = (d: CodeStats): string => {
  const parts = SIDE_KEYS.filter((k) => d.sides?.[k]).map(
    (k) => `${k === 'android' ? 'A' : 'H'} ${d.sides[k].code.total_lines.toLocaleString()} 行`,
  )
  return parts.join(' / ') || UNKNOWN
}

const timeline = computed<TimelineNode[]>(() => {
  const nodes: TimelineNode[] = []
  if (baselineAndroid.value) {
    nodes.push({
      key: 'b-android', kind: 'baseline', title: 'Android 基线',
      time: formatTime(baselineAndroid.value.generated_at),
      revision: nodeRevision(baselineAndroid.value), lines: nodeLines(baselineAndroid.value),
    })
  }
  nodes.push(
    baselineHarmony.value
      ? {
          key: 'b-harmony', kind: 'baseline', title: 'HarmonyOS 基线',
          time: formatTime(baselineHarmony.value.generated_at),
          revision: nodeRevision(baselineHarmony.value), lines: nodeLines(baselineHarmony.value),
        }
      : { key: 'b-harmony', kind: 'baseline', title: 'HarmonyOS 基线', time: '', revision: '', lines: '未生成（全新迁移或未到阶段）', ghost: true },
  )
  histories.value.forEach((h, i) => {
    nodes.push({
      key: h.relPath, kind: 'history', title: `第 ${i + 1} 轮终检`,
      time: formatTime(h.data.generated_at), revision: nodeRevision(h.data), lines: nodeLines(h.data),
    })
  })
  if (raw.value) {
    nodes.push({
      key: 'current', kind: 'current', title: '当前终检',
      time: formatTime(raw.value.generated_at), revision: nodeRevision(raw.value),
      lines: nodeLines(raw.value), active: true,
    })
  }
  return nodes
})

const hasAnySnapshot = computed(
  () => Boolean(raw.value || baselineAndroid.value || baselineHarmony.value || histories.value.length),
)

// ---- 本轮分析（increment-delta.json） ----

const SOURCE_KIND_LABEL: Record<string, string> = {
  'baseline-android': 'Android 基线',
  'baseline-harmony': 'HarmonyOS 基线',
  'history-final': '上一轮终检',
  external: '外部快照',
}

const fmtSigned = (n: number): string => (n > 0 ? `+${n}` : `${n}`)
const deltaTone = (n: number): string => (n > 0 ? 'tone-pos' : n < 0 ? 'tone-neg' : 'tone-zero')

const deltaSides = computed(() =>
  SIDE_KEYS.filter((k) => delta.value?.sides?.[k]).map((k) => ({ key: k, side: delta.value!.sides[k] as DeltaSide })),
)

const deltaBasisLabel = (key: string): string => {
  const prev = delta.value?.inputs.previous_by_side?.[key as 'android' | 'harmony']
  if (!prev) return '无对比快照（该侧未计算）'
  return `对比${SOURCE_KIND_LABEL[prev.source_kind] ?? prev.source_kind} · ${formatTime(prev.generated_at)}`
}

const depNet = (d: DeltaSide): number =>
  d.third_party_dependencies.added.length - d.third_party_dependencies.removed.length
const oversizedWarn = (d: DeltaSide): number => d.oversized_files.added.length + d.oversized_files.persisted.length

interface DeltaDetailRow {
  cls: string
  text: string
}

const deltaDetailRows = (d: DeltaSide): DeltaDetailRow[] => {
  const rows: DeltaDetailRow[] = []
  for (const m of d.modules.added) rows.push({ cls: 'row-module', text: `新增模块 ${m.name} · ${m.kind}` })
  for (const name of d.modules.removed) rows.push({ cls: 'row-muted', text: `移除模块 ${name}` })
  for (const dep of d.third_party_dependencies.added)
    rows.push({ cls: 'row-dep', text: `新增依赖 ${dep.name}${dep.version ? ` @ ${dep.version}` : ''}` })
  for (const c of d.third_party_dependencies.version_changed)
    rows.push({ cls: 'row-dep', text: `依赖升级 ${c.name} ${c.from ?? UNKNOWN} → ${c.to ?? UNKNOWN}` })
  for (const name of d.third_party_dependencies.removed) rows.push({ cls: 'row-muted', text: `移除依赖 ${name}` })
  for (const n of d.native_libraries.added) rows.push({ cls: 'row-dep', text: `新增原生库 ${n}` })
  for (const n of d.native_libraries.removed) rows.push({ cls: 'row-muted', text: `移除原生库 ${n}` })
  for (const f of d.oversized_files.added)
    rows.push({ cls: 'row-oversized-bad', text: `超大新增 ${f.path} · ${f.lines} 行${f.module && f.module !== 'unknown' ? `（${f.module}）` : ''}` })
  for (const f of d.oversized_files.persisted)
    rows.push({ cls: 'row-oversized-bad', text: `超大恶化 ${f.path} · ${fmtSigned(f.lines_delta)} 行` })
  for (const p of d.oversized_files.removed) rows.push({ cls: 'row-oversized-good', text: `超大消除 ${p}` })
  return rows
}

const comparisonDeltaRows = computed(() => {
  const c = delta.value?.comparison_delta
  if (!c) return []
  return [
    { label: '物理行数', a: c.total_lines.android, h: c.total_lines.harmony },
    { label: '模块', a: c.modules.android, h: c.modules.harmony },
    { label: '三方依赖', a: c.third_party_dependencies.android, h: c.third_party_dependencies.harmony },
    { label: '原生库', a: c.native_libraries.android, h: c.native_libraries.harmony },
    { label: '超大文件', a: c.oversized.android_count, h: c.oversized.harmony_count },
  ]
})
</script>

<template>
  <PageHeading kicker="D2H / code-audit" title="代码静态分析" :note="`双端代码规模 · 模块 · 依赖 · 超大文件 · ${FILE} 实时渲染`" />

  <section v-if="!hasAnySnapshot" class="panel placeholder">
    <span class="glyph">∑</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…（尚未生成代码静态分析报告时此页为空）</small>
  </section>

  <template v-else>
    <!-- 00 分析快照时间线 -->
    <section class="panel">
      <div class="row">
        <h2><span class="section-index">00</span>分析快照</h2>
        <span class="tag muted-tag">{{ timeline.length }} 份</span>
      </div>
      <div class="timeline">
        <div
          v-for="n in timeline"
          :key="n.key"
          class="tl-node"
          :class="[`tl-${n.kind}`, { ghost: n.ghost, active: n.active }]"
        >
          <div class="tl-dot"></div>
          <div class="tl-body">
            <strong>{{ n.title }}</strong>
            <small v-if="!n.ghost">{{ n.time }}</small>
            <small class="tl-lines">{{ n.lines }}</small>
            <small v-if="n.revision" class="tl-rev">{{ n.revision }}</small>
          </div>
        </div>
      </div>
      <small v-if="histories.length" class="empty-inline">
        历史归档 {{ histories.length }} 份（code-audit/history/）；节点为概要，完整明细仅展示当前终检
      </small>
      <small v-else class="empty-inline">暂无历史归档；增量轮重扫前上一轮终检会移入 history/</small>
    </section>

    <!-- 01 本轮分析 -->
    <section v-if="delta" class="panel">
      <div class="row">
        <h2><span class="section-index">01</span>本轮分析</h2>
        <span class="tag">生成于 {{ formatTime(delta.generated_at) }}</span>
      </div>
      <div class="delta-grid">
        <div
          v-for="s in deltaSides"
          :key="s.key"
          class="delta-side"
          :class="s.key === 'android' ? 'is-android' : 'is-harmony'"
        >
          <div class="row delta-side-head">
            <strong>{{ sideLabel(s.key) }}</strong>
            <span class="tag muted-tag">{{ deltaBasisLabel(s.key) }}</span>
          </div>
          <div class="delta-kpis">
            <div class="kpi">
              <strong :class="deltaTone(s.side.code.total_lines_delta)">{{ fmtSigned(s.side.code.total_lines_delta) }}</strong>
              <small>行数（{{ fmtSigned(s.side.code.total_files_delta) }} 文件）</small>
            </div>
            <div class="kpi">
              <strong :class="deltaTone(depNet(s.side))">{{ fmtSigned(depNet(s.side)) }}</strong>
              <small>依赖 +{{ s.side.third_party_dependencies.added.length }} −{{ s.side.third_party_dependencies.removed.length }} ~{{ s.side.third_party_dependencies.version_changed.length }}</small>
            </div>
            <div class="kpi">
              <strong :class="oversizedWarn(s.side) ? 'tone-neg' : 'tone-zero'">+{{ s.side.oversized_files.added.length }} ↗{{ s.side.oversized_files.persisted.length }}</strong>
              <small>超大新增/恶化 · ✓{{ s.side.oversized_files.removed.length }} 消除</small>
            </div>
          </div>
          <details v-if="deltaDetailRows(s.side).length" class="dep-group delta-detail">
            <summary>
              <span class="dep-group-label">本轮明细</span>
              <span class="tag muted-tag">{{ deltaDetailRows(s.side).length }} 条</span>
            </summary>
            <div class="dep-list">
              <div v-for="(r, ri) in deltaDetailRows(s.side)" :key="ri" class="delta-row" :class="r.cls">{{ r.text }}</div>
            </div>
          </details>
        </div>
      </div>
      <div v-if="comparisonDeltaRows.length" class="delta-comparison">
        <small class="block-label">双端差距变化（当前 − 对比基准）</small>
        <div class="cd-chips">
          <span v-for="row in comparisonDeltaRows" :key="row.label" class="tag">
            {{ row.label }} A {{ fmtSigned(row.a) }} / H {{ fmtSigned(row.h) }}
          </span>
        </div>
      </div>
      <ul v-if="delta.notes.length" class="question-list delta-notes">
        <li v-for="(q, i) in delta.notes" :key="i">{{ q }}</li>
      </ul>
    </section>
    <section v-else-if="raw" class="panel">
      <div class="row">
        <h2><span class="section-index">01</span>本轮分析</h2>
      </div>
      <div class="empty-inline">本轮差量尚未生成（本轮终检后由 increment_delta.py 产出 increment-delta.json）</div>
    </section>

    <template v-if="raw">
    <!-- 02 双端对照 -->
    <section class="panel">
      <div class="row">
        <h2><span class="section-index">02</span>双端对照</h2>
        <span class="tag">更新于 {{ updatedText }}</span>
      </div>
      <table class="compare-table">
        <thead>
          <tr>
            <th>指标</th>
            <th>Android</th>
            <th>HarmonyOS</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in compareRows" :key="row.label">
            <td class="compare-label">{{ row.label }}</td>
            <td class="compare-value android-value">{{ row.values[0] }}</td>
            <td class="compare-value harmony-value">{{ row.values[1] }}</td>
          </tr>
        </tbody>
      </table>
      <div class="meta-list">
        <div v-for="repo in raw.repositories" :key="repo.id" class="meta-item">
          <small>{{ repo.label }}</small>
          <span class="meta-value">{{ repo.path }} · rev {{ repo.revision || UNKNOWN }}</span>
        </div>
      </div>
    </section>

    <!-- 各端代码规模 -->
    <section v-for="(s, si) in sides" :key="s.key" class="panel side-panel">
      <div class="row">
        <h2><span class="section-index">{{ String(si + 3).padStart(2, '0') }}</span>{{ sideLabel(s.key) }} 代码规模</h2>
        <span class="tag">{{ sideCount(s) }}</span>
      </div>

      <div class="summary-counts">
        <div><strong>{{ s.code.total_files }}</strong><small>总文件</small></div>
        <div><strong>{{ s.code.total_lines }}</strong><small>总行数</small></div>
        <div><strong>{{ s.module_count }}</strong><small>模块</small></div>
        <div><strong>{{ s.third_party_dependency_count }}</strong><small>三方依赖</small></div>
        <div><strong>{{ s.native_library_count }}</strong><small>原生库</small></div>
      </div>

      <div class="module-pills">
        <span v-for="m in s.modules" :key="m.name" class="tag module-tag">{{ m.name }} · {{ m.kind }}</span>
      </div>

      <template v-if="s.code.by_language.length">
        <small class="block-label">按语言</small>
        <div class="lang-table">
          <div v-for="lang in s.code.by_language" :key="lang.language" class="lang-row">
            <span class="lang-name">{{ lang.language }}</span>
            <span class="lang-files">{{ lang.files }} 文件</span>
            <span class="lang-lines">{{ lang.lines }} 行</span>
            <div class="lang-bar"><i :style="{ width: barWidth(s, lang.lines) }"></i></div>
          </div>
        </div>
      </template>

      <template v-if="s.code.other_extensions.length">
        <small class="block-label">其他扩展名（未映射到核心语言桶）</small>
        <div class="ext-pills">
          <span v-for="ext in s.code.other_extensions" :key="ext.extension" class="tag ext-tag">
            {{ ext.extension || '(无扩展名)' }} · {{ ext.files }} 文件 / {{ ext.lines }} 行
          </span>
        </div>
      </template>

      <template v-if="s.third_party_dependencies.length">
        <details class="dep-group" :open="s.key === 'android'">
          <summary>
            <span class="dep-group-label">三方依赖</span>
            <span class="tag muted-tag">{{ s.third_party_dependency_count }}</span>
          </summary>
          <div class="dep-list">
            <details v-for="dep in s.third_party_dependencies" :key="dep.name" class="dep-item">
              <summary><code>{{ dep.name }}</code> <span class="tag muted-tag">{{ dep.version }}</span></summary>
              <div class="dep-decls">
                <div v-for="(d, di) in dep.declarations" :key="di" class="dep-decl">
                  {{ d.path }}<template v-if="d.line_start">:{{ d.line_start }}</template>
                  <span v-if="d.scope" class="tag muted-tag">{{ d.scope }}</span>
                </div>
              </div>
            </details>
          </div>
        </details>
      </template>

      <template v-if="s.oversized_files.length">
        <small class="block-label">超大文件</small>
        <div class="oversized-list">
          <div v-for="f in s.oversized_files" :key="f.path" class="oversized-item">
            <code>{{ f.path }}</code> <span class="tag orange">{{ f.lines }} 行</span>
          </div>
        </div>
      </template>
      <small v-else class="empty-inline">无超大文件（阈值 {{ raw.thresholds.oversized_file_lines }} 行）</small>
    </section>

    <!-- 注意事项 -->
    <section class="panel">
      <div class="row">
        <h2><span class="section-index">{{ String(sides.length + 3).padStart(2, '0') }}</span>注意事项</h2>
        <span v-if="raw.notes.length" class="tag orange">{{ raw.notes.length }} 项</span>
      </div>
      <ul v-if="raw.notes.length" class="question-list">
        <li v-for="(q, i) in raw.notes" :key="i">{{ q }}</li>
      </ul>
      <div v-else class="empty-inline">无注意事项</div>
    </section>
    </template>
  </template>
</template>

<style scoped>
.section-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  margin-right: 8px;
  font-size: 12px;
  color: #4c77dc;
  background: #eaf1ff;
  border-radius: 6px;
}

.compare-table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 13px;
}

.compare-table th,
.compare-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #edf0f4;
}

.compare-table thead th {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.5px;
  border-bottom: 2px solid #e3e9f2;
  background: #f7f9fc;
}

.compare-table tbody tr:last-child td {
  border-bottom: 0;
}

.compare-table tbody tr:hover td {
  background: #f8faff;
}

.compare-label {
  color: #34445c;
  font-weight: 600;
  width: 40%;
}

.compare-value {
  font-size: 18px;
  font-weight: 650;
  white-space: nowrap;
}

.android-value {
  color: #3766dc;
}

.harmony-value {
  color: #168168;
}

.meta-list {
  display: grid;
  gap: 2px;
  margin-top: 4px;
}

.meta-item {
  display: flex;
  gap: 16px;
  padding: 7px 0;
  border-top: 1px solid #edf0f4;
  font-size: 13px;
}

.meta-item:first-child {
  border-top: 0;
}

.meta-item small {
  flex-shrink: 0;
  width: 80px;
}

.meta-value {
  color: #34445c;
  overflow-wrap: anywhere;
}

.side-panel {
  border-top: 3px solid #65a7a3;
}

.summary-counts {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin: 16px 0;
}

.summary-counts strong {
  display: block;
  font-size: 24px;
  font-weight: 650;
}

.summary-counts small {
  font-size: 11px;
}

.summary-counts > div {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f4f6fa;
}

.module-pills,
.ext-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 4px 0 14px;
}

.module-tag {
  color: #48736e;
  background: #edf5f2;
}

.ext-tag {
  color: #61728a;
  background: #f1f3f7;
}

.block-label {
  display: block;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 1px;
  margin: 18px 0 8px;
}

.lang-table {
  display: grid;
  gap: 6px;
}

.lang-row {
  display: grid;
  grid-template-columns: 110px 90px 90px 1fr;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.lang-name {
  font-weight: 600;
  color: #34445c;
}

.lang-files,
.lang-lines {
  color: #61728a;
  font-size: 12px;
}

.lang-bar {
  height: 8px;
  background: #edf1f7;
  border-radius: 8px;
  overflow: hidden;
}

.lang-bar i {
  display: block;
  height: 100%;
  background: var(--blue);
  border-radius: 8px;
}

.dep-list {
  display: grid;
}

.dep-group {
  margin-top: 18px;
  border: 1px solid #edf0f4;
  border-radius: 8px;
  overflow: hidden;
}

.dep-group > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  font-size: 13px;
  font-weight: 650;
  color: #34445c;
  background: #f7f9fc;
}

.dep-group > summary::-webkit-details-marker {
  display: none;
}

.dep-group > summary::before {
  content: '▸';
  color: #8191a8;
  font-size: 13px;
  transition: transform 0.15s;
}

.dep-group[open] > summary::before {
  transform: rotate(90deg);
}

.dep-group > summary:hover {
  color: var(--blue);
}

.dep-group-label {
  min-width: 0;
}

.dep-group .dep-list {
  padding: 4px 14px 10px;
}

.dep-item {
  border-top: 1px solid #edf0f4;
  padding: 6px 0;
}

.dep-item:first-child {
  border-top: 0;
}

.dep-item summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  font-size: 13px;
  color: #34445c;
}

.dep-item summary::-webkit-details-marker {
  display: none;
}

.dep-item summary::before {
  content: '▸';
  color: #8191a8;
  font-size: 12px;
  transition: transform 0.15s;
}

.dep-item[open] summary::before {
  transform: rotate(90deg);
}

.dep-item summary:hover {
  color: var(--blue);
}

.dep-item summary code {
  font-size: 12px;
  color: #2d59c2;
  overflow-wrap: anywhere;
}

.dep-decls {
  padding: 0 4px 8px 24px;
  display: grid;
  gap: 4px;
}

.dep-decl {
  font-size: 12px;
  color: #61728a;
  overflow-wrap: anywhere;
}

.muted-tag {
  color: #61728a;
  background: #f1f3f7;
}

.oversized-list {
  display: grid;
  gap: 6px;
}

.oversized-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.oversized-item code {
  color: #b54545;
  overflow-wrap: anywhere;
}

.question-list {
  margin: 4px 0 0;
  padding-left: 18px;
  color: #48586f;
  line-height: 1.7;
  font-size: 13px;
}

.question-list li {
  overflow-wrap: anywhere;
  margin: 4px 0;
}

.empty-inline {
  color: var(--muted);
  font-size: 13px;
}

/* ---- 00 分析快照时间线 ---- */
.timeline {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  padding: 16px 0 4px;
}

.tl-node {
  position: relative;
  flex: 1 1 160px;
  min-width: 160px;
  padding: 12px 14px 0 2px;
  border-top: 2px solid #e3e9f2;
}

.tl-dot {
  position: absolute;
  top: -6px;
  left: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #8aa0c4;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #c9d6ea;
}

.tl-node.tl-history .tl-dot {
  background: #6f8bb5;
}

.tl-node.active .tl-dot {
  background: var(--blue);
  box-shadow: 0 0 0 3px #dce8ff;
}

.tl-node.ghost {
  opacity: 0.55;
}

.tl-node.ghost .tl-dot {
  background: #d3dbe6;
  box-shadow: 0 0 0 1px #e2e8f1;
}

.tl-body {
  display: grid;
  gap: 2px;
  font-size: 12px;
}

.tl-body strong {
  font-size: 13px;
  color: #34445c;
}

.tl-node.active .tl-body strong {
  color: var(--blue);
}

.tl-body small {
  color: var(--muted);
}

.tl-lines {
  color: #48586f;
}

.tl-rev {
  font-size: 11px;
  overflow-wrap: anywhere;
}

/* ---- 01 本轮分析 ---- */
.delta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
  margin: 14px 0 4px;
}

.delta-side {
  border: 1px solid #edf0f4;
  border-radius: 10px;
  padding: 14px;
}

.delta-side.is-android {
  border-top: 3px solid #3766dc;
}

.delta-side.is-harmony {
  border-top: 3px solid #168168;
}

.delta-side-head {
  justify-content: space-between;
  margin-bottom: 10px;
}

.delta-side-head strong {
  font-size: 14px;
  color: #34445c;
}

.delta-kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.kpi {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f4f6fa;
}

.kpi strong {
  display: block;
  font-size: 20px;
  font-weight: 650;
}

.kpi small {
  font-size: 11px;
  color: var(--muted);
}

.tone-pos {
  color: #2463eb;
}

.tone-neg {
  color: #b54545;
}

.tone-zero {
  color: var(--muted);
}

.delta-detail {
  margin-top: 12px;
}

.delta-row {
  font-size: 12.5px;
  padding: 4px 0;
  color: #48586f;
  overflow-wrap: anywhere;
}

.delta-row.row-module {
  color: #48736e;
}

.delta-row.row-muted {
  color: var(--muted);
}

.delta-row.row-oversized-bad {
  color: #b54545;
}

.delta-row.row-oversized-good {
  color: #15825e;
}

.delta-comparison {
  margin-top: 6px;
}

.cd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.delta-notes {
  margin-top: 10px;
}

@media (max-width: 700px) {
  .delta-kpis {
    grid-template-columns: repeat(1, 1fr);
  }
}

@media (max-width: 700px) {
  .summary-counts {
    grid-template-columns: repeat(2, 1fr);
  }

  .lang-row {
    grid-template-columns: 90px 70px 70px 1fr;
    gap: 6px;
  }

  .compare-table th,
  .compare-table td {
    padding: 8px 9px;
  }

  .compare-value {
    font-size: 15px;
  }
}
</style>
