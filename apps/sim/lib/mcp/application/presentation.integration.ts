import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import { copilotChats, environment, mcpServers, permissions, user, workspace } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { encryptSecret } from '@/lib/core/security/encryption'
import { executeMcpTool } from '@/lib/internal/mcp/execute-tool'
import { updateMcpServerUseCase } from '@/lib/mcp/application/use-cases'
import { evictMcpServerConnections } from '@/lib/mcp/connection-pool'
import { compactMcpPresentation } from '@/lib/mcp/presentation'
import {
  mcpPresentationCleanupKeys,
  planForkMcpPresentations,
} from '@/lib/mcp/presentation-lifecycle'
import { changeChatResources } from '@/lib/mothership/chat/application/change-resources'
import {
  callMcpAppTool,
  readMcpAppFrame,
  readMcpAppResource,
  readMcpResult,
  readMcpResultAsset,
} from '@/lib/mothership/chat/application/mcp-results'
import { executeChatFileBlobCopies } from '@/lib/mothership/chat/fork-chat-files'
import { loadCopilotChatMessages } from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import { buildTaggedMcpToolSchemas } from '@/lib/mothership/mcp-tools'
import { extractResourcesFromToolResult } from '@/lib/mothership/resources/extraction'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const owner = generateId()
const stranger = generateId()
const workspaceId = generateId()
const chatId = generateId()
const forkId = generateId()
const serverId = `mcp-${generateId()}`
const appUri = 'ui://fixture/view.html'
const sourceUri = 'file:///report.txt'
const credentialCanary = 'fixture-secret-7ea-not-for-display'
let reflectCredential = false
let receivedCredential: string | string[] | undefined
const session = createSessionPrincipal({ userId: owner })
const transports = new Map<string, StreamableHTTPServerTransport>()
const blobs = new Set<string>()
let appCalls = 0
let appAvailable = true
let listingOnlyPolicy = false
let origin = ''
const provider = createServer(async (request, response) => {
  try {
    receivedCredential = request.headers['x-fixture-token']
    const sessionId = request.headers['mcp-session-id']
    let transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined
    if (!transport) {
      if (sessionId || request.method !== 'POST') {
        response.writeHead(404).end()
        return
      }
      const protocol = new Server(
        { name: 'presentation-fixture', version: '1' },
        { capabilities: { tools: {}, resources: {} } }
      )
      protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: 'show_report',
            title: reflectCredential
              ? String(request.headers['x-fixture-token'])
              : 'Quarterly report',
            inputSchema: { type: 'object' as const },
            _meta: appAvailable ? { ui: { resourceUri: appUri } } : {},
          },
          {
            name: 'change_report',
            inputSchema: { type: 'object' as const },
            _meta: { ui: { visibility: ['app'] } },
          },
          {
            name: 'model_only',
            inputSchema: { type: 'object' as const },
            _meta: { ui: { visibility: ['model'] } },
          },
        ],
      }))
      protocol.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        if (params.name === 'change_report') {
          appCalls++
          return {
            content: [
              {
                type: 'text' as const,
                text: reflectCredential
                  ? String(request.headers['x-fixture-token'])
                  : `Revision ${appCalls}`,
              },
            ],
          }
        }
        if (params.arguments?.malformed)
          return { content: [{ type: 'image', mimeType: 'image/png', data: 'YR==' }] }
        return {
          content: [
            { type: 'text' as const, text: 'Report ready' },
            {
              type: 'resource' as const,
              resource: {
                uri: sourceUri,
                mimeType: 'text/plain',
                text: reflectCredential
                  ? String(request.headers['x-fixture-token'])
                  : typeof params.arguments?.revision === 'number'
                    ? `Revision ${params.arguments.revision}`
                    : 'Private report bytes',
              },
            },
          ],
          structuredContent: { total: 42 },
          _meta: {
            privateWidgetData: 'Only the app should receive this',
            ...(reflectCredential ? { credential: request.headers['x-fixture-token'] } : {}),
          },
        }
      })
      protocol.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
          {
            name: 'Report app',
            uri: appUri,
            mimeType: 'text/html;profile=mcp-app',
            _meta: { ui: { csp: { connectDomains: ['https://listed.test'] } } },
          },
        ],
      }))
      protocol.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => ({
        contents: [
          {
            uri: params.uri,
            mimeType: params.uri === appUri ? 'text/html;profile=mcp-app' : 'text/plain',
            text: reflectCredential
              ? `<p>${request.headers['x-fixture-token']}</p>`
              : params.uri === appUri
                ? '<!doctype html><p>Private app</p>'
                : 'Remote resource bytes',
            _meta: listingOnlyPolicy
              ? {}
              : { ui: { csp: { connectDomains: ['https://allowed.test'] } } },
          },
        ],
      }))
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: generateId,
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          if (transport) transports.set(id, transport)
        },
      })
      await protocol.connect(transport)
    }
    await transport.handleRequest(request, response)
  } catch {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  }
})

async function executeReport(args?: Record<string, unknown>) {
  const toolCallId = generateId()
  const context = {
    userId: owner,
    workspaceId,
    chatId,
    toolCallId,
    workflowId: '',
    copilotToolExecution: true as const,
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
      userId: owner,
      workspaceId,
    }),
  }
  const response = await executeMcpTool({
    toolId: 'mcp_run_operation',
    input: { server: serverId, tool: 'show_report', arguments: args ?? {} },
    headers: new Headers(),
    requestId: toolCallId,
    context: {
      ...context,
      billingAttribution: await resolveBillingAttribution({ actorUserId: owner, workspaceId }),
    },
  })
  const body = toRecord(await response.json())
  expect(response.status, JSON.stringify(body)).toBe(200)
  const result = { success: body.success === true, output: body.output }
  expect(result.success).toBe(true)
  const receipt = compactMcpPresentation(result.output)
  if (!receipt) throw new Error('Provider output did not produce a native presentation')
  const message: PersistedMessage = {
    id: generateId(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
    contentBlocks: [
      {
        type: 'tool',
        phase: 'call',
        toolCall: { id: toolCallId, name: `mcp-${serverId}-show_report`, state: 'success', result },
      },
    ],
  }
  for (const key of mcpPresentationCleanupKeys(chatId, message)) blobs.add(key)
  return { result, receipt: receipt.mcpPresentation, message }
}

beforeAll(async () => {
  Object.assign(env, { EGRESS_ALLOWED_HOSTS: '127.0.0.1' })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Provider fixture failed to bind')
  origin = `http://127.0.0.1:${address.port}/mcp`
  await db.insert(user).values(
    [owner, stranger].map((id) => ({
      id,
      name: 'MCP presentation fixture',
      email: `${id}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(workspace).values({
    id: workspaceId,
    name: 'MCP presentation fixture',
    ownerId: owner,
    billedAccountUserId: owner,
  })
  await db.insert(permissions).values(
    [owner, stranger].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin' as const,
    }))
  )
  await db.insert(copilotChats).values(
    [chatId, forkId].map((id) => ({
      id,
      userId: owner,
      workspaceId,
      type: 'mothership' as const,
    }))
  )
  await db.insert(environment).values({
    id: owner,
    userId: owner,
    variables: { MCP_APP_SECRET: (await encryptSecret(credentialCanary)).encrypted },
  })
  await db.insert(mcpServers).values({
    id: serverId,
    workspaceId,
    name: 'Fixture',
    transport: 'streamable-http',
    url: origin,
    authType: 'none',
    headers: { 'x-fixture-token': '{{MCP_APP_SECRET}}' },
    createdBy: owner,
  })
})

afterAll(async () => {
  await evictMcpServerConnections(serverId, 'fixture cleanup')
  for (const transport of transports.values()) await transport.close()
  await new Promise<void>((resolve) => {
    provider.close(() => resolve())
    provider.closeAllConnections()
  })
  for (const key of blobs) await deleteFile({ key, context: 'mothership' })
  await db.delete(workspace).where(eq(workspace.id, workspaceId))
  await db.delete(user).where(inArray(user.id, [owner, stranger]))
  await db.$client.end()
})

describe('native MCP results over real transport, storage and Postgres', () => {
  it('reopens bytes after transcript stripping and keeps private widget metadata outside model output', async () => {
    const { result, receipt, message } = await executeReport()
    expect(JSON.stringify(result.output)).not.toContain('Only the app should receive this')
    expect(JSON.stringify(result.output)).not.toContain('Private report bytes')
    await appendCopilotChatMessages(chatId, [message])
    const restored = await loadCopilotChatMessages(chatId)
    expect(
      compactMcpPresentation(restored[0].contentBlocks?.[0].toolCall?.result?.output)
        ?.mcpPresentation.id
    ).toBe(receipt.id)
    const asset = await readMcpResultAsset.execute({
      principal: session,
      input: { chatId, id: receipt.id, index: 1 },
    })
    expect(asset.buffer.toString()).toBe('Private report bytes')
    const reopened = await readMcpResult.execute({
      principal: session,
      input: { chatId, id: receipt.id },
    })
    expect(reopened.result._meta?.privateWidgetData).toBe('Only the app should receive this')
    const plan = planForkMcpPresentations([message], chatId, forkId)
    for (const task of plan) blobs.add(task.targetKey)
    expect((await executeChatFileBlobCopies(plan)).failed).toBe(0)
    expect(
      (
        await readMcpResultAsset.execute({
          principal: session,
          input: { chatId: forkId, id: receipt.id, index: 1 },
        })
      ).buffer.toString()
    ).toBe('Private report bytes')
  })

  it('denies another member of the same workspace and forged snapshot addresses', async () => {
    const { receipt } = await executeReport()
    await expect(
      readMcpResult.execute({
        principal: createSessionPrincipal({ userId: stranger }),
        input: { chatId, id: receipt.id },
      })
    ).rejects.toThrow('Chat not found')
    await expect(
      readMcpResult.execute({ principal: session, input: { chatId: forkId, id: receipt.id } })
    ).rejects.toThrow('MCP result not found')
  })

  it('keeps app-only tools out of the model and enforces both App origin and target visibility', async () => {
    const { receipt } = await executeReport()
    const callsBefore = appCalls
    const schemas = await buildTaggedMcpToolSchemas(owner, workspaceId, [serverId])
    expect(schemas.some((tool) => tool.name.endsWith('change_report'))).toBe(false)
    const result = await callMcpAppTool.execute({
      principal: session,
      input: { chatId, id: receipt.id, name: 'change_report' },
    })
    expect(result.content).toEqual([{ type: 'text', text: `Revision ${callsBefore + 1}` }])
    await expect(
      callMcpAppTool.execute({
        principal: session,
        input: { chatId, id: receipt.id, name: 'model_only' },
      })
    ).rejects.toThrow('unavailable to this caller')
    appAvailable = false
    try {
      await expect(
        callMcpAppTool.execute({
          principal: session,
          input: { chatId, id: receipt.id, name: 'change_report' },
        })
      ).rejects.toThrow('originating MCP App')
    } finally {
      appAvailable = true
    }
    expect(appCalls).toBe(callsBefore + 1)
  })

  it('reads App resources through the recorded connection and stops live access when disabled', async () => {
    const { receipt } = await executeReport()
    const callsBeforeDisable = appCalls
    expect(
      (
        await readMcpAppResource.execute({
          principal: session,
          input: { chatId, id: receipt.id, uri: sourceUri },
        })
      ).contents[0]
    ).toMatchObject({ text: 'Remote resource bytes' })
    const frame = await readMcpAppFrame.execute({
      principal: session,
      input: { chatId, id: receipt.id },
    })
    expect(frame.buffer.toString()).not.toContain('Private report bytes')
    await updateMcpServerUseCase.execute({
      principal: session,
      input: { workspaceId, serverId, enabled: false },
    })
    try {
      await expect(
        callMcpAppTool.execute({
          principal: session,
          input: { chatId, id: receipt.id, name: 'change_report' },
        })
      ).rejects.toThrow()
    } finally {
      await updateMcpServerUseCase.execute({
        principal: session,
        input: { workspaceId, serverId, enabled: true },
      })
    }
    expect(appCalls).toBe(callsBeforeDisable)
  })
  it('updates one persisted artifact tab while retaining both immutable versions', async () => {
    const first = await executeReport({ revision: 1 })
    const second = await executeReport({ revision: 2 })
    const resources = [first, second].map(({ result }) =>
      extractResourcesFromToolResult('mcp_run_operation', undefined, result.output)
    )
    for (const list of resources)
      await changeChatResources.execute({
        principal: session,
        input: { chatId, change: { kind: 'upsert', resources: list } },
      })
    const [stored] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
    expect(stored.resources).toHaveLength(1)
    expect(toArray(stored.resources)[0]).toMatchObject({
      id: first.receipt.items[0].identity,
      mcp: { presentationId: second.receipt.id, index: 1 },
    })
    for (const [version, result] of [first, second].entries()) {
      const asset = await readMcpResultAsset.execute({
        principal: session,
        input: { chatId, id: result.receipt.id, index: 1 },
      })
      expect(asset.buffer.toString()).toBe(`Revision ${version + 1}`)
    }
  })

  it('rejects malformed provider bytes and aborts App calls before provider mutation', async () => {
    const { receipt } = await executeReport({ malformed: true })
    await expect(
      readMcpResultAsset.execute({
        principal: session,
        input: { chatId, id: receipt.id, index: 0 },
      })
    ).rejects.toThrow('Invalid MCP file encoding')
    const before = appCalls
    const controller = new AbortController()
    controller.abort()
    await expect(
      callMcpAppTool.execute({
        principal: session,
        input: { chatId, id: receipt.id, name: 'change_report', signal: controller.signal },
      })
    ).rejects.toThrow()
    expect(appCalls).toBe(before)
  })

  it('uses authenticated listing metadata when the App read omits its policy', async () => {
    const { receipt } = await executeReport()
    listingOnlyPolicy = true
    try {
      const frame = await readMcpAppFrame.execute({
        principal: session,
        input: { chatId, id: receipt.id },
      })
      expect(frame.policy).toContain('https://listed.test')
      expect(frame.policy).not.toContain('https://allowed.test')
    } finally {
      listingOnlyPolicy = false
    }
  })
  it('redacts resolved credential echoes from saved and live App data', async () => {
    reflectCredential = true
    try {
      const { receipt } = await executeReport()
      expect(receivedCredential).toBe(credentialCanary)
      const reopened = await readMcpResult.execute({
        principal: session,
        input: { chatId, id: receipt.id },
      })
      expect(reopened.result._meta?.credential).not.toBe(credentialCanary)
      expect(JSON.stringify(reopened)).not.toContain(credentialCanary)
      const live = await callMcpAppTool.execute({
        principal: session,
        input: { chatId, id: receipt.id, name: 'change_report' },
      })
      expect(JSON.stringify(live)).not.toContain(credentialCanary)
      const resource = await readMcpAppResource.execute({
        principal: session,
        input: { chatId, id: receipt.id, uri: sourceUri },
      })
      expect(JSON.stringify(resource)).not.toContain(credentialCanary)
      const frame = await readMcpAppFrame.execute({
        principal: session,
        input: { chatId, id: receipt.id },
      })
      const encoded = frame.buffer.toString().match(/atob\('([^']+)'\)/)?.[1]
      expect(encoded).toBeDefined()
      expect(Buffer.from(encoded ?? '', 'base64').toString()).not.toContain(credentialCanary)
    } finally {
      reflectCredential = false
    }
  })
})
