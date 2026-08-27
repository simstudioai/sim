/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestZoomInfo } = vi.hoisted(() => ({ requestZoomInfo: vi.fn() }))

vi.mock('@/lib/internal/zoominfo/client', () => ({ requestZoomInfo }))

import { executeZoomInfoOperation } from '@/lib/internal/zoominfo/operations'

const AUTH = { clientId: 'client-1', clientSecret: 'secret-1' }

describe('executeZoomInfoOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestZoomInfo.mockResolvedValue({ status: 200, data: { data: [] } })
  })

  it('builds the documented company-search provider request after operation admission', async () => {
    await executeZoomInfoOperation(
      'zoominfo_search_companies',
      {
        ...AUTH,
        companyName: 'Sim',
        industryCodes: '["software","saas"]',
        employeeRangeMin: 10,
        page: 2,
        rpp: 50,
        sortBy: 'name',
        sortOrder: 'desc',
      },
      'request-1'
    )

    expect(requestZoomInfo).toHaveBeenCalledWith(
      {
        ...AUTH,
        path: '/data/v1/companies/search',
        method: 'POST',
        query: { 'page[number]': 2, 'page[size]': 50, sort: '-name' },
        body: {
          data: {
            type: 'CompanySearch',
            attributes: {
              companyName: 'Sim',
              industryCodes: 'software,saas',
              employeeRangeMin: '10',
            },
          },
        },
      },
      'request-1',
      undefined
    )
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

  it('caps search cardinality before provider submission', async () => {
    await expect(
      executeZoomInfoOperation(
        'zoominfo_search_companies',
        { ...AUTH, companyName: 'Sim', rpp: 101 },
        'request-3'
      )
    ).rejects.toThrow('rpp must be an integer between 1 and 100')
    expect(requestZoomInfo).not.toHaveBeenCalled()
  })

  it('forwards cancellation through to the provider client', async () => {
    const controller = new AbortController()
    await executeZoomInfoOperation(
      'zoominfo_search_news',
      { ...AUTH, categories: 'funding' },
      'request-4',
      controller.signal
    )

    expect(requestZoomInfo).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/data/v1/news/search' }),
      'request-4',
      controller.signal
    )
  })
})
