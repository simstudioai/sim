/**
 * A2A Agents List Endpoint
 *
 * List and create A2A agents for a workspace.
 */

import { db } from '@sim/db'
import { a2aAgent, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { generateSkillsFromWorkflow } from '@/lib/a2a/agent-card'
import { A2A_DEFAULT_CAPABILITIES } from '@/lib/a2a/constants'
import { sanitizeAgentName } from '@/lib/a2a/utils'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'
import { getWorkspaceById } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('A2AAgentsAPI')

export const dynamic = 'force-dynamic'

/**
 * GET - List all A2A agents for a workspace
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const ws = await getWorkspaceById(workspaceId)
    if (!ws) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const agents = await db
      .select({
        id: a2aAgent.id,
        workspaceId: a2aAgent.workspaceId,
        workflowId: a2aAgent.workflowId,
        name: a2aAgent.name,
        description: a2aAgent.description,
        version: a2aAgent.version,
        capabilities: a2aAgent.capabilities,
        skills: a2aAgent.skills,
        authentication: a2aAgent.authentication,
        isPublished: a2aAgent.isPublished,
        publishedAt: a2aAgent.publishedAt,
        createdAt: a2aAgent.createdAt,
        updatedAt: a2aAgent.updatedAt,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
        isDeployed: workflow.isDeployed,
        taskCount: sql<number>`(
          SELECT COUNT(*)::int 
          FROM "a2a_task" 
          WHERE "a2a_task"."agent_id" = "a2a_agent"."id"
        )`.as('task_count'),
      })
      .from(a2aAgent)
      .leftJoin(workflow, eq(a2aAgent.workflowId, workflow.id))
      .where(eq(a2aAgent.workspaceId, workspaceId))
      .orderBy(a2aAgent.createdAt)

    logger.info(`Listed ${agents.length} A2A agents for workspace ${workspaceId}`)

    return NextResponse.json({ success: true, agents })
  } catch (error) {
    logger.error('Error listing agents:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST - Create a new A2A agent from a workflow
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { workspaceId, workflowId, name, description, capabilities, authentication, skillTags } =
      body

    if (!workspaceId || !workflowId) {
      return NextResponse.json(
        { error: 'workspaceId and workflowId are required' },
        { status: 400 }
      )
    }

    const [wf] = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        workspaceId: workflow.workspaceId,
        isDeployed: workflow.isDeployed,
      })
      .from(workflow)
      .where(and(eq(workflow.id, workflowId), eq(workflow.workspaceId, workspaceId)))
      .limit(1)

    if (!wf) {
      return NextResponse.json(
        { error: 'Workflow not found or does not belong to workspace' },
        { status: 404 }
      )
    }

    const workflowData = await loadWorkflowFromNormalizedTables(workflowId)
    if (!workflowData || !hasValidStartBlockInState(workflowData)) {
      return NextResponse.json(
        { error: 'Workflow must have a Start block to be exposed as an A2A agent' },
        { status: 400 }
      )
    }

    const [existing] = await db
      .select({ id: a2aAgent.id })
      .from(a2aAgent)
      .where(and(eq(a2aAgent.workspaceId, workspaceId), eq(a2aAgent.workflowId, workflowId)))
      .limit(1)

    if (existing) {
      return NextResponse.json(
        { error: 'An agent already exists for this workflow' },
        { status: 409 }
      )
    }

    const skills = generateSkillsFromWorkflow(
      name || wf.name,
      description || wf.description,
      skillTags
    )

    const agentId = uuidv4()
    const agentName = name || sanitizeAgentName(wf.name)

    const [agent] = await db
      .insert(a2aAgent)
      .values({
        id: agentId,
        workspaceId,
        workflowId,
        createdBy: auth.userId,
        name: agentName,
        description: description || wf.description,
        version: '1.0.0',
        capabilities: {
          ...A2A_DEFAULT_CAPABILITIES,
          ...capabilities,
        },
        skills,
        authentication: authentication || {
          schemes: ['bearer', 'apiKey'],
        },
        isPublished: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    logger.info(`Created A2A agent ${agentId} for workflow ${workflowId}`)

    return NextResponse.json({ success: true, agent }, { status: 201 })
  } catch (error) {
    logger.error('Error creating agent:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
