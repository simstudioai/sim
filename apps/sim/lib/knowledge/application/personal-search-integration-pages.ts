import type { Principal } from '@sim/auth/principal'
import {
  type ListPersonalSearchIntegrationsInput,
  listPersonalSearchIntegrations,
} from '@/lib/knowledge/application/personal-search-integrations'

/** One page of the viewer's personal Search integrations. */
export type PersonalSearchIntegrationsPage = Awaited<
  ReturnType<typeof listPersonalSearchIntegrations.execute>
>

/** The most pages one walk of the personal inventory reads before it stops. */
const MAX_PERSONAL_SEARCH_INTEGRATION_PAGES = 100

/**
 * Every page of the viewer's personal Search integrations, in order: Live Search answers in one
 * page, indexed search in one per batch of sources. A cursor that repeats, or a walk past
 * {@link MAX_PERSONAL_SEARCH_INTEGRATION_PAGES}, is a defect and throws rather than answering from
 * part of the inventory.
 */
export async function* personalSearchIntegrationPages({
  principal,
  input,
  signal,
}: {
  principal: Principal
  input: Omit<ListPersonalSearchIntegrationsInput, 'cursor'>
  signal?: AbortSignal
}): AsyncGenerator<PersonalSearchIntegrationsPage> {
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_PERSONAL_SEARCH_INTEGRATION_PAGES; page++) {
    signal?.throwIfAborted()
    const inventory = await listPersonalSearchIntegrations.execute({
      principal,
      input: { ...input, ...(cursor ? { cursor } : {}) },
    })
    signal?.throwIfAborted()
    yield inventory
    if (inventory.nextCursor === null) return
    if (seen.has(inventory.nextCursor))
      throw new Error('Personal Search integration pagination did not advance')
    seen.add(inventory.nextCursor)
    cursor = inventory.nextCursor
  }
  throw new Error(
    `Personal Search integration pagination exceeded ${MAX_PERSONAL_SEARCH_INTEGRATION_PAGES} pages`
  )
}
