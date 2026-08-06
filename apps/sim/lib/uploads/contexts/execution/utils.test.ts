/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  generateExecutionAttachmentKey,
  generateExecutionFileKey,
} from '@/lib/uploads/contexts/execution/utils'

const context = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}

describe('execution storage keys', () => {
  it('retains deterministic keys for internal execution artifacts', () => {
    expect(generateExecutionFileKey(context, 'result.json')).toBe(
      'execution/workspace-1/workflow-1/execution-1/result.json'
    )
    expect(generateExecutionFileKey(context, 'result.json')).toBe(
      'execution/workspace-1/workflow-1/execution-1/result.json'
    )
  })

  it('allocates unique create-only keys for duplicate browser attachment names', () => {
    const first = generateExecutionAttachmentKey(context, 'report final.pdf')
    const second = generateExecutionAttachmentKey(context, 'report final.pdf')

    expect(first).toMatch(
      /^execution\/workspace-1\/workflow-1\/execution-1\/[0-9a-f-]+-report-final\.pdf$/
    )
    expect(second).toMatch(
      /^execution\/workspace-1\/workflow-1\/execution-1\/[0-9a-f-]+-report-final\.pdf$/
    )
    expect(first).not.toBe(second)
  })
})
