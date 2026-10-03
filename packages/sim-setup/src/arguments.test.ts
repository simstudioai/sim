import { describe, expect, it } from 'vitest'
import { parseSetupArguments } from './arguments'

describe('parseSetupArguments', () => {
  it('rejects unknown and duplicate wizard options', () => {
    expect(() => parseSetupArguments(['--quik'])).toThrow('Unknown setup option: --quik')
    expect(() => parseSetupArguments(['--quick', '--quick'])).toThrow(
      '--quick may only be provided once'
    )
    expect(() => parseSetupArguments(['--mode', 'production'])).toThrow(
      'expected compose, dev, or k8s'
    )
  })

  it('validates add operands before loading configuration', () => {
    expect(parseSetupArguments(['add', 'email'])).toEqual({
      kind: 'add',
      feature: 'email',
      args: [],
    })
    expect(parseSetupArguments(['add', 'integration', 'slack'])).toEqual({
      kind: 'add',
      feature: 'integration',
      args: ['slack'],
    })
    expect(() => parseSetupArguments(['add'])).toThrow('add requires a feature')
    expect(() => parseSetupArguments(['add', 'integration'])).toThrow(
      'requires exactly one integration slug'
    )
    expect(() => parseSetupArguments(['add', 'email', 'extra'])).toThrow(
      'add email does not accept: extra'
    )
  })
})
