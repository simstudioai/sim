import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { generateWorkflowInputShape } from '@/lib/workflows/input-schema'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { fileWorkflowInputSchema } from '@/lib/workspace-files/workflows/types'

export const FILE_WORKFLOW_INPUT_MAX_BYTES = 16 * 1024
/** File calls accept only declared deployed inputs, including an exact empty input for zero-field workflows. */
export async function prepareFileWorkflowInput(
  workflowId: string,
  workspaceId: string,
  input: unknown
) {
  let serialized: string
  try {
    serialized = JSON.stringify(input === undefined ? {} : input)
  } catch {
    throw new OrchestrationError('validation', 'Workflow input must be a JSON object')
  }
  if (typeof serialized !== 'string')
    throw new OrchestrationError('validation', 'Workflow input must be a JSON object')
  if (Buffer.byteLength(serialized) > FILE_WORKFLOW_INPUT_MAX_BYTES)
    throw new OrchestrationError('payload_too_large', 'Workflow input exceeds 16 KB')
  const deployed = await loadDeployedWorkflowState(workflowId, workspaceId)
  const fields = extractInputFieldsFromBlocks(deployed.blocks)
  const schema = z.object(generateWorkflowInputShape(fields)).partial().strict()
  const json = fileWorkflowInputSchema.safeParse(input === undefined ? {} : input)
  if (!json.success)
    throw new OrchestrationError('validation', 'Workflow input must be a JSON object')
  const parsed = schema.safeParse(json.data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new OrchestrationError(
      'validation',
      `Workflow input ${issue?.path.join('.') || '(root)'}: ${issue?.message || 'invalid value'}`
    )
  }
  const canonical = canonicalJson(parsed.data)
  return {
    input: parsed.data,
    inputHash: createHash('sha256').update(canonical).digest('hex'),
    deploymentVersionId: deployed.deploymentVersionId,
  }
}
