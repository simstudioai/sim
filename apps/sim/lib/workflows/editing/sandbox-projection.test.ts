/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { operationsReferenceSimSandbox } from '@/lib/workflows/editing/sandbox-projection'

describe('operationsReferenceSimSandbox', () => {
  it('detects add and edit inputs that set or clear sandboxId', () => {
    expect(
      operationsReferenceSimSandbox([
        { params: { inputs: { code: 'return 1', sandboxId: 'sandbox-1' } } },
      ])
    ).toBe(true)
    expect(operationsReferenceSimSandbox([{ params: { inputs: { sandboxId: null } } }])).toBe(true)
  })

  it('does not gate unrelated workflow operations', () => {
    expect(
      operationsReferenceSimSandbox([
        { params: { type: 'function', inputs: { code: 'return 1' } } },
        { params: { inputs: { language: 'python' } } },
      ])
    ).toBe(false)
  })
})
