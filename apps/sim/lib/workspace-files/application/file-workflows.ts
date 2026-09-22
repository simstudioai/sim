import { createHash } from 'node:crypto'
import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalSubjectUserId,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { authorizeWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getShareForResource, resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { workspaceFileDelegationPolicy } from '@/lib/workspace-files/application/authorization'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'
import { accessFileWorkflow } from '@/lib/workspace-files/workflows/execute'
import { prepareFileWorkflowInput } from '@/lib/workspace-files/workflows/input'
import { isWorkflowHtml } from '@/lib/workspace-files/workflows/types'

export interface FileWorkflowInput {
  fileId: string
  assertedWorkspaceId?: string
  workflowId: string
  input?: unknown
}

export function fileWorkflowAudience(parts: readonly (string | number)[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function audienceSubject(principal: Principal): string {
  const subject = resolvePrincipalSubjectUserId(principal)
  if (subject) return `user:${subject}`
  if (principal.kind === 'workspace_api_key') return `key:${principal.keyId}`
  throw new OrchestrationError('forbidden', 'Unsupported file workflow caller')
}

function executionCaller(principal: Principal): WorkflowExecutionPrincipal {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
    case 'oauth_access_token':
    case 'workspace_api_key':
      return principal
    case 'delegated':
      if (principal.serviceId === 'copilot') return principal
  }
  throw new OrchestrationError('forbidden', 'Unsupported private workflow caller')
}

async function resolveFileWorkflow(input: FileWorkflowInput) {
  const context = await resolveActiveWorkspaceFileContext(input)
  const [file] = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, context.fileId),
        eq(workspaceFiles.workspaceId, context.workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)
  if (!file || !isWorkflowHtml(file.contentType) || !file.workflowIds.includes(input.workflowId))
    throw new OrchestrationError('not_found', 'File workflow not found')
  const workflow = await resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: context.workspaceId,
  })
  if (!workflow.workflow.isDeployed)
    throw new OrchestrationError('conflict', 'Workflow is not deployed')
  return { ...context, file, workflow }
}

async function authorizeWorkflow(
  principal: Principal,
  context: Awaited<ReturnType<typeof resolveFileWorkflow>>,
  run: boolean
) {
  await authorizeWorkspaceOperation(
    principal,
    run ? workflowOperations.execute : workflowOperations.read,
    { ...context.workflow, fileId: context.fileId },
    { delegation: workspaceFileDelegationPolicy }
  )
}

function privateUseCase<
  const O extends typeof fileOperations.runWorkflow | typeof fileOperations.readWorkflowResult,
>(operation: O, run: boolean) {
  return defineAuthorizedWorkspaceFileUseCase({
    operation,
    resolveContext: ({ input }: { input: FileWorkflowInput }) => resolveFileWorkflow(input),
    authorizeResource: ({ principal, context }) => authorizeWorkflow(principal, context, run),
    async execute({ principal, input, context }) {
      const prepared = await prepareFileWorkflowInput(
        input.workflowId,
        context.workspaceId,
        input.input
      )
      const audience = fileWorkflowAudience([
        context.workspaceId,
        context.fileId,
        input.workflowId,
        context.file.workflowConfigVersion,
        audienceSubject(principal),
      ])
      const attribution = resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: context.billedAccountUserId,
      })
      return accessFileWorkflow({
        fileId: context.fileId,
        workflow: context.workflow,
        audience,
        ...prepared,
        principal: executionCaller(principal),
        userId: attribution.attributedUserId,
        publicAccess: false,
        run,
        async reauthorize() {
          const current = await resolveFileWorkflow(input)
          await authorizeWorkspaceOperation(principal, operation, current, {
            delegation: workspaceFileDelegationPolicy,
          })
          await authorizeWorkflow(principal, current, run)
          if (current.file.workflowConfigVersion !== context.file.workflowConfigVersion)
            throw new OrchestrationError('conflict', 'File workflow configuration changed')
        },
      })
    },
  })
}

export const runFileWorkflow = privateUseCase(fileOperations.runWorkflow, true)
export const readFileWorkflow = privateUseCase(fileOperations.readWorkflowResult, false)

function sharedMemberUseCase<
  const O extends typeof fileOperations.runWorkflow | typeof fileOperations.readWorkflowResult,
>(operation: O, run: boolean) {
  return defineAuthorizedWorkspaceFileUseCase({
    operation,
    resolveContext: ({ input }: { input: FileWorkflowInput }) => resolveFileWorkflow(input),
    authorizeResource: ({ principal, context }) => authorizeWorkflow(principal, context, run),
    async execute({ principal, input, context }) {
      const share = await getShareForResource('file', context.fileId)
      if (!share?.isActive) throw new OrchestrationError('not_found', 'Active file share not found')
      return accessSharedFileWorkflow({
        token: share.token,
        workflowId: input.workflowId,
        input: input.input,
        run,
        async authenticateShare(activeShare) {
          if (
            activeShare.resourceId !== context.fileId ||
            activeShare.workspaceId !== context.workspaceId
          )
            throw new OrchestrationError('not_found', 'File share changed')
          const current = await resolveFileWorkflow(input)
          await authorizeWorkspaceOperation(principal, operation, current, {
            delegation: workspaceFileDelegationPolicy,
          })
          await authorizeWorkflow(principal, current, run)
          if (current.file.workflowConfigVersion !== context.file.workflowConfigVersion)
            throw new OrchestrationError('conflict', 'File workflow configuration changed')
        },
      })
    },
  })
}

/** Workspace members may refresh the public share's cache under its workflow authority. */
export const runSharedFileWorkflowAsMember = sharedMemberUseCase(fileOperations.runWorkflow, true)
export const readSharedFileWorkflowAsMember = sharedMemberUseCase(
  fileOperations.readWorkflowResult,
  false
)

type SharedFile = NonNullable<Awaited<ReturnType<typeof resolveActiveShareByToken>>>

/**
 * Public execution is authorized by the active file share, not workspace membership.
 * The transport supplies its verified share-auth gate; no caller identity or execution controls
 * come from the request body. Canonical lookup and every delivery recheck belong to this use case.
 */
export async function accessSharedFileWorkflow(args: {
  token: string
  workflowId: string
  input?: unknown
  run: boolean
  authenticateShare(share: SharedFile['share']): Promise<void>
}) {
  const authorize = async () => {
    const resolved = await resolveActiveShareByToken(args.token)
    if (!resolved || !resolved.file.workspaceId || resolved.file.context !== 'workspace')
      throw new OrchestrationError('not_found', 'File workflow not found')
    await args.authenticateShare(resolved.share)
    if (
      !isWorkflowHtml(resolved.file.contentType) ||
      !resolved.file.workflowIds.includes(args.workflowId)
    )
      throw new OrchestrationError('not_found', 'File workflow not found')
    const workflow = await resolveActiveWorkflowApplicationContext({
      workflowId: args.workflowId,
      assertedWorkspaceId: resolved.file.workspaceId,
    })
    if (!workflow.workflow.isDeployed)
      throw new OrchestrationError('conflict', 'Workflow is not deployed')
    return {
      ...resolved,
      workflow,
      audience: fileWorkflowAudience([
        resolved.file.workspaceId,
        resolved.file.id,
        args.workflowId,
        resolved.file.workflowConfigVersion,
        'share',
        resolved.share.id,
        resolved.share.updatedAt.toISOString(),
      ]),
    }
  }
  const admitted = await authorize()
  const prepared = await prepareFileWorkflowInput(
    args.workflowId,
    admitted.file.workspaceId!,
    args.input
  )
  return accessFileWorkflow({
    fileId: admitted.file.id,
    workflow: admitted.workflow,
    principal: {
      kind: 'system',
      serviceId: 'public_api',
      workspaceId: admitted.workflow.workspaceId,
      workflowId: args.workflowId,
    },
    userId: admitted.workflow.billedAccountUserId,
    audience: admitted.audience,
    ...prepared,
    publicAccess: true,
    run: args.run,
    async reauthorize() {
      const current = await authorize()
      if (current.audience !== admitted.audience)
        throw new OrchestrationError('conflict', 'File sharing or workflow configuration changed')
    },
  })
}
