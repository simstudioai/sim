import type { ToolConfig } from '@/tools/types'
import type { ReplicatePredictionParams, ReplicateResponse } from './types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ReplicateTool')

/**
 * Determine the appropriate Replicate endpoint and version handling
 * based on model format.
 *
 * - Official models (owner/name): Use /models/{owner}/{name}/predictions, version optional
 * - Community models (owner/name:version): Use /predictions, version required
 * - Explicit version param: Use /predictions, version required
 */
function getReplicateEndpoint(
  model: string,
  version?: string
): {
  url: string
  requiresVersion: boolean
  versionId?: string
} {
  // Extract model path and inline version if present
  const [modelPath, inlineVersion] = model.includes(':') ? model.split(':', 2) : [model, undefined]

  const [owner, name] = modelPath.split('/')

  if (!owner || !name) {
    throw new Error('Invalid model format. Use "owner/name" or "owner/name:version"')
  }

  // Determine version ID from explicit param or inline version
  const versionId = version || inlineVersion

  // If explicit version provided (via param or inline), use community endpoint
  if (versionId) {
    return {
      url: 'https://api.replicate.com/v1/predictions',
      requiresVersion: true,
      versionId,
    }
  }

  // No version specified - use official model endpoint (supports latest_version)
  return {
    url: `https://api.replicate.com/v1/models/${owner}/${name}/predictions`,
    requiresVersion: false,
    versionId: undefined,
  }
}

/**
 * Check if a value is meaningful (not null, undefined, empty string, or empty object)
 */
function hasValue(val: any): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === 'string' && val.trim() === '') return false
  if (typeof val === 'object' && Object.keys(val).length === 0) return false
  return true
}

/**
 * Clean input object by removing empty/null/undefined values
 */
function cleanInputs(inputs: Record<string, any>): Record<string, any> {
  if (!inputs || typeof inputs !== 'object') return {}

  const cleaned: Record<string, any> = {}
  for (const [key, value] of Object.entries(inputs)) {
    if (!hasValue(value)) {
      logger.debug('Filtering empty input param', { key, valueType: typeof value })
      continue
    }
    cleaned[key] = value
  }

  return cleaned
}

export const createPredictionTool: ToolConfig<ReplicatePredictionParams, ReplicateResponse> = {
  id: 'replicate_create_prediction',
  name: 'Replicate Create Prediction',
  description: 'Create a prediction on Replicate to run AI models',
  version: '1.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Replicate API token',
    },
    model: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Model in owner/name or owner/name:version format',
    },
    version: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Specific version ID (optional, defaults to latest)',
    },
    input: {
      type: 'object',
      required: true,
      visibility: 'user-or-llm',
      description: 'Model input parameters as a JSON object',
    },
    webhook: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Webhook URL for async completion notifications',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      default: 'async',
      description: 'Execution mode: async or sync',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      default: 60,
      description: 'Timeout in seconds for sync mode (1-300)',
    },
  },

  request: {
    method: 'POST',
    url: (params) => {
      const endpoint = getReplicateEndpoint(params.model, params.version)

      logger.info('Replicate endpoint determined', {
        model: params.model,
        version: params.version,
        endpoint: endpoint.url,
        requiresVersion: endpoint.requiresVersion,
      })

      return endpoint.url
    },
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }

      // Add Prefer header for sync mode with timeout handling
      if (params.mode === 'sync') {
        // Handle timeout with type coercion (UI may send string) and validation
        let timeout = 60 // default
        if (hasValue(params.timeout)) {
          const parsed = typeof params.timeout === 'string'
            ? Number.parseInt(params.timeout, 10)
            : (params.timeout as number)
          if (!Number.isNaN(parsed) && parsed !== undefined && parsed > 0 && parsed <= 60) {
            timeout = parsed
          } else {
            logger.warn('Invalid timeout value, using default', {
              provided: params.timeout,
              default: 60,
            })
          }
        }
        headers['Prefer'] = `wait=${timeout}`

        logger.debug('Sync mode timeout configured', { timeout })
      }

      return headers
    },
    body: (params) => {
      // Validate input type
      if (typeof params.input !== 'object' || params.input === null) {
        throw new Error('Input must be an object')
      }

      // Clean empty values from input (tool responsibility)
      const cleanedInput = cleanInputs(params.input)

      logger.debug('Input parameters cleaned', {
        originalKeys: Object.keys(params.input),
        cleanedKeys: Object.keys(cleanedInput),
        removed: Object.keys(params.input).length - Object.keys(cleanedInput).length,
      })

      // Determine endpoint and version handling
      const endpoint = getReplicateEndpoint(params.model, params.version)

      const body: any = {
        input: cleanedInput,
      }

      // Only include version if endpoint requires it (community models with explicit version)
      if (endpoint.requiresVersion && endpoint.versionId) {
        body.version = endpoint.versionId
      }

      // Add webhook for async mode (only if provided and not empty)
      if (params.mode === 'async' && hasValue(params.webhook)) {
        body.webhook = params.webhook
        body.webhook_events_filter = ['completed']
      }

      // Log the actual body structure for debugging
      logger.info('Replicate request body prepared', {
        endpointType: endpoint.requiresVersion ? 'community' : 'official',
        hasVersion: !!body.version,
        versionValue: body.version || 'latest (omitted)',
        inputKeys: Object.keys(cleanedInput),
        hasWebhook: !!body.webhook,
        mode: params.mode || 'async',
      })

      return body
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      let errorData: any = {}
      let errorText = ''

      try {
        errorText = await response.text()
        errorData = JSON.parse(errorText)
      } catch {
        // Not JSON, use raw text
        errorData = { message: errorText }
      }

      // Replicate uses 'detail' field for validation errors
      const errorMsg =
        errorData.detail || errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`

      logger.error('Replicate API error', {
        status: response.status,
        statusText: response.statusText,
        errorDetail: errorData,
        requestParams: {
          model: params?.model,
          version: params?.version,
          inputType: typeof params?.input,
        },
      })

      return {
        success: false,
        error: `Replicate API Error: ${errorMsg}`,
        output: {
          id: '',
          status: 'failed' as const,
          output: null,
          error: errorMsg,
          urls: { get: '', cancel: '' },
        },
      }
    }

    // Success case
    const data = await response.json()

    logger.info('Replicate prediction created successfully', {
      id: data.id,
      status: data.status,
      hasOutput: !!data.output,
    })

    return {
      success: true,
      output: {
        id: data.id,
        status: data.status,
        output: data.output,
        error: data.error,
        urls: data.urls,
        metrics: data.metrics,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the prediction was created successfully',
    },
    output: {
      type: 'object',
      description: 'Prediction result',
      properties: {
        id: {
          type: 'string',
          description: 'Prediction ID',
        },
        status: {
          type: 'string',
          description: 'Prediction status (starting, processing, succeeded, failed, canceled)',
        },
        output: {
          type: 'json',
          description: 'Prediction output (available when status is succeeded)',
          optional: true,
        },
        error: {
          type: 'string',
          description: 'Error message if prediction failed',
          optional: true,
        },
        urls: {
          type: 'object',
          description: 'URLs for checking prediction status',
          properties: {
            get: {
              type: 'string',
              description: 'URL to get prediction status',
            },
            cancel: {
              type: 'string',
              description: 'URL to cancel prediction',
            },
          },
        },
        metrics: {
          type: 'object',
          description: 'Execution metrics',
          optional: true,
          properties: {
            predict_time: {
              type: 'number',
              description: 'Prediction execution time in seconds',
              optional: true,
            },
          },
        },
      },
    },
  },
}
