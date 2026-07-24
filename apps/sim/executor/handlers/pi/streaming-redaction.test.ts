/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PiStreamingRedactor } from '@/executor/handlers/pi/streaming-redaction'

describe('PiStreamingRedactor', () => {
  it('redacts a secret split across arbitrary deltas', () => {
    const redactor = new PiStreamingRedactor(['sk-secret-value'])
    const output =
      redactor.push('before sk-sec') +
      redactor.push('ret-') +
      redactor.push('value after') +
      redactor.flush()
    expect(output).toBe('before *** after')
  })

  it('preserves ordinary text and masks a held secret prefix', () => {
    const redactor = new PiStreamingRedactor(['secret'])
    expect(redactor.push('ordinary sec')).toBe('ordinary ')
    expect(redactor.flush()).toBe('***')
  })
})
