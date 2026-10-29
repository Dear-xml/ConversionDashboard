<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange } from '../utils/JsonOperateUtils'
import { resolveUpdatedTime } from '../utils/datetime'
import { CHECK_STATUS_TONE, type Tone } from '../constants/preflight'
import type { PreflightReport } from '../types/preflight'
import { UNKNOWN, DATA_FILES } from '../constants/common'

const FILE = DATA_FILES.preflight

const raw = ref<PreflightReport | null>(null)
const fileMtime = ref<number | null>(null)
let stop: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<PreflightReport>(FILE, (d, meta) => {
    raw.value = d
    fileMtime.value = meta.mtimeMs ?? null
  })
})

onUnmounted(() => stop?.())

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

const statusCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const c of raw.value?.checks ?? []) counts[c.status] = (counts[c.status] ?? 0) + 1
  return counts
})

const tone = (map: Record<string, Tone>, v: string): Tone => map[v] ?? 'muted'

/** evidence 归一化为可展示的行列表（对象 → [分类] 前缀 + 各条；数组 → 各条） */
const evidenceLines = (c: PreflightReport['checks'][number]): string[] => {
  const e = c.evidence
  if (Array.isArray(e)) return e
  const lines: string[] = []
  for (const [group, items] of Object.entries(e)) {
    for (const item of items) lines.push(`[${group}] ${item}`)
  }
  return lines
}
</script>

<template>
  <PageHeading kicker="D2H / project" title="工程与环境" note="规模、技术依赖、环境检查及外部准备的完整记录" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">▧</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…</small>
  </section>

  <template v-else>
    <section class="panel">
      <div class="row">
        <h2>预检概览</h2>
        <span class="tag" :class="raw.result === 'passed' ? 'green' : 'orange'">{{ raw.result ?? UNKNOWN }}</span>
      </div>
      <div class="summary-counts">
        <div><strong>{{ raw.checks.length }}</strong><small>检查项</small></div>
        <div><strong class="green-number">{{ statusCounts['passed'] ?? 0 }}</strong><small>passed</small></div>
        <div><strong class="blue-number">{{ statusCounts['skipped'] ?? 0 }}</strong><small>skipped</small></div>
        <div><strong>{{ statusCounts['not_applicable'] ?? 0 }}</strong><small>not_applicable</small></div>
      </div>
      <div class="meta-list">
        <div class="meta-item"><small>安卓工程</small><span class="meta-value">{{ raw.projectRoot }}</span></div>
        <div class="meta-item"><small>鸿蒙工程</small><span class="meta-value">{{ raw.harmonyProject }}</span></div>
        <div class="meta-item"><small>git head</small><span class="meta-value">{{ raw.gitHead }}</span></div>
        <div class="meta-item"><small>更新时间</small><span class="meta-value">{{ updatedText }}</span></div>
      </div>
    </section>

    <section class="panel">
      <h2>检查明细</h2>
      <div class="check-list">
        <div v-for="c in raw.checks" :key="c.id" class="check-item">
          <div class="check-head">
            <strong class="check-id">{{ c.id }}</strong>
            <span class="tag" :class="tone(CHECK_STATUS_TONE, c.status)">{{ c.status ?? UNKNOWN }}</span>
          </div>
          <p class="check-summary">{{ c.summary }}</p>
          <ul v-if="evidenceLines(c).length" class="evidence">
            <li v-for="(line, i) in evidenceLines(c)" :key="i">{{ line }}</li>
          </ul>
        </div>
      </div>
    </section>
  </template>
</template>

<style scoped>
.summary-counts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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

.green-number {
  color: var(--green);
}

.blue-number {
  color: var(--blue);
}

.meta-list {
  display: grid;
  gap: 2px;
  margin-top: 16px;
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

.check-list {
  display: grid;
  gap: 4px;
}

.check-item {
  padding: 12px 0;
  border-top: 1px solid #edf0f4;
}

.check-item:first-child {
  border-top: 0;
}

.check-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.check-id {
  font-size: 13px;
  font-weight: 650;
  color: #26364d;
}

.check-summary {
  font-size: 12px;
  color: #41536e;
  margin: 4px 0;
}

.evidence {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: #61728a;
}

.evidence li {
  overflow-wrap: anywhere;
  margin: 2px 0;
}
</style>
