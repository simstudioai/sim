import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type {
  SupabaseStorageUpdateBucketParams,
  SupabaseStorageUpdateBucketResponse,
} from '@/tools/supabase/types'
import { encodeStorageSegment, supabaseBaseUrl } from '@/tools/supabase/utils'

export const executeStorageUpdateBucketOperation: InternalToolOperationImplementation<
  SupabaseStorageUpdateBucketParams
> = async (
  params: SupabaseStorageUpdateBucketParams,
  signal
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
      signal,
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
      value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '')
    const rawFileSizeLimit: unknown = params.fileSizeLimit
    const fileSizeLimit = hasValue(rawFileSizeLimit)
      ? typeof rawFileSizeLimit === 'number'
        ? rawFileSizeLimit
        : typeof rawFileSizeLimit === 'string' &&
            /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(rawFileSizeLimit.trim())
          ? Number(rawFileSizeLimit)
          : Number.NaN
      : undefined
    if (fileSizeLimit !== undefined && !Number.isFinite(fileSizeLimit)) {
      throw new Error('File size limit must be a finite number')
    }

    const payload: Record<string, unknown> = {
      id: params.bucket,
      name: params.bucket,
      public: hasValue(params.isPublic) ? params.isPublic : Boolean(current.public),
      file_size_limit: fileSizeLimit ?? current.file_size_limit ?? null,
      allowed_mime_types: hasValue(params.allowedMimeTypes)
        ? params.allowedMimeTypes
        : (current.allowed_mime_types ?? null),
    }

    const updateResponse = await fetch(`${baseUrl}/storage/v1/bucket/${bucket}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
      signal,
    })

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      throw new Error(`Failed to update bucket: ${errorText}`)
    }

    const data = await updateResponse.json()
    signal?.throwIfAborted()

    return {
      success: true,
      output: {
        message: 'Successfully updated storage bucket',
        results: data,
      },
      error: undefined,
    }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      success: false,
      output: {
        message: 'Failed to update storage bucket',
        results: {},
      },
      error: getErrorMessage(error, 'Unknown error occurred'),
    }
  }
}
