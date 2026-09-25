import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBlock, mockLoadAllSelectorOptions } = vi.hoisted(() => ({
  mockGetBlock: vi.fn(),
  mockLoadAllSelectorOptions: vi.fn(),
}))

vi.mock('@/lib/workflows/subblocks/visibility', () => ({
  isNonEmptyValue: (v: unknown) => v !== null && v !== undefined && v !== '',
}))

vi.mock('@/triggers/constants', () => ({
  SYSTEM_SUBBLOCK_IDS: [],
  TRIGGER_RUNTIME_SUBBLOCK_IDS: [],
}))

vi.mock('@/blocks/types', () => ({
  SELECTOR_TYPES_HYDRATION_REQUIRED: ['channel-selector'],
}))

vi.mock('@/executor/constants', () => ({
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: mockGetBlock,
  getAllBlocks: () => ({}),
  getAllBlockTypes: () => [],
  registry: {},
}))

vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  fetchOAuthCredentialDetail: vi.fn(() => []),
}))

vi.mock('@/lib/selectors/client/execute-selector', () => ({
  executeSelectorRequest: vi.fn(() => ({ kind: 'detail', item: null })),
  loadAllSelectorOptions: mockLoadAllSelectorOptions,
}))

import { WorkflowBuilder } from '@sim/testing'
import type { WorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import {
  formatDiffSummaryForDescription,
  formatDiffSummaryForDescriptionAsync,
} from '@/lib/workflows/comparison/describe'
import {
  resolveFieldLabel,
  resolveValueForDisplay,
} from '@/lib/workflows/comparison/resolve-values'

function emptyDiffSummary(overrides: Partial<WorkflowDiffSummary> = {}): WorkflowDiffSummary {
  return {
    addedBlocks: [],
    removedBlocks: [],
    modifiedBlocks: [],
    edgeChanges: { added: 0, removed: 0, addedDetails: [], removedDetails: [] },
    loopChanges: { added: 0, removed: 0, modified: 0 },
    parallelChanges: { added: 0, removed: 0, modified: 0 },
    variableChanges: {
      added: 0,
      removed: 0,
      modified: 0,
      addedNames: [],
      removedNames: [],
      modifiedNames: [],
    },
    hasChanges: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockLoadAllSelectorOptions.mockResolvedValue({ items: [], truncated: false })
})

describe('resolveFieldLabel', () => {
  it('resolves subBlock id to its title', () => {
    mockGetBlock.mockReturnValue({
      subBlocks: [
        { id: 'systemPrompt', title: 'System Prompt' },
        { id: 'model', title: 'Model' },
      ],
    })
    expect(resolveFieldLabel('agent', 'systemPrompt')).toBe('System Prompt')
    expect(resolveFieldLabel('agent', 'model')).toBe('Model')
  })

  it('converts data.* fields to Title Case', () => {
    expect(resolveFieldLabel('agent', 'data.loopType')).toBe('Loop Type')
    expect(resolveFieldLabel('agent', 'data.canonicalModes')).toBe('Canonical Modes')
    expect(resolveFieldLabel('agent', 'data.isStarter')).toBe('Is Starter')
  })
})

describe('resolveValueForDisplay', () => {
  it('preserves a raw selector ID when the loaded catalog is incomplete', async () => {
    mockGetBlock.mockReturnValue({
      subBlocks: [
        {
          id: 'channel',
          title: 'Channel',
          type: 'channel-selector',
          selectorKey: 'slack.channels',
        },
      ],
    })
    mockLoadAllSelectorOptions.mockResolvedValue({ items: [], truncated: true })

    const channelId = 'C12345678'
    const result = await resolveValueForDisplay(channelId, {
      blockType: 'slack',
      subBlockId: 'channel',
      workflowId: 'wf-1',
      currentState: new WorkflowBuilder().build(),
    })

    expect(result).toEqual({
      original: channelId,
      displayLabel: channelId,
      resolved: false,
    })
  })
})

describe('formatDiffSummaryForDescription', () => {
  it('uses human-readable field labels for modified blocks', () => {
    mockGetBlock.mockReturnValue({
      subBlocks: [
        { id: 'systemPrompt', title: 'System Prompt' },
        { id: 'model', title: 'Model' },
      ],
    })

    const summary = emptyDiffSummary({
      hasChanges: true,
      modifiedBlocks: [
        {
          id: 'block-1',
          type: 'agent',
          name: 'My Agent',
          changes: [
            { field: 'systemPrompt', oldValue: 'You are helpful', newValue: 'You are an expert' },
            { field: 'model', oldValue: 'gpt-4o', newValue: 'claude-sonnet-4-5' },
          ],
        },
      ],
    })

    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain(
      'Modified My Agent: System Prompt changed from "You are helpful" to "You are an expert"'
    )
    expect(result).toContain(
      'Modified My Agent: Model changed from "gpt-4o" to "claude-sonnet-4-5"'
    )
    expect(result).not.toContain('systemPrompt')
    expect(result).not.toContain('model changed')
  })

  it('filters out .properties changes', () => {
    mockGetBlock.mockReturnValue({ subBlocks: [] })

    const summary = emptyDiffSummary({
      hasChanges: true,
      modifiedBlocks: [
        {
          id: 'block-1',
          type: 'agent',
          name: 'Agent',
          changes: [
            { field: 'systemPrompt', oldValue: 'old', newValue: 'new' },
            {
              field: 'systemPrompt.properties',
              oldValue: { some: 'meta' },
              newValue: { some: 'other' },
            },
            { field: 'model.properties', oldValue: {}, newValue: { x: 1 } },
          ],
        },
      ],
    })

    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('systemPrompt changed')
    expect(result).not.toContain('.properties')
    expect(result).not.toContain('model.properties')
  })

  it('respects MAX_CHANGES_PER_BLOCK limit of 6', () => {
    mockGetBlock.mockReturnValue({ subBlocks: [] })

    const changes = Array.from({ length: 8 }, (_, i) => ({
      field: `field${i}`,
      oldValue: `old${i}`,
      newValue: `new${i}`,
    }))

    const summary = emptyDiffSummary({
      hasChanges: true,
      modifiedBlocks: [{ id: 'b1', type: 'agent', name: 'Agent', changes }],
    })

    const result = formatDiffSummaryForDescription(summary)
    const lines = result.split('\n')
    const modifiedLines = lines.filter((l) => l.startsWith('Modified'))
    expect(modifiedLines).toHaveLength(6)
    expect(result).toContain('...and 2 more changes in Agent')
  })

  it('shows edge changes with block names', () => {
    const summary = emptyDiffSummary({
      hasChanges: true,
      edgeChanges: {
        added: 2,
        removed: 1,
        addedDetails: [
          { sourceName: 'My Agent', targetName: 'Slack' },
          { sourceName: 'Router', targetName: 'Gmail' },
        ],
        removedDetails: [{ sourceName: 'Function', targetName: 'Webhook' }],
      },
    })

    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('Added connection: My Agent -> Slack')
    expect(result).toContain('Added connection: Router -> Gmail')
    expect(result).toContain('Removed connection: Function -> Webhook')
  })

  it('truncates edge details beyond MAX_EDGE_DETAILS', () => {
    const summary = emptyDiffSummary({
      hasChanges: true,
      edgeChanges: {
        added: 5,
        removed: 0,
        addedDetails: [
          { sourceName: 'A', targetName: 'B' },
          { sourceName: 'C', targetName: 'D' },
          { sourceName: 'E', targetName: 'F' },
          { sourceName: 'G', targetName: 'H' },
          { sourceName: 'I', targetName: 'J' },
        ],
        removedDetails: [],
      },
    })

    const result = formatDiffSummaryForDescription(summary)
    const connectionLines = result.split('\n').filter((l) => l.startsWith('Added connection'))
    expect(connectionLines).toHaveLength(3)
    expect(result).toContain('...and 2 more added connection(s)')
  })
})

describe('formatDiffSummaryForDescriptionAsync', () => {
  it('resolves dropdown values to labels', async () => {
    mockGetBlock.mockReturnValue({
      subBlocks: [
        {
          id: 'operation',
          title: 'Operation',
          type: 'dropdown',
          options: [
            { id: 'calendly_get_current_user', label: 'Get Current User' },
            { id: 'calendly_list_event_types', label: 'List Event Types' },
          ],
        },
      ],
    })

    const summary = emptyDiffSummary({
      hasChanges: true,
      modifiedBlocks: [
        {
          id: 'b1',
          type: 'calendly',
          name: 'Calendly',
          changes: [
            {
              field: 'operation',
              oldValue: 'calendly_get_current_user',
              newValue: 'calendly_list_event_types',
            },
          ],
        },
      ],
    })

    const mockState = { blocks: {} } as any
    const result = await formatDiffSummaryForDescriptionAsync(summary, mockState, 'wf-1')
    expect(result).toContain(
      'Modified Calendly: Operation changed from "Get Current User" to "List Event Types"'
    )
    expect(result).not.toContain('calendly_get_current_user')
  })
})
