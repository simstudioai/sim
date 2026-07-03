import { getErrorMessage } from '@sim/utils/errors'
import {
  STORAGE_MESSAGE_OUTPUT_PROPERTIES,
  type SupabaseStorageUpdateBucketParams,
  type SupabaseStorageUpdateBucketResponse,
} from '@/tools/supabase/types'
import { encodeStorageSegment, supabaseBaseUrl } from '@/tools/supabase/utils'
import type { ToolConfig } from '@/tools/types'

export const storageUpdateBucketTool: ToolConfig<
  SupabaseStorageUpdateBucketParams,
  SupabaseStorageUpdateBucketResponse
> = {
  id: 'supabase_storage_update_bucket',
  name: 'Supabase Storage Update Bucket',
  description: 'Update the configuration of an existing Supabase storage bucket',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
    },
    bucket: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the bucket to update',
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the bucket should be publicly accessible (leave unset to keep the current value)',
    },
    fileSizeLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum file size in bytes (leave unset to keep the current value)',
    },
    allowedMimeTypes: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of allowed MIME types (e.g., ["image/png", "image/jpeg"]) — leave unset to keep the current value',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase service role secret key',
    },
  },

  /**
   * Unreachable: `directExecution` below always handles this tool because
   * the update must first read the bucket's current configuration (the
   * Storage API's update-bucket endpoint is a full-replace PUT, not a
   * partial patch). Declared only to satisfy `ToolConfig`'s required
   * `request` field.
   */
  request: {
    url: (params) =>
      `${supabaseBaseUrl(params.projectId)}/storage/v1/bucket/${encodeStorageSegment(params.bucket)}`,
    method: 'PUT',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  /**
   * The Storage API's update-bucket endpoint is a full-replace PUT
   * (`{id, name, public, file_size_limit?, allowed_mime_types?}`), not a
   * partial patch. Fetching the bucket's current configuration first lets
   * unset params fall back to their existing value instead of silently
   * resetting to a default (e.g. flipping a public bucket private just
   * because `isPublic` wasn't provided).
   */
  directExecution: async (
    params: SupabaseStorageUpdateBucketParams
  ): Promise<SupabaseStorageUpdateBucketResponse> => {
    const baseUrl = supabaseBaseUrl(params.projectId)
    const bucket = encodeStorageSegment(params.bucket)
    const headers = {
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }

    try {
      const currentResponse = await fetch(`${baseUrl}/storage/v1/bucket/${bucket}`, {
        method: 'GET',
        headers,
      })

      if (!currentResponse.ok) {
        const errorText = await currentResponse.text()
        throw new Error(`Failed to read current bucket configuration: ${errorText}`)
      }

      const current = await currentResponse.json()

      // Block subBlocks for a shared field can forward an empty string
      // (e.g. an untouched short-input) rather than omitting the key
      // entirely — treat that the same as "not provided" so it falls
      // back to the bucket's current value instead of coercing to 0/false.
      const hasValue = (value: unknown): boolean =>
        value !== undefined && value !== null && value !== ''

      const payload: any = {
        id: params.bucket,
        name: params.bucket,
        public: hasValue(params.isPublic) ? params.isPublic : Boolean(current.public),
        file_size_limit: hasValue(params.fileSizeLimit)
          ? Number(params.fileSizeLimit)
          : (current.file_size_limit ?? null),
        allowed_mime_types: hasValue(params.allowedMimeTypes)
          ? params.allowedMimeTypes
          : (current.allowed_mime_types ?? null),
      }

      const updateResponse = await fetch(`${baseUrl}/storage/v1/bucket/${bucket}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      })

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text()
        throw new Error(`Failed to update bucket: ${errorText}`)
      }

      const data = await updateResponse.json()

      return {
        success: true,
        output: {
          message: 'Successfully updated storage bucket',
          results: data,
        },
        error: undefined,
      }
    } catch (error) {
      return {
        success: false,
        output: {
          message: 'Failed to update storage bucket',
          results: {},
        },
        error: getErrorMessage(error, 'Unknown error occurred'),
      }
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'object',
      description: 'Update operation result',
      properties: STORAGE_MESSAGE_OUTPUT_PROPERTIES,
    },
  },
}
