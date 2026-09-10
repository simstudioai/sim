import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ExecuteSelectorInput,
  executeSelector,
} from '@/lib/selectors/application/execute-selector'
import { selectorOperations } from '@/lib/selectors/application/operations'
import { getSelectorManifestEntry } from '@/lib/selectors/manifest'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type GetSelectorOptionInput = Omit<ExecuteSelectorInput, 'request'> & { id: string }

/** Resolves a choice through authorized execution, including providers with list-only APIs. */
export const getSelectorOption: OperationUseCase<
  typeof selectorOperations.execute,
  GetSelectorOptionInput,
  SafeSelectorOption | null
> = {
  operation: selectorOperations.execute,
  async execute({ input, ...args }) {
    const { id, ...base } = input
    if (getSelectorManifestEntry(input.selectorKey).supportsDetail) {
      const result = await executeSelector.execute({
        ...args,
        input: { ...base, request: { kind: 'detail', id } },
      })
      if (result.kind !== 'detail')
        throw new OrchestrationError('internal', 'Selector returned an invalid detail')
      return result.item
    }
    let cursor: string | undefined
    const visited = new Set<string>()
    let total = 0
    for (let page = 0; page < 100; page++) {
      const result = await executeSelector.execute({
        ...args,
        input: { ...base, request: { kind: 'list', cursor } },
      })
      if (result.kind !== 'list')
        throw new OrchestrationError('internal', 'Selector returned an invalid page')
      const item = result.items.find((option) => option.id === id)
      if (item) return item
      total += result.items.length
      if (!result.nextCursor) {
        if (result.truncated)
          throw new OrchestrationError(
            'payload_too_large',
            'Selector results are truncated; this choice could not be verified'
          )
        return null
      }
      if (total >= 10_000 || visited.has(result.nextCursor)) break
      cursor = result.nextCursor
      visited.add(cursor)
    }
    throw new OrchestrationError(
      'payload_too_large',
      'Selector verification exceeded its pagination limit'
    )
  },
}
