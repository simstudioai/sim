/** @vitest-environment jsdom */

import { act, type ComponentProps } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewBlock } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/components/block/block'
import { getBlock } from '@/blocks'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

vi.mock('@/triggers/registry', () => ({ TRIGGER_REGISTRY: {} }))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(getBlock).mockReturnValue(WorkflowBlock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.mocked(getBlock).mockReset()
})

function workflow(name: string): WorkflowMetadata {
  return { id: 'child', name, createdAt: new Date(0), lastModified: new Date(0), sortOrder: 0 }
}

function render(data: ComponentProps<typeof PreviewBlock>['data']) {
  act(() =>
    root.render(
      <ReactFlowProvider>
        <PreviewBlock
          id='parent'
          data={data}
          type='workflowBlock'
          dragging={false}
          zIndex={0}
          isConnectable={false}
          selected={false}
          selectable={false}
          deletable={false}
          draggable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>
    )
  )
}

describe('preview workflow selection updates', () => {
  it('resolves the selected workflow when labels become ready without a block edit', () => {
    const data = {
      type: 'workflow',
      name: 'Run child',
      workflowMap: { child: workflow('Billing') },
      workflowLabelsReady: false,
      subBlockValues: { workflowId: { value: 'child' } },
    }
    render(data)
    expect(container.textContent).not.toContain('Billing')
    render({ ...data, workflowLabelsReady: true })
    expect(container.textContent).toContain('Billing')
  })

  it('refreshes the selected workflow name without a block edit', () => {
    const data = {
      type: 'workflow',
      name: 'Run child',
      workflowMap: { child: workflow('Billing') },
      workflowLabelsReady: true,
      subBlockValues: { workflowId: { value: 'child' } },
    }
    render(data)
    expect(container.textContent).toContain('Billing')
    render({ ...data, workflowMap: { child: workflow('Invoices') } })
    expect(container.textContent).toContain('Invoices')
    expect(container.textContent).not.toContain('Billing')
  })
})
