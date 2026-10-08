import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runEmbeddedCli } from '#sim-cli/embed'

const identity = { endpoint: 'https://sim.test', apiKey: 'fixture', workspaceId: 'workspace' }

afterEach(() => vi.unstubAllEnvs())

describe('embedded CLI host isolation', () => {
  it.each([
    { name: 'profile configuration', argv: ['configure', '--set-output', 'json'] },
    { name: 'telemetry preferences', argv: ['telemetry', 'disable'] },
  ])('rejects $name without persisting host settings', async ({ argv }) => {
    const directory = await mkdtemp(join(tmpdir(), 'sim-embedded-host-'))
    vi.stubEnv('SIM_CONFIG_DIR', directory)
    try {
      const result = await runEmbeddedCli(argv, identity)
      expect.soft(result.exitCode).toBe(1)
      expect.soft(await readdir(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
