import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
 * Map raw API response user object to UserProfile.
 * Shared by both client fetch and server prefetch to prevent shape drift.
 */
export function mapUserProfileResponse(user: Record<string, unknown>): UserProfile {
  return {
    id: user.id as string,
    name: (user.name as string) || '',
    email: (user.email as string) || '',
    image: (user.image as string) || null,
    createdAt: user.createdAt as string,
    updatedAt: user.updatedAt as string,
  }
}

/**
 * Fetch user profile from API
 */
async function fetchUserProfile(signal?: AbortSignal): Promise<UserProfile> {
  const response = await fetch('/api/users/me/profile', { signal })

  if (!response.ok) {
    throw new Error('Failed to fetch user profile')
  }

  const { user } = await response.json()
  return mapUserProfileResponse(user)
}

/**
 * Hook to fetch user profile
 */
export function useUserProfile() {
  return useQuery({
    queryKey: userProfileKeys.profile(),
    queryFn: ({ signal }) => fetchUserProfile(signal),
    staleTime: 5 * 60 * 1000,
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userProfileKeys.profile() })
    },
  })
}

/**
 * Reset password mutation
 */
interface ResetPasswordParams {
  email: string
  redirectTo: string
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async ({ email, redirectTo }: ResetPasswordParams) => {
      const response = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectTo }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to send reset password email')
      }

      return response.json()
    },
  })
}
