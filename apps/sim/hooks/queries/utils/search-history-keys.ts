export const SEARCH_HISTORY_STALE_TIME = 30_000

export const searchHistoryKeys = {
  all: ['search-history'] as const,
  lists: () => [...searchHistoryKeys.all, 'list'] as const,
  list: (organizationId: string | undefined, userId: string | undefined) =>
    [...searchHistoryKeys.lists(), organizationId ?? '', userId ?? ''] as const,
}
