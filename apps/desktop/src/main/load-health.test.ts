import { describe, expect, it } from 'vitest'
import { classifyLoadError } from '@/main/load-health'

describe('classifyLoadError', () => {
  it('ignores aborted navigations (OAuth redirects abort constantly)', () => {
    expect(classifyLoadError(-3)).toBe('ignored')
    expect(classifyLoadError(0)).toBe('ignored')
  })

  it('does NOT ignore ERR_FAILED (-2) or ERR_IO_PENDING (-1)', () => {
    expect(classifyLoadError(-2)).toBe('unreachable')
    expect(classifyLoadError(-1)).toBe('unreachable')
  })

  it('classifies connectivity failures', () => {
    expect(classifyLoadError(-106)).toBe('offline')
    expect(classifyLoadError(-105)).toBe('dns')
    expect(classifyLoadError(-137)).toBe('dns')
    expect(classifyLoadError(-7)).toBe('timeout')
    expect(classifyLoadError(-118)).toBe('timeout')
  })

  it('classifies TLS failures', () => {
    expect(classifyLoadError(-200)).toBe('tls')
    expect(classifyLoadError(-201)).toBe('tls')
    expect(classifyLoadError(-213)).toBe('tls')
  })

  it('falls back to unreachable for other network errors', () => {
    expect(classifyLoadError(-102)).toBe('unreachable')
    expect(classifyLoadError(-21)).toBe('unreachable')
    expect(classifyLoadError(-324)).toBe('unreachable')
  })
})
