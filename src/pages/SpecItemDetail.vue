<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { marked } from 'marked'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange, readText } from '../utils/JsonOperateUtils'
import { resolveUpdatedTime, formatTime } from '../utils/datetime'
import { jumpToDetail } from '../utils/navigation'
import { DEVELOPMENT_TONE, RUN_TONE, type Tone } from '../constants/batchReport'
import type { BatchReport } from '../types/batchReport'
import { UNKNOWN, DATA_FILES } from '../constants/common'

type Task = BatchReport['tasks'][number]

const route = useRoute()

const raw = ref<BatchReport | null>(null)
const fileMtime = ref<number | null>(null)
const specMd = ref('')
const specError = ref('')
let stop: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<BatchReport>(DATA_FILES.batchReport, (d, meta) => {
    raw.value = d
    fileMtime.value = meta.mtimeMs ?? null
  })
})

onUnmounted(() => stop?.())

const taskId = computed(() => String(route.params.taskId ?? ''))

const task = computed<Task | null>(() => {
  const id = taskId.value
  return raw.value?.tasks.find((t) => t.task_id === id) ?? null
})

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

/** 页面中文路径标题（page_path），无则回退 page_id */
const pageTitle = computed(
  () => task.value?.page_path?.join(' / ') || task.value?.page_id || taskId.value,
)

// 按需加载 spec.md（page-specs/<package>/spec.md）
const loadSpec = async (): Promise<void> => {
  specMd.value = ''
  specError.value = ''
  const t = task.value
  if (!t?.package) return
  try {
    specMd.value = await readText(`page-specs/${t.package}/spec.md`)
  } catch {
    specError.value = 'spec.md 未生成或不可读'
  }
}

watch(taskId, () => void loadSpec(), { immediate: false })
watch(
  () => task.value?.package,
  (pkg, old) => {
    if (pkg && pkg !== old) void loadSpec()
  },
  { immediate: true },
)

const specHtml = computed(() => {
  if (!specMd.value) return ''
  return marked.parse(specMd.value, { async: false }) as string
})

const tone = (map: Record<string, Tone>, v: string): Tone => map[v] ?? 'muted'

const evidenceGroups = computed(() => {
  const t = task.value
  if (!t) return []
  return [
    { label: 'implementation_files', items: t.implementation_files },
    { label: 'test_files', items: t.test_files },
    { label: 'android_evidence', items: t.android_evidence },
    { label: 'build_evidence', items: t.build_evidence },
    { label: 'test_evidence', items: t.test_evidence },
  ].filter((g) => g.items && g.items.length > 0)
})

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
</script>

<template>
  <PageHeading :kicker="`D2H / spec / ${taskId}`" :title="pageTitle" :note="task ? task.spec : ''">
    <button type="button" class="link" @click="jumpToDetail('tasks')">← 返回列表</button>
  </PageHeading>

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">☑</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ DATA_FILES.batchReport }}…</small>
  </section>

  <section v-else-if="!task" class="panel placeholder">
    <span class="glyph">☑</span>
    <strong>未找到 {{ taskId }}</strong>
    <small>该 Spec 不在当前批次报告中</small>
  </section>

  <template v-else>
    <section class="panel">
      <div class="row">
        <h2>状态</h2>
        <span class="tag">更新于 {{ updatedText }}</span>
      </div>
      <div class="status-tags">
        <span class="tag" :class="tone(DEVELOPMENT_TONE, task.development)">{{ task.development ?? UNKNOWN }}</span>
        <span class="tag" :class="tone(RUN_TONE, task.build)">{{ task.build ?? UNKNOWN }}</span>
        <span class="tag" :class="tone(RUN_TONE, task.validation)">{{ task.validation ?? UNKNOWN }}</span>
      </div>
      <div class="meta-grid">
        <div><small>task_id</small><span>{{ task.task_id }}</span></div>
        <div><small>page_id</small><span>{{ task.page_id }}</span></div>
        <div><small>类型</small><span>{{ task.kind ?? UNKNOWN }}</span></div>
        <div><small>评分</small><span>{{ task.page_score }}（E{{ task.enablement }} · R{{ task.ordinary_reachability }} · S{{ task.shallowness }}）</span></div>
        <div><small>依赖</small><span>{{ task.dependencies.join(', ') || '—' }}</span></div>
        <div><small>package</small><span>{{ task.package }}</span></div>
        <div><small>开始</small><span>{{ formatTime(task.started_at) }}</span></div>
        <div><small>完成</small><span>{{ formatTime(task.ended_at) }}</span></div>
      </div>
    </section>

    <section v-if="task.blockers.length" class="panel warn-panel">
      <h2>阻塞</h2>
      <ul class="plain-list">
        <li v-for="(b, i) in task.blockers" :key="i">{{ b }}</li>
      </ul>
    </section>

    <section v-if="task.differences.length" class="panel warn-panel">
      <h2>差异记录</h2>
      <ul class="plain-list">
        <li v-for="(d, i) in task.differences" :key="i">{{ d }}</li>
      </ul>
    </section>

    <section v-if="evidenceGroups.length" class="panel">
      <h2>证据</h2>
      <div v-for="g in evidenceGroups" :key="g.label" class="evidence-group">
        <small>{{ g.label }}</small>
        <ul class="plain-list">
          <li v-for="(item, i) in strList(g.items)" :key="i">{{ item }}</li>
        </ul>
      </div>
    </section>

    <section v-if="task.history.length" class="panel">
      <h2>历史</h2>
      <ul class="plain-list history">
        <li v-for="(h, i) in task.history" :key="i">
          <small>{{ h.timestamp ? formatTime(h.timestamp) : '未记录' }}</small>
          <span>{{ h.details }}</span>
        </li>
      </ul>
    </section>

    <section class="panel">
      <div class="row">
        <h2>Spec 文档</h2>
        <small>{{ task.spec }}</small>
      </div>
      <div v-if="specError" class="spec-empty">{{ specError }}</div>
      <div v-else-if="!specHtml" class="spec-empty">读取中…</div>
      <!-- 内容来自本地 .migration 产物 spec.md -->
      <div class="md-body" v-html="specHtml"></div>
    </section>
  </template>
</template>

<style scoped>
.status-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 10px 0 16px;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.meta-grid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.meta-grid span {
  font-size: 13px;
  color: #34445c;
  overflow-wrap: anywhere;
}

.warn-panel {
  border-top: 3px solid #cc8e39;
}

.plain-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: #41536e;
}

.plain-list li {
  overflow-wrap: anywhere;
  margin: 3px 0;
}

.history li {
  list-style: none;
}

.evidence-group {
  margin-bottom: 12px;
}

.evidence-group small {
  color: var(--muted);
}

.spec-empty {
  color: var(--muted);
  font-size: 13px;
  padding: 18px 0;
}

/* markdown 渲染基础样式 */
/* 容器横向滚动兜底：表格/代码超宽时在面板内滚动，不撑破页面 */
.md-body {
  overflow-x: auto;
}

.md-body :deep(h1) {
  font-size: 20px;
  margin: 4px 0 12px;
}

.md-body :deep(h2) {
  font-size: 16px;
  margin: 22px 0 8px;
  color: #26364d;
}

.md-body :deep(h3) {
  font-size: 14px;
  margin: 16px 0 6px;
}

.md-body :deep(p) {
  font-size: 13px;
  margin: 8px 0;
  overflow-wrap: anywhere;
}

.md-body :deep(ul),
.md-body :deep(ol) {
  font-size: 13px;
  padding-left: 20px;
  margin: 6px 0;
}

.md-body :deep(li) {
  margin: 3px 0;
  overflow-wrap: anywhere;
}

.md-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin: 10px 0;
}

.md-body :deep(th) {
  background: #f9fafc;
  color: var(--muted);
  font-weight: 500;
  text-align: left;
}

.md-body :deep(td),
.md-body :deep(th) {
  border: 1px solid #e5eaf3;
  padding: 6px 10px;
  vertical-align: top;
  /* 长路径/代码可断行，避免表格撑破容器 */
  overflow-wrap: anywhere;
  word-break: break-word;
}

.md-body :deep(code) {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  background: #f4f3ec;
  padding: 2px 5px;
  border-radius: 4px;
  overflow-wrap: anywhere;
}

.md-body :deep(pre) {
  overflow-x: auto;
}

.md-body :deep(strong) {
  color: #26364d;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .meta-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .meta-grid {
    grid-template-columns: 1fr;
  }

  /* 标题行窄屏允许换行，spec 路径不挤压标题 */
  .panel > .row {
    flex-wrap: wrap;
  }

  .panel > .row small {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}
</style>
