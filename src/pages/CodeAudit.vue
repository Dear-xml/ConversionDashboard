<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { onJsonChange } from '../utils/JsonOperateUtils'
import { resolveUpdatedTime } from '../utils/datetime'
import { UNKNOWN, DATA_FILES } from '../constants/common'
import type { CodeStats, CodeStatsSide } from '../types/codeStats'

const FILE = DATA_FILES.codeStats

const raw = ref<CodeStats | null>(null)
const fileMtime = ref<number | null>(null)
let stop: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<CodeStats>(FILE, (d, meta) => {
    raw.value = d
    fileMtime.value = meta.mtimeMs ?? null
  })
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
</script>

<template>
  <PageHeading kicker="D2H / code-audit" title="代码审计" :note="`双端代码规模 · 模块 · 依赖 · 超大文件 · ${FILE} 实时渲染`" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">∑</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…（尚未生成代码审计报告时此页为空）</small>
  </section>

  <template v-else>
    <!-- 01 双端对照 -->
    <section class="panel">
      <div class="row">
        <h2><span class="section-index">01</span>双端对照</h2>
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
        <h2><span class="section-index">{{ String(si + 2).padStart(2, '0') }}</span>{{ sideLabel(s.key) }} 代码规模</h2>
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
        <h2><span class="section-index">{{ String(sides.length + 2).padStart(2, '0') }}</span>注意事项</h2>
        <span v-if="raw.notes.length" class="tag orange">{{ raw.notes.length }} 项</span>
      </div>
      <ul v-if="raw.notes.length" class="question-list">
        <li v-for="(q, i) in raw.notes" :key="i">{{ q }}</li>
      </ul>
      <div v-else class="empty-inline">无注意事项</div>
    </section>
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
