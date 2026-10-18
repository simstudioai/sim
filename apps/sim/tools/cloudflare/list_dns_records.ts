import { DNS_RECORD_OUTPUTS, RESULT_INFO_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListDnsRecordsParams,
  CloudflareListDnsRecordsResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listDnsRecordsTool: ToolConfig<
  CloudflareListDnsRecordsParams,
  CloudflareListDnsRecordsResponse
> = {
  id: 'cloudflare_list_dns_records',
  name: 'Cloudflare List DNS Records',
  description: 'Lists DNS records for a specific zone.',
  version: '1.0.0',

  params: {
    name_contains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Substring of the DNS record name. Name filters are case-insensitive.',
    },
    name_startswith: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prefix of the DNS record name. Name filters are case-insensitive.',
    },
    name_endswith: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Suffix of the DNS record name. Name filters are case-insensitive.',
    },
    content_contains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Substring of the DNS record content. Content filters are case-insensitive.',
    },
    content_startswith: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prefix of the DNS record content. Content filters are case-insensitive.',
    },
    content_endswith: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Suffix of the DNS record content. Content filters are case-insensitive.',
    },
    comment_present: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If this parameter is present, only records *with* a comment are returned.',
    },
    comment_absent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'If this parameter is present, only records *without* a comment are returned.',
    },
    comment_exact: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact value of the DNS record comment. Comment filters are case-insensitive.',
    },
    comment_startswith: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prefix of the DNS record comment. Comment filters are case-insensitive.',
    },
    comment_endswith: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Suffix of the DNS record comment. Comment filters are case-insensitive.',
    },
    tag_present: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of a tag which must be present on the DNS record. Tag filters are case-insensitive.',
    },
    tag_absent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of a tag which must *not* be present on the DNS record. Tag filters are case-insensitive.',
    },
    tag_contains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A tag and value, of the form `<tag-name>:<tag-value>`. The API will only return DNS records that have a tag named `<tag-name>` whose value contains `<tag-value>`. Tag filters are case-insensitive.',
    },
    tag_startswith: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A tag and value, of the form `<tag-name>:<tag-value>`. The API will only return DNS records that have a tag named `<tag-name>` whose value starts with `<tag-value>`. Tag filters are case-insensitive.',
    },
    tag_endswith: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A tag and value, of the form `<tag-name>:<tag-value>`. The API will only return DNS records that have a tag named `<tag-name>` whose value ends with `<tag-value>`. Tag filters are case-insensitive.',
    },
    include_shadow_metadata: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to include shadow metadata in the `meta` field of each record in the response. See [Shadowed records](https://developers.cloudflare.com/dns/manage-dns-records/reference/shadowed-records).',
    },
    shadowed_by_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters the response to records at or below the specified NS delegation name. NS, DS, and NSEC records at the delegation name are excluded because they are not shadowed by that delegation. Those record types are included only when they exist below the delegation. The value must be a non-apex subdomain of the zone. Requires `include_shadow_metadata=true`. See [Shadowed records](https://developers.cloudflare.com/dns/manage-dns-records/reference/shadowed-records).',
    },
    shadowing_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Returns NS records that shadow the given name, searching at the name itself and each of its ancestor names within the zone, excluding the zone apex. The value must be a subdomain of the zone; the zone apex is not accepted. See [Shadowed records](https://developers.cloudflare.com/dns/manage-dns-records/reference/shadowed-records).',
    },
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to list DNS records for',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by record type (e.g., "A", "AAAA", "CNAME", "MX", "TXT")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by record name (exact match)',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by record content (exact match)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (default: 1)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records per page (default: 100, max: 5000000)',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction (asc or desc)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Match logic for filters: any or all (default: all)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field (type, name, content, ttl, proxied)',
    },
    proxied: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by proxy status',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across record name, content, and value',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by tag name, or an exact name:value pair (e.g., team:DNS)',
    },
    tag_match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tag filter match logic: any or all. Only affects results when combined with multiple tag filter conditions; has no effect with the single exact-match Tag Filter above.',
    },
    commentFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter records by comment content (substring match)',
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
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/dns_records`
      )
      if (params.type) url.searchParams.append('type', params.type)
      if (params.name) url.searchParams.append('name.exact', params.name)
      if (params.content) url.searchParams.append('content.exact', params.content)
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.direction) url.searchParams.append('direction', params.direction)
      if (params.match) url.searchParams.append('match', params.match)
      if (params.order) url.searchParams.append('order', params.order)
      if (params.proxied !== undefined) url.searchParams.append('proxied', String(params.proxied))
      if (params.search) url.searchParams.append('search', params.search)
      if (params.tag) url.searchParams.append('tag', params.tag)
      if (params.tag_match) url.searchParams.append('tag_match', params.tag_match)
      if (params.commentFilter) url.searchParams.append('comment.contains', params.commentFilter)
      appendParam(url, 'name.contains', params.name_contains)
      appendParam(url, 'name.startswith', params.name_startswith)
      appendParam(url, 'name.endswith', params.name_endswith)
      appendParam(url, 'content.contains', params.content_contains)
      appendParam(url, 'content.startswith', params.content_startswith)
      appendParam(url, 'content.endswith', params.content_endswith)
      if (params.comment_present === true) url.searchParams.set('comment.present', '')
      if (params.comment_absent === true) url.searchParams.set('comment.absent', '')
      appendParam(url, 'comment.exact', params.comment_exact)
      appendParam(url, 'comment.startswith', params.comment_startswith)
      appendParam(url, 'comment.endswith', params.comment_endswith)
      appendParam(url, 'tag.present', params.tag_present)
      appendParam(url, 'tag.absent', params.tag_absent)
      appendParam(url, 'tag.contains', params.tag_contains)
      appendParam(url, 'tag.startswith', params.tag_startswith)
      appendParam(url, 'tag.endswith', params.tag_endswith)
      appendParam(url, 'include_shadow_metadata', params.include_shadow_metadata)
      appendParam(url, 'shadowed_by_name', params.shadowed_by_name)
      appendParam(url, 'shadowing_name', params.shadowing_name)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const raw = data.result
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        records: rows.map((row) => mapCloudflareFields(row, DNS_RECORD_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list dns records') } : {}),
    }
  },
  outputs: {
    records: {
      type: 'array',
      description: 'Records',
      items: { type: 'object', properties: DNS_RECORD_OUTPUTS },
    },
    total_count: {
      type: 'number',
      description:
        'Total matching resources, or the number of resources returned on this page when the API omits a total',
    },
    result_info: {
      type: 'json',
      description: 'Pagination metadata returned by Cloudflare',
      nullable: true,
      properties: RESULT_INFO_OUTPUTS,
    },
  },
}
