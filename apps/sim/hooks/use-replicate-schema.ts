import { useEffect, useState, useCallback, useRef } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UseReplicateSchema')

export interface UseReplicateSchemaOptions {
  /** Model identifier in owner/name format (e.g., 'black-forest-labs/flux-schnell') */
  model: string | null | undefined
  /** Optional specific version ID */
  version?: string | null | undefined
  /** API key for authentication */
  apiKey: string | null | undefined
  /** Workspace ID for environment variable resolution */
  workspaceId?: string
  /** API endpoint base path (e.g., '/api/replicate/models') */
  endpoint?: string
  /** Optional custom schema path (overrides default /{owner}/{name}/schema pattern) */
  schemaPath?: string
  /** Header name for API key (e.g., 'x-replicate-api-key') */
  apiKeyHeaderName?: string
}

export interface UseReplicateSchemaResult {
  schema: any | null
  loading: boolean
  error: string | null
  retry: () => void
}

/**
 * Hook for fetching and managing Replicate model schemas.
 *
 * ⚠️ PRODUCTION STATUS: Replicate only
 *
 * ASPIRATIONAL DESIGN: While this hook has generic parameters (endpoint,
 * apiKeyHeaderName, schemaPath) that could theoretically work with other
 * OpenAPI-based providers, it has been tested and validated ONLY with Replicate.
 *
 * The generic parameters are included to facilitate future adaptation for:
 * - Hugging Face Inference API
 * - AWS Bedrock models
 * - Other OpenAPI-based AI model integrations
 *
 * However, DO NOT use this hook with other providers without thorough testing.
 * When adding a new provider, consider creating a provider-specific hook
 * (e.g., useHuggingFaceSchema) until this one is proven generic across 2+ providers.
 *
 * Features:
 * - Automatic fetching when model/version/apiKey changes
 * - 500ms debouncing to prevent excessive API calls
 * - AbortController to prevent race conditions
 * - Retry capability for error recovery
 * - Loading and error states
 * - Initial load state detection (prevents flash during hydration)
 *
 * @param options Configuration options
 * @returns Schema data, loading state, error state, and retry function
 *
 * @example Replicate usage (tested)
 * ```tsx
 * const { schema, loading, error, retry } = useReplicateSchema({
 *   model: 'black-forest-labs/flux-schnell',
 *   version: undefined,
 *   apiKey: userApiKey,
 *   workspaceId: workspaceId,
 *   endpoint: '/api/replicate/models',
 *   apiKeyHeaderName: 'x-replicate-api-key',
 * })
 * ```
 *
 * @example Future provider (untested - use at your own risk)
 * ```tsx
 * const { schema, loading, error, retry } = useReplicateSchema({
 *   model: 'owner/model',
 *   apiKey: apiKey,
 *   endpoint: '/api/huggingface/models',
 *   apiKeyHeaderName: 'Authorization',  // May need different format
 * })
 * ```
 */
export function useReplicateSchema({
  model,
  version,
  apiKey,
  workspaceId,
  endpoint,
  schemaPath,
  apiKeyHeaderName,
}: UseReplicateSchemaOptions): UseReplicateSchemaResult {
  const [schema, setSchema] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Track when apiKey has been loaded from store (prevents flash on page refresh)
  useEffect(() => {
    if (apiKey !== null && apiKey !== undefined) {
      setIsInitialLoad(false)
    }
  }, [apiKey])

  const retry = useCallback(() => {
    setRetryCount((prev) => prev + 1)
    setError(null)
  }, [])

  useEffect(() => {
    // Reset if model becomes empty
    if (!model || !apiKey) {
      setSchema(null)
      setError(null)
      return
    }

    // Debounce: Wait 500ms after user stops typing
    const debounceTimer = setTimeout(() => {
      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      const fetchSchema = async () => {
        setLoading(true)
        setError(null)

        try {
          // Build URL
          let url: string

          if (schemaPath) {
            // Use custom schema path (for collections, custom endpoints, etc.)
            const queryParams = new URLSearchParams()
            if (workspaceId) {
              queryParams.set('workspaceId', workspaceId)
            }
            const queryString = queryParams.toString()
            url = `${schemaPath}${queryString ? `?${queryString}` : ''}`
          } else {
            // Parse model to extract owner/name for standard schema endpoint
            const modelParts = model.split('/')
            if (modelParts.length !== 2) {
              throw new Error('Invalid model format. Use owner/model-name')
            }

            const [owner, name] = modelParts

            // Build URL with query parameters
            const queryParams = new URLSearchParams()
            if (version) {
              queryParams.set('version', version)
            }
            if (workspaceId) {
              queryParams.set('workspaceId', workspaceId)
            }
            const queryString = queryParams.toString()
            url = `${endpoint}/${owner}/${name}/schema${queryString ? `?${queryString}` : ''}`
          }

          logger.info('Fetching Replicate model schema', { model, version, workspaceId, endpoint, schemaPath })

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
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error || `Failed to fetch schema: ${response.status}`)
          }

          const data = await response.json()
          setSchema(data.input) // Use dereferenced input schema

          logger.info('Schema fetched successfully', {
            model,
            properties: Object.keys(data.input?.properties || {}),
          })
        } catch (err: any) {
          // Ignore abort errors (expected when dependencies change)
          if (err.name === 'AbortError') {
            return
          }

          logger.error('Failed to fetch schema', { error: err.message, model })
          setError(err.message)
        } finally {
          if (!abortController.signal.aborted) {
            setLoading(false)
          }
        }
      }

      fetchSchema()
    }, 500) // 500ms debounce delay

    // Cleanup: Cancel debounce timer and abort fetch
    return () => {
      clearTimeout(debounceTimer)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [model, version, apiKey, workspaceId, endpoint, schemaPath, apiKeyHeaderName, retryCount])

  // Show loading during initial apiKey load (prevents flash)
  if (isInitialLoad && !apiKey) {
    return { schema: null, loading: true, error: null, retry }
  }

  return { schema, loading, error, retry }
}
