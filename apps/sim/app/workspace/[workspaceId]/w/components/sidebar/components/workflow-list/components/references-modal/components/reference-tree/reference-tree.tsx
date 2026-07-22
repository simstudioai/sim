'use client'

import { Workflow } from '@sim/emcn/icons'
import type { ReferenceNode } from '@/lib/api/contracts/workflow-references'

const CONFIG = {
  /** Horizontal indent added per tree level, in pixels. */
  INDENT_PER_LEVEL: 16,
  /** Base row padding: lands depth-0 content on the modal's px-4 text gutter. */
  BASE_INDENT: 8,
} as const

interface ReferenceTreeProps {
  nodes: ReferenceNode[]
  /** Invoked with a workflow id when a row is activated. */
  onNavigate: (workflowId: string) => void
}

interface ReferenceTreeItemProps {
  node: ReferenceNode
  depth: number
  onNavigate: (workflowId: string) => void
}

function ReferenceTreeItem({ node, depth, onNavigate }: ReferenceTreeItemProps) {
  return (
    <div role='treeitem' aria-level={depth + 1}>
      <button
        type='button'
        onClick={() => onNavigate(node.id)}
        style={{ paddingLeft: CONFIG.BASE_INDENT + depth * CONFIG.INDENT_PER_LEVEL }}
        className='flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-[var(--surface-hover)]'
      >
        <Workflow className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>{node.name}</span>
        {node.cycle && (
          <span className='shrink-0 text-[var(--text-muted)] text-caption'>(cycle)</span>
        )}
      </button>
      {node.children.length > 0 && (
        <div role='group'>
          {node.children.map((child) => (
            <ReferenceTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Read-only recursive tree of workflow references. Each row navigates to its
 * workflow on click; cyclic leaves are marked and render no children.
 */
export function ReferenceTree({ nodes, onNavigate }: ReferenceTreeProps) {
  return (
    <div role='tree' className='flex flex-col'>
      {nodes.map((node) => (
        <ReferenceTreeItem key={node.id} node={node} depth={0} onNavigate={onNavigate} />
      ))}
    </div>
  )
}
