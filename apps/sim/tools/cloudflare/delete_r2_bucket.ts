import type {
  CloudflareDeleteR2BucketParams,
  CloudflareDeleteR2BucketResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Refuses a bucket name carrying surrounding whitespace, instead of letting
 * `safeUrlPathSegment` trim it.
 *
 * Trimming is the right default almost everywhere, and this tool is the one
 * place it is not. Deleting a bucket is irreversible, and this is the only
 * parameter in this PR that is BOTH newly trimmed (it previously went through
 * a bare `encodeURIComponent`, so a padded name reached Cloudflare verbatim and
 * failed) AND attached to a destructive request. Every other newly-trimmed
 * parameter is a GET, a PUT, or an emoji.
 *
 * R2 names contain only lowercase letters, digits and hyphens
 * (`^[a-z0-9][a-z0-9-]*[a-z0-9]`), so `"  prod-data  "` names no bucket that
 * can exist. Trimming it therefore turns a request that used to fail into one
 * that destroys `prod-data` — a reasonable inference for a read, but not one
 * worth making on the caller's behalf when it cannot be undone. A stray
 * newline from a file read or a workflow variable is exactly how that arrives.
 *
 * Rejecting costs nothing legitimate, because no valid bucket name has
 * surrounding whitespace to lose.
 */
function assertExactBucketName(bucketName: unknown): void {
  if (typeof bucketName === 'string' && bucketName !== bucketName.trim()) {
    throw new Error(
      'bucketName cannot have leading or trailing whitespace: R2 bucket names contain only lowercase letters, digits, and hyphens, so this would delete a different bucket than the one named'
    )
  }
}

export const deleteR2BucketTool: ToolConfig<
  CloudflareDeleteR2BucketParams,
  CloudflareDeleteR2BucketResponse
> = {
  id: 'cloudflare_delete_r2_bucket',
  name: 'Cloudflare Delete R2 Bucket',
  description:
    'Permanently deletes an R2 object storage bucket. Cloudflare only deletes an empty bucket, and the deletion cannot be undone. Requires an API token with Account Workers R2 Storage Edit.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. R2 buckets are account-scoped',
    },
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the bucket to delete permanently',
    },
    jurisdiction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data-residency jurisdiction the bucket lives in: default, eu, or fedramp',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => {
      assertExactBucketName(params.bucketName)
      return `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/r2/buckets/${safeUrlPathSegment(params.bucketName, 'bucketName')}`
    },
    method: 'DELETE',
    headers: (params) => {
      const headers = cloudflareHeaders(params.apiKey)
      if (params.jurisdiction) headers['cf-r2-jurisdiction'] = params.jurisdiction
      return headers
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { name: '' },
        error: cloudflareErrorMessage(data, 'Failed to delete R2 bucket'),
      }
    }

    /**
     * Echo the name the request actually addressed, as a string.
     *
     * A padded name is refused above, so the echo cannot drift from the path.
     * `safeUrlPathSegment` also accepts a number, and a digits-only bucket
     * name is valid under R2's `^[a-z0-9][a-z0-9-]*[a-z0-9]` rule, so an id
     * supplied as JSON `12345` must still leave here as the string `'12345'`
     * that `outputs.name` declares.
     */
    const deleted = params?.bucketName
    return {
      success: true,
      output: { name: deleted === null || deleted === undefined ? '' : String(deleted).trim() },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description:
        'Name of the deleted bucket. Cloudflare returns an empty result body for this endpoint, so the name is echoed from the request',
    },
  },
}
