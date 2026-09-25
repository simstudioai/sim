import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { CLI_CONTRACT } from '#sim-cli/contract/commands'
import { V2_OPERATIONS } from '#sim-cli/generated/v2-api'
import { addOperationOptions } from '#sim-cli/runtime/options'
import type { OperationSpec } from '#sim-cli/runtime/types'

it('rejects simultaneous compact and expanded trace output', () => {
  const command = new Command('get').exitOverride().configureOutput({ writeErr: () => {} })
  addOperationOptions(
    command,
    'getLog',
    CLI_CONTRACT.getLog ?? {},
    V2_OPERATIONS.getLog as OperationSpec
  )
  expect(() => command.parse(['node', 'get', 'run-1', '--summary', '--trace'])).toThrow(
    /cannot be used/
  )
})

const LIST_FILES_NEGATABLE: OperationSpec = {
  method: 'GET',
  path: '/api/v2/files',
  pathParams: [],
  query: {
    recursive: {
      kind: 'enum',
      values: ['true', 'false'] as const,
      describe: 'Whether the folder filter includes files in subfolders.',
    },
  },
}

function negatableOpts(argv: string[]): Record<string, unknown> {
  const command = new Command('list').exitOverride()
  addOperationOptions(
    command,
    'listFiles',
    { flags: { recursive: { boolean: true, negatable: true } } },
    LIST_FILES_NEGATABLE
  )
  command.parse(argv, { from: 'user' })
  return command.opts()
}

describe('a string-backed toggle the API defaults to true', () => {
  /**
   * `--recursive` alone had no way to say false, so a folder search always
   * descended. The twin restores it.
   */
  it('offers both spellings, and each sends what it says', () => {
    expect(negatableOpts(['--recursive']).recursive).toBe(true)
    expect(negatableOpts(['--no-recursive']).recursive).toBe(false)
  })

  /**
   * Commander gives a lone `--no-x` an implicit `true` default, which would
   * make every unqualified list send `recursive=true` and override the API's
   * own conditional default. Declaring the positive flag first suppresses it —
   * an ordering this asserts rather than trusts.
   */
  it('leaves the field absent when neither spelling is given', () => {
    expect(negatableOpts([])).not.toHaveProperty('recursive')
  })
})
