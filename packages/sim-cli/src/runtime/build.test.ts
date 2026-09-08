import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { V2_OPERATIONS } from '../generated/v2-api'
import { SimApiError } from '../http/client'
import { buildProgram } from '../program'
import { assertNoReservedProgramFlags, buildGeneratedCommands } from './build'
import { kebab } from './derive'
import { addOperationOptions } from './options'
import { resetRenameWarnings } from './renamed'
import type { OperationSpec } from './types'

/**
 * Drives commands through commander's own parsing rather than calling
 * `buildRequest` directly.
 *
 * The unit tests below `request.ts` fed flag values in already-keyed by flag
 * name, which is not what commander produces — it camelCases every multi-word
 * flag. That gap let `--min-duration-ms` and every other multi-word flag be
 * silently dropped while the tests passed. Parsing real argv is the only way to
 * catch that class of bug.
 */

/** `SimClient.requireWorkspace`'s message, verbatim, for the mocked client. */
const NO_WORKSPACE_FOR_PROFILE =
  'No workspace set for profile "default". Pass --workspace, or run: sim configure --profile default --set-workspace <id>'

const { mockRequest, output, profileState } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  output: { format: 'json' },
  profileState: { workspaceId: 'ws_local' as string | null },
}))

vi.mock('../context', () => ({
  clientFrom: () => ({
    client: {
      request: mockRequest,
      requireWorkspace: () => {
        // The client's own wording, so a command that skips `requireWorkspace`
        // is visible here rather than passing on a placeholder.
        if (!profileState.workspaceId) throw new Error(NO_WORKSPACE_FOR_PROFILE)
        return profileState.workspaceId
      },
    },
    profile: {
      workspaceId: profileState.workspaceId,
      output: output.format,
      name: 'default',
      apiKey: 'k',
    },
  }),
}))

function program(): Command {
  const root = new Command('sim').exitOverride().option('--workspace <id>')
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  // Recursively, not just on the root: a parse error raised by a leaf (an
  // unknown option, an excess argument) exits the process otherwise, which a
  // test cannot assert on.
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

/**
 * Every header a v2 operation declares, in the flag spelling it derives into
 * when nothing renames it.
 *
 * Read off the operation table rather than listed by hand, so a header added to
 * a route is swept the day it lands.
 */
const HEADER_WIRE_FLAGS: ReadonlySet<string> = new Set(
  Object.values(V2_OPERATIONS as Record<string, { headers?: Record<string, unknown> }>).flatMap(
    (spec) => Object.keys(spec.headers ?? {}).map((header) => `--${kebab(header)}`)
  )
)

/** Every flag in a command tree typed exactly as a header is spelled on the wire. */
function wireSpelledFlags(command: Command, prefix: string[] = []): string[] {
  const path = [...prefix, command.name()]
  const offenders = command.options
    .filter((option) => option.long !== undefined && HEADER_WIRE_FLAGS.has(option.long))
    .map((option) => `${path.join(' ')} ${option.long}`)
  for (const child of command.commands) offenders.push(...wireSpelledFlags(child, path))
  return offenders
}

/** `commandAt`, but on the real program, so hand-written commands are present. */
function builtCommandAt(...names: string[]): Command {
  let current = buildProgram()
  for (const name of names) {
    const next = current.commands.find((command) => command.name() === name)
    if (!next) throw new Error(`Missing command ${names.join(' ')}`)
    current = next
  }
  return current
}

function commandAt(...names: string[]): Command {
  let current = program()
  for (const name of names) {
    const next = current.commands.find((command) => command.name() === name)
    if (!next) throw new Error(`Missing command ${names.join(' ')}`)
    current = next
  }
  return current
}

async function run(argv: string[], response: unknown = { data: [], nextCursor: null }) {
  mockRequest.mockReset()
  mockRequest.mockResolvedValue(response)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await program().parseAsync(['node', 'sim', ...argv])
  // `--all-workspaces` asks `/api/v2/meta` whether the key can make an
  // account-wide read before it makes one, so the operation's own call is not
  // always the first.
  const call = mockRequest.mock.calls.find(([path]) => path !== V2_OPERATIONS.getMeta.path)
  if (!call) throw new Error('the command made no request of its own')
  return call
}

describe('commands parsed through commander', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    profileState.workspaceId = 'ws_local'
  })

  it('carries a multi-word flag all the way to the request', async () => {
    // The regression: commander stores this as `minDurationMs`, so a lookup by
    // `min-duration-ms` found nothing and the filter never reached the API.
    const [, options] = await run(['logs', 'list', '--min-duration-ms', '250'])
    expect(options.query).toMatchObject({ minDurationMs: 250 })
  })

  /**
   * A dry run writes nothing, so demanding `--yes` to preview a change would
   * teach callers to pass `--yes` reflexively — the exact habit the confirm gate
   * depends on not forming.
   */
  describe('destructive confirmation and --dry-run', () => {
    it('refuses a graph replace without --yes', async () => {
      await expect(
        run(['workflows', 'state', 'replace', 'wf-1', '--blocks', '{}', '--edges', '[]'])
      ).rejects.toThrow(/--yes/)
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('allows the same command as a dry run without --yes', async () => {
      const [, options] = await run([
        'workflows',
        'state',
        'replace',
        'wf-1',
        '--blocks',
        '{}',
        '--edges',
        '[]',
        '--dry-run',
      ])

      expect(options.query).toMatchObject({ dryRun: true })
    })

    it('still refuses a committed apply of operations without --yes', async () => {
      await expect(
        run(['workflows', 'operations', 'apply', 'wf-1', '--operations', '[]'])
      ).rejects.toThrow(/--yes/)
    })

    it('says --yes is required only where it unconditionally is', () => {
      // Commander wraps a description, so the phrase asserted on straddles a
      // newline and several spaces of indent unless the help is flattened.
      const flat = (...names: string[]) =>
        commandAt(...names)
          .helpInformation()
          .replace(/\s+/g, ' ')

      expect(flat('workflows', 'state', 'replace')).toContain(
        'Confirm this operation (required unless --dry-run)'
      )
      expect(flat('workflows', 'operations', 'apply')).toContain(
        'Confirm this operation (required unless --dry-run)'
      )
      expect(flat('tables', 'rows', 'delete')).toContain('Confirm this operation (required)')
    })
  })

  it('registers singular aliases for every plural resource group', () => {
    const aliases = {
      'audit-logs': 'audit-log',
      credentials: 'credential',
      'custom-tools': 'custom-tool',
      files: 'file',
      knowledge: 'kb',
      logs: 'log',
      'mcp-servers': 'mcp-server',
      sandboxes: 'sandbox',
      secrets: 'secret',
      skills: 'skill',
      tables: 'table',
      workflows: 'workflow',
      workspaces: 'workspace',
    }

    for (const [name, alias] of Object.entries(aliases)) {
      expect(
        program()
          .commands.find((command) => command.name() === name)
          ?.alias()
      ).toBe(alias)
    }
    expect(program().commands.some((command) => command.name() === 'folders')).toBe(false)
  })

  /**
   * ~59 v2 operations refuse a workspace API key. The restriction is stated in
   * the OpenAPI description, and before the generator carried it into the
   * operation table `--help` advertised them identically to their
   * workspace-key-capable siblings — the caller met the rule as a `403` only
   * after the request had gone out.
   */
  describe('a command whose operation refuses a workspace API key', () => {
    it('says so in the help line it falls back to from the spec summary', () => {
      expect(commandAt('secrets', 'list').helpInformation()).toContain(
        '(OAuth login or personal API key required)'
      )
      expect(commandAt('mcp-servers', 'tools', 'list').description()).toContain(
        '(OAuth login or personal API key required)'
      )
    })

    /**
     * The suffix goes after the whole `describe ?? summary ?? METHOD path`
     * chain. Folding it into the summary branch would drop it on every command
     * carrying a hand-written `describe`, which is most of the restricted ones.
     */
    it('says so on a command carrying a hand-written describe', () => {
      expect(commandAt('workflows', 'undeploy').description()).toBe(
        'Take a workflow out of deployment (OAuth login or personal API key required)'
      )
    })

    it('leaves a workspace-key-capable sibling unsuffixed', () => {
      expect(commandAt('mcp-servers', 'list').description()).not.toContain('personal API key')
      expect(commandAt('workflows', 'list').description()).not.toContain('personal API key')
    })

    /**
     * A fully hand-written command renders its own `.description()` and so
     * never reaches the generated path. Left to itself it sits in a menu beside
     * suffixed siblings, which reads as the one command that does take a
     * workspace key — the exact confusion the suffix exists to remove.
     */
    it('says so on a fully hand-written command', () => {
      for (const path of [
        ['secrets', 'set'],
        ['credentials', 'create'],
        ['credentials', 'connect'],
        ['credentials', 'reconnect'],
      ]) {
        expect(`${path.join(' ')}: ${builtCommandAt(...path).description()}`).toContain(
          '(OAuth login or personal API key required)'
        )
      }
    })

    /**
     * Catches the next hand-written command rather than only the four that
     * exist: a restricted operation invoked from `src/commands` has to state
     * the restriction through the one helper that owns the wording.
     *
     * Reading the source is what makes this general — a hand-written command
     * declares nothing that ties it back to its operation at runtime, so the
     * `V2_OPERATIONS.<name>` reference is the only link there is.
     */
    it('is enforced for every restricted operation a hand-written command calls', async () => {
      const { readdirSync, readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const root = join(import.meta.dirname, '..', 'commands')

      const sources = readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .filter((entry) => !entry.name.endsWith('.test.ts'))
        .map((entry) => join(entry.parentPath, entry.name))

      const unsuffixed: string[] = []
      for (const source of sources) {
        const text = readFileSync(source, 'utf8')
        for (const [, operation] of text.matchAll(/V2_OPERATIONS\.([A-Za-z]+)/g)) {
          const spec = (V2_OPERATIONS as Record<string, OperationSpec>)[operation]
          if (!spec?.workspaceKeyUnsupported) continue
          const suffixed = new RegExp(`describeOperation\\(\\s*V2_OPERATIONS\\.${operation}\\b`)
          if (suffixed.test(text)) continue
          unsuffixed.push(`${source.slice(root.length + 1)} calls ${operation}`)
        }
      }

      expect([...new Set(unsuffixed)]).toEqual([])
    })
  })

  it('describes generated resource and sub-resource groups', () => {
    expect(commandAt('tables').description()).toBe('Manage tables')
    expect(commandAt('tables', 'rows').description()).toBe('Manage table rows')
  })

  it('shows the command syntax when a required positional argument is missing', async () => {
    const root = program()
    const skills = root.commands.find((command) => command.name() === 'skills')
    const update = skills?.commands.find((command) => command.name() === 'update')
    if (!update) throw new Error('Missing command skills update')

    let errorOutput = ''
    update.configureOutput({
      writeErr: (message) => {
        errorOutput += message
      },
    })

    await expect(root.parseAsync(['node', 'sim', 'skills', 'update'])).rejects.toMatchObject({
      code: 'commander.missingArgument',
    })
    expect(errorOutput).toContain("error: missing required argument 'skillId'")
    expect(errorOutput).toContain('Example: sim skills update <skillId>')
    expect(errorOutput).not.toContain('--skillId')
  })

  it('shows the -- escape when an id argument opens with a dash', async () => {
    const root = program()
    const auditLogs = root.commands.find((command) => command.name() === 'audit-logs')
    const get = auditLogs?.commands.find((command) => command.name() === 'get')
    if (!get) throw new Error('Missing command audit-logs get')

    let errorOutput = ''
    get.configureOutput({
      writeErr: (message) => {
        errorOutput += message
      },
    })

    await expect(
      root.parseAsync(['node', 'sim', 'audit-logs', 'get', '-HlDcD1z76nK6R4crsUp0'])
    ).rejects.toMatchObject({ code: 'commander.unknownOption' })
    expect(errorOutput).toContain("error: unknown option '-HlDcD1z76nK6R4crsUp0'")
    expect(errorOutput).toContain('Example: sim audit-logs get -- -HlDcD1z76nK6R4crsUp0')
  })

  it("leaves a misspelt flag with commander's own suggestion", async () => {
    const root = program()
    const auditLogs = root.commands.find((command) => command.name() === 'audit-logs')
    const get = auditLogs?.commands.find((command) => command.name() === 'get')
    if (!get) throw new Error('Missing command audit-logs get')

    let errorOutput = ''
    get.configureOutput({
      writeErr: (message) => {
        errorOutput += message
      },
    })

    await expect(
      root.parseAsync(['node', 'sim', 'audit-logs', 'get', 'log_1', '--organisation'])
    ).rejects.toMatchObject({ code: 'commander.unknownOption' })
    expect(errorOutput).toContain("error: unknown option '--organisation'")
    expect(errorOutput).not.toContain('Example:')

    await expect(
      root.parseAsync(['node', 'sim', 'audit-logs', 'get', 'log_1', '-organisation'])
    ).rejects.toMatchObject({ code: 'commander.unknownOption' })
    expect(errorOutput).toContain("error: unknown option '-organisation'")
    expect(errorOutput).not.toContain('Example:')
  })

  it('dispatches generated commands through their singular resource alias', async () => {
    const [tablePath] = await run(['table', 'list'])
    expect(tablePath).toBe('/api/v2/tables')

    const [filePath] = await run(['file', 'list'])
    expect(filePath).toBe('/api/v2/files')

    const [knowledgePath] = await run(['kb', 'list'])
    expect(knowledgePath).toBe('/api/v2/knowledge')
  })

  it('nests document commands under their knowledge base', async () => {
    expect(program().commands.map((command) => command.name())).not.toContain('documents')

    const help = commandAt('knowledge', 'documents', 'get').helpInformation()
    expect(help).toContain('<knowledgeBaseId> <documentId>')
    expect(help).not.toContain('--kb')

    const [listPath, listOptions] = await run(['kb', 'documents', 'list', 'kb_1'])
    expect(listPath).toBe('/api/v2/knowledge/kb_1/documents')
    expect(listOptions.query).toMatchObject({ workspaceId: 'ws_local' })

    const [getPath, getOptions] = await run(['kb', 'documents', 'get', 'kb_1', 'doc_1'])
    expect(getPath).toBe('/api/v2/knowledge/kb_1/documents/doc_1')
    expect(getOptions.query).toEqual({ workspaceId: 'ws_local' })

    await expect(run(['kb', 'documents', 'delete', 'kb_1', 'doc_1'])).rejects.toThrow(
      /document and its embeddings/
    )
    expect(mockRequest).not.toHaveBeenCalled()

    const [deletePath, deleteOptions] = await run([
      'kb',
      'documents',
      'delete',
      'kb_1',
      'doc_1',
      '--yes',
    ])
    expect(deletePath).toBe('/api/v2/knowledge/kb_1/documents/doc_1')
    expect(deleteOptions.query).toEqual({ workspaceId: 'ws_local' })

    await expect(run(['kb', 'documents', 'get', 'kb_1'])).rejects.toThrow(/documentId/)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('keeps billing status and logs as explicit subcommands', async () => {
    expect(
      commandAt('billing')
        .commands.map((command) => command.name())
        .sort()
    ).toEqual(['logs', 'status'])

    const help = commandAt('billing', 'logs').helpInformation()
    expect(help).toContain('--source <value>')
    expect(help).toMatch(/sim-chat combines Copilot and\s+workspace chat/)
    expect(help).toContain('"sim-chat"')
    expect(help).not.toContain('"workspace-chat"')
    expect(help).not.toContain('"copilot"')
    expect(help).not.toContain('One of: workflow')

    const [summaryPath, summaryOptions] = await run(['billing', 'status'], {
      data: {
        plan: 'pro',
        status: 'active',
        credits: { used: 10, limit: 100, remaining: 90 },
      },
    })
    expect(summaryPath).toBe('/api/v2/billing/status')
    expect(summaryOptions.query).toEqual({ workspaceId: 'ws_local' })

    const [, accountOptions] = await run(['billing', 'status', '--all-workspaces'])
    expect(accountOptions.query).toEqual({})

    profileState.workspaceId = null
    const [, unconfiguredAccountOptions] = await run(['billing', 'status', '--all-workspaces'])
    expect(unconfiguredAccountOptions.query).toEqual({})
    await expect(run(['billing', 'status'])).rejects.toThrow(NO_WORKSPACE_FOR_PROFILE)
    profileState.workspaceId = 'ws_local'
    await expect(
      run(['--workspace', 'ws_other', 'billing', 'status', '--all-workspaces'])
    ).rejects.toThrow('--all-workspaces cannot be combined with --workspace')

    const [logsPath, logsOptions] = await run([
      'billing',
      'logs',
      '--period',
      '7d',
      '--source',
      'sim-chat',
    ])
    expect(logsPath).toBe('/api/v2/billing/logs')
    expect(logsOptions.query).toMatchObject({
      workspaceId: 'ws_local',
      period: '7d',
      source: 'sim-chat',
    })

    const [, accountLogsOptions] = await run(['billing', 'logs', '--all-workspaces'])
    expect(accountLogsOptions.query).not.toHaveProperty('workspaceId')

    for (const deprecated of ['copilot', 'workspace-chat']) {
      await expect(run(['billing', 'logs', '--source', deprecated])).rejects.toThrow(
        /allowed choices.*sim-chat/i
      )
      expect(mockRequest).not.toHaveBeenCalled()
    }
  })

  it('carries every multi-word flag on a command, not just the first', async () => {
    const [, options] = await run([
      'logs',
      'list',
      '--min-duration-ms',
      '10',
      '--max-duration-ms',
      '20',
      '--min-cost',
      '1',
      '--run-id',
      'run_1',
    ])
    expect(options.query).toMatchObject({
      minDurationMs: 10,
      maxDurationMs: 20,
      minCost: 1,
      runId: 'run_1',
    })
  })

  it('applies a contract flag alias', async () => {
    const [path, options] = await run([
      'tables',
      'upsert',
      'tbl_1',
      '--data',
      '{"a":1}',
      '--on',
      'email',
    ])
    expect(path).toBe('/api/v2/tables/tbl_1/rows/upsert')
    expect(options.body).toMatchObject({ conflictTarget: 'email', data: { a: 1 } })
  })

  it('exposes inline file creation added by the v2 files contract', async () => {
    const [path, options] = await run([
      'file',
      'create',
      '--name',
      'notes.txt',
      '--content',
      'hello',
      '--encoding',
      'utf-8',
    ])
    expect(path).toBe('/api/v2/files')
    expect(options.body).toEqual({
      workspaceId: 'ws_local',
      name: 'notes.txt',
      content: 'hello',
      encoding: 'utf-8',
    })
  })

  it('describes file metadata and sharing without fetching content', async () => {
    const [path, options] = await run(['file', 'describe', 'file_1'], {
      data: { id: 'file_1', sharing: { enabled: false } },
    })
    expect(path).toBe('/api/v2/files/file_1/metadata')
    expect(options.query).toEqual({ workspaceId: 'ws_local' })
  })

  it('reads and writes sharing through one upsert', async () => {
    const [sharePath, shareOptions] = await run([
      'file',
      'share',
      'set',
      'file_1',
      '--is-active',
      'true',
      '--auth-type',
      'email',
      '--allowed-emails',
      'ada@example.com',
    ])
    expect(sharePath).toBe('/api/v2/files/file_1/share')
    expect(shareOptions.method).toBe('PATCH')
    expect(shareOptions.body).toEqual({
      workspaceId: 'ws_local',
      isActive: true,
      authType: 'email',
      allowedEmails: ['ada@example.com'],
    })

    // v2 has no unshare operation; disabling is the same upsert.
    const [offPath, offOptions] = await run([
      'file',
      'share',
      'set',
      'file_1',
      '--is-active',
      'false',
    ])
    expect(offPath).toBe('/api/v2/files/file_1/share')
    expect(offOptions.body).toMatchObject({ isActive: false })

    const [getPath, getOptions] = await run(['file', 'share', 'get', 'file_1'], {
      data: { sharing: { enabled: false } },
    })
    expect(getPath).toBe('/api/v2/files/file_1/share')
    expect(getOptions.query).toEqual({ workspaceId: 'ws_local' })
  })

  it('moves space-separated file ids to a folder path', async () => {
    const [path, options] = await run([
      'file',
      'mv',
      '--file-ids',
      'file_1',
      'file_2',
      '--to',
      'Archive',
    ])
    expect(path).toBe('/api/v2/files/move')
    expect(options.body).toEqual({
      workspaceId: 'ws_local',
      fileIds: ['file_1', 'file_2'],
      targetFolderPath: 'Archive',
    })
  })

  it('uses Linux-style resource move commands without changing update syntax', async () => {
    const [tablePath, tableOptions] = await run(['table', 'mv', 'tbl_1', 'Archive'])
    expect(tablePath).toBe('/api/v2/tables/tbl_1')
    expect(tableOptions.body).toEqual({ workspaceId: 'ws_local', folderPath: 'Archive' })

    const [workflowPath, workflowOptions] = await run([
      'workflow',
      'mv',
      '00000000-0000-4000-8000-00000000000a',
      'Archive',
    ])
    expect(workflowPath).toBe('/api/v2/workflows/00000000-0000-4000-8000-00000000000a')
    expect(workflowOptions.body).toEqual({ folderPath: 'Archive' })

    const [knowledgePath, knowledgeOptions] = await run(['kb', 'mv', 'kb_1', 'Archive'])
    expect(knowledgePath).toBe('/api/v2/knowledge/kb_1')
    expect(knowledgeOptions.body).toEqual({ workspaceId: 'ws_local', folderPath: 'Archive' })

    const [, updateOptions] = await run([
      'workflow',
      'update',
      '00000000-0000-4000-8000-00000000000a',
      '--description',
      'Updated',
    ])
    expect(updateOptions.body).toEqual({ description: 'Updated' })

    const moveHelp = commandAt('workflows', 'mv').helpInformation()
    expect(moveHelp).toContain('<workflowId> <folder>')
    expect(moveHelp).not.toContain('--folder')
    expect(commandAt('workflows', 'update').helpInformation()).not.toContain('update|mv')
  })

  it('exposes path-addressed folder commands under each resource', async () => {
    const [createPath, createOptions] = await run(['table', 'folders', 'create', 'Reports'])
    expect(createPath).toBe('/api/v2/tables/folders')
    expect(createOptions.body).toEqual({ workspaceId: 'ws_local', path: 'Reports' })

    const [movePath, moveOptions] = await run([
      'table',
      'folders',
      'mv',
      'Reports',
      'Archive/Reports',
    ])
    expect(movePath).toBe('/api/v2/tables/folders')
    expect(moveOptions.body).toEqual({
      workspaceId: 'ws_local',
      path: 'Reports',
      destinationPath: 'Archive/Reports',
    })

    const [listPath, listOptions] = await run(['table', 'folders', 'ls', '--parent', 'Reports'])
    expect(listPath).toBe('/api/v2/tables/folders')
    expect(listOptions.query).toMatchObject({ workspaceId: 'ws_local', parentPath: 'Reports' })

    const [deletePath, deleteOptions] = await run([
      'table',
      'folders',
      'delete',
      'Archive/Reports',
      '--recursive',
      '--yes',
    ])
    expect(deletePath).toBe('/api/v2/tables/folders')
    expect(deleteOptions.query).toEqual({
      workspaceId: 'ws_local',
      path: 'Archive/Reports',
      recursive: true,
    })

    const [, nonRecursiveOptions] = await run([
      'table',
      'folders',
      'delete',
      'Archive/Empty',
      '--yes',
    ])
    expect(nonRecursiveOptions.query).toEqual({
      workspaceId: 'ws_local',
      path: 'Archive/Empty',
    })

    const help = commandAt('tables', 'folders', 'delete').helpInformation()
    expect(help).toContain('--recursive')
    expect(help).not.toContain('--recursive <value>')
    expect(help).not.toContain('--no-recursive')
  })

  it('exposes named secrets separately from connected credentials', () => {
    expect(commandAt('secrets', 'list').name()).toBe('list')
    expect(commandAt('credentials', 'list').name()).toBe('list')
  })

  it('exposes workspace metadata and email-attributed members', async () => {
    const getHelp = commandAt('workspaces', 'get').helpInformation()
    expect(getHelp).not.toContain('<workspaceId>')

    const [workspacePath] = await run(['workspace', 'get'], {
      data: { id: 'ws_local' },
    })
    expect(workspacePath).toBe('/api/v2/workspaces/ws_local')

    // The workspace arrives as a path parameter here, and used to skip
    // `requireWorkspace` — so this one precondition had two wordings, and the
    // one these two commands printed never named the profile.
    profileState.workspaceId = null
    await expect(run(['workspace', 'get'])).rejects.toThrow(NO_WORKSPACE_FOR_PROFILE)
    await expect(run(['workspace', 'members'])).rejects.toThrow(NO_WORKSPACE_FOR_PROFILE)
    profileState.workspaceId = 'ws_local'

    const membersHelp = commandAt('workspaces', 'members').helpInformation()
    expect(membersHelp).not.toContain('<workspaceId>')

    const [membersPath, membersOptions] = await run(['workspace', 'members'])
    expect(membersPath).toBe('/api/v2/workspaces/ws_local/members')
    expect(membersOptions.query).toEqual({ limit: 100, cursor: null })
  })

  /**
   * The server names its own fields — right for an OpenAPI reader, untypeable
   * here: `drop includeJobRuns` names no flag this CLI has.
   */
  it('restates a rejected wire field as the flag the caller typed', async () => {
    mockRequest.mockReset()
    mockRequest.mockRejectedValue(
      new SimApiError(
        'sortBy: only "startedAt" can order job runs; drop includeJobRuns or sort by "startedAt"',
        400,
        'BAD_REQUEST',
        [{ path: ['sortBy'], message: 'sortBy: drop includeJobRuns' }]
      )
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(
      program().parseAsync(['node', 'sim', 'logs', 'list', '--include-job-runs'])
    ).rejects.toThrow(/drop --include-job-runs/)
  })

  it('comma-joins a repeated list flag', async () => {
    const [, options] = await run([
      'logs',
      'list',
      '--workflow',
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000b',
    ])
    expect(options.query).toMatchObject({
      workflowIds: '00000000-0000-4000-8000-00000000000a,00000000-0000-4000-8000-00000000000b',
    })
  })

  it('injects the profile workspace without a flag', async () => {
    const [, options] = await run(['tables', 'list'])
    expect(options.query).toMatchObject({ workspaceId: 'ws_local' })
  })

  it('sends a boolean flag only when present', async () => {
    const [, withFlag] = await run(['workflows', 'list', '--deployed-only'])
    expect(withFlag.query).toMatchObject({ deployedOnly: true })

    const [, without] = await run(['workflows', 'list'])
    expect(without.query).not.toHaveProperty('deployedOnly')
  })

  it('runs a workflow without input and keeps output selection distinct from rendering', async () => {
    const help = commandAt('workflows', 'run').helpInformation()
    expect(help).toContain('--select-output <value...>')
    expect(help).toContain('blockName.path')
    expect(help).toContain('childWorkflowId.blockName.path')
    expect(help).not.toContain('--output <value...>')

    const [, withoutInput] = await run(
      ['workflows', 'run', '00000000-0000-4000-8000-00000000000a'],
      { data: { success: true } }
    )
    expect(withoutInput.body).toEqual({})

    const [, selected] = await run(
      [
        'workflows',
        'run',
        '00000000-0000-4000-8000-00000000000a',
        '--select-output',
        'agent.answer',
        'save.result',
      ],
      { data: { success: true } }
    )
    expect(selected.body).toEqual({ selectedOutputs: ['agent.answer', 'save.result'] })
  })

  it('documents plain and grouped table queries in help', () => {
    const help = commandAt('tables', 'rows', 'query').helpInformation()
    expect(help).toContain('{"field":"status","op":"eq","value":"active"}')
    expect(help).toContain('{"all":[{"field":"status","op":"eq","value":"active"}]}')
    expect(help).toContain('{"any":[{"field":"status","op":"eq","value":"active"}]}')
    expect(help).toContain('group entries may also be nested groups')
    expect(help).toContain('[{"field":"createdAt","direction":"desc"}]')
  })

  it('refuses a destructive command without --yes, before any request', async () => {
    await expect(run(['tables', 'rows', 'batch-delete', 'tbl_1', '--row', 'a'])).rejects.toThrow(
      /cannot be undone/
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('marks required flags in help and rejects omissions before a request', async () => {
    const help = commandAt('tables', 'create').helpInformation()
    expect(help).toMatch(/--name.*required/s)
    expect(help).toMatch(/--schema.*required/s)

    await expect(run(['tables', 'create', '--name', 'Customers'])).rejects.toThrow(
      /required option '--schema/
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('shows repeated values and recovered enum choices accurately', async () => {
    const help = commandAt('knowledge', 'search').helpInformation()
    expect(help).toContain('--kb <value...>')
    expect(help).not.toMatch(/--kb[^\n]*JSON/)
    expect(help).toMatch(/--search-mode.*vector.*hybrid/s)

    await expect(
      run(['knowledge', 'search', '--kb', 'kb_1', '--search-mode', 'semantic'])
    ).rejects.toThrow(/allowed choices are vector, hybrid/i)

    const [, options] = await run(
      ['knowledge', 'search', '--kb', 'kb_1', '--search-mode', 'hybrid'],
      { data: { results: [] } }
    )
    expect(options.body).toMatchObject({ knowledgeBaseIds: ['kb_1'], searchMode: 'hybrid' })
  })

  it('documents space-separated and file-backed lists', () => {
    const help = commandAt('files', 'move').helpInformation()
    expect(help).toContain('--file-ids <value...>')
    expect(help).toMatch(/space-separated.*@path.*one\s+value\s+per\s+line/s)
    // The escape a value that genuinely starts with `@` needs, said where the
    // caller reads before typing rather than only after the read fails.
    expect(help).toContain('@@')
  })

  it('advertises the file-content encoding choices', () => {
    expect(commandAt('files', 'set-content').helpInformation()).toMatch(
      /--encoding.*utf-8.*base64/s
    )
  })

  it('documents every exact and anchor-based file edit mode', () => {
    const help = commandAt('files', 'edit').helpInformation()

    expect(help).toMatch(/--edit.*search_replace.*replace_between.*insert_after.*delete_between/s)
    expect(help).toContain('replaceAll')
    expect(help).toContain('occurrence')
  })

  it('offers expanded trace output without changing the default summary', () => {
    expect(commandAt('logs', 'get').description()).toBe('Show run diagnostics')
    expect(commandAt('logs', 'get').helpInformation()).toMatch(
      /--trace.*inputs, outputs, errors, timing,\s+and cost/s
    )
    const listHelp = commandAt('logs', 'list').helpInformation()
    expect(listHelp).toMatch(/--include-trace-spans.*implies full detail/s)
    expect(listHelp).toMatch(/--include-final-output.*implies full detail/s)
  })

  it('uses a named workflow scope for run subresources', async () => {
    expect(commandAt('workflows').commands.map((command) => command.name())).not.toContain(
      'executions'
    )
    const runs = commandAt('workflows', 'runs')
    expect(runs.commands.map((command) => command.name()).sort()).toEqual([
      'cancel',
      'get',
      'list',
      'resume',
    ])

    const help = commandAt('workflows', 'runs', 'get').helpInformation()
    expect(help).toContain('<runId>')
    expect(help).toMatch(/--workflow <workflowId>.*required/s)
    expect(help).toContain('--include-output')
    expect(help).toContain('--select-output <value...>')

    const [path, options] = await run([
      'workflows',
      'runs',
      'get',
      'run_1',
      '--workflow',
      '00000000-0000-4000-8000-00000000000a',
      '--include-output',
      '--select-output',
      'agent.content',
      'writer.text',
    ])
    expect(path).toBe('/api/v2/workflows/00000000-0000-4000-8000-00000000000a/runs/run_1')
    expect(options.query).toEqual({
      includeOutput: true,
      selectedOutputs: 'agent.content,writer.text',
    })

    const [listPath] = await run([
      'workflows',
      'runs',
      'list',
      '--workflow',
      '00000000-0000-4000-8000-00000000000a',
    ])
    expect(listPath).toBe('/api/v2/workflows/00000000-0000-4000-8000-00000000000a/runs')

    const [cancelPath] = await run([
      'workflows',
      'runs',
      'cancel',
      'run_1',
      '--workflow',
      '00000000-0000-4000-8000-00000000000a',
    ])
    expect(cancelPath).toBe(
      '/api/v2/workflows/00000000-0000-4000-8000-00000000000a/runs/run_1/cancel'
    )

    const resumeHelp = commandAt('workflows', 'runs', 'resume').helpInformation()
    expect(resumeHelp).toContain('<runId>')
    expect(resumeHelp).toMatch(/--workflow <workflowId>.*required/s)
    expect(resumeHelp).toMatch(/--context <value>.*required/s)

    const [resumePath, resumeOptions] = await run([
      'workflows',
      'runs',
      'resume',
      'run_1',
      '--workflow',
      '00000000-0000-4000-8000-00000000000a',
      '--context',
      'ctx_1',
      '--input',
      '{"approved":true}',
    ])
    expect(resumePath).toBe(
      '/api/v2/workflows/00000000-0000-4000-8000-00000000000a/runs/run_1/resume'
    )
    expect(resumeOptions.body).toEqual({
      contextId: 'ctx_1',
      input: { approved: true },
    })
  })

  it('supports organization-wide audit listing explicitly', async () => {
    const help = commandAt('audit-logs', 'list').helpInformation()
    expect(help).toMatch(
      /--organization <value>.*OAuth login or personal API key required.*required/s
    )
    expect(help).toContain('--all-workspaces')
    expect(help).toContain('--actor-email')
    expect(help).not.toContain('--actor-id')

    const [, scopedOptions] = await run([
      'audit-logs',
      'list',
      '--organization',
      'org_1',
      '--actor-email',
      'owner@example.com',
    ])
    expect(scopedOptions.query).toMatchObject({
      organizationId: 'org_1',
      workspaceId: 'ws_local',
      actorEmail: 'owner@example.com',
    })

    const [, organizationOptions] = await run([
      'audit-logs',
      'list',
      '--organization',
      'org_1',
      '--all-workspaces',
    ])
    expect(organizationOptions.query).toMatchObject({
      organizationId: 'org_1',
      limit: 100,
    })
    expect(organizationOptions.query).not.toHaveProperty('workspaceId')

    const [detailPath, detailOptions] = await run([
      'audit-logs',
      'get',
      'audit_1',
      '--organization',
      'org_1',
    ])
    expect(detailPath).toBe('/api/v2/audit-logs/audit_1')
    expect(detailOptions.query).toEqual({ organizationId: 'org_1' })
  })

  it('describes asynchronous workflow runs without a contradictory negative flag', () => {
    const help = commandAt('workflows', 'run').helpInformation()
    expect(commandAt('workflows', 'run').description()).toBe(
      'Run a deployed workflow or execute saved state manually'
    )
    expect(help).toContain('--async')
    expect(help).not.toContain('--no-async')
  })
})

describe('single-resource rendering', () => {
  async function lines(argv: string[], data: unknown, format = 'json'): Promise<string[]> {
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data })
    const captured: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      captured.push(line)
    })
    output.format = format
    try {
      await program().parseAsync(['node', 'sim', ...argv])
    } finally {
      output.format = 'json'
    }
    return captured
  }

  it('unwraps the single-key envelope a resource is returned in', async () => {
    // `createMcpServer` answers `{ data: { mcpServer: {...} } }`. Rendering that
    // as-is found one key holding an object, filtered it out as non-scalar, and
    // printed nothing at all — the server was created and the CLI said so
    // nowhere. Same silent-empty class as the body-cursor bug below.
    const printed = await lines(
      [
        'mcp-servers',
        'create',
        '--name',
        'Deepwiki',
        '--transport',
        'streamable-http',
        '--url',
        'https://mcp.deepwiki.com/mcp',
      ],
      { mcpServer: { id: 'mcp-1', name: 'Deepwiki', enabled: true } },
      'text'
    )

    expect(printed.join('\n')).toMatch(/mcp-1/)
    expect(printed.join('\n')).toMatch(/Deepwiki/)
  })

  it('renders nested fields instead of dropping them', async () => {
    // `workflows export` printed `version` and `exportedAt` and nothing else:
    // the record builder kept only scalars, so `workflow` and `state` — the
    // entire export — vanished with no indication anything was missing.
    const printed = await lines(
      ['workflows', 'get', '00000000-0000-4000-8000-00000000000a'],
      {
        id: '00000000-0000-4000-8000-00000000000a',
        name: 'Onboarding',
        inputs: [{ name: 'email', type: 'string' }],
      },
      'text'
    )

    expect(printed.join('\n')).toMatch(/inputs/)
    expect(printed.join('\n')).toMatch(/email/)
  })

  it('truncates a nested value in the table, and only there', async () => {
    const payload = {
      id: '00000000-0000-4000-8000-00000000000a',
      state: { blocks: 'x'.repeat(5000) },
    }

    const table = await lines(
      ['workflows', 'get', '00000000-0000-4000-8000-00000000000a'],
      payload,
      'table'
    )
    const clamped = table.find((line) => line.startsWith('state')) ?? ''
    expect(clamped.length).toBeLessThan(300)
    expect(clamped).toMatch(/…$/)

    // `text` is the format built for pipes, so it carries the whole value: the
    // clamp is a legibility cap on the human table, and clamping before the
    // format branch silently truncated commands whose output is one long value.
    const piped = await lines(
      ['workflows', 'get', '00000000-0000-4000-8000-00000000000a'],
      payload,
      'text'
    )
    const whole = piped.find((line) => line.startsWith('state')) ?? ''
    expect(whole).toContain('x'.repeat(5000))
  })

  it('emits a document command as JSON whatever the display format is', async () => {
    // Redirecting this to a file has to yield something `import` accepts, so
    // `table`/`text` — which flatten and truncate — must not be honoured here.
    const printed = await lines(
      ['workflows', 'export', '00000000-0000-4000-8000-00000000000a'],
      {
        version: '1.0',
        exportedAt: 'now',
        workflow: { id: '00000000-0000-4000-8000-00000000000a' },
        state: { blocks: {} },
      },
      'text'
    )

    expect(JSON.parse(printed.join('\n'))).toEqual({
      version: '1.0',
      exportedAt: 'now',
      workflow: { id: '00000000-0000-4000-8000-00000000000a' },
      state: { blocks: {} },
    })
  })

  it('leaves a payload with sibling keys intact', async () => {
    // `upsertTableRow` returns `{ row, operation }` — two real fields, not an
    // envelope. Unwrapping there would drop whether it inserted or updated.
    const printed = await lines(['tables', 'upsert', 'tbl_1', '--data', '{}'], {
      row: { id: 'r1' },
      operation: 'inserted',
    })

    expect(JSON.parse(printed[0])).toEqual({ row: { id: 'r1' }, operation: 'inserted' })
  })

  it('keeps sensitive run detail opt-in for human log output', async () => {
    const log = {
      runId: 'run_1',
      status: 'completed',
      workflow: { name: 'Billing' },
      level: 'info',
      trigger: 'api',
      startedAt: '2026-08-04T00:00:00.000Z',
      endedAt: null,
      totalDurationMs: 50,
      cost: { total: 0.001 },
      files: [],
      workflowState: { env: { SECRET_TOKEN: 'encrypted-value' } },
      finalOutput: { recipient: 'private@example.com' },
      traceSpans: [
        {
          id: 'span_1',
          name: 'Workflow Execution',
          type: 'workflow',
          children: [
            {
              id: 'span_2',
              name: 'Send email',
              type: 'block',
              status: 'completed',
              durationMs: 25,
              cost: { total: 0.0005 },
              input: { recipient: 'trace-secret@example.com' },
              output: { delivered: true },
            },
          ],
        },
      ],
    }

    const human = await lines(['logs', 'get', 'run_1'], log, 'text')
    expect(human.join('\n')).not.toContain('workflowState')
    expect(human.join('\n')).not.toContain('SECRET_TOKEN')
    expect(human.join('\n')).not.toContain('traceSpans')
    expect(human.join('\n')).not.toContain('private@example.com')
    expect(human.join('\n')).not.toContain('trace-secret@example.com')
    expect(human.join('\n')).toContain('trace\t2 spans (use --trace)')

    const expanded = await lines(['logs', 'get', 'run_1', '--trace'], log, 'text')
    expect(expanded.join('\n')).toContain('trace\t2 spans')
    expect(expanded.join('\n')).not.toContain('(use --trace)')
    expect(expanded.join('\n')).toContain('Workflow Execution [workflow]')
    expect(expanded.join('\n')).toContain('Send email [block] completed 25ms $0.0005')
    expect(expanded.join('\n')).toContain('trace-secret@example.com')
    expect(expanded.join('\n')).toContain('"delivered": true')

    const machine = await lines(['logs', 'get', 'run_1'], log, 'json')
    expect(JSON.parse(machine[0])).toMatchObject({
      workflowState: log.workflowState,
      traceSpans: log.traceSpans,
      finalOutput: log.finalOutput,
    })

    const yaml = await lines(['logs', 'get', 'run_1'], log, 'yaml')
    expect(yaml.join('\n')).toContain('traceSpans:')
    expect(yaml.join('\n')).toContain('span_2')
  })
})

describe('contract-selected list rendering', () => {
  async function lines(argv: string[], data: unknown): Promise<string[]> {
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data })
    output.format = 'text'
    const captured: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => captured.push(line))
    try {
      await program().parseAsync(['node', 'sim', ...argv])
    } finally {
      output.format = 'json'
    }
    return captured
  }

  it('renders knowledge results as rows instead of a truncated JSON blob', async () => {
    const printed = await lines(['knowledge', 'search', '--kb', 'kb_1', '--query', 'refund'], {
      results: [
        {
          similarity: 0.91,
          documentName: 'policy.md',
          chunkIndex: 2,
          content: 'Refunds are available for 30 days.',
        },
      ],
      query: 'refund',
      totalResults: 1,
    })

    // Four decimals, fixed, like the `cost` column: a similarity is compared
    // against its neighbours, so the width has to stay put down the column.
    expect(printed).toEqual(['0.9100\tpolicy.md\t2\tRefunds are available for 30 days.'])
  })

  it('renders row matches as rows', async () => {
    const printed = await lines(['tables', 'rows', 'find', 'tbl_1', '--query', 'alice'], {
      matches: [{ ordinal: 3, rowId: 'row_1', column: 'email' }],
      truncated: false,
    })

    expect(printed).toEqual(['3\trow_1\temail'])
  })

  it('maps custom-tool, credential, and secret fields to their actual response paths', async () => {
    const tools = await lines(
      ['custom-tools', 'list'],
      [
        {
          id: 'tool_1',
          title: 'Lookup',
          schema: { function: { description: 'Find a customer' } },
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
      ]
    )
    expect(tools[0]).toContain('Lookup')
    expect(tools[0]).toContain('Find a customer')

    const credentials = await lines(
      ['credentials', 'list'],
      [
        {
          id: 'cred_1',
          displayName: 'Production Stripe',
          providerId: 'stripe',
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
      ]
    )
    expect(credentials[0]).toContain('Production Stripe')
    expect(credentials[0]).toContain('stripe')

    const secrets = await lines(
      ['secrets', 'list'],
      [
        {
          name: 'STRIPE_API_KEY',
          scope: 'workspace',
          role: 'admin',
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
      ]
    )
    expect(secrets[0]).toContain('STRIPE_API_KEY')
    expect(secrets[0]).toContain('workspace')
  })

  /**
   * A field path that misses renders as an em-dash rather than failing, so a
   * renamed response key is invisible until someone reads the output. v2 nests
   * the share under `share` and calls the flag `isActive`; the CLI briefly read
   * a `sharing` wrapper and silently showed nothing for all four columns.
   */
  it('reads share fields from the v2 share object, not a sharing wrapper', async () => {
    const described = (
      await lines(['files', 'describe', 'file_1'], {
        id: 'file_1',
        name: 'notes.txt',
        uploadedByEmail: 'ada@example.com',
        share: {
          isActive: true,
          url: 'https://sim.ai/s/tok_1',
          authType: 'email',
          hasPassword: false,
          allowedEmails: ['ada@example.com'],
        },
      })
    ).join('\n')
    expect(described).toContain('https://sim.ai/s/tok_1')
    expect(described).toContain('email')
    expect(described).toContain('ada@example.com')

    const share = (
      await lines(['files', 'share', 'get', 'file_1'], {
        isActive: true,
        url: 'https://sim.ai/s/tok_2',
        authType: 'sso',
        hasPassword: true,
        allowedEmails: ['ada@example.com', 'grace@example.com'],
      })
    ).join('\n')
    expect(share).toContain('https://sim.ai/s/tok_2')
    expect(share).toContain('sso')
  })
})

describe('pagination slot', () => {
  it.each([
    { argv: ['files', 'list'], cursors: ['c1', 'c1'] },
    { argv: ['files', 'list'], cursors: ['c1', 'c2', 'c1'] },
    { argv: ['tables', 'rows', 'query', 'tbl_1', '--limit', '0'], cursors: ['c1', 'c1'] },
    { argv: ['logs', 'list', '--cursor', 'c1'], cursors: ['c1'] },
    { argv: ['tables', 'rows', 'query', 'tbl_1', '--cursor', 'c1'], cursors: ['c1'] },
  ])(
    'rejects cursor cycles in $argv without printing partial results',
    async ({ argv, cursors }) => {
      mockRequest.mockReset()
      mockRequest.mockRejectedValue(new Error('Pagination did not stop at the cycle'))
      for (const nextCursor of cursors) {
        mockRequest.mockResolvedValueOnce({ data: [{ id: 'r1' }], nextCursor })
      }
      const printed = vi.spyOn(console, 'log').mockImplementation(() => {})
      printed.mockClear()

      await expect(program().parseAsync(['node', 'sim', ...argv])).rejects.toThrow(
        'repeated pagination cursor'
      )
      expect(mockRequest).toHaveBeenCalledTimes(cursors.length)
      expect(printed).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['files', 'list'],
    ['tables', 'list'],
    ['workflows', 'list'],
    ['knowledge', 'list'],
    ['tools', 'list'],
  ])('fetches the complete %s %s inventory by default', async (...argv) => {
    mockRequest.mockReset()
    const first = Array.from({ length: 100 }, (_, index) => ({ id: `r${index}` }))
    const second = Array.from({ length: 50 }, (_, index) => ({ id: `r${100 + index}` }))
    mockRequest
      .mockResolvedValueOnce({ data: first, nextCursor: 'c1' })
      .mockResolvedValueOnce({ data: second, nextCursor: null })
    const printed: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => printed.push(line))

    await program().parseAsync(['node', 'sim', ...argv])

    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(mockRequest.mock.calls[1][1].query).toMatchObject({ cursor: 'c1', limit: 100 })
    expect(JSON.parse(printed.join('\n'))).toEqual({
      data: [...first, ...second],
      nextCursor: null,
    })
  })

  it.each([
    ['tables', 'rows', 'list', 'tbl_1'],
    ['tables', 'rows', 'query', 'tbl_1'],
    ['logs', 'list'],
    ['knowledge', 'documents', 'list', 'kb_1'],
    ['knowledge', 'chunks', 'list', 'kb_1', 'doc_1'],
    ['knowledge', 'connectors', 'documents', 'list', 'kb_1', 'connector_1'],
    ['workflows', 'runs', 'list', '--workflow', 'wf_1'],
    ['workflows', 'versions', 'list', 'wf_1'],
    ['billing', 'logs'],
    ['audit-logs', 'list', '--organization', 'org_1'],
  ])('caps large dataset command %j at 100 items by default', async (...argv) => {
    mockRequest.mockReset()
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: `r${index}` }))
    mockRequest
      .mockResolvedValueOnce({ data: rows, nextCursor: 'c1' })
      .mockRejectedValue(new Error('The default limit must stop before another page'))
    const printed: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => printed.push(line))

    await program().parseAsync(['node', 'sim', ...argv])

    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(JSON.parse(printed.join('\n'))).toEqual({ data: rows, nextCursor: 'c1' })

    mockRequest.mockReset()
    mockRequest.mockResolvedValueOnce({ data: [{ id: 'r100' }], nextCursor: null })
    printed.length = 0

    await program().parseAsync(['node', 'sim', ...argv, '--cursor', 'c1'])

    expect(mockRequest).toHaveBeenCalledTimes(1)
    const options = mockRequest.mock.calls[0][1]
    expect({ ...options.query, ...options.body }).toMatchObject({ cursor: 'c1', limit: 100 })
    expect(JSON.parse(printed.join('\n'))).toEqual({ data: [{ id: 'r100' }], nextCursor: null })
  })

  it('pages a body-cursor operation and renders its rows', async () => {
    // `queryRows` is a POST whose cursor is in the body, not the query. Reading
    // only the query made it take the single-request path and print nothing.
    mockRequest.mockReset()
    mockRequest
      .mockResolvedValueOnce({ data: [{ id: 'r1' }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ data: [{ id: 'r2' }], nextCursor: null })
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })

    await program().parseAsync(['node', 'sim', 'tables', 'rows', 'query', 'tbl_1'])

    expect(mockRequest).toHaveBeenCalledTimes(2)
    // Second call resumes from the cursor — in the body, where the contract puts it.
    expect(mockRequest.mock.calls[1][1].body).toMatchObject({ cursor: 'c1' })
    expect(mockRequest.mock.calls[1][1].query).not.toHaveProperty('cursor')
    // And the rows actually render rather than printing an empty record.
    expect(JSON.parse(lines[0])).toEqual({ data: [{ id: 'r1' }, { id: 'r2' }], nextCursor: null })
  })

  it('keeps a query-cursor operation on the query slot', async () => {
    mockRequest.mockReset()
    mockRequest
      .mockResolvedValueOnce({ data: [{ id: 'a' }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ data: [{ id: 'b' }], nextCursor: null })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await program().parseAsync(['node', 'sim', 'logs', 'list'])

    expect(mockRequest.mock.calls[1][1].query).toMatchObject({ cursor: 'c1' })
  })

  it('says it is still fetching, on stderr, so a long cursor does not read as a hang', async () => {
    // The progress writer only ever lived in `requestAllPages`, which just the
    // `ls` commands use; every generated list pages through its own loop, so
    // `--limit 0` sat silent through twenty sequential requests. stdout stays
    // clean because that is what gets piped to `jq`.
    mockRequest.mockReset()
    mockRequest
      .mockResolvedValueOnce({ data: [{ id: 'a' }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ data: [{ id: 'b' }], nextCursor: null })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const terminal = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true })
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await program().parseAsync(['node', 'sim', 'logs', 'list', '--limit', '0'])
    } finally {
      if (terminal) Object.defineProperty(process.stderr, 'isTTY', terminal)
      else Reflect.deleteProperty(process.stderr, 'isTTY')
    }

    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('fetched 1')
  })

  /**
   * `parseInt` truncated the value before it was checked, so a fractional was
   * silently floored and `-0.5` parsed to `-0` — not less than zero, and then
   * equal to the `0` that means "everything". Both walked a workspace the
   * caller had asked to cap.
   */
  it('refuses a limit that is not a whole number, before any request', async () => {
    for (const value of ['-0.5', '-0.9', '3.9', '1.5', '', ' ']) {
      mockRequest.mockReset()
      vi.spyOn(console, 'log').mockImplementation(() => {})
      await expect(
        program().parseAsync(['node', 'sim', 'files', 'list', '--limit', value])
      ).rejects.toThrow(/--limit must be a whole number of 0 or more/)
      expect(mockRequest).not.toHaveBeenCalled()
    }
  })

  it('reads a limit the way the caller wrote it', async () => {
    mockRequest.mockReset()
    mockRequest.mockImplementation(
      async (_path: string, options: { query: { limit: number } }) => ({
        data: Array.from({ length: Math.min(20, options.query.limit) }, (_row, index) => ({
          id: `f_${index}`,
        })),
        nextCursor: options.query.limit < 20 ? 'c1' : null,
      })
    )
    const printed: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      printed.push(line)
    })

    // `parseInt(…, 10)` stopped at the `x` and read 0, which meant everything.
    await program().parseAsync(['node', 'sim', 'files', 'list', '--limit', '0x10'])
    expect(JSON.parse(printed[0]).data).toHaveLength(16)
    expect(JSON.parse(printed[0]).nextCursor).toBe('c1')

    printed.length = 0
    // And stopped at the `e`, reading a single row where 1000 was asked for.
    await program().parseAsync(['node', 'sim', 'files', 'list', '--limit', '1e3'])
    expect(JSON.parse(printed[0]).data).toHaveLength(20)
    expect(JSON.parse(printed[0]).nextCursor).toBeNull()
  })

  it('uses a valid per-page size for unlimited and large totals', async () => {
    for (const requested of ['0', '250']) {
      mockRequest.mockReset()
      mockRequest.mockResolvedValue({ data: [], nextCursor: null })
      vi.spyOn(console, 'log').mockImplementation(() => {})

      await program().parseAsync(['node', 'sim', 'files', 'list', '--limit', requested])

      expect(mockRequest.mock.calls[0][1].query.limit).toBe(100)
    }
  })

  it.each([
    { slot: 'query' as const, argv: ['logs', 'list'] },
    { slot: 'body' as const, argv: ['tables', 'rows', 'query', 'tbl_1'] },
  ])('returns an accurate cursor after a partial final $slot page', async ({ slot, argv }) => {
    mockRequest.mockReset()
    mockRequest.mockImplementation(
      async (
        _path: string,
        options: {
          query: { limit: number; cursor?: string }
          body?: { limit: number; cursor?: string }
        }
      ) => {
        const page = options[slot]
        if (!page) throw new Error(`Missing ${slot} pagination`)
        const offset = Number(page.cursor ?? 0)
        const count = Math.min(page.limit, 400 - offset)
        return {
          data: Array.from({ length: count }, (_, index) => ({ id: `r${offset + index}` })),
          nextCursor: offset + count < 400 ? String(offset + count) : null,
        }
      }
    )
    const printed: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => printed.push(line))

    await program().parseAsync(['node', 'sim', ...argv, '--limit', '250'])

    expect(mockRequest.mock.calls.map(([, options]) => options[slot].limit)).toEqual([100, 100, 50])
    const result = JSON.parse(printed.join('\n'))
    expect(result.data).toHaveLength(250)
    expect(result.data[249]).toEqual({ id: 'r249' })
    expect(result.nextCursor).toBe('250')

    printed.length = 0
    await program().parseAsync(['node', 'sim', ...argv, '--limit', '0'])

    const complete = JSON.parse(printed.join('\n'))
    expect(complete.data).toHaveLength(400)
    expect(complete.nextCursor).toBeNull()

    printed.length = 0
    const resumeCall = mockRequest.mock.calls.length
    await program().parseAsync(['node', 'sim', ...argv, '--cursor', result.nextCursor])

    expect(mockRequest.mock.calls[resumeCall][1][slot]).toMatchObject({ cursor: '250', limit: 100 })
    const resumed = JSON.parse(printed.join('\n'))
    expect(resumed.data).toHaveLength(100)
    expect(resumed.data[0]).toEqual({ id: 'r250' })
    expect(resumed.data[99]).toEqual({ id: 'r349' })
    expect(resumed.nextCursor).toBe('350')

    printed.length = 0
    await program().parseAsync([
      'node',
      'sim',
      ...argv,
      '--cursor',
      resumed.nextCursor,
      '--limit',
      '0',
    ])

    const remaining = JSON.parse(printed.join('\n'))
    expect(remaining.data).toHaveLength(50)
    expect(remaining.data[0]).toEqual({ id: 'r350' })
    expect(remaining.nextCursor).toBeNull()
  })

  it.each([
    ['logs', 'list'],
    ['tables', 'rows', 'query', 'tbl_1'],
  ])('rejects blank cursors before requesting %j', async (...argv) => {
    for (const cursor of ['', ' ', '\t']) {
      mockRequest.mockReset()

      await expect(
        program().parseAsync(['node', 'sim', ...argv, '--cursor', cursor])
      ).rejects.toThrow('--cursor')
      expect(mockRequest).not.toHaveBeenCalled()
    }
  })

  it('does not expose manual cursors on resource inventories', async () => {
    mockRequest.mockReset()

    await expect(
      program().parseAsync(['node', 'sim', 'files', 'list', '--cursor', 'c1'])
    ).rejects.toThrow("unknown option '--cursor'")
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('rejects an oversized page instead of emitting a cursor that skips rows', async () => {
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c2' })
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    stdout.mockClear()

    await expect(
      program().parseAsync(['node', 'sim', 'files', 'list', '--limit', '1'])
    ).rejects.toThrow('nextCursor would skip unreturned items')
    expect(stdout).not.toHaveBeenCalled()
  })
})

describe('rows whose content sits in a wrapper', () => {
  it('discovers columns from the expanded field', async () => {
    // `tables rows query` returned a table of ids and timestamps: a row's cells
    // live under `data`, and column inference skipped it for being an object.
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({
      data: [
        { id: 'r1', data: { url: 'https://a', title: 'A' }, createdAt: 'now' },
        { id: 'r2', data: { url: 'https://b', extra: 'E' }, createdAt: 'now' },
      ],
      nextCursor: null,
    })
    const lines: string[] = []
    output.format = 'text'
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })
    await program().parseAsync(['node', 'sim', 'tables', 'rows', 'query', 'tbl_1'])
    output.format = 'json'

    // Unioned across the page: `extra` appears only on the second row.
    expect(lines[0]).toContain('https://a')
    expect(lines[0]).toContain('A')
    expect(lines[1]).toContain('E')
  })

  it('uses the generated list command for table rows', async () => {
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({
      data: [{ id: 'r1', data: { email: 'a@example.com' } }],
      nextCursor: null,
    })
    const lines: string[] = []
    output.format = 'text'
    vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(line))
    try {
      await program().parseAsync(['node', 'sim', 'tables', 'rows', 'list', 'tbl_1'])
    } finally {
      output.format = 'json'
    }

    expect(lines[0]).toContain('a@example.com')
    expect(mockRequest.mock.calls[0][0]).toBe('/api/v2/tables/tbl_1/rows')
  })
})

describe('boolean flags', () => {
  it('negates an optional boolean, which omitting it cannot do', async () => {
    // Omitting `enabled` means "leave it alone"; there was no way to say false,
    // so an MCP server could not be disabled or a folder unlocked.
    const [, off] = await run(['mcp-servers', 'update', 'mcp_1', '--no-enabled'])
    expect(off.body).toMatchObject({ enabled: false })

    const [, on] = await run(['mcp-servers', 'update', 'mcp_1', '--enabled'])
    expect(on.body).toMatchObject({ enabled: true })

    const [, absent] = await run(['mcp-servers', 'update', 'mcp_1', '--name', 'x'])
    expect(absent.body).not.toHaveProperty('enabled')
  })

  it('rejects an argument the command has no meaning for', async () => {
    await expect(run(['mcp-servers', 'update', 'mcp_1', '--enabled', 'bogus'])).rejects.toThrow(
      /too many arguments/
    )
  })
})

describe('a body field the contract clears with null', () => {
  /**
   * All the way through commander, because the unit tests below this seam feed
   * `coerce` a value already keyed by flag name and cannot see what argv the CLI
   * accepts. There is no flag that sends JSON `null` — `--no-<flag>` means "send
   * this boolean as false" on every other flag in the CLI — so an empty string
   * is as far as the terminal goes, and the word is only ever the word.
   */
  it('sends an empty string as empty and the word null as text, with no companion flag', async () => {
    const [, empty] = await run(
      ['workflows', 'update', '00000000-0000-4000-8000-00000000000a', '--description', ''],
      {
        data: { id: '00000000-0000-4000-8000-00000000000a' },
      }
    )
    expect(empty.body).toMatchObject({ description: '' })

    const [, literal] = await run(
      ['workflows', 'update', '00000000-0000-4000-8000-00000000000a', '--description', 'null'],
      {
        data: { id: '00000000-0000-4000-8000-00000000000a' },
      }
    )
    expect(literal.body).toMatchObject({ description: 'null' })

    await expect(
      run(['workflows', 'update', '00000000-0000-4000-8000-00000000000a', '--no-description'])
    ).rejects.toThrow(/unknown option/)
  })
})

describe('bodies and fields the generator cannot flatten', () => {
  it('sends a union body whole, with the profile workspace merged in', async () => {
    // `createTableRows` is `z.union([batch, single])`, so there is no field list
    // to build flags from. The command exposed nothing at all and sent no body,
    // and every call failed with "Request body must be valid JSON".
    const [path, options] = await run([
      'tables',
      'rows',
      'create',
      'tbl_1',
      '--rows',
      '[{"city":"Paris"}]',
    ])

    expect(path).toBe('/api/v2/tables/tbl_1/rows')
    // Both branches require `workspaceId`, and it comes from the profile.
    expect(options.body).toEqual({ workspaceId: 'ws_local', rows: [{ city: 'Paris' }] })
  })

  it('offers a direct single-row flag', async () => {
    const [, options] = await run([
      'tables',
      'rows',
      'create',
      'tbl_1',
      '--data',
      '{"city":"Paris"}',
    ])
    expect(options.body).toEqual({ workspaceId: 'ws_local', data: { city: 'Paris' } })
  })

  it('requires exactly one row-body form', async () => {
    await expect(run(['tables', 'rows', 'create', 'tbl_1'])).rejects.toThrow(
      /exactly one of --data or --rows/
    )
    await expect(
      run(['tables', 'rows', 'create', 'tbl_1', '--data', '{}', '--rows', '[]'])
    ).rejects.toThrow(/exactly one of --data or --rows/)
  })

  it('rejects the wrong JSON shape for a row-body flag', async () => {
    await expect(run(['tables', 'rows', 'create', 'tbl_1', '--data', '[1,2]'])).rejects.toThrow(
      /--data must be a JSON object/
    )
  })

  it('explains the single and batch row forms in help', () => {
    const help = commandAt('tables', 'rows', 'create').helpInformation()
    expect(help).toMatch(/--data.*One row keyed by column name/s)
    expect(help).toMatch(/--rows.*Several rows keyed by column name/s)
    expect(help).not.toContain('--body')
  })

  it('leaves a non-numeric `limit` alone', async () => {
    // `runTableColumn` takes `limit: { type, max }`. The pager claimed the name
    // regardless of type, turning it into `--limit <n>` that defaulted to 100,
    // so every call failed with "expected object, received number".
    const [, omitted] = await run(['tables', 'columns', 'run', 'tbl_1', '--group-ids', '["g1"]'])
    expect(omitted.body).not.toHaveProperty('limit')

    const [, given] = await run([
      'tables',
      'columns',
      'run',
      'tbl_1',
      '--group-ids',
      '["g1"]',
      '--limit',
      '5',
    ])
    expect(given.body).toMatchObject({ limit: { type: 'rows', max: 5 } })
  })

  /**
   * The route's cap is an object holding exactly one free value, because its
   * `type` is a `z.literal('rows')` — so the wire shape was four tokens of
   * ceremony to say a number the caller already had.
   */
  describe('the dispatch row cap is typed as the count it reads as', () => {
    it('sends a bare count as the object the route declares', async () => {
      const [, options] = await run([
        'tables',
        'dispatches',
        'create',
        'tbl_1',
        '--group-ids',
        '["g1"]',
        '--max-rows',
        '100',
      ])
      expect(options.body).toMatchObject({ limit: { type: 'rows', max: 100 } })
    })

    it('refuses a count the route would reject, naming the bounds', async () => {
      for (const value of ['0', '1.5', 'abc', '1000001']) {
        await expect(
          run([
            'tables',
            'dispatches',
            'create',
            'tbl_1',
            '--group-ids',
            '["g1"]',
            '--max-rows',
            value,
          ])
        ).rejects.toThrow(/--max-rows must be a whole number between 1 and 1,000,000/)
        expect(mockRequest).not.toHaveBeenCalled()
      }
    })
  })

  /**
   * The pager's flag was handed to any field named `limit`, so a bulk mutation
   * that does not paginate carried commander's `100` default into its body: a
   * filter matching 250 rows deleted 100, exited 0, and said nothing.
   */
  describe('a row cap on a mutation that does not paginate', () => {
    const FILTER = '{"all":[{"field":"status","op":"eq","value":"active"}]}'

    it('leaves the cap off the wire entirely when it is not typed', async () => {
      const [, omitted] = await run([
        'tables',
        'rows',
        'batch-delete',
        'tbl_1',
        '--filter',
        FILTER,
        '--yes',
      ])
      expect(omitted.body).not.toHaveProperty('limit')

      const [, updated] = await run([
        'tables',
        'rows',
        'batch-update',
        'tbl_1',
        '--filter',
        FILTER,
        '--data',
        '{"status":"done"}',
        '--yes',
      ])
      expect(updated.body).not.toHaveProperty('limit')
    })

    it('sends the cap the caller typed, unrounded by the pager', async () => {
      const [, given] = await run([
        'tables',
        'rows',
        'batch-delete',
        'tbl_1',
        '--filter',
        FILTER,
        '--limit',
        '3',
        '--yes',
      ])
      expect(given.body).toMatchObject({ limit: 3 })
    })

    it('documents the cap as the contract states it, without the pager default', () => {
      for (const command of ['batch-delete', 'batch-update']) {
        const help = commandAt('tables', 'rows', command).helpInformation()
        expect(help).toContain('Maximum matching rows to')
        expect(help).not.toContain('Maximum items to return')
        expect(help).not.toMatch(/--limit[^\n]*default/)
        // The help block wraps, so the sentence is matched across the break.
        expect(help).toMatch(/caps a --filter\s+match only/)
        expect(help).toMatch(/0\s+is not accepted/)
      }
    })

    it('refuses a cap typed alongside the id list that supersedes it', async () => {
      await expect(
        run([
          'tables',
          'rows',
          'batch-delete',
          'tbl_1',
          '--row',
          'row_1',
          'row_2',
          '--limit',
          '1',
          '--yes',
        ])
      ).rejects.toThrow(/--limit caps a --filter match .* --row list; pass one, not both/)
      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('still deletes an explicit id list, with no cap on the wire', async () => {
      const [, options] = await run([
        'tables',
        'rows',
        'batch-delete',
        'tbl_1',
        '--row',
        'row_1',
        'row_2',
        '--yes',
      ])
      expect(options.body).toMatchObject({ rowIds: ['row_1', 'row_2'] })
      expect(options.body).not.toHaveProperty('limit')
    })

    /**
     * The help says "0 is not accepted" and the CLI sent it anyway: `0`, `-1`
     * and `1.5` all reached the wire to be refused by the route.
     */
    it('refuses a row cap the help already documents as invalid', async () => {
      for (const [value, message] of [
        ['0', '--limit must be 1 or more'],
        ['-1', '--limit must be 1 or more'],
        ['1.5', '--limit must be a whole number'],
        // Above 2^52 the parse itself drops the fraction, so `Number.isInteger`
        // alone would pass this and send a value the caller never typed.
        ['4503599627370496.5', '--limit must be a whole number'],
      ] as const) {
        for (const command of ['batch-delete', 'batch-update'] as const) {
          const argv = ['tables', 'rows', command, 'tbl_1', '--filter', '{"all":[]}']
          if (command === 'batch-update') argv.push('--data', '{"a":1}')
          argv.push('--limit', value, '--yes')
          await expect(run(argv)).rejects.toThrow(message)
        }
      }
      expect(mockRequest).not.toHaveBeenCalled()
    })

    /**
     * The route decides this with a refine whose message describes the opposite
     * mistake when neither flag is typed — and half in wire names.
     */
    it('requires exactly one of the two ways to choose the rows', async () => {
      await expect(run(['tables', 'rows', 'batch-delete', 'tbl_1', '--yes'])).rejects.toThrow(
        '--filter or --row is required to choose the rows to delete'
      )
      await expect(
        run([
          'tables',
          'rows',
          'batch-delete',
          'tbl_1',
          '--filter',
          '{"all":[]}',
          '--row',
          'row_1',
          '--yes',
        ])
      ).rejects.toThrow('--filter and --row choose the rows to delete two different ways')
      expect(mockRequest).not.toHaveBeenCalled()
    })
  })

  /**
   * `--limit` on a cursor-paginated operation is a client-side total, stripped
   * from the request while the CLI walks the pages — so `--limit 0` reached the
   * whole table with run state attached as many individually-legal pages, which
   * is what the route's own `limit: 0` refusal exists to prevent.
   */
  /**
   * An `integer` field said so in the contract, and the refusal was left to the
   * server — which answered in library wording naming neither the flag nor the
   * value.
   */
  it('refuses a fractional or unrepresentable value on an integer flag', async () => {
    await expect(run(['files', 'read', 'file_1', '--max-bytes', '5.5'])).rejects.toThrow(
      '--max-bytes must be a whole number'
    )
    await expect(
      run(['files', 'read', 'file_1', '--max-bytes', '999999999999999999999'])
    ).rejects.toThrow('--max-bytes is outside the whole-number range the API accepts')
    expect(mockRequest).not.toHaveBeenCalled()
  })

  /**
   * `--workspace` is a root-program global, so commander accepts it everywhere
   * while only an operation declaring `workspaceId` ever uses it. On the rest it
   * was parsed and dropped, and three different values produced byte-identical
   * requests.
   */
  /**
   * `activate create` is the deployed cutover addressed by version, the same
   * production change `rollback` and `undeploy` both gate. `deploy` stays
   * ungated: it publishes the draft as a NEW version, which is the forward
   * action the caller asked for and which a rollback undoes.
   */
  /**
   * `--all-workspaces` reaches the wire as the absence of `workspaceId`, so a
   * workspace key answered with its own workspace's figures and exit 0.
   */
  it('still gives paginated lists their numeric --limit', async () => {
    const [, options] = await run(['files', 'list', '--limit', '7'])
    expect(options.query).toMatchObject({ limit: 7 })
  })
})

describe('spellings the CLI has retired', () => {
  beforeEach(() => {
    resetRenameWarnings()
  })

  function warnings(): string[] {
    const written: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk))
      return true
    })
    return written
  }

  it('still answers to a command path that moved between groups', async () => {
    // `tables count create` counted rows and created nothing, so it became
    // `tables rows count`. A script written against the old path predates the
    // rename and has no way to know.
    const written = warnings()
    const [path, options] = await run(
      ['tables', 'count', 'create', 'tbl_1', '--filter', '{"all":[]}'],
      { data: { totalCount: 0 } }
    )
    expect(path).toBe('/api/v2/tables/tbl_1/query/count')
    expect(options.body).toMatchObject({ predicate: { all: [] } })
    expect(written.join('')).toContain('"sim tables count create" has been renamed')
  })

  it('still answers to a path whose group became the command itself', async () => {
    // The hardest shape: `files restore create` retired in favour of `files
    // restore`, so the old path needs a `create` *under* a command that now
    // takes `<fileId>` there. Commander matches the subcommand before the
    // positional, which is what makes both spellings reachable.
    const written = warnings()
    const [path] = await run(['files', 'restore', 'create', 'wf_1'], { data: { id: 'wf_1' } })
    expect(path).toBe('/api/v2/files/wf_1/restore')
    expect(written.join('')).toContain('"sim files restore create" has been renamed')

    const [current] = await run(['files', 'restore', 'wf_1'], { data: { id: 'wf_1' } })
    expect(current).toBe('/api/v2/files/wf_1/restore')
  })

  it('keeps retired spellings out of help', () => {
    // A retired name exists for scripts, not for readers: surfacing it in help
    // would teach the spelling being retired. Commander still lists a hidden
    // command in `.commands`, so this asks what help itself would print.
    const visible = (command: Command) =>
      command.commands
        .filter((child) => (child as Command & { _hidden?: boolean })._hidden !== true)
        .map((child) => child.name())

    expect(visible(commandAt('tables'))).not.toContain('count')
    expect(visible(commandAt('workflows', 'deployment'))).not.toContain('list')
    expect(visible(commandAt('files', 'restore'))).toEqual([])
    expect(
      commandAt('tables', 'rows', 'count')
        .options.filter((option) => !option.hidden)
        .map((option) => option.flags)
    ).not.toContain('--predicate <json|@file>')
  })

  it('folds a retired flag onto its current name', async () => {
    const written = warnings()
    const [, options] = await run(['tables', 'rows', 'find', 'tbl_1', '--q', 'needle'], {
      data: { matches: [] },
    })
    expect(options.body).toMatchObject({ q: 'needle' })
    expect(written.join('')).toContain('"--q" has been renamed to "--query"')
  })

  it('refuses both spellings of one flag rather than picking a winner', async () => {
    await expect(
      run([
        'tables',
        'rows',
        'count',
        'tbl_1',
        '--predicate',
        '{"all":[]}',
        '--filter',
        '{"any":[]}',
      ])
    ).rejects.toThrow('--predicate is the former name of --filter; pass one, not both')
  })

  it('still requires a renamed-but-required field, naming its current spelling', async () => {
    // The current flag cannot be commander-mandatory or the retired spelling
    // would be rejected before it could be folded, so the requirement is raised
    // downstream instead. It must still be raised.
    await expect(run(['tables', 'rows', 'find', 'tbl_1'])).rejects.toThrow('--query is required')
  })

  it('never lets a retired path shadow a live command', () => {
    const seen = new Map<string, boolean>()
    const walk = (command: Command, prefix: string[]) => {
      for (const child of command.commands) {
        const path = [...prefix, child.name()].join(' ')
        const hidden = (child as Command & { _hidden?: boolean })._hidden === true
        // Commander resolves a duplicate name to whichever was registered
        // first, so a retired path sharing a live command's name would make the
        // live one unreachable.
        expect(seen.has(path) && !hidden).toBe(false)
        seen.set(path, hidden)
        walk(child, [...prefix, child.name()])
      }
    }
    walk(program(), [])
  })
})

describe('flags the root program would swallow', () => {
  /**
   * Commander matches the root's own options anywhere in argv, including after a
   * subcommand name, so a leaf declaring one never sees it: `sim workflows
   * rollback 00000000-0000-4000-8000-00000000000a --version 1` printed the CLI version and exited 0 without
   * issuing a request — a rollback that silently did nothing, with no output to
   * tell anyone. The generic sweep is the point; the rollback assertion below
   * only records the one case that got through.
   */
  it('declares no leaf flag the root program already owns', () => {
    const walk = (command: Command) => {
      for (const option of command.options) {
        expect([option.long, option.short].filter(Boolean)).not.toContain('--version')
        expect([option.long, option.short].filter(Boolean)).not.toContain('-V')
        expect([option.long, option.short].filter(Boolean)).not.toContain('--help')
        expect([option.long, option.short].filter(Boolean)).not.toContain('-h')
      }
      command.commands.forEach(walk)
    }
    walk(program())
  })

  it('exposes the rollback target version under a name of its own', async () => {
    const [path, init] = await run(
      [
        'workflows',
        'rollback',
        '00000000-0000-4000-8000-00000000000a',
        '--to-version',
        '3',
        '--yes',
      ],
      {
        data: {},
      }
    )

    expect(path).toBe('/api/v2/workflows/00000000-0000-4000-8000-00000000000a/rollback')
    expect(init.body).toMatchObject({ version: 3 })
  })
})

describe('a leaf that only gained hidden renamed children', () => {
  /**
   * Commander derives the usage line from `commands.length` alone, so hanging
   * the retired `files restore create` under the live `files restore` leaf made
   * it the only leaf of the surface advertising a `[command]` slot with nothing
   * visible to put in it.
   */
  it('does not advertise a subcommand slot', () => {
    const files = program().commands.find((command) => command.name() === 'files')
    const restore = files?.commands.find((command) => command.name() === 'restore')

    expect(restore?.usage()).not.toContain('[command]')
    expect(restore?.usage()).toContain('<fileId>')
  })

  it('still routes the retired spelling', async () => {
    const [path] = await run(['files', 'restore', 'create', 'wf_file_1'], { data: {} })

    expect(path).toContain('wf_file_1')
  })
})

describe('headers the route contract declares', () => {
  /**
   * `x-run-id` is the only contract header a visible command exposes: the upload
   * token is a per-transfer credential the CLI never prints, so its flags are
   * omitted and `sim files uploads get` is hidden. Required-header handling is
   * covered against `buildRequest` in `request.test.ts`, which reaches a hidden
   * operation the assembled tree no longer offers.
   */
  it('sends a declared header when the flag is passed, and omits the slot when it is not', async () => {
    const [, sent] = await run(
      ['workflows', 'run', '00000000-0000-4000-8000-00000000000a', '--run-id', 'run_mine'],
      {
        data: { status: 'completed' },
      }
    )
    expect(sent.headers).toEqual({ 'x-run-id': 'run_mine' })

    const [, unset] = await run(['workflows', 'run', '00000000-0000-4000-8000-00000000000a'], {
      data: { status: 'completed' },
    })
    expect(unset.headers).toBeUndefined()
  })

  it('sends no headers for an operation whose contract declares none', async () => {
    // Paired with an operation that does declare one, so the absence below means
    // "declares none" rather than "never sends headers".
    const [, sent] = await run(
      ['workflows', 'run', '00000000-0000-4000-8000-00000000000a', '--run-id', 'run_mine'],
      {
        data: { status: 'completed' },
      }
    )
    expect(sent.headers).toEqual({ 'x-run-id': 'run_mine' })

    const [, options] = await run(['tables', 'list'])
    expect(options.headers).toBeUndefined()
  })

  /**
   * The call-chain marker is Sim's own; a CLI invocation is always the first
   * hop, so a flag for it could only forge a chain the caller was never in.
   */
  it('does not expose the call-chain header Sim writes for itself', async () => {
    await expect(
      run(
        [
          'workflows',
          'run',
          '00000000-0000-4000-8000-00000000000a',
          '--x-sim-via',
          '00000000-0000-4000-8000-000000000000',
        ],
        { data: { status: 'completed' } }
      )
    ).rejects.toThrow(/unknown option/)
  })

  /**
   * The run-uniqueness claim is the caller's to make, so it is exposed — but
   * under its domain name. `--x-run-id` would be the only flag in the CLI
   * spelled as a raw HTTP header.
   */
  it('exposes the run-id header under a domain name, not its wire spelling', async () => {
    const [, options] = await run(
      ['workflows', 'run', '00000000-0000-4000-8000-00000000000a', '--run-id', 'run_mine'],
      {
        data: { status: 'completed' },
      }
    )
    expect(options.headers).toEqual({ 'x-run-id': 'run_mine' })

    await expect(
      run(['workflows', 'run', '00000000-0000-4000-8000-00000000000a', '--x-run-id', 'run_mine'], {
        data: { status: 'completed' },
      })
    ).rejects.toThrow(/unknown option/)
  })

  /**
   * A header field reaching a command under its wire spelling is a generator
   * output nobody decided on. Every other flag in the CLI is a domain name, so
   * the sweep is over the whole assembled tree rather than the one header that
   * got through.
   *
   * The rule is the spelling, not the provenance: `--run-id` is derived from
   * `x-run-id` and is a deliberate, documented flag, so it passes. What fails is
   * a flag typed exactly as the header is written on the wire, which is what a
   * generator emits when nobody named the field. Sweeping for an `x-` prefix
   * instead of the declared header names is what let `--upload-token` through.
   */
  it('exposes no flag spelled as a raw HTTP header', () => {
    expect([...HEADER_WIRE_FLAGS].sort()).toEqual(['--upload-token', '--x-run-id', '--x-sim-via'])
    expect(wireSpelledFlags(buildProgram())).toEqual([])

    const workflowRun = buildProgram()
      .commands.find((command) => command.name() === 'workflows')
      ?.commands.find((command) => command.name() === 'run')
    expect(workflowRun?.options.some((option) => option.long === '--run-id')).toBe(true)
  })

  /**
   * The leak the `x-` sweep missed. `getFileUpload` is hidden now, so the tree
   * no longer carries the flag; rebuilding the leaf's options from the same
   * contract entry it had before that decision is the pre-fix surface, and the
   * sweep has to fail on it.
   */
  it('catches a header spelled without an x- prefix', () => {
    const leaf = new Command('upload')
    addOperationOptions(leaf, 'getFileUpload', {}, V2_OPERATIONS.getFileUpload as OperationSpec)

    expect(wireSpelledFlags(leaf)).toEqual(['upload --upload-token'])
  })

  /**
   * `buildGeneratedCommands` sees only what the operation table produces, so a
   * hand-attached command could carry a wire-spelled flag past the guard whose
   * whole job is to catch one. The sweep runs on the assembled program instead.
   */
  it('covers commands attached by hand, not just generated ones', () => {
    const program = buildProgram()
    program.addCommand(new Command('widgets').option('--upload-token <token>', 'Signed token'))

    expect(wireSpelledFlags(program)).toEqual(['sim widgets --upload-token'])
  })
})

describe('flags the root program already owns', () => {
  /**
   * The per-operation guard runs inside `configureOperation`, so it sees only
   * generated leaves: a hand-attached command, or an option added to a leaf
   * after it is built, was never checked. The assembled tree is what covers
   * both, which is why the sweep runs on the finished program.
   */
  it('accepts the program as assembled', () => {
    expect(() => buildProgram()).not.toThrow()
  })

  it('refuses a hand-attached command that redeclares a root value flag', () => {
    const program = buildProgram()
    program.addCommand(new Command('widgets').option('--endpoint <url>', 'Where to send it'))

    expect(() => assertNoReservedProgramFlags(program)).toThrow(/--endpoint/)
  })

  /**
   * `profiles add` declares `-w, --workspace` for its help text and reads the
   * root's value in its action, so the collision is deliberate and inert.
   */
  it('exempts the one command that redeclares a root flag on purpose', () => {
    const program = buildProgram()
    const add = program.commands
      .find((command) => command.name() === 'profiles')
      ?.commands.find((command) => command.name() === 'add')

    expect(add?.options.some((option) => option.long === '--workspace')).toBe(true)
    expect(() => assertNoReservedProgramFlags(program)).not.toThrow()
  })
})

describe('the billing ledger a key can see', () => {
  /**
   * The defect was silence, not the scoping: a user credential reports the
   * caller's own events and a workspace key the whole workspace ledger, and the
   * two answers were indistinguishable — same workspace, same window, same
   * flags, a strictly smaller result and nothing saying why.
   */
  it('states the scope once, on stderr, in every format', async () => {
    const rows = [
      { id: 'ev_1', createdAt: '2026-08-01T00:00:00.000Z', source: 'workflow', creditCost: 1 },
    ]

    for (const format of ['table', 'text', 'json'] as const) {
      const errors: string[] = []
      const written = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          errors.push(String(chunk))
          return true
        })
      output.format = format
      try {
        await run(['billing', 'logs'], { data: rows, nextCursor: null, scope: 'workspace' })
      } finally {
        output.format = 'json'
        written.mockRestore()
      }

      expect(errors.join('')).toContain('scope: workspace')
    }
  })

  /**
   * `text` is positional and scripts cut fields from it, so the note must not
   * reach stdout: the rows have to stay exactly the rows.
   */
  it('leaves the parsed rows untouched', async () => {
    const lines: string[] = []
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({
      data: [
        { id: 'ev_1', createdAt: '2026-08-01T00:00:00.000Z', source: 'workflow', creditCost: 1 },
      ],
      nextCursor: null,
      scope: 'workspace',
    })
    const logged = vi
      .spyOn(console, 'log')
      .mockImplementation((line: string) => lines.push(line) as unknown as undefined)
    const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    output.format = 'text'
    try {
      await program().parseAsync(['node', 'sim', 'billing', 'logs'])
    } finally {
      output.format = 'json'
      logged.mockRestore()
      written.mockRestore()
    }

    expect(lines).toHaveLength(1)
    expect(lines[0].split('\t')[2]).toBe('workflow')
  })
})

describe('a list that is not the whole answer', () => {
  /** Captures stderr for one invocation, in one output format. */
  async function noteFor(
    format: 'table' | 'text' | 'json' | 'yaml',
    argv: string[],
    response: unknown
  ): Promise<string> {
    const errors: string[] = []
    const written = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        errors.push(String(chunk))
        return true
      })
    output.format = format
    try {
      await run(argv, response)
    } finally {
      output.format = 'json'
      written.mockRestore()
    }
    return errors.join('')
  }

  it('does not announce remaining pages in any format', async () => {
    for (const format of ['table', 'text', 'json', 'yaml'] as const) {
      const note = await noteFor(format, ['tools', 'list', '--limit', '2'], {
        data: [{ id: 'a' }, { id: 'b' }],
        nextCursor: 'c1',
      })

      expect(note).toBe('')
    }
  })

  it('says nothing when the list is complete', async () => {
    const note = await noteFor('table', ['tools', 'list', '--limit', '2'], {
      data: [{ id: 'a' }, { id: 'b' }],
      nextCursor: null,
    })

    expect(note).not.toContain('more results exist')
  })

  /**
   * The server clips an inventory itself and says so on the envelope, which the
   * CLI reports separately from data and nextCursor so a reconciling caller
   * can distinguish a clipped inventory from a complete one.
   */
  it('carries a truncation the server stated on the envelope', async () => {
    const paged = await noteFor('json', ['workflow-mcp-servers', 'list'], {
      data: [{ id: 'srv_1' }],
      nextCursor: null,
      toolNamesTruncated: true,
    })
    expect(paged).toContain('tool names truncated')

    const unpaged = await noteFor('json', ['workflow-mcp-servers', 'tools', 'list', 'srv_1'], {
      data: [{ toolName: 't' }],
      nextCursor: null,
      truncated: true,
    })
    expect(unpaged).toContain('truncated')
  })

  it('says nothing when the server states the list is whole', async () => {
    const note = await noteFor('json', ['workflow-mcp-servers', 'list'], {
      data: [{ id: 'srv_1' }],
      nextCursor: null,
      toolNamesTruncated: false,
    })

    expect(note).not.toContain('truncated')
  })

  /** A flag raised on a later page is the same fact, and used to be lost. */
  it('carries a truncation stated on a page after the first', async () => {
    mockRequest.mockReset()
    mockRequest
      .mockResolvedValueOnce({ data: [{ id: 'a' }], nextCursor: 'c1', toolNamesTruncated: false })
      .mockResolvedValueOnce({ data: [{ id: 'b' }], nextCursor: null, toolNamesTruncated: true })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const errors: string[] = []
    const written = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        errors.push(String(chunk))
        return true
      })

    try {
      await program().parseAsync(['node', 'sim', 'workflow-mcp-servers', 'list', '--limit', '0'])
    } finally {
      written.mockRestore()
    }

    expect(errors.join('')).toContain('tool names truncated')
  })

  it('includes the remaining cursor alongside the rows', async () => {
    const lines: string[] = []
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c1' })
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    await program().parseAsync(['node', 'sim', 'tools', 'list', '--limit', '2'])

    expect(JSON.parse(lines.join('\n'))).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      nextCursor: 'c1',
    })
  })
})
