import { isRecordLike } from '@sim/utils/object'
import { DNS_RECORD_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareUpdateDnsRecordParams,
  CloudflareUpdateDnsRecordResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  mapCloudflareFields,
  parseCsvParam,
  parseJsonObjectParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateDnsRecordTool: ToolConfig<
  CloudflareUpdateDnsRecordParams,
  CloudflareUpdateDnsRecordResponse
> = {
  id: 'cloudflare_update_dns_record',
  name: 'Cloudflare Update DNS Record',
  description: 'Updates an existing DNS record for a zone.',
  version: '1.0.0',

  params: {
    clearComment: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Clear the stored DNS record comment',
    },
    settings: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. Settings for the DNS record. Fields: ipv4_only, ipv6_only, flatten_cname.',
    },
    private_routing: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enables private network routing to the origin.',
    },
    data: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. Structured record data. The available fields depend on the DNS record type. Fields: flags, tag, value, algorithm, certificate, key_tag, type, protocol, public_key, digest, digest_type, priority, target, altitude, lat_degrees, lat_direction, lat_minutes, lat_seconds, long_degrees, long_direction, long_minutes, long_seconds, precision_horz, precision_vert, size, order, preference, regex, replacement, service, matching_type, selector, usage, port, weight, fingerprint.',
    },
    include_shadow_metadata: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to include shadow metadata in the `meta` field of each record in the response. See [Shadowed records](https://developers.cloudflare.com/dns/manage-dns-records/reference/shadowed-records).',
    },
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID containing the DNS record',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The DNS record ID to update',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'DNS record type (e.g., "A", "AAAA", "CNAME", "MX", "TXT")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'DNS record name',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'DNS record content (e.g., IP address)',
    },
    ttl: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time to live in seconds (1 = automatic)',
    },
    proxied: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to enable Cloudflare proxy',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Record priority. Cloudflare accepts this top-level field for MX and URI records only; use the data object for structured records such as SRV (priority, weight, port, target)',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment for the DNS record',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags for the DNS record',
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
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/dns_records/${safeUrlPathSegment(params.recordId, 'recordId')}`
      )
      appendParam(url, 'include_shadow_metadata', params.include_shadow_metadata)
      return url.toString()
    },
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      /**
       * Cloudflare rejects an empty type, name, or content, so a blank field
       * means "leave this alone" rather than "clear it" — the block already
       * strips those, and this guard makes a direct tool call behave the same.
       * `comment` is deliberately not guarded: an empty comment is how the API
       * clears a stored comment, which is a real thing a caller asks for.
       */
      if (params.type !== undefined && params.type !== '') body.type = params.type
      if (params.name !== undefined && params.name !== '') body.name = params.name
      if (params.content !== undefined && params.content !== '') body.content = params.content
      if (params.ttl !== undefined) body.ttl = Number(params.ttl)
      if (params.proxied !== undefined) body.proxied = params.proxied
      if (params.priority !== undefined) body.priority = Number(params.priority)
      if (params.comment !== undefined) body.comment = params.comment
      const tags = parseCsvParam(params.tags)
      if (tags) body.tags = tags
      if (params.settings !== undefined && params.settings !== '')
        body.settings = parseJsonObjectParam(params.settings, 'settings')
      if (params.private_routing !== undefined) body.private_routing = params.private_routing
      if (params.data !== undefined && params.data !== '')
        body.data = parseJsonObjectParam(params.data, 'data')
      if (params.clearComment === true) body.comment = ''
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, DNS_RECORD_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to update dns record') } : {}),
    }
  },
  outputs: DNS_RECORD_OUTPUTS,
}
