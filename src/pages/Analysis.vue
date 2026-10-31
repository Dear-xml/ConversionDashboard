<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeading from '../components/PageHeading.vue'
import DirectoryTree from '../components/DirectoryTree.vue'
import { onJsonChange, writeJsonPatch } from '../utils/JsonOperateUtils'
import { resolveUpdatedTime } from '../utils/datetime'
import type { ArchitecturePlan, ArchitectureProposal } from '../types/architecturePlan'
import { UNKNOWN, DATA_FILES } from '../constants/common'

const FILE = DATA_FILES.architecturePlan
/** 展开方案的目录树时默认展开深度（根 + 一级子目录） */
const TREE_DEFAULT_DEPTH = 2

const raw = ref<ArchitecturePlan | null>(null)
const fileMtime = ref<number | null>(null)
/** 待确认勾选（单选；'' = 未选） */
const chosen = ref('')
/** 文件当前已选值；用于外部变更到达时判断是否保留本地未保存勾选 */
let fileSelected = ''
let stop: (() => void) | undefined

onMounted(() => {
  stop = onJsonChange<ArchitecturePlan>(FILE, (d, meta) => {
    const pending = chosen.value !== '' && chosen.value !== fileSelected
    raw.value = d
    fileMtime.value = meta.mtimeMs ?? null
    fileSelected = d.selectedProposalId ?? ''
    if (!pending) chosen.value = fileSelected
  })
})

onUnmounted(() => stop?.())

const updatedText = computed(() => resolveUpdatedTime(raw.value, fileMtime.value))

const analysis = computed(() => raw.value?.androidAnalysis)
const proposals = computed<ArchitectureProposal[]>(() => raw.value?.proposals ?? [])

const proposalName = (id: string): string => proposals.value.find((p) => p.id === id)?.name ?? id

const isRecommended = (id: string): boolean => raw.value?.recommendedProposalId === id
const isSelected = (id: string): boolean => raw.value?.selectedProposalId === id

const choose = (id: string): void => {
  chosen.value = id
}

const canSave = computed(
  () => !!raw.value && !!chosen.value && chosen.value !== raw.value.selectedProposalId,
)

// ---- 目录树展开状态：默认展开推荐（或已确认）方案，用户操作后记忆 ----
const treeOpen = ref<Record<string, boolean>>({})

const treeDefaultId = computed(
  () => raw.value?.selectedProposalId ?? raw.value?.recommendedProposalId ?? '',
)

const isTreeOpen = (id: string): boolean => treeOpen.value[id] ?? id === treeDefaultId.value

const toggleTree = (id: string): void => {
  treeOpen.value = { ...treeOpen.value, [id]: !isTreeOpen(id) }
}

const countNodes = (node: { children?: unknown[] } | undefined): number => {
  let n = node ? 1 : 0
  for (const c of node?.children ?? []) n += countNodes(c as { children?: unknown[] })
  return n
}

// ---- 确认写入 ----
const confirming = ref(false)
const dialogText = ref('')
const dlg = ref<HTMLDialogElement | null>(null)
const summaryDlg = ref<HTMLDialogElement | null>(null)

const showDialog = (text: string): void => {
  dialogText.value = text
  dlg.value?.showModal()
}

const openConfirm = (): void => {
  if (!canSave.value || confirming.value) return
  summaryDlg.value?.showModal()
}

const doConfirm = (): void => {
  summaryDlg.value?.close()
  void save()
}

const save = async (): Promise<void> => {
  if (!canSave.value || confirming.value) return
  const id = chosen.value
  confirming.value = true
  try {
    await writeJsonPatch(FILE, {
      expectedMtime: fileMtime.value,
      patch: {
        selectedProposalId: id,
        selection: {
          proposalId: id,
          proposalName: proposalName(id),
          selectedAt: new Date().toISOString(),
          source: 'dashboard',
        },
      },
    })
    showDialog(`已确认架构方案：${proposalName(id)}`)
  } catch (e) {
    showDialog(e instanceof Error ? e.message : '写入失败')
  } finally {
    confirming.value = false
  }
}
</script>

<template>
  <PageHeading kicker="D2H / analysis" title="架构分析与设计" :note="`结构分析 · 三套方案选型 · ${FILE} 实时渲染`" />

  <section v-if="!raw" class="panel placeholder">
    <span class="glyph">⌕</span>
    <strong>等待数据</strong>
    <small>正在读取 {{ FILE }}…（尚未生成架构规划时此页为空）</small>
  </section>

  <template v-else>
    <!-- 01 项目概览 -->
    <section class="panel">
      <div class="row">
        <h2>项目概览</h2>
        <span class="tag">更新于 {{ updatedText }}</span>
      </div>
      <p class="project-name">{{ raw.project?.name || '未命名项目' }}</p>
      <p class="project-summary">{{ raw.project?.summary }}</p>
      <small class="plan-id">planId：{{ raw.planId }}</small>
    </section>

    <!-- 02 Android 结构分析（简述） -->
    <section class="panel">
      <div class="row">
        <h2>Android 结构分析</h2>
        <span v-if="analysis?.structure?.length" class="tag">{{ analysis.structure.length }} 个源目录</span>
      </div>
      <p class="analysis-summary">{{ analysis?.summary || '暂无分析摘要' }}</p>
      <div v-if="analysis?.techStack?.length" class="tech-tags">
        <span v-for="t in analysis.techStack" :key="t" class="tag blue">{{ t }}</span>
      </div>
    </section>

    <!-- 03 三套方案与选型 -->
    <section class="panel">
      <div class="row">
        <h2>三套方案与选型</h2>
        <span class="tag green">推荐：{{ proposalName(raw.recommendedProposalId) }}</span>
      </div>
      <p v-if="raw.recommendationReason" class="recommend-reason">{{ raw.recommendationReason }}</p>
      <small v-if="raw.selection?.selectedAt" class="selection-record">
        选型记录：{{ raw.selection.proposalName ?? proposalName(raw.selection.proposalId) }}
        · {{ raw.selection.selectedAt }} · 来源 {{ raw.selection.source ?? UNKNOWN }}
      </small>

      <div class="proposal-list">
        <div
          v-for="p in proposals"
          :key="p.id"
          class="proposal-card"
          :class="{ chosen: chosen === p.id, confirmed: isSelected(p.id) }"
        >
          <label class="proposal-head">
            <input
              type="radio"
              name="architecture-proposal"
              :value="p.id"
              :checked="chosen === p.id"
              @change="choose(p.id)"
            />
            <strong class="proposal-name">{{ p.name }}</strong>
            <code class="proposal-id">{{ p.id }}</code>
            <span v-if="isRecommended(p.id)" class="tag orange">★ 推荐</span>
            <span v-if="isSelected(p.id)" class="tag green">✓ 已选</span>
          </label>
          <p class="proposal-summary">{{ p.summary }}</p>
          <div class="tree-tools">
            <button type="button" class="link" @click="toggleTree(p.id)">
              {{ isTreeOpen(p.id) ? '收起目录树' : `展开目录树（${countNodes(p.directoryTree)} 节点）` }}
            </button>
          </div>
          <div v-if="isTreeOpen(p.id) && p.directoryTree" class="tree-wrap">
            <DirectoryTree :node="p.directoryTree" :depth="0" :default-expand-depth="TREE_DEFAULT_DEPTH" />
          </div>
        </div>
      </div>

      <!-- 确认栏 -->
      <div class="confirm-bar">
        <div class="confirm-info">
          <strong>当前勾选：{{ chosen ? proposalName(chosen) : '未选择' }}</strong>
          <small v-if="raw.selectedProposalId">已确认：{{ proposalName(raw.selectedProposalId) }}；再次确认将覆盖原选型</small>
          <small v-else>尚未确认选型，确认后写入 {{ FILE }}</small>
        </div>
        <button type="button" class="primary" :disabled="!canSave || confirming" @click="openConfirm">
          {{ confirming ? '写入中…' : '确认选择' }}
        </button>
      </div>
    </section>

    <!-- 04 风险与边界 -->
    <section class="panel">
      <div class="row">
        <h2>风险与边界</h2>
        <span v-if="analysis?.risks?.length" class="tag orange">{{ analysis.risks.length }} 项</span>
      </div>
      <ul v-if="analysis?.risks?.length" class="risks">
        <li v-for="(r, i) in analysis.risks" :key="i">{{ r }}</li>
      </ul>
      <div v-else class="empty-inline">暂无风险记录</div>
    </section>
  </template>

  <!-- 选型确认弹框 -->
  <dialog ref="summaryDlg" class="confirm-dialog" aria-label="确认选型">
    <div class="dlg-head">
      <span class="dlg-icon">✔</span>
      <h2>确认架构选型</h2>
    </div>
    <div class="dlg-body">
      <div class="dlg-change">
        <template v-if="raw?.selectedProposalId">
          <span class="chip from">{{ proposalName(raw.selectedProposalId) }}</span>
          <span class="arrow">→</span>
        </template>
        <span class="chip to">{{ chosen ? proposalName(chosen) : '' }}</span>
      </div>
      <p class="dlg-note">
        确认后写入 {{ FILE }} 的 <code>selectedProposalId</code> 与 <code>selection</code> 字段；后续重新确认将覆盖原选型。
      </p>
    </div>
    <div class="confirm-dialog-actions">
      <button type="button" @click="summaryDlg?.close()">取消</button>
      <button type="button" class="primary" @click="doConfirm">确认写入</button>
    </div>
  </dialog>

  <!-- 结果弹框 -->
  <dialog ref="dlg" class="confirm-dialog" aria-label="选型结果">
    <div class="dlg-head">
      <span class="dlg-icon ok">✓</span>
      <h2>选型结果</h2>
    </div>
    <p class="confirm-dialog-text">{{ dialogText }}</p>
    <button type="button" class="primary confirm-dialog-close" @click="dlg?.close()">关闭</button>
  </dialog>
</template>

<style scoped>
.project-name {
  font-size: 17px;
  font-weight: 650;
  margin: 0 0 6px;
}

.project-summary {
  margin: 0 0 8px;
  color: #48586f;
  line-height: 1.65;
}

.plan-id {
  font-size: 11px;
}

.analysis-summary {
  margin: 0 0 12px;
  line-height: 1.65;
  color: #48586f;
}

.tech-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.risks {
  margin: 0;
  padding-left: 18px;
  color: #48586f;
  line-height: 1.7;
  font-size: 13px;
}

.empty-inline {
  color: var(--muted);
  font-size: 13px;
}

/* ---- 弹框（确认选型 / 结果） ---- */
.dlg-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.dlg-head h2 {
  margin: 0;
}

.dlg-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #eaf0ff;
  color: var(--blue);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}

.dlg-icon.ok {
  background: #e7f6ee;
  color: #2f9e63;
}

.dlg-body {
  margin-bottom: 16px;
}

.dlg-change {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 2px 0 14px;
}

.chip {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
}

.chip.from {
  background: #f1f4f9;
  color: #5b6b83;
}

.chip.to {
  background: var(--blue);
  color: #fff;
}

.arrow {
  color: var(--blue);
  font-weight: 700;
  font-size: 15px;
}

.dlg-note {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.65;
  margin: 0;
}

.dlg-note code {
  background: #f0f4fa;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--blue);
}

.recommend-reason {
  margin: 0 0 6px;
  line-height: 1.65;
  color: #48586f;
}

.selection-record {
  display: block;
  margin-bottom: 12px;
}

.proposal-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.proposal-card {
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 12px 14px;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.proposal-card.chosen {
  border-color: var(--blue);
  box-shadow: 0 0 0 1px var(--blue);
}

.proposal-card.confirmed {
  border-color: #3fa66a;
}

.proposal-head {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  flex-wrap: wrap;
}

.proposal-head input[type='radio'] {
  accent-color: var(--blue);
  width: 15px;
  height: 15px;
}

.proposal-name {
  font-size: 14.5px;
}

.proposal-id {
  font-size: 11px;
  color: var(--muted);
  background: #f0f4fa;
  padding: 2px 7px;
  border-radius: 5px;
}

.proposal-summary {
  margin: 8px 0 0 24px;
  line-height: 1.65;
  color: #48586f;
  font-size: 13px;
}

.tree-tools {
  margin: 8px 0 0 24px;
}

.tree-wrap {
  margin: 6px 0 0 24px;
  padding: 10px 12px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: #fafbfe;
  max-height: 420px;
  overflow: auto;
}

.confirm-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #f7f9fd;
}

.confirm-info strong {
  display: block;
  margin-bottom: 3px;
}

.confirm-bar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 700px) {
  .confirm-bar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
