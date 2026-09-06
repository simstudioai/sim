/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/internal/oci-devops/operations', () => ({
  executeOciDevopsOperation: mocks.execute,
  operationDefinitions: { get_project: {} },
  OciDevopsError: class extends Error {},
}))

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciDevopsTool } from '@/lib/internal/oci-devops/execute-tool'
import { getRegisteredInternalToolOperationIds } from '@/lib/internal/tool-operations/registry.server'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import * as ociDevopsTools from '@/tools/oci_devops'

function request(toolId = 'oci_devops_get_project'): InternalToolOperationCall {
  return {
    toolId,
    input: { oauthCredential: 'credential', projectId: 'project' },
    headers: new Headers(),
    context: { workflowId: 'workflow', workspaceId: 'workspace', userId: 'actor' },
    requestId: 'request',
  }
}

describe('OCI DevOps internal dispatcher', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards trusted execution context and cancellation', async () => {
    const call = { ...request(), signal: new AbortController().signal }
    mocks.execute.mockResolvedValue({
      success: true,
      output: { accepted: false, resource: { id: 'p' } },
    })
    expect((await executeOciDevopsTool(call)).status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith('get_project', call.input, call.context, call.signal)
  })

  it.each(['oci_devops_unknown', 'github_get_project', 'oci_devops_toString'])(
    'rejects unregistered dispatch %s',
    async (toolId) => {
      expect((await executeOciDevopsTool(request(toolId))).status).toBe(400)
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('returns safe foundation error fields without provider diagnostics', async () => {
    mocks.execute.mockRejectedValue(
      new OciClientError('request_failed', { status: 412, opcRequestId: 'oci-request' })
    )
    const response = await executeOciDevopsTool(request())
    expect(response.status).toBe(412)
    expect(await response.json()).toEqual({
      success: false,
      error: 'OCI request failed',
      output: { code: 'request_failed', requestId: 'oci-request' },
    })
    mocks.execute.mockRejectedValue(new Error('sensitive provider message'))
    expect(await (await executeOciDevopsTool(request())).json()).toEqual({
      success: false,
      error: 'OCI DevOps operation failed',
    })
  })

  it('registers all 69 explicit tool descriptors through the internal boundary', () => {
    const tools = Object.values(ociDevopsTools)
    const registered = getRegisteredInternalToolOperationIds().filter((id) =>
      id.startsWith('oci_devops_')
    )
    expect(tools).toHaveLength(69)
    expect(registered.sort()).toEqual(tools.map((tool) => tool.id).sort())
    for (const tool of tools) {
      expect(tool.operation).toBeDefined()
      expect('request' in tool).toBe(false)
    }
  })
})
