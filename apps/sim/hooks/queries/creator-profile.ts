import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import type { CreatorProfileDetails } from '@/app/_types/creator-profile'

const logger = createLogger('CreatorProfileQuery')

/**
 * Query key factories for creator profiles
 */
export const creatorProfileKeys = {
  all: ['creatorProfile'] as const,
  profile: (userId: string) => [...creatorProfileKeys.all, 'profile', userId] as const,
  organizations: () => [...creatorProfileKeys.all, 'organizations'] as const,
}

/**
 * Organization type
 */
export interface Organization {
  id: string
  name: string
  role: string
}

/**
 * Creator profile type
 */
export interface CreatorProfile {
  id: string
  referenceType: 'user' | 'organization'
  referenceId: string
  name: string
  profileImageUrl: string
  details?: CreatorProfileDetails
  createdAt: string
  updatedAt: string
}

/**
 * Fetch organizations where user is owner or admin
 * Note: Filtering is done server-side in the API route
 */
async function fetchOrganizations(): Promise<Organization[]> {
  const response = await fetch('/api/organizations')

  if (!response.ok) {
    throw new Error('Failed to fetch organizations')
  }

  const data = await response.json()
  return data.organizations || []
}

/**
 * Hook to fetch organizations
 */
export function useOrganizations() {
  return useQuery({
    queryKey: creatorProfileKeys.organizations(),
    queryFn: fetchOrganizations,
    staleTime: 5 * 60 * 1000, // 5 minutes - organizations don't change often
    placeholderData: keepPreviousData, // Show cached data immediately
  })
}

/**
 * Fetch creator profile for a user
 */
async function fetchCreatorProfile(userId: string): Promise<CreatorProfile | null> {
  const response = await fetch(`/api/creator-profiles?userId=${userId}`)

  // Treat 404 as "no profile"
  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('Failed to fetch creator profile')
  }

  const data = await response.json()

  if (data.profiles && data.profiles.length > 0) {
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
    queryFn: () => fetchCreatorProfile(userId),
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

      const url = existingProfileId
        ? `/api/creator-profiles/${existingProfileId}`
        : '/api/creator-profiles'
      const method = existingProfileId ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.error || 'Failed to save creator profile'
        throw new Error(errorMessage)
      }

      const result = await response.json()
      return result.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: creatorProfileKeys.profile(variables.referenceId),
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
