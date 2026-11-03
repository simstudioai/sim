import { describe, expect, it } from 'vitest'
import { runEmbeddedCli } from '#sim-cli/embed'

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }

describe('an embedded binary refusal names the metadata command', () => {
  it.each([
    [['files', 'get', 'wf_a'], 'sim files describe wf_a'],
    [['knowledge', 'export', 'kb_a', '-o', '-'], 'sim knowledge get kb_a'],
  ])('%j points at %s', async (argv, metadataCommand) => {
    const result = await runEmbeddedCli(argv, {
      ...identity,
      transport: async () =>
        new Response(new Uint8Array([0x89, 0x50]), { headers: { 'content-type': 'image/png' } }),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Use --output-file <path>')
    expect(result.stderr).toContain(`run \`${metadataCommand}\` for its metadata`)
  })
})
