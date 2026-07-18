/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { getMcpSafeErrorDiagnostics } from './error-diagnostics'

describe('getMcpSafeErrorDiagnostics', () => {
  it('redacts and truncates structural fields without emitting message text', () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890'
    const error = Object.assign(new Error(`message contains ${secret}`), {
      name: `Bearer ${secret}`,
      code: `code-${'c'.repeat(200)}`,
      errno: `api_key: "${secret}"`,
      syscall: `Bearer ${secret}`,
      sessionId: secret,
    })

    const diagnostics = getMcpSafeErrorDiagnostics(error)

    expect(diagnostics).toEqual({
      name: expect.any(String),
      code: expect.any(String),
      errno: expect.any(String),
      syscall: expect.any(String),
    })
    expect(diagnostics).not.toHaveProperty('message')
    expect(diagnostics).not.toHaveProperty('causeChain')
    expect(diagnostics).not.toHaveProperty('sessionId')
    for (const value of Object.values(diagnostics)) {
      expect(value).not.toContain(secret)
      expect(value?.length).toBeLessThanOrEqual(100)
    }
    expect(diagnostics.name).toContain('[REDACTED]')
    expect(diagnostics.errno).toContain('[REDACTED]')
    expect(diagnostics.syscall).toContain('[REDACTED]')
    expect(diagnostics.code).toHaveLength(100)
  })
})
