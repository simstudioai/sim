import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UserProfileQuery')

/**
 * Query key factories for user profile
 */
export const userProfileKeys = {
  all: ['userProfile'] as const,
  profile: () => [...userProfileKeys.all, 'profile'] as const,
}

/**
 * User profile type
 */
export interface UserProfile {
  id: string
  name: string
  email: string
  image: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Fetch user profile from API
 */
async function fetchUserProfile(): Promise<UserProfile> {
  const response = await fetch('/api/users/me/profile')

  if (!response.ok) {
    throw new Error('Failed to fetch user profile')
  }

  const { user } = await response.json()

  return {
    id: user.id,
    name: user.name || '',
    email: user.email || '',
    image: user.image || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

/**
 * Hook to fetch user profile
 */
export function useUserProfile() {
  return useQuery({
    queryKey: userProfileKeys.profile(),
    queryFn: fetchUserProfile,
    staleTime: 5 * 60 * 1000, // 5 minutes - profile data doesn't change often
    placeholderData: keepPreviousData, // Show cached data immediately (no skeleton loading!)
  })
}

/**
 * Update user profile mutation
 */
interface UpdateProfileParams {
  name?: string
  image?: string | null
}

export function useUpdateUserProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (updates: UpdateProfileParams) => {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update profile')
      }

      return response.json()
    },
    onMutate: async (updates) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: userProfileKeys.profile() })

      // Snapshot the previous value
      const previousProfile = queryClient.getQueryData<UserProfile>(userProfileKeys.profile())

      // Optimistically update to the new value
      if (previousProfile) {
        queryClient.setQueryData<UserProfile>(userProfileKeys.profile(), {
          ...previousProfile,
          ...updates,
          updatedAt: new Date().toISOString(),
        })
      }

      return { previousProfile }
    },
    onError: (err, _variables, context) => {
      // Rollback on error
      if (context?.previousProfile) {
        queryClient.setQueryData(userProfileKeys.profile(), context.previousProfile)
      }
      logger.error('Failed to update profile:', err)
    },
    onSuccess: () => {
      // Invalidate to ensure we have the latest from server
      queryClient.invalidateQueries({ queryKey: userProfileKeys.profile() })
    },
  })
}
