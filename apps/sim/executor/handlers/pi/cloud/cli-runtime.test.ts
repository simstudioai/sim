import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { PI_EVENT_FILTER_SOURCE } from '@/executor/handlers/pi/cloud/event-filter-source'
import { buildPiScript } from '@/executor/handlers/pi/cloud/shared'
import { PI_PACKAGE_VERSION } from '@/scripts/pi-sandbox-packages'

const exec = promisify(execFile)

async function invokeSandbox(version: string) {
  const root = await mkdtemp(join(tmpdir(), 'sim-pi-cli-'))
  const workspace = join(root, 'workspace')
  const repo = join(workspace, 'repo')
  const bin = join(root, 'bin')
  await mkdir(repo, { recursive: true })
  await mkdir(bin)
  await writeFile(join(workspace, 'pi-prompt.txt'), 'fixture prompt')
  await writeFile(join(workspace, 'sim-pi-event-filter.mjs'), PI_EVENT_FILTER_SOURCE)
  await writeFile(
    join(bin, 'pi'),
    `#!/bin/bash
if [ "$1" = "--version" ]; then
  printf "%s\\n" "${version}"
  exit 0
fi
printf "%s" "$PI_CODING_AGENT_DIR" > "${root}/invoked"
printf "%s\\n" '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ok"}}'
exit 0
`,
    { mode: 0o700 }
  )
  const script = buildPiScript().replaceAll('/workspace', workspace)
  try {
    const result = await exec('/bin/bash', ['-c', script], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PI_PROVIDER: 'fixture',
        PI_MODEL: 'fixture',
        PI_THINKING: 'off',
      },
    }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error
    )
    const invoked = await readFile(join(root, 'invoked'), 'utf8').catch(() => null)
    const settings = invoked
      ? await readFile(join(invoked, 'settings.json'), 'utf8').catch(() => null)
      : null
    const storedFiles = invoked ? await readdir(invoked).catch(() => []) : []
    return { ...result, invoked, settings, storedFiles, repo }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('sandbox Pi runtime boundary', () => {
  it.each(['0.80.10', 'unexpected-version'])(
    'rejects %s before starting the agent',
    async (version) => {
      const result = await invokeSandbox(version)
      expect(result.code).not.toBe(0)
      expect(result.invoked).toBeNull()
      expect(result.stderr).toMatch(/rebuild|update/i)
      expect(result.stderr).toContain(PI_PACKAGE_VERSION)
    }
  )

  it('uses private settings outside the repository with warming off and no saved credentials', async () => {
    const result = await invokeSandbox(PI_PACKAGE_VERSION)
    expect(result.code).toBe(0)
    expect(result.invoked).toBeTruthy()
    expect(result.invoked?.startsWith(result.repo)).toBe(false)
    expect(JSON.parse(result.settings ?? '{}')).toEqual({ cacheWarming: 'off' })
    expect(result.storedFiles).toEqual(['settings.json'])
    expect(JSON.parse(result.stdout.trim())).toEqual({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'ok' },
    })
  })
})
