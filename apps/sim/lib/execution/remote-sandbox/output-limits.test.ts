/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createSandboxOutputLimiter,
  SandboxOutputLimitError,
} from '@/lib/execution/remote-sandbox/output-limits'

describe('sandbox output limiter', () => {
  it('forwards bounded chunks and rejects combined overflow', () => {
    const onStdout = vi.fn()
    const limiter = createSandboxOutputLimiter({
      timeoutMs: 1_000,
      maxStdoutBytes: 5,
      maxCombinedBytes: 7,
      onStdout,
    })
    limiter.stdout('hello')
    expect(onStdout).toHaveBeenCalledWith('hello')
    expect(() => limiter.stderr('abc')).toThrow(SandboxOutputLimitError)
    expect(limiter.exceeded()).toBe(true)
  })
})
