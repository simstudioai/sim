import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from './build'
import { resetRenameWarnings } from './renamed'

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
        if (!profileState.workspaceId) throw new Error('workspace required')
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
  return mockRequest.mock.calls[0]
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

  it('registers singular aliases for every plural resource group', () => {
    const aliases = {
      'audit-logs': 'audit-log',
      credentials: 'credential',
      'custom-tools': 'custom-tool',
      files: 'file',
      knowledge: 'kb',
      logs: 'log',
      'mcp-servers': 'mcp-server',
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
    expect(errorOutput).toContain("error: missing required argument 'id'")
    expect(errorOutput).toContain('Example: sim skills update <id>')
    expect(errorOutput).not.toContain('--id')
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
    await expect(run(['billing', 'status'])).rejects.toThrow('workspace required')
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

    const [workflowPath, workflowOptions] = await run(['workflow', 'mv', 'wf_1', 'Archive'])
    expect(workflowPath).toBe('/api/v2/workflows/wf_1')
    expect(workflowOptions.body).toEqual({ folderPath: 'Archive' })

    const [knowledgePath, knowledgeOptions] = await run(['kb', 'mv', 'kb_1', 'Archive'])
    expect(knowledgePath).toBe('/api/v2/knowledge/kb_1')
    expect(knowledgeOptions.body).toEqual({ workspaceId: 'ws_local', folderPath: 'Archive' })

    const [, updateOptions] = await run(['workflow', 'update', 'wf_1', '--description', 'Updated'])
    expect(updateOptions.body).toEqual({ description: 'Updated' })

    const moveHelp = commandAt('workflows', 'mv').helpInformation()
    expect(moveHelp).toContain('<id> <folder>')
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

    profileState.workspaceId = null
    await expect(run(['workspace', 'get'])).rejects.toThrow(
      'No workspace set. Pass --workspace, or run: sim configure --set-workspace <id>'
    )
    profileState.workspaceId = 'ws_local'

    const membersHelp = commandAt('workspaces', 'members').helpInformation()
    expect(membersHelp).not.toContain('<workspaceId>')

    const [membersPath, membersOptions] = await run(['workspace', 'members'])
    expect(membersPath).toBe('/api/v2/workspaces/ws_local/members')
    expect(membersOptions.query).toEqual({ limit: 100, cursor: null })
  })

  it('comma-joins a repeated list flag', async () => {
    const [, options] = await run(['logs', 'list', '--workflow', 'wf_1', 'wf_2'])
    expect(options.query).toMatchObject({ workflowIds: 'wf_1,wf_2' })
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
    expect(help).toContain('blockName.field')
    expect(help).toContain('agent_1.content')
    expect(help).not.toContain('--output <value...>')

    const [, withoutInput] = await run(['workflows', 'run', 'wf_1'], { data: { success: true } })
    expect(withoutInput.body).toEqual({})

    const [, selected] = await run(
      ['workflows', 'run', 'wf_1', '--select-output', 'agent.answer', 'save.result'],
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
  })

  it('advertises the file-content encoding choices', () => {
    expect(commandAt('files', 'set-content').helpInformation()).toMatch(
      /--encoding.*utf-8.*base64/s
    )
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
      'wf_1',
      '--include-output',
      '--select-output',
      'agent.content',
      'writer.text',
    ])
    expect(path).toBe('/api/v2/workflows/wf_1/runs/run_1')
    expect(options.query).toEqual({
      includeOutput: true,
      selectedOutputs: 'agent.content,writer.text',
    })

    const [listPath] = await run(['workflows', 'runs', 'list', '--workflow', 'wf_1'])
    expect(listPath).toBe('/api/v2/workflows/wf_1/runs')

    const [cancelPath] = await run(['workflows', 'runs', 'cancel', 'run_1', '--workflow', 'wf_1'])
    expect(cancelPath).toBe('/api/v2/workflows/wf_1/runs/run_1/cancel')

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
      'wf_1',
      '--context',
      'ctx_1',
      '--input',
      '{"approved":true}',
    ])
    expect(resumePath).toBe('/api/v2/workflows/wf_1/runs/run_1/resume')
    expect(resumeOptions.body).toEqual({
      contextId: 'ctx_1',
      input: { approved: true },
    })
  })

  it('supports organization-wide audit listing explicitly', async () => {
    const help = commandAt('audit-logs', 'list').helpInformation()
    expect(help).toMatch(/--organization <value>.*personal API key required.*required/s)
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
    expect(commandAt('workflows', 'run').description()).toBe('Run a deployed workflow')
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
      ['workflows', 'get', 'wf_1'],
      { id: 'wf_1', name: 'Onboarding', inputs: [{ name: 'email', type: 'string' }] },
      'text'
    )

    expect(printed.join('\n')).toMatch(/inputs/)
    expect(printed.join('\n')).toMatch(/email/)
  })

  it('truncates a nested value in the table, and only there', async () => {
    const payload = { id: 'wf_1', state: { blocks: 'x'.repeat(5000) } }

    const table = await lines(['workflows', 'get', 'wf_1'], payload, 'table')
    const clamped = table.find((line) => line.startsWith('state')) ?? ''
    expect(clamped.length).toBeLessThan(300)
    expect(clamped).toMatch(/…$/)

    // `text` is the format built for pipes, so it carries the whole value: the
    // clamp is a legibility cap on the human table, and clamping before the
    // format branch silently truncated commands whose output is one long value.
    const piped = await lines(['workflows', 'get', 'wf_1'], payload, 'text')
    const whole = piped.find((line) => line.startsWith('state')) ?? ''
    expect(whole).toContain('x'.repeat(5000))
  })

  it('emits a document command as JSON whatever the display format is', async () => {
    // Redirecting this to a file has to yield something `import` accepts, so
    // `table`/`text` — which flatten and truncate — must not be honoured here.
    const printed = await lines(
      ['workflows', 'export', 'wf_1'],
      { version: '1.0', exportedAt: 'now', workflow: { id: 'wf_1' }, state: { blocks: {} } },
      'text'
    )

    expect(JSON.parse(printed.join('\n'))).toEqual({
      version: '1.0',
      exportedAt: 'now',
      workflow: { id: 'wf_1' },
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
    expect(JSON.parse(lines[0])).toEqual([{ id: 'r1' }, { id: 'r2' }])
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

  it('uses a valid per-page size for unlimited and large totals', async () => {
    for (const requested of ['0', '250']) {
      mockRequest.mockReset()
      mockRequest.mockResolvedValue({ data: [], nextCursor: null })
      vi.spyOn(console, 'log').mockImplementation(() => {})

      await program().parseAsync(['node', 'sim', 'files', 'list', '--limit', requested])

      expect(mockRequest.mock.calls[0][1].query.limit).toBe(100)
    }
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
      '{"type":"rows","max":5}',
    ])
    expect(given.body).toMatchObject({ limit: { type: 'rows', max: 5 } })
  })

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
