import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { DemoProgressEvent, FullstackDemoLifecycleSummary } from '@/lib/apps/demo/types'

export const FULLSTACK_DEMO_CONFIG_KEY = 'fullstackDemo'

const credentialChoiceSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string(),
    providerId: z.string().min(1),
  })
  .strict()

const credentialSelectionRequestSchema = z
  .object({
    bindingKey: z.string().min(1),
    workflowId: z.string().min(1),
    blockId: z.string().min(1),
    subBlockId: z.string().min(1),
    serviceId: z.string().min(1),
    providerId: z.string().min(1),
    choices: z.array(credentialChoiceSchema).min(1),
  })
  .strict()

export const fullstackDemoLifecycleSummarySchema = z
  .object({
    version: z.literal(1),
    status: z.enum([
      'running',
      'credential_selection_required',
      'preview_ready',
      'cancelled',
      'failed',
    ]),
    phase: z.enum([
      'building_backend',
      'binding_credentials',
      'credential_selection_required',
      'generating_frontend',
      'frontend_generated',
      'building_app',
      'preview_ready',
      'cancelled',
      'failed',
    ]),
    chatId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    originalPrompt: z.string(),
    workflowIds: z.array(z.string().min(1)).optional(),
    resumeMode: z.enum(['frontend_build', 'backend_only']).optional(),
    credentialSelections: z.array(credentialSelectionRequestSchema).optional(),
    revisionId: z.string().min(1).optional(),
    buildId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    channelNonce: z.string().min(1).optional(),
    appPublicOrigin: z.string().min(1).optional(),
    artifactPreview: z.boolean().optional(),
    actions: z
      .array(z.object({ actionId: z.string().min(1), readOnly: z.boolean() }).strict())
      .optional(),
    error: z.string().optional(),
    code: z.string().optional(),
    updatedAt: z.string().datetime(),
  })
  .strict()

function lifecycleStatusForEvent(
  event: DemoProgressEvent
): FullstackDemoLifecycleSummary['status'] {
  if (event.phase === 'credential_selection_required') return 'credential_selection_required'
  if (event.phase === 'preview_ready') return 'preview_ready'
  if (event.phase === 'cancelled' || event.code === 'CANCELLED') return 'cancelled'
  if (event.phase === 'failed') return 'failed'
  return 'running'
}

export function buildFullstackDemoLifecycleSummary(params: {
  chatId: string
  originalPrompt: string
  event: DemoProgressEvent
}): FullstackDemoLifecycleSummary {
  const { event } = params
  return {
    version: 1,
    status: lifecycleStatusForEvent(event),
    phase: event.phase,
    chatId: params.chatId,
    originalPrompt: params.originalPrompt,
    ...(event.projectId ? { projectId: event.projectId } : {}),
    ...(event.workflowIds ? { workflowIds: event.workflowIds } : {}),
    ...(event.resumeMode ? { resumeMode: event.resumeMode } : {}),
    ...(event.credentialSelections ? { credentialSelections: event.credentialSelections } : {}),
    ...(event.revisionId ? { revisionId: event.revisionId } : {}),
    ...(event.buildId ? { buildId: event.buildId } : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.channelNonce ? { channelNonce: event.channelNonce } : {}),
    ...(event.appPublicOrigin ? { appPublicOrigin: event.appPublicOrigin } : {}),
    ...(event.artifactPreview !== undefined ? { artifactPreview: event.artifactPreview } : {}),
    ...(event.actions ? { actions: event.actions } : {}),
    ...(event.error ? { error: event.error } : {}),
    ...(event.code ? { code: event.code } : {}),
    updatedAt: new Date().toISOString(),
  }
}

export function parseFullstackDemoLifecycleSummary(
  config: unknown
): FullstackDemoLifecycleSummary | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const parsed = fullstackDemoLifecycleSummarySchema.safeParse(
    (config as Record<string, unknown>)[FULLSTACK_DEMO_CONFIG_KEY]
  )
  return parsed.success ? parsed.data : null
}

/**
 * Atomically updates only the Full-stack demo namespace. Other chat config
 * keys remain untouched, including keys written concurrently by other features.
 */
export async function persistFullstackDemoLifecycleSummary(params: {
  chatId: string
  userId: string
  summary: FullstackDemoLifecycleSummary
}): Promise<boolean> {
  const summary = fullstackDemoLifecycleSummarySchema.parse(params.summary)
  const [updated] = await db
    .update(copilotChats)
    .set({
      config: sql`jsonb_set(
        COALESCE(${copilotChats.config}, '{}'::jsonb),
        '{fullstackDemo}',
        ${JSON.stringify(summary)}::jsonb,
        true
      )`,
    })
    .where(and(eq(copilotChats.id, params.chatId), eq(copilotChats.userId, params.userId)))
    .returning({ id: copilotChats.id })
  return Boolean(updated)
}

export async function loadFullstackDemoLifecycleSummary(
  chatId: string,
  userId: string
): Promise<FullstackDemoLifecycleSummary | null> {
  const [row] = await db
    .select({ config: copilotChats.config })
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
    .limit(1)
  return parseFullstackDemoLifecycleSummary(row?.config)
}

export type ValidatedCredentialResume =
  | {
      ok: true
      projectId: string
      workflowIds: string[]
      originalPrompt: string
      resumeMode: 'frontend_build' | 'backend_only'
    }
  | { ok: false; error: string }

export function validateFullstackCredentialResume(params: {
  summary: FullstackDemoLifecycleSummary | null
  projectId: string | undefined
  selections: Record<string, string> | undefined
}): ValidatedCredentialResume {
  const { summary } = params
  if (
    !summary ||
    summary.status !== 'credential_selection_required' ||
    summary.phase !== 'credential_selection_required'
  ) {
    return { ok: false, error: 'This Full-stack chat is not waiting for credential selection.' }
  }
  if (!summary.projectId || params.projectId !== summary.projectId) {
    return { ok: false, error: 'Credential resume does not match the paused App project.' }
  }
  if (!summary.workflowIds?.length || !summary.credentialSelections?.length) {
    return { ok: false, error: 'The saved credential pause is incomplete. Retry the App build.' }
  }
  if (!params.selections) {
    return { ok: false, error: 'Credential selections are required to continue.' }
  }

  const expectedKeys = new Set(
    summary.credentialSelections.map((selection) => selection.bindingKey)
  )
  const suppliedKeys = Object.keys(params.selections)
  if (
    suppliedKeys.length !== expectedKeys.size ||
    suppliedKeys.some((key) => !expectedKeys.has(key))
  ) {
    return { ok: false, error: 'Credential selections do not match the paused request.' }
  }
  for (const request of summary.credentialSelections) {
    const selectedId = params.selections[request.bindingKey]
    if (!selectedId || !request.choices.some((choice) => choice.id === selectedId)) {
      return { ok: false, error: `Select a valid connected account for ${request.serviceId}.` }
    }
  }

  return {
    ok: true,
    projectId: summary.projectId,
    workflowIds: summary.workflowIds,
    originalPrompt: summary.originalPrompt,
    resumeMode: summary.resumeMode ?? 'frontend_build',
  }
}
