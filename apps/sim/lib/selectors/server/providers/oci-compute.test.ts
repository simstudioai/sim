/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  prepareEndpoint: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-compute/operations', () => ({
  executeOciComputeOperation: mocks.execute,
}))

import { ociComputeSelectorAttachments } from '@/lib/selectors/server/providers/oci-compute'

function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci_compute.instances',
    context: { region: 'us-ashburn-1', compartmentId: 'compartment' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace' },
    workspaceId: 'workspace',
    principal: { kind: 'session', userId: 'user', sessionId: 'session' },
    requesterUserId: 'user',
    credential: {
      suppliedId: 'submitted',
      providerId: 'oci-api-key-service-account',
      access: {
        ok: true,
        resolvedCredentialId: 'authoritative',
        workspaceId: 'workspace',
        credentialType: 'service_account',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    recordCredentialUse: vi.fn(),
    ...overrides,
  }
}
async function execute(input: ExecuteServerSelectorArgs) {
  return ociComputeSelectorAttachments[
    input.selectorKey as keyof typeof ociComputeSelectorAttachments
  ].execute(input)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue({ prepareStaticEndpoint: mocks.prepareEndpoint })
  mocks.prepareEndpoint.mockResolvedValue({})
  mocks.execute.mockResolvedValue({
    success: true,
    output: { status: 200, requestId: 'request', instances: [], nextPage: 'next' },
  })
})

describe('OCI Compute selectors', () => {
  it('resolves a platform image outside the selected custom-image compartment', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: { status: 200, image: { id: 'platform-image', compartmentId: null } },
    })
    expect(
      await execute(
        args({
          selectorKey: 'oci_compute.images',
          request: { kind: 'detail', id: 'platform-image' },
        })
      )
    ).toMatchObject({ kind: 'detail', item: { id: 'platform-image' } })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('fetches one bounded page and preserves the cursor on an empty page', async () => {
    const input = args({ request: { kind: 'list', cursor: 'previous' } })
    expect(await execute(input)).toEqual({ kind: 'list', items: [], nextCursor: 'next' })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute.mock.calls[0][2]).toMatchObject({
      oauthCredential: 'authoritative',
      compartmentId: 'compartment',
      limit: 50,
      page: 'previous',
    })
    expect(input.recordCredentialUse).toHaveBeenCalledWith('oci-api-key-service-account')
  })

  it('uses an authorized credential, trusted workspace, and forwards cancellation', async () => {
    const signal = new AbortController().signal
    await execute(args({ signal }))
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authoritative',
      workspaceId: 'workspace',
      serviceId: 'oci_compute',
      region: 'us-ashburn-1',
    })
    expect(mocks.execute.mock.calls[0][3]).toBe(signal)
  })

  it('resolves a selected instance directly and projects safe labels', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: {
        status: 200,
        instance: {
          id: 'instance',
          compartmentId: 'compartment',
          displayName: 'Worker',
          lifecycleState: 'RUNNING',
          metadata: { private: 'ignored' },
        },
      },
    })
    const result = await execute(args({ request: { kind: 'detail', id: 'instance' } }))
    expect(result).toEqual({
      kind: 'detail',
      item: { id: 'instance', label: 'Worker (instance)', meta: { lifecycleState: 'RUNNING' } },
    })
    expect(mocks.execute.mock.calls[0][1]).toBe('get_instance')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('uses a separate parent compartment for compartment discovery', async () => {
    mocks.execute.mockResolvedValue({ success: true, output: { status: 200, compartments: [] } })
    await execute(
      args({
        selectorKey: 'oci_compute.compartments',
        context: {
          region: 'us-ashburn-1',
          parentCompartmentId: 'parent',
          compartmentId: 'selected',
        },
      })
    )
    expect(mocks.execute.mock.calls[0][2]).toMatchObject({
      compartmentId: 'parent',
      accessLevel: 'ACCESSIBLE',
    })
  })

  it('resolves a shape using an exact filtered page without scanning inventory', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: { status: 200, shapes: [{ shape: 'VM.Standard.E4.Flex', isFlexible: true }] },
    })
    const result = await execute(
      args({
        selectorKey: 'oci_compute.shapes',
        request: { kind: 'detail', id: 'VM.Standard.E4.Flex' },
      })
    )
    expect(result.kind).toBe('detail')
    expect(mocks.execute.mock.calls[0][2]).toMatchObject({
      shape: 'VM.Standard.E4.Flex',
      limit: 50,
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('preserves continuation after filtering incompatible subnet placement', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: {
        status: 200,
        subnets: [{ id: 'subnet', availabilityDomain: 'other' }],
        nextPage: 'next',
      },
    })
    expect(
      await execute(
        args({
          selectorKey: 'oci_compute.subnets',
          context: {
            region: 'us-ashburn-1',
            compartmentId: 'compartment',
            availabilityDomain: 'selected',
          },
        })
      )
    ).toEqual({ kind: 'list', items: [], nextCursor: 'next' })
    expect(mocks.execute.mock.calls[0][2]).not.toHaveProperty('availabilityDomain')
  })

  it('does not dispatch canceled or incorrectly bound credentials', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(execute(args({ signal: controller.signal }))).rejects.toBeDefined()
    await expect(execute(args({ credential: undefined }))).rejects.toBeDefined()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
