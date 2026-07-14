import type { SubBlockType } from '@sim/workflow-types/blocks'
import type { WorkflowInputField } from '@/lib/workflows/input-format'
import type { BlockConfig, BlockIcon, SubBlockConfig } from '@/blocks/types'

/**
 * The block-type prefix that identifies a custom (deploy-as-block) block. Shared
 * by the registry overlay, the executor handler dispatch, and access control.
 */
export const CUSTOM_BLOCK_TYPE_PREFIX = 'custom_block_'

/** Whether a block type is a published custom block. */
export function isCustomBlockType(type: string | undefined | null): type is string {
  return typeof type === 'string' && type.startsWith(CUSTOM_BLOCK_TYPE_PREFIX)
}

/** Tile background for custom-block icons (the uploaded image renders on top). */
export const CUSTOM_BLOCK_TILE_COLOR = '#6F6F6F'

/** A curated output exposed on the block, mapped from a child block output. */
export interface CustomBlockOutput {
  blockId: string
  path: string
  name: string
}

/**
 * A curated input the admin chose to expose on the block, keyed by the source
 * Start field's stable `id`, with optional consumer-facing hints.
 */
export interface CustomBlockInput {
  id: string
  name: string
  type: string
  placeholder?: string
  description?: string
  required?: boolean
}

/**
 * The DB-backed identity + presentation of a custom block. `workflowId` is the
 * bound source workflow whose LATEST deployment this block always executes.
 */
export interface CustomBlockRow {
  type: string
  name: string
  description: string
  workflowId: string
  /** Curated exposed outputs; empty/absent exposes the child's whole `result`. */
  exposedOutputs?: CustomBlockOutput[]
}

/**
 * Params that carry the block's own wiring rather than a mapped Start input.
 * Everything else on the block is collected into the child `inputMapping`. Shared
 * with the serializer so "does this custom block declare input sub-blocks?" reads
 * from one source instead of re-listing the structural ids.
 */
export const RESERVED_PARAMS = new Set([
  'workflowId',
  'inputMapping',
  'triggerMode',
  'advancedMode',
])

/**
 * Output names the block projects itself (`success`/`error`/`result` from
 * `buildOutputs`, `cost` from the executor's billing aggregation). A user-named
 * exposed output must never shadow these — an output literally named `cost`
 * would clobber the billed cost.
 */
export const RESERVED_OUTPUT_NAMES = new Set(['success', 'error', 'result', 'cost'])

/** Whether an exposed-output name collides with a system output field. */
export function isReservedOutputName(name: string): boolean {
  return RESERVED_OUTPUT_NAMES.has(name.trim().toLowerCase())
}

/** Map a Start input field type to the editor sub-block type used to collect it. */
function subBlockTypeForField(fieldType: string): SubBlockType {
  switch (fieldType) {
    case 'boolean':
      return 'switch'
    case 'object':
    case 'array':
      return 'code'
    case 'file[]':
      return 'file-upload'
    default:
      return 'short-input'
  }
}

/**
 * Synthesize a `BlockConfig` for a published custom block from its DB row and the
 * live-derived Start input fields. Shared by the client (real icon + per-field
 * editors) and the server (placeholder icon + `inputFields: []`, since the
 * `inputMapping` wiring is schema-agnostic).
 *
 * Execution reuses the `workflow_executor` tool: the bound `workflowId` and the
 * assembled `inputMapping` are hidden, baked sub-blocks; each Start input becomes
 * its own editable sub-block whose value is collected into `inputMapping`.
 * `<refs>` inside those values resolve at execution exactly like the
 * `workflow_input` block.
 *
 * The sub-block id is the field's stable id (`field.id`), NOT its display name, so
 * renaming a Start input in the source workflow and redeploying never orphans a
 * consumer's placed value. The name is shown as the sub-block title and is what
 * the child workflow ultimately receives — the id→name remap happens at execution
 * in `WorkflowBlockHandler` against the loaded child's current field names. Legacy
 * fields without an id fall back to keying on the name.
 */
export function buildCustomBlockConfig(
  row: CustomBlockRow,
  inputFields: WorkflowInputField[],
  opts: { icon: BlockIcon; bgColor?: string; hideFromToolbar?: boolean }
): BlockConfig {
  const fieldSubBlocks: SubBlockConfig[] = inputFields.map((field) => {
    const type = subBlockTypeForField(field.type)
    const sub: SubBlockConfig = {
      id: field.id ?? field.name,
      title: field.name,
      type,
      description: field.description,
      placeholder: field.placeholder,
      // Serializer Loop-B (required subBlocks not covered by tool params) and the
      // editor asterisk both read this — same enforcement path as regular blocks.
      required: field.required === true,
    }
    if (field.type === 'object' || field.type === 'array') sub.language = 'json'
    if (field.type === 'file[]') sub.multiple = true
    return sub
  })

  return {
    type: row.type,
    name: row.name,
    description: row.description,
    sourceWorkflowId: row.workflowId,
    category: 'tools',
    longDescription:
      'A published workflow packaged as a reusable, self-contained block. Fill its input ' +
      'fields; it runs the underlying workflow and returns the outputs below. The bound ' +
      'workflow is baked in — no workflow id or input mapping to configure.',
    bgColor: opts.bgColor ?? CUSTOM_BLOCK_TILE_COLOR,
    icon: opts.icon,
    // A disabled block stays resolvable (so a still-placed instance survives
    // serialization and fails loudly at run via `getCustomBlockAuthority`, instead
    // of silently vanishing from the graph) but is hidden from the palette so no
    // new instance can be placed.
    hideFromToolbar: opts.hideFromToolbar,
    subBlocks: [
      {
        id: 'workflowId',
        type: 'short-input',
        hidden: true,
        value: () => row.workflowId,
      },
      {
        id: 'inputMapping',
        type: 'code',
        language: 'json',
        hidden: true,
        value: (params) => {
          const mapping: Record<string, unknown> = {}
          for (const [key, val] of Object.entries(params)) {
            if (RESERVED_PARAMS.has(key)) continue
            if (val === undefined || val === '') continue
            mapping[key] = val
          }
          return JSON.stringify(mapping)
        },
      },
      ...fieldSubBlocks,
    ],
    tools: {
      access: ['workflow_executor'],
      config: {
        tool: () => 'workflow_executor',
        params: (params) => ({
          workflowId: params.workflowId,
          inputMapping: params.inputMapping,
        }),
      },
    },
    inputs: {
      workflowId: { type: 'string', description: 'Bound source workflow id' },
      inputMapping: { type: 'json', description: 'Mapping of input fields to values' },
    },
    outputs: buildOutputs(row.exposedOutputs),
  }
}

/**
 * The block's declared outputs. Internal plumbing (child workflow id/name, trace
 * spans) is never exposed. With curated `exposedOutputs`, each becomes its own
 * named output; otherwise the whole child `result` is exposed.
 */
function buildOutputs(exposed: CustomBlockOutput[] | undefined): BlockConfig['outputs'] {
  const outputs: BlockConfig['outputs'] = {
    success: { type: 'boolean', description: 'Execution success status' },
    error: { type: 'string', description: 'Error message' },
  }
  if (exposed && exposed.length > 0) {
    for (const out of exposed) {
      outputs[out.name] = { type: 'json', description: `Output: ${out.path}` }
    }
  } else {
    outputs.result = { type: 'json', description: 'Workflow execution result' }
  }
  return outputs
}
