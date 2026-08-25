import { describe, expect, it } from 'vitest'
import { buildInstallerArguments } from './arguments'

describe('buildInstallerArguments', () => {
  it('installs the bundled pack when no arguments are supplied', () => {
    expect(buildInstallerArguments('/pack', [])).toEqual(['add', '/pack'])
  })

  it('forwards standard installer flags after the local pack', () => {
    expect(
      buildInstallerArguments('/pack', [
        '--skill',
        'build-sim-workflow',
        '--agent',
        'codex',
        '--global',
        '--yes',
      ])
    ).toEqual([
      'add',
      '/pack',
      '--skill',
      'build-sim-workflow',
      '--agent',
      'codex',
      '--global',
      '--yes',
    ])
  })

  it.each(['install', 'add'])('accepts the %s alias', (command) => {
    expect(buildInstallerArguments('/pack', [command, '--list'])).toEqual([
      'add',
      '/pack',
      '--list',
    ])
  })

  it('rejects unknown commands instead of guessing', () => {
    expect(() => buildInstallerArguments('/pack', ['build-sim-workflow'])).toThrow(
      'Unknown command "build-sim-workflow"'
    )
  })
})
