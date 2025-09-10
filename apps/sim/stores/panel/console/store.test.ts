import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConsoleStore } from '@/stores/panel/console/store'
import type { ConsoleUpdate } from '@/stores/panel/console/types'

vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-123'),
})

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return {
    ...actual,
    redactApiKeys: vi.fn((obj) => obj), // Return object as-is for testing
  }
})

describe('Console Store', () => {
  beforeEach(() => {
    useConsoleStore.setState({
      entries: [],
      isOpen: false,
    })
    vi.clearAllMocks()
  })

  describe('addConsole', () => {
    it('should add a new console entry with required fields', () => {
      const store = useConsoleStore.getState()

      const newEntry = store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Test Block',
        blockType: 'agent',
        success: true,
        output: { content: 'Test output' },
        durationMs: 100,
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })

      expect(newEntry).toBeDefined()
      expect(newEntry.id).toBe('test-uuid-123')
      expect(newEntry.workflowId).toBe('workflow-123')
      expect(newEntry.blockId).toBe('block-123')
      expect(newEntry.success).toBe(true)

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0]).toBe(newEntry)
    })

    it('should add entry with error', () => {
      const store = useConsoleStore.getState()

      store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Failed Block',
        blockType: 'agent',
        success: false,
        error: 'Something went wrong',
        durationMs: 50,
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:00.500Z',
      })

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].success).toBe(false)
      expect(state.entries[0].error).toBe('Something went wrong')
    })
  })

  describe('updateConsole', () => {
    beforeEach(() => {
      // Add a test entry first
      const store = useConsoleStore.getState()
      store.addConsole({
        workflowId: 'workflow-123',
        blockId: 'block-123',
        blockName: 'Test Block',
        blockType: 'agent',
        success: true,
        output: { content: 'Initial content' },
        durationMs: 100,
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })
    })

    it('should update console entry with string content', () => {
      const store = useConsoleStore.getState()

      store.updateConsole('block-123', 'Updated content')

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].output?.content).toBe('Updated content')
    })

    it('should update console entry with object update', () => {
      const store = useConsoleStore.getState()

      const update: ConsoleUpdate = {
        content: 'New content',
        success: false,
        error: 'Update error',
        durationMs: 200,
        endedAt: '2023-01-01T00:00:02.000Z',
      }

      store.updateConsole('block-123', update)

      const state = useConsoleStore.getState()
      const entry = state.entries[0]

      expect(entry.output?.content).toBe('New content')
      expect(entry.success).toBe(false)
      expect(entry.error).toBe('Update error')
      expect(entry.durationMs).toBe(200)
      expect(entry.endedAt).toBe('2023-01-01T00:00:02.000Z')
    })

    it('should update output object directly', () => {
      const store = useConsoleStore.getState()

      const update: ConsoleUpdate = {
        output: {
          content: 'Direct output update',
          status: 200,
        },
      }

      store.updateConsole('block-123', update)

      const state = useConsoleStore.getState()
      const entry = state.entries[0]

      expect(entry.output?.content).toBe('Direct output update')
      expect(entry.output?.status).toBe(200)
    })

    it('should not update non-matching block IDs', () => {
      const store = useConsoleStore.getState()

      store.updateConsole('non-existent-block', 'Should not update')

      const newState = useConsoleStore.getState()
      expect(newState.entries[0].output?.content).toBe('Initial content')
    })

    it('should handle partial updates correctly', () => {
      const store = useConsoleStore.getState()

      // First update only success flag
      store.updateConsole('block-123', { success: false })

      let state = useConsoleStore.getState()
      expect(state.entries[0].success).toBe(false)
      expect(state.entries[0].output?.content).toBe('Initial content') // Should remain unchanged

      // Then update only content
      store.updateConsole('block-123', { content: 'Partial update' })

      state = useConsoleStore.getState()
      expect(state.entries[0].success).toBe(false) // Should remain false
      expect(state.entries[0].output?.content).toBe('Partial update')
    })
  })

  describe('clearConsole', () => {
    beforeEach(() => {
      const store = useConsoleStore.getState()

      // Add multiple entries for different workflows
      store.addConsole({
        workflowId: 'workflow-1',
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'agent',
        success: true,
        output: {},
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })

      store.addConsole({
        workflowId: 'workflow-2',
        blockId: 'block-2',
        blockName: 'Block 2',
        blockType: 'api',
        success: true,
        output: {},
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })
    })

    it('should clear all entries when workflowId is null', () => {
      const store = useConsoleStore.getState()

      expect(store.entries).toHaveLength(2)

      store.clearConsole(null)

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(0)
    })

    it('should clear only specific workflow entries', () => {
      const store = useConsoleStore.getState()

      expect(store.entries).toHaveLength(2)

      store.clearConsole('workflow-1')

      const state = useConsoleStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].workflowId).toBe('workflow-2')
    })
  })

  describe('getWorkflowEntries', () => {
    beforeEach(() => {
      const store = useConsoleStore.getState()

      // Add entries for different workflows
      store.addConsole({
        workflowId: 'workflow-1',
        blockId: 'block-1',
        blockName: 'Block 1',
        blockType: 'agent',
        success: true,
        output: {},
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })

      store.addConsole({
        workflowId: 'workflow-2',
        blockId: 'block-2',
        blockName: 'Block 2',
        blockType: 'api',
        success: true,
        output: {},
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })

      store.addConsole({
        workflowId: 'workflow-1',
        blockId: 'block-3',
        blockName: 'Block 3',
        blockType: 'function',
        success: false,
        output: {},
        error: 'Test error',
        startedAt: '2023-01-01T00:00:00.000Z',
        endedAt: '2023-01-01T00:00:01.000Z',
      })
    })

    it('should return entries for specific workflow', () => {
      const store = useConsoleStore.getState()

      const workflow1Entries = store.getWorkflowEntries('workflow-1')
      const workflow2Entries = store.getWorkflowEntries('workflow-2')

      expect(workflow1Entries).toHaveLength(2)
      expect(workflow2Entries).toHaveLength(1)

      expect(workflow1Entries.every((entry) => entry.workflowId === 'workflow-1')).toBe(true)
      expect(workflow2Entries.every((entry) => entry.workflowId === 'workflow-2')).toBe(true)
    })

    it('should return empty array for non-existent workflow', () => {
      const store = useConsoleStore.getState()

      const entries = store.getWorkflowEntries('non-existent-workflow')

      expect(entries).toHaveLength(0)
    })
  })

  describe('toggleConsole', () => {
    it('should toggle console open state', () => {
      const store = useConsoleStore.getState()

      expect(store.isOpen).toBe(false)

      store.toggleConsole()
      expect(useConsoleStore.getState().isOpen).toBe(true)

      store.toggleConsole()
      expect(useConsoleStore.getState().isOpen).toBe(false)
    })
  })
})
