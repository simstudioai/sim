import { z } from 'zod'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'
import type { FigmaFileParams } from '@/tools/figma/types'
import type { ToolResponseContext } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

const FIGMA_API_ORIGIN = 'https://api.figma.com'
const MAX_NODE_IDS = 1000
const MAX_NODE_IDS_CHARACTERS = 64 * 1024

/** Extracts a resource key without navigating to or fetching a user-provided URL. */
export function figmaFileKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('fileKey is required')
  const input = value.trim()
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input)
    if (
      url.protocol !== 'https:' ||
      !['figma.com', 'www.figma.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error('Enter a Figma file URL or file key')
    const match = url.pathname.match(
      /^\/(?:file|design|proto|board|slides|buzz|sites|make)\/([^/]+)(?:\/|$)/
    )
    if (!match?.[1]) throw new Error('The Figma URL does not contain a file key')
    const key = decodeURIComponent(match[1])
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('The Figma URL contains an invalid file key')
    return key
  }
  safeUrlPathSegment(input, 'fileKey')
  if (!/^[a-zA-Z0-9_-]+$/.test(input)) throw new Error('Enter a Figma file URL or file key')
  return input
}

export function figmaNodeIds(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('nodeIds must be a comma-separated list of node IDs')
  if (value.length > MAX_NODE_IDS_CHARACTERS)
    throw new Error('nodeIds exceeds the Sim limit of 64 Ki characters')
  const entries = value.split(',', MAX_NODE_IDS + 1)
  if (entries.length > MAX_NODE_IDS)
    throw new Error('nodeIds exceeds the Sim limit of 1000 node IDs per request')
  const ids = entries.map((id) => id.trim().replace(/^(\d+)-(\d+)$/, '$1:$2'))
  if (ids.some((id) => !id)) throw new Error('nodeIds must contain nonempty node IDs')
  return ids.join(',')
}

export function figmaOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error(`${label} must be a boolean`)
}

export function figmaOptionalNumber(
  value: unknown,
  label: string,
  options: { min: number; max?: number; integer?: boolean }
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new Error(`${label} must be a number`)
  const result = Number(value)
  if (
    !Number.isFinite(result) ||
    result < options.min ||
    (options.max !== undefined && result > options.max) ||
    (options.integer && !Number.isSafeInteger(result))
  )
    throw new Error(`${label} is outside its supported range`)
  return result
}

export function figmaVersionCursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('Version IDs must be supplied as strings')
  const result = value.trim()
  if (!/^\d+$/.test(result))
    throw new Error('Version cursor must be a numeric version ID supplied as a string')
  return result
}

export function figmaOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value.trim() || undefined
}

export function figmaFilePath(params: FigmaFileParams): string {
  return `/v1/files/${safeUrlPathSegment(figmaFileKey(params.fileKey), 'fileKey')}`
}

export function figmaApiUrl(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
): string {
  const url = new URL(path, FIGMA_API_ORIGIN)
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) url.searchParams.set(key, String(value))
  return url.toString()
}

export function figmaHeaders(params: FigmaFileParams): Record<string, string> {
  return { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' }
}

/** Reads provider JSON within the executor's existing inline response budget. */
export async function figmaJson(
  response: Response,
  context?: ToolResponseContext
): Promise<unknown> {
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
    label: 'Figma response',
    signal: context?.signal,
  })
  const data: unknown = JSON.parse(text)
  const error = z
    .object({
      err: z.string().nullish(),
      error: z.union([z.boolean(), z.string()]).optional(),
      status: z.number().optional(),
      message: z.string().optional(),
    })
    .safeParse(data)
  if (
    !response.ok ||
    (error.success &&
      (error.data.err ||
        error.data.error ||
        (error.data.status !== undefined && error.data.status >= 400)))
  )
    throw new Error(
      error.success
        ? error.data.err ||
            error.data.message ||
            (typeof error.data.error === 'string'
              ? error.data.error
              : `Figma request failed (${error.data.status ?? response.status})`)
        : `Figma request failed (${response.status})`
    )
  return data
}

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null)
const figmaUserSchema = z.object({ id: z.string(), handle: z.string(), img_url: z.string() })
const vectorSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const frameOffsetSchema = z
  .object({ node_id: z.string().min(1), node_offset: vectorSchema })
  .strict()
const regionShape = {
  region_height: z.number().positive(),
  region_width: z.number().positive(),
  comment_pin_corner: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
}
export const figmaCommentPositionSchema = z.union([
  vectorSchema.extend(regionShape),
  frameOffsetSchema.extend(regionShape),
  vectorSchema,
  frameOffsetSchema,
])
const commentPositionKeys = new Set([
  'x',
  'y',
  'node_id',
  'node_offset',
  'region_height',
  'region_width',
  'comment_pin_corner',
])
const figmaCommentPositionResponseSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => commentPositionKeys.has(key)))
}, figmaCommentPositionSchema)
export const figmaCommentSchema = z.object({
  id: z.string(),
  client_meta: figmaCommentPositionResponseSchema.nullish().transform((value) => value ?? null),
  file_key: z.string(),
  parent_id: nullableString,
  user: figmaUserSchema,
  created_at: z.string(),
  resolved_at: nullableString,
  message: z.string(),
  order_id: nullableString,
  reactions: z
    .array(z.object({ user: figmaUserSchema, emoji: z.string(), created_at: z.string() }))
    .nullish()
    .transform((value) => value ?? []),
})
export const figmaVersionSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  label: nullableString,
  description: nullableString,
  user: figmaUserSchema,
  thumbnail_url: nullableString,
})
export const figmaPaginationSchema = z.object({
  prev_page: nullableString,
  next_page: nullableString,
})
const publishedShape = {
  key: z.string(),
  file_key: z.string(),
  node_id: z.string(),
  name: z.string(),
  description: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  user: figmaUserSchema,
  thumbnail_url: nullableString,
}
export const figmaPublishedComponentSchema = z.object({
  ...publishedShape,
  containing_frame: z
    .object({
      nodeId: nullableString,
      name: nullableString,
      backgroundColor: nullableString,
      pageId: z.string(),
      pageName: z.string(),
      containingComponentSet: z
        .object({ nodeId: nullableString, name: nullableString })
        .nullish()
        .transform((value) => value ?? null),
    })
    .nullish()
    .transform((value) => value ?? null),
})
export const figmaPublishedStyleSchema = z.object({
  ...publishedShape,
  style_type: z.enum(['FILL', 'TEXT', 'EFFECT', 'GRID']),
  sort_position: z.string(),
})
export const figmaFileMetadataSchema = z.object({
  name: z.string(),
  folder_name: nullableString,
  last_touched_at: z.string(),
  creator: figmaUserSchema,
  last_touched_by: figmaUserSchema.nullish().transform((value) => value ?? null),
  thumbnail_url: nullableString,
  editorType: z.string(),
  version: nullableString,
  role: nullableString,
  link_access: nullableString,
  url: nullableString,
})
const componentShape = {
  key: z.string(),
  name: z.string(),
  description: z.string(),
  documentationLinks: z
    .array(z.object({ uri: z.string() }))
    .nullish()
    .transform((value) => value ?? []),
  remote: z
    .boolean()
    .nullish()
    .transform((value) => value ?? null),
}
const componentSchema = z.object({ ...componentShape, componentSetId: nullableString })
const componentSetSchema = z.object(componentShape)
const styleSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  remote: z.boolean(),
  styleType: z.string(),
})
const nodeSchema = z.object({ id: z.string(), name: z.string(), type: z.string() }).passthrough()
const nodeDataShape = {
  document: nodeSchema,
  components: z.record(z.string(), componentSchema),
  componentSets: z.record(z.string(), componentSetSchema),
  schemaVersion: z.number(),
  styles: z.record(z.string(), styleSchema),
}
const fileInfoShape = {
  name: z.string(),
  role: z.string(),
  lastModified: z.string(),
  editorType: z.string(),
  thumbnailUrl: nullableString,
  version: z.string(),
}
export const figmaFileSchema = z.object({
  ...fileInfoShape,
  ...nodeDataShape,
  linkAccess: nullableString,
  mainFileKey: nullableString,
  branches: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        thumbnail_url: nullableString,
        last_modified: z.string(),
        link_access: nullableString,
      })
    )
    .nullish()
    .transform((value) => value ?? []),
})
export const figmaFileNodesSchema = z.object({
  ...fileInfoShape,
  nodes: z.record(z.string(), z.object(nodeDataShape).nullable()),
})
