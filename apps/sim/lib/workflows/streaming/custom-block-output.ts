import { isRecordLike } from '@sim/utils/object'
import {
  formatInternalOutputSelector,
  parseInternalOutputSelector,
} from '@/lib/workflows/streaming/output-selector'
import type { CustomBlockOutput } from '@/blocks/custom/build-config'

interface StreamSourceBlock {
  type: string
  subBlocks?: Record<string, unknown>
}

/** Public streams currently expose only unstructured Agent/Pi answer text. */
export function isCustomBlockStreamSource(
  block: StreamSourceBlock | undefined,
  path: string
): boolean {
  if (!block || !['agent', 'pi'].includes(block.type) || path !== 'content') return false
  const subBlock = block.subBlocks?.responseFormat
  const responseFormat = isRecordLike(subBlock) ? subBlock.value : subBlock
  return responseFormat == null || responseFormat === ''
}

/** Validate against the deployment being published or executed, never the caller's graph. */
export function assertCustomBlockStreamingOutputs(
  outputs: readonly CustomBlockOutput[],
  blocks: Readonly<Record<string, StreamSourceBlock>>
): void {
  const sources = new Set<string>()
  for (const output of outputs) {
    if (!output.streaming) continue
    if (outputs.filter((candidate) => candidate.name === output.name).length !== 1) {
      throw new Error('Each streaming output must have a unique public name')
    }
    if (
      !output.name ||
      output.name.includes('.') ||
      output.name.includes('/') ||
      output.name.trim() !== output.name
    ) {
      throw new Error('A streaming output name must be a single output field')
    }
    if (!isCustomBlockStreamSource(blocks[output.blockId], output.path)) {
      throw new Error(
        `Streaming output "${output.name}" must reference an Agent or Pi content output without a response format`
      )
    }
    if (sources.has(output.blockId)) {
      throw new Error('Each streaming source can be exposed only once')
    }
    sources.add(output.blockId)
  }
}

/** Translate selected public fields into private child selectors without exposing child IDs. */
export function selectCustomBlockStreamingOutputs(
  blockId: string,
  outputs: readonly CustomBlockOutput[],
  selectedOutputs: readonly string[] = []
): { selectedOutputs: string[]; outputsByBlockId: ReadonlyMap<string, CustomBlockOutput> } {
  const selectedPaths = new Set(
    selectedOutputs
      .map(parseInternalOutputSelector)
      .filter((selector) => !selector.workflowId && selector.blockId === blockId)
      .map((selector) => selector.path)
  )
  const selected = outputs.filter((output) => output.streaming && selectedPaths.has(output.name))
  return {
    selectedOutputs: selected.map((output) =>
      formatInternalOutputSelector(output.blockId, output.path)
    ),
    outputsByBlockId: new Map(selected.map((output) => [output.blockId, output])),
  }
}
