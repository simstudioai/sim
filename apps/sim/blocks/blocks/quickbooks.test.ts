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

    const attachmentInputs = QuickBooksBlock.subBlocks.filter(
      (subBlock) => subBlock.canonicalParamId === 'file'
    )
    expect(attachmentInputs).toMatchObject([
      { id: 'attachmentFile', mode: 'basic', required: expect.anything() },
      { id: 'attachmentFileRef', mode: 'advanced', required: expect.anything() },
    ])
  })

  it('requires full entity payloads for non-simplified deletes', () => {
    const payload = QuickBooksBlock.subBlocks.find((subBlock) => subBlock.id === 'payload')
    if (!payload || typeof payload.required !== 'function') {
      throw new Error('Expected QuickBooks payload to use conditional required state')
    }

    expect(
      payload.required({
        operation: 'delete_record',
        deleteEntity: 'InventoryAdjustment',
      })
    ).toEqual({
      field: 'deleteEntity',
      value: [
        'Attachable',
        'CreditCardPayment',
        'Deposit',
        'InventoryAdjustment',
        'RecurringTransaction',
        'Transfer',
      ],
    })
    expect(
      payload.required({
        operation: 'create_record',
        createEntity: 'Vendor',
      })
    ).toEqual({
      field: 'operation',
      value: ['create_record', 'update_record', 'update_exchange_rate', 'update_preferences'],
    })
  })

  it('exposes only documented operations for newer and locale-specific entities', () => {
    const optionsFor = (id: string) => {
      const subBlock = QuickBooksBlock.subBlocks.find((candidate) => candidate.id === id)
      if (!subBlock || !('options' in subBlock) || !Array.isArray(subBlock.options)) {
        throw new Error(`Expected ${id} entity options`)
      }
      return subBlock.options.map((option) => option.id)
    }

    expect(optionsFor('listEntity')).toEqual(
      expect.arrayContaining([
        'CreditCardPayment',
        'TaxPayment',
        'RecurringTransaction',
        'JournalCode',
      ])
    )
    expect(optionsFor('getEntity')).toEqual(
      expect.arrayContaining([
        'CreditCardPayment',
        'TaxPayment',
        'RecurringTransaction',
        'JournalCode',
      ])
    )
    expect(optionsFor('createEntity')).toEqual(
      expect.arrayContaining(['CreditCardPayment', 'RecurringTransaction', 'JournalCode'])
    )
    expect(optionsFor('createEntity')).not.toContain('TaxPayment')
    expect(optionsFor('updateEntity')).toContain('CreditCardPayment')
    expect(optionsFor('updateEntity')).toContain('JournalCode')
    expect(optionsFor('updateEntity')).not.toContain('RecurringTransaction')
    expect(optionsFor('updateEntity')).not.toContain('TaxPayment')
    expect(optionsFor('deleteEntity')).toContain('CreditCardPayment')
    expect(optionsFor('deleteEntity')).toContain('RecurringTransaction')
    expect(optionsFor('deleteEntity')).not.toContain('JournalCode')
    expect(optionsFor('deleteEntity')).not.toContain('TaxPayment')
  })
})
