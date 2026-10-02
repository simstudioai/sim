import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { PI_EVENT_FILTER_SOURCE } from '@/executor/handlers/pi/cloud/event-filter-source'
import { buildPiScript } from '@/executor/handlers/pi/cloud/shared'
import {
  FIXTURE_KEY,
  startPiProviderFixture,
} from '@/executor/handlers/pi/core/__fixtures__/provider'
import { applyPiEvent, createPiTotals, parseJsonLine } from '@/executor/handlers/pi/core/events'
import { PI_SEARCH_EXTENSION_SOURCE } from '@/executor/handlers/pi/search/extension-source'

const exec = promisify(execFile)

describe('installed Pi CLI wire', () => {
  it('loads explicit Sim search with --no-extensions and keeps warming disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sim-pi-installed-cli-'))
    const workspace = join(root, 'workspace')
    const fixture = await startPiProviderFixture(http)
    try {
      const repo = join(workspace, 'repo')
      const bin = join(root, 'bin')
      const providerPath = join(root, 'provider.ts')
      const searchPath = join(workspace, 'sim-search-extension.ts')
      const preload = join(root, 'preload.mjs')
      await mkdir(join(repo, '.pi', 'extensions'), { recursive: true })
      await mkdir(bin)
      await writeFile(
        join(repo, '.pi', 'extensions', 'poison.ts'),
        'throw new Error("repository extension loaded")'
      )
      await writeFile(join(workspace, 'pi-prompt.txt'), 'search-fixture')
      await writeFile(join(workspace, 'sim-pi-event-filter.mjs'), PI_EVENT_FILTER_SOURCE)
      await writeFile(searchPath, PI_SEARCH_EXTENSION_SOURCE)
      await writeFile(
        providerPath,
        `export default function(pi) { pi.registerProvider("fixture", ${JSON.stringify({ ...fixture.provider, apiKey: FIXTURE_KEY })}) }`
      )
      await writeFile(
        preload,
        `const guard = (originalFetch) => (input, init) => {
 const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
 if (url.origin === "https://api.exa.ai" && url.pathname === "/search") return originalFetch(${JSON.stringify(`${fixture.baseUrl}/exa`)}, init);
 if (url.origin === ${JSON.stringify(fixture.baseUrl)}) return originalFetch(input, init);
 throw new Error("Unexpected external fixture traffic: " + url.origin);
};
let guardedFetch = guard(globalThis.fetch);
Object.defineProperty(globalThis, "fetch", { configurable: true, get: () => guardedFetch, set: (fetch) => { guardedFetch = guard(fetch); } });`
      )
      const cli = join(
        dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),
        'bundle',
        'cli.js'
      )
      await writeFile(join(bin, 'pi'), `#!/bin/bash\nexec node "${cli}" "$@"\n`, { mode: 0o700 })
      const script = buildPiScript('/workspace/sim-search-extension.ts', {
        disableRepositoryResources: true,
      })
        .replaceAll('/workspace', workspace)
        .replace(' < ', ` -e ${providerPath} < `)
      const { stdout } = await exec('/bin/bash', ['-c', script], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          NODE_OPTIONS: `--import ${preload}`,
          PI_OFFLINE: '1',
          PI_PROVIDER: 'fixture',
          PI_MODEL: 'fixture-model',
          PI_THINKING: 'medium',
          SIM_SEARCH_PROVIDER: 'exa',
          SIM_SEARCH_API_KEY: FIXTURE_KEY,
        },
        timeout: 15_000,
      })
      const totals = createPiTotals()
      for (const line of stdout.split('\n')) {
        const event = parseJsonLine(line)
        if (event) applyPiEvent(totals, event)
      }
      expect(JSON.stringify(fixture.requests.at(-1)?.body.messages)).toContain(
        'Offline search evidence'
      )
      expect(totals).toEqual({
        finalText: 'fixture complete',
        inputTokens: 14,
        outputTokens: 6,
        toolCalls: [{ name: 'web_search', isError: false }],
      })
      expect(fixture.requests.map(({ path }) => path)).toEqual([
        '/v1/chat/completions',
        '/exa',
        '/v1/chat/completions',
      ])
      const agentDir = join(workspace, 'sim-pi-agent')
      expect(JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'))).toEqual({
        cacheWarming: 'off',
      })
      expect(JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'))).toEqual({})
    } finally {
      await fixture.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
