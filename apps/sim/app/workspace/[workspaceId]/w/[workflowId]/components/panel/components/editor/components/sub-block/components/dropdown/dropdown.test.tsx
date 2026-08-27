/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const { fetched } = vi.hoisted(() => ({
  fetched: {
    options: [
      { id: 'col_a', label: 'Email' },
      { id: 'col_b', label: 'Name' },
    ] as { id: string; label: string }[],
    isLoadingOptions: false,
    hasLoadedOptions: true,
    fetchError: null as string | null,
  },
}))

vi.mock('@sim/emcn', () => ({
  ChipTag: ({ children }: { children?: React.ReactNode }) => <span data-chip>{children}</span>,
  Combobox: ({
    options,
    multiSelectValues,
    overlayContent,
  }: {
    options: { value: string; label: string; hidden?: boolean }[]
    multiSelectValues?: string[]
    overlayContent?: React.ReactNode
  }) => (
    <div>
      <div data-overlay>{overlayContent}</div>
      <ul>
        {options
          .filter((option) => !option.hidden)
          .map((option) => (
            <li key={option.value} data-value={option.value}>
              {option.label}
              {multiSelectValues?.includes(option.value) ? ' [selected]' : ''}
            </li>
          ))}
      </ul>
    </div>
  ),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-fetched-options',
  () => ({
    useFetchedOptions: () => ({
      fetchedOptions: fetched.options,
      isDynamic: true,
      isLoadingOptions: fetched.isLoadingOptions,
      hasLoadedOptions: fetched.hasLoadedOptions,
      fetchError: fetched.fetchError,
      hydratedOption: null,
      missingOptionId: null,
      refetch: () => {},
    }),
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({ useSubBlockValue: () => [['col_a', 'col_gone'], () => {}] })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({ useActiveSearchTarget: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text',
  () => ({ formatDisplayText: (text: string) => text })
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight',
  () => ({ getWorkflowSearchLabelHighlight: () => undefined })
)
vi.mock('@/hooks/use-operation-access', () => ({
  useOperationAccess: () => ({
    getDeniedOperations: () => new Set<string>(),
    resolveDefaultOperation: () => undefined,
    isPermissionLoading: false,
  }),
}))
vi.mock('@/executor/handlers/response/response-handler', () => ({ ResponseBlockHandler: {} }))
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) => selector({ blocks: {} }),
}))
vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (selector: (state: unknown) => unknown) =>
    selector({ activeWorkflowId: 'wf-1' }),
}))
vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: (selector: (state: unknown) => unknown) => selector({ workflowValues: {} }),
}))

import { Dropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/dropdown'

function render(): string {
  return renderToStaticMarkup(
    <Dropdown
      blockId='block-1'
      subBlockId='outputColumns'
      multiSelect
      selectorKey='table.outputColumns'
      preserveLabelCase
      placeholder='All columns'
    />
  )
}

describe('Dropdown multi-select stale selections', () => {
  it('renders a removable row for a selected value the loaded list lacks, shown by its id', () => {
    const html = render()

    expect(html).toContain('data-value="col_gone"')
    expect(html).toContain('col_gone [selected]')
    expect(html).toContain('<span class="truncate">col_gone</span>')
    expect(html).toContain('Email [selected]')
  })

  it('adds no row for a selection before the list has loaded', () => {
    fetched.isLoadingOptions = true
    fetched.hasLoadedOptions = false
    try {
      const html = render()
      expect(html).toContain('<span class="truncate">col_gone</span>')
      expect(html).not.toContain('data-value="col_gone"')
    } finally {
      fetched.isLoadingOptions = false
      fetched.hasLoadedOptions = true
    }
  })

  it('still offers removable rows when the loaded list is empty (every column deleted)', () => {
    const previous = fetched.options
    fetched.options = []
    try {
      const html = render()
      expect(html).toContain('data-value="col_a"')
      expect(html).toContain('data-value="col_gone"')
    } finally {
      fetched.options = previous
    }
  })
})
