import { z } from 'zod'
import { chatAuthTypeSchema } from '@/lib/api/contracts/chats'
import {
  booleanQueryFlagSchema,
  noInputSchema,
  nonEmptyIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 chat-deployment contracts.
 *
 * A chat deployment publishes one workflow as a hosted conversation. Two things
 * about the resource shape a caller would otherwise guess wrong:
 *
 * 1. **There is no chat subdomain.** Despite what some product copy says, the
 *    proxy routes deployed chats purely by the `/chat/` path, so a deployment is
 *    identified by `identifier` and reachable at `url`. Nothing here publishes a
 *    host a caller could point DNS at.
 * 2. **A password is never readable back.** `password` is write-only on both
 *    bodies; reads carry `hasPassword` and nothing else. Publishing a decrypt on
 *    an API-key surface would turn a stored secret into a fetchable one, so the
 *    existing session-only reveal endpoint deliberately has no v2 counterpart.
 */

export const V2_CHAT_DEPLOYMENT_TITLE_MAX = 200
export const V2_CHAT_DEPLOYMENT_DESCRIPTION_MAX = 2000
export const V2_CHAT_DEPLOYMENT_ALLOWED_EMAILS_MAX = 500
export const V2_CHAT_DEPLOYMENT_OUTPUT_CONFIGS_MAX = 100

export const v2ChatDeploymentIdParamsSchema = z
  .object({
    chatDeploymentId: nonEmptyIdSchema.describe('Unique chat deployment identifier.'),
  })
  .meta({
    id: 'ChatDeploymentParams',
    title: 'Chat deployment path parameters',
    description: 'Chat deployment selected by the request path.',
  })
export type V2ChatDeploymentParams = z.output<typeof v2ChatDeploymentIdParamsSchema>

/**
 * The workspace the caller asserts the deployment belongs to.
 *
 * Required, like every other v2 resource-detail route: the assertion is what
 * lets a deployment in a workspace the caller did not name be concealed as a
 * `404` rather than authorized on the strength of the id alone.
 */
export const v2ChatDeploymentScopeQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the chat deployment.'),
  })
  .strict()
  .meta({
    id: 'ChatDeploymentScopeQuery',
    title: 'Chat deployment scope query',
    description: 'Workspace the chat deployment is asserted to belong to.',
  })
export type V2ChatDeploymentScopeQuery = z.output<typeof v2ChatDeploymentScopeQuerySchema>

/**
 * Strict on the nested object, not only on the body: `.strict()` binds one
 * level, so a misspelled customization key would otherwise be dropped silently
 * and the deployment would render with the default the caller thought it had
 * overridden.
 *
 * Request-side only. `chat.customizations` is schemaless JSONB written by
 * surfaces with wider shapes than this one — the internal editor stores
 * `logoUrl` and `headerText`, and the Copilot tool stores whatever it is given —
 * so parsing a stored row against these bounds would turn a legitimate row into
 * a `500`. The response declares {@link v2StoredChatDeploymentCustomizationsSchema}
 * instead, and `toV2ChatDeployment` projects the blob onto it.
 */
export const v2ChatDeploymentCustomizationsSchema = z
  .object({
    primaryColor: z
      .string()
      .min(1, 'customizations.primaryColor cannot be empty')
      .max(64, 'customizations.primaryColor must be at most 64 characters')
      .optional()
      .describe('CSS color used for the chat accent.'),
    welcomeMessage: z
      .string()
      .max(2000, 'customizations.welcomeMessage must be at most 2000 characters')
      .optional()
      .describe('First message shown to a visitor.'),
    imageUrl: z
      .string()
      .max(2048, 'customizations.imageUrl must be at most 2048 characters')
      .optional()
      .describe('Avatar image shown beside assistant messages.'),
  })
  .strict()
  .meta({
    id: 'ChatDeploymentCustomizations',
    title: 'Chat deployment customizations',
    description: 'Presentation overrides for the deployed chat.',
  })

/** The customization keys a stored blob may contribute to a v2 read. */
export const V2_CHAT_DEPLOYMENT_CUSTOMIZATION_KEYS = [
  'primaryColor',
  'welcomeMessage',
  'imageUrl',
] as const satisfies readonly (keyof z.output<typeof v2ChatDeploymentCustomizationsSchema>)[]

/**
 * The read shape of {@link v2ChatDeploymentCustomizationsSchema}: same keys, no
 * bounds and no `.strict()`. A stored value only has to be a string to be
 * publishable, and a key this surface does not declare is dropped rather than
 * rejected.
 */
export const v2StoredChatDeploymentCustomizationsSchema = z
  .object({
    primaryColor: z.string().optional().describe('CSS color used for the chat accent.'),
    welcomeMessage: z.string().optional().describe('First message shown to a visitor.'),
    imageUrl: z.string().optional().describe('Avatar image shown beside assistant messages.'),
  })
  .meta({
    id: 'StoredChatDeploymentCustomizations',
    title: 'Stored chat deployment customizations',
    description: 'Presentation overrides currently stored on the deployed chat.',
  })

export const v2ChatDeploymentOutputConfigSchema = z
  .object({
    blockId: z
      .string()
      .min(1, 'outputConfigs[].blockId cannot be empty')
      .describe('Block whose output the chat streams.'),
    path: z
      .string()
      .min(1, 'outputConfigs[].path cannot be empty')
      .describe('Path within that block output.'),
  })
  .strict()
  .meta({
    id: 'ChatDeploymentOutputConfig',
    title: 'Chat deployment output config',
    description: 'One block output surfaced to chat visitors.',
  })

/**
 * The read shape of {@link v2ChatDeploymentOutputConfigSchema}.
 *
 * `path` carries no `.min(1)`: the create path accepts an empty path — it means
 * "the whole block output" — and `chat.output_configs` is schemaless JSONB, so
 * requiring one on the way out would `500` every read of a deployment the
 * create path legitimately wrote.
 */
export const v2StoredChatDeploymentOutputConfigSchema = z
  .object({
    blockId: z.string().describe('Block whose output the chat streams.'),
    path: z.string().describe('Path within that block output. Empty means the whole output.'),
  })
  .meta({
    id: 'StoredChatDeploymentOutputConfig',
    title: 'Stored chat deployment output config',
    description: 'One block output currently surfaced to chat visitors.',
  })

export const v2ChatDeploymentSchema = z
  .object({
    id: z.string().describe('Unique chat deployment identifier.'),
    workflowId: z.string().describe('Workflow this deployment publishes.'),
    workspaceId: z
      .string()
      .describe('Workspace the deployment belongs to, derived from its workflow.'),
    identifier: z
      .string()
      .describe('URL slug the deployed chat answers on. Unique across live deployments.'),
    url: z
      .string()
      .describe(
        'Public URL of the deployed chat. There is no chat subdomain — the identifier is a path segment.'
      )
      .meta({ examples: ['https://sim.ai/chat/support'] }),
    title: z.string().describe('Title shown to visitors.'),
    description: z.string().describe('Description shown to visitors. Empty when unset.'),
    isActive: z.boolean().describe('Whether the deployment answers requests.'),
    authType: chatAuthTypeSchema.describe(
      'How visitors are gated: `public` (no gate), `password`, `email`, or `sso`.'
    ),
    hasPassword: z
      .boolean()
      .describe('Whether a password is stored. The password itself is never readable.'),
    allowedEmails: z
      .array(z.string())
      .describe(
        'Email addresses or domains admitted under `email` and `sso` gating. Empty otherwise.'
      ),
    customizations: v2StoredChatDeploymentCustomizationsSchema.describe(
      'Presentation overrides. Unset fields fall back to platform defaults.'
    ),
    outputConfigs: z
      .array(v2StoredChatDeploymentOutputConfigSchema)
      .describe('Block outputs surfaced to visitors.'),
    includeThinking: z
      .boolean()
      .describe(
        'Whether visitors may receive provider thinking events. They must also opt into the streaming protocol.'
      ),
    includeToolCalls: z
      .boolean()
      .describe(
        'Whether visitors may receive tool lifecycle events. They must also opt into the streaming protocol.'
      ),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when the deployment was created.')
      .meta({ format: 'date-time' }),
    updatedAt: z
      .string()
      .describe('ISO 8601 timestamp when the deployment was last modified.')
      .meta({ format: 'date-time' }),
  })
  .meta({
    id: 'ChatDeployment',
    title: 'Chat deployment',
    description: 'A workflow published as a hosted chat.',
  })
export type V2ChatDeployment = z.output<typeof v2ChatDeploymentSchema>

/**
 * The fields a workspace-wide read does not carry.
 *
 * `allowedEmails` is an access-control list and `hasPassword` is an auth-posture
 * signal, so neither belongs on a list any workspace member — or any workspace
 * API key — can call. `customizations` follows them because it is deployment
 * configuration rather than something a caller needs to find a deployment.
 *
 * They stay available on `GET /api/v2/chat-deployments/{id}`, which is gated at
 * workspace `admin`. Narrowing the projection is what lets the list stay a
 * `read` operation, and reachable by a workspace key, without the detail read's
 * gate being routable around.
 */
const V2_CHAT_DEPLOYMENT_GATED_FIELDS = {
  allowedEmails: true,
  hasPassword: true,
  customizations: true,
} as const

/**
 * One entry in a chat-deployment list: enough to find a deployment and decide
 * whether to fetch it, and nothing the detail read gates.
 */
export const v2ChatDeploymentListItemSchema = v2ChatDeploymentSchema
  .omit(V2_CHAT_DEPLOYMENT_GATED_FIELDS)
  .meta({
    id: 'ChatDeploymentListItem',
    title: 'Chat deployment list entry',
    description: 'A workflow published as a hosted chat, without the fields the detail read gates.',
  })
export type V2ChatDeploymentListItem = z.output<typeof v2ChatDeploymentListItemSchema>

export const v2ChatDeploymentSortFields = ['identifier', 'createdAt', 'updatedAt'] as const
export type V2ChatDeploymentSortBy = (typeof v2ChatDeploymentSortFields)[number]

export const v2ListChatDeploymentsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose chat deployments to list.'),
    workflowId: workflowIdSchema.optional().describe('Restrict to deployments of one workflow.'),
    isActive: booleanQueryFlagSchema
      .optional()
      .describe('Restrict to active or inactive deployments.'),
    ...v2SortFields(v2ChatDeploymentSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
    ...v2PaginationFields({ description: 'Maximum chat deployments to return per page.' }),
  })
  .strict()
  .meta({
    id: 'ListChatDeploymentsQuery',
    title: 'List chat deployments query',
    description: 'Workspace scope, filters, ordering, and pagination for chat deployments.',
  })
export type V2ListChatDeploymentsQuery = z.output<typeof v2ListChatDeploymentsQuerySchema>

const chatIdentifierSchema = z
  .string()
  .min(1, 'identifier cannot be empty')
  .max(128, 'identifier must be at most 128 characters')
  .regex(/^[a-z0-9-]+$/, 'identifier can only contain lowercase letters, numbers, and hyphens')

const chatAllowedEmailsSchema = z
  .array(z.string().min(1, 'allowedEmails[] cannot be empty'))
  .max(
    V2_CHAT_DEPLOYMENT_ALLOWED_EMAILS_MAX,
    `allowedEmails must contain at most ${V2_CHAT_DEPLOYMENT_ALLOWED_EMAILS_MAX} entries`
  )

const chatOutputConfigsSchema = z
  .array(v2ChatDeploymentOutputConfigSchema)
  .max(
    V2_CHAT_DEPLOYMENT_OUTPUT_CONFIGS_MAX,
    `outputConfigs must contain at most ${V2_CHAT_DEPLOYMENT_OUTPUT_CONFIGS_MAX} entries`
  )

/**
 * Creating a chat deployment also deploys the workflow it publishes, because a
 * chat serves the live version. A workflow already carrying a live deployment is
 * republished only when its draft has drifted.
 */
export const v2CreateChatDeploymentBodySchema = z
  .object({
    workflowId: workflowIdSchema.describe('Workflow to publish as a chat.'),
    identifier: chatIdentifierSchema.describe(
      'URL slug the deployed chat will answer on. Must be free across live deployments.'
    ),
    title: z
      .string()
      .min(1, 'title cannot be empty')
      .max(
        V2_CHAT_DEPLOYMENT_TITLE_MAX,
        `title must be at most ${V2_CHAT_DEPLOYMENT_TITLE_MAX} characters`
      )
      .describe('Title shown to visitors.'),
    description: z
      .string()
      .max(
        V2_CHAT_DEPLOYMENT_DESCRIPTION_MAX,
        `description must be at most ${V2_CHAT_DEPLOYMENT_DESCRIPTION_MAX} characters`
      )
      .optional()
      .describe('Description shown to visitors.'),
    customizations: v2ChatDeploymentCustomizationsSchema
      .optional()
      .describe('Presentation overrides. Omitted fields take platform defaults.'),
    authType: chatAuthTypeSchema
      .optional()
      .describe('How visitors are gated. `public` leaves the chat open to anyone holding the URL.')
      .meta({ default: 'public' }),
    /** Write-only. Reads expose `hasPassword` instead. */
    password: z
      .string()
      .min(1, 'password cannot be empty')
      .max(1024, 'password must be at most 1024 characters')
      .optional()
      .describe(
        'Write-only password, required when `authType` is `password`. Never readable back.'
      ),
    allowedEmails: chatAllowedEmailsSchema
      .optional()
      .describe(
        'Email addresses or domains admitted under `email` and `sso` gating. At least one is required for those modes.'
      ),
    outputConfigs: chatOutputConfigsSchema
      .optional()
      .describe('Block outputs to surface to visitors.'),
    includeThinking: z
      .boolean()
      .optional()
      .describe('Allow visitors to receive provider thinking events.')
      .meta({ default: false }),
    includeToolCalls: z
      .boolean()
      .optional()
      .describe('Allow visitors to receive tool lifecycle events.')
      .meta({ default: false }),
  })
  .strict()
  .meta({
    id: 'CreateChatDeploymentRequest',
    title: 'Create chat deployment request',
    description: 'A workflow to publish as a chat and how visitors reach it.',
    examples: [
      {
        workflowId: '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36',
        identifier: 'support',
        title: 'Support chat',
      },
    ],
  })
export type V2CreateChatDeploymentBody = z.input<typeof v2CreateChatDeploymentBodySchema>

/**
 * Merge-patch shaped: an omitted key is unchanged. `workflowId` is absent by
 * design — a deployment is bound to its workflow for its whole life, and
 * re-pointing one is a new deployment.
 */
export const v2UpdateChatDeploymentBodySchema = z
  .object({
    identifier: chatIdentifierSchema.optional().describe('New URL slug for the deployed chat.'),
    title: z
      .string()
      .min(1, 'title cannot be empty')
      .max(
        V2_CHAT_DEPLOYMENT_TITLE_MAX,
        `title must be at most ${V2_CHAT_DEPLOYMENT_TITLE_MAX} characters`
      )
      .optional()
      .describe('New title shown to visitors.'),
    description: z
      .string()
      .max(
        V2_CHAT_DEPLOYMENT_DESCRIPTION_MAX,
        `description must be at most ${V2_CHAT_DEPLOYMENT_DESCRIPTION_MAX} characters`
      )
      .optional()
      .describe('New description shown to visitors.'),
    customizations: v2ChatDeploymentCustomizationsSchema
      .optional()
      .describe('Replacement presentation overrides. Replaced wholesale, not merged.'),
    authType: chatAuthTypeSchema
      .optional()
      .describe(
        'New visitor gate. Switching modes clears the gate the previous mode owned: a stored password is dropped when moving to `email` or `sso`, and the allow-list is cleared when moving to `password` or `public` unless the same request supplies a replacement `allowedEmails`, which is applied after the clear.'
      ),
    password: z
      .string()
      .min(1, 'password cannot be empty')
      .max(1024, 'password must be at most 1024 characters')
      .optional()
      .describe(
        'Write-only replacement password. Ignored unless the deployment ends up `password`-gated. Omit to keep the stored one.'
      ),
    allowedEmails: chatAllowedEmailsSchema
      .optional()
      .describe('Replacement allow-list for `email` and `sso` gating. Replaced wholesale.'),
    outputConfigs: chatOutputConfigsSchema
      .optional()
      .describe('Replacement block outputs. Replaced wholesale.'),
    includeThinking: z.boolean().optional().describe('Allow visitors to receive thinking events.'),
    includeToolCalls: z
      .boolean()
      .optional()
      .describe('Allow visitors to receive tool lifecycle events.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (Object.values(body).every((value) => value === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'At least one field must be provided',
      })
    }
  })
  .meta({
    id: 'UpdateChatDeploymentRequest',
    title: 'Update chat deployment request',
    description: 'Merge-patch body for a chat deployment.',
    examples: [{ title: 'Support chat', authType: 'public' }],
  })
export type V2UpdateChatDeploymentBody = z.input<typeof v2UpdateChatDeploymentBodySchema>

export const v2DeleteChatDeploymentDataSchema = z
  .object({
    id: z.string().describe('Identifier of the removed chat deployment.'),
    deleted: z.literal(true).describe('Whether the deployment was removed.'),
  })
  .meta({
    id: 'DeleteChatDeploymentResult',
    title: 'Delete chat deployment result',
    description: 'Chat deployment removal acknowledgement.',
  })
export type V2DeleteChatDeploymentData = z.output<typeof v2DeleteChatDeploymentDataSchema>

export const v2ListChatDeploymentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/chat-deployments',
  query: v2ListChatDeploymentsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2ChatDeploymentListItemSchema),
  },
})

export const v2CreateChatDeploymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/chat-deployments',
  query: noInputSchema,
  body: v2CreateChatDeploymentBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ChatDeploymentSchema),
  },
})

export const v2GetChatDeploymentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/chat-deployments/[chatDeploymentId]',
  query: v2ChatDeploymentScopeQuerySchema,
  params: v2ChatDeploymentIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ChatDeploymentSchema),
  },
})

export const v2UpdateChatDeploymentContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/chat-deployments/[chatDeploymentId]',
  query: v2ChatDeploymentScopeQuerySchema,
  params: v2ChatDeploymentIdParamsSchema,
  body: v2UpdateChatDeploymentBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ChatDeploymentSchema),
  },
})

export const v2DeleteChatDeploymentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/chat-deployments/[chatDeploymentId]',
  query: v2ChatDeploymentScopeQuerySchema,
  params: v2ChatDeploymentIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteChatDeploymentDataSchema),
  },
})
