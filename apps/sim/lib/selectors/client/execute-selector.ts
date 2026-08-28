'use client'

import { requestJson } from '@/lib/api/client/request'
import { executeSelectorContract } from '@/lib/api/contracts/selectors/execute'
import { localSelectorAttachments } from '@/lib/selectors/client/local'
import {
  getSelectorManifestEntry,
  type LocalSelectorKey,
  type SelectorKey,
} from '@/lib/selectors/manifest'
import type {
  SelectorContext,
  SelectorExecutionResult,
  SelectorRequest,
  SelectorScope,
} from '@/lib/selectors/types'

export interface ExecuteSelectorClientInput {
  selectorKey: SelectorKey
  scope?: SelectorScope
  context: SelectorContext
  request: SelectorRequest
  signal?: AbortSignal
}

export async function executeSelectorRequest(
  input: ExecuteSelectorClientInput
): Promise<SelectorExecutionResult> {
  const manifest = getSelectorManifestEntry(input.selectorKey)
  if (manifest.classification === 'local') {
    if (input.request.kind !== 'list') return { kind: 'detail', item: null }
    return localSelectorAttachments[input.selectorKey as LocalSelectorKey]()
  }
  if (!input.scope) throw new Error('Selector scope is required')
  return requestJson(executeSelectorContract, {
    body: {
      selectorKey: input.selectorKey,
      scope: input.scope,
      context: input.context,
      request: input.request,
    },
    signal: input.signal,
  })
}

const MAX_LOAD_ALL_PAGES = 50

export async function loadAllSelectorOptions(
  input: Omit<ExecuteSelectorClientInput, 'request'> & { search?: string }
) {
  const supportsSearch = getSelectorManifestEntry(input.selectorKey).supportsSearch
  const items: Array<{
    id: string
    label: string
    meta?: Record<string, string | number | boolean | null>
  }> = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_LOAD_ALL_PAGES; page += 1) {
    const result = await executeSelectorRequest({
      ...input,
      request: {
        kind: 'list',
        ...(supportsSearch && input.search !== undefined ? { search: input.search } : {}),
        ...(cursor ? { cursor } : {}),
      },
    })
    if (result.kind !== 'list') throw new Error('Selector returned an unexpected detail result')
    items.push(...result.items)
    cursor = result.nextCursor
    if (!cursor) break
  }
  return items
}
