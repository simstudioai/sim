import { db } from '@sim/db'
import {
  appBuild,
  appPreviewSession,
  appProject,
  appRelease,
  appRevisionAction,
  appSourceBlob,
  appSourceFile,
  appSourceRevision,
  copilotChats,
} from '@sim/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { FullstackStreamEvent } from '@/lib/apps/agent/fullstack-contract'
import { buildBoundActionEntry } from '@/lib/apps/bind-actions'
import { validateSourceCaps } from '@/lib/apps/build/e2b-app-build'
import { isAllowedUserPath } from '@/lib/apps/build/prepare-source'
import { buildProjectRevision } from '@/lib/apps/build/project-build'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import { type AppPermissionAction, assertAppPermission } from '@/lib/apps/permissions'
import { stopPreviewSession } from '@/lib/apps/pins'
import { prepareProjectRelease } from '@/lib/apps/prepare-release'
import { getCurrentRelease } from '@/lib/apps/projects'
import { publishPreparedRelease } from '@/lib/apps/publish'
import { createRevisionWithActions } from '@/lib/apps/revisions'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'

const outputAllowlistSchema = z.array(
  z.object({
    key: z.string().min(1).max(128),
    blockId: z.string().min(1),
    path: z.string().min(1),
  })
)

type ToolScope = {
  userId: string
  workspaceId: string
  chatId: string
  project: typeof appProject.$inferSelect
}

function event(type: FullstackStreamEvent, payload: Record<string, unknown>) {
  // Go's generated stream protocol does not yet carry app.* event envelopes.
  // Keep the stable event in the tool result; Go can mirror it into the stream
  // once mothership-stream-v1 adds the matching envelope.
  return { type, payload }
}

async function requireToolScope(
  projectId: string,
  context: ServerToolContext | undefined,
  permissionAction: AppPermissionAction
): Promise<ToolScope> {
  if (!context?.userId || !context.workspaceId || !context.chatId) {
    throw new Error('Full-stack tool requires user, workspace, and chat context')
  }
  if (context.requestMode !== 'fullstack') {
    throw new Error('App tools may only run from a Full-stack chat')
  }
  const [[chat], [project]] = await Promise.all([
    db
      .select({ id: copilotChats.id })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, context.chatId),
          eq(copilotChats.userId, context.userId),
          eq(copilotChats.workspaceId, context.workspaceId),
          eq(copilotChats.type, 'fullstack')
        )
      )
      .limit(1),
    db
      .select()
      .from(appProject)
      .where(
        and(
          eq(appProject.id, projectId),
          eq(appProject.workspaceId, context.workspaceId),
          isNull(appProject.archivedAt)
        )
      )
      .limit(1),
  ])
  if (!chat) throw new Error('Full-stack chat not found')
  if (!project) throw new Error('App project not found in this workspace')
  const permission = await assertAppPermission(
    context.userId,
    context.workspaceId,
    permissionAction
  )
  if (!permission.ok) throw new Error(permission.message)
  return {
    userId: context.userId,
    workspaceId: context.workspaceId,
    chatId: context.chatId,
    project,
  }
}

async function touchBuilderChat(projectId: string, chatId: string) {
  await db
    .update(appProject)
    .set({ lastBuilderChatId: chatId, updatedAt: new Date() })
    .where(eq(appProject.id, projectId))
}

async function stopActivePreviews(projectId: string) {
  const sessions = await db
    .select({ id: appPreviewSession.id })
    .from(appPreviewSession)
    .where(and(eq(appPreviewSession.projectId, projectId), isNull(appPreviewSession.stoppedAt)))
  for (const session of sessions) await stopPreviewSession(session.id)
}

async function loadRevisionSnapshot(projectId: string, revisionId: string) {
  const [revision] = await db
    .select({ id: appSourceRevision.id })
    .from(appSourceRevision)
    .where(and(eq(appSourceRevision.id, revisionId), eq(appSourceRevision.projectId, projectId)))
    .limit(1)
  if (!revision) throw new Error('Revision not found')

  const [fileRows, actionRows] = await Promise.all([
    db
      .select({ path: appSourceFile.path, content: appSourceBlob.content })
      .from(appSourceFile)
      .innerJoin(appSourceBlob, eq(appSourceFile.contentHash, appSourceBlob.hash))
      .where(eq(appSourceFile.revisionId, revisionId)),
    db.select().from(appRevisionAction).where(eq(appRevisionAction.revisionId, revisionId)),
  ])
  const files = Object.fromEntries(fileRows.map((row) => [row.path, row.content]))
  const actions: AppActionManifestEntry[] = actionRows.map((row) => ({
    actionId: row.actionId,
    workflowId: row.workflowId,
    deploymentVersionId: row.deploymentVersionId,
    inputSchema: row.inputSchema as AppActionManifestEntry['inputSchema'],
    outputAllowlist: row.outputAllowlist as AppActionManifestEntry['outputAllowlist'],
    executionPolicy: (row.executionPolicy as 'sync' | 'async') || 'sync',
    schemaHash: row.schemaHash,
  }))
  return { files, actions }
}

async function rebuildBoundAction(params: {
  scope: ToolScope
  actionId: string
  workflowId: string
  deploymentVersionId: string
  outputAllowlist: Array<{ key: string; blockId: string; path: string }>
}) {
  const bound = await buildBoundActionEntry({
    workspaceId: params.scope.workspaceId,
    request: {
      actionId: params.actionId,
      workflowId: params.workflowId,
      deploymentVersionId: params.deploymentVersionId,
      outputAllowlist: params.outputAllowlist,
      executionPolicy: 'sync',
    },
  })
  if (!bound.ok) throw new Error(bound.error)
  return bound.action
}

const bindActionInput = z.object({
  projectId: z.string().min(1),
  actionId: z.string().min(1).max(128).default('main'),
  workflowId: z.string().min(1),
  deploymentVersionId: z.string().min(1),
  outputAllowlist: outputAllowlistSchema.default([]),
})

export const appBindActionServerTool: BaseServerTool<
  z.output<typeof bindActionInput>,
  Record<string, unknown>
> = {
  name: 'app_bind_action',
  inputSchema: bindActionInput,
  async execute(args, context) {
    const scope = await requireToolScope(args.projectId, context, 'bind')
    assertServerToolNotAborted(context)
    const bound = await rebuildBoundAction({ scope, ...args })
    const prior = scope.project.draftRevisionId
      ? await loadRevisionSnapshot(args.projectId, scope.project.draftRevisionId)
      : { files: undefined, actions: [] }
    const actions = [...prior.actions.filter((action) => action.actionId !== args.actionId), bound]
    await stopActivePreviews(args.projectId)
    const { revisionId } = await createRevisionWithActions({
      projectId: args.projectId,
      userId: scope.userId,
      actions,
      ...(prior.files ? { files: prior.files } : {}),
      parentRevisionId: scope.project.draftRevisionId,
    })
    await touchBuilderChat(args.projectId, scope.chatId)
    return {
      success: true,
      projectId: args.projectId,
      revisionId,
      actionId: args.actionId,
      event: event('app.revision.created', { projectId: args.projectId, revisionId }),
    }
  },
}

const projectActionInput = z.object({
  projectId: z.string().min(1),
  actionId: z.string().min(1).max(128).optional(),
})

export const appRefreshBindingServerTool: BaseServerTool<
  z.output<typeof projectActionInput>,
  Record<string, unknown>
> = {
  name: 'app_refresh_binding',
  inputSchema: projectActionInput,
  async execute(args, context) {
    const scope = await requireToolScope(args.projectId, context, 'bind')
    if (!scope.project.draftRevisionId) throw new Error('App has no draft revision')
    const prior = await loadRevisionSnapshot(args.projectId, scope.project.draftRevisionId)
    const refreshed: AppActionManifestEntry[] = []
    for (const action of prior.actions) {
      if (args.actionId && action.actionId !== args.actionId) {
        refreshed.push(action)
      } else {
        refreshed.push(
          await rebuildBoundAction({
            scope,
            actionId: action.actionId,
            workflowId: action.workflowId,
            deploymentVersionId: action.deploymentVersionId,
            outputAllowlist: action.outputAllowlist,
          })
        )
      }
    }
    if (args.actionId && !refreshed.some((action) => action.actionId === args.actionId)) {
      throw new Error(`Action ${args.actionId} is not bound`)
    }
    assertServerToolNotAborted(context)
    await stopActivePreviews(args.projectId)
    const { revisionId } = await createRevisionWithActions({
      projectId: args.projectId,
      userId: scope.userId,
      actions: refreshed,
      files: prior.files,
      parentRevisionId: scope.project.draftRevisionId,
    })
    await touchBuilderChat(args.projectId, scope.chatId)
    const drifted = prior.actions.some((before) => {
      const after = refreshed.find((action) => action.actionId === before.actionId)
      return Boolean(after && after.schemaHash !== before.schemaHash)
    })
    return {
      success: true,
      revisionId,
      event: drifted
        ? event('app.binding.drift', {
            projectId: args.projectId,
            revisionId,
            actionId: args.actionId,
          })
        : event('app.revision.created', { projectId: args.projectId, revisionId }),
    }
  },
}

const detachActionInput = projectActionInput.extend({ actionId: z.string().min(1).max(128) })

export const appDetachActionServerTool: BaseServerTool<
  z.output<typeof detachActionInput>,
  Record<string, unknown>
> = {
  name: 'app_detach_action',
  inputSchema: detachActionInput,
  async execute(args, context) {
    const scope = await requireToolScope(args.projectId, context, 'bind')
    if (!scope.project.draftRevisionId) throw new Error('App has no draft revision')
    const prior = await loadRevisionSnapshot(args.projectId, scope.project.draftRevisionId)
    const actions = prior.actions.filter((action) => action.actionId !== args.actionId)
    if (actions.length === prior.actions.length)
      throw new Error(`Action ${args.actionId} is not bound`)
    assertServerToolNotAborted(context)
    await stopActivePreviews(args.projectId)
    const { revisionId } = await createRevisionWithActions({
      projectId: args.projectId,
      userId: scope.userId,
      actions,
      files: prior.files,
      parentRevisionId: scope.project.draftRevisionId,
    })
    await touchBuilderChat(args.projectId, scope.chatId)
    return {
      success: true,
      revisionId,
      detachedActionId: args.actionId,
      event: event('app.revision.created', { projectId: args.projectId, revisionId }),
    }
  },
}

const writeFilesInput = z.object({
  projectId: z.string().min(1),
  expectedRevisionId: z.string().min(1).optional(),
  mode: z.enum(['merge', 'replace']).default('merge'),
  files: z
    .array(z.object({ path: z.string().min(1), content: z.string() }))
    .min(1)
    .max(200),
})

export const appWriteFilesServerTool: BaseServerTool<
  z.output<typeof writeFilesInput>,
  Record<string, unknown>
> = {
  name: 'app_write_files',
  inputSchema: writeFilesInput,
  async execute(args, context) {
    const scope = await requireToolScope(args.projectId, context, 'edit')
    if (!scope.project.draftRevisionId)
      throw new Error('Bind at least one action before writing files')
    if (args.expectedRevisionId && args.expectedRevisionId !== scope.project.draftRevisionId) {
      throw new Error('Draft revision changed; reload before writing files')
    }
    const prior = await loadRevisionSnapshot(args.projectId, scope.project.draftRevisionId)
    for (const file of args.files) {
      if (!isAllowedUserPath(file.path)) {
        throw new Error(
          `Unsupported revision path (not used in build): ${file.path}. Only src/** and public/** user files are allowed.`
        )
      }
    }
    const supplied = Object.fromEntries(args.files.map((file) => [file.path, file.content]))
    const files = args.mode === 'replace' ? supplied : { ...prior.files, ...supplied }
    const caps = validateSourceCaps(files)
    if (!caps.ok) throw new Error(caps.error)
    assertServerToolNotAborted(context)
    await stopActivePreviews(args.projectId)
    const { revisionId } = await createRevisionWithActions({
      projectId: args.projectId,
      userId: scope.userId,
      actions: prior.actions,
      files,
      parentRevisionId: scope.project.draftRevisionId,
    })
    await touchBuilderChat(args.projectId, scope.chatId)
    return {
      success: true,
      revisionId,
      fileCount: Object.keys(files).length,
      event: event('app.revision.created', { projectId: args.projectId, revisionId }),
    }
  },
}

const projectRevisionInput = z.object({
  projectId: z.string().min(1),
  revisionId: z.string().min(1).optional(),
})

export const appBuildServerTool: BaseServerTool<
  z.output<typeof projectRevisionInput>,
  Record<string, unknown>
> = {
  name: 'app_build',
  inputSchema: projectRevisionInput,
  async execute(args, context) {
    const scope = await requireToolScope(args.projectId, context, 'edit')
    const revisionId = args.revisionId ?? scope.project.draftRevisionId
    if (!revisionId) throw new Error('App has no draft revision')
    assertServerToolNotAborted(context)
    const result = await buildProjectRevision({
      projectId: args.projectId,
      revisionId,
      userId: scope.userId,
    })
    if (!result.ok) throw new Error(result.error)
    await touchBuilderChat(args.projectId, scope.chatId)
    return {
      success: true,
      buildId: result.buildId,
      revisionId,
      artifactManifestHash: result.artifactManifestHash,
      reused: result.reused ?? false,
      event: event('app.build.finished', {
        projectId: args.projectId,
        revisionId,
        buildId: result.buildId,
        success: true,
      }),
    }
  },
}

const preparePublishInput = projectRevisionInput.extend({
  buildId: z.string().min(1).optional(),
  publish: z.boolean().default(false),
})

export const appPreparePublishServerTool: BaseServerTool<
  z.output<typeof preparePublishInput>,
  Record<string, unknown>
> = {
  name: 'app_prepare_publish',
  inputSchema: preparePublishInput,
  async execute(args, context) {
    const scope = await requireToolScope(args.projectId, context, 'publish')
    const revisionId = args.revisionId ?? scope.project.draftRevisionId
    if (!revisionId) throw new Error('App has no draft revision')
    let buildId = args.buildId
    if (!buildId) {
      const [latest] = await db
        .select({ id: appBuild.id })
        .from(appBuild)
        .where(
          and(
            eq(appBuild.projectId, args.projectId),
            eq(appBuild.revisionId, revisionId),
            eq(appBuild.status, 'succeeded')
          )
        )
        .orderBy(desc(appBuild.createdAt))
        .limit(1)
      buildId = latest?.id
    }
    if (!buildId) throw new Error('Build the revision before preparing a release')
    assertServerToolNotAborted(context)
    const prepared = await prepareProjectRelease({
      projectId: args.projectId,
      revisionId,
      buildId,
      userId: scope.userId,
    })
    if (!prepared.ok) throw new Error(prepared.error)
    if (!args.publish) {
      await touchBuilderChat(args.projectId, scope.chatId)
      return {
        success: true,
        releaseId: prepared.releaseId,
        state: 'prepared',
        event: event('app.release.prepared', {
          projectId: args.projectId,
          releaseId: prepared.releaseId,
        }),
      }
    }
    const published = await publishPreparedRelease({
      projectId: args.projectId,
      releaseId: prepared.releaseId,
      expectedVersion: scope.project.version,
    })
    if (!published.success) throw new Error(published.error)
    await touchBuilderChat(args.projectId, scope.chatId)
    return {
      success: true,
      releaseId: published.releaseId,
      state: 'published',
      event: event('app.release.published', {
        projectId: args.projectId,
        releaseId: published.releaseId,
      }),
    }
  },
}

const projectInput = z.object({ projectId: z.string().min(1) })

export const appListCallableReleasesServerTool: BaseServerTool<
  z.output<typeof projectInput>,
  Record<string, unknown>
> = {
  name: 'app_list_callable_releases',
  inputSchema: projectInput,
  async execute(args, context) {
    const scope = await requireToolScope(args.projectId, context, 'edit')
    const current = await getCurrentRelease(args.projectId)
    const releases = current
      ? await db.select().from(appRelease).where(eq(appRelease.id, current.id)).limit(1)
      : []
    await touchBuilderChat(args.projectId, scope.chatId)
    return {
      success: true,
      projectId: args.projectId,
      publishedReleaseId: scope.project.publishedReleaseId,
      releases,
    }
  },
}

export const fullstackAppServerTools: BaseServerTool[] = [
  appBindActionServerTool,
  appRefreshBindingServerTool,
  appDetachActionServerTool,
  appWriteFilesServerTool,
  appBuildServerTool,
  appPreparePublishServerTool,
  appListCallableReleasesServerTool,
]
