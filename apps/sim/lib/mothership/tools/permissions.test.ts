import { describe, expect, it } from 'vitest'
import { copilotToolCanWrite } from '@/lib/mothership/tools/permissions'

describe('copilotToolCanWrite', () => {
  it('fails closed when the permission is absent', () => {
    expect(copilotToolCanWrite(undefined)).toBe(false)
    expect(copilotToolCanWrite(null)).toBe(false)
    expect(copilotToolCanWrite('')).toBe(false)
  })

  it('denies read-only and unrecognized permissions', () => {
    expect(copilotToolCanWrite('read')).toBe(false)
    expect(copilotToolCanWrite('nonsense')).toBe(false)
  })

  it('allows write and admin', () => {
    expect(copilotToolCanWrite('write')).toBe(true)
    expect(copilotToolCanWrite('admin')).toBe(true)
  })
})
