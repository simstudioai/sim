/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createScrubbedPiError,
  getScrubbedPiErrorMessage,
  scrubPiEvent,
  scrubPiSecrets,
} from '@/executor/handlers/pi/core/redaction'

describe('Pi credential diagnostic redaction', () => {
  it('redacts literal and URL-encoded credential representations', () => {
    expect(
      scrubPiSecrets('literal sk-hosted/secret encoded sk-hosted%2Fsecret', ['sk-hosted/secret'])
    ).toBe('literal *** encoded ***')
  })

  it('redacts longer overlapping credentials before their prefixes', () => {
    expect(scrubPiSecrets('ghp_secret and ghp_', ['ghp_', 'ghp_secret'])).toBe('*** and ***')
  })

  it('leaves ordinary low-entropy model content intact and redacts only error events', () => {
    expect(scrubPiEvent({ type: 'text', text: 'a cat made a change' }, ['a'])).toEqual({
      type: 'text',
      text: 'a cat made a change',
    })
    expect(scrubPiEvent({ type: 'thinking', text: 'saw sk-hosted' }, ['sk-hosted'])).toEqual({
      type: 'thinking',
      text: 'saw sk-hosted',
    })
    expect(
      scrubPiEvent({ type: 'tool_end', toolName: 'sk-hosted', isError: true }, ['sk-hosted'])
    ).toEqual({ type: 'tool_end', toolName: 'sk-hosted', isError: true })
    expect(scrubPiEvent({ type: 'error', message: 'failed sk-hosted' }, ['sk-hosted'])).toEqual({
      type: 'error',
      message: 'failed ***',
    })
    expect(scrubPiEvent({ type: 'final', text: 'plan sk-hosted' }, ['sk-hosted'])).toEqual({
      type: 'final',
      text: 'plan sk-hosted',
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
