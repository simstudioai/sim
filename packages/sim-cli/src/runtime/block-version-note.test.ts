import { describe, expect, it } from 'vitest'
import { runEmbeddedCli } from '../embed'

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }

/** `sim blocks get <requested>` against a catalog that answers with block `answered`. */
function getBlock(requested: string, answered: string) {
  return runEmbeddedCli(['blocks', 'get', requested, '--output', 'json'], {
    ...identity,
    transport: async () => Response.json({ data: { id: answered, name: 'Table' } }),
  })
}

describe('blocks get for a base type that reads as its newer version', () => {
  it('names the type to add inside the JSON, which stays one document when stderr is merged in (2>&1)', async () => {
    const result = await getBlock('table', 'table_v2')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout + result.stderr)).toEqual({
      id: 'table_v2',
      name: 'Table',
      note: '"table" reads as "table_v2", its current version; add it as {"type":"table_v2"}.',
    })
  })

  it('says nothing when the type read is the type asked for', async () => {
    const result = await getBlock('table_v2', 'table_v2')
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).not.toHaveProperty('note')
  })
})
