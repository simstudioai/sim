/**
 * @vitest-environment node
 */

import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { HELP_EPILOGUE } from '../program'
import { buildGeneratedCommands } from '../runtime/build'
import { flagNameFor, flagSpecFor } from '../runtime/request'
import { renderPage } from '../runtime/result'
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

  it('places connector synchronization with the other connector commands', () => {
    const all = leafPaths({ includeHidden: true })

    expect(all).toContain('knowledge connectors sync')
    expect(all).not.toContain('knowledge sync create')
    for (const path of [
      ['create'],
      ['delete'],
      ['get'],
      ['list'],
      ['sync'],
      ['update'],
      ['documents', 'list'],
      ['documents', 'update'],
    ]) {
      expect(commandAt('knowledge', 'connectors', ...path).helpInformation()).toContain(
        '<knowledgeBaseId>'
      )
    }
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

  it('takes the session inspector with it, and leaves the import ones standing', () => {
    // `files uploads get` required the token, so hiding it is the whole fix;
    // the import pair only accepted it, and both stay reachable through the
    // API key and workspace every other command already sends.
    const all = leafPaths({ includeHidden: true })

    expect(all).not.toContain('files uploads get')
    expect(leafPaths()).toEqual(
      expect.arrayContaining(['tables imports get', 'tables imports cancel'])
    )
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

  it('mentions the variable that moves the profile files, since help names a path', () => {
    // The epilogue states where the files live, and SIM_CONFIG_DIR moves both.
    // Naming only ~/.sim made help wrong for anyone who had set it — including
    // every CI job that points the CLI at a scratch directory.
    expect(HELP_EPILOGUE).toContain('~/.sim/config')
    expect(HELP_EPILOGUE).toContain('SIM_CONFIG_DIR')
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

  it('does not promise irreversible loss for a recoverable delete', () => {
    // `tables restore`, `knowledge restore` and `workflows restore` all ship, so
    // these three archive rather than destroy — the wording `deleteFile`
    // already uses.
    for (const [operation, restore] of [
      ['deleteTable', 'tables restore'],
      ['deleteKnowledgeBase', 'knowledge restore'],
      ['deleteWorkflow', 'workflows restore'],
    ] as const) {
      const confirm = CLI_CONTRACT[operation]?.confirm ?? ''
      expect(confirm).toContain('archives')
      expect(confirm).toContain(restore)
    }
  })
})

describe('records show what the API actually returns', () => {
  it('summarizes log stats instead of dumping the raw payload', () => {
    const fields = CLI_CONTRACT.getLogStats?.fields ?? []
    const paths = fields.map((field) => field.path ?? field.header)

    expect(paths).toContain('totalRuns')
    expect(paths).toContain('timeBounds.start')
    // `avgLatency` is the one duration in the response whose key the `Ms`
    // suffix does not rescue, so it printed as a raw float.
    expect(fields.find((field) => field.path === 'avgLatency')?.format).toBe('duration')
    // A nested array cannot be a column, so the raw JSON dump was the only
    // thing standing in for the per-workflow series.
    expect(fields.find((field) => field.header === 'workflows')?.format).toBe('count')
  })

  it('reports the storage quota billing returns beside the credits', () => {
    const spec = CLI_CONTRACT.getBillingStatus
    const paths = (spec?.fields ?? []).map((field) => field.path ?? field.header)

    expect(paths).toContain('storage.usedBytes')
    expect(paths).toContain('storage.limitBytes')
    expect(paths).toContain('storage.percentUsed')
    // Credits and storage are both null for a workspace API key, so the record
    // has to say why it is showing em-dashes.
    expect(spec?.describe).toContain('OAuth login or personal API key')
  })

  it('says which ledger a billing-logs page answers', () => {
    // The same workspace, window and flags return a strict subset of rows on a
    // user credential, which reads as a bug beside `billing status`. Read off the
    // help the terminal prints, since a describe that never reached a command
    // would answer nobody.
    const help = flatHelp('billing', 'logs')

    expect(help).toContain('OAuth login or personal API key reports only your events')
    expect(help).toMatch(/workspace API key reports every member/)
  })

  it('describes a workspace with the fields the strict schema has', () => {
    const paths = (CLI_CONTRACT.getWorkspace?.fields ?? []).map(
      (field) => field.path ?? field.header
    )

    // `mode` is not on the strict v2 workspace schema, so it could only ever
    // render an em-dash; `color` and `logoUrl` are returned and were missing.
    expect(paths).not.toContain('mode')
    expect(paths).toContain('color')
    expect(paths).toContain('logoUrl')
  })
})

describe('list columns', () => {
  it('shows which secrets are unredacted', () => {
    // An unredacted secret's value reaches run logs, model-visible content and
    // shared log links in plaintext; table and text are the default formats, so
    // omitting the column hid that from the operator entirely.
    const columns = CLI_CONTRACT.listSecrets?.columns ?? []
    const unredacted = columns.find((column) => (column.path ?? column.header) === 'unredacted')

    expect(unredacted?.format).toBe('bool')
    // `--output text` is positional: the new column has to trail the ones a
    // script already cuts.
    expect(columns[columns.length - 1]).toBe(unredacted)
  })

  /**
   * A custom tool has both a `title` and a `schema.function.name`, and they are
   * different fields — a column headed `name` showing the title named the other
   * one, while `--search` and `--sort-by title` both speak of the title.
   */
  it('heads the custom-tool column with the field it actually shows', () => {
    const columns = CLI_CONTRACT.listCustomTools?.columns ?? []
    const titled = columns.find((column) => (column.path ?? column.header) === 'title')

    expect(titled?.header).toBe('title')
    expect(columns.some((column) => column.header === 'name')).toBe(false)
  })

  it('keeps the workflow-MCP listings scannable', () => {
    const servers = CLI_CONTRACT.listWorkflowMcpServers?.columns ?? []
    const tools = CLI_CONTRACT.listWorkflowMcpTools?.columns ?? []

    expect(servers.length).toBeGreaterThan(0)
    expect(tools.length).toBeGreaterThan(0)
    // Inferred, these were 8 and 10 columns wide, both timestamps included.
    expect(servers.length).toBeLessThanOrEqual(6)
    expect(tools.length).toBeLessThanOrEqual(5)
    expect(servers.map((column) => column.path ?? column.header)).toContain('toolCount')
    const toolPaths = tools.map((column) => column.path ?? column.header)
    // Two truncated URLs side by side told the reader nothing; `workflowId` is
    // what `tools delete` addresses.
    expect(toolPaths).not.toContain('mcpServerUrl')
    expect(toolPaths).not.toContain('apiEndpoint')
    expect(toolPaths).toContain('workflowId')
  })

  /**
   * A dispatch's `scope` and `limit` are objects, and column inference drops
   * those, so the filtered / select-all-minus / explicit-rows distinction the
   * resource publishes had nowhere to appear — while `tableId` and
   * `workspaceId`, the command's own arguments, took two columns.
   */
  it('renders what a dispatch was asked to run, and drops its own arguments', () => {
    const dispatch = {
      id: 'disp-1',
      tableId: 'tbl-1',
      workspaceId: 'ws-1',
      status: 'dispatching',
      mode: 'incomplete',
      scope: { groupIds: ['g1'], filtered: true, excludeRowIds: ['r9', 'r8'] },
      limit: { type: 'rows', max: 500 },
      processedCount: 12,
      isManualRun: true,
      requestedAt: '2026-08-25T10:00:00.000Z',
      completedAt: null,
      canceledAt: null,
    }
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    try {
      renderPage('table', [dispatch], CLI_CONTRACT.listTableDispatches ?? {})
    } finally {
      log.mockRestore()
    }

    const [header, printed] = lines.join('\n').split('\n')
    // Split on the two-space column gap, so a cell is compared by the column it
    // landed under rather than by appearing anywhere in the row.
    const headers = header.split(/\s{2,}/)
    const cells = printed.split(/\s{2,}/)
    const cellUnder = (label: string) => cells[headers.indexOf(label)]

    expect(headers).toContain('FILTERED')
    expect(headers).toContain('EXCLUDED')
    expect(headers).not.toContain('WORKSPACE ID')
    expect(headers).not.toContain('TABLE ID')
    expect(cellUnder('FILTERED')).toBe('yes')
    expect(cellUnder('EXCLUDED')).toBe('2')
    expect(cellUnder('GROUPS')).toBe('1')
    expect(cellUnder('ROWS')).toBe('—')
    expect(cellUnder('MAX ROWS')).toBe('500')
    expect(cellUnder('COMPLETED')).toBe('—')
  })

  it('lists the audit-log id its own get command takes', () => {
    expect(
      (CLI_CONTRACT.listAuditLogs?.columns ?? []).map((column) => column.path ?? column.header)
    ).toContain('id')
  })
})

describe('help states the shape of a JSON flag', () => {
  it('asks for the dispatch row cap as a count, not as its wire object', () => {
    const help = flatHelp('tables', 'dispatches', 'create')

    // Every other `--limit` in the CLI is a bare integer, so `--limit 2` here
    // failed with "expected object, received number" — and the fix for that
    // must not be to teach the caller `{"type":"rows","max":100}`, whose
    // `type` has exactly one legal value.
    expect(help).toContain('--max-rows <n>')
    expect(help).toContain('1-1,000,000')
    expect(help).not.toContain('"type":"rows"')
    expect(help).not.toMatch(/--limit\b/)
  })

  it('shows one example per arm of the workflow operation batches', () => {
    const operations = commandAt('workflows', 'operations', 'apply').helpInformation()
    expect(operations).toContain('"operation_type":"add"')
    expect(operations).toContain('"operation_type":"edit"')
    expect(operations).toContain('"operation_type":"delete"')
    expect(operations).toContain('subflowId')
    expect(operations).toContain('"enabled":false')

    const variables = commandAt('workflows', 'variables', 'update').helpInformation()
    expect(variables).toContain('"operation":"add"')
    expect(variables).toContain('"operation":"edit"')
    expect(variables).toContain('"operation":"delete"')
  })

  it('shows the parameter-description shape MCP tool publishing takes', () => {
    expect(commandAt('workflow-mcp-servers', 'tools', 'create').helpInformation()).toContain(
      '[{"name":"email","description":"Customer email address"}]'
    )
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
function flatHelp(...names: string[]): string {
  return commandAt(...names)
    .helpInformation()
    .replace(/\s+/g, ' ')
}

describe('help and gates state what is actually true', () => {
  /**
   * `--run-id` names a header that reads like an idempotency key and is not one:
   * reusing a claimed value is refused outright, and a fresh one starts a second
   * run — so neither reading of "retry with this" is safe, and help that only
   * implied one-shot semantics left the caller to find that out from a failed
   * retry.
   */
  it('denies that --run-id makes a retry idempotent', () => {
    const help = flatHelp('workflows', 'run')

    expect(help).toContain('NOT an idempotency key')
    expect(help).toContain('RUN_ID_CONFLICT')
  })

  it('warns about the chunk batch in terms true of every operation it accepts', () => {
    // `--operation` takes enable, disable, or delete. The first two are
    // reversible and destroy nothing, so a gate message promising a possible
    // irreversible delete on every invocation is false two times in three —
    // and a warning the caller learns to disbelieve is how `--yes` becomes
    // reflexive.
    const confirm = CLI_CONTRACT.bulkUpdateKnowledgeChunks?.confirm ?? ''

    expect(confirm).toBeTruthy()
    expect(confirm).toContain('--operation delete')
    // The unconditional claim: true only of the delete arm.
    expect(confirm).not.toMatch(/^This can delete every named chunk/)
  })

  it('names the flag the terminal actually has for a full tag cleanup', () => {
    const help = flatHelp('knowledge', 'tags', 'cleanup')

    // The API's prose named a wire spelling with no terminal form; `--no-unused`
    // is printed on the next line of this same help.
    expect(help).toContain('--no-unused')
    expect(help).not.toContain('unused=false')
  })

  /**
   * `--organization` became optional server-side: the caller's sole organization
   * is derived, and only a multi-organization account has to name one. Help that
   * still read like a plain ID field sent people looking up an id they did not
   * need.
   */
  it('says --organization defaults to the caller only organization', () => {
    for (const names of [
      ['audit-logs', 'list'],
      ['audit-logs', 'get'],
    ]) {
      const help = flatHelp(...names)

      expect(help).toContain('--organization')
      expect(help).toContain('defaults to your only organization')
      expect(help).toContain('OAuth login or personal API key required')
    }
  })

  it('states the tag field type it falls back to', () => {
    // Undocumented, the default surfaces as `Tag slot "number3" is not valid
    // for field type "text"` — blaming a field type the caller never typed.
    expect(flatHelp('knowledge', 'tags', 'create')).toContain('Defaults to text')
  })

  /**
   * `--folder` meant the destination on `workflows move` and the selection on
   * `tables move`, under one generic describe that answered neither. The three
   * move commands now spell the destination `--to`, and the flag that names
   * folders being moved says so.
   */
  it('spells the move destination --to on every move command', () => {
    for (const names of [
      ['workflows', 'move'],
      ['tables', 'move'],
      ['files', 'move'],
    ]) {
      const help = flatHelp(...names)

      expect(help).toContain('--to <value>')
      expect(help).not.toContain('--folder <value>')
    }

    expect(flatHelp('workflows', 'move')).toContain('/ moves the workflows to the workspace root')
    // The one surviving `--folder` is the selection, not a destination.
    expect(flatHelp('tables', 'move')).toContain('Table folders to move')
  })

  it('keeps the retired workflows move --folder working and out of help', () => {
    const spec = CLI_CONTRACT.moveWorkflows?.flags?.folderPath

    expect(spec?.name).toBe('to')
    expect(spec?.renamedFrom).toContain('folder')
  })

  it('takes --recursive as a bare switch on every command that has one', () => {
    for (const names of [
      ['files', 'list'],
      ['files', 'folders', 'delete'],
      ['knowledge', 'folders', 'delete'],
      ['tables', 'folders', 'delete'],
      ['workflows', 'folders', 'delete'],
    ]) {
      const help = flatHelp(...names)

      expect(help).toContain('--recursive ')
      // The server's twelve-spelling string union, which the terminal should
      // never make anyone type: `--recursive yes`.
      expect(help).not.toContain('--recursive <')
    }
  })

  it('gates the table-wide run cancellation it left open', () => {
    // `tables dispatches cancel` stops one dispatch behind a gate; this stops
    // every run on the table and had none.
    const confirm = CLI_CONTRACT.cancelTableRuns?.confirm ?? ''

    expect(confirm).toBeTruthy()
    expect(confirm).toContain('--scope')
  })

  it('names the flag its stream requirement, the way its siblings do', () => {
    // `--include-thinking` and `--include-tool-calls` both say so; the flag
    // that shares their server-side rule said nothing and spent a 400 to
    // discover it.
    const help = flatHelp('workflows', 'run')

    expect(help).toContain('--select-output')
    expect(help).toContain('requires --follow')
  })

  it('promises the dialect a finished run actually matches', () => {
    // The same flag name on two resources: `workflows run` resolves block
    // names against the live workflow, `workflows runs get` reads a recorded
    // run and matches ids only. The help used to promise names on both.
    const help = flatHelp('workflows', 'runs', 'get')

    expect(help).toContain('--select-output <value...>')
    expect(help).toContain('blockId')
    expect(help).not.toMatch(/blockName|agent_1\.content/)
  })

  it('offers no negation for the retry that must travel alone', () => {
    // `retryProcessing` is `z.literal(true)`, so `--no-retry-processing` sent
    // `retryProcessing: false` as the entire request — a body that asks for
    // nothing and that the route rejects.
    const help = flatHelp('knowledge', 'documents', 'update')

    expect(help).toContain('--retry-processing')
    expect(help).not.toContain('--no-retry-processing')
  })
})

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

  it('still lets an export cancellation through, since it discards no work', async () => {
    await runLeaf(['tables', 'exports', 'cancel', 'tbl-1', 'exp-1'])
    expect(mockRequest).toHaveBeenCalled()
  })

  it('offers --yes in the help of the one it now gates, and not its sibling', () => {
    expect(flatHelp('tables', 'imports', 'cancel')).toContain('Confirm this operation (required)')
    expect(flatHelp('tables', 'exports', 'cancel')).not.toContain('--yes')
  })
})
