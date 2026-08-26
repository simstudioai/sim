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
    description: {
      kind: 'string',
      describe: 'Replacement table description; null clears it.',
    },
    name: { kind: 'string', describe: 'Replacement table name.' },
    settings: { kind: 'object', describe: 'Replacement settings, or null to clear them.' },
  },
  query: {
    note: { kind: 'string', describe: 'A field whose prose mentions null.' },
  },
}

function updateHelp(): string {
  const command = new Command('update')
  addOperationOptions(command, 'updateTable', {}, UPDATE_TABLE)
  return command.helpInformation()
}

describe('a body field the contract documents as cleared by null', () => {
  /**
   * `--no-<flag>` means "send this boolean as false" everywhere else in the CLI,
   * so it cannot also mean "send JSON null" here. What remains is that the word
   * `null` typed into a string flag is stored as its four characters — the help
   * says so rather than offering a flag, and offers no substitute, because an
   * empty string empties a description but is not what null means to a field
   * like `oauthClientSecret`.
   */
  it('warns that the word is all the flag can carry, and offers no companion', () => {
    const help = updateHelp()

    expect(help).toMatch(
      /--description <value>\s+Replacement table description; null clears it\.\s+\(--description null sends the word, not JSON null\)/
    )
    expect(help).not.toMatch(/--no-description/)
  })

  /**
   * The warning belongs only where the prose invites the literal. `--name` never
   * mentions null; `--settings` takes JSON, which really does parse `null` into
   * the value; and a query string carries no JSON at all.
   */
  it('warns on that flag and no other', () => {
    expect(updateHelp().match(/sends the word/g)).toHaveLength(1)
  })
})
