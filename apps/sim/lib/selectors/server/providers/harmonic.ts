import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type HarmonicSelectorKey = Extract<ServerSelectorKey, 'harmonic.savedSearches'>

const HARMONIC_URL = 'https://api.harmonic.ai/savedSearches'
const HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS = 500
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_PROVIDER_ROWS = 2_000
const FETCH_TIMEOUT_MS = 10_000

const harmonicSavedSearchUrnSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^urn:harmonic:saved_search:[^\s]+$/, 'Invalid Harmonic saved-search URN')
const harmonicSavedSearchNameSchema = z.string().trim().min(1).max(1_000)

/** Validates the documented fields consumed from a PERSONS saved-search row. */
const harmonicPeopleSavedSearchProviderSchema = z
  .object({
    id: z.number().int().safe(),
    entity_urn: harmonicSavedSearchUrnSchema,
    name: harmonicSavedSearchNameSchema,
    type: z.literal('PERSONS'),
  })
  .passthrough()

interface SavedSearch {
  id: string
  urn: string
  name: string
}

function normalizeSavedSearches(value: unknown): { items: SavedSearch[]; truncated: boolean } {
  if (!Array.isArray(value) || value.length > MAX_PROVIDER_ROWS) {
    throw new SelectorOptionsUnavailableError()
  }

  const byUrn = new Map<string, SavedSearch>()
  const urnById = new Map<string, string>()
  let truncated = false
  for (const item of value) {
    if (!isPlainRecord(item) || item.type !== 'PERSONS') continue
    const parsed = harmonicPeopleSavedSearchProviderSchema.safeParse(item)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()
    const option = {
      id: String(parsed.data.id),
      urn: parsed.data.entity_urn,
      name: parsed.data.name,
    }
    const existing = byUrn.get(option.urn)
    const existingUrn = urnById.get(option.id)
    if (
      (existing && (existing.id !== option.id || existing.name !== option.name)) ||
      (existingUrn && existingUrn !== option.urn)
    ) {
      throw new SelectorOptionsUnavailableError()
    }
    if (existing) continue
    if (byUrn.size >= HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS) {
      truncated = true
      break
    }
    byUrn.set(option.urn, option)
    urnById.set(option.id, option.urn)
  }
  return {
    items: [...byUrn.values()].sort(
      (left, right) => left.name.localeCompare(right.name) || left.urn.localeCompare(right.urn)
    ),
    truncated,
  }
}

async function listSavedSearches(
  args: ExecuteServerSelectorArgs
): Promise<{ items: SavedSearch[]; truncated: boolean }> {
  const { accessToken } = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal

  let response: Response
  try {
    response = await fetch(HARMONIC_URL, {
      headers: { Accept: 'application/json', apikey: accessToken },
      redirect: 'error',
      signal,
    })
  } catch (error) {
    if (args.signal?.aborted) throw error
    throw new SelectorOptionsUnavailableError()
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw selectorProviderStatusError(response.status)
  }

  try {
    const body = await readResponseJsonWithLimit(response, {
      label: 'Harmonic saved-search response',
      maxBytes: MAX_RESPONSE_BYTES,
      signal,
    })
    return normalizeSavedSearches(body)
  } catch (error) {
    if (args.signal?.aborted) throw error
    if (error instanceof SelectorOptionsUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

function toOption(search: SavedSearch) {
  return {
    id: search.urn,
    label: search.name,
    meta: { id: search.id, urn: search.urn, name: search.name },
  }
}

async function executeSavedSearches(args: ExecuteServerSelectorArgs) {
  const { items: searches, truncated } = await listSavedSearches(args)
  if (args.request.kind === 'detail') {
    const id = args.request.id.trim()
    const match = searches.find((search) => search.urn === id || search.id === id)
    return {
      ...detailSelectorResult(match ? toOption(match) : null),
      ...(truncated
        ? {
            diagnostics: {
              truncated: {
                reason: 'provider-cap' as const,
                limit: HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS,
              },
            },
          }
        : {}),
    }
  }
  return listSelectorResult(
    searches.map(toOption),
    undefined,
    truncated
      ? {
          truncated: {
            reason: 'provider-cap',
            limit: HARMONIC_SAVED_SEARCH_SELECTOR_MAX_OPTIONS,
          },
        }
      : undefined
  )
}

export const harmonicSelectorAttachments = {
  'harmonic.savedSearches': {
    credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['harmonic'] },
    destination: 'fixed',
    execute: executeSavedSearches,
  },
} satisfies ServerSelectorAttachmentMap<HarmonicSelectorKey>
