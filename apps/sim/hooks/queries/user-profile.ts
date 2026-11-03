import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ForgetPasswordBody,
  forgetPasswordContract,
  getUserProfileContract,
  type UpdateUserProfileBody,
  updateUserProfileContract,
} from '@/lib/api/contracts/user'
import {
  mapUserProfileResponse,
  USER_PROFILE_STALE_TIME,
  type UserProfile,
  userProfileKeys,
} from '@/hooks/queries/current-user-data'

const logger = createLogger('UserProfileQuery')

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
    staleTime: USER_PROFILE_STALE_TIME,
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
      return queryClient.invalidateQueries({ queryKey: userProfileKeys.profile() })
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
