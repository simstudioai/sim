/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bundle: vi.fn(),
  list: vi.fn(),
  operation: vi.fn(),
  json: vi.fn(),
}))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.bundle,
}))
vi.mock('@/lib/internal/oracle-fusion-sales/operations', () => ({
  listOracleFusionSalesRecords: mocks.list,
  executeOracleFusionSalesOperation: mocks.operation,
}))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.json,
}))

import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionSalesSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-sales'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const PREPARED = {
  instanceUrl: ORIGIN,
  oauthCredential: 'credential-1',
  accessToken: 'private-token',
}
type SalesSelectorKey = keyof typeof oracleFusionSalesSelectorAttachments

function args(
  selectorKey: SalesSelectorKey,
  overrides: Partial<ExecuteServerSelectorArgs> = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: {},
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

function execute(key: SalesSelectorKey, overrides: Partial<ExecuteServerSelectorArgs> = {}) {
  return oracleFusionSalesSelectorAttachments[key].execute(args(key, overrides), PREPARED)
}

describe('Oracle Fusion Sales selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue({ items: [], count: 0, limit: 50, offset: 0, hasMore: false })
    mocks.operation.mockResolvedValue({
      success: true,
      output: { record: { PartyNumber: 'A001', OrganizationName: 'Example' } },
    })
    mocks.json.mockResolvedValue({ items: [], count: 0, limit: 50, offset: 0, hasMore: false })
    mocks.bundle.mockResolvedValue({ accessToken: 'private-token', instanceUrl: ORIGIN })
  })

  it('binds all 16 selectors to the Sales service and a prepared credential destination', () => {
    expect(Object.keys(oracleFusionSalesSelectorAttachments)).toHaveLength(16)
    for (const attachment of Object.values(oracleFusionSalesSelectorAttachments)) {
      expect(attachment.credential).toEqual({
        kind: 'stored',
        field: 'oauthCredential',
        serviceIds: ['oracle_fusion_sales'],
      })
      expect(attachment.integrationBlockTypes).toEqual(['oracle_fusion_sales'])
      expect(attachment.destination).toMatchObject({
        kind: 'credential-bound',
        prepare: expect.any(Function),
      })
    }
  })

  it('prepares only the credential-authoritative application origin', async () => {
    const attachment = oracleFusionSalesSelectorAttachments['oracleFusionSales.accounts']
    if (attachment.destination === 'fixed') throw new Error('Expected credential-bound selector')
    const input = args('oracleFusionSales.accounts', {
      credential: {
        suppliedId: 'credential-1',
        access: {
          resolvedCredentialId: 'credential-1',
          credentialOwnerUserId: 'owner-1',
          credentialType: 'service_account',
        } as NonNullable<ExecuteServerSelectorArgs['credential']>['access'],
      },
      context: { oauthCredential: 'credential-1' },
    })
    expect(await attachment.destination.prepare(input)).toEqual(PREPARED)
    expect(mocks.bundle).toHaveBeenCalledWith({
      credential: input.credential,
      protectedValues: input.protectedValues,
    })

    for (const instanceUrl of [undefined, 'https://attacker.example', `${ORIGIN}/crmRestApi`]) {
      mocks.bundle.mockResolvedValue({ accessToken: 'private-token', instanceUrl })
      await expect(attachment.destination.prepare(input)).rejects.toBeInstanceOf(
        SelectorConnectionUnavailableError
      )
    }
  })

  it('keeps numeric account IDs separate from public numbers and projects only option fields', async () => {
    mocks.list.mockResolvedValue({
      items: [
        {
          PartyId: '9007199254740993',
          PartyNumber: 'A001',
          OrganizationName: 'Example',
          EmailAddress: 'sales@example.com',
          HiddenCustom: 'must-not-leak',
        },
      ],
      count: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
    })
    expect(await execute('oracleFusionSales.accounts')).toEqual({
      kind: 'list',
      items: [{ id: 'A001', label: 'Example', meta: { detail: 'sales@example.com' } }],
    })
    expect(await execute('oracleFusionSales.accountIds')).toEqual({
      kind: 'list',
      items: [{ id: '9007199254740993', label: 'Example', meta: { detail: 'A001' } }],
    })
  })

  it('uses one provider page and exposes its exact next offset', async () => {
    mocks.list.mockResolvedValue({
      items: [{ LeadId: '123', LeadNumber: 'L001', Name: 'Inbound', resourceKey: 'OPAQUE' }],
      count: 1,
      offset: 50,
      limit: 50,
      hasMore: true,
      nextOffset: 51,
    })
    const signal = new AbortController().signal
    expect(
      await execute('oracleFusionSales.leads', {
        request: { kind: 'list', cursor: '50', search: "Bill's 100%_deal" },
        signal,
      })
    ).toEqual({
      kind: 'list',
      items: [{ id: 'OPAQUE', label: 'Inbound', meta: { detail: 'L001' } }],
      nextCursor: '51',
    })
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.list).toHaveBeenCalledWith(
      'lead',
      {
        ...PREPARED,
        offset: 50,
        limit: 50,
        q: "Name LIKE '%Bill''s 100\\%\\_deal%'",
      },
      signal
    )
  })

  it.each(['https://attacker.example/page', '-1', '1.5', '01', '9007199254740992'])(
    'rejects invalid cursor %s without a provider request',
    async (cursor) => {
      await expect(
        execute('oracleFusionSales.accounts', {
          request: { kind: 'list', cursor },
        })
      ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
      expect(mocks.list).not.toHaveBeenCalled()
    }
  )

  it('resolves numeric owner detail by PartyId instead of substituting a resource path', async () => {
    mocks.list.mockResolvedValue({
      items: [{ PartyId: '9007199254740993', PartyNumber: 'R001', PartyName: 'Owner' }],
      count: 1,
      offset: 0,
      limit: 2,
      hasMore: false,
    })
    expect(
      await execute('oracleFusionSales.owners', {
        request: { kind: 'detail', id: '9007199254740993' },
      })
    ).toEqual({ kind: 'detail', item: { id: '9007199254740993', label: 'Owner' } })
    expect(mocks.list).toHaveBeenCalledWith(
      'resource',
      {
        ...PREPARED,
        q: 'PartyId=9007199254740993',
        limit: 2,
        offset: 0,
      },
      undefined
    )
    expect(mocks.operation).not.toHaveBeenCalled()
  })

  it('resolves opaque lead details with their returned key', async () => {
    mocks.operation.mockResolvedValue({
      success: true,
      output: {
        record: { resourceKey: 'OPAQUE', LeadId: '123', LeadNumber: 'L001', Name: 'Inbound' },
      },
    })
    expect(
      await execute('oracleFusionSales.leads', {
        request: { kind: 'detail', id: 'OPAQUE' },
      })
    ).toEqual({
      kind: 'detail',
      item: { id: 'OPAQUE', label: 'Inbound', meta: { detail: 'L001' } },
    })
    expect(mocks.operation).toHaveBeenCalledWith(
      'get_lead',
      {
        ...PREPARED,
        leadKey: 'OPAQUE',
      },
      undefined
    )
  })

  it('resolves an opportunity ID with the primary-key finder outside the default list scope', async () => {
    mocks.list.mockResolvedValue({
      items: [{ OptyId: '123', OptyNumber: 'O001', Name: 'Closed renewal' }],
      hasMore: false,
    })
    expect(
      await execute('oracleFusionSales.opportunityIds', {
        request: { kind: 'detail', id: '123' },
      })
    ).toEqual({
      kind: 'detail',
      item: { id: '123', label: 'Closed renewal', meta: { detail: 'O001' } },
    })
    expect(mocks.list).toHaveBeenCalledWith(
      'opportunity',
      {
        ...PREPARED,
        finder: 'PrimaryKey;OptyId=123',
        limit: 2,
        offset: 0,
      },
      undefined
    )
  })

  it('uses the exact method ID as the label when Oracle returns a nullable method name', async () => {
    mocks.json.mockResolvedValue({
      items: [{ SalesMethodId: '9007199254740993', Name: null, DescriptionText: null }],
      count: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
    })
    expect(
      await execute('oracleFusionSales.salesMethods', {
        context: { businessUnitId: '123' },
      })
    ).toEqual({
      kind: 'list',
      items: [{ id: '9007199254740993', label: '9007199254740993' }],
    })
  })

  it('requires business-unit context for opportunity statuses and method context for stages', async () => {
    await expect(execute('oracleFusionSales.opportunityStatuses')).rejects.toBeInstanceOf(
      SelectorContextUnavailableError
    )
    await expect(execute('oracleFusionSales.salesStages')).rejects.toBeInstanceOf(
      SelectorContextUnavailableError
    )
    expect(mocks.json).not.toHaveBeenCalled()
  })

  it('uses Oracle opportunity-status lookup codes and a business-unit finder', async () => {
    mocks.json.mockResolvedValue({
      items: [
        {
          LookupCode: 'TENANT_OPEN',
          Meaning: 'Open - Enterprise',
          Description: 'Active',
          Hidden: 'secret',
        },
      ],
      count: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
    })
    expect(
      await execute('oracleFusionSales.opportunityStatuses', {
        context: { businessUnitId: '9007199254740993' },
      })
    ).toEqual({
      kind: 'list',
      items: [{ id: 'TENANT_OPEN', label: 'Open - Enterprise', meta: { detail: 'Active' } }],
    })
    expect(mocks.json.mock.calls[0][1]).toMatchObject({
      address: { family: 'crm', relativePath: 'optyStatusesLOV' },
      query: {
        finder:
          'StatusByBUIdFinder;BindEnabledFlag=Y,BindLookupType=OPTY_STATUS,BindBUId=9007199254740993',
      },
    })
  })

  it('preserves sales-stage identifiers and the method dependency across pages', async () => {
    mocks.json.mockResolvedValue({
      items: [{ StgId: '9007199254740993', Name: 'Discovery', DescriptionText: null }],
      count: 1,
      offset: 50,
      limit: 50,
      hasMore: true,
    })
    expect(
      await execute('oracleFusionSales.salesStages', {
        context: { salesMethodId: '9007199254740995' },
        request: { kind: 'list', cursor: '50' },
      })
    ).toEqual({
      kind: 'list',
      items: [{ id: '9007199254740993', label: 'Discovery' }],
      nextCursor: '51',
    })
    expect(mocks.json.mock.calls[0][1].query).toMatchObject({
      finder: 'SalesStageBySalesMethodFinder;BindSalesMethodId=9007199254740995',
      offset: 50,
      limit: 50,
    })
  })

  it.each([
    ['oracleFusionSales.leadStatuses', 'MKL_LEAD_STATUS'],
    ['oracleFusionSales.activityStatuses', 'ZMM_ACTIVITY_STATUS_CD'],
  ] as const)('%s uses its documented lookup family', async (key, lookupType) => {
    await execute(key)
    expect(mocks.json.mock.calls[0][1]).toMatchObject({
      address: { family: 'crm', relativePath: 'fndStaticLookups' },
      query: { finder: `LookupTypeActiveEnabledOrBindCodeFinder;BindLookupType=${lookupType}` },
    })
  })

  it('returns missing detail without mistaking access failures for missing records', async () => {
    mocks.operation.mockRejectedValue(new OracleFusionProviderError('Not found', 404))
    expect(
      await execute('oracleFusionSales.accounts', {
        request: { kind: 'detail', id: 'A001' },
      })
    ).toEqual({ kind: 'detail', item: null })
    mocks.operation.mockRejectedValue(new OracleFusionProviderError('Forbidden', 403))
    await expect(
      execute('oracleFusionSales.accounts', {
        request: { kind: 'detail', id: 'A001' },
      })
    ).rejects.toEqual(new SelectorConnectionUnavailableError(403))
  })

  it('rejects ambiguous detail and preserves cancellation', async () => {
    mocks.list.mockResolvedValue({
      items: [{ PartyId: '123' }, { PartyId: '124' }],
      hasMore: false,
    })
    await expect(
      execute('oracleFusionSales.owners', {
        request: { kind: 'detail', id: '123' },
      })
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)

    const controller = new AbortController()
    const reason = new DOMException('Cancelled', 'AbortError')
    controller.abort(reason)
    await expect(execute('oracleFusionSales.accounts', { signal: controller.signal })).rejects.toBe(
      reason
    )
  })
})
