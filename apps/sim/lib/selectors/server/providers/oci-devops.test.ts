/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), prepare: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/auth/credential-access', () => ({ authorizeCredentialUseForAuth: vi.fn() }))

import { OciClientError } from '@/lib/internal/oci/errors'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { isSelectorReady, selectorManifest } from '@/lib/selectors/manifest'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociDevopsSelectorAttachments } from '@/lib/selectors/server/providers/oci-devops'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { OciDevopsBlock } from '@/blocks/blocks/oci_devops'

type DevopsSelectorKey = keyof typeof ociDevopsSelectorAttachments
function args(
  selectorKey: DevopsSelectorKey = 'oci_devops.projects',
  request: ExecuteServerSelectorArgs['request'] = { kind: 'list' }
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: {
      oauthCredential: 'reference',
      region: 'us-ashburn-1',
      compartmentId: 'compartment',
      projectId: 'project',
      pipelineId: 'pipeline',
      repositoryId: 'repository',
    },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace' },
    workspaceId: 'workspace',
    principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
    requesterUserId: 'actor',
    credential: {
      suppliedId: 'reference',
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      access: { ok: true, resolvedCredentialId: 'authoritative', workspaceId: 'workspace' },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}
function response(body: unknown, headers: Record<string, string> = {}) {
  return { status: 200, body: new TextEncoder().encode(JSON.stringify(body)), headers }
}

describe('OCI DevOps server selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue({
      prepareStaticEndpoint: mocks.prepare,
      request: mocks.request,
    })
    mocks.prepare.mockResolvedValue({})
    mocks.request.mockResolvedValue(response({ items: [] }))
  })

  it('registers 13 credential-bound selectors with active parent readiness', () => {
    expect(Object.keys(ociDevopsSelectorAttachments)).toHaveLength(13)
    for (const [key, attachment] of Object.entries(ociDevopsSelectorAttachments)) {
      const selectorKey = key as DevopsSelectorKey
      expect(attachment.integrationBlockTypes).toEqual(['oci_devops'])
      expect(attachment.destination).toMatchObject({ kind: 'credential-bound' })
      expect(isSelectorReady(selectorKey, { oauthCredential: 'credential' })).toBe(false)
      expect(isSelectorReady(selectorKey, args(selectorKey).context)).toBe(true)
      expect(selectorManifest[selectorKey].context.allowed).toHaveLength(3)
    }
  })

  it('uses the authoritative credential and emits one safe page', async () => {
    mocks.request.mockResolvedValue(
      response(
        {
          items: [
            {
              id: 'project',
              compartmentId: 'compartment',
              name: 'Release',
              lifecycleState: 'ACTIVE',
              lifecycleDetails: 'private',
            },
          ],
        },
        { 'opc-next-page': 'opaque+/=' }
      )
    )
    const result = await ociDevopsSelectorAttachments['oci_devops.projects'].execute(
      args('oci_devops.projects', { kind: 'list', cursor: 'previous' })
    )
    expect(result).toEqual({
      kind: 'list',
      items: [{ id: 'project', label: 'Release', meta: { state: 'ACTIVE' } }],
      nextCursor: 'opaque+/=',
    })
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authoritative',
      workspaceId: 'workspace',
      serviceId: 'oci',
      region: 'us-ashburn-1',
    })
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual(
      expect.arrayContaining([
        ['compartmentId', 'compartment'],
        ['limit', '50'],
        ['page', 'previous'],
      ])
    )
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('rejects missing authorization, wrong workspace, and wrong provider before client creation', async () => {
    for (const credential of [
      undefined,
      { suppliedId: 'reference' },
      { ...args().credential, providerId: 'other', suppliedId: 'reference' },
      {
        ...args().credential,
        suppliedId: 'reference',
        access: { ok: true, resolvedCredentialId: 'id', workspaceId: 'other' },
      },
    ]) {
      await expect(
        ociDevopsSelectorAttachments['oci_devops.projects'].execute({ ...args(), credential })
      ).rejects.toThrow()
    }
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('rejects missing parents before creating a provider client', async () => {
    await expect(
      ociDevopsSelectorAttachments['oci_devops.projects'].execute({
        ...args(),
        context: { oauthCredential: 'reference' },
      })
    ).rejects.toThrow()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('binds detail resolution to the selected pipeline and selected ID', async () => {
    const attachment = ociDevopsSelectorAttachments['oci_devops.buildRuns']
    const request = args('oci_devops.buildRuns', { kind: 'detail', id: 'run' })
    mocks.request
      .mockResolvedValueOnce(
        response({ id: 'run', buildPipelineId: 'pipeline', displayName: 'Release' })
      )
      .mockResolvedValueOnce(response({ id: 'run', buildPipelineId: 'other' }))
      .mockResolvedValueOnce(response({ id: 'other', buildPipelineId: 'pipeline' }))
    expect(await attachment.execute(request)).toEqual({
      kind: 'detail',
      item: { id: 'run', label: 'Release', meta: { state: null } },
    })
    await expect(attachment.execute(request)).rejects.toThrow()
    await expect(attachment.execute(request)).rejects.toThrow()
  })

  it('rejects list records from a different parent', async () => {
    mocks.request.mockResolvedValue(
      response({ items: [{ id: 'project', compartmentId: 'other' }] })
    )
    await expect(
      ociDevopsSelectorAttachments['oci_devops.projects'].execute(args())
    ).rejects.toThrow()
  })

  it('resolves a provider ref name using a single filtered REST page', async () => {
    mocks.request.mockResolvedValue(
      response({
        items: [
          {
            refName: 'release/x',
            fullRefName: 'refs/heads/release/x',
            refType: 'BRANCH',
            repositoryId: 'repository',
          },
        ],
      })
    )
    expect(
      await ociDevopsSelectorAttachments['oci_devops.refs'].execute(
        args('oci_devops.refs', { kind: 'detail', id: 'release/x' })
      )
    ).toEqual({
      kind: 'detail',
      item: { id: 'release/x', label: 'release/x', meta: { state: null } },
    })
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual(
      expect.arrayContaining([['refName', 'release/x']])
    )
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it('returns a missing detail for a provider 404', async () => {
    mocks.request.mockRejectedValue(new OciClientError('request_failed', { status: 404 }))
    expect(
      await ociDevopsSelectorAttachments['oci_devops.projects'].execute(
        args('oci_devops.projects', { kind: 'detail', id: 'missing' })
      )
    ).toEqual({ kind: 'detail', item: null })
  })

  it.each([
    'get_build_run',
    'cancel_build_run',
    'update_build_run',
    'get_build_pipeline_stage',
    'get_deployment',
    'get_deploy_stage',
    'approve_deployment',
  ])('shows every ancestor needed to select a resource for %s', (operation) => {
    const visible = OciDevopsBlock.subBlocks.filter((field) => {
      const condition = field.condition
      return (
        !condition ||
        (typeof condition === 'object' &&
          Array.isArray(condition.value) &&
          condition.value.includes(operation))
      )
    })
    const canonicalIds = new Set(visible.map((field) => field.canonicalParamId ?? field.id))
    for (const field of visible.filter((field) => field.selectorKey)) {
      const parent = selectorManifest[field.selectorKey!].context.allowed.find(
        (key) => key !== 'oauthCredential' && key !== 'region'
      )
      const parentId =
        parent === 'pipelineId'
          ? operation.includes('build')
            ? 'buildPipelineId'
            : 'deployPipelineId'
          : parent
      expect(canonicalIds.has(parentId!)).toBe(true)
    }
  })
})
