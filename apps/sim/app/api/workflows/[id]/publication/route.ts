import { db } from '@sim/db'
import { workflowPublication } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  authorizeWorkflowByWorkspacePermission,
  getActiveWorkflowContext,
} from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  getPublicationContract,
  type PublicationSettingsApi,
  updatePublicationContract,
} from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'

const logger = createLogger('WorkflowPublicationAPI')

type PublicationRow = typeof workflowPublication.$inferSelect

/** The safe defaults for a workflow that has never been published. */
const DEFAULT_SETTINGS: PublicationSettingsApi = {
  published: false,
  displayName: null,
  summary: null,
  description: null,
  fieldOverlay: null,
  exposeTrace: 'off',
  exposeBlocks: false,
  visibility: 'org',
  allowlistWorkspaceIds: null,
}

/** Projects a stored row to the wire settings shape (drops ids/timestamps). */
function toSettings(row: PublicationRow): PublicationSettingsApi {
  return {
    published: row.published,
    displayName: row.displayName ?? null,
    summary: row.summary ?? null,
    description: row.description ?? null,
    fieldOverlay: row.fieldOverlay ?? null,
    exposeTrace: row.exposeTrace === 'traceId' ? 'traceId' : 'off',
    exposeBlocks: row.exposeBlocks,
    visibility: row.visibility === 'allowlist' ? 'allowlist' : 'org',
    allowlistWorkspaceIds: row.allowlistWorkspaceIds ?? null,
  }
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    if (!(await isFeatureEnabled('api-reference-doc'))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getPublicationContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId } = parsed.data.params

    const authz = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: session.user.id,
      action: 'admin',
    })
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.message ?? 'Forbidden' }, { status: authz.status })
    }

    const [row] = await db
      .select()
      .from(workflowPublication)
      .where(eq(workflowPublication.workflowId, workflowId))
      .limit(1)

    return NextResponse.json({ publication: row ? toSettings(row) : DEFAULT_SETTINGS })
  }
)

export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    if (!(await isFeatureEnabled('api-reference-doc'))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updatePublicationContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId } = parsed.data.params
    const body = parsed.data.body

    const authz = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: session.user.id,
      action: 'admin',
    })
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.message ?? 'Forbidden' }, { status: authz.status })
    }

    const workflowContext = await getActiveWorkflowContext(workflowId)
    if (!workflowContext) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // The overlay may only annotate fields that actually exist in the active
    // deployment — it can never invent one. Validate before persisting.
    if (body.fieldOverlay && body.fieldOverlay.length > 0) {
      let validIds = new Set<string>()
      try {
        const deployed = await loadDeployedWorkflowState(workflowId, workflowContext.workspaceId)
        validIds = new Set(extractInputFieldsFromBlocks(deployed.blocks).map((f) => f.id ?? f.name))
      } catch {
        return NextResponse.json(
          { error: 'Cannot set a field overlay before the workflow is deployed.' },
          { status: 400 }
        )
      }
      const unknownField = body.fieldOverlay.find((entry) => !validIds.has(entry.id))
      if (unknownField) {
        return NextResponse.json(
          {
            error: `Overlay references input field \`${unknownField.id}\` which does not exist in the deployed workflow.`,
          },
          { status: 400 }
        )
      }
    }

    const [existing] = await db
      .select()
      .from(workflowPublication)
      .where(eq(workflowPublication.workflowId, workflowId))
      .limit(1)

    const merged: PublicationSettingsApi = {
      ...(existing ? toSettings(existing) : DEFAULT_SETTINGS),
      ...body,
    }

    if (existing) {
      await db
        .update(workflowPublication)
        .set({
          published: merged.published,
          displayName: merged.displayName,
          summary: merged.summary,
          description: merged.description,
          fieldOverlay: merged.fieldOverlay,
          exposeTrace: merged.exposeTrace,
          exposeBlocks: merged.exposeBlocks,
          visibility: merged.visibility,
          allowlistWorkspaceIds: merged.allowlistWorkspaceIds,
          organizationId: workflowContext.workspaceOrganizationId,
          workspaceId: workflowContext.workspaceId,
          updatedAt: new Date(),
        })
        .where(eq(workflowPublication.workflowId, workflowId))
    } else {
      await db.insert(workflowPublication).values({
        id: generateId(),
        workflowId,
        workspaceId: workflowContext.workspaceId,
        organizationId: workflowContext.workspaceOrganizationId,
        published: merged.published,
        displayName: merged.displayName,
        summary: merged.summary,
        description: merged.description,
        fieldOverlay: merged.fieldOverlay,
        exposeTrace: merged.exposeTrace,
        exposeBlocks: merged.exposeBlocks,
        visibility: merged.visibility,
        allowlistWorkspaceIds: merged.allowlistWorkspaceIds,
        createdBy: session.user.id,
      })
    }

    logger.info('Updated workflow publication', {
      workflowId,
      published: merged.published,
      visibility: merged.visibility,
    })
    return NextResponse.json({ publication: merged })
  }
)
