/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeQuickBooksUpdateRefundReceiptOperation } from '@/lib/internal/quickbooks/provider-operations'

vi.mock('@/lib/core/config/env', () => ({
  env: { QUICKBOOKS_ENV: 'production' },
}))

import { executeQuickBooksFullUpdate } from '@/tools/quickbooks/utils'

describe('QuickBooks documented full updates', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads, verifies, preserves, merges, and posts a complete entity', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          Bill: {
            Id: 'bill-1',
            SyncToken: '2',
            VendorRef: { value: 'vendor-1' },
            APAccountRef: { value: 'ap-1' },
            Line: [{ Id: 'line-1', Amount: 25 }],
            PrivateNote: 'old note',
            MetaData: { CreateTime: '2026-08-01T00:00:00Z' },
            domain: 'QBO',
            sparse: false,
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          Bill: {
            Id: 'bill-1',
            SyncToken: '3',
            VendorRef: { value: 'vendor-1' },
            Line: [{ Id: 'line-1', Amount: 25 }],
            PrivateNote: 'new note',
          },
        })
      )

    const result = await executeQuickBooksFullUpdate({
      params: {
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        privateNote: 'new note',
      },
      entity: 'Bill',
      resource: 'bill',
      recordId: 'bill-1',
      syncToken: '2',
      buildPatch: (params) => ({
        sparse: true,
        PrivateNote: params.privateNote,
      }),
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    const updateRequest = vi.mocked(fetch).mock.calls[1]?.[1]
    expect(JSON.parse(String(updateRequest?.body))).toEqual({
      Id: 'bill-1',
      SyncToken: '2',
      VendorRef: { value: 'vendor-1' },
      APAccountRef: { value: 'ap-1' },
      Line: [{ Id: 'line-1', Amount: 25 }],
      PrivateNote: 'new note',
    })
    expect(result.output).toMatchObject({
      recordId: 'bill-1',
      syncToken: '3',
      recordVersion: '3',
    })
  })

  it('rejects a stale sync token without posting an update', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ Bill: { Id: 'bill-1', SyncToken: '3', Line: [] } })
    )

    await expect(
      executeQuickBooksFullUpdate({
        params: {
          accessToken: 'token',
          realmId: '123',
          quickBooksEnvironment: 'sandbox',
        },
        entity: 'Bill',
        resource: 'bill',
        recordId: 'bill-1',
        syncToken: '2',
        buildPatch: () => ({ sparse: true, PrivateNote: 'new note' }),
      })
    ).rejects.toThrow('changed since sync token 2 was read')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('replaces refund-receipt lines only after reading and preserving the complete entity', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          RefundReceipt: {
            Id: 'refund-1',
            SyncToken: '2',
            CustomerRef: { value: 'customer-1' },
            DepositToAccountRef: { value: 'account-1' },
            Line: [{ Id: 'old-line', Amount: 25 }],
            PrivateNote: 'keep me',
            MetaData: { CreateTime: '2026-08-01T00:00:00Z' },
            domain: 'QBO',
            sparse: false,
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ RefundReceipt: { Id: 'refund-1', SyncToken: '3' } }))

    await executeQuickBooksUpdateRefundReceiptOperation({
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox',
      transactionId: 'refund-1',
      syncToken: '2',
      lines: [{ lineType: 'item', amount: 10, itemId: 'item-1' }],
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toEqual({
      Id: 'refund-1',
      SyncToken: '2',
      CustomerRef: { value: 'customer-1' },
      DepositToAccountRef: { value: 'account-1' },
      Line: [
        {
          Amount: 10,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: 'item-1' } },
        },
      ],
      PrivateNote: 'keep me',
    })
  })
})
