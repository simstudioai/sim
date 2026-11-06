import { db } from '@sim/db'
import {
  account,
  apiKey,
  changelogRelease,
  copilotChats,
  copilotMessages,
  customTools,
  dashboard,
  document,
  folder,
  knowledgeBase,
  member,
  organization,
  permissions,
  project,
  session,
  skill,
  subscription,
  user,
  userStats,
  userTableDefinitions,
  userTableRows,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowEdges,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workflowMcpServer,
  workflowMcpTool,
  workflowSubflows,
  workspace,
  workspaceEnvironment,
  workspaceFiles,
} from '@sim/db/schema'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { normalizeEmail } from '@sim/utils/string'
import { hashPassword } from 'better-auth/crypto'
import { inArray } from 'drizzle-orm'
import { encryptApiKey, hashApiKey } from '@/lib/api-key/crypto'
import { encryptSecret } from '@/lib/core/security/encryption'
import { parseDashboardSpec } from '@/lib/dashboards/spec'
import { createOwnedWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import {
  AGENT_WORKFLOW,
  API_KEYS,
  BLOCKS,
  CHATS,
  CUSTOM_TOOL_TITLE,
  DASHBOARD_TITLE,
  DELETED_FILE,
  EMPTY_WORKSPACE,
  EVERYONE,
  FILES,
  FREE,
  FREE_WORKSPACE,
  KNOWLEDGE_BASES,
  LOG_COUNT,
  ORDERS_TABLE_ID,
  ORGANIZATION_ID,
  ORGANIZATION_NAME,
  OWNER,
  PASSWORD,
  PERIOD_END_ISO,
  PERIOD_START_ISO,
  POPULATED_WORKSPACE,
  RELEASES,
  SECOND_WORKFLOW,
  SECRET_NAMES,
  SEEDED_AT_ISO,
  SKILLS,
  TABLES,
  TEAMMATE,
  WORKFLOW_MCP_SERVER_NAME,
  WORKSPACES,
} from '@/scripts/workspace-visual-e2e/fixture'

/**
 * Seeds the workspaces `test-workspace-visual-e2e.ts` photographs. Ids and timestamps are constants
 * and a rerun starts over, so two runs against a fresh database render identically.
 */
assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '')

const seededAt = new Date(SEEDED_AT_ISO)
/** Sessions answer to the server's real clock; the frozen browser clock never sees this. */
const sessionExpiry = new Date(Date.now() + 7 * 86_400_000)
const passwordHash = await hashPassword(PASSWORD)
const workspaceId = POPULATED_WORKSPACE.id
const ownerId = OWNER.userId
const allUserIds = EVERYONE.map(({ userId }) => userId)

const dashboardContent = `title: ${DASHBOARD_TITLE}
time:
  from: "2026-01-01T00:00:00Z"
  to: "2026-02-01T00:00:00Z"
source:
  tableId: ${ORDERS_TABLE_ID}
blocks:
  - text: Orders received this month, by status.
  - row:
      - stat: Orders
        source:
          aggregate:
            total:
              op: count
      - stat: Largest order
        source:
          aggregate:
            largest:
              op: max
              field: col_quantity
  - chart: Orders by status
    source:
      groupBy: [col_status]
      aggregate:
        total:
          op: count
    option:
      xAxis:
        type: category
      yAxis:
        type: value
      series:
        - type: bar
  - table: Recent orders
    source:
      columns: [col_order, col_status, col_quantity]
      limit: 5
`
const { error: dashboardError } = parseDashboardSpec(dashboardContent)
if (dashboardError) throw new Error(`The seeded dashboard does not parse: ${dashboardError}`)

const canvasBlocks = [
  {
    id: BLOCKS.start,
    type: 'start_trigger',
    name: 'Start',
    position: { x: 0, y: 220 },
    subBlocks: {},
    data: {},
  },
  {
    id: BLOCKS.agent,
    type: 'agent',
    name: 'Agent',
    position: { x: 340, y: 220 },
    subBlocks: {
      model: { id: 'model', type: 'combobox', value: 'claude-sonnet-4-6' },
      messages: {
        id: 'messages',
        type: 'messages-input',
        value: [
          { role: 'system', content: 'Sort each order by urgency.' },
          { role: 'user', content: '<start.input>' },
        ],
      },
    },
    data: {},
  },
  {
    id: BLOCKS.loop,
    type: 'loop',
    name: 'Loop',
    position: { x: 720, y: 160 },
    subBlocks: {},
    data: { type: 'subflowNode', width: 460, height: 240, loopType: 'for', count: 3 },
  },
  {
    id: BLOCKS.loopChild,
    type: 'function',
    name: 'Format',
    position: { x: 150, y: 90 },
    subBlocks: { code: { id: 'code', type: 'code', value: 'return input' } },
    data: { parentId: BLOCKS.loop, extent: 'parent' },
  },
  {
    id: BLOCKS.note,
    type: 'note',
    name: 'Note',
    position: { x: 0, y: -60 },
    subBlocks: {
      content: { id: 'content', type: 'long-input', value: 'Runs every morning before the shift.' },
    },
    data: {},
  },
] as const

const canvasEdges = [
  ['workspace-visual-edge-1', BLOCKS.start, BLOCKS.agent, 'source'],
  ['workspace-visual-edge-2', BLOCKS.agent, BLOCKS.loop, 'source'],
  ['workspace-visual-edge-3', BLOCKS.loop, BLOCKS.loopChild, 'loop-start-source'],
] as const

const loopConfig = { id: BLOCKS.loop, nodes: [BLOCKS.loopChild], iterations: 3, loopType: 'for' }

const deployedState = {
  blocks: Object.fromEntries(
    canvasBlocks.map((block) => [block.id, { ...block, enabled: true, outputs: {} }])
  ),
  edges: canvasEdges.map(([id, source, target, sourceHandle]) => ({
    id,
    source,
    target,
    sourceHandle,
    targetHandle: 'target',
  })),
  loops: { [BLOCKS.loop]: loopConfig },
  parallels: {},
  variables: {},
  lastSaved: 0,
}

const encryptedSecrets = Object.fromEntries(
  await Promise.all(
    SECRET_NAMES.map(
      async (name) => [name, (await encryptSecret(`value-of-${name}`)).encrypted] as const
    )
  )
)
const apiKeyRows = await Promise.all(
  API_KEYS.map(async (name, index) => {
    const plain = `sk-sim-workspace-visual-${index}`
    return {
      id: `workspace-visual-api-key-${index}`,
      userId: ownerId,
      workspaceId,
      createdBy: ownerId,
      name,
      key: (await encryptApiKey(plain)).encrypted,
      keyHash: hashApiKey(plain),
      type: 'workspace',
      createdAt: seededAt,
      updatedAt: seededAt,
    }
  })
)

await db.transaction(async (tx) => {
  await tx.delete(workspace).where(inArray(workspace.ownerId, allUserIds))
  await tx.delete(project).where(inArray(project.ownerId, allUserIds))
  await tx.delete(organization).where(inArray(organization.id, [ORGANIZATION_ID]))
  await tx.delete(user).where(inArray(user.id, allUserIds))

  await tx.insert(user).values(
    EVERYONE.map(({ userId, email, name }) => ({
      id: userId,
      email,
      name,
      normalizedEmail: normalizeEmail(email),
      emailVerified: true,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )
  await tx
    .insert(userStats)
    .values(EVERYONE.map(({ userId }) => ({ id: `${userId}-stats`, userId })))
  await tx.insert(account).values(
    EVERYONE.map(({ userId }) => ({
      id: `${userId}-credential`,
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )

  await tx.insert(organization).values({
    id: ORGANIZATION_ID,
    name: ORGANIZATION_NAME,
    slug: 'workspace-visual',
    orgUsageLimit: '1000',
    createdAt: seededAt,
  })
  await tx.insert(member).values([
    {
      id: 'workspace-visual-member-owner',
      userId: ownerId,
      organizationId: ORGANIZATION_ID,
      role: 'owner',
    },
    {
      id: 'workspace-visual-member-teammate',
      userId: TEAMMATE.userId,
      organizationId: ORGANIZATION_ID,
      role: 'member',
    },
  ])
  await tx.insert(session).values(
    EVERYONE.map(({ key, userId, sessionToken }) => ({
      id: `workspace-visual-session-row-${key}`,
      token: sessionToken,
      userId,
      activeOrganizationId: userId === FREE.userId ? null : ORGANIZATION_ID,
      expiresAt: sessionExpiry,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )
  await tx.insert(subscription).values({
    id: 'workspace-visual-subscription',
    plan: 'enterprise',
    referenceId: ORGANIZATION_ID,
    status: 'active',
    seats: 25,
    metadata: { plan: 'enterprise', referenceId: ORGANIZATION_ID, seats: 25, monthlyPrice: 100 },
    periodStart: new Date(PERIOD_START_ISO),
    periodEnd: new Date(PERIOD_END_ISO),
  })

  for (const { id, name } of [POPULATED_WORKSPACE, EMPTY_WORKSPACE]) {
    await tx.insert(project).values({ id, name, ownerId, organizationId: ORGANIZATION_ID })
    await tx.insert(workspace).values({
      id,
      projectId: id,
      name,
      ownerId,
      billedAccountUserId: ownerId,
      organizationId: ORGANIZATION_ID,
    })
  }
  await tx.insert(project).values({
    id: FREE_WORKSPACE.id,
    name: FREE_WORKSPACE.name,
    ownerId: FREE.userId,
  })
  await tx.insert(workspace).values({
    id: FREE_WORKSPACE.id,
    projectId: FREE_WORKSPACE.id,
    name: FREE_WORKSPACE.name,
    ownerId: FREE.userId,
    billedAccountUserId: FREE.userId,
  })
  await tx.insert(permissions).values(
    (
      [
        ['owner-populated', ownerId, workspaceId, 'admin'],
        ['owner-empty', ownerId, EMPTY_WORKSPACE.id, 'admin'],
        ['teammate-populated', TEAMMATE.userId, workspaceId, 'write'],
        ['free', FREE.userId, FREE_WORKSPACE.id, 'admin'],
      ] as const
    ).map(([key, userId, entityId, permissionType]) => ({
      id: `workspace-visual-permission-${key}`,
      userId,
      entityType: 'workspace',
      entityId,
      permissionType,
    }))
  )

  const workflowRow = {
    userId: ownerId,
    workspaceId,
    lastSynced: seededAt,
    createdAt: seededAt,
    updatedAt: seededAt,
  }
  await tx.insert(workflow).values([
    {
      ...workflowRow,
      id: AGENT_WORKFLOW.id,
      name: AGENT_WORKFLOW.name,
      isDeployed: true,
      deployedAt: seededAt,
    },
    { ...workflowRow, id: SECOND_WORKFLOW.id, name: SECOND_WORKFLOW.name, sortOrder: 1 },
  ])
  await tx.insert(workflowBlocks).values(
    canvasBlocks.map((block) => ({
      id: block.id,
      workflowId: AGENT_WORKFLOW.id,
      type: block.type,
      name: block.name,
      positionX: String(block.position.x),
      positionY: String(block.position.y),
      subBlocks: block.subBlocks,
      data: block.data,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )
  await tx.insert(workflowEdges).values(
    canvasEdges.map(([id, sourceBlockId, targetBlockId, sourceHandle]) => ({
      id,
      workflowId: AGENT_WORKFLOW.id,
      sourceBlockId,
      targetBlockId,
      sourceHandle,
      targetHandle: 'target',
    }))
  )
  await tx.insert(workflowSubflows).values({
    id: BLOCKS.loop,
    workflowId: AGENT_WORKFLOW.id,
    type: 'loop',
    config: loopConfig,
  })
  await tx.insert(workflowDeploymentVersion).values({
    id: 'workspace-visual-deployment-1',
    workflowId: AGENT_WORKFLOW.id,
    version: 1,
    state: deployedState,
    isActive: true,
    createdAt: seededAt,
    createdBy: ownerId,
  })

  await tx.insert(workflowExecutionSnapshots).values({
    id: 'workspace-visual-snapshot',
    workflowId: AGENT_WORKFLOW.id,
    stateHash: 'workspace-visual-snapshot',
    stateData: deployedState,
    createdAt: seededAt,
  })
  await tx.insert(workflowExecutionLogs).values(
    Array.from({ length: LOG_COUNT }, (_, index) => {
      const failed = index % 6 === 5
      const startedAt = new Date(seededAt.getTime() + index * 3_600_000)
      return {
        id: `workspace-visual-log-${index}`,
        workflowId: AGENT_WORKFLOW.id,
        workspaceId,
        executionId: `workspace-visual-execution-${index}`,
        stateSnapshotId: 'workspace-visual-snapshot',
        level: failed ? 'error' : 'info',
        status: failed ? 'failed' : 'completed',
        trigger: (['manual', 'api', 'schedule'] as const)[index % 3],
        startedAt,
        endedAt: new Date(startedAt.getTime() + 1_500 + index * 100),
        totalDurationMs: 1_500 + index * 100,
        executionData: { finalOutput: { result: `Order batch ${index}` }, traceSpans: [] },
        costTotal: '0.0125',
        createdAt: startedAt,
      }
    })
  )

  await tx.insert(folder).values(
    (['file', 'table', 'knowledge_base'] as const).map((resourceType) => ({
      id: `workspace-visual-folder-${resourceType}`,
      resourceType,
      name: 'Archive',
      userId: ownerId,
      workspaceId,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )
  await tx.insert(workspaceFiles).values([
    ...FILES.map(({ name, contentType, sizeBytes }, index) => ({
      id: `workspace-visual-file-${index}`,
      key: `workspace/workspace-visual-file-${index}`,
      userId: ownerId,
      workspaceId,
      context: 'workspace',
      originalName: name,
      displayName: name,
      contentType,
      sizeBytes,
      uploadedAt: seededAt,
      updatedAt: seededAt,
      contentUpdatedAt: seededAt,
    })),
    {
      id: 'workspace-visual-file-deleted',
      key: 'workspace/workspace-visual-file-deleted',
      userId: ownerId,
      workspaceId,
      context: 'workspace',
      originalName: DELETED_FILE,
      displayName: DELETED_FILE,
      contentType: 'text/csv',
      sizeBytes: 1_024,
      deletedAt: seededAt,
      uploadedAt: seededAt,
      updatedAt: seededAt,
      contentUpdatedAt: seededAt,
    },
  ])

  const orderRows = Array.from({ length: 8 }, (_, index) => ({
    col_order: `ORD-${1000 + index}`,
    col_status: ['Open', 'Shipped', 'Held'][index % 3],
    col_quantity: 10 + index * 5,
  }))
  await tx.insert(userTableDefinitions).values(
    TABLES.map((name, index) => ({
      id: `workspace-visual-table-${index}`,
      workspaceId,
      name,
      description: `${name} tracked by the mill.`,
      schema: {
        columns: [
          { id: 'col_order', name: 'Order', type: 'string' },
          { id: 'col_status', name: 'Status', type: 'string' },
          { id: 'col_quantity', name: 'Quantity', type: 'number' },
        ],
      },
      rowCount: name === TABLES[0] ? orderRows.length : 0,
      createdBy: ownerId,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )
  await tx.insert(userTableRows).values(
    orderRows.map((data, index) => ({
      id: `workspace-visual-row-${index}`,
      tableId: ORDERS_TABLE_ID,
      workspaceId,
      data,
      createdBy: ownerId,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )

  await tx.insert(knowledgeBase).values(
    KNOWLEDGE_BASES.map((name, index) => ({
      id: `workspace-visual-knowledge-${index}`,
      userId: ownerId,
      workspaceId,
      name,
      description: `Documents about ${name.toLowerCase()}.`,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )
  await tx.insert(document).values({
    id: 'workspace-visual-document',
    knowledgeBaseId: 'workspace-visual-knowledge-0',
    filename: 'Loom manual.pdf',
    fileUrl: 'https://example.com/loom-manual.pdf',
    fileSize: 90_112,
    mimeType: 'application/pdf',
    chunkCount: 12,
    tokenCount: 4_096,
    characterCount: 16_384,
    processingStatus: 'completed',
    uploadedAt: seededAt,
  })

  await tx.insert(skill).values(
    SKILLS.map(({ name, description }, index) => ({
      id: `workspace-visual-skill-${index}`,
      workspaceId,
      userId: ownerId,
      name,
      description,
      content: `# ${name}\n\n${description}`,
      createdAt: seededAt,
      updatedAt: seededAt,
    }))
  )
  await tx.insert(dashboard).values({
    id: 'workspace-visual-dashboard',
    workspaceId,
    content: dashboardContent,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: seededAt,
    updatedAt: seededAt,
  })

  await tx.insert(copilotChats).values(
    CHATS.map(({ id, title }, index) => ({
      id,
      userId: ownerId,
      workspaceId,
      type: 'mothership' as const,
      title,
      lastSeenAt: new Date(seededAt.getTime() + 60_000),
      createdAt: new Date(seededAt.getTime() - index * 60_000),
      updatedAt: new Date(seededAt.getTime() - index * 60_000),
    }))
  )
  await tx.insert(copilotMessages).values(
    CHATS.flatMap(({ id, title }) =>
      (
        [
          ['user', 1, `Tell me about ${title.toLowerCase()}.`],
          ['assistant', 2, `Here is what I found about ${title.toLowerCase()}.`],
        ] as const
      ).map(([role, seq, content]) => ({
        chatId: id,
        messageId: `${id}-${role}`,
        role,
        seq,
        content: { id: `${id}-${role}`, role, content, timestamp: SEEDED_AT_ISO },
      }))
    )
  )

  await tx.insert(apiKey).values(apiKeyRows)
  await tx.insert(workspaceEnvironment).values({
    id: 'workspace-visual-environment',
    workspaceId,
    variables: encryptedSecrets,
    createdAt: seededAt,
    updatedAt: seededAt,
  })
  await tx.insert(customTools).values({
    id: 'workspace-visual-custom-tool',
    workspaceId,
    userId: ownerId,
    title: CUSTOM_TOOL_TITLE,
    schema: {
      type: 'function',
      function: {
        name: CUSTOM_TOOL_TITLE,
        description: 'Look up an order by number.',
        parameters: {
          type: 'object',
          properties: { order: { type: 'string' } },
          required: ['order'],
        },
      },
    },
    code: 'return { order: params.order }',
    createdAt: seededAt,
    updatedAt: seededAt,
  })
  await tx.insert(workflowMcpServer).values({
    id: 'workspace-visual-mcp-server',
    workspaceId,
    createdBy: ownerId,
    name: WORKFLOW_MCP_SERVER_NAME,
    description: 'Mill workflows exposed as tools.',
    createdAt: seededAt,
    updatedAt: seededAt,
  })
  await tx.insert(workflowMcpTool).values({
    id: 'workspace-visual-mcp-tool',
    serverId: 'workspace-visual-mcp-server',
    workflowId: AGENT_WORKFLOW.id,
    toolName: 'order_triage',
    toolDescription: 'Triage an order.',
    createdAt: seededAt,
    updatedAt: seededAt,
  })
})

/** Release bodies are real workspace files, read back through the same path the page uses. */
for (const { title, version, reason } of RELEASES) {
  const releaseId = `workspace-visual-release-${version.join('-')}`
  await createOwnedWorkspaceFile({
    context: 'changelog',
    workspaceId,
    userId: ownerId,
    content: `## ${title}\n\n${reason}\n\n- Routes each order to the right queue.`,
    contentType: 'text/markdown',
    fileName: () => `${releaseId}.md`,
    insertOwner: async (tx, bodyFileId) =>
      tx.insert(changelogRelease).values({
        id: releaseId,
        workspaceId,
        title,
        versionMajor: version[0],
        versionMinor: version[1],
        versionPatch: version[2],
        bumpReason: reason,
        bodyFileId,
        publishedAt: seededAt,
        createdBy: ownerId,
        updatedBy: ownerId,
        createdAt: seededAt,
        updatedAt: seededAt,
      }),
  })
}

process.stdout.write(`Seeded ${WORKSPACES.length} workspaces of ${ORGANIZATION_ID}\n`)
process.exit(0)
