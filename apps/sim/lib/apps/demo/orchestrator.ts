import { db } from '@sim/db'
import { copilotChats, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { FullstackWorkflowSeed } from '@/lib/apps/build-interface/types'
import type { BackendHandoff } from '@/lib/apps/demo/backend-handoff'
import {
  buildBackendHandoff,
  collectWorkflowIdsFromToolCalls,
} from '@/lib/apps/demo/backend-handoff'
import { buildDemoFrontendRevision } from '@/lib/apps/demo/build-frontend-revision'
import { resolveAndBindOAuthCredentials } from '@/lib/apps/demo/credential-binding'
import { decideFullstackFollowUpIntent } from '@/lib/apps/demo/follow-up-intent'
import { generateFrontendFiles } from '@/lib/apps/demo/frontend-generator'
import { runDemoMothershipPass } from '@/lib/apps/demo/headless-mothership'
import { findOriginalBuilderPrompt } from '@/lib/apps/demo/resume-prompt'
import { isFullstackDemoModeEnabled } from '@/lib/apps/demo/runtime'
import type { DemoProgressEvent } from '@/lib/apps/demo/types'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import { getAppOriginStatus } from '@/lib/apps/origin'
import { assertAppPermission } from '@/lib/apps/permissions'
import { activatePreviewPins, stopPreviewSession } from '@/lib/apps/pins'
import { waitForAppPreviewReady } from '@/lib/apps/preview-readiness'
import { buildAppPreviewUrl } from '@/lib/apps/preview-url'
import { createAppProject, getAppProject, getLinkedAppProjectForChat } from '@/lib/apps/projects'
import { filterAllowedUserFiles, loadRevisionSnapshot } from '@/lib/apps/revision-snapshot'
import {
  getAccessibleCopilotChatWithMessages,
  resolveOrCreateChat,
} from '@/lib/copilot/chat/lifecycle'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { requestChatTitle } from '@/lib/copilot/request/lifecycle/start'
import type { StreamEvent, ToolCallSummary } from '@/lib/copilot/request/types'
import { persistChatResources } from '@/lib/copilot/resources/persistence'
import type { MothershipResource } from '@/lib/copilot/resources/types'

export type { DemoPhase, DemoProgressEvent } from '@/lib/apps/demo/types'

const logger = createLogger('FullstackDemoOrchestrator')

const APP_NAME_MAX = 60

type DemoProject = {
  id: string
  name: string
  slug: string
  publicId: string
  draftRevisionId: string | null
  publishedReleaseId: string | null
}

function slugFromPrompt(prompt: string): string {
  const base = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = generateId().slice(0, 6).toLowerCase()
  const slug = `${base || 'app'}-${suffix}`.replace(/^-+|-+$/g, '')
  return slug.slice(0, 63)
}

function normalizeAppDisplayName(title: string | null | undefined, prompt: string): string {
  const cleaned = (title || '').trim().replace(/\s+/g, ' ')
  if (cleaned) {
    return cleaned.length > APP_NAME_MAX ? `${cleaned.slice(0, APP_NAME_MAX - 1)}…` : cleaned
  }
  const words = prompt.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean).slice(0, 4)
  const fallback = words.join(' ') || 'Full-stack App'
  return fallback.length > APP_NAME_MAX ? `${fallback.slice(0, APP_NAME_MAX - 1)}…` : fallback
}

async function resolveDemoAppName(params: {
  prompt: string
  userId: string
  workspaceId: string
}): Promise<string> {
  try {
    const title = await Promise.race([
      requestChatTitle({
        message: params.prompt,
        model: 'claude-opus-4-8',
        userId: params.userId,
        workspaceId: params.workspaceId,
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 8_000)
      }),
    ])
    return normalizeAppDisplayName(title, params.prompt)
  } catch {
    return normalizeAppDisplayName(null, params.prompt)
  }
}

function wrapBackendPrompt(prompt: string): string {
  return [
    prompt,
    '',
    'Additional requirements for this Full-stack demo:',
    '- Create all necessary workflows as saved drafts in this workspace (use create_workflow / edit_workflow).',
    '- Give every workflow an API-compatible start block with useful typed inputs for the React UI.',
    '- NEVER put OAuth credential IDs, API keys, access tokens, or secrets into API start inputFormat fields.',
    '- API start inputs must be meaningful user-provided data, never raw provider configuration such as operation, fields, cursor, credential, or trigger settings.',
    '- If the requested action operates on the connected account and needs no user data, use an API start block with no input fields.',
    '- Configure integration field selection inside the integration block. For TikTok Get User, leave fields blank for the canonical profile set or use provider snake_case names such as open_id and display_name; never expose fields as an App input.',
    '- For integration blocks that need OAuth, bind credentials into the block oauth-input subblocks only.',
    '- Read available credentials from the workspace environment when binding OAuth inputs.',
    '- Expose useful block outputs that a React frontend can display (including file outputs when available).',
    '- Response blocks must return structured objects, not JSON-encoded strings. Map block outputs directly so Apps receive typed values.',
    '- Do not deploy workflows; leave them as saved drafts.',
    '- Do not run, test, or execute workflows during generation; only create, edit, and save them.',
    '- Do not create or edit frontend/source files; backend workflows only.',
    '- Prefer multiple focused workflows when the prompt needs more than one capability.',
  ].join('\n')
}

function resourceWorkflowIds(resources: unknown): string[] {
  if (!Array.isArray(resources)) return []
  return (resources as MothershipResource[])
    .filter((r) => r && r.type === 'workflow' && typeof r.id === 'string')
    .map((r) => r.id)
}

async function loadChatWorkflowIds(chatId: string, userId: string): Promise<string[]> {
  const [chatRow] = await db
    .select({ resources: copilotChats.resources })
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
    .limit(1)
  return resourceWorkflowIds(chatRow?.resources)
}

async function loadOriginalBuilderPrompt(chatId: string, userId: string): Promise<string | null> {
  const chat = await getAccessibleCopilotChatWithMessages(chatId, userId)
  if (!Array.isArray(chat?.messages)) return null
  return findOriginalBuilderPrompt(chat.messages)
}

async function emitWorkflowResourceReconciliation(params: {
  chatId: string
  workflowIds: string[]
  onEvent?: (event: StreamEvent) => void | Promise<void>
}): Promise<void> {
  if (params.workflowIds.length === 0) return
  const rows = await db
    .select({ id: workflow.id, name: workflow.name })
    .from(workflow)
    .where(inArray(workflow.id, params.workflowIds))
  const byId = new Map(rows.map((row) => [row.id, row.name]))
  const resources = params.workflowIds.map((workflowId) => ({
    type: 'workflow' as const,
    id: workflowId,
    title: byId.get(workflowId) || 'Workflow',
  }))
  await persistChatResources(params.chatId, resources)
  if (!params.onEvent) return
  for (const resource of resources) {
    await params.onEvent({
      type: MothershipStreamV1EventType.resource,
      payload: {
        op: MothershipStreamV1ResourceOp.upsert,
        resource,
      },
    })
  }
}

function toDemoProject(project: {
  id: string
  name: string
  slug: string
  publicId: string
  draftRevisionId: string | null
  publishedReleaseId: string | null
}): DemoProject {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    publicId: project.publicId,
    draftRevisionId: project.draftRevisionId,
    publishedReleaseId: project.publishedReleaseId,
  }
}

async function handoffFromRevisionActions(
  workspaceId: string,
  projectId: string,
  revisionId: string
): Promise<
  | {
      ok: true
      handoff: BackendHandoff
      snapshot: Awaited<ReturnType<typeof loadRevisionSnapshot>>
    }
  | { ok: false; error: string; code: string }
> {
  const snapshot = await loadRevisionSnapshot(projectId, revisionId)
  if (snapshot.actions.length === 0) {
    return {
      ok: false,
      error: 'Current revision has no bound actions',
      code: 'NO_ACTIONS',
    }
  }

  // Rebuild a credential-free handoff view from the immutable revision snapshot.
  const workflowIds = snapshot.actions.map((action) => action.workflowId)
  const handoff = await buildBackendHandoff({
    workspaceId,
    toolCalls: [],
    resourceWorkflowIds: workflowIds,
  })
  return handoff.ok ? { ...handoff, snapshot } : handoff
}

async function finishFrontendBuild(params: {
  userId: string
  workspaceId: string
  prompt: string
  project: DemoProject
  chatId: string
  handoff: BackendHandoff
  currentFiles?: Record<string, string>
  preserveActions?: AppActionManifestEntry[]
  skipFallback?: boolean
  abortSignal?: AbortSignal
  onEvent: (event: DemoProgressEvent) => void | Promise<void>
}): Promise<DemoProgressEvent> {
  await params.onEvent({
    phase: 'generating_frontend',
    message: params.currentFiles
      ? 'Updating the interface from current source…'
      : `Found ${params.handoff.actions.length} workflow(s); generating frontend…`,
    projectId: params.project.id,
    chatId: params.chatId,
    workflowCount: params.handoff.actions.length,
    actionIds: params.handoff.actions.map((a) => a.actionId),
  })

  const frontend = await generateFrontendFiles({
    userId: params.userId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
    prompt: params.prompt,
    handoff: params.handoff,
    abortSignal: params.abortSignal,
    currentFiles: params.currentFiles,
    preserveOnFailure: Boolean(params.currentFiles),
  })

  if (frontend.source === 'unchanged') {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      revisionId: params.project.draftRevisionId ?? undefined,
      error: 'Frontend edit failed; keeping the previous preview',
      code: 'FRONTEND_UNCHANGED',
    }
    await params.onEvent(failed)
    return failed
  }

  const frontendFiles = Object.keys(filterAllowedUserFiles(frontend.files)).sort()
  await params.onEvent({
    phase: 'frontend_generated',
    message: 'Interface source generated',
    projectId: params.project.id,
    chatId: params.chatId,
    frontendSource: frontend.source,
    frontendFiles,
    repairAttempted: frontend.repairAttempted ?? false,
    workflowCount: params.handoff.actions.length,
    actionIds: params.handoff.actions.map((a) => a.actionId),
  })

  await params.onEvent({
    phase: 'building_app',
    message: 'Building App revision…',
    projectId: params.project.id,
    chatId: params.chatId,
    frontendSource: frontend.source,
    workflowCount: params.handoff.actions.length,
    actionIds: params.handoff.actions.map((a) => a.actionId),
  })

  const builtFrontend = await buildDemoFrontendRevision({
    projectId: params.project.id,
    userId: params.userId,
    prompt: params.prompt,
    handoff: params.handoff,
    frontend,
    parentRevisionId: params.project.draftRevisionId,
    expectedRevisionId: params.project.draftRevisionId,
    skipFallback: params.skipFallback,
    preserveActions: params.preserveActions,
    onFallback: async () => {
      await params.onEvent({
        phase: 'building_app',
        message: 'Generated frontend did not compile; building reliable fallback UI…',
        projectId: params.project.id,
        chatId: params.chatId,
        frontendSource: 'fallback',
        workflowCount: params.handoff.actions.length,
        actionIds: params.handoff.actions.map((a) => a.actionId),
      })
    },
  })
  if (!builtFrontend.ok) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      revisionId: builtFrontend.revisionId,
      error: builtFrontend.error,
      code: 'BUILD_FAILED',
    }
    await params.onEvent(failed)
    return failed
  }

  const preview = await activatePreviewPins({
    projectId: params.project.id,
    revisionId: builtFrontend.revisionId,
    userId: params.userId,
  })
  const origin = getAppOriginStatus()
  if (!origin.enabled) {
    await stopPreviewSession(preview.sessionId)
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      revisionId: builtFrontend.revisionId,
      buildId: preview.buildId,
      error: origin.reason,
      code: 'APPS_ORIGIN_MISCONFIGURED',
    }
    await params.onEvent(failed)
    return failed
  }
  const previewUrl = buildAppPreviewUrl({
    appPublicOrigin: origin.appPublicOrigin,
    sessionId: preview.sessionId,
    channelNonce: preview.channelNonce,
    parentOrigin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  })
  const readiness = await waitForAppPreviewReady({
    previewUrl,
    abortSignal: params.abortSignal,
  })
  if (!readiness.ok) {
    await stopPreviewSession(preview.sessionId)
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      revisionId: builtFrontend.revisionId,
      buildId: preview.buildId,
      error: 'Apps preview host is not ready yet. Wait a moment and retry.',
      code: 'APPS_HOST_UNAVAILABLE',
    }
    await params.onEvent(failed)
    return failed
  }

  const ready: DemoProgressEvent = {
    phase: 'preview_ready',
    message: 'Preview ready',
    projectId: params.project.id,
    chatId: params.chatId,
    revisionId: builtFrontend.revisionId,
    buildId: preview.buildId,
    sessionId: preview.sessionId,
    channelNonce: preview.channelNonce,
    appPublicOrigin: origin.appPublicOrigin,
    artifactPreview: preview.artifactPreview,
    workflowCount: params.handoff.actions.length,
    actionIds: params.handoff.actions.map((a) => a.actionId),
    frontendSource: builtFrontend.frontendSource,
  }
  await params.onEvent(ready)
  return ready
}

async function continueAfterCredentials(params: {
  userId: string
  workspaceId: string
  prompt: string
  project: DemoProject
  chatId: string
  workflowIds: string[]
  toolCalls: ToolCallSummary[]
  currentFiles?: Record<string, string>
  abortSignal?: AbortSignal
  onEvent: (event: DemoProgressEvent) => void | Promise<void>
}): Promise<DemoProgressEvent> {
  const handoffResult = await buildBackendHandoff({
    workspaceId: params.workspaceId,
    toolCalls: params.toolCalls,
    resourceWorkflowIds: params.workflowIds,
  })

  if (!handoffResult.ok) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      error: handoffResult.error,
      code: handoffResult.code,
    }
    await params.onEvent(failed)
    return failed
  }

  return finishFrontendBuild({
    userId: params.userId,
    workspaceId: params.workspaceId,
    prompt: params.prompt,
    project: params.project,
    chatId: params.chatId,
    handoff: handoffResult.handoff,
    currentFiles: params.currentFiles,
    abortSignal: params.abortSignal,
    onEvent: params.onEvent,
  })
}

async function runFrontendOnlyFollowUp(params: {
  userId: string
  workspaceId: string
  prompt: string
  project: DemoProject
  chatId: string
  abortSignal?: AbortSignal
  onEvent: (event: DemoProgressEvent) => void | Promise<void>
}): Promise<DemoProgressEvent> {
  if (!params.project.draftRevisionId) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      error: 'App has no draft revision to edit',
      code: 'NO_DRAFT',
    }
    await params.onEvent(failed)
    return failed
  }

  const handoffResult = await handoffFromRevisionActions(
    params.workspaceId,
    params.project.id,
    params.project.draftRevisionId
  )
  if (!handoffResult.ok) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      error: handoffResult.error,
      code: handoffResult.code,
    }
    await params.onEvent(failed)
    return failed
  }

  const currentFiles = filterAllowedUserFiles(handoffResult.snapshot.files)

  return finishFrontendBuild({
    userId: params.userId,
    workspaceId: params.workspaceId,
    prompt: params.prompt,
    project: params.project,
    chatId: params.chatId,
    handoff: handoffResult.handoff,
    currentFiles,
    preserveActions: handoffResult.snapshot.actions,
    skipFallback: true,
    abortSignal: params.abortSignal,
    onEvent: params.onEvent,
  })
}

async function runBackendThenFrontend(params: {
  userId: string
  workspaceId: string
  prompt: string
  project: DemoProject
  chatId: string
  abortSignal?: AbortSignal
  onStreamEvent?: (event: StreamEvent) => void | Promise<void>
  onBackendResult?: (
    result: Awaited<ReturnType<typeof runDemoMothershipPass>>
  ) => void | Promise<void>
  onEvent: (event: DemoProgressEvent) => void | Promise<void>
}): Promise<DemoProgressEvent> {
  await params.onEvent({
    phase: 'building_backend',
    message: 'Generating backend workflows via hosted Mothership…',
    projectId: params.project.id,
    chatId: params.chatId,
  })

  const backendResult = await runDemoMothershipPass({
    userId: params.userId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
    message: wrapBackendPrompt(params.prompt),
    mode: 'agent',
    appProject: {
      id: params.project.id,
      name: params.project.name,
      slug: params.project.slug,
      publicId: params.project.publicId,
      draftRevisionId: params.project.draftRevisionId,
      publishedReleaseId: params.project.publishedReleaseId,
    },
    abortSignal: params.abortSignal,
    onEvent: params.onStreamEvent,
  })
  await params.onBackendResult?.(backendResult)

  if (!backendResult.success && !backendResult.cancelled) {
    logger.warn('Backend mothership pass failed', {
      error: backendResult.error,
      chatId: params.chatId,
    })
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      error: backendResult.error || 'Backend generation failed',
      code: 'BACKEND_FAILED',
    }
    await params.onEvent(failed)
    return failed
  }
  if (backendResult.cancelled || params.abortSignal?.aborted) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      error: 'Cancelled',
      code: 'CANCELLED',
    }
    await params.onEvent(failed)
    return failed
  }

  const resourceIds = await loadChatWorkflowIds(params.chatId, params.userId)
  const toolCalls = (backendResult.toolCalls || []) as ToolCallSummary[]
  const workflowIds = collectWorkflowIdsFromToolCalls(toolCalls, resourceIds)
  await emitWorkflowResourceReconciliation({
    chatId: params.chatId,
    workflowIds,
    onEvent: params.onStreamEvent,
  })

  await params.onEvent({
    phase: 'binding_credentials',
    message: 'Binding private OAuth credentials…',
    projectId: params.project.id,
    chatId: params.chatId,
    workflowCount: workflowIds.length,
  })

  const bound = await resolveAndBindOAuthCredentials({
    userId: params.userId,
    workspaceId: params.workspaceId,
    workflowIds,
  })

  if (!bound.ok) {
    if (bound.code === 'SELECTION_REQUIRED') {
      const event: DemoProgressEvent = {
        phase: 'credential_selection_required',
        message: bound.error,
        projectId: params.project.id,
        chatId: params.chatId,
        code: bound.code,
        credentialSelections: bound.selections,
      }
      await params.onEvent(event)
      return event
    }
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      error: bound.error,
      code: bound.code,
    }
    await params.onEvent(failed)
    return failed
  }

  const currentFiles = params.project.draftRevisionId
    ? filterAllowedUserFiles(
        (await loadRevisionSnapshot(params.project.id, params.project.draftRevisionId)).files
      )
    : undefined

  return continueAfterCredentials({
    userId: params.userId,
    workspaceId: params.workspaceId,
    prompt: params.prompt,
    project: params.project,
    chatId: params.chatId,
    workflowIds,
    toolCalls,
    currentFiles,
    abortSignal: params.abortSignal,
    onEvent: params.onEvent,
  })
}

async function runExistingWorkflowThenFrontend(params: {
  userId: string
  workspaceId: string
  prompt: string
  project: DemoProject
  chatId: string
  workflowIds: string[]
  abortSignal?: AbortSignal
  onStreamEvent?: (event: StreamEvent) => void | Promise<void>
  onEvent: (event: DemoProgressEvent) => void | Promise<void>
}): Promise<DemoProgressEvent> {
  const validRows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        inArray(workflow.id, params.workflowIds),
        eq(workflow.workspaceId, params.workspaceId),
        isNull(workflow.archivedAt)
      )
    )
  if (new Set(validRows.map((row) => row.id)).size !== new Set(params.workflowIds).size) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      error: 'One or more seeded workflows are unavailable in this workspace',
      code: 'NO_VALID_WORKFLOWS',
    }
    await params.onEvent(failed)
    return failed
  }
  await params.onEvent({
    phase: 'building_backend',
    message: 'Validating existing backend workflow…',
    projectId: params.project.id,
    chatId: params.chatId,
    workflowCount: params.workflowIds.length,
  })
  await emitWorkflowResourceReconciliation({
    chatId: params.chatId,
    workflowIds: params.workflowIds,
    onEvent: params.onStreamEvent,
  })
  const bound = await resolveAndBindOAuthCredentials({
    userId: params.userId,
    workspaceId: params.workspaceId,
    workflowIds: params.workflowIds,
  })
  if (!bound.ok) {
    if (bound.code === 'SELECTION_REQUIRED') {
      const selection: DemoProgressEvent = {
        phase: 'credential_selection_required',
        message: bound.error,
        projectId: params.project.id,
        chatId: params.chatId,
        code: bound.code,
        credentialSelections: bound.selections,
      }
      await params.onEvent(selection)
      return selection
    }
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: params.project.id,
      chatId: params.chatId,
      error: bound.error,
      code: bound.code,
    }
    await params.onEvent(failed)
    return failed
  }
  const currentFiles = params.project.draftRevisionId
    ? filterAllowedUserFiles(
        (await loadRevisionSnapshot(params.project.id, params.project.draftRevisionId)).files
      )
    : undefined
  return continueAfterCredentials({
    userId: params.userId,
    workspaceId: params.workspaceId,
    prompt: params.prompt,
    project: params.project,
    chatId: params.chatId,
    workflowIds: params.workflowIds,
    toolCalls: [],
    currentFiles,
    abortSignal: params.abortSignal,
    onEvent: params.onEvent,
  })
}

/**
 * Sim-owned demo coordinator. Streams deterministic phases via the provided emitter.
 * Callers (the SSE route / chat lifecycle) are responsible for assertHostedDemoRuntime before invoking.
 */
export async function runFullstackDemoOrchestration(params: {
  userId: string
  workspaceId: string
  prompt: string
  /** Prefer an existing chat (normal mothership chat path). */
  chatId?: string
  /** Resume an existing linked project after credential selection. */
  projectId?: string
  credentialSelections?: Record<string, string>
  abortSignal?: AbortSignal
  /** Forward nested backend mothership stream envelopes (tool/resource/text). */
  onStreamEvent?: (event: StreamEvent) => void | Promise<void>
  onBackendResult?: (
    result: Awaited<ReturnType<typeof runDemoMothershipPass>>
  ) => void | Promise<void>
  fullstackSeed?: FullstackWorkflowSeed
  onEvent: (event: DemoProgressEvent) => void | Promise<void>
}): Promise<DemoProgressEvent> {
  if (!isFullstackDemoModeEnabled()) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      error: 'FULLSTACK_DEMO_MODE is not enabled',
      code: 'DEMO_DISABLED',
    }
    await params.onEvent(failed)
    return failed
  }

  const perm = await assertAppPermission(params.userId, params.workspaceId, 'edit')
  if (!perm.ok) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      error: perm.message,
      code: 'PERMISSION_DENIED',
    }
    await params.onEvent(failed)
    return failed
  }

  // Resume path: patch selected credentials on existing drafts and continue.
  if (params.projectId && params.chatId && params.credentialSelections) {
    const projectRow = await getAppProject(params.projectId)
    if (!projectRow || projectRow.workspaceId !== params.workspaceId) {
      const failed: DemoProgressEvent = {
        phase: 'failed',
        error: 'App project not found',
        code: 'PROJECT_NOT_FOUND',
      }
      await params.onEvent(failed)
      return failed
    }
    if (
      projectRow.createdFromChatId !== params.chatId &&
      projectRow.lastBuilderChatId !== params.chatId
    ) {
      const failed: DemoProgressEvent = {
        phase: 'failed',
        projectId: projectRow.id,
        chatId: params.chatId,
        error: 'App project is not linked to this Full-stack chat',
        code: 'PROJECT_CHAT_MISMATCH',
      }
      await params.onEvent(failed)
      return failed
    }
    if (projectRow.createdBy && projectRow.createdBy !== params.userId) {
      const failed: DemoProgressEvent = {
        phase: 'failed',
        projectId: projectRow.id,
        chatId: params.chatId,
        error: 'Only the creator can select credentials for this App',
        code: 'PERMISSION_DENIED',
      }
      await params.onEvent(failed)
      return failed
    }

    const project = toDemoProject(projectRow)
    const workflowIds = await loadChatWorkflowIds(params.chatId, params.userId)
    await params.onEvent({
      phase: 'binding_credentials',
      message: 'Applying credential selection…',
      projectId: project.id,
      chatId: params.chatId,
    })

    const bound = await resolveAndBindOAuthCredentials({
      userId: params.userId,
      workspaceId: params.workspaceId,
      workflowIds,
      selections: params.credentialSelections,
    })

    if (!bound.ok) {
      if (bound.code === 'SELECTION_REQUIRED') {
        const event: DemoProgressEvent = {
          phase: 'credential_selection_required',
          message: bound.error,
          projectId: project.id,
          chatId: params.chatId,
          code: bound.code,
          credentialSelections: bound.selections,
        }
        await params.onEvent(event)
        return event
      }
      const failed: DemoProgressEvent = {
        phase: 'failed',
        projectId: project.id,
        chatId: params.chatId,
        error: bound.error,
        code: bound.code,
      }
      await params.onEvent(failed)
      return failed
    }

    try {
      const originalPrompt =
        (await loadOriginalBuilderPrompt(params.chatId, params.userId)) ?? params.prompt
      const currentFiles = project.draftRevisionId
        ? filterAllowedUserFiles(
            (await loadRevisionSnapshot(project.id, project.draftRevisionId)).files
          )
        : undefined
      return await continueAfterCredentials({
        userId: params.userId,
        workspaceId: params.workspaceId,
        prompt: originalPrompt,
        project,
        chatId: params.chatId,
        workflowIds,
        toolCalls: [],
        currentFiles,
        abortSignal: params.abortSignal,
        onEvent: params.onEvent,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed: DemoProgressEvent = {
        phase: 'failed',
        projectId: project.id,
        chatId: params.chatId,
        error: message,
        code: 'ORCHESTRATION_FAILED',
      }
      await params.onEvent(failed)
      return failed
    }
  }

  let chatId = params.chatId
  if (!chatId) {
    const chatResult = await resolveOrCreateChat({
      userId: params.userId,
      workspaceId: params.workspaceId,
      model: 'claude-opus-4-8',
      type: 'fullstack',
    })
    chatId = chatResult.chatId
  }
  if (!chatId) {
    const failed: DemoProgressEvent = {
      phase: 'failed',
      error: 'Failed to create Full-stack chat',
      code: 'CHAT_CREATE_FAILED',
    }
    await params.onEvent(failed)
    return failed
  }

  const linked = await getLinkedAppProjectForChat(chatId, params.workspaceId)
  let project: DemoProject | null = linked ? toDemoProject(linked) : null

  if (params.fullstackSeed?.source === 'existing_workflow') {
    if (!project) {
      const name =
        params.fullstackSeed.design.appName || normalizeAppDisplayName(null, params.prompt)
      const projectResult = await createAppProject({
        workspaceId: params.workspaceId,
        name,
        slug: slugFromPrompt(name),
        userId: params.userId,
        createdFromChatId: chatId,
      })
      if (!projectResult.success) {
        const failed: DemoProgressEvent = {
          phase: 'failed',
          chatId,
          error: projectResult.error,
          code: 'PROJECT_CREATE_FAILED',
        }
        await params.onEvent(failed)
        return failed
      }
      project = toDemoProject(projectResult.project)
    }
    const designPrompt = [
      params.prompt,
      '',
      `Validated design preferences:\n${JSON.stringify(params.fullstackSeed.design, null, 2)}`,
      'Reuse the seeded workflow backend exactly as-is. Do not create or edit workflows.',
    ].join('\n')
    return runExistingWorkflowThenFrontend({
      userId: params.userId,
      workspaceId: params.workspaceId,
      prompt: designPrompt,
      project,
      chatId,
      workflowIds: params.fullstackSeed.workflowIds,
      abortSignal: params.abortSignal,
      onStreamEvent: params.onStreamEvent,
      onEvent: params.onEvent,
    })
  }

  // Follow-up turns against an existing draft revision.
  if (project?.draftRevisionId) {
    const intent = await decideFullstackFollowUpIntent({
      prompt: params.prompt,
      userId: params.userId,
      workspaceId: params.workspaceId,
      abortSignal: params.abortSignal,
    })
    try {
      if (intent === 'frontend') {
        return await runFrontendOnlyFollowUp({
          userId: params.userId,
          workspaceId: params.workspaceId,
          prompt: params.prompt,
          project,
          chatId,
          abortSignal: params.abortSignal,
          onEvent: params.onEvent,
        })
      }
      return await runBackendThenFrontend({
        userId: params.userId,
        workspaceId: params.workspaceId,
        prompt: params.prompt,
        project,
        chatId,
        abortSignal: params.abortSignal,
        onStreamEvent: params.onStreamEvent,
        onBackendResult: params.onBackendResult,
        onEvent: params.onEvent,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Demo follow-up orchestration failed', { error: message, projectId: project.id })
      const failed: DemoProgressEvent = {
        phase: 'failed',
        projectId: project.id,
        chatId,
        error: message,
        code: 'ORCHESTRATION_FAILED',
      }
      await params.onEvent(failed)
      return failed
    }
  }

  if (!project) {
    const appName = await resolveDemoAppName({
      prompt: params.prompt,
      userId: params.userId,
      workspaceId: params.workspaceId,
    })

    await db
      .update(copilotChats)
      .set({ title: appName })
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, params.userId)))
      .catch(() => undefined)

    const projectResult = await createAppProject({
      workspaceId: params.workspaceId,
      name: appName,
      slug: slugFromPrompt(params.prompt),
      userId: params.userId,
      createdFromChatId: chatId,
    })
    if (!projectResult.success) {
      const failed: DemoProgressEvent = {
        phase: 'failed',
        chatId,
        error: projectResult.error,
        code: 'PROJECT_CREATE_FAILED',
      }
      await params.onEvent(failed)
      return failed
    }
    project = toDemoProject(projectResult.project)
  }

  try {
    return await runBackendThenFrontend({
      userId: params.userId,
      workspaceId: params.workspaceId,
      prompt: params.prompt,
      project,
      chatId,
      abortSignal: params.abortSignal,
      onStreamEvent: params.onStreamEvent,
      onBackendResult: params.onBackendResult,
      onEvent: params.onEvent,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Demo orchestration failed', { error: message, projectId: project.id })
    const failed: DemoProgressEvent = {
      phase: 'failed',
      projectId: project.id,
      chatId,
      error: message,
      code: 'ORCHESTRATION_FAILED',
    }
    await params.onEvent(failed)
    return failed
  }
}
