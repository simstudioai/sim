import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addAttachment: vi.fn(),
  update: vi.fn(),
  write: vi.fn(),
}))

vi.mock('@/lib/internal/jira/operations', () => ({
  executeJiraAddAttachment: mocks.addAttachment,
  executeJiraUpdate: mocks.update,
  executeJiraWrite: mocks.write,
}))

import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { executeJiraTool } from '@/lib/internal/jira/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const INPUTS = {
  jira_write: {
    accessToken: 'token',
    domain: 'example.atlassian.net',
    projectId: 'PROJ',
    summary: 'New issue',
    issueType: 'Task',
  },
  jira_update: {
    accessToken: 'token',
    domain: 'example.atlassian.net',
    issueKey: 'PROJ-1',
    summary: 'Updated issue',
  },
  jira_add_attachment: {
    accessToken: 'token',
    domain: 'example.atlassian.net',
    issueKey: 'PROJ-1',
    files: [{ key: 'workspace/file.txt', name: 'file.txt', size: 4 }],
  },
} as const

const OPERATIONS = {
  jira_write: mocks.write,
  jira_update: mocks.update,
  jira_add_attachment: mocks.addAttachment,
} as const

function request(
  toolId: keyof typeof INPUTS,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId,
    input: INPUTS[toolId],
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeJiraTool', () => {
  beforeEach(() => {
    for (const operation of Object.values(OPERATIONS)) {
      operation.mockResolvedValue({ success: true, output: { ok: true } })
    }
  })

  it('rejects invalid and oversized input before provider work', async () => {
    const invalid = await executeJiraTool(request('jira_update', { input: { accessToken: '' } }))
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })

    const oversized = await executeJiraTool(
      request('jira_update', {
        input: {
          ...INPUTS.jira_update,
          summary: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES + 1),
        },
      })
    )
    expect(oversized.status).toBe(413)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
