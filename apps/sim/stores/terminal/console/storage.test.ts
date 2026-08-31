/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CONSOLE_STORAGE_VERSION,
  clearAllExecutionPointers,
  migratePersistedConsoleData,
  saveExecutionPointer,
} from '@/stores/terminal/console/storage'

const legacyEntry = {
  id: 'entry-1',
  timestamp: '2026-07-31T00:00:00.000Z',
  workflowId: 'workflow-1',
  blockId: 'function-1',
  blockName: 'Function 1',
  blockType: 'function',
  executionId: 'execution-1',
  executionOrder: 1,
  success: false,
  input: { secret: 'resolved-secret' },
  output: { value: 'resolved-secret' },
  error: 'ReferenceError: resolved-secret',
  warning: 'resolved-secret',
  agentStreamThinking: 'resolved-secret',
  agentStreamToolCalls: [
    {
      key: 'function-1:tool-1',
      id: 'tool-1',
      name: 'database_query',
      displayName: 'Database Query',
      status: 'error' as const,
    },
  ],
}

describe('terminal console storage migration', () => {
  it('strips content-bearing fields from unversioned persisted entries', () => {
    const result = migratePersistedConsoleData({
      workflowEntries: { 'workflow-1': [legacyEntry] },
      isOpen: true,
    })

    expect(result?.migrated).toBe(true)
    expect(result?.data.storageVersion).toBe(CONSOLE_STORAGE_VERSION)
    expect(result?.data.workflowEntries['workflow-1'][0]).toEqual({
      id: 'entry-1',
      timestamp: '2026-07-31T00:00:00.000Z',
      workflowId: 'workflow-1',
      blockId: 'function-1',
      blockName: 'Function 1',
      blockType: 'function',
      executionId: 'execution-1',
      executionOrder: 1,
      success: false,
      agentStreamToolCalls: legacyEntry.agentStreamToolCalls,
    })
  })

  it('strips content from the original flat Zustand storage format', () => {
    const result = migratePersistedConsoleData({
      state: { entries: [legacyEntry], isOpen: false },
      version: 0,
    })

    expect(result?.migrated).toBe(true)
    expect(result?.data.workflowEntries['workflow-1'][0]).not.toHaveProperty('error')
    expect(result?.data.workflowEntries['workflow-1'][0]).not.toHaveProperty('agentStreamThinking')
  })

  it('retains content already written under the current projection version', () => {
    const projectedEntry = {
      ...legacyEntry,
      input: { secret: '{{OPENAI_API_KEY}}' },
      output: { value: '{{OPENAI_API_KEY}}' },
      error: 'ReferenceError: {{OPENAI_API_KEY}}',
      agentStreamThinking: '{{OPENAI_API_KEY}}',
    }
    const result = migratePersistedConsoleData({
      storageVersion: CONSOLE_STORAGE_VERSION,
      workflowEntries: { 'workflow-1': [projectedEntry] },
      isOpen: false,
    })

    expect(result?.migrated).toBe(false)
    expect(result?.data.workflowEntries['workflow-1'][0]).toEqual(projectedEntry)
  })
})

describe('terminal execution pointers', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('clears every terminal pointer without removing unrelated tab state', async () => {
    window.sessionStorage.setItem('unrelated', 'keep')
    await saveExecutionPointer({
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      lastEventId: 1,
    })
    await saveExecutionPointer({
      workflowId: 'workflow-2',
      executionId: 'execution-2',
      lastEventId: 2,
    })

    clearAllExecutionPointers()

    expect(window.sessionStorage.getItem('terminal-active-execution:workflow-1')).toBeNull()
    expect(window.sessionStorage.getItem('terminal-active-execution:workflow-2')).toBeNull()
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep')
  })
})
