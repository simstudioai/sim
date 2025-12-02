import { useQuery } from '@tanstack/react-query'

export const superUserKeys = {
  status: () => ['superUserStatus'] as const,
}

/**
 * Hook to fetch the current user's superuser status
 */
export function useSuperUserStatus() {
  return useQuery({
    queryKey: superUserKeys.status(),
    queryFn: async () => {
      const response = await fetch('/api/user/super-user')
      if (!response.ok) {
        throw new Error('Failed to fetch super user status')
      }
      return response.json() as Promise<{ isSuperUser: boolean }>
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

