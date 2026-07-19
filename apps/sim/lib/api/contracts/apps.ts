import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { jsonSchema202012Schema } from '@/lib/apps/manifest'

const looseJsonResponse = z.record(z.string(), z.unknown())

export const appProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  publicId: z.string(),
  slug: z.string(),
  draftRevisionId: z.string().nullable(),
  publishedReleaseId: z.string().nullable(),
  createdFromChatId: z.string().nullable(),
  lastBuilderChatId: z.string().nullable(),
  createdBy: z.string().nullable(),
  version: z.number().int(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type AppProject = z.output<typeof appProjectSchema>

export const appReleaseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  revisionId: z.string(),
  buildId: z.string().nullable(),
  state: z.enum(['prepared', 'published', 'revoked']),
  artifactManifestHash: z.string(),
  templateVersion: z.string(),
  sdkVersion: z.string(),
  publishedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedReason: z.enum(['vacated', 'manual']).nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
})
export type AppRelease = z.output<typeof appReleaseSchema>

export const appBuildSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  revisionId: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  diagnostics: z.record(z.string(), z.unknown()),
  artifactManifestHash: z.string().nullable(),
  buildImageDigest: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type AppBuild = z.output<typeof appBuildSchema>

export const appDraftActionSchema = z.object({
  actionId: z.string(),
  workflowId: z.string(),
  deploymentVersionId: z.string(),
  outputAllowlist: z.array(
    z.object({
      key: z.string(),
      blockId: z.string(),
      path: z.string(),
      schema: jsonSchema202012Schema.optional(),
    })
  ),
  executionPolicy: z.string(),
  readOnly: z.boolean(),
})
export type AppDraftAction = z.output<typeof appDraftActionSchema>

export const createAppProjectResponseSchema = z.object({ project: appProjectSchema })
export type CreateAppProjectResponse = z.output<typeof createAppProjectResponseSchema>

export const appInterfaceStatusSchema = z.enum(['ready', 'building', 'failed', 'empty'])
export type AppInterfaceStatus = z.output<typeof appInterfaceStatusSchema>

export const appProjectListItemSchema = appProjectSchema.extend({
  interfaceStatus: appInterfaceStatusSchema,
  thumbnailUrl: z.string().nullable(),
})
export type AppProjectListItem = z.output<typeof appProjectListItemSchema>

export const listAppProjectsResponseSchema = z.object({
  projects: z.array(appProjectListItemSchema),
})
export type ListAppProjectsResponse = z.output<typeof listAppProjectsResponseSchema>

export const getAppProjectResponseSchema = z.object({
  project: appProjectSchema,
  publicUrl: z.string().nullable(),
  currentRelease: appReleaseSchema.nullable(),
  releases: z.array(appReleaseSchema),
  draftActions: z.array(appDraftActionSchema),
  latestBuild: appBuildSchema.nullable(),
})
export type GetAppProjectResponse = z.output<typeof getAppProjectResponseSchema>

export const createAppProjectBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64),
  createdFromChatId: z.string().uuid().optional().nullable(),
})
export type CreateAppProjectBody = z.input<typeof createAppProjectBodySchema>

export const createAppProjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps',
  body: createAppProjectBodySchema,
  response: { mode: 'json', schema: createAppProjectResponseSchema },
})

export const listAppProjectsContract = defineRouteContract({
  method: 'GET',
  path: '/api/apps',
  query: z.object({
    workspaceId: z.string().min(1),
  }),
  response: { mode: 'json', schema: listAppProjectsResponseSchema },
})

export const appProjectParamsSchema = z.object({
  projectId: z.string().min(1),
})

export const getAppProjectContract = defineRouteContract({
  method: 'GET',
  path: '/api/apps/[projectId]',
  params: appProjectParamsSchema,
  response: { mode: 'json', schema: getAppProjectResponseSchema },
})

export const appProjectThumbnailContract = defineRouteContract({
  method: 'GET',
  path: '/api/apps/[projectId]/thumbnail',
  params: appProjectParamsSchema,
  response: { mode: 'binary' },
})

export const deleteAppProjectContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/apps/[projectId]',
  params: appProjectParamsSchema,
  response: { mode: 'json', schema: z.object({ archived: z.boolean() }) },
})

export const publishAppReleaseBodySchema = z.object({
  releaseId: z.string().min(1),
  expectedVersion: z.number().int().optional(),
})
export type PublishAppReleaseBody = z.input<typeof publishAppReleaseBodySchema>

export const publishAppReleaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/releases/publish',
  params: appProjectParamsSchema,
  body: publishAppReleaseBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ releaseId: z.string(), state: z.literal('published') }),
  },
})

export const appPublishDeploymentSchema = z.object({
  workflowId: z.string(),
  deploymentVersionId: z.string(),
})

export const publishAppWithDeployRecoverySchema = z.object({
  resumed: z.boolean(),
  reusedDeployments: z.array(z.string()),
  reusedReboundRevision: z.boolean(),
  reusedBuild: z.boolean(),
  reusedRelease: z.boolean(),
  reusedPublication: z.boolean(),
})

export const publishAppWithDeployBodySchema = z.object({
  /** Optional for compatibility; current clients always generate and reuse one. */
  operationId: z.string().uuid().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
})
export type PublishAppWithDeployBody = z.input<typeof publishAppWithDeployBodySchema>

export const publishAppWithDeployResponseSchema = z.object({
  operationId: z.string(),
  stage: z.literal('published'),
  releaseId: z.string(),
  revisionId: z.string(),
  buildId: z.string(),
  deployments: z.array(appPublishDeploymentSchema),
  state: z.literal('published'),
  recovery: publishAppWithDeployRecoverySchema,
})
export type PublishAppWithDeployResponse = z.output<typeof publishAppWithDeployResponseSchema>

export const publishAppWithDeployErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  operationId: z.string(),
  stage: z.enum(['deploying', 'rebinding', 'building', 'preparing', 'publishing', 'published']),
  recoverable: z.boolean(),
  retryAfterMs: z.number().int().positive().optional(),
  partialDeployments: z.array(appPublishDeploymentSchema).optional(),
  recovery: publishAppWithDeployRecoverySchema,
})
export type PublishAppWithDeployError = z.output<typeof publishAppWithDeployErrorSchema>

export const publishAppWithDeployContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/releases/publish-with-deploy',
  params: appProjectParamsSchema,
  body: publishAppWithDeployBodySchema,
  response: { mode: 'json', schema: publishAppWithDeployResponseSchema },
})

export const revokeAppReleaseBodySchema = z.object({
  releaseId: z.string().min(1),
})
export type RevokeAppReleaseBody = z.input<typeof revokeAppReleaseBodySchema>

export const revokeAppReleaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/releases/revoke',
  params: appProjectParamsSchema,
  body: revokeAppReleaseBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      revoked: z.boolean(),
      clearedPointer: z.boolean(),
      tombstone: z.boolean(),
    }),
  },
})

export const rollbackAppReleaseBodySchema = z.object({
  targetReleaseId: z.string().min(1),
})
export type RollbackAppReleaseBody = z.input<typeof rollbackAppReleaseBodySchema>

export const rollbackAppReleaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/releases/rollback',
  params: appProjectParamsSchema,
  body: rollbackAppReleaseBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ publishedReleaseId: z.string(), revokedVacated: z.boolean() }),
  },
})

/** Prepare accepts only revisionId + buildId; actions/versions derived server-side. */
export const prepareAppReleaseBodySchema = z.object({
  revisionId: z.string().min(1),
  buildId: z.string().min(1),
  expectedRevisionId: z.string().min(1).optional(),
})
export type PrepareAppReleaseBody = z.input<typeof prepareAppReleaseBodySchema>

export const prepareAppReleaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/releases/prepare',
  params: appProjectParamsSchema,
  body: prepareAppReleaseBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ releaseId: z.string(), state: z.literal('prepared') }),
  },
})

/** Bind request: server derives inputSchema + output schemas from the pinned deployment. */
export const bindAppActionRequestSchema = z.object({
  actionId: z.string().min(1).max(128),
  workflowId: z.string().min(1),
  deploymentVersionId: z.string().min(1),
  outputAllowlist: z
    .array(
      z.object({
        key: z.string().min(1).max(128),
        blockId: z.string().min(1),
        path: z.string().min(1),
      })
    )
    .default([]),
  /** Phase 1 only supports sync — reject async at the boundary. */
  executionPolicy: z.literal('sync').default('sync'),
  readOnly: z.boolean().default(false),
})

export const bindAppRevisionBodySchema = z
  .object({
    actions: z.array(bindAppActionRequestSchema).min(1),
    expectedRevisionId: z.string().min(1).optional(),
  })
  .superRefine((body, ctx) => {
    const actionIds = new Set<string>()
    for (const [i, action] of body.actions.entries()) {
      if (actionIds.has(action.actionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate actionId "${action.actionId}"`,
          path: ['actions', i, 'actionId'],
        })
      }
      actionIds.add(action.actionId)

      const outputKeys = new Set<string>()
      for (const [j, out] of action.outputAllowlist.entries()) {
        if (outputKeys.has(out.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate output key "${out.key}"`,
            path: ['actions', i, 'outputAllowlist', j, 'key'],
          })
        }
        outputKeys.add(out.key)
      }
    }
  })
export type BindAppRevisionBody = z.input<typeof bindAppRevisionBodySchema>

export const bindAppRevisionContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/revisions',
  params: appProjectParamsSchema,
  body: bindAppRevisionBodySchema,
  response: { mode: 'json', schema: z.object({ revisionId: z.string() }) },
})

export const detachAppRevisionBodySchema = z.object({
  actionId: z.string().min(1).max(128),
  expectedRevisionId: z.string().min(1).optional(),
})
export type DetachAppRevisionBody = z.input<typeof detachAppRevisionBodySchema>

export const detachAppRevisionContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/apps/[projectId]/revisions',
  params: appProjectParamsSchema,
  body: detachAppRevisionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ revisionId: z.string(), detachedActionId: z.string() }),
  },
})

export const buildAppRevisionBodySchema = z.object({
  revisionId: z.string().min(1),
  expectedRevisionId: z.string().min(1).optional(),
})
export type BuildAppRevisionBody = z.input<typeof buildAppRevisionBodySchema>

export const buildAppRevisionContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/build',
  params: appProjectParamsSchema,
  body: buildAppRevisionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      buildId: z.string(),
      artifactManifestHash: z.string(),
      buildImageDigest: z.string(),
      diagnostics: z.record(z.string(), z.unknown()),
      reused: z.boolean().optional(),
    }),
  },
})

export const previewSessionBodySchema = z.object({
  revisionId: z.string().min(1),
  mode: z.enum(['replace', 'supersede']).default('replace'),
})
export type PreviewSessionBody = z.input<typeof previewSessionBodySchema>

export const previewSessionContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/preview/session',
  params: appProjectParamsSchema,
  body: previewSessionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      sessionId: z.string(),
      channelNonce: z.string(),
      expiresAt: z.string(),
      appPublicOrigin: z.string(),
      buildId: z.string(),
      artifactManifestHash: z.string().nullable(),
      artifactPreview: z.boolean(),
      actions: z.array(z.object({ actionId: z.string(), readOnly: z.boolean() })),
    }),
  },
})

export const previewHeartbeatBodySchema = z.object({
  sessionId: z.string().min(1),
})

export const previewHeartbeatContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/preview/heartbeat',
  params: appProjectParamsSchema,
  body: previewHeartbeatBodySchema,
  response: { mode: 'json', schema: z.object({ expiresAt: z.string() }) },
})

export const previewStopBodySchema = z.object({
  sessionId: z.string().min(1),
})

export const previewStopContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/preview/stop',
  params: appProjectParamsSchema,
  body: previewStopBodySchema,
  response: { mode: 'json', schema: z.object({ stopped: z.boolean() }) },
})

export const previewCandidateBodySchema = z.object({
  sessionId: z.string().min(1),
})

export const previewPromoteContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/preview/promote',
  params: appProjectParamsSchema,
  body: previewCandidateBodySchema,
  response: { mode: 'json', schema: z.object({ promoted: z.boolean() }) },
})

export const previewAbortCandidateContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/preview/abort-candidate',
  params: appProjectParamsSchema,
  body: previewCandidateBodySchema,
  response: { mode: 'json', schema: z.object({ aborted: z.boolean() }) },
})

export const previewExecuteBodySchema = z.object({
  sessionId: z.string().min(1),
  actionId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  confirmed: z.boolean().default(false),
})

export const previewExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/[projectId]/preview/execute',
  params: appProjectParamsSchema,
  body: previewExecuteBodySchema,
  response: {
    mode: 'json',
    // untyped-response: selected workflow output values are user-defined JSON
    schema: z.object({
      success: z.boolean(),
      executionId: z.string(),
      outputs: z.record(z.string(), z.unknown()),
    }),
  },
})

export const gatewayActionParamsSchema = z.object({
  releaseId: z.string().min(1),
  actionId: z.string().min(1),
})

export const gatewayActionBodySchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
})

export const gatewayActionContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/gateway/releases/[releaseId]/actions/[actionId]',
  params: gatewayActionParamsSchema,
  body: gatewayActionBodySchema,
  response: { mode: 'json', schema: looseJsonResponse },
})

export const abuseSessionBodySchema = z.object({
  publicId: z.string().min(1),
  turnstileToken: z.string().min(1).optional(),
  visitorId: z.string().min(1).max(128),
})

export const abuseSessionContract = defineRouteContract({
  method: 'POST',
  path: '/api/apps/gateway/abuse/session',
  body: abuseSessionBodySchema,
  response: { mode: 'json', schema: looseJsonResponse },
})

export const publicServeMetaParamsSchema = z.object({
  publicId: z.string().min(1),
})

export const publicServeMetaContract = defineRouteContract({
  method: 'GET',
  path: '/api/apps/public/[publicId]/serve-meta',
  params: publicServeMetaParamsSchema,
  query: z.object({
    slug: z.string().optional(),
  }),
  response: { mode: 'json', schema: looseJsonResponse },
})

export const previewServeMetaContract = defineRouteContract({
  method: 'GET',
  path: '/api/apps/public/preview/[sessionId]/serve-meta',
  params: z.object({ sessionId: z.string().min(1) }),
  query: z.object({ nonce: z.string().min(1) }),
  response: {
    mode: 'json',
    schema: z.object({
      sessionId: z.string(),
      buildId: z.string().nullable(),
      artifactManifestHash: z.string().nullable(),
      fixtureOnly: z.boolean(),
      channelNonce: z.string(),
      htmlNonce: z.string(),
      publicId: z.string(),
      slug: z.string(),
      gatewayOrigin: z.string(),
    }),
  },
})

export const fixtureAppHtmlContract = defineRouteContract({
  method: 'GET',
  path: '/api/apps/public/[publicId]/releases/[releaseId]/html',
  params: z.object({
    publicId: z.string().min(1),
    releaseId: z.string().min(1),
  }),
  query: z.object({ nonce: z.string().min(8).max(64) }),
  response: { mode: 'text' },
})
