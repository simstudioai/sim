/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), prepare: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.create }))

import { OciClientError } from '@/lib/internal/oci/errors'
import { OCI_LOGGING_MANAGEMENT_POLICY } from '@/lib/internal/oci-logging/operations'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociLoggingSelectorAttachments } from '@/lib/selectors/server/providers/oci-logging'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const base: ExecuteServerSelectorArgs = {
  selectorKey: 'oci_logging.logGroups',
  context: { compartmentId: 'compartment', logGroupId: 'group', region: 'us-phoenix-1' },
  request: { kind: 'list' },
  scope: { kind: 'workspace', workspaceId: 'workspace' },
  workspaceId: 'workspace',
  principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
  requesterUserId: 'actor',
  references: new Map(),
  protectedValues: createSelectorProtectedValues(),
  credential: {
    suppliedId: 'supplied',
    access: {
      ok: true,
      credentialType: 'service_account',
      resolvedCredentialId: 'resolved',
      workspaceId: 'workspace',
    },
  },
}
function execute(overrides: Partial<ExecuteServerSelectorArgs> = {}) {
  const args = { ...base, ...overrides }
  return ociLoggingSelectorAttachments[
    args.selectorKey as keyof typeof ociLoggingSelectorAttachments
  ].execute(args)
}
function respond(value: unknown, headers: Record<string, string> = {}) {
  mocks.request.mockResolvedValue({
    status: 200,
    headers,
    body: new TextEncoder().encode(JSON.stringify(value)),
  })
}

describe('OCI Logging selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({ request: mocks.request, prepareStaticEndpoint: mocks.prepare })
    mocks.prepare.mockResolvedValue({ origin: 'https://logging.us-phoenix-1.oci.oraclecloud.com' })
  })

  it('prepares a credential-bound endpoint using authoritative ID and workspace', async () => {
    respond([
      {
        id: 'group',
        compartmentId: 'compartment',
        displayName: 'Group',
        description: 'not-projected',
        freeformTags: { secret: 'not-projected' },
      },
    ])
    const recordCredentialUse = vi.fn()
    expect(await execute({ recordCredentialUse })).toEqual({
      kind: 'list',
      items: [{ id: 'group', label: 'Group' }],
    })
    expect(mocks.create).toHaveBeenCalledWith({
      credentialId: 'resolved',
      workspaceId: 'workspace',
      serviceId: 'oci-logging',
      region: 'us-phoenix-1',
    })
    expect(mocks.prepare).toHaveBeenCalledWith(OCI_LOGGING_MANAGEMENT_POLICY)
    expect(recordCredentialUse).toHaveBeenCalledWith('oci-logging')
  })

  it('rejects missing authorized credentials before provider work', async () => {
    const recordCredentialUse = vi.fn()
    await expect(execute({ credential: undefined, recordCredentialUse })).rejects.toBeInstanceOf(
      SelectorConnectionUnavailableError
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(recordCredentialUse).not.toHaveBeenCalled()
  })

  it('retains continuation for empty filtered pages and sends CUSTOM to ListLogs', async () => {
    respond([], { 'opc-next-page': 'next' })
    expect(
      await execute({
        selectorKey: 'oci_logging.customLogs',
        request: { kind: 'list', cursor: 'previous' },
      })
    ).toEqual({ kind: 'list', items: [], nextCursor: 'next' })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        encodedPath: '/20200531/logGroups/group/logs',
        queryPairs: expect.arrayContaining([
          ['logType', 'CUSTOM'],
          ['limit', '100'],
          ['page', 'previous'],
        ]),
      })
    )
  })

  it('retrieves a selected resource directly and rejects mismatched compartment scope', async () => {
    respond({ id: 'group', compartmentId: 'compartment', displayName: 'Group' })
    expect(await execute({ request: { kind: 'detail', id: 'group' } })).toEqual({
      kind: 'detail',
      item: { id: 'group', label: 'Group' },
    })
    expect(mocks.request.mock.calls[0]?.[0].encodedPath).toBe('/20200531/logGroups/group')
    respond({ id: 'group', compartmentId: 'other', displayName: 'Group' })
    await expect(execute({ request: { kind: 'detail', id: 'group' } })).rejects.toBeInstanceOf(
      SelectorOptionsUnavailableError
    )
  })

  it('rejects logs from another group and excludes service logs from custom-log details', async () => {
    const log = {
      id: 'log',
      logGroupId: 'group',
      displayName: 'Log',
      logType: 'SERVICE',
      lifecycleState: 'ACTIVE',
    }
    respond(log)
    expect(
      await execute({
        selectorKey: 'oci_logging.customLogs',
        request: { kind: 'detail', id: 'log' },
      })
    ).toEqual({ kind: 'detail', item: null })
    respond([{ ...log, logGroupId: 'other' }])
    await expect(execute({ selectorKey: 'oci_logging.logs' })).rejects.toBeInstanceOf(
      SelectorOptionsUnavailableError
    )
  })

  it('returns null for missing details and safe errors without provider diagnostics', async () => {
    mocks.request.mockRejectedValue(new OciClientError('request_failed', { status: 404 }))
    expect(await execute({ request: { kind: 'detail', id: 'missing' } })).toEqual({
      kind: 'detail',
      item: null,
    })
    mocks.request.mockRejectedValue(new Error('secret-canary'))
    await expect(execute()).rejects.toEqual(new SelectorOptionsUnavailableError())
    mocks.request.mockRejectedValue(new OciClientError('request_failed', { status: 401 }))
    await expect(execute()).rejects.toEqual(new SelectorConnectionUnavailableError(401))
  })

  it('forwards cancellation and stops before provider work when already canceled', async () => {
    const controller = new AbortController()
    respond([])
    await execute({ signal: controller.signal })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    )
    mocks.request.mockClear()
    controller.abort()
    await expect(execute({ signal: controller.signal })).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
