/**
 * Real PostgreSQL coverage for MCP servers as workspace source, against a real MCP server: a
 * Streamable HTTP server on loopback that lists two tools and records the `Authorization` header
 * each request carries, so a tool check, an env reference resolving and an unreachable server are
 * the real thing. Each check runs in its own workspace and reads the stored rows directly. Writes a
 * report to `WORKSPACE_SOURCE_MCP_REPORT_PATH`.
 */
import { createServer, type Server } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { mcpServers, user, userStats, workspaceEnvironment } from '@sim/db/schema'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { encryptSecret } from '@/lib/core/security/encryption'
import { createMcpServerUseCase, updateMcpServerUseCase } from '@/lib/mcp/application/use-cases'
import { readSourceResources } from '@/lib/workflows/application/read-source-resources'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import type { ApplyWorkspaceSourceInput } from '@/lib/workspace-source/application/apply-workspace-source'
import {
  refusal,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ownerId = generateId()
const readerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const reader = createSessionPrincipal({ userId: readerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_MCP_REPORT_PATH',
  'workspace-source-mcp.json'
)
const workspaces = sourceWorkspaces()
const runner = sourceRunner(['mcp-server', 'workflow'], owner)

const TOKEN = 'ghp-fixture-token-value'
const TOOLS = ['create_issue', 'list_issues']

/** `Authorization` headers the MCP server received, in order. */
const received: string[] = []
let fixture: Server
let url = ''
/** A loopback URL nothing listens on. */
let closedUrl = ''

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') reject(new Error('No port'))
      else resolve(address.port)
    })
  })
}

/** A stateless Streamable HTTP MCP server listing {@link TOOLS}. */
function mcpFixture(): Server {
  return createServer(async (request, response) => {
    received.push(String(request.headers.authorization ?? ''))
    const server = new McpServer({ name: 'fixture', version: '1.0.0' })
    for (const name of TOOLS) {
      server.registerTool(name, { description: name }, async () => ({
        content: [{ type: 'text', text: 'ok' }],
      }))
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    response.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request, response)
  })
}

function serverFile(body: string): string {
  return `// @sim-sdk 1
import { defineMcpServer } from '@sim/workflow-sdk/workspace'

export default defineMcpServer(${body})
`
}

const github = () =>
  serverFile(`{
  name: 'GitHub',
  url: '${url}',
  headers: { Authorization: 'Bearer {{GH_TOKEN}}', Accept: 'application/json' },
}`)

function triage(tool: string, server = 'github'): string {
  return `// @sim-sdk 1
import { agent, mcp, t, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Triage', {}, () => {
  const start = trigger.start('Start', { inputFormat: { question: 'string' } })
  const answer = agent('Answer', {
    model: 'claude-sonnet-5-5',
    messages: [{ role: 'user', content: t\`\${start.question}\` }],
    tools: [mcp('${server}').tool('${tool}')],
  })

  start.to(answer)
})
`
}

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files'>> & {
  principal?: Principal
}

function apply(workspaceId: string, files: Record<string, string>, options: ApplyOptions = {}) {
  return runner.apply(workspaceId, { files, ...options })
}

function findings(
  diagnostics: ReadonlyArray<{ code: string; severity: string; kind?: string; key?: string }>,
  severity: string
): string[] {
  return diagnostics
    .filter((finding) => finding.severity === severity)
    .map((finding) => `${finding.code} ${finding.kind}:${finding.key}`)
    .sort(compareStrings)
}

/** The MCP findings of one severity: the workflow pipeline's own lint is not this suite's. */
function mcpFindings(
  diagnostics: ReadonlyArray<{ code: string; severity: string; kind?: string; key?: string }>,
  severity: string
): string[] {
  return findings(diagnostics, severity).filter((entry) => entry.includes('_MCP_'))
}

function actions(changes: ReadonlyArray<{ kind: string; key: string; action: string }>) {
  return changes.map(({ kind, key, action }) => `${action} ${kind}:${key}`)
}

async function liveServers(workspaceId: string) {
  return db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
}

async function newWorkspace(): Promise<string> {
  const workspaceId = await workspaces.create({
    name: 'Workspace source MCP',
    ownerId,
    members: [{ userId: readerId, permission: 'read' }],
  })
  await db.insert(workspaceEnvironment).values({
    id: generateId(),
    workspaceId,
    variables: { GH_TOKEN: (await encryptSecret(TOKEN)).encrypted },
  })
  return workspaceId
}

/** A workspace holding the GitHub server and the workflow using it, as one apply created them. */
async function setUp() {
  const workspaceId = await newWorkspace()
  const created = await apply(workspaceId, {
    'mcp/github.ts': github(),
    'workflows/triage/workflow.ts': triage('create_issue'),
  })
  const read = await runner.get(workspaceId)
  return { workspaceId, created, read }
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  fixture = mcpFixture()
  url = `http://127.0.0.1:${await listen(fixture)}/mcp`
  const closed = createServer()
  closedUrl = `http://127.0.0.1:${await listen(closed)}/mcp`
  await new Promise((resolve) => closed.close(resolve))
  const now = new Date()
  await db.insert(user).values(
    [ownerId, readerId].map((id) => ({
      id,
      name: 'Workspace source MCP fixture',
      email: `${id}@workspace-source.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
})

afterAll(async () => {
  await writeReport()
  await workspaces.cleanup()
  await db.delete(user).where(inArray(user.id, [ownerId, readerId]))
  await new Promise((resolve) => fixture.close(resolve))
})

describe('MCP servers as workspace source', () => {
  check(
    'creates a server and the workflow calling its tool in one apply, storing the env reference',
    async () => {
      const { workspaceId, created } = await setUp()

      expect(created.failed).toBeUndefined()
      expect(actions(created.applied)).toEqual([
        'create mcp-server:github',
        'create workflow:triage',
      ])
      expect(mcpFindings(created.diagnostics, 'warning')).toEqual([
        'W_MCP_TOOLS_UNCHECKED workflow:triage',
      ])
      const [server] = await liveServers(workspaceId)
      expect(server).toMatchObject({
        name: 'GitHub',
        url,
        authType: 'headers',
        headers: { Authorization: 'Bearer {{GH_TOKEN}}', Accept: 'application/json' },
      })
      const workflowId = created.base.resources['workflow:triage']?.id ?? ''
      const state = await loadWorkflowFromNormalizedTables(workflowId)
      const tools = Object.values(state?.blocks ?? {}).flatMap((block) => {
        const value = block.subBlocks?.tools?.value
        return Array.isArray(value) ? value : []
      })
      expect(tools).toEqual([
        expect.objectContaining({
          type: 'mcp',
          params: expect.objectContaining({ serverId: server.id, toolName: 'create_issue' }),
        }),
      ])
    }
  )

  check(
    'reads back what it applied byte for byte, and re-applying it changes nothing',
    async () => {
      const { workspaceId, read } = await setUp()

      expect(read.files['mcp/github.ts']).toBe(github())
      const again = await apply(workspaceId, read.files, { base: read.base })

      expect(again.applied).toEqual([])
      expect(findings(again.diagnostics, 'error')).toEqual([])
      expect(mcpFindings(again.diagnostics, 'warning')).toEqual([])
    }
  )

  check(
    'connects with the env variable a header names, and checks the tools a workflow calls',
    async () => {
      const { workspaceId, read } = await setUp()
      received.length = 0

      const known = await apply(
        workspaceId,
        { ...read.files, 'workflows/triage/workflow.ts': triage('list_issues') },
        { base: read.base, dryRun: true }
      )

      expect(findings(known.diagnostics, 'error')).toEqual([])
      expect(mcpFindings(known.diagnostics, 'warning')).toEqual([])
      expect(received).toContain(`Bearer ${TOKEN}`)
      expect(received).not.toContain('Bearer {{GH_TOKEN}}')

      const dryMisspelled = await apply(
        workspaceId,
        { ...read.files, 'workflows/triage/workflow.ts': triage('crate_issue') },
        { base: read.base, dryRun: true }
      )
      expect(findings(dryMisspelled.diagnostics, 'error')).toContain(
        'E_MCP_TOOL_UNKNOWN workflow:triage'
      )

      const misspelled = await refusal(
        apply(
          workspaceId,
          { ...read.files, 'workflows/triage/workflow.ts': triage('crate_issue') },
          { base: read.base }
        )
      )
      const unknown = misspelled.diagnostics.find(
        (finding) => finding.code === 'E_MCP_TOOL_UNKNOWN'
      )
      expect(unknown).toMatchObject({
        kind: 'workflow',
        key: 'triage',
        file: 'workflows/triage/workflow.ts',
      })
      expect(unknown?.message).toContain('Did you mean "create_issue"?')
    }
  )

  check('refuses a literal secret in a credential header and writes nothing', async () => {
    const workspaceId = await newWorkspace()

    const refused = await refusal(
      apply(workspaceId, {
        'mcp/github.ts': serverFile(
          `{ url: '${url}', headers: { Authorization: 'Bearer ${TOKEN}' } }`
        ),
      })
    )

    expect(findings(refused.diagnostics, 'error')).toEqual([
      'E_MCP_LITERAL_SECRET mcp-server:github',
    ])
    expect(refused.diagnostics[0]).toMatchObject({ file: 'mcp/github.ts', line: 4 })
    expect(await liveServers(workspaceId)).toEqual([])
  })

  check('warns when a server cannot be reached, and applies the workflow calling it', async () => {
    const workspaceId = await newWorkspace()
    await apply(workspaceId, {
      'mcp/down.ts': serverFile(`{ url: '${closedUrl}', timeout: 2000, retries: 0 }`),
    })
    const read = await runner.get(workspaceId)

    const result = await apply(
      workspaceId,
      { ...read.files, 'workflows/triage/workflow.ts': triage('anything', 'down') },
      { base: read.base }
    )

    expect(result.failed).toBeUndefined()
    expect(actions(result.applied)).toEqual(['create workflow:triage'])
    const unchecked = result.diagnostics.find((finding) => finding.code === 'W_MCP_TOOLS_UNCHECKED')
    expect(unchecked?.message).toContain('it could not be reached')
  })

  check(
    'updates a changed setting, and refuses an edit of a server changed since the get',
    async () => {
      const { workspaceId, read } = await setUp()
      const edited = {
        ...read.files,
        'mcp/github.ts': read.files['mcp/github.ts'].replace(
          "name: 'GitHub'",
          "name: 'GitHub Issues'"
        ),
      }

      const updated = await apply(workspaceId, edited, { base: read.base })
      expect(actions(updated.applied)).toEqual(['update mcp-server:github'])
      expect((await liveServers(workspaceId))[0]?.name).toBe('GitHub Issues')

      const [server] = await liveServers(workspaceId)
      await updateMcpServerUseCase.execute({
        principal: owner,
        input: { workspaceId, serverId: server.id, timeout: 5000 },
      })
      const stale = await refusal(
        apply(
          workspaceId,
          {
            ...read.files,
            'mcp/github.ts': github().replace("name: 'GitHub'", "name: 'Hub'"),
          },
          { base: updated.base }
        )
      )
      expect(stale.code).toBe('conflict')
      expect(findings(stale.diagnostics, 'error')).toEqual(['E_APPLY_STALE mcp-server:github'])
      expect((await liveServers(workspaceId))[0]?.name).toBe('GitHub Issues')
    }
  )

  check(
    'replaces a server whose URL changed, which needs --allow-delete while workflows call it',
    async () => {
      const { workspaceId, read } = await setUp()
      const [before] = await liveServers(workspaceId)
      const moved = {
        ...read.files,
        'mcp/github.ts': read.files['mcp/github.ts'].replace(url, `${url}/v2`),
      }

      const refused = await refusal(apply(workspaceId, moved, { base: read.base }))
      expect(findings(refused.diagnostics, 'error')).toEqual([
        'E_APPLY_DELETE_NOT_ALLOWED mcp-server:github',
      ])
      expect(findings(refused.diagnostics, 'warning')).toContain('W_MCP_REPLACE mcp-server:github')

      const replaced = await apply(workspaceId, moved, { base: read.base, allowDelete: true })
      expect(replaced.failed).toBeUndefined()
      expect(actions(replaced.applied)).toEqual(['update mcp-server:github'])
      const after = await liveServers(workspaceId)
      expect(after.map((server) => server.url)).toEqual([`${url}/v2`])
      expect(after[0]?.id).not.toBe(before.id)
      expect(replaced.base.resources['mcp-server:github']?.id).toBe(after[0]?.id)
    }
  )

  check('deletes an undeclared server only with --allow-delete', async () => {
    const workspaceId = await newWorkspace()
    const created = await apply(workspaceId, {
      'mcp/github.ts': github(),
      'mcp/spare.ts': serverFile(`{ url: '${url}/spare' }`),
    })
    const files = { 'mcp/github.ts': created.files['mcp/github.ts'] }

    const refused = await refusal(apply(workspaceId, files, { base: created.base }))
    expect(findings(refused.diagnostics, 'error')).toEqual([
      'E_APPLY_DELETE_NOT_ALLOWED mcp-server:spare',
    ])
    expect(await liveServers(workspaceId)).toHaveLength(2)

    const deleted = await apply(workspaceId, files, { base: created.base, allowDelete: true })
    expect(actions(deleted.applied)).toEqual(['delete mcp-server:spare'])
    expect((await liveServers(workspaceId)).map((server) => server.name)).toEqual(['GitHub'])
  })

  check('refuses a read-only member, and lets a workspace API key apply servers', async () => {
    const workspaceId = await newWorkspace()

    await expect(
      apply(workspaceId, { 'mcp/github.ts': github() }, { principal: reader })
    ).rejects.toThrow()
    expect(await liveServers(workspaceId)).toEqual([])

    const key = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })
    const created = await apply(workspaceId, { 'mcp/github.ts': github() }, { principal: key })
    expect(actions(created.applied)).toEqual(['create mcp-server:github'])

    const [server] = await liveServers(workspaceId)
    expect(server).toMatchObject({ name: 'GitHub', url })
  })

  check(
    'prints a stored literal secret as stored(), never its value, and keeps it on an edit',
    async () => {
      const workspaceId = await newWorkspace()
      await createMcpServerUseCase.execute({
        principal: owner,
        input: {
          workspaceId,
          name: 'Legacy',
          url,
          headers: { Authorization: `Bearer ${TOKEN}` },
          authType: 'headers',
        },
      })

      const read = await runner.get(workspaceId)
      const [path] = Object.keys(read.files)
      expect(read.files[path]).toContain('Authorization: stored()')
      expect(JSON.stringify(read)).not.toContain(TOKEN)

      const unchanged = await apply(workspaceId, read.files, { base: read.base })
      expect(unchanged.applied).toEqual([])

      const edited = await apply(
        workspaceId,
        { [path]: read.files[path].replace("name: 'Legacy'", "name: 'Legacy API'") },
        { base: read.base }
      )
      expect(actions(edited.applied)).toEqual([`update mcp-server:${path.slice(4, -3)}`])
      expect(JSON.stringify(edited)).not.toContain(TOKEN)
      const [server] = await liveServers(workspaceId)
      expect(server).toMatchObject({
        name: 'Legacy API',
        headers: { Authorization: `Bearer ${TOKEN}` },
      })

      const missing = await refusal(
        apply(
          workspaceId,
          {
            [path]: edited.files[path].replace('Authorization: stored()', 'Cookie: stored()'),
          },
          { base: edited.base }
        )
      )
      expect(findings(missing.diagnostics, 'error')).toEqual([
        `E_MCP_STORED_MISSING mcp-server:${path.slice(4, -3)}`,
      ])
    }
  )

  check('lists each server with the tools it serves in the resources manifest', async () => {
    const { workspaceId } = await setUp()

    const manifest = await readSourceResources.execute({
      principal: owner,
      input: { workspaceId },
    })

    expect(manifest.mcpServers).toEqual([
      expect.objectContaining({ key: 'github', name: 'GitHub', tools: TOOLS }),
    ])
  })
})
