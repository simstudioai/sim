/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'

describe('QuickBooksBlock', () => {
  const buildParams = QuickBooksBlock.tools.config.params!
  const selectTool = QuickBooksBlock.tools.config.tool!

  it('routes every operation to its registered QuickBooks tool', () => {
    for (const operation of [
      'list_records',
      'get_record',
      'create_record',
      'update_record',
      'delete_record',
      'run_report',
      'get_preferences',
      'update_preferences',
      'get_exchange_rate',
      'update_exchange_rate',
      'download_document',
      'send_document',
      'upload_attachment',
      'get_attachment_url',
      'get_changes',
      'batch',
      'query',
      'list_vendors',
      'list_purchase_orders',
      'list_bills',
    ]) {
      expect(selectTool({ operation })).toBe(`quickbooks_${operation}`)
      expect(QuickBooksBlock.tools.access).toContain(`quickbooks_${operation}`)
    }
  })

  it('maps operation-specific entity inputs without coercing dynamic values', () => {
    expect(
      buildParams({
        operation: 'list_records',
        oauthCredential: 'credential',
        realmId: '<Company.output.realmId>',
        listEntity: 'InventoryAdjustment',
        maxResults: '<Config.output.pageSize>',
      })
    ).toMatchObject({
      credential: 'credential',
      realmId: '<Company.output.realmId>',
      entity: 'InventoryAdjustment',
      maxResults: '<Config.output.pageSize>',
    })

    expect(
      buildParams({
        operation: 'send_document',
        pdfEntity: 'PurchaseOrder',
        recordId: '42',
        sendTo: 'purchasing@example.com',
      })
    ).toMatchObject({
      entity: 'PurchaseOrder',
      recordId: '42',
      sendTo: 'purchasing@example.com',
    })
  })

  it('normalizes a single attachment file after variable resolution', () => {
    const file = {
      name: 'receipt.pdf',
      path: 'workspace/receipt.pdf',
      mimeType: 'application/pdf',
    }
    expect(
      buildParams({
        operation: 'upload_attachment',
        attachmentEntity: 'Bill',
        attachmentEntityId: '17',
        file: JSON.stringify(file),
      })
    ).toMatchObject({
      entity: 'Bill',
      entityId: '17',
      file,
    })
  })
})
