/**
 * @vitest-environment node
 */
import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { addOperationOptions } from './options'
import type { OperationSpec } from './types'

const DELETE_TABLE: OperationSpec = {
  method: 'DELETE',
  path: '/api/v2/tables/{tableId}',
  pathParams: ['tableId'],
}

function confirmHelp(): string {
  const command = new Command('delete')
  addOperationOptions(
    command,
    'deleteTable',
    { confirm: 'This deletes the table and all of its rows.' },
    DELETE_TABLE
  )
  return command.helpInformation()
}

describe('the --yes flag on a destructive command', () => {
  /**
   * `executeOperation` throws unless `--yes` is present, whether or not stdin is
   * a terminal — nothing anywhere prompts. Advertising a confirmation to skip
   * described a question the CLI never asks.
   */
  it('describes itself as the confirmation, not as skipping one', () => {
    const help = confirmHelp()
    expect(help).toMatch(/-y, --yes\s+Confirm this destructive operation \(required\)/)
    expect(help).not.toMatch(/skip/i)
    expect(help).not.toMatch(/prompt/i)
  })
})

const UPDATE_TABLE: OperationSpec = {
  method: 'PATCH',
  path: '/api/v2/tables/{tableId}',
  pathParams: ['tableId'],
  body: {
    description: { kind: 'string', nullable: true, describe: 'Replacement table description.' },
    name: { kind: 'string', describe: 'Replacement table name.' },
  },
  query: {
    note: { kind: 'string', nullable: true, describe: 'A nullable field in the query string.' },
  },
}

function nullableHelp(): string {
  const command = new Command('update')
  addOperationOptions(command, 'updateTable', {}, UPDATE_TABLE)
  return command.helpInformation()
}

describe('a body field the contract types as nullable', () => {
  /**
   * The route contracts describe several of these as "null clears it", which the
   * CLI could not do: every one is a string flag, so the word `null` arrived as
   * its four characters and was stored. The companion is what makes the prose
   * true, and naming it in the help is what stops it promising otherwise.
   */
  it('offers a companion flag that clears it, and says so', () => {
    const help = nullableHelp()

    expect(help).toMatch(/--no-description\s+Send --description as null to clear it/)
    expect(help).toMatch(/\(--no-description\s+clears it\)/)
  })

  it('leaves a field the contract does not make nullable without one', () => {
    expect(nullableHelp()).not.toMatch(/--no-name/)
  })

  /** A query string has no way to spell null, so a clear there would never travel. */
  it('offers nothing for a nullable query field', () => {
    expect(nullableHelp()).not.toMatch(/--no-note/)
  })
})
