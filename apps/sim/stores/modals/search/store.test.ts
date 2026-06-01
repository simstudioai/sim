import { createElement, type SVGProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockConfig } from '@/blocks/types'

const { mockGetAllBlocks, mockGetToolOperationsIndex, mockGetTriggersForSidebar } = vi.hoisted(
  () => ({
    mockGetAllBlocks: vi.fn(),
    mockGetToolOperationsIndex: vi.fn(() => []),
    mockGetTriggersForSidebar: vi.fn(() => []),
  })
)

vi.mock('@/blocks', () => ({
  getAllBlocks: mockGetAllBlocks,
}))

vi.mock('@/lib/search/tool-operations', () => ({
  getToolOperationsIndex: mockGetToolOperationsIndex,
}))

vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  getTriggersForSidebar: mockGetTriggersForSidebar,
}))

import {
  buildCommandSearchableOptionSearchValue,
  useSearchModalStore,
} from '@/stores/modals/search/store'

function TestIcon(props: SVGProps<SVGSVGElement>) {
  return createElement('svg', props)
}

function createBlock(overrides: Partial<BlockConfig> = {}): BlockConfig {
  return {
    type: 'image_generator_v2',
    name: 'Image Generator',
    description: 'Generate images',
    category: 'tools',
    bgColor: '#4D5FFF',
    icon: TestIcon,
    subBlocks: [
      {
        id: 'provider',
        title: 'Provider',
        type: 'dropdown',
        commandSearchable: true,
        options: [
          { label: 'OpenAI', id: 'openai' },
          { label: 'Fal.ai (Multi-Model)', id: 'falai' },
          { label: 'Hidden Provider', id: 'hidden', hidden: true },
        ],
      },
    ],
    tools: { access: ['image_generate'] },
    inputs: {},
    outputs: {},
    ...overrides,
  }
}

describe('search modal store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSearchModalStore.setState({
      isOpen: false,
      data: {
        blocks: [],
        tools: [],
        triggers: [],
        toolOperations: [],
        docs: [],
        isInitialized: false,
      },
    })
  })

  describe('buildCommandSearchableOptionSearchValue', () => {
    it('builds search terms for marked static dropdown options', () => {
      const block = createBlock()
      const searchValue = buildCommandSearchableOptionSearchValue(block)

      expect(searchValue).toContain('Provider')
      expect(searchValue).toContain('Fal.ai (Multi-Model)')
      expect(searchValue).toContain('falai')
      expect(searchValue).not.toContain('Hidden Provider')
      expect(searchValue).not.toContain('hidden')
    })

    it('does not index dropdowns that only use in-dropdown search', () => {
      const block = createBlock({
        subBlocks: [
          {
            id: 'timezone',
            title: 'Timezone',
            type: 'dropdown',
            searchable: true,
            options: [{ label: 'UTC', id: 'utc' }],
          },
        ],
      })

      expect(buildCommandSearchableOptionSearchValue(block)).toBe('')
    })

    it('builds search terms for marked combobox option functions', () => {
      const block = createBlock({
        subBlocks: [
          {
            id: 'model',
            title: 'Model',
            type: 'combobox',
            commandSearchable: true,
            options: () => [
              { label: 'claude-sonnet-4-6', id: 'claude-sonnet-4-6' },
              { label: 'Hidden Model', id: 'hidden-model', hidden: true },
            ],
          },
        ],
      })

      const searchValue = buildCommandSearchableOptionSearchValue(block)

      expect(searchValue).toContain('Model')
      expect(searchValue).toContain('claude-sonnet-4-6')
      expect(searchValue).not.toContain('Hidden Model')
      expect(searchValue).not.toContain('hidden-model')
    })
  })

  it('adds command-searchable options to visible block search values without extra rows', () => {
    const visibleBlock = createBlock()
    const hiddenBlock = createBlock({
      type: 'hidden_generator',
      hideFromToolbar: true,
    })

    mockGetAllBlocks.mockReturnValue([visibleBlock, hiddenBlock])

    useSearchModalStore.getState().initializeData((blocks) => blocks)

    const { tools } = useSearchModalStore.getState().data
    expect(tools).toHaveLength(1)
    expect(tools[0]).toEqual(
      expect.objectContaining({
        id: 'image_generator_v2',
        searchValue: expect.stringContaining('Fal.ai (Multi-Model)'),
      })
    )
  })
})
