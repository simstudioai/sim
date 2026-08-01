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

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))

vi.mock('../context.js', () => ({
  clientFrom: () => ({
    client: { request: mockRequest, requireWorkspace: () => 'ws_local' },
    profile: { workspaceId: 'ws_local', output: 'json', name: 'default', apiKey: 'k' },
  }),
}))

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands(new Set())) root.addCommand(group)
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
