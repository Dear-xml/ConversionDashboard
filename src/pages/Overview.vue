<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange } from '../utils/JsonOperateUtils'
import { STATUS_MAP } from '../constants/progress'
import type { RawProgress, StageStatus } from '../types/progress'

const raw = ref<RawProgress | null>(null)
let stop: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<RawProgress>('progress.json', (data) => {
    raw.value = data
  })
})

onUnmounted(() => stop?.())

const summary = computed(() => raw.value?.summary ?? null)

const stages = computed(() =>
  (raw.value?.stages ?? []).map((s) => ({
    ...s,
    statusLabel: STATUS_MAP[s.status]?.label ?? '未知',
    isCurrent: s.id === summary.value?.currentStage,
  })),
)

const blockers = computed(() => [...new Set((raw.value?.stages ?? []).flatMap((s) => s.blockers))])

const fmtTime = (iso: string | null): string => {
  if (!iso) return '未记录'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '未记录' : d.toLocaleString()
}

const stageCaption = (s: { status: StageStatus; startedAt: string | null; endedAt: string | null }): string => {
  if (s.status === 'in_progress' && s.startedAt) return `开始 ${fmtTime(s.startedAt)}`
  if (s.status === 'completed' && s.startedAt && s.endedAt) {
    const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt)
    return Number.isFinite(ms) ? `用时 ${Math.round(ms / 1000)} 秒` : '用时 未记录'
  }
  if (s.status === 'blocked') return '需处理阻塞'
  return '未开始'
}

const sentence = computed(() => {
  const s = summary.value
  if (!s) return ''
  const cur = stages.value.find((st) => st.isCurrent)
  return `当前阶段：${cur?.name ?? s.currentStage ?? '—'} · 已完成 ${s.completed} / ${s.total}`
})
</script>

<template>
  <PageHeading kicker="D2H / overview" title="迁移总览" note="阶段 → 任务 → 工程与环境 → 阻塞" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">◫</span>
    <strong>等待数据</strong>
    <small>正在读取 progress.json…</small>
  </section>

  <template v-else>
    <section class="panel status-overview" aria-label="第一层：状态总览">
      <div class="row">
        <h2><span class="section-index">01</span>状态总览</h2>
        <div class="total-time"><small>总用时</small><strong>未记录</strong></div>
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
          <small>{{ stageCaption(st) }}</small>
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
            阶段未有完成凭据时，仅显示已有产物。更新于 {{ fmtTime(raw.updatedAt) }}
          </small>
        </div>
        <span class="tag blue">当前阶段 {{ stages.find((s) => s.isCurrent)?.name ?? '—' }}</span>
      </div>
    </section>

    <div class="overview-grid task-overview" aria-label="第二层：任务总览">
      <section class="panel span-6">
        <div class="row">
          <h2><span class="section-index">02</span>当前任务</h2>
          <button type="button" class="link">执行详情 →</button>
        </div>
        <div class="idle-task">
          <span>当前无在途任务</span>
          <small>等待调度或补齐前置条件</small>
        </div>
      </section>

      <section class="panel span-3">
        <div class="row">
          <h2>Spec 任务</h2>
          <button type="button" class="link">全部 →</button>
        </div>
        <div class="summary-counts">
          <div><strong>—</strong><small>完成</small></div>
          <div><strong class="blue-number">—</strong><small>进行中</small></div>
          <div><strong>—</strong><small>总数</small></div>
        </div>
        <div class="bar"><i style="width: 0%"></i></div>
        <small>完成按当前有效验收计（未接入）</small>
      </section>

      <section class="panel span-3">
        <div class="row">
          <h2>功能清单</h2>
          <button type="button" class="link">全部 →</button>
        </div>
        <div class="summary-counts">
          <div><strong>—</strong><small>完成</small></div>
          <div><strong class="blue-number">—</strong><small>进行中</small></div>
          <div><strong>—</strong><small>总数</small></div>
        </div>
        <div class="bar"><i style="width: 0%"></i></div>
        <small>完成要求所有未排除范围通过（未接入）</small>
      </section>
    </div>

    <div class="overview-grid project-overview" aria-label="第三层：工程与环境">
      <section class="panel span-6">
        <div class="row">
          <h2><span class="section-index">03</span>安卓工程</h2>
          <button type="button" class="link">工程详情 →</button>
        </div>
        <div class="project-metrics">
          <div><strong>—</strong><small>源文件</small></div>
          <div><strong>—</strong><small>物理行数</small></div>
          <div><strong>—</strong><small>已记录依赖</small></div>
        </div>
        <div class="stack-pills"><small>技术栈未采集</small></div>
        <small>尚未接入工程概览报告</small>
      </section>

      <section class="panel span-6">
        <div class="row">
          <h2>环境检查</h2>
          <button type="button" class="link">检查详情 →</button>
        </div>
        <div class="environment-summary">
          <div><strong>—</strong><small>通过</small></div>
          <div><strong>—</strong><small>失败</small></div>
          <div><strong>—</strong><small>缺失</small></div>
          <div><strong>—</strong><small>未检查</small></div>
        </div>
        <div class="row">
          <small>尚未载入环境检查报告</small>
          <span class="tag orange">未载入报告</span>
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

.summary-counts > div:first-child strong {
  color: #168168;
}

.summary-counts > div:last-child strong {
  color: #66768b;
}

.blue-number {
  color: #3766dc;
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
