import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  "// @sim-sdk 1\nexport default workflow('W', {}, () => {\n  const score = fn('Score', { code: codeFile('./functions/score.js') })\n})\n"
const LOCK = {
  version: 1,
  'x-tool': { pinned: true },
  blocks: {
    score: {
      id: 'b-1',
      parent: null,
      ident: 'score',
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
      base: { workspaceId: WORKSPACE_ID, fingerprint: FIRST, catalogHash: CATALOG.hash },
      fingerprint: FIRST,
      canonicalHash: 'h',
      catalogHash: CATALOG.hash,
      sdkMajor: 1,
      blockTypes: ['function'],
      diagnostics: [],
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
      fingerprint: SECOND,
      files,
      lock: LOCK,
      base: { workspaceId: WORKSPACE_ID, fingerprint: SECOND, catalogHash: CATALOG.hash },
      mintedIds: {},
      notes: [],
      needsRedeployment: true,
      sdkMajor: 1,
      catalogHash: CATALOG.hash,
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

const NEW_WORKFLOW_ID = '00000000-0000-4000-8000-00000000000c'
const MANIFEST = {
  workspaceId: WORKSPACE_ID,
  tables: [
    { key: 'tickets', id: 't-1', name: 'Tickets', columns: [{ name: 'subject', type: 'string' }] },
  ],
  knowledgeBases: [],
  credentials: [{ key: 'support-slack', id: 'c-1', name: 'Support Slack', provider: 'slack' }],
  workflows: [],
  env: ['CRM_KEY'],
  truncated: false,
}

let dir: string
let applyBodies: unknown[]
let createBodies: unknown[]

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'sim-source-roundtrip-')), 'source')
  vi.stubEnv('SIM_CONFIG_DIR', join(dir, '..', 'config'))
  applyBodies = []
  createBodies = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const method = init?.method ?? 'GET'
      if (url.pathname === `/api/v2/workflows/${WORKFLOW_ID}/source` && method === 'GET') {
        return json(sourceResponse())
      }
      if (url.pathname === `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/catalog`) {
        return json({ data: CATALOG })
      }
      if (url.pathname === `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/resources`) {
        return json({ data: MANIFEST })
      }
      if (url.pathname === `/api/v2/workspaces/${WORKSPACE_ID}/workflows/source`) {
        createBodies.push(JSON.parse(String(init?.body)))
        const created = appliedResponse({
          'workflow.ts': WORKFLOW_TS,
          'functions/score.js': 'return 1\n',
        })
        return json({ data: { ...created.data, workflowId: NEW_WORKFLOW_ID } })
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

describe('sim workflows source get --dir → apply --dir', () => {
  it('sends back exactly the directory get wrote, then saves what the server stored', async () => {
    await sim('workflows', 'source', 'get', WORKFLOW_ID, '--dir', dir)
    await sim('workflows', 'source', 'apply', WORKFLOW_ID, '--dir', dir, '--yes')

    expect(applyBodies).toEqual([
      {
        files: { 'workflow.ts': WORKFLOW_TS, 'functions/score.js': 'return 1\n' },
        lock: LOCK,
        base: { workspaceId: WORKSPACE_ID, fingerprint: FIRST, catalogHash: CATALOG.hash },
        provenance: { client: 'cli' },
      },
    ])
    expect(readFileSync(join(dir, 'functions/score.js'), 'utf8')).toBe('return 2\n')
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).fingerprint).toBe(SECOND)
    expect(JSON.parse(readFileSync(join(dir, '.sim/lock.json'), 'utf8'))).toEqual(LOCK)
  })

  it('writes workspace types from the manifest, so resource keys are checked locally', async () => {
    await sim('workflows', 'source', 'get', WORKFLOW_ID, '--dir', dir)

    const types = readFileSync(join(dir, '.sim/sdk/workspace.d.ts'), 'utf8')
    expect(types).toContain(`'tickets': { subject: string }`)
    expect(types).toContain(`'support-slack': { provider: 'slack' }`)
    expect(types).toContain('CRM_KEY: true')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('@sim/workflow-sdk')
  })

  it('creates a workflow from a bare directory, then applies to it by its new id', async () => {
    await sim('workflows', 'source', 'get', WORKFLOW_ID, '--dir', dir)
    rmSync(join(dir, '.sim/lock.json'))
    rmSync(join(dir, '.sim/base.json'))

    await sim('workflows', 'source', 'create', '--dir', dir, '--name', 'Copy', '--yes')

    expect(createBodies).toEqual([
      {
        files: { 'workflow.ts': WORKFLOW_TS, 'functions/score.js': 'return 1\n' },
        name: 'Copy',
        provenance: { client: 'cli' },
      },
    ])
    expect(existsSync(join(dir, '.sim/lock.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, '.sim/base.json'), 'utf8')).fingerprint).toBe(SECOND)

    await sim('workflows', 'source', 'apply', WORKFLOW_ID, '--dir', dir, '--yes')
    expect((applyBodies[0] as { base: { fingerprint: string } }).base.fingerprint).toBe(SECOND)
  })
})
