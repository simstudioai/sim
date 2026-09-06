/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/internal/oci-vision/operations', () => ({
  prepareOciVisionClient: mocks.prepare,
  executeOciVisionOperation: mocks.execute,
}))

import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociVisionSelectorAttachments } from '@/lib/selectors/server/providers/oci-vision'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const project = {
  id: 'project-1',
  compartmentId: 'compartment-1',
  displayName: 'Project',
  lifecycleState: 'ACTIVE',
}
const model = {
  ...project,
  id: 'model-1',
  projectId: 'project-1',
  displayName: 'Classifier',
  modelType: 'IMAGE_CLASSIFICATION',
}
const destination = { client: {}, endpoint: {} }
function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci_vision.classification_models',
    context: {
      oauthCredential: 'supplied-alias',
      compartmentId: 'compartment-1',
      region: 'us-ashburn-1',
      projectId: 'project-1',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    credential: {
      suppliedId: 'supplied-alias',
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      access: {
        ok: true,
        credentialType: 'service_account',
        resolvedCredentialId: 'resolved-credential',
      },
    },
    ...overrides,
  }
}
function execute(input: ExecuteServerSelectorArgs) {
  const key = input.selectorKey as keyof typeof ociVisionSelectorAttachments
  return ociVisionSelectorAttachments[key].execute(input)
}

describe('OCI Vision unified selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepare.mockResolvedValue(destination)
    mocks.execute.mockResolvedValue({ success: true, output: { models: [model], nextPage: null } })
  })

  it('binds the authoritative credential and workspace to the selected destination', async () => {
    await expect(execute(args())).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'model-1', label: 'Classifier' }],
    })
    expect(mocks.prepare).toHaveBeenCalledWith(
      { credentialId: 'resolved-credential', region: 'us-ashburn-1' },
      'workspace-1'
    )
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'list_models',
        credentialId: 'resolved-credential',
        compartmentId: 'compartment-1',
        projectId: 'project-1',
        lifecycleState: 'ACTIVE',
        limit: 100,
      }),
      expect.objectContaining({ workspaceId: 'workspace-1' }),
      destination
    )
  })

  it.each([
    undefined,
    { suppliedId: 'alias' },
    {
      suppliedId: 'alias',
      providerId: 'other-provider',
      access: {
        ok: true,
        credentialType: 'service_account' as const,
        resolvedCredentialId: 'credential-1',
      },
    },
    {
      suppliedId: 'alias',
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      access: {
        ok: false,
        credentialType: 'service_account' as const,
        resolvedCredentialId: 'credential-1',
      },
    },
  ])('rejects missing or incompatible authoritative credential binding %#', async (credential) => {
    await expect(execute(args({ credential }))).rejects.toThrow()
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('filters type, lifecycle, compartment, and project without losing an empty page cursor', async () => {
    mocks.execute.mockResolvedValueOnce({
      success: true,
      output: {
        models: [
          { ...model, modelType: 'OBJECT_DETECTION' },
          { ...model, lifecycleState: 'CREATING' },
          { ...model, compartmentId: 'another-compartment' },
          { ...model, projectId: 'another-project' },
        ],
        nextPage: 'next-model-page',
      },
    })
    await expect(execute(args())).resolves.toEqual({
      kind: 'list',
      items: [],
      nextCursor: 'next-model-page',
    })
    await execute(args({ request: { kind: 'list', cursor: 'next-model-page' } }))
    expect(mocks.execute.mock.calls[1][0].page).toBe('next-model-page')
  })

  it('keeps the object-detection selector fixed to its own model type', async () => {
    mocks.execute.mockResolvedValueOnce({
      success: true,
      output: {
        models: [
          model,
          { ...model, id: 'detector-1', displayName: 'Detector', modelType: 'OBJECT_DETECTION' },
        ],
        nextPage: null,
      },
    })
    await expect(
      execute(args({ selectorKey: 'oci_vision.object_detection_models' }))
    ).resolves.toEqual({ kind: 'list', items: [{ id: 'detector-1', label: 'Detector' }] })
  })

  it('discovers projects through the same credential-bound path', async () => {
    mocks.execute.mockResolvedValueOnce({
      success: true,
      output: { projects: [project], nextPage: 'next-project-page' },
    })
    await expect(execute(args({ selectorKey: 'oci_vision.projects' }))).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'project-1', label: 'Project' }],
      nextCursor: 'next-project-page',
    })
    expect(mocks.execute.mock.calls[0][0].operation).toBe('list_projects')
  })

  it.each([
    { ...model, modelType: 'OBJECT_DETECTION' },
    { ...model, lifecycleState: 'DELETED' },
    { ...model, id: 'different-model' },
  ])('rejects incompatible manually entered model detail %#', async (value) => {
    mocks.execute.mockResolvedValueOnce({ success: true, output: { model: value } })
    await expect(execute(args({ request: { kind: 'detail', id: 'model-1' } }))).resolves.toEqual({
      kind: 'detail',
      item: null,
    })
  })

  it('resolves matching model and project detail IDs', async () => {
    mocks.execute.mockResolvedValueOnce({ success: true, output: { model } })
    await expect(execute(args({ request: { kind: 'detail', id: 'model-1' } }))).resolves.toEqual({
      kind: 'detail',
      item: { id: 'model-1', label: 'Classifier' },
    })
    mocks.execute.mockResolvedValueOnce({ success: true, output: { project } })
    await expect(
      execute(
        args({ selectorKey: 'oci_vision.projects', request: { kind: 'detail', id: 'project-1' } })
      )
    ).resolves.toEqual({ kind: 'detail', item: { id: 'project-1', label: 'Project' } })
  })

  it('requires compartment context and propagates aborts', async () => {
    await expect(execute(args({ context: {} }))).rejects.toThrow()
    expect(mocks.execute).not.toHaveBeenCalled()
    await expect(
      execute(args({ signal: AbortSignal.abort(new Error('Stopped')) }))
    ).rejects.toThrow('Stopped')
  })

  it('does not forward raw provider errors into selector diagnostics', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('private-canary'))
    try {
      await execute(args())
      throw new Error('Expected selector rejection')
    } catch (error) {
      expect(String(error)).not.toContain('private-canary')
      expect(String(error)).not.toContain('Expected selector rejection')
    }
  })
})
