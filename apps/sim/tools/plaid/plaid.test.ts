/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { plaidOptionsBodySchema } from '@/lib/api/contracts/selectors/plaid'
import {
  PLAID_SYNC_CURSOR_MAX_LENGTH,
  PLAID_TOOL_REQUEST_MAX_BYTES,
  plaidOperationBodySchema,
} from '@/lib/api/contracts/tools/plaid'
import { PlaidBlock, PlaidBlockMeta } from '@/blocks/blocks/plaid'
import { filterOutputForLog } from '@/executor/utils/output-filter'
import { Serializer } from '@/serializer/index'
import { plaidGetAccountsTool } from '@/tools/plaid/get_accounts'
import { plaidGetAuthTool } from '@/tools/plaid/get_auth'
import { plaidGetBalancesTool } from '@/tools/plaid/get_balances'
import { plaidGetIdentityTool } from '@/tools/plaid/get_identity'
import { plaidGetInstitutionTool } from '@/tools/plaid/get_institution'
import { plaidGetItemTool } from '@/tools/plaid/get_item'
import { plaidSearchInstitutionsTool } from '@/tools/plaid/search_institutions'
import { plaidSyncTransactionsTool } from '@/tools/plaid/sync_transactions'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig, ToolResponse } from '@/tools/types'

vi.unmock('@/blocks/registry')

const buildParams = PlaidBlock.tools?.config?.params
if (!buildParams) throw new Error('PlaidBlock params transform missing')

const creds = { oauthCredential: 'cred_plaid_item_1' }
const runtimeCreds = { plaidCredentialId: 'cred_plaid_item_1' }

async function transform(tool: ToolConfig<any, any>, body: unknown): Promise<ToolResponse> {
  if (!tool.transformResponse) throw new Error(`${tool.id} transform missing`)
  const payload =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? { request_id: 'request-1', ...body }
      : body
  return tool.transformResponse(
    new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
  )
}

const account = {
  account_id: 'acc_1',
  name: 'Checking',
  official_name: null,
  mask: '0000',
  type: 'depository',
  subtype: 'checking',
  balances: {
    available: 100,
    current: 100,
    limit: null,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
  },
}

const institution = {
  institution_id: 'ins_1',
  name: 'Bank',
  products: ['auth'],
  country_codes: ['US'],
  routing_numbers: [],
  oauth: false,
}

const retainedTools = [
  plaidSyncTransactionsTool,
  plaidGetAccountsTool,
  plaidGetBalancesTool,
  plaidGetIdentityTool,
  plaidGetAuthTool,
  plaidGetItemTool,
  plaidSearchInstitutionsTool,
  plaidGetInstitutionTool,
]

describe('PlaidBlock tools.config.params', () => {
  it('routes every operation to its snake_case tool id', () => {
    const toolSelector = PlaidBlock.tools?.config?.tool
    expect(toolSelector?.({ operation: 'sync_transactions' })).toBe('plaid_sync_transactions')
    expect(toolSelector?.({ operation: 'get_institution' })).toBe('plaid_get_institution')
  })

  it('registers exactly the retained operation set across dropdown and access', () => {
    const operation = PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const ids = operation?.options?.map((option) => option.id)
    const expected = [
      'sync_transactions',
      'get_accounts',
      'get_balances',
      'get_identity',
      'get_auth',
      'get_item',
      'search_institutions',
      'get_institution',
    ]

    expect(ids).toEqual(expected)
    expect(PlaidBlock.tools?.access).toEqual(expected.map((id) => `plaid_${id}`))
    expect(new Set(PlaidBlock.subBlocks.map((subBlock) => subBlock.id)).size).toBe(
      PlaidBlock.subBlocks.length
    )
  })

  it('uses native selectors with canonical advanced manual fallbacks', () => {
    expect(PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'credential')).toMatchObject({
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
    })
    expect(
      PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'manualCredential')
    ).toMatchObject({
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
    })
    expect(
      PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'accountIdsSelector')
    ).toMatchObject({
      selectorKey: 'plaid.accounts',
      canonicalParamId: 'accountIds',
      multiSelect: true,
      dependsOn: ['credential'],
      condition: { field: 'operation', value: ['get_accounts', 'get_balances', 'get_identity'] },
    })
    expect(
      PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'manualAccountIds')
    ).toMatchObject({ canonicalParamId: 'accountIds', mode: 'advanced' })
    expect(
      PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'authAccountIdsSelector')
    ).toMatchObject({
      selectorKey: 'plaid.accounts.auth',
      canonicalParamId: 'authAccountIds',
      multiSelect: true,
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'get_auth' },
    })
    expect(
      PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'manualAuthAccountIds')
    ).toMatchObject({
      canonicalParamId: 'authAccountIds',
      mode: 'advanced',
    })
    expect(
      PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'accountIdSelector')
    ).toMatchObject({
      selectorKey: 'plaid.accounts.transactions',
      dependsOn: ['credential'],
      condition: { field: 'operation', value: 'sync_transactions' },
    })
    expect(
      PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'institutionSelector')
    ).toMatchObject({
      selectorKey: 'plaid.institutions',
      canonicalParamId: 'institutionId',
      dependsOn: ['credential'],
    })
    expect(
      PlaidBlock.subBlocks.find((subBlock) => subBlock.id === 'manualInstitutionId')
    ).toMatchObject({ canonicalParamId: 'institutionId', mode: 'advanced' })
    expect(PlaidBlock.inputs).toHaveProperty('oauthCredential')
    expect(PlaidBlock.inputs).toHaveProperty('authAccountIds')
    expect(PlaidBlock.inputs).not.toHaveProperty('plaidCredentialId')
  })

  it('binds every retained tool only to an opaque reusable credential ID', () => {
    for (const tool of retainedTools) {
      expect(tool.params.plaidCredentialId).toMatchObject({
        required: true,
        visibility: 'user-only',
      })
      expect(tool.params).not.toHaveProperty('oauthCredential')
      expect(tool.params).not.toHaveProperty('credentialId')
      expect(tool.params).not.toHaveProperty('accessToken')
      expect(tool.params).not.toHaveProperty('clientId')
      expect(tool.params).not.toHaveProperty('secret')
      expect(tool.params).not.toHaveProperty('environment')
      expect(tool.request.internalAuth).toBe('executor_delegation')
    }
  })

  it('serializes a selected canvas credential before the adapter derives plaidCredentialId', () => {
    const serializer = new Serializer()
    const workflow = serializer.serializeWorkflow(
      {
        plaid: {
          id: 'plaid',
          type: 'plaid',
          name: 'Plaid Get Balances',
          position: { x: 0, y: 0 },
          subBlocks: {
            operation: { value: 'get_balances' },
            credential: { value: 'cred_plaid_item_1' },
            manualCredential: { value: '' },
            accountIdsSelector: { value: [] },
            manualAccountIds: { value: '' },
          },
          outputs: {},
          enabled: true,
        } as any,
      },
      [],
      {},
      undefined,
      true
    )

    expect(workflow.blocks[0].config.params).toMatchObject({
      operation: 'get_balances',
      oauthCredential: 'cred_plaid_item_1',
    })
    expect(buildParams(workflow.blocks[0].config.params)).toMatchObject({
      plaidCredentialId: 'cred_plaid_item_1',
    })
  })

  it('does not promote unsupported first-time Agent connection flows', () => {
    expect(PlaidBlockMeta).not.toHaveProperty('skills')
    expect(PlaidBlockMeta.templates.every((template) => !template.modules.includes('agent'))).toBe(
      true
    )
  })

  it('forwards only the reusable credential for Item authentication', () => {
    expect(buildParams({ ...creds, operation: 'get_item' })).toEqual({
      oauthCredential: undefined,
      plaidCredentialId: 'cred_plaid_item_1',
    })
  })

  it('maps the Auth-only account field to the public tool accountIds parameter', () => {
    expect(
      buildParams({
        ...creds,
        operation: 'get_auth',
        authAccountIds: ['acc_1', 'acc_2'],
      })
    ).toEqual({
      oauthCredential: undefined,
      plaidCredentialId: 'cred_plaid_item_1',
      accountIds: ['acc_1', 'acc_2'],
    })
  })

  it('forwards sync fields including the account scope, dropping empty optionals', () => {
    const result = buildParams({
      ...creds,
      operation: 'sync_transactions',
      cursor: '',
      accountId: 'acc_1',
      count: '250',
      daysRequested: '',
      includeOriginalDescription: 'true',
    })
    expect(result.plaidCredentialId).toBe('cred_plaid_item_1')
    expect(result.accountId).toBe('acc_1')
    expect(result.count).toBe(250)
    expect(result.includeOriginalDescription).toBe(true)
    expect(result).not.toHaveProperty('cursor')
    expect(result).not.toHaveProperty('daysRequested')
  })

  it('throws a labeled error on non-numeric page size instead of forwarding NaN', () => {
    expect(() =>
      buildParams({
        ...creds,
        operation: 'sync_transactions',
        count: 'lots',
      })
    ).toThrow('Page Size must be a valid number')
  })

  it('enforces the documented sync bounds in the block path', () => {
    expect(() => buildParams({ ...creds, operation: 'sync_transactions', count: '0' })).toThrow(
      'Page Size must be at least 1'
    )
    expect(() =>
      buildParams({
        ...creds,
        operation: 'sync_transactions',
        daysRequested: '731',
      })
    ).toThrow('Days Requested must be at most 730')
  })

  it('preserves false and drops blank optionals through the merged block request path', () => {
    const rawInputs = {
      ...creds,
      operation: 'sync_transactions',
      cursor: '   ',
      count: '',
      includeOriginalDescription: 'false',
      daysRequested: null,
    }
    const mergedInputs = { ...rawInputs, ...buildParams(rawInputs) }
    expect(mergedInputs.oauthCredential).toBeUndefined()

    const request = prepareToolRequest(plaidSyncTransactionsTool, mergedInputs)

    expect(request.url).toBe('/api/tools/plaid')
    expect(JSON.parse(request.body ?? '')).toEqual({
      operation: 'plaid_sync_transactions',
      credentialId: 'cred_plaid_item_1',
      input: { include_original_description: false },
    })
  })
})

describe('Plaid sensitive output display', () => {
  it('removes bank account and routing numbers from execution logs', () => {
    expect(
      filterOutputForLog('plaid', {
        accounts: [{ account_id: 'acc_1', mask: '0000' }],
        numbers: { ach: [{ account: '123456789', routing: '021000021' }] },
      })
    ).toEqual({ accounts: [{ account_id: 'acc_1', mask: '0000' }] })
  })
})

describe('plaid_sync_transactions request body', () => {
  const body = plaidSyncTransactionsTool.request.body
  if (!body) throw new Error('sync tool body builder missing')

  it('drops null and empty optionals arriving from LLM tool calls', () => {
    const request = prepareToolRequest(plaidSyncTransactionsTool, {
      ...runtimeCreds,
      cursor: undefined,
      count: null as unknown as number,
      includeOriginalDescription: null as unknown as boolean,
      daysRequested: undefined,
    })
    expect(JSON.parse(request.body ?? '')).toEqual({
      operation: 'plaid_sync_transactions',
      credentialId: 'cred_plaid_item_1',
      input: {},
    })
  })

  it('coerces string-typed count and boolean, nesting options only when needed', () => {
    const request = prepareToolRequest(plaidSyncTransactionsTool, {
      ...runtimeCreds,
      count: '100' as unknown as number,
      includeOriginalDescription: 'true' as unknown as boolean,
    })
    expect(JSON.parse(request.body ?? '')).toEqual({
      operation: 'plaid_sync_transactions',
      credentialId: 'cred_plaid_item_1',
      input: { count: 100, include_original_description: true },
    })
  })

  it('throws on garbage numeric input instead of sending it to Plaid', () => {
    expect(() =>
      body({
        ...runtimeCreds,
        count: 'abc' as unknown as number,
      })
    ).toThrow('count must be a valid number')
  })

  it('rejects invalid count, boolean, and cursor values at provider bounds', () => {
    expect(() => body({ ...runtimeCreds, count: 0 })).toThrow('count must be at least 1')
    expect(
      body({ ...runtimeCreds, cursor: 'x'.repeat(PLAID_SYNC_CURSOR_MAX_LENGTH) }).input.cursor
    ).toHaveLength(PLAID_SYNC_CURSOR_MAX_LENGTH)
    expect(() =>
      body({ ...runtimeCreds, cursor: 'x'.repeat(PLAID_SYNC_CURSOR_MAX_LENGTH + 1) })
    ).toThrow(`cursor must be at most ${PLAID_SYNC_CURSOR_MAX_LENGTH} characters`)
    expect(() =>
      body({
        ...runtimeCreds,
        includeOriginalDescription: 'no' as unknown as boolean,
      })
    ).toThrow('includeOriginalDescription must be true or false')
  })

  it("preserves Plaid's special now cursor through the prepared request", () => {
    const request = prepareToolRequest(plaidSyncTransactionsTool, {
      ...runtimeCreds,
      cursor: 'now',
    })

    expect(JSON.parse(request.body ?? '').input.cursor).toBe('now')
  })
})

describe('plaid_search_institutions request body', () => {
  it('omits a blank product filter from the prepared request', () => {
    const request = prepareToolRequest(plaidSearchInstitutionsTool, {
      ...runtimeCreds,
      query: 'Bank',
      products: '   ',
    })

    expect(JSON.parse(request.body ?? '')).toEqual({
      operation: 'plaid_search_institutions',
      credentialId: 'cred_plaid_item_1',
      input: { query: 'Bank', country_codes: ['US'] },
    })
  })
})

describe('Plaid route request contracts', () => {
  it('enforces cursor and product bounds while deduplicating country codes', () => {
    expect(
      plaidOperationBodySchema.safeParse({
        operation: 'plaid_sync_transactions',
        credentialId: 'credential-1',
        input: { cursor: 'x'.repeat(PLAID_SYNC_CURSOR_MAX_LENGTH) },
      }).success
    ).toBe(true)
    expect(
      plaidOperationBodySchema.safeParse({
        operation: 'plaid_sync_transactions',
        credentialId: 'credential-1',
        input: { cursor: 'x'.repeat(PLAID_SYNC_CURSOR_MAX_LENGTH + 1) },
      }).success
    ).toBe(false)
    expect(
      plaidOperationBodySchema.safeParse({
        operation: 'plaid_search_institutions',
        credentialId: 'credential-1',
        input: { query: 'Bank', country_codes: ['US'], products: [] },
      }).success
    ).toBe(false)

    const parsed = plaidOperationBodySchema.parse({
      operation: 'plaid_search_institutions',
      credentialId: 'credential-1',
      input: {
        query: 'Bank',
        country_codes: Array(100).fill('US'),
      },
    })
    if (parsed.operation !== 'plaid_search_institutions') {
      throw new Error('Expected institution search request')
    }
    expect(parsed.input.country_codes).toEqual(['US'])

    const selectorParsed = plaidOptionsBodySchema.parse({
      kind: 'institution_search',
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
      query: 'Bank',
      country_codes: Array(100).fill('GB'),
    })
    if (selectorParsed.kind !== 'institution_search') {
      throw new Error('Expected institution selector request')
    }
    expect(selectorParsed.country_codes).toEqual(['GB'])
  })
})

describe('Plaid account selector normalization', () => {
  const body = plaidGetAccountsTool.request.body
  if (!body) throw new Error('accounts tool body builder missing')

  it.each([
    [
      ['acc-1', 'acc-2'],
      ['acc-1', 'acc-2'],
    ],
    ['acc-1, acc-2', ['acc-1', 'acc-2']],
  ])('normalizes selector arrays and manual comma-separated values', (accountIds, expected) => {
    expect(body({ ...runtimeCreds, accountIds }).input).toEqual({ account_ids: expected })
  })

  it('rejects a normalized list when the complete internal request exceeds the route ceiling', () => {
    expect(() =>
      prepareToolRequest(plaidGetAccountsTool, {
        ...runtimeCreds,
        accountIds: ['x'.repeat(PLAID_TOOL_REQUEST_MAX_BYTES - 4)],
      })
    ).toThrow(
      `Plaid tool request exceeds the ${PLAID_TOOL_REQUEST_MAX_BYTES}-byte Sim request limit`
    )
  })
})

describe('Plaid endpoint success contracts', () => {
  const item = {
    item_id: 'item_1',
    webhook: null,
    error: null,
    available_products: [],
    billed_products: ['transactions'],
    consent_expiration_time: null,
    update_type: 'background',
  }
  const validResponses = [
    [
      'transaction sync',
      plaidSyncTransactionsTool,
      {
        added: [],
        modified: [],
        removed: [],
        next_cursor: '',
        has_more: false,
        transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
      },
    ],
    ['accounts', plaidGetAccountsTool, { accounts: [account] }],
    ['balances', plaidGetBalancesTool, { accounts: [account] }],
    ['identity', plaidGetIdentityTool, { accounts: [{ ...account, owners: [] }] }],
    [
      'auth',
      plaidGetAuthTool,
      {
        accounts: [account],
        numbers: { ach: [], eft: [], international: [], bacs: [] },
      },
    ],
    ['item', plaidGetItemTool, { item }],
    ['institution search', plaidSearchInstitutionsTool, { institutions: [institution] }],
    ['institution', plaidGetInstitutionTool, { institution }],
  ] as const

  it.each(validResponses)('maps the %s request ID to requestId', async (_label, tool, response) => {
    await expect(transform(tool, response)).resolves.toMatchObject({
      output: { requestId: 'request-1' },
    })
  })

  it.each(validResponses)('requires the %s request ID', async (label, tool, response) => {
    await expect(transform(tool, { ...response, request_id: undefined })).rejects.toThrow(
      `${label}.request_id must be a string`
    )
  })

  it('rejects missing sync pagination state instead of reporting a complete empty page', async () => {
    await expect(
      transform(plaidSyncTransactionsTool, {
        added: [],
        modified: [],
        removed: [],
        next_cursor: 'cursor_1',
        transactions_update_status: 'FUTURE_ADDITIVE_STATUS',
      })
    ).rejects.toThrow('transaction sync.has_more must be a boolean')
  })

  it('accepts empty sync arrays and unknown future status strings when required fields exist', async () => {
    await expect(
      transform(plaidSyncTransactionsTool, {
        added: [],
        modified: [],
        removed: [],
        next_cursor: '',
        has_more: false,
        transactions_update_status: 'FUTURE_ADDITIVE_STATUS',
        future_field: true,
      })
    ).resolves.toMatchObject({
      success: true,
      output: { added: [], nextCursor: '', hasMore: false, updateStatus: 'FUTURE_ADDITIVE_STATUS' },
    })
  })

  it.each([
    ['accounts', plaidGetAccountsTool, 'accounts.accounts must be an array'],
    ['balances', plaidGetBalancesTool, 'balances.accounts must be an array'],
    ['identity', plaidGetIdentityTool, 'identity.accounts must be an array'],
    ['auth', plaidGetAuthTool, 'auth.accounts must be an array'],
    [
      'institution search',
      plaidSearchInstitutionsTool,
      'institution search.institutions must be an array',
    ],
  ])('rejects a malformed %s top-level list', async (_label, tool, message) => {
    await expect(transform(tool, {})).rejects.toThrow(message)
  })

  it('validates every retained account and identity owner', async () => {
    await expect(transform(plaidGetAccountsTool, { accounts: [account] })).resolves.toMatchObject({
      output: { count: 1 },
    })
    await expect(
      transform(plaidGetIdentityTool, { accounts: [{ ...account, owners: [] }] })
    ).resolves.toMatchObject({ output: { count: 1 } })
    await expect(transform(plaidGetIdentityTool, { accounts: [account] })).rejects.toThrow(
      'identity.accounts[0].owners must be an array'
    )
  })

  it.each([
    ['accounts', plaidGetAccountsTool, { accounts: Array(501).fill(account) }],
    ['balances', plaidGetBalancesTool, { accounts: Array(501).fill(account) }],
    ['identity', plaidGetIdentityTool, { accounts: Array(501).fill({ ...account, owners: [] }) }],
    [
      'auth',
      plaidGetAuthTool,
      {
        accounts: Array(501).fill(account),
        numbers: { ach: [], eft: [], international: [], bacs: [] },
      },
    ],
  ])(
    'accepts %s responses beyond the removed arbitrary item cap',
    async (_label, tool, response) => {
      const result = await transform(tool, response)
      expect(result.output.accounts).toHaveLength(501)
    }
  )

  it('retains Plaid institution search bounds without capping transaction updates', async () => {
    await expect(
      transform(plaidSearchInstitutionsTool, { institutions: Array(11).fill(institution) })
    ).rejects.toThrow('institution search.institutions must contain at most 10 items')

    const syncResult = await transform(plaidSyncTransactionsTool, {
      added: [],
      modified: [],
      removed: Array.from({ length: 501 }, (_, index) => ({
        transaction_id: `txn_${index}`,
        account_id: 'acc_1',
      })),
      next_cursor: '',
      has_more: false,
      transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
    })
    expect(syncResult.output.removed).toHaveLength(501)
  })

  it('requires every Auth number scheme even when each is legitimately empty', async () => {
    await expect(
      transform(plaidGetAuthTool, {
        accounts: [account],
        numbers: { ach: [], eft: [], international: [], bacs: [] },
      })
    ).resolves.toMatchObject({ output: { numbers: { ach: [], bacs: [] } } })
    await expect(
      transform(plaidGetAuthTool, {
        accounts: [],
        numbers: { ach: [], eft: [], international: [] },
      })
    ).rejects.toThrow('auth.numbers.bacs must be an array')
  })

  it('preserves optional Item omission and rejects missing required Item state', async () => {
    const result = await transform(plaidGetItemTool, { item })
    expect(result.output.item).toEqual(item)
    expect(result.output).not.toHaveProperty('status')
    await expect(
      transform(plaidGetItemTool, { item: { ...item, error: undefined } })
    ).rejects.toThrow('item.error must be an object')
  })

  it('validates institution response objects without rejecting additive fields', async () => {
    await expect(
      transform(plaidGetInstitutionTool, { institution: { ...institution, new_field: true } })
    ).resolves.toMatchObject({ output: { institution } })
    await expect(transform(plaidGetInstitutionTool, { institution: {} })).rejects.toThrow(
      'institution.institution_id must be a string'
    )
  })
})

describe('Plaid output metadata', () => {
  it('declares requestId on every retained tool output', () => {
    for (const tool of retainedTools) {
      expect(tool.outputs?.requestId).toEqual({
        type: 'string',
        description: 'Unique Plaid request ID for troubleshooting and support',
      })
    }
  })

  it('marks Item required, optional, and nullable fields exactly', () => {
    const item = plaidGetItemTool.outputs?.item
    const status = plaidGetItemTool.outputs?.status

    expect(item).toMatchObject({
      type: 'object',
      properties: {
        institution_id: { type: 'string', optional: true, nullable: true },
        webhook: { type: 'string', nullable: true },
        error: {
          type: 'object',
          nullable: true,
          properties: {
            error_type: { type: 'string' },
            display_message: { type: 'string', nullable: true },
          },
        },
        available_products: { type: 'array', items: { type: 'string' } },
        billed_products: { type: 'array', items: { type: 'string' } },
        products: { type: 'array', optional: true, items: { type: 'string' } },
        consent_expiration_time: { type: 'string', nullable: true },
      },
    })
    expect(item?.properties?.webhook.optional).toBeUndefined()
    expect(item?.properties?.error.optional).toBeUndefined()
    expect(item?.properties?.consent_expiration_time.optional).toBeUndefined()

    expect(status).toMatchObject({
      type: 'object',
      optional: true,
      nullable: true,
      properties: {
        transactions: {
          type: 'object',
          optional: true,
          nullable: true,
          properties: {
            last_successful_update: { type: 'string', optional: true, nullable: true },
            last_failed_update: { type: 'string', optional: true, nullable: true },
          },
        },
        last_webhook: {
          type: 'object',
          optional: true,
          nullable: true,
          properties: {
            sent_at: { type: 'string', optional: true, nullable: true },
            code_sent: { type: 'string', optional: true },
          },
        },
      },
    })
  })

  it('describes institution, identity, and Auth lists as typed arrays', () => {
    const institution = plaidGetInstitutionTool.outputs?.institution
    const searchInstitution = plaidSearchInstitutionsTool.outputs?.institutions.items
    const owners = plaidGetIdentityTool.outputs?.accounts.items?.properties?.owners
    const numbers = plaidGetAuthTool.outputs?.numbers

    for (const property of ['products', 'country_codes', 'routing_numbers']) {
      expect(institution?.properties?.[property]).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      })
      expect(searchInstitution?.properties?.[property]).toMatchObject({
        type: 'array',
        items: { type: 'string' },
      })
    }

    expect(owners).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          names: { type: 'array', items: { type: 'string' } },
          phone_numbers: { type: 'array', items: { type: 'object' } },
          emails: { type: 'array', items: { type: 'object' } },
          addresses: { type: 'array', items: { type: 'object' } },
        },
      },
    })

    for (const scheme of ['ach', 'eft', 'international', 'bacs']) {
      expect(numbers?.properties?.[scheme]).toMatchObject({
        type: 'array',
        items: { type: 'object', properties: expect.any(Object) },
      })
    }
    expect(numbers?.properties?.ach.items?.properties?.wire_routing).toMatchObject({
      type: 'string',
      nullable: true,
    })
    expect(numbers?.properties?.ach.items?.properties?.is_tokenized_account_number).toMatchObject({
      type: 'boolean',
      optional: true,
    })
  })

  it('exposes transaction nested objects and lists without generic JSON placeholders', () => {
    const transaction = plaidSyncTransactionsTool.outputs?.added.items
    const properties = transaction?.properties

    expect(transaction).toMatchObject({ type: 'object' })
    expect(properties?.authorized_date).toMatchObject({ type: 'string', nullable: true })
    expect(properties?.authorized_date.optional).toBeUndefined()
    expect(properties?.personal_finance_category).toMatchObject({
      type: 'object',
      optional: true,
      nullable: true,
      properties: {
        primary: { type: 'string' },
        detailed: { type: 'string' },
      },
    })
    expect(properties?.location).toMatchObject({
      type: 'object',
      properties: {
        country: { type: 'string', nullable: true },
        lat: { type: 'number', nullable: true },
        lon: { type: 'number', nullable: true },
      },
    })
    expect(properties?.counterparties).toMatchObject({
      type: 'array',
      optional: true,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          website: { type: 'string', nullable: true },
          entity_id: { type: 'string', optional: true, nullable: true },
        },
      },
    })
    expect(plaidSyncTransactionsTool.outputs?.modified.items).toEqual(transaction)
    expect(plaidSyncTransactionsTool.outputs?.removed).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          transaction_id: { type: 'string' },
          account_id: { type: 'string' },
        },
      },
    })
  })
})
