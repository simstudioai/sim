import { describe, expect, it } from 'vitest'
import {
  decodeInvocationPayload,
  decodeLogResult,
  encodeInvocationPayload,
  mapEventInvokeConfig,
  mapProvisionedConcurrency,
} from '@/lib/internal/lambda/client'

describe('decodeLogResult', () => {
  it('decodes the base64 log tail Lambda returns for LogType Tail', () => {
    const encoded = Buffer.from('START RequestId: abc\nEND', 'utf8').toString('base64')

    expect(decodeLogResult(encoded)).toBe('START RequestId: abc\nEND')
  })
})

describe('decodeInvocationPayload', () => {
  it('parses a JSON payload', () => {
    expect(decodeInvocationPayload(new TextEncoder().encode('{"ok":true}'))).toEqual({ ok: true })
  })

  it('returns a non-JSON payload as the raw string rather than dropping it', () => {
    expect(decodeInvocationPayload(new TextEncoder().encode('plain text'))).toBe('plain text')
  })

  it('returns null for an absent, empty, or whitespace-only payload', () => {
    expect(decodeInvocationPayload(undefined)).toBeNull()
    expect(decodeInvocationPayload(new Uint8Array())).toBeNull()
    expect(decodeInvocationPayload(new TextEncoder().encode('  '))).toBeNull()
  })

  it('maps a JSON null payload to null, like an absent one', () => {
    expect(decodeInvocationPayload(new TextEncoder().encode('null'))).toBeNull()
  })

  it('preserves falsy JSON scalars that are not null', () => {
    expect(decodeInvocationPayload(new TextEncoder().encode('0'))).toBe(0)
    expect(decodeInvocationPayload(new TextEncoder().encode('false'))).toBe(false)
    expect(decodeInvocationPayload(new TextEncoder().encode('""'))).toBe('')
  })
})

describe('encodeInvocationPayload', () => {
  const decode = (bytes?: Uint8Array) => (bytes ? new TextDecoder().decode(bytes) : undefined)

  it('serializes an object payload', () => {
    expect(decode(encodeInvocationPayload({ hello: 'world' }))).toBe('{"hello":"world"}')
  })

  it('forwards an already-serialized JSON string verbatim instead of double-encoding it', () => {
    expect(decode(encodeInvocationPayload('{"hello":"world"}'))).toBe('{"hello":"world"}')
    expect(decode(encodeInvocationPayload('[1,2,3]'))).toBe('[1,2,3]')
  })

  it('sends a non-JSON string as a JSON string literal', () => {
    expect(decode(encodeInvocationPayload('plain text'))).toBe('"plain text"')
  })

  it('serializes an explicit null but omits an absent payload', () => {
    expect(decode(encodeInvocationPayload(null))).toBe('null')
    expect(encodeInvocationPayload(undefined)).toBeUndefined()
  })

  it('sends an empty string as a JSON string literal', () => {
    expect(decode(encodeInvocationPayload(''))).toBe('""')
  })
})

describe('mapEventInvokeConfig', () => {
  it('preserves a configured zero retry attempts rather than nulling it', () => {
    expect(mapEventInvokeConfig({ MaximumRetryAttempts: 0 }).maximumRetryAttempts).toBe(0)
  })
})

describe('mapProvisionedConcurrency', () => {
  it('preserves a zero available allocation rather than nulling it', () => {
    expect(
      mapProvisionedConcurrency({ AvailableProvisionedConcurrentExecutions: 0 })
        .availableProvisionedConcurrentExecutions
    ).toBe(0)
  })
})
