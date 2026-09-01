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
    expect(help).toMatch(/-y, --yes\s+Confirm this operation \(required\)/)
    expect(help).not.toMatch(/skip/i)
    expect(help).not.toMatch(/prompt/i)
    // Nor "destructive": the same gate covers `files unzip`, which only adds.
    expect(help).not.toMatch(/destructive/i)
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

const LIST_FILES: OperationSpec = {
  method: 'GET',
  path: '/api/v2/files',
  pathParams: [],
  query: {
    recursive: {
      kind: 'boolean',
      describe:
        'Whether the folder filter includes files in subfolders. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected.',
    },
    folder: { kind: 'string', describe: 'Folder path as shown in the app.' },
  },
}

function listFilesHelp(): string {
  const command = new Command('list')
  addOperationOptions(command, 'listFiles', {}, LIST_FILES)
  return command.helpInformation()
}

describe('a boolean query param that documents its wire spellings', () => {
  /**
   * The API accepts twelve spellings for a boolean query param and says so. The
   * CLI renders the field as a bare `--recursive` with a `--no-recursive` twin,
   * neither of which takes a value, so the sentence pointed at a list the help
   * never prints — in `--help` and in the generated reference alike.
   */
  it('drops the vocabulary sentence a bare flag cannot honour', () => {
    const help = listFilesHelp()

    expect(help).toMatch(/--recursive\s+Whether the folder filter includes files in subfolders\./)
    expect(help).not.toMatch(/listed spellings/)
    expect(help).not.toMatch(/case-sensitive/)
  })

  /**
   * Stripping the clause must not eat the sentence that carries the meaning, and
   * must not reach a flag that does take a value — those still publish their
   * vocabulary, because there the reader can act on it.
   */
  it('keeps the rest of the prose, and leaves valued flags untouched', () => {
    const help = listFilesHelp()

    expect(help).toMatch(/--folder <value>\s+Folder path as shown in the app\./)
    expect(help).toMatch(/includes files in subfolders\./)
  })
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
