import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ForgetPasswordBody,
  forgetPasswordContract,
  getUserProfileContract,
  type UpdateUserProfileBody,
  type UserProfileApiUser,
  updateUserProfileContract,
} from '@/lib/api/contracts'

const logger = createLogger('UserProfileQuery')

/**
 * Query key factories for user profile
 */
export const userProfileKeys = {
  all: ['userProfile'] as const,
  profile: () => [...userProfileKeys.all, 'profile'] as const,
}

/**
 * User profile type, derived from the contract response shape minus
 * the auth-only `emailVerified` field which is not displayed in the UI.
 */
export type UserProfile = Omit<UserProfileApiUser, 'emailVerified'>

/**
 * Map raw API response user object to UserProfile.
 * Shared by both client fetch and server prefetch to prevent shape drift.
 */
export function mapUserProfileResponse(user: UserProfileApiUser): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
  }
}

/**
 * Fetch user profile from API
 */
async function fetchUserProfile(signal?: AbortSignal): Promise<UserProfile> {
  const { user } = await requestJson(getUserProfileContract, { signal })
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
type UpdateProfileParams = UpdateUserProfileBody

export function useUpdateUserProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (updates: UpdateProfileParams) => {
      return requestJson(updateUserProfileContract, { body: updates })
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: userProfileKeys.profile() })

      const previousProfile = queryClient.getQueryData<UserProfile>(userProfileKeys.profile())

      if (previousProfile) {
        queryClient.setQueryData<UserProfile>(userProfileKeys.profile(), {
          ...previousProfile,
          ...updates,
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
type ResetPasswordParams = Pick<ForgetPasswordBody, 'email' | 'redirectTo'> & {
  redirectTo: string
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async ({ email, redirectTo }: ResetPasswordParams) => {
      return requestJson(forgetPasswordContract, { body: { email, redirectTo } })
    },
  })
}
