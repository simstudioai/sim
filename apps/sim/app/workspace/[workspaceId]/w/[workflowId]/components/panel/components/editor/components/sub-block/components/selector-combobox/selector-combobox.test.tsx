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
    (_key: string, args: { detailIds: string[]; enabled: boolean }) =>
      args.enabled ? args.detailIds.map((id) => ({ id, label: `Hydrated ${id}` })) : []
  )
})

describe('SelectorCombobox label hydration', () => {
  it.each([
    {
      state: 'preview',
      isPreview: true,
      disabled: false,
      previewValue: 'preview-label',
      detailId: 'preview-label',
    },
    {
      state: 'disabled',
      isPreview: false,
      disabled: true,
      previewValue: undefined,
      detailId: 'stored-label',
    },
  ])('keeps the list disabled but hydrates the selected value when $state', (state) => {
    const html = renderToStaticMarkup(
      <SelectorCombobox
        blockId='block-1'
        subBlock={{ id: 'label', title: 'Label', type: 'combobox' }}
        selectorKey='jira.issues'
        selectorContext={{ workspaceId: 'workspace-1', oauthCredential: 'credential-1' }}
        isPreview={state.isPreview}
        disabled={state.disabled}
        previewValue={state.previewValue}
      />
    )

    expect(html).toContain('Hydrated label')
    expect(mockUseSelectorOptions).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ enabled: false })
    )
    expect(mockUseSelectorOptionDetail).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ detailId: state.detailId, enabled: true })
    )
  })

  it.each([
    {
      state: 'preview',
      isPreview: true,
      disabled: false,
      previewValue: ['preview-label', '{{SHARED_LABEL}}', '<Block.output>'],
      detailIds: ['preview-label', '{{SHARED_LABEL}}'],
    },
    {
      state: 'disabled',
      isPreview: false,
      disabled: true,
      previewValue: undefined,
      detailIds: ['stored-one', 'stored-two'],
    },
  ])('hydrates selected multi-values without enabling the list when $state', (state) => {
    if (!state.isPreview) selectorState.storeValue = ['stored-one', 'stored-two']

    const html = renderToStaticMarkup(
      <SelectorCombobox
        blockId='block-1'
        subBlock={{ id: 'labels', title: 'Labels', type: 'combobox' }}
        selectorKey='jira.issues'
        selectorContext={{ workspaceId: 'workspace-1', oauthCredential: 'credential-1' }}
        isPreview={state.isPreview}
        disabled={state.disabled}
        previewValue={state.previewValue}
        multiSelect
      />
    )

    for (const id of state.detailIds) expect(html).toContain(`Hydrated ${id}`)
    if (state.isPreview) expect(html).toContain('&lt;Block.output&gt;')
    expect(mockUseSelectorOptions).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ enabled: false })
    )
    expect(mockUseSelectorOptionDetails).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ detailIds: state.detailIds, enabled: true })
    )
  })

  it.each([
    {
      state: 'preview',
      isPreview: true,
      disabled: false,
      previewValue: ['preview-label', '{{SHARED_LABEL}}', '<Block.output>'],
      listedValues: ['preview-label'],
    },
    {
      state: 'disabled',
      isPreview: false,
      disabled: true,
      previewValue: undefined,
      listedValues: ['stored-one', 'stored-two'],
    },
  ])('uses a search-free list to hydrate no-detail multi-values when $state', (state) => {
    if (!state.isPreview) selectorState.storeValue = ['stored-one', 'stored-two']
    mockUseSelectorOptions.mockReturnValue({
      data: state.listedValues.map((id) => ({ id, label: `Listed ${id}` })),
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
        isPreview={state.isPreview}
        disabled={state.disabled}
        previewValue={state.previewValue}
        multiSelect
      />
    )

    for (const id of state.listedValues) expect(html).toContain(`Listed ${id}`)
    if (state.isPreview) {
      expect(html).toContain('{{SHARED_LABEL}}')
      expect(html).toContain('&lt;Block.output&gt;')
    }
    expect(mockUseSelectorOptions).toHaveBeenCalledWith(
      'gmail.labels',
      expect.objectContaining({ enabled: true, search: undefined })
    )
    expect(mockUseSelectorOptionDetails).toHaveBeenCalledWith(
      'gmail.labels',
      expect.objectContaining({ enabled: false })
    )
  })

  it('does not detail-hydrate a runtime reference', () => {
    selectorState.storeValue = '<Block.output>'

    const html = renderToStaticMarkup(
      <SelectorCombobox
        blockId='block-1'
        subBlock={{ id: 'label', title: 'Label', type: 'combobox' }}
        selectorKey='gmail.labels'
        selectorContext={{ workspaceId: 'workspace-1', oauthCredential: 'credential-1' }}
        disabled
      />
    )

    expect(html).toContain('&lt;Block.output&gt;')
    expect(mockUseSelectorOptionDetail).toHaveBeenCalledWith(
      'gmail.labels',
      expect.objectContaining({ detailId: undefined, enabled: false })
    )
  })
})
