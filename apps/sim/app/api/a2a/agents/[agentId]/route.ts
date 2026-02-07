import { db } from '@sim/db'
import { a2aAgent, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { generateAgentCard, generateSkillsFromWorkflow } from '@/lib/a2a/agent-card'
import type { AgentCapabilities, AgentSkill } from '@/lib/a2a/types'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getRedisClient } from '@/lib/core/config/redis'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('A2AAgentCardAPI')

export const dynamic = 'force-dynamic'

interface RouteParams {
  agentId: string
}

/**
 * GET - Returns the Agent Card for discovery
 */
export async function GET(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { agentId } = await params

  try {
    const [agent] = await db
      .select({
        agent: a2aAgent,
        workflow: workflow,
      })
      .from(a2aAgent)
      .innerJoin(workflow, eq(a2aAgent.workflowId, workflow.id))
      .where(eq(a2aAgent.id, agentId))
      .limit(1)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!agent.agent.isPublished) {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success) {
        return NextResponse.json({ error: 'Agent not published' }, { status: 404 })
      }
    }

    const agentCard = generateAgentCard(
      {
        id: agent.agent.id,
        name: agent.agent.name,
        description: agent.agent.description,
        version: agent.agent.version,
        capabilities: agent.agent.capabilities as AgentCapabilities,
        skills: agent.agent.skills as AgentSkill[],
      },
      {
        id: agent.workflow.id,
        name: agent.workflow.name,
        description: agent.workflow.description,
      }
    )

    return NextResponse.json(agentCard, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': agent.agent.isPublished ? 'public, max-age=3600' : 'private, no-cache',
      },
    })
  } catch (error) {
    logger.error('Error getting Agent Card:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT - Update an agent
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { agentId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [existingAgent] = await db
      .select()
      .from(a2aAgent)
      .where(eq(a2aAgent.id, agentId))
      .limit(1)

    if (!existingAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workspaceAccess = await checkWorkspaceAccess(existingAgent.workspaceId, auth.userId)
    if (!workspaceAccess.canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    if (
      body.skillTags !== undefined &&
      (!Array.isArray(body.skillTags) ||
        !body.skillTags.every((tag: unknown): tag is string => typeof tag === 'string'))
    ) {
      return NextResponse.json({ error: 'skillTags must be an array of strings' }, { status: 400 })
    }

    let skills = body.skills ?? existingAgent.skills
    if (body.skillTags !== undefined) {
      const agentName = body.name ?? existingAgent.name
      const agentDescription = body.description ?? existingAgent.description
      skills = generateSkillsFromWorkflow(agentName, agentDescription, body.skillTags)
    }

    const [updatedAgent] = await db
      .update(a2aAgent)
      .set({
        name: body.name ?? existingAgent.name,
        description: body.description ?? existingAgent.description,
        version: body.version ?? existingAgent.version,
        capabilities: body.capabilities ?? existingAgent.capabilities,
        skills,
        authentication: body.authentication ?? existingAgent.authentication,
        isPublished: body.isPublished ?? existingAgent.isPublished,
        publishedAt:
          body.isPublished && !existingAgent.isPublished ? new Date() : existingAgent.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(a2aAgent.id, agentId))
      .returning()

    logger.info(`Updated A2A agent: ${agentId}`)

    return NextResponse.json({ success: true, agent: updatedAgent })
  } catch (error) {
    logger.error('Error updating agent:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE - Delete an agent
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { agentId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [existingAgent] = await db
      .select()
      .from(a2aAgent)
      .where(eq(a2aAgent.id, agentId))
      .limit(1)

    if (!existingAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workspaceAccess = await checkWorkspaceAccess(existingAgent.workspaceId, auth.userId)
    if (!workspaceAccess.canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await db.delete(a2aAgent).where(eq(a2aAgent.id, agentId))

    logger.info(`Deleted A2A agent: ${agentId}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting agent:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST - Publish/unpublish an agent
 */
export async function POST(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { agentId } = await params

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      logger.warn('A2A agent publish auth failed:', { error: auth.error, hasUserId: !!auth.userId })
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const [existingAgent] = await db
      .select()
      .from(a2aAgent)
      .where(eq(a2aAgent.id, agentId))
      .limit(1)

    if (!existingAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workspaceAccess = await checkWorkspaceAccess(existingAgent.workspaceId, auth.userId)
    if (!workspaceAccess.canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const action = body.action as 'publish' | 'unpublish' | 'refresh'

    if (action === 'publish') {
      const [wf] = await db
        .select({ isDeployed: workflow.isDeployed })
        .from(workflow)
        .where(eq(workflow.id, existingAgent.workflowId))
        .limit(1)

      if (!wf?.isDeployed) {
        return NextResponse.json(
          { error: 'Workflow must be deployed before publishing agent' },
          { status: 400 }
        )
      }

      await db
        .update(a2aAgent)
        .set({
          isPublished: true,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(a2aAgent.id, agentId))

      const redis = getRedisClient()
      if (redis) {
        try {
          await redis.del(`a2a:agent:${agentId}:card`)
        } catch (err) {
          logger.warn('Failed to invalidate agent card cache', { agentId, error: err })
        }
      }

      logger.info(`Published A2A agent: ${agentId}`)
      return NextResponse.json({ success: true, isPublished: true })
    }

    if (action === 'unpublish') {
      await db
        .update(a2aAgent)
        .set({
          isPublished: false,
          updatedAt: new Date(),
        })
        .where(eq(a2aAgent.id, agentId))

      const redis = getRedisClient()
      if (redis) {
        try {
          await redis.del(`a2a:agent:${agentId}:card`)
        } catch (err) {
          logger.warn('Failed to invalidate agent card cache', { agentId, error: err })
        }
      }

      logger.info(`Unpublished A2A agent: ${agentId}`)
      return NextResponse.json({ success: true, isPublished: false })
    }

    if (action === 'refresh') {
      const workflowData = await loadWorkflowFromNormalizedTables(existingAgent.workflowId)
      if (!workflowData) {
        return NextResponse.json({ error: 'Failed to load workflow' }, { status: 500 })
      }

      const [wf] = await db
        .select({ name: workflow.name, description: workflow.description })
        .from(workflow)
        .where(eq(workflow.id, existingAgent.workflowId))
        .limit(1)

      const skills = generateSkillsFromWorkflow(wf?.name || existingAgent.name, wf?.description)

      await db
        .update(a2aAgent)
        .set({
          skills,
          updatedAt: new Date(),
        })
        .where(eq(a2aAgent.id, agentId))

      logger.info(`Refreshed skills for A2A agent: ${agentId}`)
      return NextResponse.json({ success: true, skills })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error('Error with agent action:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
