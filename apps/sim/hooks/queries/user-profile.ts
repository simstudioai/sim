import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const logger = createLogger('UserProfileQuery')

/**
 * Query key factories for user profile
 */
export const userProfileKeys = {
  all: ['userProfile'] as const,
  profile: () => [...userProfileKeys.all, 'profile'] as const,
  superUser: (userId?: string) => [...userProfileKeys.all, 'superUser', userId ?? ''] as const,
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
    placeholderData: keepPreviousData, // Show cached data immediately
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
      await queryClient.cancelQueries({ queryKey: userProfileKeys.profile() })

      const previousProfile = queryClient.getQueryData<UserProfile>(userProfileKeys.profile())

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
      if (context?.previousProfile) {
        queryClient.setQueryData(userProfileKeys.profile(), context.previousProfile)
      }
      logger.error('Failed to update profile:', err)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userProfileKeys.profile() })
    },
  })
}

/**
 * Superuser status response type
 */
interface SuperUserStatus {
  isSuperUser: boolean
}

/**
 * Fetch superuser status from API
 */
async function fetchSuperUserStatus(): Promise<SuperUserStatus> {
  const response = await fetch('/api/user/super-user')

  if (!response.ok) {
    return { isSuperUser: false }
  }

  const data = await response.json()
  return { isSuperUser: data.isSuperUser ?? false }
}

/**
 * Hook to fetch superuser status
 * @param userId - User ID for cache isolation (required for proper per-user caching)
 */
export function useSuperUserStatus(userId?: string) {
  return useQuery({
    queryKey: userProfileKeys.superUser(userId),
    queryFn: fetchSuperUserStatus,
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000, // 5 minutes - superuser status rarely changes
  })
}
