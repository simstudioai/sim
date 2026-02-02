import { filterHiddenOutputKeys } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getBlock } from '@/blocks'
import { isHiddenFromDisplay } from '@/blocks/types'
import { isTriggerBehavior, isTriggerInternalKey } from '@/executor/constants'
import type { NormalizedBlockOutput } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

/**
 * Filters block output for logging/display purposes.
 * Removes internal fields and fields marked with hiddenFromDisplay.
 * Also recursively filters globally hidden keys from nested objects.
 *
 * @param blockType - The block type string (e.g., 'human_in_the_loop', 'workflow')
 * @param output - The raw block output to filter
 * @param options - Optional configuration
 * @param options.block - Full SerializedBlock for trigger behavior detection
 * @param options.additionalHiddenKeys - Extra keys to filter out (e.g., 'resume')
 */
export function filterOutputForLog(
  blockType: string,
  output: NormalizedBlockOutput,
  options?: {
    block?: SerializedBlock
    additionalHiddenKeys?: string[]
  }
): NormalizedBlockOutput {
  const blockConfig = blockType ? getBlock(blockType) : undefined
  const filtered: NormalizedBlockOutput = {}
  const additionalHiddenKeys = options?.additionalHiddenKeys ?? []

  for (const [key, value] of Object.entries(output)) {
    // Skip internal keys (underscore prefix)
    if (key.startsWith('_')) continue

    if (blockConfig?.outputs && isHiddenFromDisplay(blockConfig.outputs[key])) {
      continue
    }

    // Skip runtime-injected trigger keys not in block config
    if (options?.block && isTriggerBehavior(options.block) && isTriggerInternalKey(key)) {
      continue
    }

    // Skip additional hidden keys specified by caller
    if (additionalHiddenKeys.includes(key)) {
      continue
    }

    // Recursively filter globally hidden keys from nested objects
    filtered[key] = filterHiddenOutputKeys(value)
  }

  return filtered
}
