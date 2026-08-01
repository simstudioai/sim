/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createScrubbedPiError,
  getScrubbedPiErrorMessage,
  scrubPiEvent,
  scrubPiSecrets,
} from '@/executor/handlers/pi/redaction'

describe('Pi secret redaction', () => {
  it('redacts literal and URL-encoded secret representations', () => {
    expect(
      scrubPiSecrets('literal sk-hosted/secret encoded sk-hosted%2Fsecret', ['sk-hosted/secret'])
    ).toBe('literal *** encoded ***')
  })

  it('redacts longer overlapping secrets before their prefixes', () => {
    expect(scrubPiSecrets('ghp_secret and ghp_', ['ghp_', 'ghp_secret'])).toBe('*** and ***')
  })

  it('redacts all string-bearing Pi event variants', () => {
    expect(scrubPiEvent({ type: 'thinking', text: 'saw sk-hosted' }, ['sk-hosted'])).toEqual({
      type: 'thinking',
      text: 'saw ***',
    })
    expect(
      scrubPiEvent({ type: 'tool_end', toolName: 'sk-hosted', isError: true }, ['sk-hosted'])
    ).toEqual({ type: 'tool_end', toolName: '***', isError: true })
    expect(scrubPiEvent({ type: 'error', message: 'failed sk-hosted' }, ['sk-hosted'])).toEqual({
      type: 'error',
      message: 'failed ***',
    })
  })

  it('creates sanitized errors without retaining the raw cause', () => {
    const raw = new Error('provider exposed sk-hosted')
    const scrubbed = createScrubbedPiError(raw, ['sk-hosted'])

    expect(getScrubbedPiErrorMessage(raw, ['sk-hosted'])).toBe('provider exposed ***')
    expect(scrubbed.message).toBe('provider exposed ***')
    expect(scrubbed.cause).toBeUndefined()
    expect(String(scrubbed.stack)).not.toContain('sk-hosted')
  })
})
