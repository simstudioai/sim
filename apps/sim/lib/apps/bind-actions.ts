import { assertAppInputBoundary } from '@/lib/apps/app-input-boundary'
import { assertPrivateCredentialBoundary } from '@/lib/apps/credential-boundary'
import { DRAFT_DEPLOYMENT_VERSION_SENTINEL } from '@/lib/apps/draft-binding'
import { type AppActionManifestEntry, withSchemaHash } from '@/lib/apps/manifest'
import type { ApiStartField } from '@/lib/interfaces/spec/api-start-input'
import { resolveApiStartInput } from '@/lib/interfaces/spec/api-start-input'
import { workflowHasHitlBlocks } from '@/lib/interfaces/spec/validate'
import {
  type FlattenOutputsBlockInput,
  flattenWorkflowOutputs,
} from '@/lib/workflows/blocks/flatten-outputs'
import {
  loadWorkflowDeploymentVersionState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'

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

const APP_FILE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    name: { type: 'string' },
    mimeType: { type: 'string' },
    size: { type: 'number' },
  },
  required: ['url', 'name', 'mimeType', 'size'],
  additionalProperties: false,
}

function leafTypeToJsonSchema(leafType?: string): Record<string, unknown> {
  switch (leafType) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'file':
      return { ...APP_FILE_OUTPUT_SCHEMA }
    case 'file[]':
      return { type: 'array', items: { ...APP_FILE_OUTPUT_SCHEMA } }
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

async function deriveSchemasFromBlocks(params: {
  actionId: string
  workflowId: string
  deploymentVersionId: string
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
  edges: Array<{ source: string; target: string }>
  /** When omitted/empty for draft handoff, expose every safe flattened output. */
  outputAllowlist?: Array<{ key: string; blockId: string; path: string }>
  /** When true, empty allowlist means "expose nothing" (deployed bind path). */
  requireExplicitAllowlist?: boolean
  /** Enforce private OAuth binding + reject credential-like API start fields. */
  enforceCredentialBoundary?: boolean
}): Promise<
  { ok: true; action: AppActionManifestEntry } | { ok: false; error: string; code?: string }
> {
  if (workflowHasHitlBlocks(params.blocks as Record<string, { type: string }>)) {
    return {
      ok: false,
      error: 'Human-in-the-loop workflows are not supported for Full-stack Apps',
      code: 'HITL_NOT_SUPPORTED',
    }
  }

  const apiStart = resolveApiStartInput(
    params.blocks as Record<string, { type: string; subBlocks?: Record<string, unknown> }>
  )
  if (!apiStart.ok) {
    return {
      ok: false,
      error: apiStart.error || 'Workflow needs an API-compatible start block',
      code: 'NO_API_START',
    }
  }

  if (params.enforceCredentialBoundary !== false) {
    const boundary = assertPrivateCredentialBoundary({
      workflowId: params.workflowId,
      blocks: params.blocks,
      apiStartFieldNames: apiStart.data.fields.map((field) => field.name),
    })
    if (!boundary.ok) {
      return { ok: false, error: boundary.error, code: boundary.code }
    }
  }

  const inputBoundary = assertAppInputBoundary({
    startBlockId: apiStart.data.blockId,
    fieldNames: apiStart.data.fields.map((field) => field.name),
    blocks: params.blocks,
  })
  if (!inputBoundary.ok) {
    return {
      ok: false,
      error: inputBoundary.error,
      code: inputBoundary.code,
    }
  }

  const inputSchema = apiStartFieldsToJsonSchema(apiStart.data.fields)
  const flattened = flattenWorkflowOutputs(
    Object.values(toFlattenBlocks(params.blocks)),
    params.edges
  )
  const validKeys = new Set(flattened.map((o) => `${o.blockId}::${o.path}`))
  const leafByKey = new Map(flattened.map((o) => [`${o.blockId}::${o.path}`, o.leafType]))

  const outputAllowlist: AppActionManifestEntry['outputAllowlist'] = []
  const explicit = params.outputAllowlist
  if (explicit && explicit.length > 0) {
    for (const entry of explicit) {
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
  } else if (!params.requireExplicitAllowlist) {
    // Demo handoff: expose every safe flattened output with stable keys.
    const usedKeys = new Set<string>()
    for (const output of flattened) {
      let key = output.path.replace(/[^a-zA-Z0-9_]/g, '_') || 'output'
      if (/^[0-9]/.test(key)) key = `out_${key}`
      let unique = key
      let n = 2
      while (usedKeys.has(unique)) {
        unique = `${key}_${n++}`
      }
      usedKeys.add(unique)
      outputAllowlist.push({
        key: unique,
        blockId: output.blockId,
        path: output.path,
        schema: leafTypeToJsonSchema(output.leafType),
      })
    }
  }

  return {
    ok: true,
    action: withSchemaHash({
      actionId: params.actionId,
      workflowId: params.workflowId,
      deploymentVersionId: params.deploymentVersionId,
      inputSchema,
      outputAllowlist,
      executionPolicy: 'sync',
    }),
  }
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

  return deriveSchemasFromBlocks({
    actionId: request.actionId,
    workflowId: request.workflowId,
    deploymentVersionId: request.deploymentVersionId,
    blocks: deployed.blocks as Record<
      string,
      {
        id?: string
        type: string
        name?: string
        triggerMode?: boolean
        subBlocks?: Record<string, unknown>
      }
    >,
    edges: (deployed.edges || []) as Array<{ source: string; target: string }>,
    outputAllowlist: request.outputAllowlist,
    requireExplicitAllowlist: true,
    enforceCredentialBoundary: true,
  })
}

/**
 * Build a draft-bound action entry from the saved normalized workflow tables.
 * Uses the draft deployment-version sentinel (never publishable).
 */
export async function buildBoundActionEntryFromDraft(params: {
  workspaceId: string
  actionId: string
  workflowId: string
  outputAllowlist?: Array<{ key: string; blockId: string; path: string }>
}): Promise<
  { ok: true; action: AppActionManifestEntry } | { ok: false; error: string; code?: string }
> {
  if (!params.workspaceId) {
    return { ok: false, error: 'workspaceId is required', code: 'WORKSPACE_REQUIRED' }
  }

  const draft = await loadWorkflowFromNormalizedTables(params.workflowId)
  if (!draft) {
    return {
      ok: false,
      error: 'Workflow draft state not found',
      code: 'DRAFT_MISSING',
    }
  }

  return deriveSchemasFromBlocks({
    actionId: params.actionId,
    workflowId: params.workflowId,
    deploymentVersionId: DRAFT_DEPLOYMENT_VERSION_SENTINEL,
    blocks: draft.blocks as Record<
      string,
      {
        id?: string
        type: string
        name?: string
        triggerMode?: boolean
        subBlocks?: Record<string, unknown>
      }
    >,
    edges: (draft.edges || []) as Array<{ source: string; target: string }>,
    outputAllowlist: params.outputAllowlist,
    enforceCredentialBoundary: true,
  })
}
