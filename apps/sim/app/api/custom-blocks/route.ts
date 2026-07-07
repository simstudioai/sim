import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  listCustomBlocksContract,
  publishCustomBlockContract,
} from '@/lib/api/contracts/custom-blocks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  CustomBlockValidationError,
  type CustomBlockWithInputs,
  listCustomBlocksWithInputs,
  publishCustomBlock,
} from '@/lib/workflows/custom-blocks/operations'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CustomBlocksAPI')

/** Wire shape for a custom block. Keeps the icon field name explicit for the client. */
function toWire(block: CustomBlockWithInputs) {
  return {
    id: block.id,
    organizationId: block.organizationId,
    workflowId: block.workflowId,
    workflowName: block.workflowName,
    workspaceName: block.workspaceName,
    type: block.type,
    name: block.name,
    description: block.description,
    iconUrl: block.iconUrl,
    enabled: block.enabled,
    inputFields: block.inputFields,
    exposedOutputs: block.exposedOutputs,
  }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listCustomBlocksContract, request, {})
  if (!parsed.success) return parsed.response

  const userId = session.user.id
  const { workspaceId } = parsed.data.query

  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.hasAccess) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const organizationId = access.workspace?.organizationId
  if (!organizationId) {
    return NextResponse.json({ enabled: false, customBlocks: [] })
  }

  if (!(await isFeatureEnabled('deploy-as-block', { userId, orgId: organizationId }))) {
    return NextResponse.json({ enabled: false, customBlocks: [] })
  }

  const enabled = await isOrganizationOnEnterprisePlan(organizationId)
  const blocks = enabled ? await listCustomBlocksWithInputs(organizationId) : []
  return NextResponse.json({ enabled, customBlocks: blocks.map(toWire) })
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(publishCustomBlockContract, request, {})
  if (!parsed.success) return parsed.response

  const userId = session.user.id
  const { workspaceId, workflowId, name, description, iconUrl, inputs, exposedOutputs } =
    parsed.data.body

  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.canAdmin) {
    return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
  }

  const organizationId = access.workspace?.organizationId
  if (!organizationId) {
    return NextResponse.json(
      { error: 'Publishing a block requires the workspace to belong to an organization' },
      { status: 400 }
    )
  }

  if (!(await isFeatureEnabled('deploy-as-block', { userId, orgId: organizationId }))) {
    return NextResponse.json({ error: 'Deploy as block is not enabled' }, { status: 403 })
  }

  if (!(await isOrganizationOnEnterprisePlan(organizationId))) {
    return NextResponse.json(
      { error: 'Deploy as block requires an enterprise plan' },
      { status: 403 }
    )
  }

  try {
    const block = await publishCustomBlock({
      organizationId,
      workspaceId,
      workflowId,
      userId,
      name,
      description,
      iconUrl,
      inputs,
      exposedOutputs,
    })
    recordAudit({
      workspaceId,
      actorId: userId,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.CUSTOM_BLOCK_PUBLISHED,
      resourceType: AuditResourceType.CUSTOM_BLOCK,
      resourceId: block.id,
      resourceName: block.name,
      description: `Published custom block "${block.name}"`,
      metadata: { organizationId, type: block.type, workflowId },
      request,
    })
    return NextResponse.json({ customBlock: toWire(block) })
  } catch (error) {
    if (error instanceof CustomBlockValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Failed to publish custom block', { error: getErrorMessage(error) })
    throw error
  }
})
