import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_KEY,
  startPiProviderFixture,
} from '@/executor/handlers/pi/core/__fixtures__/provider'
import { applyPiEvent, createPiTotals, normalizePiEvent } from '@/executor/handlers/pi/core/events'
import {
  createPiModelRuntime,
  createSealedPiResourceLoader,
  loadPiSdk,
  toPiTool,
} from '@/executor/handlers/pi/core/pi-sdk'
import { scrubPiEvent } from '@/executor/handlers/pi/core/redaction'

async function createFixtureSession(toolError = false) {
  const directory = await mkdtemp(join(tmpdir(), 'sim-pi-sdk-'))
  const fixture = await startPiProviderFixture(http)
  const sdk = await loadPiSdk()
  const modelRuntime = await createPiModelRuntime(sdk)
  modelRuntime.registerProvider('fixture', fixture.provider)
  await modelRuntime.setRuntimeApiKey('fixture', FIXTURE_KEY)
  await mkdir(join(directory, '.pi', 'extensions'), { recursive: true })
  await writeFile(join(directory, 'AGENTS.md'), 'poisoned repository instructions')
  await writeFile(
    join(directory, '.pi', 'extensions', 'poison.ts'),
    'throw new Error("poisoned extension")'
  )
  await writeFile(
    join(directory, 'auth.json'),
    JSON.stringify({ fixture: { type: 'api_key', key: 'poisoned credential' } })
  )
  const model = modelRuntime.getModel('fixture', 'fixture-model')
  if (!model) throw new Error('Fixture model missing')
  const toolArguments: Array<Record<string, unknown>> = []
  const { session } = await sdk.createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime,
    model,
    noTools: 'builtin',
    customTools: [
      toPiTool(
        sdk,
        {
          name: 'fixture_tool',
          description: 'Offline fixture tool',
          parameters: Type.Object({ value: Type.String() }),
          execute: async (args) => {
            toolArguments.push(args)
            return {
              text: toolError ? `tool failed ${FIXTURE_KEY}` : 'fixture output',
              isError: toolError,
            }
          },
        },
        [FIXTURE_KEY]
      ),
    ],
    resourceLoader: createSealedPiResourceLoader(sdk, 'sealed fixture prompt'),
    settingsManager: sdk.SettingsManager.inMemory({
      cacheWarming: 'off',
      retry: { enabled: false },
    }),
    sessionManager: sdk.SessionManager.inMemory(directory),
  })
  const totals = createPiTotals()
  const events: unknown[] = []
  const unsubscribe = session.subscribe((raw) => {
    events.push(raw)
    const event = scrubPiEvent(normalizePiEvent(raw), [FIXTURE_KEY])
    if (event) applyPiEvent(totals, event)
  })
  return {
    session,
    fixture,
    totals,
    events,
    toolArguments,
    directory,
    async close() {
      unsubscribe()
      session.dispose()
      await modelRuntime.removeRuntimeApiKey('fixture')
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

describe('installed Pi SDK wire', () => {
  it.each([false, true])(
    'normalizes a real tool cycle (tool failure: %s) without discovering disk resources',
    async (toolError) => {
      const run = await createFixtureSession(toolError)
      try {
        await run.session.prompt('tool-cycle-fixture')
        expect(run.toolArguments).toEqual([{ value: 'fixture input' }])
        expect(run.totals).toEqual({
          finalText: 'fixture complete',
          inputTokens: 14,
          outputTokens: 6,
          toolCalls: [{ name: 'fixture_tool', isError: toolError }],
        })
        expect(run.events.map(normalizePiEvent)).toContainEqual({
          type: 'thinking',
          text: 'checking fixture',
        })
        expect(run.fixture.requests).toHaveLength(2)
        expect(
          run.fixture.requests.every(
            ({ authorization }) => authorization === `Bearer ${FIXTURE_KEY}`
          )
        ).toBe(true)
        const sent = JSON.stringify(run.fixture.requests)
        expect(sent).toContain('sealed fixture prompt')
        expect(sent).not.toContain('poisoned')
        if (toolError)
          expect(JSON.stringify(run.fixture.requests[1].body.messages)).not.toContain(FIXTURE_KEY)
        expect(await readdir(run.directory)).not.toContain('settings.json')
        expect(run.session.isStreaming).toBe(false)
      } finally {
        await run.close()
      }
    }
  )

  it('reports a real provider failure as a redacted terminal error', async () => {
    const run = await createFixtureSession()
    try {
      await run.session.prompt('provider-error')
      expect(run.totals.errorMessage).toContain('provider failed')
      expect(run.totals.errorMessage).not.toContain(FIXTURE_KEY)
      expect(run.fixture.requests).toHaveLength(1)
      expect(run.session.isStreaming).toBe(false)
    } finally {
      await run.close()
    }
  })

  it('cancels an open provider stream and finishes the session', async () => {
    const run = await createFixtureSession()
    try {
      const prompted = run.session.prompt('cancel-fixture')
      await run.fixture.requested
      await run.session.abort()
      await prompted
      expect(run.session.isStreaming).toBe(false)
      expect(run.totals.errorMessage).toMatch(/abort/i)
      expect(run.fixture.requests).toHaveLength(1)
    } finally {
      await run.close()
    }
  })
})
