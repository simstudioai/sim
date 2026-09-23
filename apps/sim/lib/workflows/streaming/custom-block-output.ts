import {
  formatInternalOutputSelector,
  parseInternalOutputSelector,
} from '@/lib/workflows/streaming/output-selector'
import type { CustomBlockOutput } from '@/blocks/custom/build-config'

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
