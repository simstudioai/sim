import { useEffect, useState, useRef } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UseReplicateCollections')

export interface ReplicateCollectionOption {
  value: string
  label: string
  description?: string
}

export interface UseReplicateCollectionsOptions {
  /** Enable collection fetching */
  enabled: boolean
  /** API key for authentication */
  apiKey: string | null | undefined
  /** Workspace ID for environment variable resolution */
  workspaceId?: string
  /** Collections API endpoint (e.g., '/api/replicate/collections') */
  endpoint: string
  /** Header name for API key (e.g., 'x-replicate-api-key') */
  apiKeyHeaderName?: string
}

export interface UseReplicateCollectionsResult {
  collections: ReplicateCollectionOption[]
  loading: boolean
  error: string | null
}

/**
 * Hook for fetching Replicate model collections.
 *
 * ⚠️ PRODUCTION STATUS: Replicate only
 *
 * This hook fetches Replicate's curated model collections (e.g., "Image Generation",
 * "Video", "Language Models"). While it has configurable endpoint and header params,
 * it is designed specifically for Replicate's collections API structure.
 *
 * Note: Not all AI model providers have a "collections" concept. HuggingFace uses tags,
 * AWS Bedrock uses model categories, etc. This pattern is Replicate-specific.
 *
 * When adding a similar provider with collections, consider:
 * 1. Creating a provider-specific hook (e.g., useHuggingFaceTags)
 * 2. OR extracting common logic to a generic utility function
 * 3. Only after 2+ similar implementations, create a true generic hook
 *
 * Features:
 * - Automatic fetching when apiKey changes
 * - AbortController to prevent race conditions
 * - Loading and error states
 * - Environment variable resolution via workspaceId
 *
 * @param options Configuration options
 * @returns Collections array, loading state, and error state
 *
 * @example Replicate usage (tested)
 * ```tsx
 * const { collections, loading, error } = useReplicateCollections({
 *   enabled: true,
 *   apiKey: userApiKey,
 *   workspaceId: workspaceId,
 *   endpoint: '/api/replicate/collections',
 *   apiKeyHeaderName: 'x-replicate-api-key',
 * })
 * ```
 */
export function useReplicateCollections({
  enabled,
  apiKey,
  workspaceId,
  endpoint,
  apiKeyHeaderName,
}: UseReplicateCollectionsOptions): UseReplicateCollectionsResult {
  const [collections, setCollections] = useState<ReplicateCollectionOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Don't fetch if disabled or no API key
    if (!enabled || !apiKey) {
      setCollections([])
      setError(null)
      return
    }

    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const fetchCollections = async () => {
      setLoading(true)
      setError(null)

      try {
        // Build URL with query parameters
        const queryParams = new URLSearchParams()
        if (workspaceId) {
          queryParams.set('workspaceId', workspaceId)
        }
        const queryString = queryParams.toString()
        const url = `${endpoint}${queryString ? `?${queryString}` : ''}`

        logger.info('Fetching Replicate collections', { endpoint, workspaceId })

        // Build headers with configurable API key header name
        const headerKey = apiKeyHeaderName || 'Authorization'
        const headerValue = apiKeyHeaderName ? (apiKey as string) : `Bearer ${apiKey}`

        const response = await fetch(url, {
          headers: {
            [headerKey]: headerValue,
          },
          signal: abortController.signal,
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch Replicate collections: ${response.status}`)
        }

        const data = await response.json()
        setCollections(data.collections || [])

        logger.info('Replicate collections fetched successfully', {
          count: data.collections?.length || 0,
        })
      } catch (err: any) {
        // Ignore abort errors (expected when dependencies change)
        if (err.name === 'AbortError') {
          return
        }

        logger.error('Failed to fetch Replicate collections', { error: err.message })
        setError(err.message)
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false)
        }
      }
    }

    fetchCollections()

    // Cleanup: Abort fetch on unmount or dependency change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [enabled, apiKey, workspaceId, endpoint, apiKeyHeaderName])

  return { collections, loading, error }
}
