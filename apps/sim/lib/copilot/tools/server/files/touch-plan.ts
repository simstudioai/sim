import { createLogger } from '@sim/logger'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  canonicalizeVfsPath,
  decodeVfsPathSegments,
  encodeVfsPathSegments,
} from '@/lib/copilot/vfs/path-utils'
import { writeWorkspaceFileByPath } from '@/lib/copilot/vfs/resource-writer'
import { resolveWorkflowAliasForWorkspace } from '@/lib/copilot/vfs/workflow-alias-resolver'
import { isMothershipBetaFeaturesEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('TouchPlanServerTool')
const TOUCH_PLAN_TOOL_ID = 'touch_plan'

interface TouchPlanArgs {
  scope?: 'workspace' | 'workflow'
  workflowPath?: string
  name: string
  title?: string
  args?: Record<string, unknown>
}

interface TouchPlanResult {
  success: boolean
  message: string
  data?: {
    id: string
    name: string
    vfsPath: string
    backingVfsPath?: string
    scope: 'workspace' | 'workflow'
    workflowId?: string
  }
}

function normalizeWorkflowPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, '')
  const withoutKnownLeaf = trimmed
    .replace(/\/(meta|state|executions|deployment|versions|links)\.json$/, '')
    .replace(/\/changelog\.md$/, '')
    .replace(/\/\.plans$/, '')

  const canonical = canonicalizeVfsPath(withoutKnownLeaf)
  if (!canonical.startsWith('workflows/')) {
    throw new Error('workflowPath must be a canonical workflows/... VFS path')
  }
  return canonical
}

function normalizePlanRelativePath(name: string): string {
  const segments = decodeVfsPathSegments(name)
  if (segments.length === 0) {
    throw new Error('Plan name is required')
  }
  const leaf = segments.at(-1) ?? ''
  const leafWithExtension = leaf.includes('.') ? leaf : `${leaf}.md`
  return encodeVfsPathSegments([...segments.slice(0, -1), leafWithExtension])
}

export const touchPlanServerTool: BaseServerTool<TouchPlanArgs, TouchPlanResult> = {
  name: TOUCH_PLAN_TOOL_ID,
  async execute(params: TouchPlanArgs, context?: ServerToolContext): Promise<TouchPlanResult> {
    if (!isMothershipBetaFeaturesEnabled) {
      return { success: false, message: 'touch_plan is not available' }
    }
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')

    const nested = params.args
    const nestedScope = nested?.scope as TouchPlanArgs['scope'] | undefined
    const scope =
      params.scope ||
      nestedScope ||
      (params.workflowPath || nested?.workflowPath ? 'workflow' : 'workspace')
    const workflowPath = params.workflowPath || (nested?.workflowPath as string) || ''
    const name = params.name || (nested?.name as string) || ''
    if (!name) {
      return { success: false, message: 'touch_plan requires name' }
    }
    if (scope !== 'workspace' && scope !== 'workflow') {
      return { success: false, message: 'touch_plan scope must be "workspace" or "workflow"' }
    }
    if (scope === 'workflow' && !workflowPath) {
      return {
        success: false,
        message: 'touch_plan with workflow scope requires workflowPath and name',
      }
    }

    const planRelativePath = normalizePlanRelativePath(name)
    const aliasPath =
      scope === 'workspace'
        ? `.plans/${planRelativePath}`
        : `${normalizeWorkflowPath(workflowPath)}/.plans/${planRelativePath}`
    const alias = await resolveWorkflowAliasForWorkspace({ workspaceId, path: aliasPath })
    if (!alias || alias.kind !== 'plan_file') {
      return {
        success: false,
        message:
          scope === 'workflow'
            ? `Workflow not found for plan path: ${aliasPath}`
            : `Unsupported workspace plan path: ${aliasPath}`,
      }
    }

    assertServerToolNotAborted(context)
    const result = await writeWorkspaceFileByPath({
      workspaceId,
      userId: context.userId,
      target: {
        path: aliasPath,
        mode: 'create',
        mimeType: 'text/markdown',
      },
      buffer: Buffer.from('', 'utf-8'),
      inferredMimeType: 'text/markdown',
    })

    logger.info('Workflow plan touched via copilot', {
      workspaceId,
      workflowId: alias.scope === 'workflow' ? alias.workflowId : undefined,
      scope: alias.scope,
      vfsPath: result.vfsPath,
      backingVfsPath: result.backingVfsPath,
      userId: context.userId,
    })

    return {
      success: true,
      message: `${alias.scope === 'workspace' ? 'Workspace' : 'Workflow'} plan "${result.vfsPath}" created successfully`,
      data: {
        id: result.id,
        name: result.name,
        vfsPath: result.vfsPath,
        backingVfsPath: result.backingVfsPath,
        scope: alias.scope,
        workflowId: alias.scope === 'workflow' ? alias.workflowId : undefined,
      },
    }
  },
}
