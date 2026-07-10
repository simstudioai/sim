import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { canonicalizeVfsPath, canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import {
  fetchWorkspaceFileBuffer,
  listWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { uploadFile } from '@/lib/uploads/core/storage-service'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'
import {
  CustomBlockValidationError,
  type CustomBlockWithInputs,
  deleteCustomBlock,
  getCustomBlockWithInputsByWorkflowId,
  publishCustomBlock,
  updateCustomBlock,
} from '@/lib/workflows/custom-blocks/operations'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { ensureWorkflowAccess } from '../access'
import type { DeployCustomBlockParams } from '../param-types'

const MAX_ICON_BYTES = 5 * 1024 * 1024
const MAX_INPUT_ENTRIES = 50
const MAX_OUTPUT_ENTRIES = 50

/**
 * Resolve the agent-supplied icon reference to a publicly servable URL. A VFS
 * workspace-file path (`files/...`) is ingested: the file is copied into the
 * world-readable `workspace-logos` storage context (the same context the icon
 * upload UI writes to), because a raw workspace-file URL is membership-gated
 * and the block's icon must render for org members in other workspaces. Any
 * other non-empty value (an external or already-public URL) passes through.
 */
async function resolveIconUrl(
  raw: string | undefined,
  userId: string,
  workspaceId: string
): Promise<string | undefined> {
  const value = raw?.trim()
  if (!value) return undefined
  if (!value.startsWith('files/')) return value

  const canonical = canonicalizeVfsPath(value)
  const files = await listWorkspaceFiles(workspaceId, { hydrateFolderPaths: true })
  const record = files.find(
    (f) => canonicalWorkspaceFilePath({ folderPath: f.folderPath, name: f.name }) === canonical
  )
  if (!record) {
    throw new CustomBlockValidationError(`Icon file not found in this workspace: ${value}`)
  }
  if (!isImageFileType(record.type)) {
    throw new CustomBlockValidationError(
      'Icon file must be an image (PNG, JPEG, GIF, WebP, or SVG)'
    )
  }
  if (record.size > MAX_ICON_BYTES) {
    throw new CustomBlockValidationError('Icon file must be 5MB or smaller')
  }

  const buffer = await fetchWorkspaceFileBuffer(record)
  const safeFileName = record.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const uploaded = await uploadFile({
    file: buffer,
    fileName: record.name,
    contentType: record.type,
    context: 'workspace-logos',
    customKey: `workspace-logos/${Date.now()}-${generateShortId()}-${safeFileName}`,
    preserveKey: true,
    metadata: { workspaceId, userId, originalName: record.name },
  })
  return uploaded.path
}

function customBlockOutput(block: CustomBlockWithInputs, action: 'deploy' | 'undeploy') {
  const isDeployed = action === 'deploy'
  return {
    workflowId: block.workflowId,
    blockId: block.id,
    blockType: block.type,
    name: block.name,
    action,
    isDeployed,
    removed: !isDeployed,
    deploymentType: 'custom_block',
    deploymentStatus: {
      customBlock: {
        isDeployed,
        blockType: block.type,
        name: block.name,
        enabled: block.enabled,
      },
    },
    deploymentConfig: {
      customBlock: {
        blockType: block.type,
        name: block.name,
        description: block.description,
        iconUrl: block.iconUrl,
        inputFields: block.inputFields,
        exposedOutputs: block.exposedOutputs,
        organizationId: block.organizationId,
      },
    },
  }
}

export async function executeDeployCustomBlock(
  params: DeployCustomBlockParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'

    let workflowRecord: Awaited<ReturnType<typeof ensureWorkflowAccess>>['workflow']
    try {
      workflowRecord = (await ensureWorkflowAccess(workflowId, context.userId, 'admin')).workflow
    } catch (error) {
      const message = toError(error).message
      if (message.includes('not found')) {
        return { success: false, error: message }
      }
      return {
        success: false,
        error: "Managing a custom block requires admin permission on the workflow's workspace",
      }
    }
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return { success: false, error: 'Workflow must belong to a workspace' }
    }

    const ws = await getWorkspaceWithOwner(workspaceId)
    const organizationId = ws?.organizationId
    if (!organizationId) {
      return {
        success: false,
        error: 'Publishing a block requires the workspace to belong to an organization',
      }
    }
    if (
      !(await isFeatureEnabled('deploy-as-block', {
        userId: context.userId,
        orgId: organizationId,
      }))
    ) {
      return { success: false, error: 'Custom blocks are not enabled for this organization' }
    }

    const existing = await getCustomBlockWithInputsByWorkflowId(workflowId)

    if (action === 'undeploy') {
      if (!existing) {
        return { success: false, error: 'This workflow is not published as a custom block' }
      }
      await deleteCustomBlock(existing.id)
      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.CUSTOM_BLOCK_DELETED,
        resourceType: AuditResourceType.CUSTOM_BLOCK,
        resourceId: existing.id,
        resourceName: existing.name,
        description: `Unpublished custom block "${existing.name}"`,
        metadata: { organizationId, type: existing.type, workflowId, source: 'copilot' },
      })
      return { success: true, output: customBlockOutput(existing, 'undeploy') }
    }

    if (!(await isOrganizationOnEnterprisePlan(organizationId))) {
      return { success: false, error: 'Custom blocks require an enterprise plan' }
    }

    const name = params.name?.trim()
    const description = params.description?.trim()
    if (name && name.length > 60) {
      return { success: false, error: 'name must be 60 characters or fewer' }
    }
    if (description && description.length > 280) {
      return { success: false, error: 'description must be 280 characters or fewer' }
    }
    if (params.inputs && params.inputs.length > MAX_INPUT_ENTRIES) {
      return { success: false, error: `inputs must be ${MAX_INPUT_ENTRIES} entries or fewer` }
    }
    if (params.inputs?.some((entry) => !entry?.id?.trim())) {
      return { success: false, error: 'each inputs entry requires the trigger field id' }
    }
    if (params.inputs?.some((entry) => (entry.placeholder?.length ?? 0) > 200)) {
      return { success: false, error: 'input placeholders must be 200 characters or fewer' }
    }
    if (params.exposedOutputs && params.exposedOutputs.length > MAX_OUTPUT_ENTRIES) {
      return {
        success: false,
        error: `exposedOutputs must be ${MAX_OUTPUT_ENTRIES} entries or fewer`,
      }
    }
    if (
      params.exposedOutputs?.some(
        (entry) => !entry?.blockId?.trim() || !entry?.path?.trim() || !entry?.name?.trim()
      )
    ) {
      return {
        success: false,
        error: 'each exposedOutputs entry requires blockId, path, and name',
      }
    }
    if (params.exposedOutputs?.some((entry) => entry.name.length > 60)) {
      return { success: false, error: 'exposed output names must be 60 characters or fewer' }
    }
    const iconUrl = await resolveIconUrl(params.iconUrl, context.userId, workspaceId)

    if (existing) {
      await updateCustomBlock(existing.id, {
        name: name || undefined,
        description,
        iconUrl,
        inputs: params.inputs,
        exposedOutputs: params.exposedOutputs,
      })
      const updated = await getCustomBlockWithInputsByWorkflowId(workflowId)
      if (!updated) {
        return { success: false, error: 'Custom block not found after update' }
      }
      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.CUSTOM_BLOCK_UPDATED,
        resourceType: AuditResourceType.CUSTOM_BLOCK,
        resourceId: updated.id,
        resourceName: updated.name,
        description: `Updated custom block "${updated.name}"`,
        metadata: { organizationId, type: updated.type, workflowId, source: 'copilot' },
      })
      return { success: true, output: { ...customBlockOutput(updated, 'deploy'), updated: true } }
    }

    if (!name) {
      return { success: false, error: 'name is required when publishing a new custom block' }
    }
    if (!workflowRecord.isDeployed) {
      return {
        success: false,
        error:
          'Workflow must be deployed before publishing as a custom block. Use deploy_api first.',
      }
    }
    const block = await publishCustomBlock({
      organizationId,
      workspaceId,
      workflowId,
      userId: context.userId,
      name,
      description: description ?? '',
      iconUrl,
      inputs: params.inputs,
      exposedOutputs: params.exposedOutputs,
    })
    recordAudit({
      workspaceId,
      actorId: context.userId,
      action: AuditAction.CUSTOM_BLOCK_PUBLISHED,
      resourceType: AuditResourceType.CUSTOM_BLOCK,
      resourceId: block.id,
      resourceName: block.name,
      description: `Published custom block "${block.name}"`,
      metadata: { organizationId, type: block.type, workflowId, source: 'copilot' },
    })
    return { success: true, output: { ...customBlockOutput(block, 'deploy'), updated: false } }
  } catch (error) {
    if (error instanceof CustomBlockValidationError) {
      return { success: false, error: error.message }
    }
    return { success: false, error: toError(error).message }
  }
}
