/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  resolveBundle: vi.fn(),
}))

vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.request,
}))
vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mocks.resolveBundle,
}))

import { ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { ORACLE_FUSION_INVOICE_FIELDS } from '@/lib/internal/oracle-fusion-financials/schema'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { oracleFusionFinancialsSelectorAttachments } from '@/lib/selectors/server/providers/oracle-fusion-financials'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const attachment = oracleFusionFinancialsSelectorAttachments['oracleFusionFinancials.invoices']

function invoice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    InvoiceNumber: 'INV-100',
    Supplier: 'Acme',
    InvoiceAmount: 125.5,
    InvoiceCurrency: 'USD',
    InvoiceDate: '2026-09-01',
    PaidStatus: 'Unpaid',
    links: [
      {
        rel: 'self',
        href: `${ORIGIN}/fscmRestApi/resources/11.13.18.05/invoices/${encodeURIComponent(id)}`,
      },
    ],
    ...overrides,
  }
}

function args(
  request: ExecuteServerSelectorArgs['request'],
  providerId = ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID
): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oracleFusionFinancials.invoices',
    context: { oauthCredential: 'credential-1' },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: {
      suppliedId: 'credential-1',
      providerId,
      access: {
        ok: true,
        credentialOwnerUserId: 'user-1',
        resolvedCredentialId: 'credential-1',
        workspaceId: 'workspace-1',
      },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

function prepared() {
  return { oauthCredential: 'credential-1', accessToken: 'server-only-token', instanceUrl: ORIGIN }
}

describe('Oracle Fusion Financials invoice selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveBundle.mockResolvedValue({
      accessToken: 'server-only-token',
      instanceUrl: ORIGIN,
    })
  })

  it.each([
    {
      key: 'oracleFusionFinancials.glLedgers',
      path: 'ledgersLOV',
      idField: 'LedgerId',
      values: { Name: 'US Primary', CurrencyCode: 'USD' },
      label: 'US Primary — USD',
    },
    {
      key: 'oracleFusionFinancials.glJournalBatches',
      path: 'journalBatches',
      idField: 'JeBatchId',
      values: { BatchName: 'September accruals', DefaultPeriodName: 'Sep-26' },
      label: 'September accruals — Sep-26',
    },
    {
      key: 'oracleFusionFinancials.receivablesInvoices',
      path: 'receivablesInvoices',
      idField: 'CustomerTransactionId',
      values: { TransactionNumber: 'AR-42', BillToCustomerName: 'Example customer' },
      label: 'AR-42 — Example customer',
    },
    {
      key: 'oracleFusionFinancials.receivablesCreditMemos',
      path: 'receivablesCreditMemos',
      idField: 'CustomerTransactionId',
      values: { TransactionNumber: 'CM-42', BillToCustomerName: 'Example customer' },
      label: 'CM-42 — Example customer',
    },
    {
      key: 'oracleFusionFinancials.receivablesReceipts',
      path: 'standardReceipts',
      idField: 'StandardReceiptId',
      values: { ReceiptNumber: 'RCPT-42', CustomerName: 'Example customer' },
      label: 'RCPT-42 — Example customer',
    },
    {
      key: 'oracleFusionFinancials.receivablesCustomerAccounts',
      path: 'receivablesCustomerAccountActivities',
      idField: 'AccountId',
      values: { AccountNumber: 'ACCT-42', CustomerName: 'Example customer' },
      label: 'ACCT-42 — Example customer',
    },
    {
      key: 'oracleFusionFinancials.receivablesCustomerAccountSites',
      path: 'receivablesCustomerAccountSiteActivities',
      idField: 'BillToSiteUseId',
      values: { BillToSiteNumber: 'SITE-42', CustomerName: 'Example customer' },
      label: 'SITE-42 — Example customer',
    },
  ] as const)(
    'round-trips $key using exact IDs, modern links, and safe options',
    async (resource) => {
      const selected = oracleFusionFinancialsSelectorAttachments[resource.key]
      const id = '9007199254740993'
      const providerItem = {
        ...resource.values,
        [resource.idField]: id,
        '@context': {
          links: [
            {
              rel: 'self',
              href: `${ORIGIN}/fscmRestApi/resources/11.13.18.05/${resource.path}/${id}`,
            },
          ],
        },
        BankAccountNumber: 'excluded-bank-data',
        accessToken: 'excluded-secret',
      }
      mocks.request
        .mockResolvedValueOnce({
          items: [providerItem],
          count: 1,
          hasMore: true,
          limit: 50,
          offset: 50,
          totalResults: 0,
        })
        .mockResolvedValueOnce(providerItem)
      const requestArgs = { ...args({ kind: 'list', cursor: '50' }), selectorKey: resource.key }
      if (selected.destination === 'fixed') throw new Error('Expected credential-bound destination')
      const destination = await selected.destination.prepare(requestArgs)
      const listed = await selected.execute(requestArgs, destination)
      expect(listed).toEqual({
        kind: 'list',
        items: [{ id, label: resource.label }],
        nextCursor: '51',
      })
      const detail = await selected.execute(
        {
          ...args({ kind: 'detail', id }),
          selectorKey: resource.key,
        },
        destination
      )
      expect(detail).toEqual({ kind: 'detail', item: { id, label: resource.label } })
      expect(JSON.stringify({ listed, detail })).not.toMatch(/excluded|accessToken|@context/)
      expect(mocks.request).toHaveBeenCalledTimes(2)
      expect(mocks.request).toHaveBeenLastCalledWith(
        expect.objectContaining(prepared()),
        expect.objectContaining({
          address: { family: 'fscm', relativePath: `${resource.path}/${id}` },
        }),
        undefined
      )
      mocks.request.mockRejectedValueOnce(new OracleFusionProviderError('not found', 404))
      await expect(
        selected.execute(
          {
            ...args({ kind: 'detail', id }),
            selectorKey: resource.key,
          },
          destination
        )
      ).resolves.toEqual({ kind: 'detail', item: null })
    }
  )

  it('binds only the Oracle Fusion service-account family and resolves its destination', async () => {
    expect(attachment.destination).not.toBe('fixed')
    if (attachment.destination === 'fixed') throw new Error('Expected a prepared destination')

    await expect(attachment.destination.prepare(args({ kind: 'list' }))).resolves.toEqual(
      prepared()
    )
    expect(mocks.resolveBundle).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID })
    )

    await expect(
      attachment.destination.prepare(args({ kind: 'list' }, 'netsuite-service-account'))
    ).rejects.toMatchObject({ name: 'SelectorConnectionUnavailableError' })
    expect(mocks.resolveBundle).toHaveBeenCalledTimes(1)
  })

  it('omits a ledger with a documented null ID without losing the provider page position', async () => {
    const selected = oracleFusionFinancialsSelectorAttachments['oracleFusionFinancials.glLedgers']
    mocks.request.mockResolvedValueOnce({
      items: [{ LedgerId: null, Name: 'Unavailable ledger' }],
      count: 1,
      hasMore: true,
      limit: 50,
      offset: 50,
    })
    const result = await selected.execute(
      { ...args({ kind: 'list', cursor: '50' }), selectorKey: 'oracleFusionFinancials.glLedgers' },
      prepared()
    )
    expect(result).toEqual({ kind: 'list', items: [], nextCursor: '51' })
  })

  it('round-trips an opaque expense report selection without using its numeric report ID as the key', async () => {
    const selected =
      oracleFusionFinancialsSelectorAttachments['oracleFusionFinancials.expenseReports']
    const id = ' report%2Fkey '
    const providerReport = {
      ExpenseReportId: '9007199254740993',
      ExpenseReportNumber: 'EXP-42',
      Purpose: 'Business travel',
      '@context': {
        links: [
          {
            rel: 'self',
            href: `${ORIGIN}/fscmRestApi/resources/11.13.18.05/expenseReports/%20report%252Fkey%20`,
          },
        ],
      },
      accessToken: 'excluded-secret',
    }
    mocks.request
      .mockResolvedValueOnce({
        items: [providerReport],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      })
      .mockResolvedValueOnce(providerReport)
    const list = await selected.execute(
      {
        ...args({ kind: 'list' }),
        selectorKey: 'oracleFusionFinancials.expenseReports',
      },
      prepared()
    )
    expect(list).toEqual({
      kind: 'list',
      items: [{ id, label: 'EXP-42 — Business travel' }],
    })
    const detail = await selected.execute(
      {
        ...args({ kind: 'detail', id }),
        selectorKey: 'oracleFusionFinancials.expenseReports',
      },
      prepared()
    )
    expect(detail).toEqual({
      kind: 'detail',
      item: { id, label: 'EXP-42 — Business travel' },
    })
    expect(JSON.stringify({ list, detail })).not.toMatch(/excluded|accessToken|@context/)
  })

  it('loads exactly one ordered 50-invoice page and emits a safe next offset', async () => {
    mocks.request.mockResolvedValue({
      items: [invoice('OPAQUE-1')],
      count: 1,
      hasMore: true,
      limit: 50,
      offset: 100,
    })

    await expect(
      attachment.execute(args({ kind: 'list', cursor: '100' }), prepared())
    ).resolves.toEqual({
      kind: 'list',
      items: [
        {
          id: 'OPAQUE-1',
          label: 'INV-100 — Acme',
          meta: {
            amount: 125.5,
            currency: 'USD',
            date: '2026-09-01',
            status: 'Unpaid',
          },
        },
      ],
      nextCursor: '101',
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining(prepared()),
      {
        address: { family: 'fscm', relativePath: 'invoices' },
        query: expect.objectContaining({
          fields: ORACLE_FUSION_INVOICE_FIELDS.join(','),
          links: 'self',
          orderBy: 'InvoiceDate:desc',
          limit: 50,
          offset: 100,
        }),
      },
      undefined
    )
  })

  it('hydrates one invoice by its opaque key with the same fixed projection', async () => {
    mocks.request.mockResolvedValue(invoice('opaque key'))

    const result = await attachment.execute(args({ kind: 'detail', id: 'opaque key' }), prepared())
    expect(result).toMatchObject({
      kind: 'detail',
      item: { id: 'opaque key', label: 'INV-100 — Acme' },
    })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining(prepared()),
      {
        address: { family: 'fscm', relativePath: 'invoices/opaque%20key' },
        query: { fields: ORACLE_FUSION_INVOICE_FIELDS.join(','), links: 'self' },
      },
      undefined
    )
  })

  it.each(['.', '..'])(
    'rejects URL-normalizing invoice detail key %j before outbound I/O',
    async (id) => {
      await expect(
        attachment.execute(args({ kind: 'detail', id }), prepared())
      ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it('rejects search, malformed cursors, incoherent pages, and cross-origin links', async () => {
    await expect(
      attachment.execute(args({ kind: 'list', search: 'Acme' }), prepared())
    ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    await expect(
      attachment.execute(args({ kind: 'list', cursor: '-1' }), prepared())
    ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })

    mocks.request
      .mockResolvedValueOnce({ items: [], count: 0, hasMore: true, limit: 50, offset: 0 })
      .mockResolvedValueOnce({
        items: [
          invoice('OPAQUE-1', {
            links: [
              {
                rel: 'self',
                href: 'https://attacker.example/fscmRestApi/resources/11.13.18.05/invoices/X',
              },
            ],
          }),
        ],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      })
    await expect(attachment.execute(args({ kind: 'list' }), prepared())).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
    })
    await expect(attachment.execute(args({ kind: 'list' }), prepared())).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
    })
  })

  it('maps provider failures without exposing Oracle response details', async () => {
    mocks.request.mockRejectedValue(new OracleFusionProviderError('provider-secret-canary', 401))
    const authenticationError = await attachment
      .execute(args({ kind: 'list' }), prepared())
      .catch((error) => error)
    expect(authenticationError).toMatchObject({
      name: 'SelectorConnectionUnavailableError',
      message: 'Connection unavailable',
      status: 401,
    })
    expect((authenticationError as Error).message).not.toContain('provider-secret-canary')

    mocks.request.mockRejectedValue(new OracleFusionProviderError('provider-secret-canary', 404))
    await expect(
      attachment.execute(args({ kind: 'detail', id: 'OPAQUE-1' }), prepared())
    ).resolves.toEqual({ kind: 'detail', item: null })
  })
  it('round-trips a v9 invoice selection through the real Financials and foundation helpers', async () => {
    const id = ' invoice%2Fkey '
    const { links, ...values } = invoice(id)
    const providerInvoice = {
      ...values,
      InvoiceId: '9007199254740993',
      '@context': { key: 'do-not-trust-this-key', links, private: 'context-secret' },
      accessToken: 'provider-secret',
      attachments: [{ body: 'unprojected' }],
    }
    mocks.request
      .mockResolvedValueOnce({
        items: [providerInvoice],
        count: 1,
        hasMore: false,
        limit: 50,
        offset: 0,
      })
      .mockResolvedValueOnce(providerInvoice)

    const list = await attachment.execute(args({ kind: 'list' }), prepared())
    if (list.kind !== 'list') throw new Error('Expected invoice options')
    const selectedId = list.items[0]?.id
    expect(selectedId).toBe(id)
    const detail = await attachment.execute(args({ kind: 'detail', id: selectedId! }), prepared())
    expect(detail).toEqual({ kind: 'detail', item: list.items[0] })
    expect(mocks.request).toHaveBeenLastCalledWith(
      expect.objectContaining(prepared()),
      {
        address: { family: 'fscm', relativePath: 'invoices/%20invoice%252Fkey%20' },
        query: { fields: ORACLE_FUSION_INVOICE_FIELDS.join(','), links: 'self' },
      },
      undefined
    )
    expect(JSON.stringify({ list, detail })).not.toMatch(/secret|accessToken|attachments|@context/)
  })

  it('uses the credential destination even when unrelated context supplies another URL', async () => {
    const requestArgs = args({ kind: 'list' })
    Object.assign(requestArgs.context, { instanceUrl: 'https://attacker.example' })
    if (attachment.destination === 'fixed') throw new Error('Expected credential destination')
    const destination = await attachment.destination.prepare(requestArgs)
    mocks.request.mockResolvedValue({
      items: [],
      count: 0,
      hasMore: false,
      limit: 50,
      offset: 0,
    })
    await attachment.execute(requestArgs, destination)
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ instanceUrl: ORIGIN }),
      expect.any(Object),
      undefined
    )
  })

  it('preserves cancellation instead of converting it into a selector failure', async () => {
    const controller = new AbortController()
    const requestArgs = { ...args({ kind: 'list' }), signal: controller.signal }
    const reason = new Error('cancelled')
    mocks.request.mockImplementationOnce(() => {
      controller.abort(reason)
      throw reason
    })
    await expect(attachment.execute(requestArgs, prepared())).rejects.toBe(reason)
  })
})
