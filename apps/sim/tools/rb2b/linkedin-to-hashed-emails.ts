import type { Rb2bHashedEmailsResponse, Rb2bLinkedinParams } from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bLinkedinToHashedEmailsTool: ToolConfig<
  Rb2bLinkedinParams,
  Rb2bHashedEmailsResponse
> = {
  id: 'rb2b_linkedin_to_hashed_emails',
  name: 'RB2B LinkedIn to Hashed Emails',
  description:
    'Return the business and personal hashed emails (MD5 and SHA-256) associated with a LinkedIn profile.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
    linkedin_slug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The LinkedIn profile slug or URL',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/linkedin_to_hashed_emails`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => ({ linkedin_slug: params.linkedin_slug }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const results = data.results ?? {}
    return {
      success: true,
      output: {
        linkedin_slug: results.linkedin_slug ?? null,
        business_md5_array: results.business_md5_array ?? [],
        business_sha256_array: results.business_sha256_array ?? [],
        personal_md5_array: results.personal_md5_array ?? [],
        personal_sha256_array: results.personal_sha256_array ?? [],
      },
    }
  },

  outputs: {
    linkedin_slug: { type: 'string', description: 'The LinkedIn slug', optional: true },
    business_md5_array: {
      type: 'array',
      description: 'MD5 hashes of business emails',
      items: { type: 'string' },
    },
    business_sha256_array: {
      type: 'array',
      description: 'SHA-256 hashes of business emails',
      items: { type: 'string' },
    },
    personal_md5_array: {
      type: 'array',
      description: 'MD5 hashes of personal emails',
      items: { type: 'string' },
    },
    personal_sha256_array: {
      type: 'array',
      description: 'SHA-256 hashes of personal emails',
      items: { type: 'string' },
    },
  },
}
