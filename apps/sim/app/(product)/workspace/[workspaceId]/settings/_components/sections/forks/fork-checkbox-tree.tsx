'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import styles from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/forks.module.css'

/** A selectable item, or a group of them when it has `children`. */
export interface CheckboxTreeNode {
  id: string
  label: string
  children?: readonly CheckboxTreeNode[]
}

function leafIds(node: CheckboxTreeNode): string[] {
  return node.children ? node.children.flatMap(leafIds) : [node.id]
}

interface CheckboxTreeProps {
  nodes: readonly CheckboxTreeNode[]
  isSelected: (id: string) => boolean
  /** Toggles every given item at once: one item, or a group's select-all. */
  onToggle: (ids: string[], checked: boolean) => void
  /** Names a group's select-all checkbox, such as `Copy all in Files`. */
  groupActionLabel: (groupLabel: string) => string
  /** Whether groups open expanded. */
  initiallyExpanded?: boolean
  disabled?: boolean
}

/**
 * Items with a checkbox each, nested in groups whose tri-state checkbox selects the whole subtree
 * and whose label expands it with the selected and total counts. The fork picker's resource kinds,
 * the sync copy selection, file folders and the synced workflows tree share it.
 */
export function CheckboxTree(props: CheckboxTreeProps) {
  return (
    <div className={styles.tree}>
      {props.nodes.map((node) => (
        <TreeNode key={node.id} node={node} tree={props} />
      ))}
    </div>
  )
}

function TreeNode({ node, tree }: { node: CheckboxTreeNode; tree: CheckboxTreeProps }) {
  const [expanded, setExpanded] = useState(tree.initiallyExpanded ?? false)
  const { isSelected, onToggle, disabled } = tree
  if (!node.children) {
    return (
      <Checkbox
        label={node.label}
        checked={isSelected(node.id)}
        disabled={disabled}
        onCheckedChange={(checked) => onToggle([node.id], checked)}
      />
    )
  }
  const ids = leafIds(node)
  const selected = ids.filter(isSelected).length
  const all = selected === ids.length
  return (
    <div className={styles.branch}>
      <div className={styles.branchHeader}>
        <Checkbox
          label={tree.groupActionLabel(node.label)}
          labelHidden
          checked={all}
          indeterminate={selected > 0 && !all}
          disabled={disabled}
          onCheckedChange={() => onToggle(ids, !all)}
        />
        <Button
          variant='quiet'
          size='compact'
          trailingIcon={expanded ? 'I051' : 'I090'}
          onClick={() => setExpanded((value) => !value)}
        >
          {`${node.label} (${selected > 0 ? `${selected}/${ids.length}` : ids.length})`}
        </Button>
      </div>
      {expanded && (
        <div className={styles.branchChildren}>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} tree={tree} />
          ))}
        </div>
      )}
    </div>
  )
}
