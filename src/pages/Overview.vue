<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange } from '../utils/JsonOperateUtils'
import { formatTime, formatDuration, resolveUpdatedTime } from '../utils/datetime'
import { formatTokens } from '../utils/format'
import { jumpToDetail, stageToTab } from '../utils/navigation'
import type { RawProgress } from '../types/progress'
import type { BatchReport } from '../types/batchReport'
import type { FeatureInventory } from '../types/inventory'
import type { SessionSummary } from '../types/sessionSummary'
import type { PreflightReport } from '../types/preflight'
import { UNKNOWN, DATA_FILES } from '../constants/common'

const raw = ref<RawProgress | null>(null)
const progressMtime = ref<number | null>(null)
const batch = ref<BatchReport | null>(null)
const inventory = ref<FeatureInventory | null>(null)
const sessions = ref<SessionSummary | null>(null)
const preflight = ref<PreflightReport | null>(null)
let stop: (() => void) | undefined
let stopBatch: (() => void) | undefined
let stopInventory: (() => void) | undefined
let stopSessions: (() => void) | undefined
let stopPreflight: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<RawProgress>(DATA_FILES.progress, (data, meta) => {
    raw.value = data
    progressMtime.value = meta.mtimeMs ?? null
  })
  stopBatch = onJsonChange<BatchReport>(DATA_FILES.batchReport, (data) => {
    batch.value = data
  })
  stopInventory = onJsonChange<FeatureInventory>(DATA_FILES.inventory, (data) => {
    inventory.value = data
  })
  stopSessions = onJsonChange<SessionSummary>(DATA_FILES.sessions, (data) => {
    sessions.value = data
  })
  stopPreflight = onJsonChange<PreflightReport>(DATA_FILES.preflight, (data) => {
    preflight.value = data
  })
})

onUnmounted(() => {
  stop?.()
  stopBatch?.()
  stopInventory?.()
  stopSessions?.()
  stopPreflight?.()
})

const summary = computed(() => raw.value?.summary ?? null)

const stages = computed(() =>
  (raw.value?.stages ?? []).map((s) => ({
    ...s,
    statusLabel: s.status ?? UNKNOWN,
    isCurrent: s.id === summary.value?.currentStage,
  })),
)

const blockers = computed(() => [...new Set((raw.value?.stages ?? []).flatMap((s) => s.blockers))])

// 阶段开始/完成时间（供状态总览阶段格展示）
const stageStarted = (iso: string | null): string => (iso ? `开始 ${formatTime(iso)}` : '')

const stageEnded = (s: { startedAt: string | null; endedAt: string | null }): string => {
  if (!s.endedAt) return ''
  const base = `完成 ${formatTime(s.endedAt)}`
  if (s.startedAt) {
    const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt)
    if (Number.isFinite(ms) && ms >= 0) return `${base} · 用时 ${formatDuration(ms)}`
  }
  return base
}

const sentence = computed(() => {
  const s = summary.value
  if (!s) return ''
  const cur = stages.value.find((st) => st.isCurrent)
  return `当前阶段：${cur?.name ?? s.currentStage ?? '—'} · 已完成 ${s.completed} / ${s.total}`
})

// Spec 任务（page-specs/batch_report.json）
const specSummary = computed(() => batch.value?.summary ?? null)

const specPercent = computed(() => {
  const s = specSummary.value
  return s && s.total > 0 ? Math.round((100 * s.completed) / s.total) : 0
})

// 当前阶段（progress.json 的 currentStage 对应 stage）
const currentStage = computed(() => stages.value.find((s) => s.isCurrent) ?? null)

// 当前阶段跳转的详情 tab
const currentStageTab = computed(() => stageToTab(currentStage.value?.id))

// 功能清单（feature-analysis/inventory.json）：inventory 无执行进度语义，按交付层分布展示
const invStats = computed(() => {
  const list = inventory.value?.features ?? []
  const stats: Record<string, number> = {}
  for (const f of list) stats[f.release_stage] = (stats[f.release_stage] ?? 0) + 1
  return { total: list.length, mvp: stats['mvp'] ?? 0, core: stats['core'] ?? 0, full: stats['full'] ?? 0 }
})

// 工程与环境（preflight-report.json）
const preflightStats = computed(() => {
  const checks = preflight.value?.checks ?? []
  const counts: Record<string, number> = {}
  for (const c of checks) counts[c.status] = (counts[c.status] ?? 0) + 1
  return { total: checks.length, passed: counts['passed'] ?? 0, failed: counts['failed'] ?? 0, skipped: counts['skipped'] ?? 0, notApplicable: counts['not_applicable'] ?? 0 }
})

const stageRunning = computed(() => currentStage.value?.status === 'in_progress')
</script>

<template>
  <PageHeading kicker="D2H / overview" title="迁移总览" note="阶段 → 任务 → 工程与环境 → 阻塞" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">◫</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ DATA_FILES.progress }}…</small>
  </section>

  <template v-else>
    <section class="panel status-overview" aria-label="第一层：状态总览">
      <div class="row">
        <h2><span class="section-index">01</span>状态总览</h2>
        <div class="total-time-group">
          <div class="total-time">
            <small>总用时</small>
            <strong>{{ sessions ? formatDuration(sessions.durationMs) : '未记录' }}</strong>
          </div>
          <div v-if="sessions" class="total-time" :title="`输入 ${formatTokens(sessions.tokens.input)} · 输出 ${formatTokens(sessions.tokens.output)} · 总计 ${formatTokens(sessions.tokens.total)}`">
            <small>tokens 输入/输出</small>
            <strong>{{ formatTokens(sessions.tokens.input) }} / {{ formatTokens(sessions.tokens.output) }}</strong>
          </div>
        </div>
      </div>

      <div class="phase-track">
        <button
          v-for="st in stages"
          :key="st.id"
          type="button"
          class="phase-cell"
          :class="{
            'phase-active': st.status === 'in_progress',
            'phase-done': st.status === 'completed',
            'phase-error': st.status === 'blocked',
          }"
        >
          <span class="phase-label">
            <i v-if="st.status === 'in_progress'" class="live-dot"></i>{{ st.name }}
          </span>
          <strong>{{ st.statusLabel }}</strong>
          <small>{{ stageStarted(st.startedAt) || '未开始' }}</small>
          <small v-if="stageEnded(st)">{{ stageEnded(st) }}</small>
        </button>
      </div>

      <div class="overview-sentence">
        <div>
          <strong>{{ sentence }}</strong>
          <small>
            {{
              blockers.length
                ? `另有 ${blockers.length} 项已记录阻塞或准备缺口。`
                : '尚无已记录阻塞；未检查项见环境。'
            }}
            阶段未有完成凭据时，仅显示已有产物。更新于 {{ resolveUpdatedTime(raw, progressMtime) }}
          </small>
        </div>
        <span class="tag blue">当前阶段 {{ stages.find((s) => s.isCurrent)?.name ?? '—' }}</span>
      </div>
    </section>

    <div class="overview-grid task-overview" aria-label="第二层：任务总览">
      <section class="panel span-6">
        <div class="row">
          <h2><span class="section-index">02</span>当前任务</h2>
          <button type="button" class="link" @click="jumpToDetail(currentStageTab)">执行详情 →</button>
        </div>
        <template v-if="currentStage">
          <div class="current-brief">
            <div class="row">
              <strong class="current-title">
                <i v-if="stageRunning" class="live-dot"></i>{{ currentStage.name }}
              </strong>
              <span class="tag blue">{{ currentStage.status ?? UNKNOWN }}</span>
            </div>
            <small v-if="currentStage.startedAt">{{ stageStarted(currentStage.startedAt) }}</small>
            <small v-else>尚未开始</small>
            <div v-if="stageRunning" class="activity-rail is-active is-indeterminate" role="progressbar" aria-label="阶段进行中">
              <i></i>
            </div>
          </div>
        </template>
        <div v-else class="idle-task">
          <span>当前无在途阶段</span>
          <small>正在读取 {{ DATA_FILES.progress }}…</small>
        </div>
      </section>

      <section class="panel span-3">
        <div class="row">
          <h2>Spec 任务</h2>
          <button type="button" class="link" @click="jumpToDetail('tasks')">全部 →</button>
        </div>
        <div class="summary-counts">
          <div><strong class="green-number">{{ specSummary?.completed ?? '—' }}</strong><small>完成</small></div>
          <div><strong class="blue-number">{{ specSummary?.in_progress ?? '—' }}</strong><small>进行中</small></div>
          <div><strong>{{ specSummary?.total ?? '—' }}</strong><small>总数</small></div>
        </div>
        <div class="bar"><i :style="{ width: specPercent + '%' }"></i></div>
        <small>按 {{ DATA_FILES.batchReport }} 统计</small>
      </section>

      <section class="panel span-3">
        <div class="row">
          <h2>功能清单</h2>
          <button type="button" class="link" @click="jumpToDetail('features')">全部 →</button>
        </div>
        <div class="summary-counts">
          <div><strong class="blue-number">{{ inventory ? invStats.mvp : '—' }}</strong><small>mvp</small></div>
          <div><strong class="orange-number">{{ inventory ? invStats.core : '—' }}</strong><small>core</small></div>
          <div><strong>{{ inventory ? invStats.full : '—' }}</strong><small>full</small></div>
        </div>
        <div class="bar"><i :style="{ width: (invStats.total ? Math.round((100 * invStats.mvp) / invStats.total) : 0) + '%' }"></i></div>
        <small>共 {{ invStats.total }} 项 · 按 {{ DATA_FILES.inventory }} 统计</small>
      </section>
    </div>

    <div class="overview-grid project-overview" aria-label="第三层：工程与环境">
      <section class="panel span-6">
        <div class="row">
          <h2><span class="section-index">03</span>安卓工程</h2>
          <button type="button" class="link" @click="jumpToDetail('project')">工程详情 →</button>
        </div>
        <template v-if="preflight">
          <div class="project-metrics">
            <div><strong>{{ preflightStats.passed }}/{{ preflightStats.total }}</strong><small>预检通过</small></div>
          </div>
          <div class="stack-pills">
            <span class="tag">git {{ (preflight.gitHead ?? UNKNOWN).slice(0, 7) }}</span>
          </div>
          <small>{{ preflight.projectRoot }}</small>
        </template>
        <template v-else>
          <div class="project-metrics">
            <div><strong>—</strong><small>预检状态</small></div>
          </div>
          <div class="stack-pills"><small>尚未载入预检报告</small></div>
        </template>
      </section>

      <section class="panel span-6">
        <div class="row">
          <h2>环境检查</h2>
          <button type="button" class="link" @click="jumpToDetail('project')">检查详情 →</button>
        </div>
        <div class="environment-summary">
          <div><strong>{{ preflight ? preflightStats.passed : '—' }}</strong><small>通过</small></div>
          <div><strong>{{ preflight ? preflightStats.failed : '—' }}</strong><small>失败</small></div>
          <div><strong>{{ preflight ? preflightStats.skipped : '—' }}</strong><small>跳过</small></div>
          <div><strong>{{ preflight ? preflightStats.notApplicable : '—' }}</strong><small>不适用</small></div>
        </div>
        <div class="row">
          <small>{{ preflight ? `git ${preflight.gitHead ?? UNKNOWN}` : '尚未载入环境检查报告' }}</small>
          <span v-if="preflight" class="tag" :class="preflight.result === 'passed' ? 'green' : 'orange'">{{ preflight.result ?? UNKNOWN }}</span>
          <span v-else class="tag orange">未载入报告</span>
        </div>
      </section>
    </div>

    <section class="panel blockers-overview" :class="blockers.length ? 'has-blockers' : 'all-clear'" aria-label="第四层：阻塞情况">
      <div class="row">
        <h2>
          <span class="section-index">04</span>阻塞与准备缺口
          <span class="tag" :class="blockers.length ? 'orange' : 'green'">{{ blockers.length }}</span>
        </h2>
        <button type="button" class="link">全部详情 →</button>
      </div>

      <div v-if="blockers.length" class="blocker-list">
        <div v-for="(b, i) in blockers" :key="i" class="blocker-item">
          <span class="blocker-dot"></span>
          <div><strong>{{ b }}</strong></div>
        </div>
      </div>
      <div v-else class="clear-blockers">
        尚无已记录阻塞
        <small>闭源 SDK/SO、平台配置与环境尚未完成全面核验，不能据此判断已全部就绪。</small>
      </div>
    </section>
  </template>
</template>

<style scoped>
/* 第一层：状态总览 */
.status-overview {
  padding-bottom: 0;
  border-top: 3px solid #6285df;
  background: linear-gradient(110deg, #fbfcff, #fff 65%);
}

.status-overview > .row h2 {
  margin: 0;
}

.total-time {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 11px;
  border-radius: 7px;
  background: #f0f4fc;
}

.total-time-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.total-time strong {
  font-size: 14px;
  color: #4d638b;
}

/* 阶段条 */
.phase-track {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  margin: 20px 0;
}

.phase-cell {
  text-align: left;
  padding: 13px 14px;
  background: #f7f9fc;
  border: 1px solid #e5eaf3;
  border-radius: 7px;
  min-width: 0;
}

.phase-cell:hover {
  background: #f0f4fd;
  border-color: #adc1ea;
}

.phase-cell strong,
.phase-cell small {
  display: block;
}

.phase-cell strong {
  font-size: 12px;
  margin: 6px 0;
  font-weight: 500;
}

.phase-cell small {
  font-size: 11px;
}

.phase-label {
  font-weight: 650;
  font-size: 13px;
  color: #34445c;
}

.phase-active {
  background: #eaf1ff;
  border-color: #b5c9f7;
  box-shadow: inset 0 3px #4c77dc;
}

.phase-active .phase-label,
.phase-active strong {
  color: #2858c4;
}

.phase-done {
  background: #edf8f3;
  border-color: #c6e8d9;
  box-shadow: inset 0 3px #55a68a;
}

.phase-done .phase-label,
.phase-done strong {
  color: #177657;
}

.phase-error {
  background: #fff0f0;
  border-color: #f0c8c8;
  box-shadow: inset 0 3px #d26969;
}

.phase-error .phase-label,
.phase-error strong {
  color: #b54545;
}

.live-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  background: var(--blue);
  border-radius: 50%;
  margin-right: 6px;
}

/* 摘要句 */
.overview-sentence {
  background: #f0f4fc;
  border-top: 1px solid #e0e8f7;
  margin: 0 -22px;
  padding: 14px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-radius: 0 0 10px 10px;
}

.overview-sentence strong {
  font-size: 13px;
  font-weight: 500;
  color: #3b5279;
}

.overview-sentence small {
  display: block;
  margin-top: 3px;
  font-size: 11px;
}

/* 第二层：任务总览 */
.overview-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
}

.overview-grid .panel {
  margin: 0;
  min-width: 0;
}

.span-3 {
  grid-column: span 3;
}

.span-4 {
  grid-column: span 4;
}

.span-6 {
  grid-column: span 6;
}

.span-8 {
  grid-column: span 8;
}

.task-overview,
.project-overview {
  margin-bottom: 18px;
}

.task-overview .panel,
.project-overview .panel {
  padding: 20px;
}

.task-overview > .panel:first-child {
  border-top: 3px solid #5e85dc;
  background: linear-gradient(125deg, #f8fbff, #fff 70%);
}

.task-overview > .panel:nth-child(2) {
  border-top: 3px solid #8c85c2;
}

.task-overview > .panel:nth-child(3) {
  border-top: 3px solid #61a6a1;
}

.summary-counts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin: 20px 0 14px;
}

.summary-counts strong {
  display: block;
  font-size: 26px;
  font-weight: 650;
}

.summary-counts small {
  font-size: 11px;
}

.summary-counts > div:last-child strong {
  color: #66768b;
}

.blue-number {
  color: #3766dc;
}

.orange-number {
  color: #986221;
}

.green-number {
  color: #168168;
}

.current-brief {
  padding-top: 5px;
}

.current-brief + .current-brief {
  margin-top: 12px;
}

.current-title {
  font-size: 14px;
  font-weight: 600;
  text-align: left;
}

.current-brief small {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
}

/* 当前任务进行中：不确定进度条动效（参照参考 HTML activity-rail） */
.activity-rail {
  height: 7px;
  background: #edf1f7;
  border-radius: 8px;
  overflow: hidden;
  margin: 12px 0 4px;
}

.activity-rail i {
  display: block;
  height: 100%;
  background: var(--blue);
  border-radius: 8px;
}

.activity-rail.is-indeterminate i {
  width: 35%;
  opacity: 0;
}

.activity-rail.is-active.is-indeterminate i {
  opacity: 1;
  animation: d2h-indeterminate 1.5s ease-in-out infinite;
}

@keyframes d2h-indeterminate {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(390%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .activity-rail i {
    animation: none !important;
    transform: none !important;
  }
}

.idle-task {
  padding-top: 10px;
  min-height: 92px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
  color: #65758d;
}

/* 第三层：工程与环境 */
.project-overview > .panel:first-child {
  border-top: 3px solid #65a7a3;
  background: linear-gradient(125deg, #f6fbfa, #fff 70%);
}

.project-overview > .panel:first-child .section-index {
  color: #39867f;
  background: #e7f5f1;
}

.project-overview > .panel:last-child {
  border-top: 3px solid #95a4b9;
}

.project-metrics,
.environment-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 15px 0;
}

.environment-summary {
  grid-template-columns: repeat(4, 1fr);
}

.project-metrics strong,
.environment-summary strong {
  display: block;
  font-size: 24px;
  font-weight: 600;
}

.project-metrics small,
.environment-summary small {
  font-size: 11px;
}

.stack-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 14px 0 8px;
}

.stack-pills .tag {
  color: #48736e;
  background: #edf5f2;
}

.environment-summary > div {
  padding: 7px 9px;
  border-radius: 7px;
  background: #f4f6fa;
}

.environment-summary > div:nth-child(1) {
  background: #edf8f2;
}

.environment-summary > div:nth-child(1) strong {
  color: #168168;
}

.environment-summary > div:nth-child(2) strong {
  color: #bc4a47;
}

.environment-summary > div:nth-child(3) strong {
  color: #a96825;
}

.environment-summary > div:nth-child(4) strong {
  color: #7c8798;
}

/* 第四层：阻塞情况 */
.blockers-overview {
  border-top: 3px solid #d6a25a;
  background: linear-gradient(110deg, #fffcf6, #fff 75%);
}

.blockers-overview .section-index {
  color: #9d7239;
  background: #fff0d9;
}

.blockers-overview .blocker-item {
  border-top-color: #f0e6d7;
}

.blockers-overview .blocker-item strong {
  color: #6c5435;
}

.blockers-overview .blocker-dot {
  background: #cc8e39;
}

.blockers-overview.all-clear {
  border-top: 3px solid #78ad97;
}

.blockers-overview.all-clear .section-index {
  background: #eaf6ef;
  color: #417e62;
}

.blocker-list {
  display: grid;
}

.blocker-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 0;
  border-top: 1px solid #edf0f4;
}

.blocker-item > div {
  flex: 1;
  min-width: 0;
}

.blocker-item strong {
  font-size: 12px;
}

.blocker-dot {
  width: 6px;
  height: 6px;
  background: #d9993a;
  border-radius: 50%;
  margin-top: 9px;
  flex-shrink: 0;
}

.clear-blockers {
  font-size: 13px;
  color: #547064;
}

.clear-blockers small {
  display: block;
  margin-top: 5px;
}

@media (max-width: 1100px) {
  .span-3 {
    grid-column: span 6;
  }

  .span-4 {
    grid-column: span 6;
  }

  .span-8 {
    grid-column: span 12;
  }

  .task-overview .span-6 {
    grid-column: span 12;
  }
}

@media (max-width: 760px) {
  .phase-track {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .overview-sentence {
    display: block;
  }

  .overview-sentence > .tag {
    display: inline-block;
    margin-top: 10px;
  }
}

@media (max-width: 700px) {
  .span-4,
  .span-6,
  .span-8 {
    grid-column: span 12;
  }

  .overview-sentence {
    margin: 0 -16px;
    padding: 14px 16px;
  }

  .project-overview .span-6 {
    grid-column: span 12;
  }
}
</style>
