import { describe, expect, it } from 'vitest'
import { retentionTool } from '@/tools/amplitude/retention'
import type { AmplitudeRetentionParams } from '@/tools/amplitude/types'

function retentionMode(mode: string): string | null {
  const buildUrl = retentionTool.request.url
  if (typeof buildUrl !== 'function') throw new Error('retention must build its URL')
  const params: AmplitudeRetentionParams = {
    apiKey: 'key',
    secretKey: 'secret',
    startEvent: '{"event_type":"_new"}',
    returnEvent: '{"event_type":"_all"}',
    start: '20260101',
    end: '20260131',
    retentionMode: mode,
  }
  return new URL(buildUrl(params)).searchParams.get('rm')
}

describe('Amplitude retention mode', () => {
  it('sends the documented nday value for the saved n-day option', () => {
    expect(retentionMode('n-day')).toBe('nday')
  })

  it('passes the other documented modes through', () => {
    expect(retentionMode('rolling')).toBe('rolling')
    expect(retentionMode('nday_or_before')).toBe('nday_or_before')
  })
})
