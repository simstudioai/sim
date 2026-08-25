import { describe, expect, it } from 'vitest'
import { buildInstallerArguments } from './arguments'

describe('buildInstallerArguments', () => {
  it('installs the bundled pack when no arguments are supplied', () => {
    expect(buildInstallerArguments('/plugin', [])).toEqual(['add', '/plugin'])
  })

  it('forwards standard installer flags after the local pack', () => {
    expect(
      buildInstallerArguments('/plugin', [
        '--skill',
        'build-workflow',
        '--agent',
        'codex',
        '--global',
        '--yes',
      ])
    ).toEqual([
      'add',
      '/plugin',
      '--skill',
      'build-workflow',
      '--agent',
      'codex',
      '--global',
      '--yes',
    ])
  })

  it.each(['install', 'add'])('accepts the %s alias', (command) => {
    expect(buildInstallerArguments('/plugin', [command, '--list'])).toEqual([
      'add',
      '/plugin',
      '--list',
    ])
  })

  it('rejects unknown commands instead of guessing', () => {
    expect(() => buildInstallerArguments('/plugin', ['build-workflow'])).toThrow(
      'Unknown command "build-workflow"'
    )
  })
})
