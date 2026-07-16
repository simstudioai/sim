/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { statusForOrchestrationError } from '@/lib/workflows/orchestration/types'

describe('statusForOrchestrationError', () => {
  it.each([
    ['validation', 400],
    ['not_found', 404],
    ['conflict', 409],
    ['internal', 500],
    [undefined, 500],
  ] as const)('maps %s to %i', (code, expected) => {
    expect(statusForOrchestrationError(code)).toBe(expected)
  })
})
