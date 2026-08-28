/**
 * @vitest-environment node
 */
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
import { JiraOperationError } from '@/lib/internal/jira/errors'
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
    vi.clearAllMocks()
    for (const operation of Object.values(OPERATIONS)) {
      operation.mockResolvedValue({ success: true, output: { ok: true } })
    }
  })

  it.each(Object.keys(INPUTS) as Array<keyof typeof INPUTS>)(
    'validates and dispatches %s with trusted execution context',
    async (toolId) => {
      const controller = new AbortController()
      const response = await executeJiraTool(request(toolId, { signal: controller.signal }))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ success: true, output: { ok: true } })
      expect(OPERATIONS[toolId]).toHaveBeenCalledWith(
        INPUTS[toolId],
        expect.objectContaining({
          userId: 'user-1',
          requestId: 'request-1',
          signal: controller.signal,
        })
      )
    }
  )

  it('preserves the distinct authentication envelopes', async () => {
    const context = createExecutionContext({ workflowId: 'workflow-1' })
    const write = await executeJiraTool(request('jira_write', { context }))
    const attachment = await executeJiraTool(request('jira_add_attachment', { context }))

    expect(write.status).toBe(401)
    await expect(write.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(attachment.status).toBe(401)
    await expect(attachment.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.addAttachment).not.toHaveBeenCalled()
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

  it('preserves provider status and route-compatible response bodies', async () => {
    mocks.write.mockRejectedValue(
      new JiraOperationError(429, { error: 'Rate limited', details: '{"errorMessages":[]}' })
    )

    const response = await executeJiraTool(request('jira_write'))

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limited',
      details: '{"errorMessages":[]}',
    })
  })

  it('propagates cancellation before and after operation execution', async () => {
    const before = new AbortController()
    before.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      executeJiraTool(request('jira_write', { signal: before.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.write).not.toHaveBeenCalled()

    const after = new AbortController()
    mocks.write.mockImplementationOnce(async () => {
      after.abort(new DOMException('cancelled', 'AbortError'))
      return { success: true }
    })
    await expect(
      executeJiraTool(request('jira_write', { signal: after.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
