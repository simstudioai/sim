import { describe, expect, it } from 'vitest'
import { runEmbeddedCli } from '../embed'

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }

/** Runs one embedded invocation, recording the path of each request it sends. */
async function run(argv: string[]) {
  const paths: string[] = []
  const result = await runEmbeddedCli(argv, {
    ...identity,
    transport: async (url) => {
      paths.push(new URL(String(url)).pathname)
      return Response.json({ data: [] })
    },
  })
  return { ...result, paths }
}

describe('a nested group that defaults to its list', () => {
  it('lists credential providers when the providers group is named, as list does', async () => {
    const bare = await run(['credentials', 'providers'])
    const listed = await run(['credentials', 'providers', 'list'])
    expect(bare.exitCode).toBe(0)
    expect(bare.paths).toEqual(['/api/v2/credentials/providers'])
    expect(listed.paths).toEqual(bare.paths)
  })

  it('keeps each spelling’s own options: a leaf option reaches the leaf, the bare group takes it too', async () => {
    const searchOf = async (argv: string[]) => {
      const queries: string[] = []
      await runEmbeddedCli(argv, {
        ...identity,
        transport: async (url) => {
          queries.push(new URL(String(url)).searchParams.get('search') ?? '')
          return Response.json({ data: [] })
        },
      })
      return queries
    }
    expect(await searchOf(['credentials', 'providers', 'list', '--search', 'github'])).toEqual([
      'github',
    ])
    expect(await searchOf(['credentials', 'providers', '--search', 'github'])).toEqual(['github'])
  })

  it('leaves a group without a default printing its usage, sending nothing', async () => {
    const group = await run(['credentials'])
    expect(group.paths).toEqual([])
    expect(group.stderr + group.stdout).toContain('Usage: sim credentials')
  })
})
