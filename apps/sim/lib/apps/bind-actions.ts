import { type AppActionManifestEntry, withSchemaHash } from '@/lib/apps/manifest'
import type { ApiStartField } from '@/lib/interfaces/spec/api-start-input'
import { resolveApiStartInput } from '@/lib/interfaces/spec/api-start-input'
import { workflowHasHitlBlocks } from '@/lib/interfaces/spec/validate'
import {
  type FlattenOutputsBlockInput,
  flattenWorkflowOutputs,
} from '@/lib/workflows/blocks/flatten-outputs'
import { loadWorkflowDeploymentVersionState } from '@/lib/workflows/persistence/utils'

export type BindActionRequest = {
  actionId: string
  workflowId: string
  deploymentVersionId: string
  outputAllowlist: Array<{ key: string; blockId: string; path: string }>
  executionPolicy: 'sync'
}

function mapFieldTypeToJsonSchemaType(type: string): string {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

/** Derive JSON Schema 2020-12 from the pinned deployment's API start fields. */
export function apiStartFieldsToJsonSchema(fields: ApiStartField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const field of fields) {
    properties[field.name] = {
      type: mapFieldTypeToJsonSchemaType(field.type),
      ...(field.description ? { description: field.description } : {}),
    }
    if (field.required) required.push(field.name)
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function leafTypeToJsonSchema(leafType?: string): Record<string, unknown> {
  switch (leafType) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    default:
      // Accept any JSON value when the block output type is opaque.
      return {}
  }
}

function toFlattenBlocks(
  blocks: Record<
    string,
    {
      id?: string
      type: string
      name?: string
      triggerMode?: boolean
      subBlocks?: Record<string, unknown>
    }
  >
): Record<string, FlattenOutputsBlockInput> {
  const out: Record<string, FlattenOutputsBlockInput> = {}
  for (const [key, block] of Object.entries(blocks)) {
    out[key] = {
      id: block.id ?? key,
      type: block.type,
      name: block.name,
      triggerMode: block.triggerMode,
      subBlocks: block.subBlocks,
    }
  }
  return out
}

/**
 * Load the pinned deployment snapshot and build a server-authored action entry.
 * Client-supplied inputSchema is never trusted.
 */
export async function buildBoundActionEntry(params: {
  workspaceId: string
  request: BindActionRequest
}): Promise<
  { ok: true; action: AppActionManifestEntry } | { ok: false; error: string; code?: string }
> {
  const { request, workspaceId } = params

  if (request.executionPolicy !== 'sync') {
    return {
      ok: false,
      error: 'Only sync executionPolicy is supported',
      code: 'ASYNC_NOT_SUPPORTED',
    }
  }

  let deployed: Awaited<ReturnType<typeof loadWorkflowDeploymentVersionState>>
  try {
    deployed = await loadWorkflowDeploymentVersionState(
      request.workflowId,
      request.deploymentVersionId,
      workspaceId
    )
  } catch {
    return {
      ok: false,
      error: 'The workflow version this release was bound to no longer exists; rebind and rebuild.',
      code: 'DEPLOYMENT_VERSION_MISSING',
    }
  }

  if (workflowHasHitlBlocks(deployed.blocks as Record<string, { type: string }>)) {
    return {
      ok: false,
      error: 'Human-in-the-loop workflows are not supported for Full-stack Apps',
      code: 'HITL_NOT_SUPPORTED',
    }
  }

  const apiStart = resolveApiStartInput(
    deployed.blocks as Record<string, { type: string; subBlocks?: Record<string, unknown> }>
  )
  if (!apiStart.ok) {
    return {
      ok: false,
      error: apiStart.error || 'Workflow needs an API-compatible start block',
      code: 'NO_API_START',
    }
  }

  const inputSchema = apiStartFieldsToJsonSchema(apiStart.data.fields)
  const flattened = flattenWorkflowOutputs(
    Object.values(
      toFlattenBlocks(
        deployed.blocks as Record<
          string,
          {
            id?: string
            type: string
            name?: string
            triggerMode?: boolean
            subBlocks?: Record<string, unknown>
          }
        >
      )
    ),
    (deployed.edges || []) as Array<{ source: string; target: string }>
  )
  const validKeys = new Set(flattened.map((o) => `${o.blockId}::${o.path}`))
  const leafByKey = new Map(flattened.map((o) => [`${o.blockId}::${o.path}`, o.leafType]))

  const outputAllowlist = []
  for (const entry of request.outputAllowlist) {
    const key = `${entry.blockId}::${entry.path}`
    if (!validKeys.has(key)) {
      return {
        ok: false,
        error: `Unknown output ${entry.blockId}.${entry.path}`,
        code: 'INVALID_OUTPUT_ALLOWLIST',
      }
    }
    outputAllowlist.push({
      key: entry.key,
      blockId: entry.blockId,
      path: entry.path,
      schema: leafTypeToJsonSchema(leafByKey.get(key)),
    })
  }

  return {
    ok: true,
    action: withSchemaHash({
      actionId: request.actionId,
      workflowId: request.workflowId,
      deploymentVersionId: request.deploymentVersionId,
      inputSchema,
      outputAllowlist,
      executionPolicy: 'sync',
    }),
  }
}
