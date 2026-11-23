import type { SimLinkSort } from '@/lib/sim-links/validation'
import type { SortDirection } from '@/lib/url-state'

/**
 * Query keys for an organization's Sim links. Not a `'use client'` module, so a server prefetch can
 * seed the same entry the client hook reads.
 */
export const SIM_LINKS_STALE_TIME = 30 * 1000

export const simLinkKeys = {
  all: ['sim-links'] as const,
  lists: (organizationId: string) => [...simLinkKeys.all, 'list', organizationId] as const,
  list: (organizationId: string, search: string, sort: SimLinkSort, dir: SortDirection) =>
    [...simLinkKeys.lists(organizationId), search, sort, dir] as const,
  forUrl: (organizationId: string, url: string) =>
    [...simLinkKeys.lists(organizationId), 'url', url] as const,
}
