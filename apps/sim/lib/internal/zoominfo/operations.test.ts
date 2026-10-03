import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestZoomInfo } = vi.hoisted(() => ({ requestZoomInfo: vi.fn() }))

vi.mock('@/lib/internal/zoominfo/client', () => ({ requestZoomInfo }))

import { executeZoomInfoOperation } from '@/lib/internal/zoominfo/operations'

const AUTH = { clientId: 'client-1', clientSecret: 'secret-1' }

describe('executeZoomInfoOperation', () => {
  beforeEach(() => {
    requestZoomInfo.mockResolvedValue({ status: 200, data: { data: [] } })
  })

  it('enforces the documented 25-item enrichment cap before provider submission', async () => {
    await expect(
      executeZoomInfoOperation(
        'zoominfo_enrich_contacts',
        { ...AUTH, matchPersonInput: JSON.stringify(Array.from({ length: 26 }, () => ({}))) },
        'request-2'
      )
    ).rejects.toThrow('matchPersonInput supports a maximum of 25 entries per request')
    expect(requestZoomInfo).not.toHaveBeenCalled()
  })
})
