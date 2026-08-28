import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import { detailSelectorResult, listSelectorResult } from '@/lib/selectors/server/types'
import type {
  SafeSelectorOption,
  SelectorExecutionResult,
  SelectorRequest,
} from '@/lib/selectors/types'

/** Projects a bounded provider list into the selector operation's list/detail result. */
export function flatSelectorResult(
  request: SelectorRequest,
  items: SafeSelectorOption[],
  supportsDetail = false
): SelectorExecutionResult {
  if (request.kind === 'list') return listSelectorResult(items)
  if (!supportsDetail) throw new SelectorOptionsUnavailableError()
  return detailSelectorResult(items.find((item) => item.id === request.id) ?? null)
}
