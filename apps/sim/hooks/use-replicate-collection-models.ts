import { useEffect, useState, useRef } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UseReplicateCollectionModels')

export interface ReplicateModelOption {
  value: string
  label: string
  description?: string
}

export interface UseReplicateCollectionModelsOptions {
  /** Enable model fetching */
  enabled: boolean
  /** Collection slug/ID to fetch models for */
  collection: string | null | undefined
  /** API key for authentication */
  apiKey: string | null | undefined
  /** Workspace ID for environment variable resolution */
  workspaceId?: string
  /** Collection models API endpoint pattern (e.g., '/api/replicate/collections') */
  endpoint: string
  /** Header name for API key (e.g., 'x-replicate-api-key') */
  apiKeyHeaderName?: string
}

export interface UseReplicateCollectionModelsResult {
  models: ReplicateModelOption[]
  loading: boolean
  error: string | null
}

/**
 * Hook for fetching models from a Replicate collection.
 *
 * ⚠️ PRODUCTION STATUS: Replicate only
 *
 * This hook fetches models within a specific Replicate collection (e.g., all models
 * in the "Image Generation" collection). It's designed for Replicate's API structure
 * where collections contain multiple models.
 *
 * Note: This pattern is Replicate-specific. Other providers organize models differently:
 * - HuggingFace: Models filtered by tags/tasks (no collection hierarchy)
 * - AWS Bedrock: Flat model catalog with categories
 * - OpenAI: Fixed model list (no collections)
 *
 * When adding a similar provider, consider:
 * 1. Creating a provider-specific hook that matches their taxonomy
 * 2. Only extract to generic hook after 2+ similar implementations
 *
 * Features:
 * - Automatic fetching when collection changes
 * - AbortController to prevent race conditions
 * - Auto-resets models when collection becomes null
 * - Loading and error states
 * - Environment variable resolution via workspaceId
 *
 * @param options Configuration options
 * @returns Models array, loading state, and error state
 *
 * @example Replicate usage (tested)
 * ```tsx
 * const { models, loading, error } = useReplicateCollectionModels({
 *   enabled: !!selectedCollection,
 *   collection: selectedCollection,
 *   apiKey: userApiKey,
 *   workspaceId: workspaceId,
 *   endpoint: '/api/replicate/collections',
 *   apiKeyHeaderName: 'x-replicate-api-key',
 * })
 * ```
 */
export function useReplicateCollectionModels({
  enabled,
  collection,
  apiKey,
  workspaceId,
  endpoint,
  apiKeyHeaderName,
}: UseReplicateCollectionModelsOptions): UseReplicateCollectionModelsResult {
  const [models, setModels] = useState<ReplicateModelOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Reset if disabled, no collection, or no API key
    if (!enabled || !collection || !apiKey) {
      setModels([])
      setError(null)
      return
    }

    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const fetchModels = async () => {
      setLoading(true)
      setError(null)

      try {
        // Build URL with query parameters
        const queryParams = new URLSearchParams()
        if (workspaceId) {
          queryParams.set('workspaceId', workspaceId)
        }
        const queryString = queryParams.toString()
        const url = `${endpoint}/${collection}${queryString ? `?${queryString}` : ''}`

        logger.info('Fetching Replicate collection models', { collection, endpoint, workspaceId })

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
          throw new Error(`Failed to fetch Replicate collection models: ${response.status}`)
        }

        const data = await response.json()
        setModels(data.models || [])

        logger.info('Replicate collection models fetched successfully', {
          collection,
          count: data.models?.length || 0,
        })
      } catch (err: any) {
        // Ignore abort errors (expected when dependencies change)
        if (err.name === 'AbortError') {
          return
        }

        logger.error('Failed to fetch Replicate collection models', {
          error: err.message,
          collection,
        })
        setError(err.message)
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false)
        }
      }
    }

    fetchModels()

    // Cleanup: Abort fetch on unmount or dependency change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [enabled, collection, apiKey, workspaceId, endpoint, apiKeyHeaderName])

  return { models, loading, error }
}
