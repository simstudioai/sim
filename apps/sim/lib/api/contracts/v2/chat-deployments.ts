import { z } from 'zod'
import { chatAuthTypeSchema, chatDeploymentPasswordSchema } from '@/lib/api/contracts/chats'
import {
  booleanQueryFlagSchema,
  noInputSchema,
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
import { v2WorkflowIdParamsSchema } from '@/lib/api/contracts/v2/workflows'

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
 * 2. **A password is never readable back.** `password` is write-only; reads
 *    carry `hasPassword` and nothing else. Publishing a decrypt on an API-key
 *    surface would turn a stored secret into a fetchable one, so the existing
 *    session-only reveal endpoint deliberately has no v2 counterpart.
 * 3. **It is a singleton of its workflow, not a resource with its own id.** A
 *    chat is strictly 1:1 with the workflow it publishes — `workflowId` is
 *    `NOT NULL`, cascades, and cannot be re-pointed — so the workflow already
 *    addresses the chat uniquely and it lives at
 *    `/api/v2/workflows/{workflowId}/deployments/chat`. A singleton has no separate
 *    create verb, so `PUT` is create-or-replace and is the only write. The
 *    deployment's `id` is still published, because audit records and the
 *    internal editor name it, but no v2 path takes one.
 */

export const V2_CHAT_DEPLOYMENT_TITLE_MAX = 200
export const V2_CHAT_DEPLOYMENT_DESCRIPTION_MAX = 2000
export const V2_CHAT_DEPLOYMENT_ALLOWED_EMAILS_MAX = 500
export const V2_CHAT_DEPLOYMENT_OUTPUT_CONFIGS_MAX = 100

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
 * They stay available on `GET /api/v2/workflows/{workflowId}/deployments/chat`, which is
 * gated at workspace `admin`. Narrowing the projection is what lets the list stay
 * a `read` operation, and reachable by a workspace key, without the singleton
 * read's gate being routable around.
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
 * The full representation of a workflow's chat.
 *
 * `PUT` is create-or-replace, so this is the whole resource rather than a set of
 * changes: the deployment ends up as exactly what this body describes, and an
 * omitted optional field takes its platform default rather than whatever the
 * previous deployment carried. There is no `workflowId` — the path names it, and
 * a deployment is bound to its workflow for its whole life.
 *
 * Replacing also deploys the workflow, because a chat serves the live version.
 */
export const v2ReplaceChatDeploymentBodySchema = z
  .object({
    identifier: chatIdentifierSchema.describe(
      'URL slug the deployed chat answers on. Must be free across live deployments.'
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
      .describe('Description shown to visitors. Omitted clears it.'),
    customizations: v2ChatDeploymentCustomizationsSchema
      .optional()
      .describe('Presentation overrides. Omitted fields take platform defaults.'),
    authType: chatAuthTypeSchema
      .optional()
      .describe('How visitors are gated. `public` leaves the chat open to anyone holding the URL.')
      .meta({ default: 'public' }),
    /**
     * Write-only, and required rather than carried over.
     *
     * Reads publish `hasPassword` and never the password, so a caller cannot read
     * one back to re-send it. Carrying the stored password over implicitly would
     * be the one place a replace quietly stopped meaning replace, and it would
     * make the verb non-idempotent from the caller's point of view — so a
     * password-gated result must state its password every time.
     */
    password: chatDeploymentPasswordSchema
      .min(1, 'password cannot be empty')
      .optional()
      .describe(
        'Write-only password. Required whenever `authType` is `password`, and rejected otherwise. Never readable back.'
      ),
    allowedEmails: chatAllowedEmailsSchema
      .optional()
      .describe(
        'Email addresses or domains admitted under `email` and `sso` gating. At least one is required for those modes.'
      ),
    outputConfigs: chatOutputConfigsSchema
      .optional()
      .describe('Block outputs to surface to visitors. Omitted surfaces none.'),
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
  .superRefine((body, ctx) => {
    const authType = body.authType ?? 'public'
    /**
     * Each mode owns exactly one gate column, so a body naming the wrong one is
     * refused rather than silently dropped. Under merge-patch semantics a stray
     * `password` was ignorable; under replace it would read as configuration the
     * caller believes is stored.
     */
    if (authType === 'password' && !body.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'password is required when authType is "password"',
      })
    }
    if (authType !== 'password' && body.password !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: `password cannot be set when authType is "${authType}"; only "password" gating stores one`,
      })
    }
    if ((authType === 'email' || authType === 'sso') && (body.allowedEmails ?? []).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedEmails'],
        message: `allowedEmails must contain at least one email or domain when authType is "${authType}"`,
      })
    }
    if (authType !== 'email' && authType !== 'sso' && (body.allowedEmails ?? []).length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowedEmails'],
        message: `allowedEmails cannot be set when authType is "${authType}"; only "email" and "sso" gating admit an allow-list`,
      })
    }
  })
  .meta({
    id: 'ReplaceChatDeploymentRequest',
    title: 'Replace chat deployment request',
    description: "The complete desired state of a workflow's chat.",
    examples: [{ identifier: 'support', title: 'Support chat' }],
  })
export type V2ReplaceChatDeploymentBody = z.input<typeof v2ReplaceChatDeploymentBodySchema>

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

/**
 * The cross-parent discovery collection.
 *
 * Every write addresses one workflow's chat, but "what does this workspace
 * serve" is a question no per-workflow path can answer, so the list stays
 * workspace-scoped and keeps its own cursor binding.
 */
export const v2ListChatDeploymentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/chat-deployments',
  query: v2ListChatDeploymentsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2ChatDeploymentListItemSchema),
  },
})

export const v2GetWorkflowChatDeploymentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/deployments/chat',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ChatDeploymentSchema),
  },
})

export const v2ReplaceWorkflowChatDeploymentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/workflows/[workflowId]/deployments/chat',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  body: v2ReplaceChatDeploymentBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ChatDeploymentSchema),
  },
})

export const v2DeleteWorkflowChatDeploymentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/workflows/[workflowId]/deployments/chat',
  query: noInputSchema,
  params: v2WorkflowIdParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteChatDeploymentDataSchema),
  },
})
