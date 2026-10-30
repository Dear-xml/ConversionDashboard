<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange } from '../utils/JsonOperateUtils'
import { resolveUpdatedTime } from '../utils/datetime'
import { DEVELOPMENT_TONE, RUN_TONE, type Tone } from '../constants/batchReport'
import type { BatchReport } from '../types/batchReport'
import { UNKNOWN, DATA_FILES } from '../constants/common'

const FILE = DATA_FILES.batchReport

const raw = ref<BatchReport | null>(null)
const fileMtime = ref<number | null>(null)
const query = ref('')
const filter = ref('')
const page = ref(1)
const pageSize = ref(20)
let stop: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<BatchReport>(FILE, (d, meta) => {
    raw.value = d
    fileMtime.value = meta.mtimeMs ?? null
  })
})

onUnmounted(() => stop?.())

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

const summary = computed(() => raw.value?.summary ?? null)

const tasks = computed(() => {
  const list = raw.value?.tasks ?? []
  const q = query.value.trim().toLowerCase()
  return list.filter((t) => {
    const hitQuery =
      !q || (t.task_id + ' ' + t.page_id + ' ' + t.kind).toLowerCase().includes(q)
    const hitFilter =
      !filter.value || t.development === filter.value
    return hitQuery && hitFilter
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(tasks.value.length / pageSize.value)))

const pagedTasks = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return tasks.value.slice(start, start + pageSize.value)
})

const goPage = (p: number): void => {
  page.value = Math.min(Math.max(1, p), totalPages.value)
}

const tone = (map: Record<string, Tone>, v: string): Tone => map[v] ?? 'muted'
</script>

<template>
  <PageHeading kicker="D2H / tasks" title="Spec 执行" note="页面批次报告 · 实现、构建、验证与阻塞原因并列" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">☑</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…</small>
  </section>

  <template v-else>
    <section class="panel">
      <div class="row">
        <h2>批次概览</h2>
        <span class="tag blue">更新于 {{ updatedText }}</span>
      </div>
      <div class="summary-counts">
        <div><strong>{{ summary?.total ?? 0 }}</strong><small>总数</small></div>
        <div><strong>{{ summary?.pending ?? 0 }}</strong><small>待执行</small></div>
        <div><strong class="blue-number">{{ summary?.in_progress ?? 0 }}</strong><small>进行中</small></div>
        <div><strong class="green-number">{{ summary?.completed ?? 0 }}</strong><small>已完成</small></div>
        <div><strong class="orange-number">{{ summary?.blocked ?? 0 }}</strong><small>已阻塞</small></div>
        <div><strong class="red-number">{{ summary?.failed ?? 0 }}</strong><small>失败</small></div>
      </div>
    </section>

    <section class="panel">
      <div class="toolbar">
        <input
          v-model="query"
          type="search"
          aria-label="搜索 Spec"
          placeholder="搜索 task_id / page_id / 类型"
          @input="page = 1"
        />
        <select v-model="filter" aria-label="筛选 Spec" @change="page = 1">
          <option value="">全部 Spec</option>
          <option value="pending">pending</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
          <option value="blocked">blocked</option>
          <option value="failed">failed</option>
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
              <th>Spec</th>
              <th>类型</th>
              <th>评分</th>
              <th>依赖</th>
              <th>实现 / 构建 / 验证</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in pagedTasks" :key="t.task_id">
              <td class="title">
                <strong>{{ t.task_id }}</strong>
                <small>{{ t.page_id }} · {{ t.spec }}</small>
              </td>
              <td><span class="tag">{{ t.kind ?? UNKNOWN}}</span></td>
              <td>
                <strong class="score">{{ t.page_score }}</strong>
                <small>E{{ t.enablement }} · R{{ t.ordinary_reachability }} · S{{ t.shallowness }}</small>
              </td>
              <td class="title"><small>{{ t.dependencies.join(', ') || '—' }}</small></td>
              <td>
                <span class="tag" :class="tone(DEVELOPMENT_TONE, t.development)">{{ t.development }}</span>
                <span class="tag" :class="tone(RUN_TONE, t.build)">{{ t.build ?? UNKNOWN }}</span>
                <span class="tag" :class="tone(RUN_TONE, t.validation)">{{ t.validation ?? UNKNOWN }}</span>
              </td>
              <td class="title"><small>{{ t.blockers.length ? t.blockers.join('；') : '无已知阻塞' }}</small></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!tasks.length" class="empty">没有符合条件的 Spec</div>

      <div v-else class="pagination">
        <button type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span class="page-info">{{ page }} / {{ totalPages }} · 共 {{ tasks.length }} 条</span>
        <button type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      </div>
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

.blue-number {
  color: var(--blue);
}

.green-number {
  color: var(--green);
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

.toolbar input[type='search'] {
  padding: 8px 11px;
  min-width: 220px;
  border: 1px solid #dce3ec;
  border-radius: 7px;
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

td .tag {
  margin: 1px 3px 1px 0;
}

.score {
  font-size: 18px;
  font-weight: 650;
  color: #34445c;
}

.empty {
  text-align: center;
  padding: 35px;
  color: var(--muted);
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

@media (max-width: 900px) {
  .summary-counts {
    grid-template-columns: repeat(3, 1fr);
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

  .toolbar input[type='search'] {
    min-width: 0;
    width: 100%;
  }
}
</style>
