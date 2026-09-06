/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeOperation = vi.hoisted(() => vi.fn())
vi.mock('@/lib/internal/oci-vision/operations', () => ({
  executeOciVisionOperation: executeOperation,
}))

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciVisionTool } from '@/lib/internal/oci-vision/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'oci_vision_get_image_job',
    input: { credentialId: 'resolved-credential', imageJobId: 'job-1' },
    context: { workspaceId: 'workspace-1', workflowId: 'workflow-1' },
    headers: new Headers(),
    requestId: 'request-1',
    ...overrides,
  }
}

describe('OCI Vision internal dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeOperation.mockResolvedValue({ success: true, output: { job: { id: 'job-1' } } })
  })

  it('uses trusted context and ignores workspace or credential aliases in input', async () => {
    const response = await executeOciVisionTool(
      request({
        input: {
          credentialId: 'resolved-credential',
          imageJobId: 'job-1',
          workspaceId: 'forged-workspace',
          oauthCredential: 'forged-credential',
        },
      })
    )
    expect(response.status).toBe(200)
    expect(executeOperation).toHaveBeenCalledWith(
      { operation: 'get_image_job', credentialId: 'resolved-credential', imageJobId: 'job-1' },
      expect.objectContaining({ workspaceId: 'workspace-1', workflowId: 'workflow-1' })
    )
  })

  it.each([
    { toolId: 'oci_vision_unknown' },
    { toolId: 'other_get_image_job' },
    { input: { credentialId: 'c', imageJobId: 'j', operation: 'cancel_image_job' } },
    { input: { oauthCredential: 'unresolved-credential', imageJobId: 'j' } },
    { input: null },
  ])('rejects invalid routing or unresolved credentials %#', async (overrides) => {
    const response = await executeOciVisionTool(request(overrides))
    expect(response.status).toBe(400)
    expect(executeOperation).not.toHaveBeenCalled()
  })

  it('requires a trusted workspace', async () => {
    const response = await executeOciVisionTool(request({ context: { workflowId: 'workflow-1' } }))
    expect(response.status).toBe(403)
    expect(executeOperation).not.toHaveBeenCalled()
  })

  it('caps materialized input before schema parsing', async () => {
    const response = await executeOciVisionTool(
      request({ input: { privateValue: 'x'.repeat(8 * 1024 * 1024) } })
    )
    expect(response.status).toBe(413)
    expect(executeOperation).not.toHaveBeenCalled()
  })

  it('does not expose invalid field values or unknown error messages', async () => {
    const invalid = await executeOciVisionTool(
      request({ input: { credentialId: 'c', imageJobId: { privateValue: 'private-canary' } } })
    )
    expect(await invalid.text()).not.toContain('private-canary')
    executeOperation.mockRejectedValueOnce(new Error('private-canary'))
    const failed = await executeOciVisionTool(request())
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain('private-canary')
  })

  it('preserves a safe foundation HTTP failure', async () => {
    executeOperation.mockRejectedValueOnce(new OciClientError('request_failed', { status: 429 }))
    const response = await executeOciVisionTool(request())
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ success: false })
  })

  it('propagates execution aborts', async () => {
    const signal = AbortSignal.abort(new Error('Stopped'))
    await expect(executeOciVisionTool(request({ signal }))).rejects.toThrow('Stopped')
    expect(executeOperation).not.toHaveBeenCalled()
  })
})
