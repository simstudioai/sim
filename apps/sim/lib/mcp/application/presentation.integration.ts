import { createServer } from 'node:http'
import { json } from 'node:stream/consumers'
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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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
import { loadMcpPresentation } from '@/lib/mcp/presentation-storage'
import { mcpService } from '@/lib/mcp/service'
import { changeChatResources } from '@/lib/mothership/chat/application/change-resources'
import {
  callMcpAppTool,
  readMcpAppFrame,
  readMcpAppResource,
  readMcpResult,
  readMcpResultAsset,
  readMcpResultMetadata,
} from '@/lib/mothership/chat/application/mcp-results'
import { executeChatFileBlobCopies } from '@/lib/mothership/chat/fork-chat-files'
import { loadCopilotChatMessages } from '@/lib/mothership/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import { buildTaggedMcpToolSchemas } from '@/lib/mothership/mcp-tools'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import {
  type ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

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
let encodedCredential = false
let encodedMimeType = 'text/plain'
let encodedCharset: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8'
let receivedCredential: string | string[] | undefined
const session = createSessionPrincipal({ userId: owner })
const transports = new Map<string, StreamableHTTPServerTransport>()
const blobs = new Set<string>()
let appCalls = 0
let appAvailable = true
let listingOnlyPolicy = false
let providerTitle = 'Quarterly report'
let linkedReportText = 'Remote resource bytes'
let linkedResourceMissing = false
let resourceReads = 0
let echoAppUri = false
let connectDomain = 'https://allowed.test'
let rejectResourceStatus = 0
let rejectResourcesPersistently = false
let rejectedResourceReads = 0
let rejectedSession: string | undefined
let origin = ''
const provider = createServer(async (request, response) => {
  try {
    const body = request.method === 'POST' ? toRecord(await json(request)) : undefined
    if (body?.method === 'resources/read' && rejectResourceStatus) {
      response.writeHead(rejectResourceStatus).end()
      rejectedResourceReads++
      rejectedSession ??= String(request.headers['mcp-session-id'])
      if (!rejectResourcesPersistently) rejectResourceStatus = 0
      return
    }
    if (body?.method === 'resources/read' && rejectedSession) {
      if (request.headers['mcp-session-id'] === rejectedSession) {
        response.writeHead(404).end()
        return
      }
      rejectedSession = undefined
    }
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
            title: reflectCredential ? String(request.headers['x-fixture-token']) : providerTitle,
            inputSchema: { type: 'object' as const },
            _meta: appAvailable
              ? {
                  ui: {
                    resourceUri: echoAppUri ? `${appUri}/${credentialCanary}` : appUri,
                    visibility: ['model'],
                  },
                }
              : {},
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
          if (params.arguments?.linked)
            return {
              content: [
                { type: 'resource_link', name: 'Report', uri: sourceUri, mimeType: 'text/plain' },
              ],
            }
          if (encodedCredential)
            return {
              content: [
                {
                  type: 'resource',
                  resource: {
                    uri: sourceUri,
                    mimeType: `${encodedMimeType}; charset=${encodedCharset}`,
                    blob: encodeFixtureText(
                      `Encoded report: ${request.headers['x-fixture-token']}:end`
                    ),
                  },
                },
              ],
            }
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
        if (params.arguments?.linked) {
          if (typeof params.arguments.revision === 'number')
            linkedReportText = `Revision ${params.arguments.revision}`
          return {
            content: [
              {
                type: 'resource_link',
                name: providerTitle,
                title: providerTitle,
                uri: sourceUri,
                mimeType: 'text/plain',
              },
              ...(linkedResourceMissing
                ? [
                    {
                      type: 'resource' as const,
                      resource: {
                        uri: 'file:///embedded.txt',
                        mimeType: 'text/plain',
                        blob: Buffer.from(`Encoded report: ${credentialCanary}:end`).toString(
                          'base64'
                        ),
                      },
                    },
                    {
                      type: 'resource_link' as const,
                      uri: 'file:///later.txt',
                      name: 'Later report',
                      mimeType: 'text/plain',
                    },
                  ]
                : []),
            ],
            _meta: { privateWidgetData: 'Only the app should receive this' },
          }
        }
        if (encodedCredential)
          return {
            content: [
              {
                type: 'resource',
                resource: {
                  uri: sourceUri,
                  mimeType: `${encodedMimeType}; charset=${encodedCharset}`,
                  blob: encodeFixtureText(
                    `Encoded report: ${request.headers['x-fixture-token']}:end`
                  ),
                },
              },
            ],
          }
        if (params.arguments?.unsupportedMedia)
          return {
            content: [
              {
                type: params.arguments.unsupportedMedia === 'image/tiff' ? 'image' : 'audio',
                mimeType: params.arguments.unsupportedMedia,
                data: Buffer.from('Unsupported fixture bytes').toString('base64'),
              },
            ],
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
      protocol.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
        resourceReads++
        if (linkedResourceMissing && params.uri === sourceUri)
          throw new Error('Synthetic missing linked resource')
        return {
          contents: [
            {
              uri: params.uri,
              mimeType: `${params.uri === appUri ? 'text/html;profile=mcp-app' : 'text/plain'}${encodedCredential ? `; charset=${encodedCharset}` : params.uri === appUri ? '; charset=utf-8' : ''}`,
              ...(encodedCredential
                ? {
                    blob: encodeFixtureText(
                      `<p>Encoded report: ${request.headers['x-fixture-token']}:end</p>`
                    ),
                  }
                : {
                    text: reflectCredential
                      ? `<p>${request.headers['x-fixture-token']}</p>`
                      : params.uri === appUri
                        ? '<!doctype html><p>Private app</p>'
                        : linkedReportText,
                  }),
              _meta: listingOnlyPolicy ? {} : { ui: { csp: { connectDomains: [connectDomain] } } },
            },
          ],
        }
      })
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: generateId,
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          if (transport) transports.set(id, transport)
        },
      })
      await protocol.connect(transport)
    }
    await transport.handleRequest(request, response, body)
  } catch {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  }
})

async function invokeReport(args?: Record<string, unknown>, toolCallId = generateId()) {
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
  return { result, toolCallId }
}

async function executeReport(args?: Record<string, unknown>, toolCallId = generateId()) {
  const { result } = await invokeReport(args, toolCallId)
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
  return { result, receipt: receipt.mcpPresentation, message, toolCallId }
}

function encodeFixtureText(text: string) {
  const bytes = Buffer.from(text, encodedCharset === 'utf-8' ? 'utf8' : 'utf16le')
  return (encodedCharset === 'utf-16be' ? bytes.swap16() : bytes).toString('base64')
}

function expectProtectedEncodedContent(blob: unknown) {
  if (typeof blob !== 'string') throw new Error('Expected encoded resource bytes')
  const text = Buffer.from(blob, 'base64').toString()
  expect(text).toContain('Encoded report: ')
  expect(text).toContain(':end')
  expect(text).not.toContain(credentialCanary)
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

afterEach(() => {
  linkedReportText = 'Remote resource bytes'
  linkedResourceMissing = false
  echoAppUri = false
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
    expect(JSON.stringify(result.output)).toContain('Private report bytes')
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
    const metadata = await readMcpResultMetadata.execute({
      principal: session,
      input: { chatId, id: receipt.id },
    })
    expect(metadata.receipt).toEqual(receipt)
    expect('result' in metadata || 'arguments' in metadata).toBe(false)
    expect(JSON.stringify(metadata)).not.toContain('Private report bytes')
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
  it.each([false, true])(
    'updates one persisted artifact tab while retaining immutable versions (linked=%s)',
    async (linked) => {
      const first = await executeReport({ revision: 1, linked })
      const second = await executeReport({ revision: 2, linked })
      await executeReport({ revision: 99, linked }, first.toolCallId)
      const index = linked ? 0 : 1
      const [stored] = await db
        .select({ resources: copilotChats.resources })
        .from(copilotChats)
        .where(eq(copilotChats.id, chatId))
      const matching = toArray(stored.resources).filter(
        (resource) => toRecord(resource).id === first.receipt.items[0].identity
      )
      expect(matching).toHaveLength(1)
      expect(matching[0]).toMatchObject({
        id: first.receipt.items[0].identity,
        mcp: { presentationId: second.receipt.id, index },
      })
      await updateMcpServerUseCase.execute({
        principal: session,
        input: { workspaceId, serverId, enabled: false },
      })
      try {
        for (const [version, result] of [first, second].entries()) {
          const asset = await readMcpResultAsset.execute({
            principal: session,
            input: { chatId, id: result.receipt.id, index },
          })
          expect(asset.buffer.toString()).toBe(`Revision ${version + 1}`)
        }
      } finally {
        await updateMcpServerUseCase.execute({
          principal: session,
          input: { workspaceId, serverId, enabled: true },
        })
      }
      await changeChatResources.execute({
        principal: session,
        input: {
          chatId,
          change: {
            kind: 'remove',
            resources: [{ type: 'mcp', id: first.receipt.items[0].identity }],
          },
        },
      })
      await executeReport({ revision: 99, linked }, first.toolCallId)
      const [closed] = await db
        .select({ resources: copilotChats.resources })
        .from(copilotChats)
        .where(eq(copilotChats.id, chatId))
      expect(
        toArray(closed.resources).some(
          (resource) => toRecord(resource).id === first.receipt.items[0].identity
        )
      ).toBe(false)
    }
  )

  it('preserves valid attachments and the App when a linked snapshot fails', async () => {
    linkedResourceMissing = true
    const { result, receipt } = await executeReport({ linked: true })
    expect(receipt.hasApp).toBe(true)
    expect(receipt.items.map((item) => item.index)).toEqual([1, 2])
    const asset = await readMcpResultAsset.execute({
      principal: session,
      input: { chatId, id: receipt.id, index: 1 },
    })
    expect(asset.buffer.toString()).toContain('Encoded report: ')
    expect(asset.buffer.toString()).not.toContain(credentialCanary)
    const later = await readMcpResultAsset.execute({
      principal: session,
      input: { chatId, id: receipt.id, index: 2 },
    })
    expect(later.buffer.toString()).toBe('Remote resource bytes')
    await expect(
      readMcpResultAsset.execute({
        principal: session,
        input: { chatId, id: receipt.id, index: 0 },
      })
    ).rejects.toThrow('MCP file not found')
    expect(JSON.stringify(result.output)).not.toContain('Only the app should receive this')
    expect(JSON.stringify(result.output)).not.toContain(
      Buffer.from(`Encoded report: ${credentialCanary}:end`).toString('base64')
    )
    expect(JSON.stringify(result.output)).toContain('could not be displayed')
  })

  it('does not download linked resources returned by a live App call', async () => {
    const { receipt } = await executeReport()
    const before = resourceReads
    const result = await callMcpAppTool.execute({
      principal: session,
      input: { chatId, id: receipt.id, name: 'change_report', arguments: { linked: true } },
    })
    expect(result.content[0]).toMatchObject({ type: 'resource_link', uri: sourceUri })
    expect(resourceReads).toBe(before)
  })

  it('redacts credentials reflected in the discovered App address before storage', async () => {
    echoAppUri = true
    const { receipt } = await executeReport()
    const manifest = await loadMcpPresentation(chatId, receipt.id)
    expect(manifest.appUri).toContain('ui://fixture/view.html/')
    expect(JSON.stringify(manifest)).not.toContain(credentialCanary)
  })

  it('redacts encoded credentials in linked snapshot bytes before reopening', async () => {
    encodedCredential = true
    try {
      const { receipt } = await executeReport({ linked: true })
      const asset = await readMcpResultAsset.execute({
        principal: session,
        input: { chatId, id: receipt.id, index: 0 },
      })
      expect(
        asset.buffer.includes(Buffer.from(encodeFixtureText(credentialCanary), 'base64'))
      ).toBe(false)
      expect(asset.buffer.toString()).toContain('Encoded report: ')
      expect(asset.buffer.toString()).toContain(':end')
      expect(asset.buffer.toString()).not.toContain(credentialCanary)
    } finally {
      encodedCredential = false
    }
  })

  it.each([
    ['audio/aiff', 'attachment'],
    ['image/tiff', 'attachment'],
    ['audio/ogg; codecs=opus', 'inline'],
  ] as const)('serves %s with %s disposition', async (mimeType, disposition) => {
    const { receipt } = await executeReport({ unsupportedMedia: mimeType })
    const asset = await readMcpResultAsset.execute({
      principal: session,
      input: { chatId, id: receipt.id, index: 0 },
    })
    expect(asset.disposition).toBe(disposition)
    expect(asset.buffer.toString()).toBe('Unsupported fixture bytes')
  })

  it('reports credentials once for both a cold and a pooled resource read', async () => {
    await evictMcpServerConnections(serverId, 'cold resource fixture')
    for (let invocation = 0; invocation < 2; invocation++) {
      const reports: ResolvedSecretTraceProvenanceV1[] = []
      const result = await mcpService.readResource({
        serverId,
        workspaceId,
        userId: owner,
        uri: sourceUri,
        onResolvedSecretTraceProvenance: (value) => reports.push(value),
      })
      expect(result.contents[0]).toMatchObject({ text: 'Remote resource bytes' })
      expect(reports).toHaveLength(1)
      expect(reports[0].complete).toBe(true)
      expect(reports[0].entries).toHaveLength(1)
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
  it('opens results with long provider tool and resource titles', async () => {
    providerTitle = 'Long report title '.repeat(20)
    try {
      const { receipt } = await executeReport({ linked: true })
      const asset = await readMcpResultAsset.execute({
        principal: session,
        input: { chatId, id: receipt.id, index: 0 },
      })
      expect(asset.buffer.toString()).toBe('Remote resource bytes')
    } finally {
      providerTitle = 'Quarterly report'
    }
  })

  it('rejects trailing-dot loopback domains in provider App policies', async () => {
    const { receipt } = await executeReport()
    try {
      for (const domain of [
        'https://localhost.',
        'https://sub.localhost.',
        'https://*.localhost.',
      ]) {
        connectDomain = domain
        await expect(
          readMcpAppFrame.execute({ principal: session, input: { chatId, id: receipt.id } })
        ).rejects.toThrow('local network addresses')
      }
    } finally {
      connectDomain = 'https://allowed.test'
    }
  })

  it('recovers resource reads after an upstream session or credential rejection', async () => {
    const { receipt } = await executeReport()
    try {
      for (const status of [400, 401, 404]) {
        rejectResourceStatus = status
        const result = await readMcpAppResource.execute({
          principal: session,
          input: { chatId, id: receipt.id, uri: sourceUri },
        })
        expect(result.contents[0]).toMatchObject({ text: 'Remote resource bytes' })
        expect(rejectResourceStatus).toBe(0)
      }
    } finally {
      rejectResourceStatus = 0
      rejectedSession = undefined
    }
  })

  it('stops retrying when the provider continues to reject resource reads', async () => {
    const { receipt } = await executeReport()
    rejectResourceStatus = 404
    rejectResourcesPersistently = true
    const before = rejectedResourceReads
    try {
      await expect(
        readMcpAppResource.execute({
          principal: session,
          input: { chatId, id: receipt.id, uri: sourceUri },
        })
      ).rejects.toThrow('Streamable HTTP error')
      expect(rejectedResourceReads - before).toBe(2)
    } finally {
      rejectResourceStatus = 0
      rejectResourcesPersistently = false
      rejectedSession = undefined
    }
  })

  it.each(['utf-8', 'utf-16le', 'utf-16be'] as const)(
    'redacts %s credentials in saved files and live App responses',
    async (charset) => {
      encodedCredential = true
      encodedCharset = charset
      try {
        const { receipt } = await executeReport()
        const asset = await readMcpResultAsset.execute({
          principal: session,
          input: { chatId, id: receipt.id, index: 0 },
        })
        expect(
          asset.buffer.includes(Buffer.from(encodeFixtureText(credentialCanary), 'base64'))
        ).toBe(false)
        expect(asset.buffer.toString()).toContain('Encoded report: ')
        expect(asset.buffer.toString()).not.toContain(credentialCanary)
        const saved = await readMcpResult.execute({
          principal: session,
          input: { chatId, id: receipt.id },
        })
        const savedResource = toRecord(toRecord(saved.result.content[0]).resource)
        expectProtectedEncodedContent(savedResource.blob)
        const live = await callMcpAppTool.execute({
          principal: session,
          input: { chatId, id: receipt.id, name: 'change_report' },
        })
        const liveResource = toRecord(toRecord(live.content[0]).resource)
        expectProtectedEncodedContent(liveResource.blob)
        const resource = await readMcpAppResource.execute({
          principal: session,
          input: { chatId, id: receipt.id, uri: sourceUri },
        })
        expectProtectedEncodedContent(toRecord(resource.contents[0]).blob)
        const frame = await readMcpAppFrame.execute({
          principal: session,
          input: { chatId, id: receipt.id },
        })
        const encoded = frame.buffer.toString().match(/atob\('([^']+)'\)/)?.[1]
        expectProtectedEncodedContent(encoded)
      } finally {
        reflectCredential = false
        encodedCredential = false
        encodedCharset = 'utf-8'
      }
    }
  )

  it('withholds protected bytes when an App declares an encoded binary file', async () => {
    const { receipt } = await executeReport()
    encodedCredential = true
    encodedMimeType = 'application/octet-stream'
    try {
      await expect(
        callMcpAppTool.execute({
          principal: session,
          input: { chatId, id: receipt.id, name: 'change_report' },
        })
      ).rejects.toThrow('MCP binary file contains protected content')
    } finally {
      encodedCredential = false
      encodedMimeType = 'text/plain'
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
