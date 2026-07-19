import { createHash } from 'node:crypto'
import { z } from 'zod'

/** JSON Schema 2020-12 document (loose structural check). */
export const jsonSchema202012Schema = z
  .object({
    $schema: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough()

export const appOutputAllowlistEntrySchema = z.object({
  key: z.string().min(1).max(128),
  blockId: z.string().min(1),
  path: z.string().min(1),
  schema: jsonSchema202012Schema,
})

export const appActionManifestEntrySchema = z.object({
  actionId: z.string().min(1).max(128),
  workflowId: z.string().min(1),
  deploymentVersionId: z.string().min(1),
  inputSchema: jsonSchema202012Schema,
  outputAllowlist: z.array(appOutputAllowlistEntrySchema),
  executionPolicy: z.enum(['sync', 'async']),
  readOnly: z.boolean().default(false),
  /** Server recomputes; clients may send a placeholder. */
  schemaHash: z.string().min(1).optional().default(''),
})

export const appActionManifestSchema = z.array(appActionManifestEntrySchema)

export type AppActionManifestEntry = z.infer<typeof appActionManifestEntrySchema>
export type AppActionManifest = z.infer<typeof appActionManifestSchema>

export const APP_REQUEST_BODY_MAX_BYTES = 1_048_576
export const APP_RESPONSE_BODY_MAX_BYTES = 1_048_576

/**
 * Deterministic JSON for hashing. Postgres jsonb round-trips reorder object keys;
 * plain JSON.stringify then produces a different schemaHash at execute time.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalizeJson(obj[key])
  }
  return sorted
}

export function computeActionSchemaHash(
  entry: Omit<AppActionManifestEntry, 'schemaHash' | 'readOnly'> & { readOnly?: boolean }
): string {
  const canonical = stableStringify({
    actionId: entry.actionId,
    workflowId: entry.workflowId,
    deploymentVersionId: entry.deploymentVersionId,
    inputSchema: entry.inputSchema,
    outputAllowlist: entry.outputAllowlist,
    executionPolicy: entry.executionPolicy,
    readOnly: entry.readOnly ?? false,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export function withSchemaHash(
  entry: Omit<AppActionManifestEntry, 'schemaHash' | 'readOnly'> & {
    readOnly?: boolean
    schemaHash?: string
  }
): AppActionManifestEntry {
  const { schemaHash: _ignored, ...rest } = entry
  const normalized = { ...rest, readOnly: rest.readOnly ?? false }
  return { ...normalized, schemaHash: computeActionSchemaHash(normalized) }
}
