/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  generateLargeValuePayloadKey,
  generateUniqueExecutionFileKey,
} from '@/lib/uploads/contexts/execution/utils'

const context = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

describe('execution storage keys', () => {
  it('retains deterministic keys for large-value payloads', () => {
    const key = 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abc123.json'

    expect(generateLargeValuePayloadKey(context, 'lv_abc123')).toBe(key)
    expect(generateLargeValuePayloadKey(context, 'lv_abc123')).toBe(key)
  })

  it('allocates unique keys for duplicate file names, keeping the name as the final segment', () => {
    const first = generateUniqueExecutionFileKey(context, 'report final.pdf')
    const second = generateUniqueExecutionFileKey(context, 'report final.pdf')
    const shape = /^execution\/workspace-1\/workflow-1\/execution-1\/[0-9a-f-]+\/report-final\.pdf$/

    expect(first).toMatch(shape)
    expect(second).toMatch(shape)
    expect(first).not.toBe(second)
  })
})
