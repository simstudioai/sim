import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedCommands } from '../../runtime/build'
import { attachProtocolCommands } from './index'

vi.mock('../../context', async () => {
  const { SimClient } = await import('../../http/client')
  const profile = {
    name: 'default',
    endpoint: 'https://sim.example',
    authProfile: 'default',
    apiKey: 'key',
    oauth: null,
    workspaceId: '00000000-0000-4000-8000-00000000000b',
    output: 'json' as const,
    sources: {
      endpoint: 'default' as const,
      credential: 'env' as const,
      workspaceId: 'env' as const,
      output: 'default' as const,
    },
  }
  return {
    globalsOf: () => ({}),
    profileFrom: () => profile,
    clientFrom: () => ({ client: new SimClient(profile), profile }),
  }
})

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000000b'
const FIRST = `sf1:${'1'.repeat(64)}`
const SECOND = `sf1:${'2'.repeat(64)}`

/** A real catalog projected from registry blocks, shared with the SDK's own type checks. */
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../../../workflow-sdk/test/fixtures/catalog.json'), 'utf8')
)

const WORKFLOW_TS =
  "// @sim-sdk 1\nexport default workflow('W', {}, () => {\n  const score = fn('Score', { code: file('./functions/score.js') })\n})\n"
const LOCK = {
  lockVersion: 1,
  'x-tool': { pinned: true },
  blocks: {
    score: {
      id: 'b-1',
      parent: null,
      binding: 'score',
      order: 0,
      codeFile: 'functions/score.js',
    },
  },
  variables: {},
}

function sourceResponse() {
  return {
    data: {
      workflowId: WORKFLOW_ID,
      workspaceId: WORKSPACE_ID,
      files: { 'workflow.ts': WORKFLOW_TS, 'functions/score.js': 'return 1\n' },
      lock: LOCK,
      lockBase: { workspaceId: WORKSPACE_ID, baseFingerprint: FIRST, catalogHash: CATALOG.hash },
      fingerprint: FIRST,
      canonicalHash: 'h',
      catalogVersion: CATALOG.hash,
      sdkMajor: 1,
      blockTypes: ['function'],
      warnings: [],
    },
  }
}

function appliedResponse(files: Record<string, string>) {
  return {
    data: {
      workflowId: WORKFLOW_ID,
      workflowName: 'W',
      workspaceId: WORKSPACE_ID,
      dryRun: false,
      applied: true,
      diff: {
        noop: false,
        blocks: { added: [], removed: [], renamed: [], modified: [] },
        edges: { added: 0, removed: 0 },
        variables: { added: [], removed: [], modified: [] },
      },
      diagnostics: [],
      newFingerprint: SECOND,
      files,
      lock: LOCK,
      lockBase: { workspaceId: WORKSPACE_ID, baseFingerprint: SECOND, catalogHash: CATALOG.hash },
      mintedIds: {},
      warnings: [],
      needsRedeployment: true,
      sdkMajor: 1,
      catalogVersion: CATALOG.hash,
    },
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function program(): Command {
  const root = new Command('sim').exitOverride()
  for (const group of buildGeneratedCommands()) root.addCommand(group)
  attachProtocolCommands(root)
  const override = (command: Command) => {
    command.exitOverride()
    command.commands.forEach(override)
  }
  override(root)
  return root
}

async function sim(...argv: string[]): Promise<void> {
  await program().parseAsync(['node', 'sim', ...argv])
}

let dir: string
let applyBodies: unknown[]

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'sim-source-roundtrip-')), 'source')
  applyBodies = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const method = init?.method ?? 'GET'
      if (url.pathname === `/api/v2/workflows/${WORKFLOW_ID}/source` && method === 'GET') {
        return json(sourceResponse())
      }
      if (url.pathname === `/api/v2/workspaces/${WORKSPACE_ID}/block-catalog`) {
        return json({ data: CATALOG })
      }
      if (url.pathname === `/api/v2/workflows/${WORKFLOW_ID}/source` && method === 'POST') {
        applyBodies.push(JSON.parse(String(init?.body)))
        return json(
          appliedResponse({ 'workflow.ts': WORKFLOW_TS, 'functions/score.js': 'return 2\n' })
        )
      }
      return new Response('not found', { status: 404 })
    })
  )
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true })
})

describe('sim workflows source get --out → apply --from', () => {
  it('sends back exactly the directory get wrote, then saves what the server stored', async () => {
    await sim('workflows', 'source', 'get', WORKFLOW_ID, '--out', dir)
    await sim('workflows', 'source', 'apply', WORKFLOW_ID, '--from', dir)

    expect(applyBodies).toEqual([
      {
        files: { 'workflow.ts': WORKFLOW_TS, 'functions/score.js': 'return 1\n' },
        lock: LOCK,
        lockBase: { workspaceId: WORKSPACE_ID, baseFingerprint: FIRST, catalogHash: CATALOG.hash },
        baseFingerprint: FIRST,
        provenance: { client: 'cli' },
      },
    ])
    expect(readFileSync(join(dir, 'functions/score.js'), 'utf8')).toBe('return 2\n')
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).baseFingerprint).toBe(
      SECOND
    )
    expect(JSON.parse(readFileSync(join(dir, '.sim/lock.json'), 'utf8'))).toEqual(LOCK)
  })
})
