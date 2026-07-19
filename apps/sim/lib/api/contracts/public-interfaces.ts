import { z } from 'zod'
import { submitInterfaceFormBodySchema } from '@/lib/api/contracts/interfaces'
import { booleanQueryFlagSchema, inlineFileRefQuerySchema } from '@/lib/api/contracts/primitives'
import { publicInterfaceTokenParamsSchema } from '@/lib/api/contracts/public-shares'
import { tableRowSchema } from '@/lib/api/contracts/tables'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Token-scoped data wires for a publicly shared interface.
 *
 * Every route here is addressed by `(token, moduleId)` and **nothing else**: no
 * `workflowId`, `tableId`, or `fileId` is ever accepted, because the resource is
 * derived server-side from the interface's stored layout on each request. There
 * is therefore nothing for a caller to forge, and no comparison to get wrong.
 *
 * The narrowness of these schemas is itself a security control — a field absent
 * from a body/query schema is stripped by Zod before the handler sees it, so a
 * client cannot smuggle `selectedOutputs`, `executionId`, `useDraftState`,
 * `filter`, or `sort` into a public run or read.
 */

/**
 * Hard per-request page size for public table reads. Larger than the module's
 * viewport so the first paint needs one round trip, small enough that a single
 * anonymous request cannot materialize an unbounded page.
 */
export const PUBLIC_TABLE_PAGE_SIZE = 100

/**
 * Hard ceiling on how deep an anonymous visitor may page into a shared table.
 * Without it the module's scroll-triggered paging would happily drain a
 * million-row table over public traffic. Past the ceiling the route reports
 * `hasMore: false` and the module's footer keeps showing the true total.
 */
export const PUBLIC_TABLE_MAX_ROWS = 1000

/** Upper bound on one public chat turn. The public chat accepts text only — no files. */
export const PUBLIC_INTERFACE_CHAT_MAX_INPUT_LENGTH = 50_000

/**
 * Byte cap for the two executing routes' JSON bodies. Both carry only short
 * text, so the platform default (50 MB) is orders of magnitude too generous for
 * an unauthenticated endpoint; this rejects an oversized body before any schema
 * work happens.
 */
export const PUBLIC_INTERFACE_MAX_BODY_BYTES = 256 * 1024

/** Every public interface data route is addressed by exactly these two path segments. */
export const publicInterfaceModuleParamsSchema = publicInterfaceTokenParamsSchema.extend({
  moduleId: z.string().min(1, 'Module ID is required').max(128, 'Module ID is too long'),
})

export type PublicInterfaceModuleParams = z.input<typeof publicInterfaceModuleParamsSchema>

/**
 * Pagination only. `filter` and `sort` are deliberately **absent** rather than
 * ignored: both compile into SQL against the table, and the table module passes
 * neither, so accepting them would add attack surface for zero product value.
 */
const publicInterfaceTableRowsQuerySchema = z.object({
  limit: z
    .preprocess(
      (value) =>
        value === null || value === undefined || value === '' ? undefined : Number(value),
      z
        .number({ error: 'Limit must be a number' })
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(PUBLIC_TABLE_PAGE_SIZE, `Limit cannot exceed ${PUBLIC_TABLE_PAGE_SIZE}`)
        .optional()
    )
    .default(PUBLIC_TABLE_PAGE_SIZE),
  offset: z
    .preprocess(
      (value) =>
        value === null || value === undefined || value === '' ? undefined : Number(value),
      z
        .number({ error: 'Offset must be a number' })
        .int('Offset must be an integer')
        .min(0, 'Offset must be 0 or greater')
        .max(PUBLIC_TABLE_MAX_ROWS, `Offset cannot exceed ${PUBLIC_TABLE_MAX_ROWS}`)
        .optional()
    )
    .default(0),
  /** Page 0 pays for the `COUNT(*)`; later pages skip it. */
  includeTotal: booleanQueryFlagSchema.default(true),
})

export type PublicInterfaceTableRowsQuery = z.input<typeof publicInterfaceTableRowsQuerySchema>

/**
 * Rows as the shared table module renders them. `executions` is always `{}` —
 * the route reads with `withExecutions: false` so per-row workflow run state
 * (run ids, statuses, costs) never reaches a public viewer.
 *
 * `hasMore` is server-authoritative rather than derived client-side, because
 * only the server knows where {@link PUBLIC_TABLE_MAX_ROWS} cuts the drain off.
 */
const publicInterfaceTableRowsResponseSchema = z.object({
  rows: z.array(tableRowSchema),
  rowCount: z.number(),
  totalCount: z.number().nullable(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
})

export type PublicInterfaceTableRowsResponse = z.output<
  typeof publicInterfaceTableRowsResponseSchema
>

export const getPublicInterfaceTableRowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/interfaces/public/[token]/modules/[moduleId]/table/rows',
  params: publicInterfaceModuleParamsSchema,
  query: publicInterfaceTableRowsQuerySchema,
  response: {
    mode: 'json',
    schema: publicInterfaceTableRowsResponseSchema,
  },
})

/** Bytes of the one file the module points at. Authorized solely by the share token. */
export const getPublicInterfaceFileContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/interfaces/public/[token]/modules/[moduleId]/file/content',
  params: publicInterfaceModuleParamsSchema,
  response: {
    mode: 'binary',
  },
})

/**
 * Bytes of an image embedded in the module's document. The share grants the
 * document; this extends that grant to the images the document actually
 * references, and to nothing else in the workspace.
 */
export const getPublicInterfaceInlineFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/interfaces/public/[token]/modules/[moduleId]/file/inline',
  params: publicInterfaceModuleParamsSchema,
  query: inlineFileRefQuerySchema,
  response: {
    mode: 'binary',
  },
})

/**
 * One public chat turn.
 *
 * The shape mirrors what the shared execution-stream client already posts, so
 * the module's chat hook needs no special payload. Everything else that hook
 * can send — `selectedOutputs`, `executionId`, `useDraftState`,
 * `workflowStateOverride`, `envVarValues` — is absent here and therefore
 * stripped: publicly, the selected outputs come from the stored module config,
 * never from the client.
 */
const publicInterfaceChatBodySchema = z.object({
  input: z.object({
    input: z
      .string()
      .min(1, 'Message cannot be empty')
      .max(
        PUBLIC_INTERFACE_CHAT_MAX_INPUT_LENGTH,
        `Message must be ${PUBLIC_INTERFACE_CHAT_MAX_INPUT_LENGTH} characters or less`
      ),
    /** Client-generated, per-mounted-module; groups turns into one conversation. */
    conversationId: z
      .string()
      .min(1, 'Conversation ID cannot be empty')
      .max(128, 'Conversation ID is too long')
      .optional(),
  }),
})

export type PublicInterfaceChatBody = z.input<typeof publicInterfaceChatBodySchema>

/** Streams `text/event-stream` execution events; errors are JSON. */
export const publicInterfaceChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/interfaces/public/[token]/modules/[moduleId]/chat',
  params: publicInterfaceModuleParamsSchema,
  body: publicInterfaceChatBodySchema,
  response: {
    mode: 'stream',
  },
})

/**
 * Submitted values, keyed by field id. Reuses the in-app body schema minus its
 * `workspaceId`: publicly the workspace is derived from the token, never sent.
 */
export const submitPublicInterfaceFormBodySchema = submitInterfaceFormBodySchema.omit({
  workspaceId: true,
})

export type SubmitPublicInterfaceFormBody = z.input<typeof submitPublicInterfaceFormBodySchema>

const submitPublicInterfaceFormResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    executionId: z.string(),
    // untyped-response: workflow execution output is user-defined
    output: z.unknown(),
  }),
})

export type SubmitPublicInterfaceFormResponse = z.output<
  typeof submitPublicInterfaceFormResponseSchema
>

/** Mirrors the in-app submit response so one client hook serves both scopes. */
export const submitPublicInterfaceFormContract = defineRouteContract({
  method: 'POST',
  path: '/api/interfaces/public/[token]/modules/[moduleId]/submit',
  params: publicInterfaceModuleParamsSchema,
  body: submitPublicInterfaceFormBodySchema,
  response: {
    mode: 'json',
    schema: submitPublicInterfaceFormResponseSchema,
  },
})
