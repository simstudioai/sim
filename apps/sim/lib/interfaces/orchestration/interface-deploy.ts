import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflowInterface } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  type InterfaceSpec,
  isReservedInterfaceIdentifier,
  type OutputConfig,
  validateInterfaceSpec,
  workflowHasHitlBlocks,
} from '@/lib/interfaces'
import {
  loadDeployedApiStartInput,
  loadDraftApiStartInput,
} from '@/lib/interfaces/orchestration/load-api-start'
import {
  getWorkflowDeploymentSummary,
  performFullDeploy,
} from '@/lib/workflows/orchestration/deploy'
import { checkNeedsRedeployment } from '@/app/api/workflows/utils'

const logger = createLogger('InterfaceDeployOrchestration')

export interface InterfaceDeployPayload {
  workflowId: string
  userId: string
  identifier: string
  title: string
  description?: string
  versionDescription?: string
  versionName?: string
  customizations?: { primaryColor?: string; brief?: string }
  authType?: 'public'
  outputConfigs?: OutputConfig[]
  spec: unknown
  workspaceId?: string | null
}

export interface PerformInterfaceDeployResult {
  success: boolean
  interfaceId?: string
  interfaceUrl?: string
  deployedAt?: Date | null
  version?: number
  error?: string
}

function buildInterfaceUrl(identifier: string): string {
  const baseUrl = getBaseUrl()
  try {
    const url = new URL(baseUrl)
    let host = url.host
    if (host.startsWith('www.')) {
      host = host.substring(4)
    }
    return `${url.protocol}//${host}/interface/${identifier}`
  } catch {
    return `${baseUrl}/interface/${identifier}`
  }
}

export async function performInterfaceDeploy(
  params: InterfaceDeployPayload
): Promise<PerformInterfaceDeployResult> {
  const {
    workflowId,
    userId,
    identifier,
    title,
    description = '',
    authType = 'public',
    outputConfigs = [],
  } = params

  if (authType !== 'public') {
    return { success: false, error: 'Only public interfaces are supported' }
  }

  if (isReservedInterfaceIdentifier(identifier)) {
    return { success: false, error: 'This identifier is reserved' }
  }

  const customizations = {
    primaryColor: params.customizations?.primaryColor || 'var(--brand-hover)',
    ...(params.customizations?.brief ? { brief: params.customizations.brief } : {}),
  }

  const draftStart = await loadDraftApiStartInput(workflowId)
  if (!draftStart.ok) {
    return { success: false, error: draftStart.error }
  }

  const draftValidation = validateInterfaceSpec(params.spec, draftStart.data.fields, {
    outputConfigs,
    blocks: draftStart.draft.blocks,
    edges: draftStart.draft.edges,
  })
  if (!draftValidation.success || !draftValidation.spec) {
    return { success: false, error: draftValidation.error || 'Invalid interface spec' }
  }

  const deploymentSummary = await getWorkflowDeploymentSummary(workflowId)
  const attemptStatus = deploymentSummary.latestDeploymentAttempt?.status
  if (attemptStatus === 'preparing' || attemptStatus === 'activating') {
    return {
      success: false,
      error:
        'A workflow deployment is still preparing. Retry interface deployment after it becomes active.',
    }
  }

  const needsRedeploy =
    !deploymentSummary.activeDeployment || (await checkNeedsRedeployment(workflowId))

  let deployResult: Awaited<ReturnType<typeof performFullDeploy>> | null = null
  if (needsRedeploy) {
    deployResult = await performFullDeploy({
      workflowId,
      userId,
      versionDescription: params.versionDescription,
      versionName: params.versionName,
    })
    if (!deployResult.success) {
      return { success: false, error: deployResult.error || 'Failed to deploy workflow' }
    }
    if (deployResult.latestDeploymentAttempt?.status !== 'active') {
      return {
        success: false,
        error:
          deployResult.warnings?.[0] ??
          'Workflow deployment is still preparing. Retry interface deployment after it becomes active.',
      }
    }
  }

  const deployedStart = await loadDeployedApiStartInput(workflowId)
  if (!deployedStart.ok) {
    return { success: false, error: deployedStart.error }
  }

  if (workflowHasHitlBlocks(deployedStart.deployed.blocks as Record<string, { type: string }>)) {
    return {
      success: false,
      error: 'Human-in-the-loop workflows are not supported for interfaces',
    }
  }

  const activeValidation = validateInterfaceSpec(params.spec, deployedStart.data.fields, {
    outputConfigs,
    blocks: deployedStart.deployed.blocks as Record<
      string,
      {
        id?: string
        type: string
        name?: string
        triggerMode?: boolean
        subBlocks?: Record<string, unknown>
      }
    >,
    edges: deployedStart.deployed.edges as Array<{ source: string; target: string }>,
  })
  if (!activeValidation.success || !activeValidation.spec) {
    return {
      success: false,
      error: activeValidation.error || 'Interface needs republishing',
    }
  }

  const spec: InterfaceSpec = activeValidation.spec

  const [existingActive] = await db
    .select()
    .from(workflowInterface)
    .where(and(eq(workflowInterface.workflowId, workflowId), isNull(workflowInterface.archivedAt)))
    .limit(1)

  const [existingArchived] = existingActive
    ? [null]
    : await db
        .select()
        .from(workflowInterface)
        .where(eq(workflowInterface.workflowId, workflowId))
        .limit(1)

  const [identifierConflict] = await db
    .select({ id: workflowInterface.id, workflowId: workflowInterface.workflowId })
    .from(workflowInterface)
    .where(and(eq(workflowInterface.identifier, identifier), isNull(workflowInterface.archivedAt)))
    .limit(1)

  if (
    identifierConflict &&
    identifierConflict.workflowId !== workflowId &&
    identifierConflict.id !== existingActive?.id
  ) {
    return { success: false, error: 'Identifier is already in use' }
  }

  let interfaceId: string
  const now = new Date()

  if (existingActive) {
    interfaceId = existingActive.id
    await db
      .update(workflowInterface)
      .set({
        identifier,
        title,
        description: description || null,
        customizations,
        authType: 'public',
        outputConfigs,
        spec,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(workflowInterface.id, interfaceId))
  } else if (existingArchived) {
    interfaceId = existingArchived.id
    try {
      await db
        .update(workflowInterface)
        .set({
          identifier,
          title,
          description: description || null,
          customizations,
          authType: 'public',
          outputConfigs,
          spec,
          isActive: true,
          archivedAt: null,
          updatedAt: now,
        })
        .where(eq(workflowInterface.id, interfaceId))
    } catch {
      return {
        success: false,
        error: 'Identifier conflicts with another interface; choose a different identifier',
      }
    }
  } else {
    interfaceId = generateId()
    try {
      await db.insert(workflowInterface).values({
        id: interfaceId,
        workflowId,
        userId,
        identifier,
        title,
        description: description || null,
        customizations,
        isActive: true,
        authType: 'public',
        outputConfigs,
        spec,
        createdAt: now,
        updatedAt: now,
      })
    } catch {
      return { success: false, error: 'Identifier is already in use' }
    }
  }

  const interfaceUrl = buildInterfaceUrl(identifier)
  logger.info(`Interface "${title}" deployed successfully at ${interfaceUrl}`)

  try {
    const { PlatformEvents } = await import('@/lib/core/telemetry')
    PlatformEvents.interfaceDeployed({
      interfaceId,
      workflowId,
      authType: 'public',
      hasOutputConfigs: outputConfigs.length > 0,
    })
  } catch {
    // best-effort
  }

  recordAudit({
    workspaceId: params.workspaceId || null,
    actorId: userId,
    action: existingActive ? AuditAction.INTERFACE_UPDATED : AuditAction.INTERFACE_DEPLOYED,
    resourceType: AuditResourceType.INTERFACE,
    resourceId: interfaceId,
    resourceName: title,
    description: existingActive ? `Updated interface "${title}"` : `Deployed interface "${title}"`,
    metadata: {
      workflowId,
      identifier,
      authType: 'public',
      interfaceUrl,
      isUpdate: !!existingActive,
      hasOutputConfigs: outputConfigs.length > 0,
    },
  })

  return {
    success: true,
    interfaceId,
    interfaceUrl,
    deployedAt: deployResult?.deployedAt
      ? deployResult.deployedAt
      : deploymentSummary.activeDeployment
        ? new Date(deploymentSummary.activeDeployment.deployedAt)
        : null,
    version: deployResult?.version ?? deploymentSummary.activeDeployment?.version,
  }
}

export interface PerformInterfaceUndeployParams {
  interfaceId: string
  userId: string
  workspaceId?: string | null
}

export async function performInterfaceUndeploy(params: PerformInterfaceUndeployParams): Promise<{
  success: boolean
  error?: string
}> {
  const { interfaceId, userId, workspaceId } = params

  const [record] = await db
    .select({
      title: workflowInterface.title,
      workflowId: workflowInterface.workflowId,
      identifier: workflowInterface.identifier,
    })
    .from(workflowInterface)
    .where(eq(workflowInterface.id, interfaceId))
    .limit(1)

  if (!record) {
    return { success: false, error: 'Interface not found' }
  }

  await db.delete(workflowInterface).where(eq(workflowInterface.id, interfaceId))

  recordAudit({
    workspaceId: workspaceId || null,
    actorId: userId,
    action: AuditAction.INTERFACE_DELETED,
    resourceType: AuditResourceType.INTERFACE,
    resourceId: interfaceId,
    resourceName: record.title || interfaceId,
    description: `Deleted interface deployment "${record.title || interfaceId}"`,
    metadata: {
      workflowId: record.workflowId,
      identifier: record.identifier,
    },
  })

  return { success: true }
}
