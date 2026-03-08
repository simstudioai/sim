import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'

export interface SelectorResolution {
  key: SelectorKey | null
  context: SelectorContext
  allowSearch: boolean
}

export function resolveSelectorForSubBlock(
  subBlock: SubBlockConfig,
  context: SelectorContext
): SelectorResolution | null {
  if (!subBlock.selectorKey) return null
  return {
    key: subBlock.selectorKey,
    context: {
      ...context,
      mimeType: subBlock.mimeType ?? context.mimeType,
    },
    allowSearch: subBlock.selectorAllowSearch ?? true,
  }
}
