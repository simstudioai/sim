import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreatorOrganization,
  type CreatorProfileContract,
  type CreatorProfileDetails,
  createCreatorProfileContract,
  listCreatorOrganizationsContract,
  listCreatorProfilesContract,
  updateCreatorProfileContract,
} from '@/lib/api/contracts/creator-profile'

const logger = createLogger('CreatorProfileQuery')

/**
 * Query key factories for creator profiles
 */
export const creatorProfileKeys = {
  all: ['creatorProfile'] as const,
  list: () => [...creatorProfileKeys.all, 'list'] as const,
  profile: (userId: string) => [...creatorProfileKeys.all, 'profile', userId] as const,
  organizations: () => [...creatorProfileKeys.all, 'organizations'] as const,
}

/**
 * Organization type
 */
export type Organization = CreatorOrganization

/**
 * Creator profile type
 */
export type CreatorProfile = CreatorProfileContract

/**
 * Fetch organizations where user is owner or admin
 * Note: Filtering is done server-side in the API route
 */
async function fetchOrganizations(signal?: AbortSignal): Promise<Organization[]> {
  const data = await requestJson(listCreatorOrganizationsContract, { signal })
  return data.organizations
}

/**
 * Hook to fetch organizations
 */
export function useOrganizations() {
  return useQuery({
    queryKey: creatorProfileKeys.organizations(),
    queryFn: ({ signal }) => fetchOrganizations(signal),
    staleTime: 5 * 60 * 1000, // 5 minutes - organizations don't change often
  })
}

/**
 * Fetch all creator profiles for the current user
 */
async function fetchCreatorProfiles(signal?: AbortSignal): Promise<CreatorProfile[]> {
  const data = await requestJson(listCreatorProfilesContract, { query: {}, signal })
  return data.profiles
}

/**
 * Hook to fetch all creator profiles for the current user
 */
export function useCreatorProfiles() {
  return useQuery({
    queryKey: creatorProfileKeys.list(),
    queryFn: ({ signal }) => fetchCreatorProfiles(signal),
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Fetch creator profile for a user
 */
async function fetchCreatorProfile(
  userId: string,
  signal?: AbortSignal
): Promise<CreatorProfile | null> {
  const data = await requestJson(listCreatorProfilesContract, {
    query: { userId },
    signal,
  })

  if (data.profiles.length > 0) {
    return data.profiles[0]
  }

  return null
}

/**
 * Hook to fetch creator profile
 */
export function useCreatorProfile(userId: string) {
  return useQuery({
    queryKey: creatorProfileKeys.profile(userId),
    queryFn: ({ signal }) => fetchCreatorProfile(userId, signal),
    enabled: !!userId,
    retry: false, // Don't retry on 404
    staleTime: 60 * 1000, // 1 minute
    placeholderData: keepPreviousData, // Show cached data immediately
  })
}

/**
 * Save creator profile mutation
 */
interface SaveProfileParams {
  referenceType: 'user' | 'organization'
  referenceId: string
  name: string
  profileImageUrl: string
  details?: CreatorProfileDetails
  existingProfileId?: string
}

export function useSaveCreatorProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      referenceType,
      referenceId,
      name,
      profileImageUrl,
      details,
      existingProfileId,
    }: SaveProfileParams) => {
      const payload = {
        referenceType,
        referenceId,
        name,
        profileImageUrl,
        details: details && Object.keys(details).length > 0 ? details : undefined,
      }

      if (existingProfileId) {
        const result = await requestJson(updateCreatorProfileContract, {
          params: { id: existingProfileId },
          body: payload,
        })
        return result.data
      }

      const result = await requestJson(createCreatorProfileContract, { body: payload })
      return result.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: creatorProfileKeys.profile(variables.referenceId),
      })
      queryClient.invalidateQueries({
        queryKey: creatorProfileKeys.list(),
      })

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('creator-profile-saved'))
      }

      logger.info('Creator profile saved successfully')
    },
    onError: (error) => {
      logger.error('Failed to save creator profile:', error)
    },
  })
}
