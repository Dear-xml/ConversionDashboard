<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DirectoryNode } from '../types/architecturePlan'

const props = defineProps<{
  node: DirectoryNode
  depth: number
  /** 初始展开到该深度（不含）；超过的层级默认折叠、点击懒渲染 */
  defaultExpandDepth?: number
}>()

const expanded = ref(props.depth < (props.defaultExpandDepth ?? 0))

const hasChildren = computed(() => (props.node.children?.length ?? 0) > 0)

const toggle = (): void => {
  if (hasChildren.value) expanded.value = !expanded.value
}
</script>

<template>
  <div class="tree-node">
    <div class="node-row" :class="{ leaf: !hasChildren }" @click="toggle">
      <button
        type="button"
        class="caret-btn"
        :class="{ open: expanded }"
        :disabled="!hasChildren"
        :aria-expanded="hasChildren ? expanded : undefined"
        :title="hasChildren ? (expanded ? '收起' : '展开') : undefined"
        @click.stop="toggle"
      >
        <span class="caret-icon">{{ hasChildren ? (expanded ? '▾' : '▸') : '·' }}</span>
      </button>
      <span class="node-name" :title="node.name">{{ node.name }}</span>
      <span v-if="node.description" class="node-desc" :title="node.description">{{ node.description }}</span>
    </div>
    <div v-if="expanded && hasChildren" class="node-children">
      <DirectoryTree
        v-for="(child, i) in node.children"
        :key="`${child.path}-${i}`"
        :node="child"
        :depth="depth + 1"
        :default-expand-depth="defaultExpandDepth"
      />
    </div>
  </div>
</template>

<style scoped>
/* 名称列定宽：同层级描述纵向左对齐；展开按钮大热区 */
.node-row {
  display: grid;
  grid-template-columns: 28px minmax(150px, 210px) 1fr;
  gap: 8px;
  align-items: center;
  padding: 1px 4px 1px 0;
  border-radius: 6px;
  line-height: 1.45;
  min-width: 0;
  min-height: 30px;
}

.node-row:not(.leaf) {
  cursor: pointer;
}

.node-row:not(.leaf):hover {
  background: #f0f5ff;
}

/* 大号展开/收起按钮：28×28 热区 + 悬停反馈 */
.caret-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: none;
  color: #6d83a9;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.caret-btn:disabled {
  cursor: default;
  color: #c3cddb;
}

.caret-btn:not(:disabled):hover {
  background: #e2ebfc;
  border-color: #c3d5f4;
  color: var(--blue);
}

.caret-icon {
  font-size: 13px;
  line-height: 1;
}

.node-name {
  font-size: 12.5px;
  font-weight: 550;
  color: #34445c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-desc {
  color: var(--muted);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  min-width: 0;
}

.node-children {
  margin-left: 8px;
  padding-left: 10px;
  border-left: 1px dashed #d6deeb;
}
</style>
