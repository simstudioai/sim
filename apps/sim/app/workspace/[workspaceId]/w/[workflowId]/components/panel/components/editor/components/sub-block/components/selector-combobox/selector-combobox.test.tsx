/**
 * @vitest-environment node
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockUseSelectorOptionDetail,
  mockUseSelectorOptionDetails,
  mockUseSelectorOptions,
  selectorState,
} = vi.hoisted(() => ({
  mockUseSelectorOptionDetail: vi.fn(),
  mockUseSelectorOptionDetails: vi.fn(),
  mockUseSelectorOptions: vi.fn(),
  selectorState: { storeValue: 'stored-label' as string | string[] },
}))

vi.mock('@sim/emcn', () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type='button'>{children}</button>,
  Combobox: ({ value }: { value?: string }) => <span data-combobox>{value}</span>,
}))

vi.mock('@sim/emcn/icons', () => ({ X: () => null }))

vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptions: mockUseSelectorOptions,
  useSelectorOptionDetail: mockUseSelectorOptionDetail,
  useSelectorOptionDetails: mockUseSelectorOptionDetails,
  useSelectorOptionMap: (
    options: Array<{ id: string; label: string }>,
    extra?: { id: string; label: string }
  ) => new Map((extra ? [extra, ...options] : options).map((option) => [option.id, option])),
}))

vi.mock('@/hooks/use-debounce', () => ({ useDebounce: (value: string) => value }))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({ useSubBlockValue: () => [selectorState.storeValue, vi.fn()] })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({ useActiveSearchTarget: () => null })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller',
  () => ({
    SubBlockInputController: ({
      children,
    }: {
      children: (args: {
        ref: { current: null }
        onDrop: () => void
        onDragOver: () => void
      }) => ReactNode
    }) => children({ ref: { current: null }, onDrop: vi.fn(), onDragOver: vi.fn() }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text',
  () => ({ formatDisplayText: (text: string) => text })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight',
  () => ({ getWorkflowSearchLabelHighlight: () => undefined })
)

import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'

beforeEach(() => {
  vi.clearAllMocks()
  selectorState.storeValue = 'stored-label'
  mockUseSelectorOptions.mockReturnValue({
    data: [],
    isLoading: false,
    hasMore: false,
    error: null,
  })
  mockUseSelectorOptionDetail.mockImplementation(
    (_key: string, args: { detailId?: string; enabled: boolean }) => ({
      data: args.enabled && args.detailId ? { id: args.detailId, label: 'Hydrated label' } : null,
      isLoading: false,
    })
  )
  mockUseSelectorOptionDetails.mockImplementation(
    (_key: string, args: { detailIds: string[]; enabled: boolean }) => ({
      data: args.enabled ? args.detailIds.map((id) => ({ id, label: `Hydrated ${id}` })) : [],
      isLoading: false,
    })
  )
})

describe('SelectorCombobox label hydration', () => {
  it('renders a hydrated selected label while disabled without enabling the list', () => {
    const html = renderToStaticMarkup(
      <SelectorCombobox
        blockId='block-1'
        subBlock={{ id: 'label', title: 'Label', type: 'combobox' }}
        selectorKey='jira.issues'
        selectorContext={{ workspaceId: 'workspace-1', oauthCredential: 'credential-1' }}
        disabled
      />
    )

    expect(html).toContain('Hydrated label')
    expect(mockUseSelectorOptions).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ enabled: false })
    )
    expect(mockUseSelectorOptionDetail).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ detailId: 'stored-label', enabled: true })
    )
  })

  it('renders preview labels from a search-free list when detail lookup is unsupported', () => {
    const previewValue = ['preview-label', '{{SHARED_LABEL}}', '<Block.output>']
    mockUseSelectorOptions.mockReturnValue({
      data: [{ id: 'preview-label', label: 'Listed preview-label' }],
      isLoading: false,
      hasMore: false,
      error: null,
    })

    const html = renderToStaticMarkup(
      <SelectorCombobox
        blockId='block-1'
        subBlock={{ id: 'labels', title: 'Labels', type: 'combobox' }}
        selectorKey='gmail.labels'
        selectorContext={{ workspaceId: 'workspace-1', oauthCredential: 'credential-1' }}
        isPreview
        previewValue={previewValue}
        multiSelect
      />
    )

    expect(html).toContain('Listed preview-label')
    expect(html).toContain('{{SHARED_LABEL}}')
    expect(html).toContain('&lt;Block.output&gt;')
    expect(mockUseSelectorOptions).toHaveBeenCalledWith(
      'gmail.labels',
      expect.objectContaining({ enabled: true, search: undefined })
    )
    expect(mockUseSelectorOptionDetails).toHaveBeenCalledWith(
      'gmail.labels',
      expect.objectContaining({ enabled: false })
    )
  })
})
