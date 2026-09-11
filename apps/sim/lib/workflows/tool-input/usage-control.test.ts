/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseStoredToolInputValue } from '@/lib/workflows/tool-input/types'
import {
  buildAgentToolUsageControlCanonicalKey,
  getAgentToolUsageControlMode,
  resolveAgentToolUsageControl,
} from '@/lib/workflows/tool-input/usage-control'

describe('agent tool usage control', () => {
  it('defaults legacy tools to Auto in basic mode', () => {
    expect(resolveAgentToolUsageControl({}, 0)).toBe('auto')
  })

  it('uses the fixed selection in basic mode', () => {
    expect(
      resolveAgentToolUsageControl({ usageControl: 'force', usageControlExpression: 'none' }, 2, {
        [buildAgentToolUsageControlCanonicalKey(2)]: 'basic',
      })
    ).toBe('force')
  })

  it('uses and normalizes the resolved expression in advanced mode', () => {
    expect(
      resolveAgentToolUsageControl({ usageControl: 'auto', usageControlExpression: ' Force ' }, 1, {
        [buildAgentToolUsageControlCanonicalKey(1)]: 'advanced',
      })
    ).toBe('force')
  })

  it('rejects an empty or unsupported advanced value', () => {
    const overrides = { [buildAgentToolUsageControlCanonicalKey(0)]: 'advanced' } as const

    expect(
      resolveAgentToolUsageControl({ usageControlExpression: '' }, 0, overrides)
    ).toBeUndefined()
    expect(
      resolveAgentToolUsageControl({ usageControlExpression: 'sometimes' }, 0, overrides)
    ).toBeUndefined()
  })

  it('scopes canonical mode independently by tool index', () => {
    const overrides = { [buildAgentToolUsageControlCanonicalKey(1)]: 'advanced' } as const

    expect(getAgentToolUsageControlMode(0, overrides)).toBe('basic')
    expect(getAgentToolUsageControlMode(1, overrides)).toBe('advanced')
  })

  it('preserves the variable-capable value when parsing a stored tool input', () => {
    expect(
      parseStoredToolInputValue([
        {
          type: 'search',
          usageControl: 'auto',
          usageControlExpression: '<route.toolMode>',
        },
      ])[0]
    ).toMatchObject({
      usageControl: 'auto',
      usageControlExpression: '<route.toolMode>',
    })
  })
})
