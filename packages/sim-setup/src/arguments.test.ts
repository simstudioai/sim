import { describe, expect, it } from 'vitest'
import { LIFECYCLE_COMMANDS, parseSetupArguments } from './arguments'

describe('parseSetupArguments', () => {
  it('parses wizard options in either supported value form', () => {
    expect(parseSetupArguments(['--quick', '--mode', 'compose', '--dir', 'install'])).toEqual({
      kind: 'wizard',
      quick: true,
      mode: 'compose',
    })
    expect(parseSetupArguments(['--mode=k8s', '--dir=install'])).toEqual({
      kind: 'wizard',
      quick: false,
      mode: 'k8s',
    })
  })

  it('rejects unknown and duplicate wizard options', () => {
    expect(() => parseSetupArguments(['--quik'])).toThrow('Unknown setup option: --quik')
    expect(() => parseSetupArguments(['--quick', '--quick'])).toThrow(
      '--quick may only be provided once'
    )
    expect(() => parseSetupArguments(['--mode', 'production'])).toThrow(
      'expected compose, dev, or k8s'
    )
  })

  it('requires one unambiguous directory override', () => {
    expect(() => parseSetupArguments(['--dir'])).toThrow('--dir requires a directory path')
    expect(() => parseSetupArguments(['--dir='])).toThrow('--dir requires a directory path')
    expect(() => parseSetupArguments(['--dir=a', '--dir', 'b'])).toThrow(
      '--dir may only be provided once'
    )
  })

  it('rejects extra lifecycle and configuration arguments', () => {
    for (const command of [...LIFECYCLE_COMMANDS, 'config'] as const) {
      expect(() => parseSetupArguments([command, 'extra'])).toThrow('does not accept: extra')
    }
    expect(() => parseSetupArguments(['doctor', '--json', '--unknown'])).toThrow(
      'Unknown doctor option: --unknown'
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

  it('allows help for every top-level command without executing it', () => {
    expect(parseSetupArguments(['--help'])).toEqual({ kind: 'help' })
    expect(parseSetupArguments(['add', '--help'])).toEqual({ kind: 'help' })
    expect(parseSetupArguments(['add', 'integration', '--help'])).toEqual({ kind: 'help' })
    expect(parseSetupArguments(['doctor', '--help'])).toEqual({ kind: 'help' })
    for (const command of [...LIFECYCLE_COMMANDS, 'config'] as const) {
      expect(parseSetupArguments([command, '--help'])).toEqual({ kind: 'help' })
    }
  })

  it('keeps version root-only and rejects conflicting global flags', () => {
    expect(parseSetupArguments(['--version'])).toEqual({ kind: 'version' })
    expect(() => parseSetupArguments(['doctor', '--version'])).toThrow(
      '--version does not accept: doctor'
    )
    expect(() => parseSetupArguments(['--help', '--version'])).toThrow(
      '--help and --version cannot be combined'
    )
  })
})
