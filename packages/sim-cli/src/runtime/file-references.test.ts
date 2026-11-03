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

/** The file references one batch-delete invocation sends. */
async function sentFileIds(argv: string[]) {
  const result = await run(['files', 'batch-delete', ...argv, '--yes'])
  expect(result.stderr).toBe('')
  return result.bodies.map((body) => (body as { fileIds: string[] }).fileIds)
}

describe('files batch-delete reads the references a caller writes', () => {
  it('answers to --ids and --paths as it does to --file-ids', async () => {
    expect(await sentFileIds(['--ids', 'wf_a', 'wf_b'])).toEqual([['wf_a', 'wf_b']])
    expect(await sentFileIds(['--paths', 'files/a.png', 'files/qc/b.png'])).toEqual([
      ['files/a.png', 'files/qc/b.png'],
    ])
  })

  it('reads a comma-joined run of ids, or a JSON array, as its entries', async () => {
    expect(await sentFileIds(['--ids', 'wf_a,wf_b, wf_c'])).toEqual([['wf_a', 'wf_b', 'wf_c']])
    expect(await sentFileIds(['--file-ids', '["wf_a","wf_b"]'])).toEqual([['wf_a', 'wf_b']])
    expect(await sentFileIds(['--paths', '["files/qc/a.png","files/b.png"]'])).toEqual([
      ['files/qc/a.png', 'files/b.png'],
    ])
    expect(await sentFileIds(['wf_a,wf_b'])).toEqual([['wf_a', 'wf_b']])
  })

  it('keeps a comma inside a path, so one file is never read as two', async () => {
    expect(await sentFileIds(['--paths', 'files/qc/a,b.png', 'files/c.png'])).toEqual([
      ['files/qc/a,b.png', 'files/c.png'],
    ])
  })

  it('refuses two spellings at once, before any request', async () => {
    const both = await run([
      'files',
      'batch-delete',
      '--ids',
      'wf_a',
      '--file-ids',
      'wf_b',
      '--yes',
    ])
    expect(both.exitCode).toBe(1)
    expect(both.stderr).toContain('--ids is another spelling of --file-ids; pass one, not both')
    const aliases = await run([
      'files',
      'batch-delete',
      '--ids',
      'wf_a',
      '--paths',
      'files/b',
      '--yes',
    ])
    expect(aliases.exitCode).toBe(1)
    expect([...both.bodies, ...aliases.bodies]).toEqual([])
  })

  it('keeps the confirmation for every spelling', async () => {
    const unconfirmed = await run(['files', 'batch-delete', '--ids', 'wf_a,wf_b'])
    expect(unconfirmed.exitCode).toBe(1)
    expect(unconfirmed.stderr).toContain('Re-run with --yes to confirm')
    expect(unconfirmed.bodies).toEqual([])
  })
})

describe('id lists answer to the request field name behind a shortened flag', () => {
  it('sends logs list --workflow-ids as --workflow', async () => {
    const urls: string[] = []
    const result = await runEmbeddedCli(['logs', 'list', '--workflow-ids', 'wf_a', 'wf_b'], {
      ...identity,
      transport: async (url) => {
        urls.push(String(url))
        return Response.json({ data: [], nextCursor: null })
      },
    })
    expect(result.exitCode).toBe(0)
    expect(urls.map((url) => new URL(url).searchParams.get('workflowIds'))).toEqual(['wf_a,wf_b'])
  })

  it('sends tables rows batch-delete --row-ids as --row', async () => {
    const result = await run([
      'tables',
      'rows',
      'batch-delete',
      'tbl_a',
      '--row-ids',
      'row_a',
      '--yes',
    ])
    expect(result.exitCode).toBe(0)
    expect(result.bodies).toEqual([{ workspaceId: 'workspace', rowIds: ['row_a'] }])
  })
})
