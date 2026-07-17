import {
  getLegacyStarterMode,
  StartBlockPath,
  TriggerUtils,
} from '@/lib/workflows/triggers/triggers'
import type { InputFormatField } from '@/lib/workflows/types'

export interface ApiStartField {
  name: string
  type: string
  description?: string
  required: boolean
}

export interface ApiStartInputResult {
  blockId: string
  path: StartBlockPath
  fields: ApiStartField[]
  /** Full fields including defaults — server-only, never send `.value` to the LLM */
  rawFields: InputFormatField[]
}

type BlockLike = {
  type: string
  subBlocks?: Record<string, unknown>
}

function readInputFormat(block: BlockLike): InputFormatField[] {
  const sub = block.subBlocks?.inputFormat
  if (!sub || typeof sub !== 'object') return []

  const value = (sub as { value?: unknown }).value ?? sub
  if (!Array.isArray(value)) return []

  return value.filter(
    (field): field is InputFormatField =>
      !!field && typeof field === 'object' && typeof (field as InputFormatField).name === 'string'
  )
}

function isFieldRequired(field: InputFormatField): boolean {
  return field.value === undefined || field.value === null
}

/**
 * Resolve the API-compatible start block and its inputFormat from a block map
 * (draft or deployed). Rejects missing starts and legacy starters not in API mode.
 */
export function resolveApiStartInput(
  blocks: Record<string, BlockLike>
): { ok: true; data: ApiStartInputResult } | { ok: false; error: string } {
  const candidate = TriggerUtils.findStartBlock(blocks, 'api')
  if (!candidate) {
    return {
      ok: false,
      error: 'Workflow needs an API-compatible start block to deploy an interface',
    }
  }

  if (candidate.path === StartBlockPath.LEGACY_STARTER) {
    const mode = getLegacyStarterMode(candidate.block)
    if (mode !== 'api') {
      return {
        ok: false,
        error: 'Workflow needs an API-compatible start block to deploy an interface',
      }
    }
  }

  const rawFields = readInputFormat(candidate.block)
  const fields: ApiStartField[] = []

  for (const field of rawFields) {
    const name = field.name?.trim()
    if (!name) continue

    const type = field.type || 'string'
    if (type === 'file[]' || type === 'object' || type === 'array') {
      return {
        ok: false,
        error: `Interface v1 does not support input type "${type}" (${name})`,
      }
    }

    fields.push({
      name,
      type,
      description: typeof field.description === 'string' ? field.description : undefined,
      required: isFieldRequired(field),
    })
  }

  return {
    ok: true,
    data: {
      blockId: candidate.blockId,
      path: candidate.path,
      fields,
      rawFields,
    },
  }
}

/** LLM-safe projection: names, types, descriptions, required — never default values. */
export function toLlmInputSchema(fields: ApiStartField[]): Array<{
  name: string
  type: string
  description?: string
  required: boolean
}> {
  return fields.map(({ name, type, description, required }) => ({
    name,
    type,
    ...(description ? { description } : {}),
    required,
  }))
}
