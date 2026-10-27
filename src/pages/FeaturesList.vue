<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import { watchXlsx, type Sheet } from '../utils/xlsx'

const FILE = 'feature-analysis-v2/feature-list.xlsx'

const sheets = ref<Sheet[]>([])
const activeName = ref('')
let stop: (() => void) | undefined

onMounted(() => {
  stop = watchXlsx(
    FILE,
    (parsed) => {
      sheets.value = parsed
      if (!parsed.some((s) => s.name === activeName.value)) {
        activeName.value = parsed[0]?.name ?? ''
      }
    },
    { pollMs: 60_000 },
  )
})

onUnmounted(() => stop?.())

const activeSheet = computed(() => sheets.value.find((s) => s.name === activeName.value) ?? null)

const header = computed(() => activeSheet.value?.rows[0] ?? [])

const bodyRows = computed(() => activeSheet.value?.rows.slice(1) ?? [])
</script>

<template>
  <PageHeading kicker="D2H / features" title="功能清单" note="AntennaPod 功能清单 · feature-list.xlsx 多 sheet" />

  <div class="sub-tabs">
    <button
      v-for="s in sheets"
      :key="s.name"
      type="button"
      class="sub-tab"
      :class="{ active: activeName === s.name }"
      @click="activeName = s.name"
    >
      {{ s.name }}
    </button>
  </div>

  <section v-if="!activeSheet" class="panel placeholder">
    <span class="glyph">☷</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…</small>
  </section>

  <section v-else class="panel">
    <div class="row">
      <h2>{{ activeSheet.name }}</h2>
      <span class="tag blue">{{ bodyRows.length }} 行</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="(h, i) in header" :key="i">{{ h }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in bodyRows" :key="ri">
            <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.sub-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.sub-tab {
  padding: 7px 14px;
  border: 1px solid #dce3ec;
  background: #fff;
  color: #34445c;
  border-radius: 7px;
  font-size: 13px;
}

.sub-tab.active {
  background: #eaf0ff;
  color: #2d59c2;
  border-color: #90b2f9;
  font-weight: 600;
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

td {
  min-width: 120px;
}
</style>
