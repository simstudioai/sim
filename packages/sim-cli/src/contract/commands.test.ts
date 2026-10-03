import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { buildGeneratedCommands } from '../runtime/build'
import { flagNameFor, flagSpecFor } from '../runtime/request'
import type { OperationSpec } from '../runtime/types'
import { CLI_CONTRACT } from './commands'

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))

vi.mock('../context', () => ({
  clientFrom: () => ({
    client: { request: mockRequest, requireWorkspace: () => 'ws_local' },
    profile: { workspaceId: 'ws_local', output: 'json', name: 'default', apiKey: 'k' },
  }),
}))

/**
 * Runs a leaf through commander, the way the terminal does.
 *
 * A `confirm` gate is enforced in `runtime/execute`, not by the contract, so
 * asserting the string alone would only compare the constant with itself: the
 * key could be renamed, or the gate could stop reading it, with the test still
 * green. Parsing real argv is what proves the refusal reaches the caller and
 * that nothing was sent.
 */
async function runLeaf(argv: string[]): Promise<void> {
  const root = new Command('sim').exitOverride().option('--workspace <id>')
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  await root.parseAsync(['node', 'sim', ...argv])
}

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

  it('spells one concept with one flag name across the contract', () => {
    // `predicate` was `--filter` on two row commands and `--predicate` on the
    // third, and the same idea was `--q` here and `--query` on knowledge search.
    const flagsByField = new Map<string, Set<string>>()
    for (const operation of Object.keys(V2_OPERATIONS) as V2OperationName[]) {
      if (CLI_CONTRACT[operation]?.hidden) continue
      const spec = V2_OPERATIONS[operation] as OperationSpec
      for (const slot of ['query', 'body', 'headers'] as const) {
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

    // `rowIds` is spelled two ways because `tables rows batch-delete`
    // deliberately takes a singular repeated `--row`. `limit` is two concepts
    // sharing a name on the wire: a page size everywhere else, and on `tables
    // dispatches create` an object capping eligible rows, which is why that one
    // is `--max-rows`. `folderPath` is likewise two concepts: a folder filter
    // or location on most commands, and on `workflows move` the destination —
    // which its two siblings spell `--to`, because their routes named the same
    // field `targetFolderPath`. Following the wire spelling there would put
    // `--folder` on one move command as the destination and on another as the
    // selection being moved.
    expect(divergent).toEqual([
      'folderPath: folder, to',
      'rowIds: row, row-ids',
      'limit: limit, max-rows',
    ])
  })
})

describe('the upload control token', () => {
  /**
   * The token is minted inside a handshake the CLI drives end to end and is
   * printed nowhere, so no supported flow leaves a caller holding one. A flag
   * for it can only ever fail — which is what `sim files uploads get` did on
   * every invocation — so the sweep is over the whole assembled tree rather
   * than the two commands that had one. Hidden operations are absent from that
   * tree by construction, which is exactly the permission this needs: the
   * transfer steps still declare the header and still send it.
   */
  it('reaches no command the CLI actually offers', () => {
    const offenders: string[] = []
    const walk = (command: Command, prefix: string[]): void => {
      const path = [...prefix, command.name()]
      for (const option of command.options) {
        if (option.long === '--upload-token') offenders.push(`sim ${path.join(' ')}`)
      }
      for (const child of command.commands) walk(child, path)
    }
    for (const group of buildGeneratedCommands()) walk(group, [])

    expect(offenders).toEqual([])
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

  /**
   * `knowledge chunks batch-update --operation delete` reaches the same
   * destructive path as the singular `knowledge chunks delete`, which is
   * gated. Only the singular form was, so the bulk form deleted without one.
   * The sibling document batch-update stays ungated: it only enables and
   * disables.
   */
  it('gates every batch command whose operation set can delete', () => {
    expect(CLI_CONTRACT.bulkUpdateKnowledgeChunks?.confirm).toBeTruthy()
    expect(CLI_CONTRACT.deleteKnowledgeChunk?.confirm).toBeTruthy()
    expect(CLI_CONTRACT.bulkUpdateKnowledgeDocuments?.confirm).toBeUndefined()
  })
})

describe('confirm gates say what is actually at stake', () => {
  it('gates the three workflow writes that change what production serves', () => {
    // `undeploy` takes the workflow offline for every consumer, its published
    // MCP tools included. `rollback` and `activate` are the same application
    // operation under two transitions and both change which version is live,
    // while the gated `revert` only overwrites the draft.
    const undeploy = CLI_CONTRACT.undeployWorkflow?.confirm ?? ''
    expect(undeploy).toContain('offline')
    expect(undeploy).toMatch(/MCP/)
    // The outage is temporary: MCP registrations are archived, and deploying
    // again republishes the workflow on the servers it was on before. Saying
    // they are lost for good would be the same false-warning defect this batch
    // exists to remove.
    expect(undeploy).toContain('until it is deployed again')
    expect(undeploy).not.toMatch(/does not restore|not recoverable|cannot be undone/)
    expect(CLI_CONTRACT.rollbackWorkflow?.confirm).toBeTruthy()
    expect(CLI_CONTRACT.activateWorkflowVersion?.confirm).toBeTruthy()
  })
})

/**
 * Help text as one line.
 *
 * Commander wraps a description to the terminal width, so a phrase this file
 * asserts on can straddle a newline and several spaces of indent — which makes
 * a `not.toContain` on a wrapped phrase pass whether or not the phrase is
 * there.
 */
function _flatHelp(...names: string[]): string {
  return commandAt(...names)
    .helpInformation()
    .replace(/\s+/g, ' ')
}

describe('the import cancel refuses through commander, not just in the contract', () => {
  beforeEach(() => {
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: {} })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('refuses an import cancellation without --yes, sends nothing, and says why', async () => {
    // The runner commits rows batch by batch and stops between batches, so a
    // cancelled import keeps what it wrote; a `replace` has already emptied the
    // table by then. The refusal is where the caller reads that, so it is
    // asserted through the error commander actually raises.
    const refusal = await runLeaf(['tables', 'imports', 'cancel', 'imp-1']).then(
      () => '',
      (error: Error) => error.message
    )

    expect(refusal).toContain('--yes')
    expect(refusal).toContain('replace')
    expect(refusal).toMatch(/empties the table/)
    expect(refusal).not.toMatch(/not recoverable|cannot be undone/)
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
