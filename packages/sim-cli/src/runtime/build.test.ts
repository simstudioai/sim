import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from './build.js'

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

const { mockRequest, output } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  output: { format: 'json' },
}))

vi.mock('../context.js', () => ({
  clientFrom: () => ({
    client: { request: mockRequest, requireWorkspace: () => 'ws_local' },
    profile: { workspaceId: 'ws_local', output: output.format, name: 'default', apiKey: 'k' },
  }),
}))

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands(new Set())) root.addCommand(group)
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

async function run(argv: string[]) {
  mockRequest.mockReset()
  mockRequest.mockResolvedValue({ data: [], nextCursor: null })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await program().parseAsync(['node', 'sim', ...argv])
  return mockRequest.mock.calls[0]
}

describe('commands parsed through commander', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('carries a multi-word flag all the way to the request', async () => {
    // The regression: commander stores this as `minDurationMs`, so a lookup by
    // `min-duration-ms` found nothing and the filter never reached the API.
    const [, options] = await run(['logs', 'list', '--min-duration-ms', '250'])
    expect(options.query).toMatchObject({ minDurationMs: 250 })
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
      '--execution-id',
      'exec_1',
    ])
    expect(options.query).toMatchObject({
      minDurationMs: 10,
      maxDurationMs: 20,
      minCost: 1,
      executionId: 'exec_1',
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

  it('refuses a destructive command without --yes, before any request', async () => {
    await expect(run(['tables', 'rows', 'batch-delete', 'tbl_1', '--row', 'a'])).rejects.toThrow(
      /cannot be undone/
    )
    expect(mockRequest).not.toHaveBeenCalled()
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

  it('truncates a nested value rather than flooding the terminal', async () => {
    const printed = await lines(
      ['workflows', 'get', 'wf_1'],
      { id: 'wf_1', state: { blocks: 'x'.repeat(5000) } },
      'text'
    )

    const stateLine = printed.find((line) => line.startsWith('state')) ?? ''
    expect(stateLine.length).toBeLessThan(300)
    expect(stateLine).toMatch(/…$/)
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
})

describe('boolean flags', () => {
  it('takes an explicit value when the field is required', async () => {
    // As a presence-only flag this could only ever send `true`: `--is-active
    // false` turned sharing ON and reported success, with the `false` dropped
    // as a stray argument.
    const [, options] = await run([
      'files',
      'share',
      'set',
      'f_1',
      '--is-active',
      'false',
      '--auth-type',
      'public',
    ])
    expect(options.body).toMatchObject({ isActive: false })

    const [, on] = await run([
      'files',
      'share',
      'set',
      'f_1',
      '--is-active',
      'true',
      '--auth-type',
      'public',
    ])
    expect(on.body).toMatchObject({ isActive: true })
  })

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
      '--body',
      '{"rows":[{"city":"Paris"}]}',
    ])

    expect(path).toBe('/api/v2/tables/tbl_1/rows')
    // Both branches require `workspaceId`, and it comes from the profile.
    expect(options.body).toEqual({ workspaceId: 'ws_local', rows: [{ city: 'Paris' }] })
  })

  it('lets the caller override a shared field', async () => {
    const [, options] = await run([
      'tables',
      'rows',
      'create',
      'tbl_1',
      '--body',
      '{"workspaceId":"ws_other","rows":[]}',
    ])
    expect(options.body).toMatchObject({ workspaceId: 'ws_other' })
  })

  it('refuses a union body that is not an object', async () => {
    await expect(run(['tables', 'rows', 'create', 'tbl_1', '--body', '[1,2]'])).rejects.toThrow(
      /--body must be a JSON object/
    )
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
