/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeOperation } = vi.hoisted(() => ({ executeOperation: vi.fn() }))
vi.mock('@/lib/internal/oci-document-understanding/operations', () => ({
  executeDocumentOperation: executeOperation,
}))

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciDocumentTool } from '@/lib/internal/oci-document-understanding/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import {
  documentOperationInput,
  isDocumentJsonWithinLimit,
} from '@/tools/oci_document_understanding/shared'

function request(operation: string, input: unknown): InternalToolOperationCall {
  return {
    toolId: `oci_document_understanding_${operation}`,
    input,
    headers: new Headers(),
    requestId: 'request-1',
    context: { workflowId: 'workflow-1', workspaceId: 'trusted-workspace' },
  }
}
const auth = { credentialId: 'authorized' }
const analysisInput = {
  ...auth,
  source: 'objectStorage',
  objects: [{ namespaceName: 'namespace', bucketName: 'documents', objectName: 'invoice.pdf' }],
  features: [{ featureType: 'TEXT_EXTRACTION' }],
}

describe('document internal tool boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeOperation.mockResolvedValue({ success: true, output: {} })
  })

  it.each([
    ['analyze_document', analysisInput],
    [
      'create_processor_job',
      {
        ...analysisInput,
        compartmentId: 'compartment-1',
        outputLocation: { namespaceName: 'namespace', bucketName: 'results', prefix: 'docs' },
      },
    ],
    ['get_processor_job', { ...auth, jobId: 'job-1' }],
    ['cancel_processor_job', { ...auth, jobId: 'job-1' }],
    ['list_job_outputs', { ...auth, jobId: 'job-1' }],
    ['get_job_output', { ...auth, jobId: 'job-1', objectName: 'docs/job-1/results.json' }],
    ['list_projects', { ...auth, compartmentId: 'compartment-1' }],
    ['list_models', { ...auth, compartmentId: 'compartment-1' }],
    ['get_model', { ...auth, modelId: 'model-1' }],
    ['get_model_type', { ...auth, modelType: 'PRE_TRAINED_TEXT_EXTRACTION' }],
  ])('dispatches validated %s with trusted workspace context', async (operation, input) => {
    const result = await executeOciDocumentTool(request(operation, input))
    expect(result.status).toBe(200)
    expect(executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation, ...auth }),
      expect.objectContaining({
        context: { workflowId: 'workflow-1', workspaceId: 'trusted-workspace' },
      })
    )
  })

  it('uses only the executor-authorized credential and whitelisted product inputs', () => {
    const params = {
      oauthCredential: 'visible',
      accessToken: 'authorized',
      jobId: 'job-1',
      _context: { workspaceId: 'untrusted' },
      authorization: 'must-not-travel',
    }
    expect(documentOperationInput(params, ['jobId'])).toEqual({ ...auth, jobId: 'job-1' })
    expect(documentOperationInput({ oauthCredential: 'visible' }, [])).toEqual({ credentialId: '' })
  })

  it('rejects operation overrides, caller scope, absent scope and unsupported methods', async () => {
    for (const input of [
      { ...auth, jobId: 'job-1', operation: 'cancel_processor_job' },
      { ...auth, jobId: 'job-1', workspaceId: 'untrusted' },
    ])
      expect((await executeOciDocumentTool(request('get_processor_job', input))).status).toBe(400)
    expect((await executeOciDocumentTool(request('delete_model', auth))).status).toBe(400)
    const missing = request('get_processor_job', { ...auth, jobId: 'job-1' })
    missing.context.workspaceId = undefined
    expect((await executeOciDocumentTool(missing)).status).toBe(403)
    expect(executeOperation).not.toHaveBeenCalled()
  })

  it('bounds escaped JSON before dispatch, with exact multibyte accounting', async () => {
    const oversized = { ...auth, jobId: '\u0000'.repeat(200_000) }
    expect((await executeOciDocumentTool(request('get_processor_job', oversized))).status).toBe(413)
    const sample = { text: '界\n\u0000😀', optional: undefined, list: [undefined, '\ud800'] }
    const size = Buffer.byteLength(JSON.stringify(sample))
    expect(isDocumentJsonWithinLimit(sample, size)).toBe(true)
    expect(isDocumentJsonWithinLimit(sample, size - 1)).toBe(false)
    expect(executeOperation).not.toHaveBeenCalled()
  })

  it('reports possible paid dispatch and the retry token without leaking provider content', async () => {
    executeOperation.mockImplementation(async (_input, call) => {
      call.onMutationDispatch('stable-token')
      throw new OciClientError('request_failed', { status: 503, opcRequestId: 'opc-request-1' })
    })
    const response = await executeOciDocumentTool(request('analyze_document', analysisInput))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      success: false,
      error: 'OCI request failed',
      opcRequestId: 'opc-request-1',
      retryable: false,
      outcomeMayHaveOccurred: true,
      retryToken: 'stable-token',
    })
    expect(executeOperation).toHaveBeenCalledOnce()
  })

  it('does not claim a mutation occurred for a pre-dispatch failure', async () => {
    executeOperation.mockRejectedValue(new Error('private-document-or-key-material'))
    const response = await executeOciDocumentTool(request('analyze_document', analysisInput))
    const body = await response.json()
    expect(body.error).toBe('Document Understanding operation failed')
    expect(body.outcomeMayHaveOccurred).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('private-document')
  })

  it('bounds the final response without replaying paid processing', async () => {
    executeOperation.mockImplementation(async (_input, call) => {
      call.onMutationDispatch()
      return { success: true, output: { text: 'x'.repeat(8 * 1024 * 1024) } }
    })
    const response = await executeOciDocumentTool(request('analyze_document', analysisInput))
    expect((await response.json()).retryable).toBe(false)
    expect(executeOperation).toHaveBeenCalledOnce()
  })
})
