/**
 * @vitest-environment node
 */
import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { HELP_EPILOGUE } from '../program'
import { buildGeneratedCommands } from '../runtime/build'
import { flagNameFor, flagSpecFor } from '../runtime/request'
import type { OperationSpec } from '../runtime/types'
import { CLI_CONTRACT } from './commands'

/** Every leaf command's full path, `tables rows count` style. */
function leafPaths(options: { includeHidden?: boolean } = {}): string[] {
  const paths: string[] = []
  const isHidden = (command: Command) =>
    (command as Command & { _hidden?: boolean })._hidden === true
  const walk = (command: Command, prefix: string[]): void => {
    const path = [...prefix, command.name()]
    const children = options.includeHidden
      ? command.commands
      : command.commands.filter((child) => !isHidden(child))
    if (children.length === 0) {
      paths.push(path.join(' '))
      return
    }
    for (const child of children) walk(child, path)
  }
  for (const group of buildGeneratedCommands()) walk(group, [])
  return paths
}

function commandAt(...names: string[]): Command {
  let current: Command | undefined
  let candidates: readonly Command[] = buildGeneratedCommands()
  for (const name of names) {
    current = candidates.find((command) => command.name() === name)
    if (!current) throw new Error(`Missing command ${names.join(' ')}`)
    candidates = current.commands
  }
  if (!current) throw new Error('No command requested')
  return current
}

describe('the command tree', () => {
  it('registers every command name exactly once', () => {
    // Commander resolves a duplicate name to the first registered match, so a
    // collision does not fail loudly — the shadowed command's flags simply
    // become unreachable, which is how the bulk document update once hid the
    // single-document one.
    const paths = leafPaths()
    expect(paths.length).toBe(new Set(paths).size)
  })

  it('names each renamed command after what it does', () => {
    // The retired path still resolves, so a script written before the rename
    // keeps working; it is simply hidden, so nothing teaches it any more. Both
    // halves matter: dropping it breaks callers, surfacing it undoes the rename.
    const visible = leafPaths()
    const all = leafPaths({ includeHidden: true })

    for (const [current, retired] of [
      ['tables rows count', 'tables count create'],
      ['files restore', 'files restore create'],
      ['workflows deployment status', 'workflows deployment list'],
    ]) {
      expect(visible).toContain(current)
      expect(visible).not.toContain(retired)
      expect(all).toContain(retired)
    }
  })

  it('spells one concept with one flag name across the contract', () => {
    // `predicate` was `--filter` on two row commands and `--predicate` on the
    // third, and the same idea was `--q` here and `--query` on knowledge search.
    const flagsByField = new Map<string, Set<string>>()
    for (const operation of Object.keys(V2_OPERATIONS) as V2OperationName[]) {
      if (CLI_CONTRACT[operation]?.hidden) continue
      const spec = V2_OPERATIONS[operation] as OperationSpec
      for (const slot of ['query', 'body'] as const) {
        for (const field of Object.keys(spec[slot] ?? {})) {
          if (flagSpecFor(operation, field).omit) continue
          const names = flagsByField.get(field) ?? new Set<string>()
          names.add(flagNameFor(operation, field))
          flagsByField.set(field, names)
        }
      }
    }

    const divergent = [...flagsByField]
      .filter(([, names]) => names.size > 1)
      .map(([field, names]) => `${field}: ${[...names].sort().join(', ')}`)

    // `rowIds` is the one field still spelled two ways: `tables rows
    // batch-delete` deliberately takes a singular repeated `--row`.
    expect(divergent).toEqual(['rowIds: row, row-ids'])
  })
})

describe('renamed commands keep their surface', () => {
  it('documents the filter operators on the row count', () => {
    const help = commandAt('tables', 'rows', 'count').helpInformation()
    expect(help).toContain('--filter <json|@file>')
    expect(help).toContain('{"field":"status","op":"eq","value":"active"}')
    expect(help).toContain('{"all":[{"field":"status","op":"eq","value":"active"}]}')
    expect(help).toContain('{"any":[{"field":"status","op":"eq","value":"active"}]}')
    expect(help).toContain('group entries may also be nested groups')
    expect(help).not.toContain('--predicate')
  })

  it('asks for a row search the same way knowledge search does', () => {
    const help = commandAt('tables', 'rows', 'find').helpInformation()
    expect(help).toContain('--query <value>')
    expect(help).not.toMatch(/--q\b/)
  })

  it('names the parent knowledge base on every document command', () => {
    for (const verb of ['get', 'update', 'delete', 'batch-update']) {
      expect(commandAt('knowledge', 'documents', verb).helpInformation()).toContain(
        '<knowledgeBaseId>'
      )
    }
    expect(commandAt('knowledge', 'tags', 'list').helpInformation()).toContain('<knowledgeBaseId>')
  })
})

/**
 * Field names the v2 contract uses for a folder path.
 *
 * Only ever consulted here, to prove the contract marks all of them: the CLI
 * itself drives off the explicit `folderPath` marker, because `path` on its
 * own is also a LOCAL file on the upload commands.
 */
const FOLDER_PATH_FIELDS = new Set([
  'folderPath',
  'folderPaths',
  'parentPath',
  'destinationPath',
  'targetFolderPath',
  'path',
])

describe('folder-path fields', () => {
  it('marks every one of them for encoding', () => {
    // One missed field is one command where the visible folder name is still
    // rejected, and nothing about the failure would point back here.
    const unmarked: string[] = []
    let checked = 0
    for (const operation of Object.keys(V2_OPERATIONS) as V2OperationName[]) {
      const spec = V2_OPERATIONS[operation] as OperationSpec
      // A hidden operation never reaches `buildRequest`; the bespoke command
      // driving it (`files upload`) builds its own body and calls the encoder
      // itself, so a marker here would claim an encoding this path never runs.
      // That call is covered by the command's own test.
      if (CLI_CONTRACT[operation]?.hidden) continue
      for (const slot of ['query', 'body'] as const) {
        for (const field of Object.keys(spec[slot] ?? {})) {
          if (!FOLDER_PATH_FIELDS.has(field)) continue
          checked += 1
          if (flagSpecFor(operation, field).folderPath !== true) {
            unmarked.push(`${operation}.${field}`)
          }
        }
      }
    }
    expect(unmarked).toEqual([])
    expect(checked).toBeGreaterThan(30)
  })

  it('decodes every one it also puts in a column', () => {
    const undecoded: string[] = []
    for (const [operation, spec] of Object.entries(CLI_CONTRACT)) {
      for (const column of [...(spec.columns ?? []), ...(spec.fields ?? [])]) {
        const path = column.path ?? column.header
        if (FOLDER_PATH_FIELDS.has(path) && column.format !== 'folder-path') {
          undecoded.push(`${operation}.${path}`)
        }
      }
    }
    expect(undecoded).toEqual([])
  })

  it('keeps the provider catalogue to what you scan to choose one', () => {
    // Inferred, this listed eleven columns: the detail-view fields
    // (`docsUrl`, `helpText`, `requiresClientGeneratedCredentialId`) pushed the
    // table well past a terminal and read as empty on every OAuth row.
    const columns = CLI_CONTRACT.listCredentialProviders?.columns ?? []
    const paths = columns.map((column) => column.path ?? column.header)

    expect(columns.length).toBeLessThanOrEqual(7)
    for (const detail of ['docsUrl', 'helpText', 'requiresClientGeneratedCredentialId', 'fields']) {
      expect(paths).not.toContain(detail)
    }
    // Both ids stay: `credentials connect` names an OAuth provider by
    // `serviceId`, `credentials create` matches a service account on
    // `providerId`, and the catalogue is where you look either up.
    expect(paths).toContain('serviceId')
    expect(paths).toContain('providerId')
  })

  it('mentions the variable that moves the profile files, since help names a path', () => {
    // The epilogue states where the files live, and SIM_CONFIG_DIR moves both.
    // Naming only ~/.sim made help wrong for anyone who had set it — including
    // every CI job that points the CLI at a scratch directory.
    expect(HELP_EPILOGUE).toContain('~/.sim/config')
    expect(HELP_EPILOGUE).toContain('SIM_CONFIG_DIR')
  })
})
