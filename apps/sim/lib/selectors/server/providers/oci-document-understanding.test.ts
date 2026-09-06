/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prepare, operation } = vi.hoisted(() => ({ prepare: vi.fn(), operation: vi.fn() }))
vi.mock('@/lib/internal/oci-document-understanding/client', () => ({
  prepareDocumentClient: prepare,
}))
vi.mock('@/lib/internal/oci-document-understanding/operations', () => ({
  executeDocumentOperation: operation,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociDocumentSelectorAttachments } from '@/lib/selectors/server/providers/oci-document-understanding'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci_document_understanding.models',
    context: {
      oauthCredential: 'visible',
      compartmentId: 'compartment-1',
      projectId: 'project-1',
      region: 'us-chicago-1',
    },
    request: { kind: 'list', cursor: 'page-1' },
    scope: { kind: 'workspace', workspaceId: 'trusted-workspace' },
    workspaceId: 'trusted-workspace',
    principal: { kind: 'session', userId: 'actor-1', sessionId: 'session-1' },
    requesterUserId: 'actor-1',
    credential: {
      suppliedId: 'visible',
      providerId: 'oci-api-key-service-account',
      access: {
        ok: true,
        resolvedCredentialId: 'authorized',
        credentialType: 'service_account',
        workspaceId: 'trusted-workspace',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

async function execute(input: ExecuteServerSelectorArgs) {
  const attachment =
    ociDocumentSelectorAttachments[input.selectorKey as keyof typeof ociDocumentSelectorAttachments]
  if (attachment.destination === 'fixed') throw new Error('Expected prepared destination')
  return attachment.execute(input, await attachment.destination.prepare(input))
}

describe('document selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepare.mockResolvedValue({ client: 'prepared', endpoint: 'document', storage: 'storage' })
    operation.mockResolvedValue({
      success: true,
      output: {
        models: [
          {
            id: 'model-1',
            displayName: 'Invoice',
            modelType: 'KEY_VALUE_EXTRACTION',
            tenancyId: 'omit',
          },
        ],
        nextPage: 'page-2',
      },
    })
  })

  it('uses the authorized credential and trusted workspace for one discovery page', async () => {
    expect(await execute(args())).toEqual({
      kind: 'list',
      items: [{ id: 'model-1', label: 'Invoice', meta: { modelType: 'KEY_VALUE_EXTRACTION' } }],
      nextCursor: 'page-2',
    })
    expect(prepare).toHaveBeenCalledWith(
      { credentialId: 'authorized', region: 'us-chicago-1' },
      'trusted-workspace'
    )
    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'list_models',
        credentialId: 'authorized',
        compartmentId: 'compartment-1',
        projectId: 'project-1',
        lifecycleState: 'ACTIVE',
        page: 'page-1',
        limit: 100,
      }),
      expect.objectContaining({ context: { workspaceId: 'trusted-workspace', workflowId: '' } }),
      expect.anything()
    )
    expect(operation).toHaveBeenCalledOnce()
  })

  it('preserves pagination when the client-side model type filter yields no matches', async () => {
    const input = args()
    input.context.modelType = 'DOCUMENT_CLASSIFICATION'
    expect(await execute(input)).toEqual({ kind: 'list', items: [], nextCursor: 'page-2' })
    expect(operation.mock.calls[0][0]).not.toHaveProperty('modelType')
  })

  it('projects project labels and exact artifact names without exposing provider data', async () => {
    const input = args()
    input.selectorKey = 'oci_document_understanding.projects'
    operation.mockResolvedValueOnce({
      success: true,
      output: {
        projects: [{ id: 'project-1', displayName: 'Documents', description: 'private' }],
        nextPage: null,
      },
    })
    expect((await execute(input)).items).toEqual([{ id: 'project-1', label: 'Documents' }])
    input.selectorKey = 'oci_document_understanding.artifacts'
    input.context = { jobId: 'job-1' }
    input.request = { kind: 'list', cursor: 'documents/job-1/next' }
    operation.mockResolvedValueOnce({
      success: true,
      output: {
        objects: [{ name: 'documents/job-1/ 空% .json', size: 10, etag: 'omit' }],
        nextStartWith: 'documents/job-1/next-2',
      },
    })
    expect(await execute(input)).toEqual({
      kind: 'list',
      items: [
        {
          id: 'documents/job-1/ 空% .json',
          label: 'documents/job-1/ 空% .json',
          meta: { size: 10 },
        },
      ],
      nextCursor: 'documents/job-1/next-2',
    })
    expect(operation.mock.calls[1][0]).toMatchObject({
      operation: 'list_job_outputs',
      jobId: 'job-1',
      start: 'documents/job-1/next',
    })
  })

  it('does not fall back to a visible ID or incompatible credential kind', async () => {
    const input = args()
    input.credential = { suppliedId: 'visible', providerId: 'oci-api-key-service-account' }
    await expect(execute(input)).rejects.toMatchObject({
      name: 'SelectorConnectionUnavailableError',
    })
    input.credential = {
      ...args().credential,
      suppliedId: 'visible',
      providerId: 'oci-object-storage-service-account',
    }
    await expect(execute(input)).rejects.toMatchObject({
      name: 'SelectorConnectionUnavailableError',
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects missing dependencies and preserves aborts', async () => {
    const input = args()
    input.context.compartmentId = undefined
    await expect(execute(input)).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    expect(operation).not.toHaveBeenCalled()
    const controller = new AbortController()
    controller.abort()
    await expect(execute({ ...args(), signal: controller.signal })).rejects.toThrow()
  })

  it('does not expose raw provider failure messages', async () => {
    operation.mockRejectedValue(new Error('private-provider-body'))
    await expect(execute(args())).rejects.toMatchObject({ name: 'SelectorOptionsUnavailableError' })
  })
})
