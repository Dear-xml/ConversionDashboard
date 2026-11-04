<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import DirectoryTree from '../components/DirectoryTree.vue'
import { onJsonChange } from '../utils/JsonOperateUtils'
import { resolveUpdatedTime } from '../utils/datetime'
import type { ArchitecturePlan } from '../types/architecturePlan'
import { DATA_FILES } from '../constants/common'

const FILE = DATA_FILES.architecturePlan
/** 目录树默认展开深度（根 + 一级子目录） */
const TREE_DEFAULT_DEPTH = 2

const raw = ref<ArchitecturePlan | null>(null)
const fileMtime = ref<number | null>(null)
let stop: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<ArchitecturePlan>(FILE, (d, meta) => {
    raw.value = d
    fileMtime.value = meta.mtimeMs ?? null
  })
})

onUnmounted(() => stop?.())

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

const proposals = computed(() => raw.value?.proposals ?? [])

/** 页内锚点导航：项目概览 / 各方案 / 风险与注意 */
const secLinks = computed(() => [
  { id: 'sec-project', label: '项目概览' },
  ...proposals.value.map((p, i) => ({ id: `sec-proposal-${i}`, label: p.name })),
  { id: 'sec-attention', label: '风险与注意' },
])

const scrollToSec = (id: string): void => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <PageHeading kicker="D2H / analysis" title="架构分析与设计" :note="`结构分析 · 方案对照 · ${FILE} 实时渲染`" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">⌕</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…（尚未生成架构规划时此页为空）</small>
  </section>

  <template v-else>
    <!-- 页内模块导航（吸顶，点击滚动到对应区块） -->
    <nav class="sec-nav" aria-label="页内模块导航">
      <button
        v-for="link in secLinks"
        :key="link.id"
        type="button"
        class="sec-link"
        :title="link.label"
        @click="scrollToSec(link.id)"
      >
        {{ link.label }}
      </button>
      <span class="tag nav-updated">更新于 {{ updatedText }}</span>
    </nav>

    <!-- 01 项目概览 -->
    <section id="sec-project" class="panel sec-anchor">
      <div class="row">
        <h2>项目概览</h2>
        <span class="tag">更新于 {{ updatedText }}</span>
      </div>
      <p class="project-name">{{ raw.project?.name || '未命名项目' }}</p>
      <p class="project-summary">{{ raw.project?.summary }}</p>
      <div v-if="raw.project?.androidRoot || raw.project?.targetRoot" class="roots">
        <div class="root-item">
          <small>Android 源工程</small>
          <span>{{ raw.project.androidRoot || '—' }}</span>
        </div>
        <div class="root-item">
          <small>HarmonyOS 目标工程</small>
          <span>{{ raw.project.targetRoot || '—' }}</span>
        </div>
      </div>
      <ul v-if="raw.project?.scope?.length" class="scope-list">
        <li v-for="(s, i) in raw.project.scope" :key="i">{{ s }}</li>
      </ul>
    </section>

    <!-- 02 架构方案（并列排布，目录树直接展示，方便对照） -->
    <div v-if="proposals.length" class="proposal-grid" aria-label="架构方案对照">
      <section
        v-for="(p, i) in proposals"
        :id="`sec-proposal-${i}`"
        :key="p.id"
        class="panel sec-anchor proposal-panel"
      >
        <div class="row">
          <h2>{{ p.name }}</h2>
          <code class="proposal-id">{{ p.id }}</code>
        </div>
        <p class="proposal-summary">{{ p.summary }}</p>

        <div v-if="p.decisions?.length" class="decisions">
          <small class="block-label">关键决策（点击展开详情）</small>
          <details v-for="(d, j) in p.decisions" :key="j" class="decision-item">
            <summary>{{ d.title }}</summary>
            <p>{{ d.description }}</p>
          </details>
        </div>

        <div v-if="p.directoryTree" class="tree-wrap">
          <small class="block-label">目录树</small>
          <DirectoryTree :node="p.directoryTree" :depth="0" :default-expand-depth="TREE_DEFAULT_DEPTH" />
        </div>
      </section>
    </div>

    <!-- 03 风险与注意 -->
    <section id="sec-attention" class="panel sec-anchor">
      <div class="row">
        <h2>风险与注意</h2>
        <span v-if="raw.attentionPoints?.length" class="tag orange">{{ raw.attentionPoints.length }} 项</span>
      </div>
      <div v-if="raw.attentionPoints?.length" class="attention-list">
        <details v-for="(a, i) in raw.attentionPoints" :key="i" class="attention-item">
          <summary>{{ a.title }}</summary>
          <p>{{ a.description }}</p>
        </details>
      </div>
      <div v-else class="empty-inline">暂无风险记录</div>
    </section>
  </template>
</template>

<style scoped>
/* 页内模块导航：吸顶横条（浅蓝底与普通面板区分，点击平滑滚动到区块） */
.sec-nav {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-bottom: 20px;
  background: linear-gradient(180deg, #eef3fd, #e8eefa);
  border: 1px solid #cfdef7;
  border-radius: 10px;
  box-shadow: 0 2px 8px #29456a10;
  backdrop-filter: blur(4px);
}

.sec-link {
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 7px;
  background: #fff;
  border-color: #c8d8f2;
  color: #2d59c2;
}

.sec-link:hover {
  background: #ffffff;
  border-color: var(--blue);
  color: var(--blue);
}

.nav-updated {
  margin-left: auto;
  background: #ffffffb3;
  color: #4d638b;
}

.nav-updated {
  margin-left: auto;
  background: #ffffffb3;
  color: #4d638b;
}

/* 锚点跳转落点留出导航条高度 */
.sec-anchor {
  scroll-margin-top: 64px;
}

/* 两方案并列：宽屏左右对照，窄屏回落单列 */
.proposal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.proposal-panel {
  margin-bottom: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 树区域在并列面板内自适应拉伸、独立滚动 */
.proposal-panel .tree-wrap {
  flex: 1;
  min-height: 0;
  max-height: 560px;
}

.project-name {
  font-size: 17px;
  font-weight: 650;
  margin: 0 0 6px;
}

.project-summary {
  margin: 0 0 12px;
  color: #48586f;
  line-height: 1.65;
}

.roots {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 0 0 12px;
}

.root-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f9fbfe;
}

.root-item small {
  font-size: 11px;
}

.root-item span {
  font-size: 12px;
  color: #34445c;
  overflow-wrap: anywhere;
}

.scope-list {
  margin: 0;
  padding-left: 18px;
  color: #48586f;
  line-height: 1.7;
  font-size: 13px;
}

.proposal-id {
  font-size: 11px;
  color: var(--muted);
  background: #f0f4fa;
  padding: 2px 7px;
  border-radius: 5px;
}

.proposal-summary {
  margin: 0 0 12px;
  line-height: 1.65;
  color: #48586f;
  font-size: 13px;
}

.block-label {
  display: block;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 1px;
  margin-bottom: 6px;
}

.decisions {
  margin: 0 0 14px;
}

/* 决策条目：默认仅显示标题摘要，点击展开详情 */
.decision-item {
  padding: 0;
  border-top: 1px solid #edf0f4;
}

.decision-item:first-of-type {
  border-top: 0;
}

.decision-item summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  font-size: 13px;
  font-weight: 600;
  color: #34445c;
  border-radius: 6px;
}

.decision-item summary::-webkit-details-marker {
  display: none;
}

.decision-item summary::before {
  content: '▸';
  color: #8191a8;
  font-size: 12px;
  transition: transform 0.15s;
  flex-shrink: 0;
}

.decision-item[open] summary::before {
  transform: rotate(90deg);
}

.decision-item summary:hover {
  background: #f5f8fe;
  color: var(--blue);
}

.decision-item p {
  margin: 2px 0 8px;
  padding: 0 4px 0 24px;
  font-size: 12px;
  color: #48586f;
  line-height: 1.65;
}

.tree-wrap {
  padding: 10px 12px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: #fafbfe;
  max-height: 480px;
  overflow: auto;
}

.attention-list {
  display: grid;
  gap: 4px;
}

/* 注意点条目：同样默认标题、点击展开 */
.attention-item {
  padding: 0;
  border-top: 1px solid #edf0f4;
}

.attention-item:first-child {
  border-top: 0;
}

.attention-item summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  font-size: 13px;
  font-weight: 600;
  color: #34445c;
  border-radius: 6px;
}

.attention-item summary::-webkit-details-marker {
  display: none;
}

.attention-item summary::before {
  content: '▸';
  color: #8191a8;
  font-size: 12px;
  transition: transform 0.15s;
  flex-shrink: 0;
}

.attention-item[open] summary::before {
  transform: rotate(90deg);
}

.attention-item summary:hover {
  background: #f5f8fe;
  color: var(--blue);
}

.attention-item p {
  margin: 2px 0 8px;
  padding: 0 4px 0 24px;
  font-size: 12px;
  color: #48586f;
  line-height: 1.65;
}

.empty-inline {
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .proposal-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .roots {
    grid-template-columns: 1fr;
  }
}
</style>
