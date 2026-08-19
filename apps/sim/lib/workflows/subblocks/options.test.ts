/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchQuery, mockGetSubBlockValue, mockTriggerOptions } = vi.hoisted(() => ({
  mockFetchQuery: vi.fn(),
  mockGetSubBlockValue: vi.fn(),
  mockTriggerOptions: vi.fn(),
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => ({ fetchQuery: mockFetchQuery }),
}))

vi.mock('@/hooks/queries/sandboxes', () => ({
  getSandboxListQueryOptions: (workspaceId: string) => ({
    queryKey: ['sandboxes', 'list', workspaceId],
  }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({ hydration: { workspaceId: 'workspace-1' } }),
  },
}))

vi.mock('@/lib/logs/get-trigger-options', () => ({
  getTriggerOptions: () => mockTriggerOptions(),
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: {
    getState: () => ({ getValue: mockGetSubBlockValue }),
  },
}))

import {
  fetchTriggerTypeOptions,
  fetchWorkspaceSandboxOption,
  fetchWorkspaceSandboxOptions,
} from '@/lib/workflows/subblocks/options'

const SANDBOXES = [
  { id: 'sandbox-python', name: 'Data tools', language: 'python' },
  { id: 'sandbox-javascript', name: 'Node tools', language: 'javascript' },
]

describe('workspace sandbox options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchQuery.mockResolvedValue({ sandboxes: SANDBOXES })
  })

  it('lists both dependency ecosystems by their workspace-unique names for Shell blocks', async () => {
    mockGetSubBlockValue.mockReturnValue('shell')

    await expect(fetchWorkspaceSandboxOptions('block-1')).resolves.toEqual([
      { id: 'sandbox-python', label: 'Data tools' },
      { id: 'sandbox-javascript', label: 'Node tools' },
    ])
  })

  it('keeps language-specific block lists filtered and name-only', async () => {
    mockGetSubBlockValue.mockReturnValue('python')

    await expect(fetchWorkspaceSandboxOptions('block-1')).resolves.toEqual([
      { id: 'sandbox-python', label: 'Data tools' },
    ])
  })

  it('uses workspace-unique names when the sibling language is unavailable', async () => {
    mockGetSubBlockValue.mockReturnValue(undefined)

    await expect(fetchWorkspaceSandboxOptions('synthetic-block-1')).resolves.toEqual([
      { id: 'sandbox-python', label: 'Data tools' },
      { id: 'sandbox-javascript', label: 'Node tools' },
    ])
  })

  it('hydrates a stored Shell selection by name', async () => {
    mockGetSubBlockValue.mockReturnValue('shell')

    await expect(fetchWorkspaceSandboxOption('block-1', 'sandbox-python')).resolves.toEqual({
      id: 'sandbox-python',
      label: 'Data tools',
    })
  })

  it('hydrates a synthetic single option by name', async () => {
    mockGetSubBlockValue.mockReturnValue(undefined)

    await expect(
      fetchWorkspaceSandboxOption('synthetic-block-1', 'sandbox-javascript')
    ).resolves.toEqual({
      id: 'sandbox-javascript',
      label: 'Node tools',
    })
  })

  it('keeps mismatched persisted selections visible for language-specific blocks', async () => {
    mockGetSubBlockValue.mockReturnValue('python')

    await expect(fetchWorkspaceSandboxOption('block-1', 'sandbox-javascript')).resolves.toEqual({
      id: 'sandbox-javascript',
      label: 'Node tools · wrong language for this block',
    })
  })
})

describe('fetchTriggerTypeOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges values that share a label into one comma-joined option', async () => {
    mockTriggerOptions.mockReturnValue([
      { value: 'api', label: 'API', color: '#2563eb' },
      { value: 'copilot', label: 'Sim agent', color: '#ec4899' },
      { value: 'mothership', label: 'Sim agent', color: '#ec4899' },
      { value: 'slack', label: 'Slack', color: '#611f69' },
    ])

    await expect(fetchTriggerTypeOptions()).resolves.toEqual([
      { id: 'api', label: 'API' },
      { id: 'copilot,mothership', label: 'Sim agent' },
      { id: 'slack', label: 'Slack' },
    ])
  })

  it('preserves registry order so core trigger types lead the list', async () => {
    mockTriggerOptions.mockReturnValue([
      { value: 'manual', label: 'Manual', color: '#6b7280' },
      { value: 'api', label: 'API', color: '#2563eb' },
      { value: 'airtable', label: 'Airtable', color: '#181d1f' },
    ])

    await expect(fetchTriggerTypeOptions()).resolves.toEqual([
      { id: 'manual', label: 'Manual' },
      { id: 'api', label: 'API' },
      { id: 'airtable', label: 'Airtable' },
    ])
  })
})
