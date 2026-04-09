/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBlock } = vi.hoisted(() => ({
  mockGetBlock: vi.fn(),
}))

vi.mock('@/lib/workflows/subblocks/visibility', () => ({
  isNonEmptyValue: (v: unknown) => v !== null && v !== undefined && v !== '',
}))

vi.mock('@/triggers/constants', () => ({
  SYSTEM_SUBBLOCK_IDS: [],
  TRIGGER_RUNTIME_SUBBLOCK_IDS: [],
}))

vi.mock('@/blocks/types', () => ({
  SELECTOR_TYPES_HYDRATION_REQUIRED: [],
}))

vi.mock('@/executor/constants', () => ({
  CREDENTIAL_SET: { PREFIX: 'cred_set_' },
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: mockGetBlock,
  getAllBlocks: () => ({}),
  getAllBlockTypes: () => [],
  registry: {},
}))

vi.mock('@/lib/workflows/subblocks/context', () => ({
  buildSelectorContextFromBlock: vi.fn(() => ({})),
}))

vi.mock('@/hooks/queries/credential-sets', () => ({
  fetchCredentialSetById: vi.fn(),
}))

vi.mock('@/hooks/queries/oauth/oauth-credentials', () => ({
  fetchOAuthCredentialDetail: vi.fn(() => []),
}))

vi.mock('@/hooks/selectors/registry', () => ({
  getSelectorDefinition: vi.fn(() => ({ fetchList: vi.fn(() => []) })),
}))

vi.mock('@/hooks/selectors/resolution', () => ({
  resolveSelectorForSubBlock: vi.fn(),
}))

import { WorkflowBuilder } from '@sim/testing'
import type { WorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import {
  formatDiffSummaryForDescription,
  formatDiffSummaryForDescriptionAsync,
  generateWorkflowDiffSummary,
} from '@/lib/workflows/comparison/compare'
import { formatValueForDisplay, resolveFieldLabel } from '@/lib/workflows/comparison/resolve-values'

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
  vi.clearAllMocks()
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

  it('falls back to raw id when block not found', () => {
    mockGetBlock.mockReturnValue(null)
    expect(resolveFieldLabel('unknown_type', 'someField')).toBe('someField')
  })

  it('falls back to raw id when subBlock not found', () => {
    mockGetBlock.mockReturnValue({ subBlocks: [{ id: 'other', title: 'Other' }] })
    expect(resolveFieldLabel('agent', 'missingField')).toBe('missingField')
  })

  it('converts data.* fields to Title Case', () => {
    expect(resolveFieldLabel('agent', 'data.loopType')).toBe('Loop Type')
    expect(resolveFieldLabel('agent', 'data.canonicalModes')).toBe('Canonical Modes')
    expect(resolveFieldLabel('agent', 'data.isStarter')).toBe('Is Starter')
  })
})

describe('formatValueForDisplay', () => {
  it('handles null/undefined', () => {
    expect(formatValueForDisplay(null)).toBe('(none)')
    expect(formatValueForDisplay(undefined)).toBe('(none)')
  })

  it('handles booleans', () => {
    expect(formatValueForDisplay(true)).toBe('enabled')
    expect(formatValueForDisplay(false)).toBe('disabled')
  })

  it('truncates long strings', () => {
    const longStr = 'a'.repeat(60)
    expect(formatValueForDisplay(longStr)).toBe(`${'a'.repeat(50)}...`)
  })

  it('handles empty string', () => {
    expect(formatValueForDisplay('')).toBe('(empty)')
  })
})

describe('formatDiffSummaryForDescription', () => {
  it('returns no-changes message for empty diff', () => {
    const result = formatDiffSummaryForDescription(emptyDiffSummary())
    expect(result).toBe('No structural changes detected (configuration may have changed)')
  })

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

  it('shows variable changes with names', () => {
    const summary = emptyDiffSummary({
      hasChanges: true,
      variableChanges: {
        added: 2,
        removed: 1,
        modified: 1,
        addedNames: ['counter', 'apiKey'],
        removedNames: ['oldVar'],
        modifiedNames: ['threshold'],
      },
    })

    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain(
      'Variables: added "counter", "apiKey", removed "oldVar", modified "threshold"'
    )
  })

  it('handles data.* fields with Title Case labels', () => {
    mockGetBlock.mockReturnValue({ subBlocks: [] })

    const summary = emptyDiffSummary({
      hasChanges: true,
      modifiedBlocks: [
        {
          id: 'b1',
          type: 'agent',
          name: 'Agent',
          changes: [
            { field: 'data.loopType', oldValue: 'for', newValue: 'forEach' },
            { field: 'data.isStarter', oldValue: true, newValue: false },
          ],
        },
      ],
    })

    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('Modified Agent: Loop Type changed from "for" to "forEach"')
    expect(result).toContain('Modified Agent: Is Starter changed from "enabled" to "disabled"')
  })

  it('formats a realistic multi-block workflow change', () => {
    mockGetBlock.mockImplementation((type: string) => {
      if (type === 'agent') {
        return {
          subBlocks: [
            { id: 'systemPrompt', title: 'System Prompt' },
            { id: 'model', title: 'Model' },
            { id: 'temperature', title: 'Temperature' },
          ],
        }
      }
      if (type === 'slack') {
        return {
          subBlocks: [
            {
              id: 'operation',
              title: 'Operation',
              type: 'dropdown',
              options: [
                { id: 'slack_send_message', label: 'Send Message' },
                { id: 'slack_list_channels', label: 'List Channels' },
              ],
            },
            { id: 'channel', title: 'Channel' },
            { id: 'credential', title: 'Slack Account' },
          ],
        }
      }
      return null
    })

    const summary = emptyDiffSummary({
      hasChanges: true,
      addedBlocks: [{ id: 'b3', type: 'gmail', name: 'Gmail Notifications' }],
      removedBlocks: [{ id: 'b4', type: 'function', name: 'Legacy Transform' }],
      modifiedBlocks: [
        {
          id: 'b1',
          type: 'agent',
          name: 'AI Assistant',
          changes: [
            { field: 'model', oldValue: 'gpt-4o', newValue: 'claude-sonnet-4-5' },
            { field: 'temperature', oldValue: '0.7', newValue: '0.3' },
          ],
        },
        {
          id: 'b2',
          type: 'slack',
          name: 'Slack Alert',
          changes: [{ field: 'channel', oldValue: '#general', newValue: '#alerts' }],
        },
      ],
      edgeChanges: {
        added: 1,
        removed: 0,
        addedDetails: [{ sourceName: 'AI Assistant', targetName: 'Gmail Notifications' }],
        removedDetails: [],
      },
      variableChanges: {
        added: 1,
        removed: 0,
        modified: 0,
        addedNames: ['errorCount'],
        removedNames: [],
        modifiedNames: [],
      },
    })

    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Added block: Gmail Notifications (gmail)')
    expect(result).toContain('Removed block: Legacy Transform (function)')
    expect(result).toContain(
      'Modified AI Assistant: Model changed from "gpt-4o" to "claude-sonnet-4-5"'
    )
    expect(result).toContain('Modified AI Assistant: Temperature changed from "0.7" to "0.3"')
    expect(result).toContain('Modified Slack Alert: Channel changed from "#general" to "#alerts"')
    expect(result).toContain('Added connection: AI Assistant -> Gmail Notifications')
    expect(result).toContain('Variables: added "errorCount"')
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

  it('uses field titles in async path', async () => {
    mockGetBlock.mockReturnValue({
      subBlocks: [{ id: 'systemPrompt', title: 'System Prompt' }],
    })

    const summary = emptyDiffSummary({
      hasChanges: true,
      modifiedBlocks: [
        {
          id: 'b1',
          type: 'agent',
          name: 'Agent',
          changes: [{ field: 'systemPrompt', oldValue: 'Be helpful', newValue: 'Be concise' }],
        },
      ],
    })

    const mockState = { blocks: {} } as any
    const result = await formatDiffSummaryForDescriptionAsync(summary, mockState, 'wf-1')
    expect(result).toContain('System Prompt')
    expect(result).not.toContain('systemPrompt')
  })

  it('filters .properties changes in async path', async () => {
    mockGetBlock.mockReturnValue({ subBlocks: [] })

    const summary = emptyDiffSummary({
      hasChanges: true,
      modifiedBlocks: [
        {
          id: 'b1',
          type: 'agent',
          name: 'Agent',
          changes: [
            { field: 'prompt', oldValue: 'old', newValue: 'new' },
            { field: 'prompt.properties', oldValue: {}, newValue: { x: 1 } },
          ],
        },
      ],
    })

    const mockState = { blocks: {} } as any
    const result = await formatDiffSummaryForDescriptionAsync(summary, mockState, 'wf-1')
    expect(result).not.toContain('.properties')
  })
})

describe('end-to-end: generateWorkflowDiffSummary + formatDiffSummaryForDescription', () => {
  beforeEach(() => {
    mockGetBlock.mockReturnValue(null)
  })

  it('detects added and removed blocks between two workflow versions', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('agent-1', undefined, 'Summarizer')
      .connect('start', 'agent-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('agent-1', undefined, 'Summarizer')
      .addFunction('func-1', undefined, 'Formatter')
      .connect('start', 'agent-1')
      .connect('agent-1', 'func-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Added block: Formatter (function)')
    expect(result).toContain('Added connection: Summarizer -> Formatter')
    expect(result).not.toContain('Removed')
  })

  it('detects block removal and edge removal', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('agent-1', undefined, 'Classifier')
      .addFunction('func-1', undefined, 'Logger')
      .connect('start', 'agent-1')
      .connect('agent-1', 'func-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('agent-1', undefined, 'Classifier')
      .connect('start', 'agent-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Removed block: Logger (function)')
    expect(result).toContain('Removed connection: Classifier -> Logger')
    expect(result).not.toContain('Added block')
  })

  it('detects subBlock value changes on modified blocks', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('agent-1', undefined, 'Writer')
      .connect('start', 'agent-1')
      .build()
    previous.blocks['agent-1'].subBlocks = {
      systemPrompt: { id: 'systemPrompt', value: 'You are a helpful assistant' },
      model: { id: 'model', value: 'gpt-4o' },
    }

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('agent-1', undefined, 'Writer')
      .connect('start', 'agent-1')
      .build()
    current.blocks['agent-1'].subBlocks = {
      systemPrompt: { id: 'systemPrompt', value: 'You are a concise writer' },
      model: { id: 'model', value: 'claude-sonnet-4-5' },
    }

    mockGetBlock.mockReturnValue({
      subBlocks: [
        { id: 'systemPrompt', title: 'System Prompt' },
        { id: 'model', title: 'Model' },
      ],
    })

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain(
      'Modified Writer: System Prompt changed from "You are a helpful assistant" to "You are a concise writer"'
    )
    expect(result).toContain('Modified Writer: Model changed from "gpt-4o" to "claude-sonnet-4-5"')
  })

  it('detects loop addition with correct count', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addFunction('func-1', undefined, 'Process')
      .connect('start', 'func-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addFunction('func-1', undefined, 'Process')
      .addLoop('loop-1', undefined, { iterations: 5, loopType: 'for' })
      .addLoopChild('loop-1', 'loop-body', 'function')
      .connect('start', 'func-1')
      .connect('func-1', 'loop-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Added block: Loop (loop)')
    expect(result).toContain('Added block: loop-body (function)')
    expect(result).toContain('Added 1 loop(s)')
    expect(result).toContain('Added connection: Process -> Loop')
  })

  it('detects loop removal', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addLoop('loop-1', undefined, { iterations: 3, loopType: 'for' })
      .addLoopChild('loop-1', 'loop-body', 'agent')
      .connect('start', 'loop-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('agent-1', undefined, 'Direct Agent')
      .connect('start', 'agent-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Removed block: Loop (loop)')
    expect(result).toContain('Removed 1 loop(s)')
    expect(result).toContain('Added block: Direct Agent (agent)')
  })

  it('detects loop modification when iterations change', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addLoop('loop-1', undefined, { iterations: 3, loopType: 'for' })
      .addLoopChild('loop-1', 'loop-body', 'function')
      .connect('start', 'loop-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addLoop('loop-1', undefined, { iterations: 10, loopType: 'for' })
      .addLoopChild('loop-1', 'loop-body', 'function')
      .connect('start', 'loop-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Modified 1 loop(s)')
  })

  it('detects parallel addition', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addFunction('func-1', undefined, 'Sequencer')
      .connect('start', 'func-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addParallel('par-1', undefined, { count: 3, parallelType: 'count' })
      .addParallelChild('par-1', 'par-task-1', 'agent')
      .addParallelChild('par-1', 'par-task-2', 'function')
      .connect('start', 'par-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Added block: Parallel (parallel)')
    expect(result).toContain('Added 1 parallel group(s)')
    expect(result).toContain('Removed block: Sequencer (function)')
  })

  it('detects parallel removal', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addParallel('par-1', undefined, { count: 2 })
      .addParallelChild('par-1', 'par-task', 'function')
      .connect('start', 'par-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addFunction('func-1', undefined, 'Simple Step')
      .connect('start', 'func-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Removed block: Parallel (parallel)')
    expect(result).toContain('Removed 1 parallel group(s)')
    expect(result).toContain('Added block: Simple Step (function)')
  })

  it('detects parallel modification when count changes', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addParallel('par-1', undefined, { count: 2, parallelType: 'count' })
      .addParallelChild('par-1', 'par-task', 'function')
      .connect('start', 'par-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addParallel('par-1', undefined, { count: 5, parallelType: 'count' })
      .addParallelChild('par-1', 'par-task', 'function')
      .connect('start', 'par-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Modified 1 parallel group(s)')
  })

  it('detects variable additions and removals with names', () => {
    const previous = new WorkflowBuilder().addStarter('start').build()
    previous.variables = {
      v1: { id: 'v1', name: 'retryCount', type: 'number', value: 3 },
      v2: { id: 'v2', name: 'apiEndpoint', type: 'string', value: 'https://api.example.com' },
    }

    const current = new WorkflowBuilder().addStarter('start').build()
    current.variables = {
      v1: { id: 'v1', name: 'retryCount', type: 'number', value: 5 },
      v3: { id: 'v3', name: 'timeout', type: 'number', value: 30 },
    }

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Variables:')
    expect(result).toContain('added "timeout"')
    expect(result).toContain('removed "apiEndpoint"')
    expect(result).toContain('modified "retryCount"')
  })

  it('produces no-change message for identical workflows', () => {
    const workflow = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('agent-1', undefined, 'Agent')
      .connect('start', 'agent-1')
      .build()

    const summary = generateWorkflowDiffSummary(workflow, workflow)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toBe('No structural changes detected (configuration may have changed)')
  })

  it('handles complex scenario: loop replaced with parallel + new connections + variables', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addLoop('loop-1', undefined, { iterations: 5 })
      .addLoopChild('loop-1', 'loop-task', 'agent')
      .addFunction('sink', undefined, 'Output')
      .connect('start', 'loop-1')
      .connect('loop-1', 'sink')
      .build()
    previous.variables = {
      v1: { id: 'v1', name: 'batchSize', type: 'number', value: 10 },
    }

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addParallel('par-1', undefined, { count: 3 })
      .addParallelChild('par-1', 'par-task', 'agent')
      .addFunction('sink', undefined, 'Output')
      .addAgent('agg', undefined, 'Aggregator')
      .connect('start', 'par-1')
      .connect('par-1', 'agg')
      .connect('agg', 'sink')
      .build()
    current.variables = {
      v1: { id: 'v1', name: 'batchSize', type: 'number', value: 25 },
      v2: { id: 'v2', name: 'concurrency', type: 'number', value: 3 },
    }

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Added block: Parallel (parallel)')
    expect(result).toContain('Added block: Aggregator (agent)')
    expect(result).toContain('Removed block: Loop (loop)')
    expect(result).toContain('Added 1 parallel group(s)')
    expect(result).toContain('Removed 1 loop(s)')
    expect(result).toContain('added "concurrency"')
    expect(result).toContain('modified "batchSize"')

    const lines = result.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(7)
  })

  it('detects edge rewiring without block changes', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('a', undefined, 'Agent A')
      .addAgent('b', undefined, 'Agent B')
      .addFunction('sink', undefined, 'Output')
      .connect('start', 'a')
      .connect('a', 'sink')
      .connect('start', 'b')
      .connect('b', 'sink')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addAgent('a', undefined, 'Agent A')
      .addAgent('b', undefined, 'Agent B')
      .addFunction('sink', undefined, 'Output')
      .connect('start', 'a')
      .connect('a', 'b')
      .connect('b', 'sink')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(summary.addedBlocks).toHaveLength(0)
    expect(summary.removedBlocks).toHaveLength(0)
    expect(result).toContain('Added connection: Agent A -> Agent B')
    expect(result).toContain('Removed connection:')
    expect(result).not.toContain('Added block')
    expect(result).not.toContain('Removed block')
  })

  it('detects data field changes with human-readable labels', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addBlock('custom-1', 'function', undefined, 'Processor')
      .connect('start', 'custom-1')
      .build()
    previous.blocks['custom-1'].data = { isStarter: true, retryPolicy: 'linear' }

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addBlock('custom-1', 'function', undefined, 'Processor')
      .connect('start', 'custom-1')
      .build()
    current.blocks['custom-1'].data = { isStarter: false, retryPolicy: 'exponential' }

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Is Starter')
    expect(result).toContain('Retry Policy')
    expect(result).toContain('enabled')
    expect(result).toContain('disabled')
    expect(result).toContain('linear')
    expect(result).toContain('exponential')
  })

  it('detects loop type change via loop config modification', () => {
    const previous = new WorkflowBuilder()
      .addStarter('start')
      .addLoop('loop-1', undefined, { iterations: 3, loopType: 'for' })
      .addLoopChild('loop-1', 'loop-body', 'function')
      .connect('start', 'loop-1')
      .build()

    const current = new WorkflowBuilder()
      .addStarter('start')
      .addLoop('loop-1', undefined, { iterations: 3, loopType: 'forEach' })
      .addLoopChild('loop-1', 'loop-body', 'function')
      .connect('start', 'loop-1')
      .build()

    const summary = generateWorkflowDiffSummary(current, previous)
    const result = formatDiffSummaryForDescription(summary)

    expect(result).toContain('Modified 1 loop(s)')
  })
})
