/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), prepare: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))

import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociResourceManagerSelectorAttachments } from '@/lib/selectors/server/providers/oci-resource-manager'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci-resource-manager.plan-jobs',
    context: { oauthCredential: 'supplied', stackId: 'stack', ociRegion: 'credential' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace' },
    workspaceId: 'workspace',
    principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
    requesterUserId: 'actor',
    credential: {
      suppliedId: 'supplied',
      providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
      access: {
        ok: true,
        resolvedCredentialId: 'resolved',
        credentialType: 'service_account',
        workspaceId: 'workspace',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}
async function execute(input: ExecuteServerSelectorArgs) {
  const attachment =
    ociResourceManagerSelectorAttachments[
      input.selectorKey as keyof typeof ociResourceManagerSelectorAttachments
    ]
  if (typeof attachment.destination === 'string') throw new Error('Prepared destination expected')
  return attachment.execute(input, await attachment.destination.prepare(input))
}
function response(body: unknown, headers = {}) {
  return { status: 200, headers, body: new TextEncoder().encode(JSON.stringify(body)) }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.create.mockResolvedValue({ prepareStaticEndpoint: mocks.prepare, request: mocks.request })
  mocks.prepare.mockResolvedValue({ origin: 'resource-manager' })
  mocks.request.mockResolvedValue(response([]))
})
describe('Resource Manager selectors', () => {
  it('uses the resolved credential and trusted workspace', async () => {
    await execute(args())
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved',
      workspaceId: 'workspace',
      region: undefined,
      serviceId: 'oci-resource-manager',
    })
  })
  it('rejects foreign providers and workspaces before creating a client', async () => {
    const input = args()
    input.credential = { ...input.credential!, providerId: 'foreign' }
    await expect(execute(input)).rejects.toThrow()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('filters successful plans locally while preserving a page with no matches', async () => {
    mocks.request.mockResolvedValue(
      response(
        [
          {
            id: 'apply',
            stackId: 'stack',
            operation: 'APPLY',
            lifecycleState: 'SUCCEEDED',
            variables: { secret: 'canary' },
          },
        ],
        { 'opc-next-page': 'next-page' }
      )
    )
    const result = await execute(args())
    expect(JSON.stringify(result)).toContain('next-page')
    expect(JSON.stringify(result)).not.toContain('canary')
    expect(JSON.stringify(result)).not.toContain('apply')
    expect(mocks.request.mock.calls[0][0].queryPairs).not.toContainEqual(['operation', 'PLAN'])
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it.each([
    { id: 'job', stackId: 'other', operation: 'PLAN', lifecycleState: 'SUCCEEDED' },
    { id: 'job', stackId: 'stack', operation: 'APPLY', lifecycleState: 'SUCCEEDED' },
    { id: 'job', stackId: 'stack', operation: 'PLAN', lifecycleState: 'FAILED' },
  ])('rejects an ineligible selected plan', async (job) => {
    mocks.request.mockResolvedValue(response(job))
    const result = await execute(args({ request: { kind: 'detail', id: 'job' } }))
    expect(JSON.stringify(result)).not.toContain('job')
  })
  it('reads wrapped version collections without pagination or secret-bearing metadata', async () => {
    mocks.request.mockResolvedValue(
      response({ items: [{ name: '1.5.x', isDefault: true, secret: 'canary' }] })
    )
    const result = await execute(
      args({
        selectorKey: 'oci-resource-manager.terraform-versions',
        context: { oauthCredential: 'supplied' },
      })
    )
    expect(JSON.stringify(result)).toContain('1.5.x')
    expect(JSON.stringify(result)).not.toContain('canary')
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual([])
  })
})
