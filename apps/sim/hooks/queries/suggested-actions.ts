import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getSuggestedActionCatalogContract } from '@/lib/api/contracts/suggested-actions'

const suggestedActionKeys = {
  all: ['suggested-actions'] as const,
  catalog: () => [...suggestedActionKeys.all, 'catalog'] as const,
}

/** The block template catalog Home's suggested actions sample from; it changes only on deploy. */
export function useSuggestedActionCatalog(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: suggestedActionKeys.catalog(),
    queryFn: ({ signal }) => requestJson(getSuggestedActionCatalogContract, { signal }),
    enabled: options?.enabled ?? true,
    staleTime: 'static',
  })
}
