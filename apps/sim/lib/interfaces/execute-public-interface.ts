import { generateId } from '@sim/utils/id'
import { executeDeployedAction } from '@/lib/apps/execute-deployed-action'
import {
  buildExecutePayload,
  buildInterfaceExecuteResponse,
  type InterfaceSpec,
  type OutputConfig,
  toPublicSafeError,
  toPublicSafeInputError,
  validateInterfaceSpec,
  workflowHasHitlBlocks,
} from '@/lib/interfaces'
import type { FlattenOutputsBlockInput } from '@/lib/workflows/blocks/flatten-outputs'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'

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
 * Interface public execute adapter: active-following gate + drift revalidation,
 * then shared executeDeployedAction with the same preloaded snapshot (no TOCTOU).
 */
export async function executePublicInterfaceAction(params: {
  workflowId: string
  userId: string
  workspaceId: string
  spec: InterfaceSpec
  outputConfigs: OutputConfig[]
  actionId: string
  values: Record<string, unknown>
  requestId: string
  abortSignal?: AbortSignal
}): Promise<
  | { success: true; status: number; body: ReturnType<typeof buildInterfaceExecuteResponse> }
  | { success: false; status: number; message: string }
> {
  let deployed: Awaited<ReturnType<typeof loadDeployedWorkflowState>>
  try {
    deployed = await loadDeployedWorkflowState(params.workflowId, params.workspaceId)
  } catch {
    return { success: false, status: 409, message: 'Interface needs republishing' }
  }

  if (workflowHasHitlBlocks(deployed.blocks as Record<string, { type: string }>)) {
    return {
      success: false,
      status: 400,
      message: toPublicSafeError('Human-in-the-loop workflows are not supported for interfaces'),
    }
  }

  const apiStart = (await import('@/lib/interfaces/spec/api-start-input')).resolveApiStartInput(
    deployed.blocks as Record<string, { type: string; subBlocks?: Record<string, unknown> }>
  )
  if (!apiStart.ok) {
    return { success: false, status: 409, message: 'Interface needs republishing' }
  }

  const revalidation = validateInterfaceSpec(params.spec, apiStart.data.fields, {
    outputConfigs: params.outputConfigs,
    blocks: toFlattenBlocks(
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
    ),
    edges: deployed.edges as Array<{ source: string; target: string }>,
  })
  if (!revalidation.success || !revalidation.spec) {
    return { success: false, status: 409, message: 'Interface needs republishing' }
  }

  const payloadResult = buildExecutePayload(revalidation.spec, params.actionId, params.values || {})
  if (!payloadResult.success || !payloadResult.payload) {
    return {
      success: false,
      status: 400,
      message: toPublicSafeInputError(payloadResult.error || 'Invalid input'),
    }
  }

  const namedOutputs = params.outputConfigs.map((c) => ({
    key: `${c.blockId}:${c.path}`,
    blockId: c.blockId,
    path: c.path,
  }))

  const result = await executeDeployedAction({
    workflowId: params.workflowId,
    userId: params.userId,
    workspaceId: params.workspaceId,
    deploymentGate: 'active',
    preloadedDeployedState: deployed,
    input: payloadResult.payload,
    outputConfigs: namedOutputs,
    executionPolicy: 'sync',
    triggerIdentity: 'interface',
    requestId: params.requestId,
    executionId: generateId(),
    abortSignal: params.abortSignal,
  })

  if (!result.success) {
    if (result.needsRepublishing) {
      return { success: false, status: 409, message: 'Interface needs republishing' }
    }
    return {
      success: false,
      status: result.statusCode,
      message: toPublicSafeError(result.message, 'Too many requests'),
    }
  }

  const raw = result.rawResult as {
    success?: boolean
    error?: string
    output?: unknown
    logs?: Array<{ blockId?: string; output?: unknown }>
  }

  const blockOutputs: Record<string, unknown> = {}
  for (const log of raw.logs || []) {
    if (log.blockId && log.output !== undefined) {
      blockOutputs[log.blockId] = log.output
    }
  }

  return {
    success: true,
    status: 200,
    body: buildInterfaceExecuteResponse({
      success: raw.success !== false,
      error: raw.error ? 'Workflow execution failed' : undefined,
      resultOutput: raw.output,
      blockOutputs,
      outputConfigs: params.outputConfigs,
    }),
  }
}
