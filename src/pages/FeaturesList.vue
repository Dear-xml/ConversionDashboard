<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange } from '../utils/JsonOperateUtils'
import { resolveUpdatedTime } from '../utils/datetime'
import { RELEASE_STAGE_TONE, CONFIDENCE_TONE, type Tone } from '../constants/inventory'
import type { FeatureInventory } from '../types/inventory'
import { UNKNOWN } from '../constants/common'

const FILE = 'feature-analysis/inventory.json'

const raw = ref<FeatureInventory | null>(null)
const fileMtime = ref<number | null>(null)
const page = ref(1)
const pageSize = ref(20)
const stageFilter = ref('')
let stop: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<FeatureInventory>(FILE, (d, meta) => {
    raw.value = d
    fileMtime.value = meta.mtimeMs ?? null
  })
})

onUnmounted(() => stop?.())

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

const features = computed(() => raw.value?.features ?? [])

const stageStats = computed(() => {
  const stats: Record<string, number> = {}
  for (const f of features.value) stats[f.release_stage] = (stats[f.release_stage] ?? 0) + 1
  return stats
})

const filtered = computed(() => {
  const list = features.value
  return stageFilter.value ? list.filter((f) => f.release_stage === stageFilter.value) : list
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))

const pagedFeatures = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

const goPage = (p: number): void => {
  page.value = Math.min(Math.max(1, p), totalPages.value)
}

const android = (
  f: FeatureInventory['features'][number],
): { status: string; confidence: string } | null => f.implementations?.android ?? null

const tone = (map: Record<string, Tone>, v: string): Tone => map[v] ?? 'muted'

const stageTone = (v: string): Tone => RELEASE_STAGE_TONE[v] ?? 'muted'
const stageLabel = (v: string): string => v ?? UNKNOWN

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
  <PageHeading kicker="D2H / features" title="功能清单" note="功能清单分析 · inventory.json 实时渲染" />

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
      <div class="toolbar">
        <select v-model="stageFilter" aria-label="筛选交付层" @change="page = 1">
          <option value="">全部层级</option>
          <option value="mvp">mvp</option>
          <option value="core">core</option>
          <option value="full">full</option>
        </select>
        <select v-model="pageSize" aria-label="每页条数" @change="page = 1">
          <option :value="10">10 条/页</option>
          <option :value="20">20 条/页</option>
          <option :value="50">50 条/页</option>
        </select>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>层级路径</th>
              <th>类型</th>
              <th>触发 → 效果</th>
              <th>交付层</th>
              <th>能力键</th>
              <th>置信度</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in pagedFeatures" :key="f.capability_key">
              <td class="title nowrap">
                <strong>{{ f.path.join(' / ') || '—' }}</strong>
                <small>{{ f.entry_context }}</small>
              </td>
              <td><span class="tag">{{ f.kind ?? UNKNOWN }}</span></td>
              <td class="title">
                {{ f.trigger }} → {{ f.effect }}
                <small v-if="f.conditions.length">条件：{{ f.conditions.join('；') }}</small>
                <small v-if="f.notes">{{ f.notes }}</small>
              </td>
              <td><span class="tag" :class="stageTone(f.release_stage)">{{ stageLabel(f.release_stage) }}</span></td>
              <td class="title nowrap"><small>{{ f.capability_key }}</small></td>
              <td>
                <span class="tag" :class="tone(CONFIDENCE_TONE, android(f)?.confidence ?? '')">
                  {{ android(f)?.confidence ?? '—' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!filtered.length" class="empty">没有符合条件的功能</div>
      <div v-else class="pagination">
        <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span class="page-info">{{ page }} / {{ totalPages }} · 共 {{ filtered.length }} 条</span>
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
  padding: 10px 12px;
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

.nowrap {
  white-space: nowrap;
}

.empty {
  text-align: center;
  padding: 35px;
  color: var(--muted);
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
}
</style>
