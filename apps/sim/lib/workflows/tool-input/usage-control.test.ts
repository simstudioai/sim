import { describe, expect, it } from 'vitest'
import { parseStoredToolInputValue } from '@/lib/workflows/tool-input/types'
import {
  applyAgentToolUsageControlModes,
  buildAgentToolUsageControlCanonicalKey,
  getAgentToolUsageControlMode,
  resolveAgentToolUsageControl,
} from '@/lib/workflows/tool-input/usage-control'

describe('applyAgentToolUsageControlModes', () => {
  it('selects Variable for an expression alone and Selector for a fixed value alone', () => {
    expect(
      applyAgentToolUsageControlModes(
        [{ usageControl: 'force' }, { usageControlExpression: '<start.toolMode>' }],
        { '0:agentToolUsageControl': 'advanced', model: 'advanced' }
      )
    ).toEqual({ '1:agentToolUsageControl': 'advanced', model: 'advanced' })
  })

  it('keeps the current mode of a tool that carries both values', () => {
    const modes = { '1:agentToolUsageControl': 'advanced', model: 'advanced' } as const
    const repeated = { usageControl: 'force', usageControlExpression: 'none' }

    expect(applyAgentToolUsageControlModes([repeated, repeated], modes)).toEqual(modes)
  })

  it('returns to Selector when a tool omits both values', () => {
    expect(
      applyAgentToolUsageControlModes([{ type: 'custom-tool' }], {
        '0:agentToolUsageControl': 'advanced',
      })
    ).toEqual({})
  })
})

describe('agent tool usage control', () => {
  it('defaults legacy tools to Auto in basic mode', () => {
    expect(resolveAgentToolUsageControl({}, 0)).toBe('auto')
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
