'use client'

import { requestJson } from '@/lib/api/client/request'
import { executeSelectorContract } from '@/lib/api/contracts/selectors/execute'
import { localSelectorAttachments } from '@/lib/selectors/client/local'
import { MAX_SELECTOR_OPTIONS, MAX_SELECTOR_PAGES } from '@/lib/selectors/limits'
import {
  getSelectorManifestEntry,
  type LocalSelectorKey,
  type SelectorKey,
} from '@/lib/selectors/manifest'
import type {
  SafeSelectorOption,
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

export interface LoadedSelectorOptions {
  items: SafeSelectorOption[]
  truncated: boolean
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

export async function loadAllSelectorOptions(
  input: Omit<ExecuteSelectorClientInput, 'request'> & { search?: string }
): Promise<LoadedSelectorOptions> {
  const supportsSearch = getSelectorManifestEntry(input.selectorKey).supportsSearch
  const items: SafeSelectorOption[] = []
  const seen = new Set<string>()
  let providerTruncated = false
  let cursor: string | undefined
  for (let page = 0; page < MAX_SELECTOR_PAGES; page += 1) {
    const result = await executeSelectorRequest({
      ...input,
      request: {
        kind: 'list',
        ...(supportsSearch && input.search !== undefined ? { search: input.search } : {}),
        ...(cursor ? { cursor } : {}),
      },
    })
    if (result.kind !== 'list') throw new Error('Selector returned an unexpected detail result')
    providerTruncated ||= result.truncated === true
    for (const [index, item] of result.items.entries()) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
      if (items.length >= MAX_SELECTOR_OPTIONS) {
        const omittedUniqueOption = result.items
          .slice(index + 1)
          .some((candidate) => !seen.has(candidate.id))
        return {
          items,
          truncated: providerTruncated || omittedUniqueOption || result.nextCursor !== undefined,
        }
      }
    }
    cursor = result.nextCursor
    if (!cursor) return { items, truncated: providerTruncated }
  }
  return { items, truncated: providerTruncated || cursor !== undefined }
}
