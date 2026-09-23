/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { enrichOpaqueToolError } from '@/lib/mothership/request/tools/executor'

describe('enrichOpaqueToolError', () => {
  it('wraps the bare AbortSignal.timeout message with tool context', () => {
    const out = enrichOpaqueToolError(
      'The operation timed out.',
      'run_workflow',
      Date.now() - 90_000
    )
    expect(out).toContain('run_workflow timed out after ~90s')
    expect(out).toContain('read the affected resource back')
  })

  it('wraps bare abort messages', () => {
    expect(enrichOpaqueToolError('This operation was aborted', 'run_code', undefined)).toContain(
      'run_code timed out'
    )
  })

  it('leaves informative messages untouched', () => {
    const informative =
      "Tool 'run_code' timed out after 300s on the Sim executor and was abandoned."
    expect(enrichOpaqueToolError(informative, 'run_code', Date.now())).toBe(informative)
    expect(enrichOpaqueToolError('Invalid API key', 'sim_cli', Date.now())).toBe('Invalid API key')
  })
})
