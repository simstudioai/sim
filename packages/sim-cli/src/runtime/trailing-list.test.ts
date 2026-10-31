import { describe, expect, it } from 'vitest'
import { runEmbeddedCli } from '../embed'

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }

/** Runs one embedded invocation, recording each request body it sends. */
async function run(argv: string[]) {
  const bodies: unknown[] = []
  const result = await runEmbeddedCli(argv, {
    ...identity,
    transport: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ data: { deletedItems: { files: 2 } } })
    },
  })
  return { ...result, bodies }
}

describe('files batch-delete ids as trailing arguments', () => {
  it('sends ids given as arguments exactly as it sends --file-ids', async () => {
    const trailing = await run(['files', 'batch-delete', 'wf_a', 'wf_b', '--yes'])
    const flagged = await run(['files', 'batch-delete', '--file-ids', 'wf_a', 'wf_b', '--yes'])
    expect(trailing.exitCode).toBe(0)
    expect(trailing.bodies).toEqual([{ workspaceId: 'workspace', fileIds: ['wf_a', 'wf_b'] }])
    expect(flagged.bodies).toEqual(trailing.bodies)
  })

  it('refuses both forms at once, and neither, before any request', async () => {
    const both = await run(['files', 'batch-delete', 'wf_a', '--file-ids', 'wf_b', '--yes'])
    expect(both.exitCode).toBe(1)
    expect(both.stderr).toContain('as arguments or with --file-ids, not both')
    const neither = await run(['files', 'batch-delete', '--yes'])
    expect(neither.exitCode).toBe(1)
    expect(neither.stderr).toContain('--file-ids is required')
    expect([...both.bodies, ...neither.bodies]).toEqual([])
  })

  it('keeps the destructive confirmation for ids given as arguments', async () => {
    const unconfirmed = await run(['files', 'batch-delete', 'wf_a'])
    expect(unconfirmed.exitCode).toBe(1)
    expect(unconfirmed.stderr).toContain('Re-run with --yes to confirm')
    expect(unconfirmed.bodies).toEqual([])
  })
})
