/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseSelectorOptionDetail, mockUseSelectorOptionDetails, mockUseSelectorOptions } =
  vi.hoisted(() => ({
    mockUseSelectorOptionDetail: vi.fn(),
    mockUseSelectorOptionDetails: vi.fn(),
    mockUseSelectorOptions: vi.fn(),
  }))

vi.mock('@/hooks/queries/selectors', () => ({
  useSelectorOptionDetail: mockUseSelectorOptionDetail,
  useSelectorOptionDetails: mockUseSelectorOptionDetails,
  useSelectorOptions: mockUseSelectorOptions,
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: (selector: (state: unknown) => unknown) =>
    selector({ activeWorkflowId: 'workflow-1', hydration: { workspaceId: 'workspace-1' } }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) => selector({ blocks: {} }),
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: (selector: (state: unknown) => unknown) => selector({ workflowValues: {} }),
}))

import { useFetchedOptions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-fetched-options'

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSelectorOptions.mockReturnValue({
    data: undefined,
    isLoading: false,
    isSuccess: false,
    error: null,
    refetch: vi.fn(),
  })
  mockUseSelectorOptionDetail.mockImplementation((_key: string, args: { enabled: boolean }) => ({
    data: args.enabled ? { id: 'issue-1', label: 'Hydrated issue' } : null,
    isFetched: args.enabled,
    isLoading: false,
  }))
  mockUseSelectorOptionDetails.mockImplementation(
    (_key: string, args: { detailIds: string[]; enabled: boolean }) =>
      args.enabled ? args.detailIds.map((id) => ({ id, label: `Hydrated ${id}` })) : []
  )
})

describe('useFetchedOptions label hydration', () => {
  it('hydrates a selected value while a disabled control keeps list interaction off', () => {
    function Probe() {
      const result = useFetchedOptions({
        blockId: 'block-1',
        subBlockId: 'label',
        dependsOnFields: ['credential'],
        selectorKey: 'jira.issues',
        isPreview: false,
        disabled: true,
        valueToHydrate: 'issue-1',
        localOptions: [],
      })
      return <span>{result.hydratedOption?.label}</span>
    }

    expect(renderToStaticMarkup(<Probe />)).toContain('Hydrated issue')
    expect(mockUseSelectorOptions).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ enabled: false })
    )
    expect(mockUseSelectorOptionDetail).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ detailId: 'issue-1', enabled: true })
    )
  })

  it('hydrates only eligible multi-values while preview keeps list interaction off', () => {
    function Probe() {
      const result = useFetchedOptions({
        blockId: 'block-1',
        subBlockId: 'labels',
        dependsOnFields: ['credential'],
        selectorKey: 'jira.issues',
        isPreview: true,
        disabled: false,
        valueToHydrate: undefined,
        valuesToHydrate: ['label-1', '{{SHARED_LABEL}}', '<Block.output>', 'local-label'],
        localOptions: [{ id: 'local-label' }],
      })
      return <span>{result.hydratedOptions.map((option) => option.label).join(',')}</span>
    }

    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('Hydrated label-1')
    expect(html).toContain('Hydrated {{SHARED_LABEL}}')
    expect(mockUseSelectorOptions).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({ enabled: false })
    )
    expect(mockUseSelectorOptionDetails).toHaveBeenCalledWith(
      'jira.issues',
      expect.objectContaining({
        detailIds: ['label-1', '{{SHARED_LABEL}}'],
        enabled: true,
      })
    )
  })

  it('uses a search-free list to hydrate a no-detail selector while disabled', () => {
    mockUseSelectorOptions.mockReturnValue({
      data: [{ id: 'label-1', label: 'Primary label' }],
      isLoading: false,
      isSuccess: true,
      error: null,
      refetch: vi.fn(),
    })

    function Probe() {
      const result = useFetchedOptions({
        blockId: 'block-1',
        subBlockId: 'labels',
        dependsOnFields: ['credential'],
        selectorKey: 'gmail.labels',
        isPreview: false,
        disabled: true,
        valueToHydrate: undefined,
        valuesToHydrate: ['label-1', '{{SHARED_LABEL}}', '<Block.output>'],
        localOptions: [],
      })
      return <span>{result.fetchedOptions.map((option) => option.label).join(',')}</span>
    }

    const html = renderToStaticMarkup(<Probe />)
    expect(html).toContain('Primary label')
    expect(mockUseSelectorOptions).toHaveBeenCalledWith(
      'gmail.labels',
      expect.objectContaining({ enabled: true })
    )
    expect(mockUseSelectorOptions.mock.calls.at(-1)?.[1]).not.toHaveProperty('search')
    expect(mockUseSelectorOptionDetails).toHaveBeenCalledWith(
      'gmail.labels',
      expect.objectContaining({ enabled: false })
    )
  })
})
