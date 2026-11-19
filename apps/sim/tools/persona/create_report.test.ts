import { describe, expect, it } from 'vitest'
import { personaCreateReportTool } from '@/tools/persona/create_report'

function reportQuery(reportType: string): Record<string, unknown> {
  const body = personaCreateReportTool.request.body?.({
    apiKey: 'key',
    reportType,
    reportTemplateId: 'rptp_123',
    term: 'Jane Doe',
    countryCode: 'US',
  })
  if (!body || typeof body === 'string' || body instanceof FormData) {
    throw new Error('Expected a JSON body')
  }
  return body.data.attributes.query
}

describe('personaCreateReportTool country code', () => {
  it('sends address-country-code for watchlist reports', () => {
    expect(reportQuery('watchlist')).toEqual({ term: 'Jane Doe', 'address-country-code': 'US' })
  })

  it.each(['adverse-media', 'politically-exposed-person'])(
    'sends country-code for %s reports',
    (reportType) => {
      expect(reportQuery(reportType)).toEqual({ term: 'Jane Doe', 'country-code': 'US' })
    }
  )
})
