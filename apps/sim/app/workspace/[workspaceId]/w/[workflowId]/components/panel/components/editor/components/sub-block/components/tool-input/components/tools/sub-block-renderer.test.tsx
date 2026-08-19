/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { capturedSubBlockProps, mockSetValue } = vi.hoisted(() => ({
  capturedSubBlockProps: { current: null as Record<string, unknown> | null },
  mockSetValue: vi.fn(),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block',
  () => ({
    SubBlock: (props: Record<string, unknown>) => {
      capturedSubBlockProps.current = props
      return <div data-testid='sub-block' />
    },
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-dependency-block-type',
  () => ({
    DependencyBlockTypeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  })
)

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({ activeWorkflowId: 'workflow-1' }),
  },
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: {
    subscribe: () => () => undefined,
    getState: () => ({
      setValue: mockSetValue,
      getValue: () => [],
    }),
  },
}))

import { ToolSubBlockRenderer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/tools/sub-block-renderer'

let container: HTMLDivElement
let root: Root

describe('ToolSubBlockRenderer canonical dependency context', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    capturedSubBlockProps.current = null
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('passes the scoped canonical dependency value instead of stale raw pair values', async () => {
    const rawToolParams = {
      knowledgeBaseSelector: 'kb-stale-basic',
      manualKnowledgeBaseId: 'kb-active-advanced',
    }
    const canonicalContext = {
      ...rawToolParams,
      knowledgeBaseId: 'kb-active-advanced',
    }

    await act(async () => {
      root.render(
        <ToolSubBlockRenderer
          blockId='agent-1'
          subBlockId='tools'
          toolIndex={0}
          subBlock={{
            id: 'manualTagFilters',
            title: 'Tag Filters',
            type: 'knowledge-tag-filters',
            canonicalParamId: 'tagFilters',
            mode: 'advanced',
          }}
          effectiveParamId='manualTagFilters'
          toolType='knowledge'
          toolParams={rawToolParams}
          dependencyContextValues={canonicalContext}
          onParamChange={vi.fn()}
          disabled={false}
        />
      )
    })

    expect(capturedSubBlockProps.current?.dependencyContext).toEqual(canonicalContext)
  })
})
