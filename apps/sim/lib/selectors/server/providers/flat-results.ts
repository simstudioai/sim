import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import {
  detailSelectorResult,
  listSelectorResult,
  type SelectorServerDiagnostics,
  type ServerSelectorExecutionResult,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption, SelectorRequest } from '@/lib/selectors/types'

/** Projects a bounded provider list into the selector operation's list/detail result. */
export function flatSelectorResult(
  request: SelectorRequest,
  items: SafeSelectorOption[],
  supportsDetail = false,
  diagnostics?: SelectorServerDiagnostics
): ServerSelectorExecutionResult {
  if (request.kind === 'list') return listSelectorResult(items, undefined, diagnostics)
  if (!supportsDetail) throw new SelectorOptionsUnavailableError()
  return {
    ...detailSelectorResult(items.find((item) => item.id === request.id) ?? null),
    ...(diagnostics ? { diagnostics } : {}),
  }
}
