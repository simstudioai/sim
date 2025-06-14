import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import {
  workflow,
  workflowEdge,
  workflowLoop,
  workflowNode,
  workflowParallel,
  workspaceMember,
} from '@/db/schema'
import type {
  ConflictResolution,
  GranularSyncResponse,
} from '@/stores/workflows/granular-sync/types'

const logger = createLogger('GranularSyncAPI')

// Validation schemas
const NodeSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  type: z.string(),
  name: z.string(),
  positionX: z.number(),
  positionY: z.number(),
  subBlocks: z.record(z.any()).default({}),
  outputs: z.record(z.any()).default({}),
  enabled: z.boolean().default(true),
  horizontalHandles: z.boolean().optional(),
  isWide: z.boolean().optional(),
  height: z.number().optional(),
  advancedMode: z.boolean().optional(),
  data: z.record(z.any()).optional(),
  parentId: z.string().optional(),
  extent: z.string().optional(),
  version: z.number().default(1),
  lastModified: z.date().optional(),
  modifiedBy: z.string().optional(),
})

const EdgeSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.string().optional(),
  animated: z.boolean().optional(),
  style: z.record(z.any()).optional(),
  data: z.record(z.any()).optional(),
  version: z.number().default(1),
  lastModified: z.date().optional(),
  modifiedBy: z.string().optional(),
})

const LoopSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  nodes: z.array(z.string()).default([]),
  iterations: z.number().default(1),
  loopType: z.enum(['for', 'forEach']),
  forEachItems: z.any().optional(),
  executionState: z.record(z.any()).default({}),
  version: z.number().default(1),
  lastModified: z.date().optional(),
  modifiedBy: z.string().optional(),
})

const ParallelSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  nodes: z.array(z.string()).default([]),
  distribution: z.any().optional(),
  executionState: z.record(z.any()).default({}),
  version: z.number().default(1),
  lastModified: z.date().optional(),
  modifiedBy: z.string().optional(),
})

const GranularSyncPayloadSchema = z.object({
  workflowId: z.string(),
  workspaceId: z.string().optional(),
  clientId: z.string(),
  sessionId: z.string(),
  lastSyncTimestamp: z.date().optional(),
  // Add optional workflow metadata for creation
  workflowMetadata: z
    .object({
      name: z.string(),
      description: z.string().optional(),
      color: z.string().optional(),
      folderId: z.string().nullable().optional(),
      marketplaceData: z.any().nullable().optional(),
      state: z
        .object({
          blocks: z.record(z.any()).default({}),
          edges: z.array(z.any()).default([]),
          loops: z.record(z.any()).default({}),
          parallels: z.record(z.any()).default({}),
          lastSaved: z.number().optional(),
          isDeployed: z.boolean().optional(),
          deployedAt: z
            .union([z.string(), z.date()])
            .optional()
            .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
          isPublished: z.boolean().optional(),
          marketplaceData: z.any().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
  changes: z.object({
    nodes: z
      .object({
        created: z.array(NodeSchema).optional(),
        updated: z.array(NodeSchema).optional(),
        deleted: z.array(z.string()).optional(),
      })
      .optional(),
    edges: z
      .object({
        created: z.array(EdgeSchema).optional(),
        updated: z.array(EdgeSchema).optional(),
        deleted: z.array(z.string()).optional(),
      })
      .optional(),
    loops: z
      .object({
        created: z.array(LoopSchema).optional(),
        updated: z.array(LoopSchema).optional(),
        deleted: z.array(z.string()).optional(),
      })
      .optional(),
    parallels: z
      .object({
        created: z.array(ParallelSchema).optional(),
        updated: z.array(ParallelSchema).optional(),
        deleted: z.array(z.string()).optional(),
      })
      .optional(),
  }),
})

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized granular fetch attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const workspaceId = url.searchParams.get('workspaceId')

    logger.info(`[${requestId}] Fetching workflows in granular format`, { workspaceId })

    // Fetch workflows with granular components
    let workflows
    if (workspaceId) {
      // Verify workspace access
      const membership = await db
        .select()
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, workspaceId),
            eq(workspaceMember.userId, session.user.id)
          )
        )
        .limit(1)

      if (membership.length === 0) {
        return NextResponse.json({ error: 'Access denied to workspace' }, { status: 403 })
      }

      workflows = await db.select().from(workflow).where(eq(workflow.workspaceId, workspaceId))
    } else {
      workflows = await db.select().from(workflow).where(eq(workflow.userId, session.user.id))
    }

    // Fetch granular components for each workflow
    const workflowsWithComponents = await Promise.all(
      workflows.map(async (wf) => {
        const [nodes, edges, loops, parallels] = await Promise.all([
          db.select().from(workflowNode).where(eq(workflowNode.workflowId, wf.id)),
          db.select().from(workflowEdge).where(eq(workflowEdge.workflowId, wf.id)),
          db.select().from(workflowLoop).where(eq(workflowLoop.workflowId, wf.id)),
          db.select().from(workflowParallel).where(eq(workflowParallel.workflowId, wf.id)),
        ])

        return {
          id: wf.id,
          name: wf.name,
          description: wf.description,
          color: wf.color,
          lastSynced: wf.lastSynced,
          isDeployed: wf.isDeployed,
          deployedAt: wf.deployedAt,
          createdAt: wf.createdAt,
          marketplaceData: wf.marketplaceData,
          workspaceId: wf.workspaceId,
          folderId: wf.folderId,
          // Granular components
          nodes,
          edges,
          loops,
          parallels,
        }
      })
    )

    const elapsed = Date.now() - startTime
    logger.info(
      `[${requestId}] Fetched ${workflowsWithComponents.length} workflows in ${elapsed}ms`
    )

    return NextResponse.json({ data: workflowsWithComponents })
  } catch (error) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Granular fetch error after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized granular sync attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const payload = GranularSyncPayloadSchema.parse(body)

    logger.info(`[${requestId}] Granular sync request for workflow ${payload.workflowId}`, {
      clientId: payload.clientId,
      sessionId: payload.sessionId,
      changes: {
        nodes: {
          created: payload.changes.nodes?.created?.length || 0,
          updated: payload.changes.nodes?.updated?.length || 0,
          deleted: payload.changes.nodes?.deleted?.length || 0,
        },
        edges: {
          created: payload.changes.edges?.created?.length || 0,
          updated: payload.changes.edges?.updated?.length || 0,
          deleted: payload.changes.edges?.deleted?.length || 0,
        },
        loops: {
          created: payload.changes.loops?.created?.length || 0,
          updated: payload.changes.loops?.updated?.length || 0,
          deleted: payload.changes.loops?.deleted?.length || 0,
        },
        parallels: {
          created: payload.changes.parallels?.created?.length || 0,
          updated: payload.changes.parallels?.updated?.length || 0,
          deleted: payload.changes.parallels?.deleted?.length || 0,
        },
      },
    })

    const now = new Date()

    // Verify workflow exists and user has access
    const workflowRecord = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, payload.workflowId))
      .limit(1)

    let workflowData
    if (workflowRecord.length === 0) {
      // Workflow doesn't exist - create it if metadata is provided
      if (!payload.workflowMetadata) {
        return NextResponse.json(
          { error: 'Workflow not found and no metadata provided for creation' },
          { status: 404 }
        )
      }

      const metadata = payload.workflowMetadata
      const effectiveWorkspaceId = payload.workspaceId

      // Verify workspace access if specified
      if (effectiveWorkspaceId) {
        const membership = await db
          .select()
          .from(workspaceMember)
          .where(
            and(
              eq(workspaceMember.workspaceId, effectiveWorkspaceId),
              eq(workspaceMember.userId, session.user.id)
            )
          )
          .limit(1)

        if (membership.length === 0) {
          return NextResponse.json({ error: 'Access denied to workspace' }, { status: 403 })
        }
      }

      // Create the new workflow
      const newWorkflowData = {
        id: payload.workflowId,
        userId: session.user.id,
        workspaceId: effectiveWorkspaceId || null,
        folderId: metadata.folderId || null,
        name: metadata.name,
        description: metadata.description || undefined,
        color: metadata.color || undefined,
        state: metadata.state || {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        },
        marketplaceData: metadata.marketplaceData || null,
        isDeployed: metadata.state?.isDeployed || false,
        deployedAt: metadata.state?.deployedAt || null,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      }

      await db.insert(workflow).values(newWorkflowData)
      workflowData = newWorkflowData

      logger.info(`[${requestId}] Created new workflow ${payload.workflowId}`, {
        name: metadata.name,
        workspaceId: effectiveWorkspaceId,
      })
    } else {
      workflowData = workflowRecord[0]
    }

    // Check permissions
    const hasAccess = workflowData.userId === session.user.id
    if (!hasAccess) {
      // Check workspace membership if workflow has workspace
      if (workflowData.workspaceId) {
        const membership = await db
          .select()
          .from(workspaceMember)
          .where(
            and(
              eq(workspaceMember.workspaceId, workflowData.workspaceId),
              eq(workspaceMember.userId, session.user.id)
            )
          )
          .limit(1)

        if (membership.length === 0) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }
      } else {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const conflicts: ConflictResolution[] = []
    const appliedChanges = {
      nodes: 0,
      edges: 0,
      loops: 0,
      parallels: 0,
    }

    // Handle node changes
    if (payload.changes.nodes) {
      const nodeResults = await handleNodeChanges(
        payload.workflowId,
        payload.changes.nodes,
        session.user.id,
        now
      )
      appliedChanges.nodes = nodeResults.applied
      conflicts.push(...nodeResults.conflicts)
    }

    // Handle edge changes
    if (payload.changes.edges) {
      const edgeResults = await handleEdgeChanges(
        payload.workflowId,
        payload.changes.edges,
        session.user.id,
        now
      )
      appliedChanges.edges = edgeResults.applied
      conflicts.push(...edgeResults.conflicts)
    }

    // Handle loop changes
    if (payload.changes.loops) {
      const loopResults = await handleLoopChanges(
        payload.workflowId,
        payload.changes.loops,
        session.user.id,
        now
      )
      appliedChanges.loops = loopResults.applied
      conflicts.push(...loopResults.conflicts)
    }

    // Handle parallel changes
    if (payload.changes.parallels) {
      const parallelResults = await handleParallelChanges(
        payload.workflowId,
        payload.changes.parallels,
        session.user.id,
        now
      )
      appliedChanges.parallels = parallelResults.applied
      conflicts.push(...parallelResults.conflicts)
    }

    // Update workflow's lastSynced timestamp
    await db
      .update(workflow)
      .set({ lastSynced: now, updatedAt: now })
      .where(eq(workflow.id, payload.workflowId))

    const elapsed = Date.now() - startTime

    const response: GranularSyncResponse = {
      success: true,
      workflowId: payload.workflowId,
      serverTimestamp: now,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      appliedChanges,
    }

    logger.info(`[${requestId}] Granular sync completed in ${elapsed}ms`, {
      appliedChanges,
      conflicts: conflicts.length,
    })

    return NextResponse.json(response)
  } catch (error) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Granular sync error after ${elapsed}ms`, error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function handleNodeChanges(workflowId: string, nodeChanges: any, userId: string, now: Date) {
  let applied = 0
  const conflicts: ConflictResolution[] = []

  // Handle created nodes
  if (nodeChanges.created) {
    const nodesToCreate = nodeChanges.created.map((node: any) => ({
      ...node,
      workflowId,
      modifiedBy: userId,
      lastModified: now,
      createdAt: now,
      updatedAt: now,
    }))

    if (nodesToCreate.length > 0) {
      try {
        await db.insert(workflowNode).values(nodesToCreate)
        applied += nodesToCreate.length
      } catch (error: any) {
        // Handle duplicate key errors gracefully
        if (error.code === '23505' && error.constraint_name === 'workflow_node_pkey') {
          logger.warn(`Duplicate node creation attempt - nodes may already exist`, {
            workflowId,
            nodeIds: nodesToCreate.map((n: any) => n.id),
          })

          // Try to create nodes individually to identify which ones actually need creation
          for (const node of nodesToCreate) {
            try {
              await db.insert(workflowNode).values([node])
              applied++
            } catch (individualError: any) {
              if (individualError.code === '23505') {
                // Node already exists - update it instead
                try {
                  await db
                    .update(workflowNode)
                    .set({
                      ...node,
                      modifiedBy: userId,
                      lastModified: now,
                      updatedAt: now,
                    })
                    .where(eq(workflowNode.id, node.id))
                  applied++
                  logger.debug(`Updated existing node instead of creating: ${node.id}`)
                } catch (updateError) {
                  conflicts.push({
                    entityType: 'node',
                    entityId: node.id,
                    conflictType: 'concurrent_edit',
                    resolution: 'rejected',
                    serverVersion: null,
                    clientVersion: node,
                    reason: 'Failed to create or update node due to conflict',
                  })
                }
              } else {
                // Some other error - add to conflicts
                conflicts.push({
                  entityType: 'node',
                  entityId: node.id,
                  conflictType: 'concurrent_edit',
                  resolution: 'rejected',
                  serverVersion: null,
                  clientVersion: node,
                  reason: `Database error: ${individualError.message}`,
                })
              }
            }
          }
        } else {
          // Some other database error
          throw error
        }
      }
    }
  }

  // Handle updated nodes
  if (nodeChanges.updated) {
    for (const node of nodeChanges.updated) {
      try {
        await db
          .update(workflowNode)
          .set({
            ...node,
            modifiedBy: userId,
            lastModified: now,
            updatedAt: now,
          })
          .where(eq(workflowNode.id, node.id))
        applied++
      } catch (error) {
        conflicts.push({
          entityType: 'node',
          entityId: node.id,
          conflictType: 'concurrent_edit',
          resolution: 'rejected',
          serverVersion: null,
          clientVersion: node,
          reason: 'Update failed due to concurrent modification',
        })
      }
    }
  }

  // Handle deleted nodes
  if (nodeChanges.deleted) {
    for (const nodeId of nodeChanges.deleted) {
      await db.delete(workflowNode).where(eq(workflowNode.id, nodeId))
      applied++
    }
  }

  return { applied, conflicts }
}

async function handleEdgeChanges(workflowId: string, edgeChanges: any, userId: string, now: Date) {
  let applied = 0
  const conflicts: ConflictResolution[] = []

  // Handle created edges
  if (edgeChanges.created) {
    const edgesToCreate = edgeChanges.created.map((edge: any) => ({
      ...edge,
      workflowId,
      modifiedBy: userId,
      lastModified: now,
      createdAt: now,
      updatedAt: now,
    }))

    if (edgesToCreate.length > 0) {
      await db.insert(workflowEdge).values(edgesToCreate)
      applied += edgesToCreate.length
    }
  }

  // Handle updated edges
  if (edgeChanges.updated) {
    for (const edge of edgeChanges.updated) {
      try {
        await db
          .update(workflowEdge)
          .set({
            ...edge,
            modifiedBy: userId,
            lastModified: now,
            updatedAt: now,
          })
          .where(eq(workflowEdge.id, edge.id))
        applied++
      } catch (error) {
        conflicts.push({
          entityType: 'edge',
          entityId: edge.id,
          conflictType: 'concurrent_edit',
          resolution: 'rejected',
          serverVersion: null,
          clientVersion: edge,
          reason: 'Update failed due to concurrent modification',
        })
      }
    }
  }

  // Handle deleted edges
  if (edgeChanges.deleted) {
    for (const edgeId of edgeChanges.deleted) {
      await db.delete(workflowEdge).where(eq(workflowEdge.id, edgeId))
      applied++
    }
  }

  return { applied, conflicts }
}

async function handleLoopChanges(workflowId: string, loopChanges: any, userId: string, now: Date) {
  let applied = 0
  const conflicts: ConflictResolution[] = []

  // Handle created loops
  if (loopChanges.created) {
    const loopsToCreate = loopChanges.created.map((loop: any) => ({
      ...loop,
      workflowId,
      modifiedBy: userId,
      lastModified: now,
      createdAt: now,
      updatedAt: now,
    }))

    if (loopsToCreate.length > 0) {
      await db.insert(workflowLoop).values(loopsToCreate)
      applied += loopsToCreate.length
    }
  }

  // Handle updated loops
  if (loopChanges.updated) {
    for (const loop of loopChanges.updated) {
      try {
        await db
          .update(workflowLoop)
          .set({
            ...loop,
            modifiedBy: userId,
            lastModified: now,
            updatedAt: now,
          })
          .where(eq(workflowLoop.id, loop.id))
        applied++
      } catch (error) {
        conflicts.push({
          entityType: 'loop',
          entityId: loop.id,
          conflictType: 'concurrent_edit',
          resolution: 'rejected',
          serverVersion: null,
          clientVersion: loop,
          reason: 'Update failed due to concurrent modification',
        })
      }
    }
  }

  // Handle deleted loops
  if (loopChanges.deleted) {
    for (const loopId of loopChanges.deleted) {
      await db.delete(workflowLoop).where(eq(workflowLoop.id, loopId))
      applied++
    }
  }

  return { applied, conflicts }
}

async function handleParallelChanges(
  workflowId: string,
  parallelChanges: any,
  userId: string,
  now: Date
) {
  let applied = 0
  const conflicts: ConflictResolution[] = []

  // Handle created parallels
  if (parallelChanges.created) {
    const parallelsToCreate = parallelChanges.created.map((parallel: any) => ({
      ...parallel,
      workflowId,
      modifiedBy: userId,
      lastModified: now,
      createdAt: now,
      updatedAt: now,
    }))

    if (parallelsToCreate.length > 0) {
      await db.insert(workflowParallel).values(parallelsToCreate)
      applied += parallelsToCreate.length
    }
  }

  // Handle updated parallels
  if (parallelChanges.updated) {
    for (const parallel of parallelChanges.updated) {
      try {
        await db
          .update(workflowParallel)
          .set({
            ...parallel,
            modifiedBy: userId,
            lastModified: now,
            updatedAt: now,
          })
          .where(eq(workflowParallel.id, parallel.id))
        applied++
      } catch (error) {
        conflicts.push({
          entityType: 'parallel',
          entityId: parallel.id,
          conflictType: 'concurrent_edit',
          resolution: 'rejected',
          serverVersion: null,
          clientVersion: parallel,
          reason: 'Update failed due to concurrent modification',
        })
      }
    }
  }

  // Handle deleted parallels
  if (parallelChanges.deleted) {
    for (const parallelId of parallelChanges.deleted) {
      await db.delete(workflowParallel).where(eq(workflowParallel.id, parallelId))
      applied++
    }
  }

  return { applied, conflicts }
}
