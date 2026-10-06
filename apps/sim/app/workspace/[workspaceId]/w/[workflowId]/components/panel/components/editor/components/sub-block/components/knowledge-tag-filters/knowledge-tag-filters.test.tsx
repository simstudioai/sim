/**
 * @vitest-environment jsdom
 */
import { act, type ChangeEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestedKnowledgeBaseId, mockSetStoreValue, mockStoreState } = vi.hoisted(() => ({
  mockRequestedKnowledgeBaseId: { current: null as string | null },
  mockSetStoreValue: vi.fn(),
  mockStoreState: {
    value: null as string | null,
  },
}))

const initialFilters = [
  {
    id: 'filter-1',
    tagName: '',
    tagId: 'tag-text',
    tagSlot: 'tag1',
    fieldType: 'text',
    operator: 'contains',
    tagValue: 'api',
    valueTo: 'secondary',
    collapsed: false,
  },
]

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight',
  () => ({
    getActiveWorkflowSearchHighlight: () => undefined,
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate',
  () => ({
    useDependsOnGate: () => ({
      dependencyValues: { knowledgeBaseSelector: 'kb-1' },
    }),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input',
  async () => {
    const { useState } = await import('react')

    return {
      useSubBlockInput: () => {
        const [, setFocusCount] = useState(0)

        return {
          fieldHelpers: {
            getFieldState: () => ({ showTags: false }),
            createFieldHandlers: (
              _key: string,
              _value: string,
              onChange: (value: string) => void
            ) => ({
              onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
              onKeyDown: vi.fn(),
              onDrop: vi.fn(),
              onDragOver: vi.fn(),
              onFocus: () => setFocusCount((count) => count + 1),
            }),
            createTagSelectHandler: vi.fn(),
            hideFieldDropdowns: vi.fn(),
          },
        }
      },
    }
  }
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider',
  () => ({
    useActiveSearchTarget: () => null,
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes',
  () => ({
    useAccessibleReferencePrefixes: () => null,
  })
)

vi.mock('@/hooks/kb/use-knowledge-base-tag-definitions', () => ({
  useKnowledgeBaseTagDefinitions: (knowledgeBaseId: string | null) => {
    mockRequestedKnowledgeBaseId.current = knowledgeBaseId
    return {
      tagDefinitions: [
        { id: 'tag-text', tagSlot: 'tag1', displayName: 'category', fieldType: 'text' },
        { id: 'tag-number', tagSlot: 'number1', displayName: 'score', fieldType: 'number' },
      ],
      isLoading: false,
    }
  },
}))

vi.mock('@/hooks/kb/use-tag-selection', () => ({
  useTagSelection: () => vi.fn(),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: () => [mockStoreState.value, mockSetStoreValue],
  })
)

import { KnowledgeTagFilters } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/knowledge-tag-filters/knowledge-tag-filters'

let container: HTMLDivElement
let root: Root

describe('KnowledgeTagFilters Tag ID editing', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockStoreState.value = JSON.stringify(initialFilters)
    mockRequestedKnowledgeBaseId.current = null
    mockSetStoreValue.mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  const renderTagFilters = async () => {
    await act(async () => {
      root.render(
        <KnowledgeTagFilters
          blockId='knowledge-1'
          subBlock={{
            id: 'manualTagFilters',
            title: 'Tag Filters',
            type: 'knowledge-tag-filters',
            mode: 'advanced',
            canonicalParamId: 'tagFilters',
          }}
        />
      )
    })

    return container.querySelector<HTMLInputElement>('input[placeholder="Enter tag ID"]')
  }

  const changeTagId = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const serializedFilters = mockSetStoreValue.mock.lastCall?.[0] as string
    return JSON.parse(serializedFilters)[0]
  }

  it('preserves values for unresolved edits and resets them once a different literal ID resolves', async () => {
    const input = await renderTagFilters()
    expect(input).not.toBeNull()

    const unresolvedFilter = await changeTagId(input as HTMLInputElement, 'tag-numbe')
    expect(unresolvedFilter).toMatchObject({
      tagId: 'tag-numbe',
      operator: 'contains',
      tagValue: 'api',
      valueTo: 'secondary',
    })

    const resolvedFilter = await changeTagId(input as HTMLInputElement, 'tag-number')
    expect(resolvedFilter).toMatchObject({
      tagId: 'tag-number',
      tagSlot: 'number1',
      fieldType: 'number',
      operator: 'eq',
      tagValue: '',
    })
    expect(resolvedFilter.valueTo).toBeUndefined()
  })

  it('keeps a brand-new Tag ID input focused and accepts its first pasted value', async () => {
    mockStoreState.value = null
    const input = await renderTagFilters()
    expect(input).not.toBeNull()

    await act(async () => {
      input?.focus()
    })

    const focusedInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Enter tag ID"]'
    )
    expect(focusedInput).toBe(input)
    expect(document.activeElement).toBe(input)

    const pastedFilter = await changeTagId(focusedInput as HTMLInputElement, 'tag-text')
    expect(pastedFilter).toMatchObject({
      tagId: 'tag-text',
      tagSlot: 'tag1',
      fieldType: 'text',
      operator: 'eq',
    })
  })

  it('loads definitions from the active canonical knowledge base context', async () => {
    await act(async () => {
      root.render(
        <KnowledgeTagFilters
          blockId='knowledge-1'
          subBlock={{
            id: 'manualTagFilters',
            title: 'Tag Filters',
            type: 'knowledge-tag-filters',
            mode: 'advanced',
            canonicalParamId: 'tagFilters',
          }}
          previewContextValues={{ knowledgeBaseId: 'kb-active-advanced' }}
        />
      )
    })

    expect(mockRequestedKnowledgeBaseId.current).toBe('kb-active-advanced')
  })

  it('shows resolved names and types while falling back to unresolved raw IDs', async () => {
    mockStoreState.value = JSON.stringify([
      {
        id: 'resolved-filter',
        tagName: '',
        tagId: 'tag-text',
        fieldType: 'text',
        operator: 'eq',
        tagValue: 'api',
        collapsed: true,
      },
      {
        id: 'unresolved-filter',
        tagName: '',
        tagId: 'tag-from-reference',
        fieldType: 'number',
        operator: 'gte',
        tagValue: '10',
        collapsed: true,
      },
    ])

    await renderTagFilters()

    expect(container.querySelector('[data-filter-id="resolved-filter"]')?.textContent).toContain(
      'categoryText'
    )
    expect(container.querySelector('[data-filter-id="unresolved-filter"]')?.textContent).toContain(
      'tag-from-referenceNumber'
    )
  })
})
