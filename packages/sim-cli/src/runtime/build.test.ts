import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { V2_OPERATIONS } from '../generated/v2-api'
import { SimApiError } from '../http/client'
import { buildProgram } from '../program'
import { assertNoReservedProgramFlags, buildGeneratedCommands } from './build'
import { kebab } from './derive'
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

  describe('organization access-request decisions', () => {
    it('rejects flags from another decision branch before calling the API', async () => {
      await expect(
        run([
          'organizations',
          'access-requests',
          'resolve',
          'request-1',
          '--organization',
          'org-1',
          '--action',
          'decline',
          '--reason',
          'Not needed',
          '--expected-fingerprint',
          'preview',
        ])
      ).rejects.toThrow('--expected-fingerprint is not available when --action is decline')
      expect(mockRequest).not.toHaveBeenCalled()
    })
  })

  describe('organization member credit caps', () => {
    it.each([
      ['100', 100],
      ['0', 0],
      ['null', null],
    ] as const)('sends --credit-limit %s without changing its meaning', async (value, expected) => {
      profileState.workspaceId = null
      const [path, options] = await run(
        [
          'organizations',
          'members',
          'usage-limit',
          'update',
          'user-1',
          '--organization',
          'org-1',
          '--credit-limit',
          value,
        ],
        { data: { creditLimit: expected } }
      )
      expect(path).toBe('/api/v2/organizations/org-1/members/user-1/usage-limit')
      expect(options.body).toEqual({ creditLimit: expected })
    })

    it.each(['many', '1.5', 'Infinity', ''])(
      'rejects an invalid credit cap %s before sending',
      async (value) => {
        await expect(
          run([
            'organizations',
            'members',
            'usage-limit',
            'update',
            'user-1',
            '--organization',
            'org-1',
            '--credit-limit',
            value,
          ])
        ).rejects.toThrow(/--credit-limit/)
        expect(mockRequest).not.toHaveBeenCalled()
      }
    )
  })

  describe('permission groups', () => {
    it('requires confirmation to delete a group', async () => {
      await expect(
        run(['permission-groups', 'delete', 'group-1', '--organization', 'org-1'])
      ).rejects.toThrow(/--yes/)
      expect(mockRequest).not.toHaveBeenCalled()
      const [path, options] = await run(
        ['permission-groups', 'delete', 'group-1', '--organization', 'org-1', '--yes'],
        { data: { id: 'group-1', deleted: true } }
      )
      expect(path).toBe('/api/v2/organizations/org-1/permission-groups/group-1')
      expect(options.method).toBe('DELETE')
    })
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
  })

  /**
   * ~59 v2 operations refuse a workspace API key. The restriction is stated in
   * the OpenAPI description, and before the generator carried it into the
   * operation table `--help` advertised them identically to their
   * workspace-key-capable siblings — the caller met the rule as a `403` only
   * after the request had gone out.
   */
  describe('a command whose operation refuses a workspace API key', () => {
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

  it('injects the profile workspace without a flag', async () => {
    const [, options] = await run(['tables', 'list'])
    expect(options.query).toMatchObject({ workspaceId: 'ws_local' })
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

  it('prints the API data verbatim for machine output, envelope included', async () => {
    // `--output json` is what scripts and the agent reference card (generated from the
    // OpenAPI response shapes) consume: the single-key unwrap above is a table-only
    // convenience, so JSON keeps `mcpServer` exactly as the API returned it.
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
      'json'
    )

    expect(JSON.parse(printed.join('\n'))).toEqual({
      mcpServer: { id: 'mcp-1', name: 'Deepwiki', enabled: true },
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

  it('requires exactly one row-body form', async () => {
    await expect(run(['tables', 'rows', 'create', 'tbl_1'])).rejects.toThrow(
      /exactly one of --data or --rows/
    )
    await expect(
      run(['tables', 'rows', 'create', 'tbl_1', '--data', '{}', '--rows', '[]'])
    ).rejects.toThrow(/exactly one of --data or --rows/)
  })

  /**
   * The route's cap is an object holding exactly one free value, because its
   * `type` is a `z.literal('rows')` — so the wire shape was four tokens of
   * ceremony to say a number the caller already had.
   */
  describe('the dispatch row cap is typed as the count it reads as', () => {
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
})

describe('flags the root program already owns', () => {
  it('refuses a hand-attached command that redeclares a root value flag', () => {
    const program = buildProgram()
    program.addCommand(new Command('widgets').option('--endpoint <url>', 'Where to send it'))

    expect(() => assertNoReservedProgramFlags(program)).toThrow(/--endpoint/)
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
})
