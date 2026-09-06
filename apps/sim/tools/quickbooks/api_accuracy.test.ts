/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { quickBooksAddAttachmentBodySchema } from '@/lib/api/contracts/tools/quickbooks'
import { isSensitiveKey, redactApiKeys } from '@/lib/core/security/redaction'
import * as quickBooksTools from '@/tools/quickbooks'
import { quickbooksCreateCustomerTool } from '@/tools/quickbooks/create_customer'
import { quickbooksCreateItemTool } from '@/tools/quickbooks/create_item'
import { quickbooksCreateVendorTool } from '@/tools/quickbooks/create_vendor'
import {
  assertQuickBooksAttachmentExtension,
  getQuickBooksAttachmentTarget,
  getQuickBooksDocumentTransaction,
  validateQuickBooksAttachmentFileType,
} from '@/tools/quickbooks/documents_utils'
import { quickbooksEmailTransactionTool } from '@/tools/quickbooks/email_transaction'
import { quickbooksGetCompanyInfoTool } from '@/tools/quickbooks/get_company_info'
import { quickbooksReadAccountingTransactionsTool } from '@/tools/quickbooks/read_accounting_transactions'
import { quickbooksReadMasterDataTool } from '@/tools/quickbooks/read_master_data'
import { quickbooksReadPurchasingTransactionsTool } from '@/tools/quickbooks/read_purchasing_transactions'
import { quickbooksReadSalesTransactionsTool } from '@/tools/quickbooks/read_sales_transactions'
import type { QuickBooksAttachmentTargetType } from '@/tools/quickbooks/types'
import {
  buildQuickBooksMasterDataQueryUrl,
  buildQuickBooksQueryUrl,
  buildQuickBooksSalesQueryUrl,
} from '@/tools/quickbooks/utils'
import {
  parseQuickBooksAddress,
  quickBooksDisplayName,
  quickBooksEmailAddress,
  quickBooksItemName,
} from '@/tools/quickbooks/values'

describe('QuickBooks credential authority', () => {
  it('declares both credential-derived routing parameters on every tool', () => {
    const tools = Object.values(quickBooksTools).filter(
      (
        value
      ): value is {
        id: string
        oauth?: { authoritativeParams?: readonly string[] }
        params: Record<string, { description?: string; required?: boolean; visibility?: string }>
      } =>
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'string' &&
        value.id.startsWith('quickbooks_') &&
        'params' in value
    )

    expect(tools).toHaveLength(49)
    for (const tool of tools) {
      expect(tool.oauth?.authoritativeParams, tool.id).toContain('realmId')
      expect(tool.oauth?.authoritativeParams, tool.id).toContain('quickBooksEnvironment')
      expect(tool.params.realmId, tool.id).toMatchObject({
        required: true,
        visibility: 'hidden',
      })
      expect(tool.params.quickBooksEnvironment, tool.id).toMatchObject({
        required: true,
        visibility: 'hidden',
      })
      for (const [paramId, param] of Object.entries(tool.params)) {
        expect(typeof param.required, `${tool.id}.${paramId}`).toBe('boolean')
        expect(param.description?.trim().length, `${tool.id}.${paramId}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('QuickBooks documented document operations', () => {
  it.each([
    ['credit_memo', 'CreditMemo', 'creditmemo'],
    ['estimate', 'Estimate', 'estimate'],
    ['invoice', 'Invoice', 'invoice'],
    ['payment', 'Payment', 'payment'],
    ['purchase_order', 'PurchaseOrder', 'purchaseorder'],
    ['refund_receipt', 'RefundReceipt', 'refundreceipt'],
    ['sales_receipt', 'SalesReceipt', 'salesreceipt'],
  ] as const)('maps %s to the documented entity and resource', (type, entity, resource) => {
    expect(getQuickBooksDocumentTransaction(type)).toEqual({ entity, resource })
  })

  it('requires the documented recipient override for Payment email', () => {
    expect(() =>
      quickbooksEmailTransactionTool.request.url({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        transactionType: 'payment',
        transactionId: 'payment-1',
        confirmSend: true,
      })
    ).toThrow('recipient is required')
  })

  it('rejects a successful-status email response without the documented entity', async () => {
    await expect(
      quickbooksEmailTransactionTool.transformResponse?.(
        Response.json({ time: '2026-08-27T00:00:00Z' }),
        {
          accessToken: 'token',
          realmId: '123',
          quickBooksEnvironment: 'sandbox',
          transactionType: 'invoice',
          transactionId: 'invoice-1',
          confirmSend: true,
        }
      )
    ).rejects.toThrow('missing a valid Invoice')
  })
})

describe('QuickBooks attachment contract', () => {
  it.each([
    ['bill', 'Bill'],
    ['bill_payment', 'BillPayment'],
    ['credit_memo', 'CreditMemo'],
    ['deposit', 'Deposit'],
    ['estimate', 'Estimate'],
    ['invoice', 'Invoice'],
    ['item', 'Item'],
    ['journal_entry', 'JournalEntry'],
    ['payment', 'Payment'],
    ['purchase', 'Purchase'],
    ['purchase_order', 'PurchaseOrder'],
    ['refund_receipt', 'RefundReceipt'],
    ['sales_receipt', 'SalesReceipt'],
    ['vendor_credit', 'VendorCredit'],
  ] as const)('maps the documented %s attachment target', (type, entityType) => {
    expect(getQuickBooksAttachmentTarget(type)).toEqual({
      entityType,
      queryEntityType: entityType.toLowerCase(),
    })
  })

  it('rejects unsupported non-transaction targets', () => {
    expect(() =>
      getQuickBooksAttachmentTarget('customer' as QuickBooksAttachmentTargetType)
    ).toThrow('Unsupported QuickBooks attachment target type')
  })

  it('enforces Intuit attachment metadata limits', () => {
    const base = {
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox' as const,
      attachmentKind: 'note' as const,
      targetType: 'item' as const,
      targetId: 'item-1',
    }
    expect(
      quickBooksAddAttachmentBodySchema.safeParse({ ...base, note: 'n'.repeat(2000) }).success
    ).toBe(true)
    expect(
      quickBooksAddAttachmentBodySchema.safeParse({ ...base, note: 'n'.repeat(2001) }).success
    ).toBe(false)

    const fileBase = {
      ...base,
      attachmentKind: 'file' as const,
      file: { key: 'uploads/file.txt', name: 'file.txt', size: 4, type: 'text/plain' },
      note: undefined,
    }
    expect(
      quickBooksAddAttachmentBodySchema.safeParse({
        ...fileBase,
        fileName: `${'f'.repeat(996)}.txt`,
        contentType: 'c'.repeat(100),
        description: 'd'.repeat(2000),
      }).success
    ).toBe(true)
    expect(
      quickBooksAddAttachmentBodySchema.safeParse({
        ...fileBase,
        contentType: 'c'.repeat(101),
      }).success
    ).toBe(false)
    expect(
      quickBooksAddAttachmentBodySchema.safeParse({
        ...fileBase,
        description: 'd'.repeat(2001),
      }).success
    ).toBe(false)
  })

  it.each([
    ['design.ai', 'application/postscript', 'application/postscript'],
    [
      'contract.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    [
      'sheet.ods',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.spreadsheet',
    ],
    ['scan.tiff', 'image/tiff', 'image/tiff'],
    ['notes.txt', 'text/plain', 'text/plain'],
    ['legacy.xls', 'application/vnd.ms-excel', 'application/vnd.ms-excel'],
  ])('accepts the documented %s attachment type', (fileName, mimeType, canonical) => {
    expect(validateQuickBooksAttachmentFileType(fileName, mimeType)).toBe(canonical)
  })

  it('rejects file extensions outside the documented upload table', () => {
    expect(() => assertQuickBooksAttachmentExtension('archive.zip')).toThrow(
      'does not support the zip file type'
    )
  })
})

describe('QuickBooks sensitive output handling', () => {
  it('keeps generic sync-token redaction intact while exposing the safe version alias', () => {
    expect(isSensitiveKey('syncToken')).toBe(true)
    expect(isSensitiveKey('recordVersion')).toBe(false)
    expect(redactApiKeys({ syncToken: '7', recordVersion: '7' })).toEqual({
      syncToken: '[REDACTED]',
      recordVersion: '7',
    })
  })

  it('exposes a display-safe record version on every by-ID read family', async () => {
    const masterData = await quickbooksReadMasterDataTool.transformResponse?.(
      Response.json({ Customer: { Id: 'customer-1', SyncToken: '1' } }),
      {
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        recordType: 'customer',
        readMode: 'by_id',
        recordId: 'customer-1',
      }
    )
    const sales = await quickbooksReadSalesTransactionsTool.transformResponse?.(
      Response.json({ Invoice: { Id: 'invoice-1', SyncToken: '2' } }),
      {
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        transactionType: 'invoice',
        readMode: 'by_id',
        transactionId: 'invoice-1',
      }
    )
    const purchasing = await quickbooksReadPurchasingTransactionsTool.transformResponse?.(
      Response.json({ Bill: { Id: 'bill-1', SyncToken: '3' } }),
      {
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        transactionType: 'bill',
        readMode: 'by_id',
        transactionId: 'bill-1',
      }
    )
    const accounting = await quickbooksReadAccountingTransactionsTool.transformResponse?.(
      Response.json({ Deposit: { Id: 'deposit-1', SyncToken: '4' } }),
      {
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        transactionType: 'deposit',
        readMode: 'by_id',
        transactionId: 'deposit-1',
      }
    )

    expect(masterData?.output.recordVersion).toBe('1')
    expect(sales?.output.recordVersion).toBe('2')
    expect(purchasing?.output.recordVersion).toBe('3')
    expect(accounting?.output.recordVersion).toBe('4')
  })

  it('removes the company employer identifier from tool output', async () => {
    const result = await quickbooksGetCompanyInfoTool.transformResponse?.(
      Response.json({
        CompanyInfo: {
          Id: '123',
          CompanyName: 'Example Company',
          EmployerId: '12-3456789',
        },
      }),
      { accessToken: 'token', realmId: '123', quickBooksEnvironment: 'sandbox' }
    )

    expect(result?.output.company).toMatchObject({ Id: '123', CompanyName: 'Example Company' })
    expect(result?.output.company).not.toHaveProperty('EmployerId')
  })
})

describe('QuickBooks documented create-name alternatives', () => {
  it('creates customers and vendors from supported name components without a display name', () => {
    expect(
      quickbooksCreateCustomerTool.request.body?.({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        givenName: 'Ada',
      })
    ).toMatchObject({ GivenName: 'Ada' })
    expect(
      quickbooksCreateVendorTool.request.body?.({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        familyName: 'Lovelace',
      })
    ).toMatchObject({ FamilyName: 'Lovelace' })
  })

  it('rejects customer and vendor creates with no supported name field', () => {
    expect(() =>
      quickbooksCreateCustomerTool.request.body?.({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
      })
    ).toThrow('At least one of displayName, givenName, or familyName must be supplied')
    expect(() =>
      quickbooksCreateVendorTool.request.body?.({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
      })
    ).toThrow('At least one of displayName, givenName, or familyName must be supplied')
  })
})

describe('QuickBooks locale-dependent item accounts', () => {
  it('allows Intuit to apply the connected company locale rules', () => {
    expect(
      quickbooksCreateItemTool.request.body?.({
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        name: 'Conseil',
        itemType: 'service',
      })
    ).toEqual({ Name: 'Conseil', Type: 'Service' })
  })
})

describe('QuickBooks documented query language', () => {
  const auth = {
    accessToken: 'token',
    realmId: '123',
    quickBooksEnvironment: 'sandbox',
  } as const

  function getQueryStatement(url: URL): string {
    return url.searchParams.get('query') ?? ''
  }

  it('percent-encodes spaces rather than using the form-encoded plus', () => {
    const url = buildQuickBooksQueryUrl(auth, 'Customer', 1, 25)

    expect(url.search).not.toContain('+')
    expect(url.search).toContain(
      'query=SELECT%20*%20FROM%20Customer%20STARTPOSITION%201%20MAXRESULTS%2025'
    )
  })

  it('emits one-based STARTPOSITION and MAXRESULTS in the documented order', () => {
    expect(getQueryStatement(buildQuickBooksQueryUrl(auth, 'Invoice', 26, 25))).toBe(
      'SELECT * FROM Invoice STARTPOSITION 26 MAXRESULTS 25'
    )
  })

  it('renders a boolean Active filter unquoted', () => {
    expect(
      getQueryStatement(
        buildQuickBooksMasterDataQueryUrl({
          ...auth,
          recordType: 'vendor',
          readMode: 'list',
          activeStatus: 'inactive',
        })
      )
    ).toBe('SELECT * FROM Vendor WHERE Active = false STARTPOSITION 1 MAXRESULTS 25')
  })

  it('omits the WHERE clause when no filter is requested', () => {
    expect(
      getQueryStatement(
        buildQuickBooksMasterDataQueryUrl({ ...auth, recordType: 'item', readMode: 'list' })
      )
    ).toBe('SELECT * FROM Item STARTPOSITION 1 MAXRESULTS 25')
  })

  it('escapes backslashes before apostrophes in a filter value', () => {
    expect(
      getQueryStatement(
        buildQuickBooksSalesQueryUrl({
          ...auth,
          transactionType: 'invoice',
          readMode: 'list',
          customerId: "a\\b'c",
        })
      )
    ).toBe("SELECT * FROM Invoice WHERE CustomerRef = 'a\\\\b\\'c' STARTPOSITION 1 MAXRESULTS 25")
  })

  it('accepts the documented maximum page size of 1000', () => {
    expect(getQueryStatement(buildQuickBooksQueryUrl(auth, 'Customer', 1, 1000))).toBe(
      'SELECT * FROM Customer STARTPOSITION 1 MAXRESULTS 1000'
    )
    expect(() => buildQuickBooksQueryUrl(auth, 'Customer', 1, 1001)).toThrow(
      'maxResults must be an integer from 1 through 1000'
    )
  })
})

describe('QuickBooks documented field constraints', () => {
  it('writes back every address line QuickBooks returns', () => {
    expect(
      parseQuickBooksAddress(
        { Line1: '1', Line2: '2', Line3: '3', Line4: '4', Line5: '5' },
        'billingAddress'
      )
    ).toEqual({ Line1: '1', Line2: '2', Line3: '3', Line4: '4', Line5: '5' })
    expect(parseQuickBooksAddress({ line3: '3' }, 'billingAddress')).toEqual({ Line3: '3' })
  })

  it('rejects an item name QuickBooks documents as invalid', () => {
    expect(() => quickBooksItemName('Parent:Child')).toThrow(
      'name cannot include tabs, new lines, or colons'
    )
    expect(() => quickBooksItemName('a'.repeat(101))).toThrow('name cannot exceed 100 characters')
    expect(quickBooksItemName('Consulting')).toBe('Consulting')
  })

  it('rejects a display name past the documented 500-character maximum', () => {
    expect(() => quickBooksDisplayName('a'.repeat(501), 'displayName')).toThrow(
      'displayName cannot exceed 500 characters'
    )
    expect(quickBooksDisplayName('a'.repeat(500), 'displayName')).toHaveLength(500)
  })

  it('rejects an email address QuickBooks cannot store', () => {
    expect(() => quickBooksEmailAddress('not-an-email')).toThrow(
      'Email address must be a valid address such as name@example.com'
    )
    expect(() => quickBooksEmailAddress('a@b@c.com')).toThrow(
      'Email address must be a valid address such as name@example.com'
    )
    expect(() => quickBooksEmailAddress(`${'a'.repeat(95)}@example.com`)).toThrow(
      'Email address cannot exceed 100 characters'
    )
    expect(quickBooksEmailAddress('billing@example.com')).toEqual({
      Address: 'billing@example.com',
    })
  })
})
