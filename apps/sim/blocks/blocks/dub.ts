import { DubIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { DubResponse } from '@/tools/dub/types'

export const DubBlock: BlockConfig<DubResponse> = {
  type: 'dub',
  name: 'Dub',
  description: 'Link management with Dub',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Create, manage, and track short links with Dub. Supports custom domains, UTM parameters, link analytics, and more.',
  docsLink: 'https://docs.sim.ai/integrations/dub',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#181C1E',
  icon: DubIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Link', id: 'create_link' },
        { label: 'Upsert Link', id: 'upsert_link' },
        { label: 'Get Link', id: 'get_link' },
        { label: 'Update Link', id: 'update_link' },
        { label: 'Delete Link', id: 'delete_link' },
        { label: 'List Links', id: 'list_links' },
        { label: 'Count Links', id: 'get_links_count' },
        { label: 'Bulk Create Links', id: 'bulk_create_links' },
        { label: 'Bulk Update Links', id: 'bulk_update_links' },
        { label: 'Bulk Delete Links', id: 'bulk_delete_links' },
        { label: 'Get Analytics', id: 'get_analytics' },
        { label: 'List Events', id: 'get_events' },
        { label: 'Get QR Code', id: 'get_qr_code' },
        { label: 'List Domains', id: 'list_domains' },
        { label: 'List Tags', id: 'list_tags' },
        { label: 'Create Tag', id: 'create_tag' },
        { label: 'List Folders', id: 'list_folders' },
      ],
      value: () => 'create_link',
    },
    {
      id: 'url',
      title: 'Destination URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: ['create_link', 'upsert_link'] },
      required: { field: 'operation', value: ['create_link', 'upsert_link'] },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'dub.sh (default)',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'key',
      title: 'Custom Slug',
      type: 'short-input',
      placeholder: 'my-link (randomly generated if empty)',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Custom OG title',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Custom OG description',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Your database ID for this link',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'tagIds',
      title: 'Tag IDs',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'tenantId',
      title: 'Tenant ID',
      type: 'short-input',
      placeholder: 'ID of the tenant this link belongs to',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Folder to organize this link into',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'trackConversion',
      title: 'Track Conversions',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'comments',
      title: 'Comments',
      type: 'short-input',
      placeholder: 'Internal comments',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'expiresAt',
      title: 'Expires At',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2025-12-31T23:59:59Z)',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description. Return ONLY the timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the expiration (e.g., "in 30 days", "end of year")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Password to protect the link',
      password: true,
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_source',
      title: 'UTM Source',
      type: 'short-input',
      placeholder: 'e.g., twitter',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_medium',
      title: 'UTM Medium',
      type: 'short-input',
      placeholder: 'e.g., social',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_campaign',
      title: 'UTM Campaign',
      type: 'short-input',
      placeholder: 'e.g., summer-sale',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_term',
      title: 'UTM Term',
      type: 'short-input',
      placeholder: 'e.g., link-shortener',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_content',
      title: 'UTM Content',
      type: 'short-input',
      placeholder: 'e.g., header-cta',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'linkRewrite',
      title: 'Link Cloaking',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'linkArchived',
      title: 'Archived',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'linkId',
      title: 'Link ID',
      type: 'short-input',
      placeholder: 'Link ID or ext_<externalId>',
      condition: { field: 'operation', value: ['get_link', 'update_link', 'delete_link'] },
      required: { field: 'operation', value: ['update_link', 'delete_link'] },
    },
    {
      id: 'getLinkExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External ID from your database',
      condition: { field: 'operation', value: 'get_link' },
      mode: 'advanced',
    },
    {
      id: 'getLinkDomain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'dub.sh',
      condition: { field: 'operation', value: 'get_link' },
      mode: 'advanced',
    },
    {
      id: 'getLinkKey',
      title: 'Key',
      type: 'short-input',
      placeholder: 'Link slug',
      condition: { field: 'operation', value: 'get_link' },
      mode: 'advanced',
    },
    {
      id: 'updateUrl',
      title: 'New Destination URL',
      type: 'short-input',
      placeholder: 'https://example.com/new-page',
      condition: { field: 'operation', value: 'update_link' },
    },
    {
      id: 'listDomain',
      title: 'Filter by Domain',
      type: 'short-input',
      placeholder: 'dub.sh',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search links by slug or destination URL',
      condition: { field: 'operation', value: 'list_links' },
    },
    {
      id: 'listTagIds',
      title: 'Filter by Tag IDs',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'listTenantId',
      title: 'Filter by Tenant ID',
      type: 'short-input',
      placeholder: 'Tenant ID',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'listFolderId',
      title: 'Filter by Folder ID',
      type: 'short-input',
      placeholder: 'Folder ID',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'showArchived',
      title: 'Show Archived',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100 (max: 100)',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'startingAfter',
      title: 'Starting After (Cursor)',
      type: 'short-input',
      placeholder: 'Link ID to fetch results after',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'endingBefore',
      title: 'Ending Before (Cursor)',
      type: 'short-input',
      placeholder: 'Link ID to fetch results before',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'analyticsEvent',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { label: 'Clicks', id: 'clicks' },
        { label: 'Leads', id: 'leads' },
        { label: 'Sales', id: 'sales' },
        { label: 'Composite', id: 'composite' },
      ],
      value: () => 'clicks',
      condition: { field: 'operation', value: 'get_analytics' },
    },
    {
      id: 'analyticsGroupBy',
      title: 'Group By',
      type: 'dropdown',
      options: [
        { label: 'Count (total)', id: 'count' },
        { label: 'Timeseries', id: 'timeseries' },
        { label: 'Countries', id: 'countries' },
        { label: 'Cities', id: 'cities' },
        { label: 'Devices', id: 'devices' },
        { label: 'Browsers', id: 'browsers' },
        { label: 'OS', id: 'os' },
        { label: 'Referers', id: 'referers' },
        { label: 'Top Links', id: 'top_links' },
        { label: 'Top URLs', id: 'top_urls' },
      ],
      value: () => 'count',
      condition: { field: 'operation', value: 'get_analytics' },
    },
    {
      id: 'analyticsLinkId',
      title: 'Link ID',
      type: 'short-input',
      placeholder: 'Filter analytics by link ID',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'analyticsExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Filter by external ID (prefix with ext_)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'analyticsDomain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Filter by domain',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'analyticsInterval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: '24 Hours', id: '24h' },
        { label: '7 Days', id: '7d' },
        { label: '30 Days', id: '30d' },
        { label: '90 Days', id: '90d' },
        { label: '1 Year', id: '1y' },
        { label: 'Month to Date', id: 'mtd' },
        { label: 'Quarter to Date', id: 'qtd' },
        { label: 'Year to Date', id: 'ytd' },
        { label: 'All Time', id: 'all' },
      ],
      value: () => '24h',
      condition: { field: 'operation', value: 'get_analytics' },
    },
    {
      id: 'analyticsStart',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (overrides interval)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description. Return ONLY the timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the start date (e.g., "7 days ago", "start of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'analyticsEnd',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (defaults to now)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description. Return ONLY the timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "end of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'analyticsCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'ISO 3166-1 alpha-2 code (e.g., US)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'analyticsTimezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'IANA timezone (e.g., America/New_York)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'countSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search links by slug or destination URL',
      condition: { field: 'operation', value: 'get_links_count' },
    },
    {
      id: 'countDomain',
      title: 'Filter by Domain',
      type: 'short-input',
      placeholder: 'dub.sh',
      condition: { field: 'operation', value: 'get_links_count' },
      mode: 'advanced',
    },
    {
      id: 'countTagIds',
      title: 'Filter by Tag IDs',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs',
      condition: { field: 'operation', value: 'get_links_count' },
      mode: 'advanced',
    },
    {
      id: 'countTagNames',
      title: 'Filter by Tag Names',
      type: 'short-input',
      placeholder: 'Comma-separated tag names',
      condition: { field: 'operation', value: 'get_links_count' },
      mode: 'advanced',
    },
    {
      id: 'countFolderId',
      title: 'Filter by Folder ID',
      type: 'short-input',
      placeholder: 'Folder ID',
      condition: { field: 'operation', value: 'get_links_count' },
      mode: 'advanced',
    },
    {
      id: 'countShowArchived',
      title: 'Show Archived',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get_links_count' },
      mode: 'advanced',
    },
    {
      id: 'countGroupBy',
      title: 'Group By',
      type: 'dropdown',
      options: [
        { label: 'None (total)', id: '' },
        { label: 'Domain', id: 'domain' },
        { label: 'Tag', id: 'tagId' },
        { label: 'User', id: 'userId' },
        { label: 'Folder', id: 'folderId' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'get_links_count' },
      mode: 'advanced',
    },
    {
      id: 'bulkLinks',
      title: 'Links',
      type: 'code',
      language: 'json',
      placeholder: '[\n  { "url": "https://example.com", "key": "my-link" }\n]',
      condition: { field: 'operation', value: 'bulk_create_links' },
      required: { field: 'operation', value: 'bulk_create_links' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Dub link objects based on the user's description. Each object must include a "url" and may include "key", "domain", "tagIds" (array), and UTM fields. Return ONLY the JSON array - no explanations, no extra text.`,
        placeholder: 'Describe the links to create (e.g., "links for these 5 product pages")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'bulkUpdateLinkIds',
      title: 'Link IDs',
      type: 'short-input',
      placeholder: 'Comma-separated link IDs (required unless External IDs is set)',
      condition: { field: 'operation', value: 'bulk_update_links' },
    },
    {
      id: 'bulkUpdateExternalIds',
      title: 'External IDs',
      type: 'short-input',
      placeholder: 'Comma-separated external IDs (used if no link IDs)',
      condition: { field: 'operation', value: 'bulk_update_links' },
      mode: 'advanced',
    },
    {
      id: 'bulkUpdateData',
      title: 'Update Data',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "archived": true,\n  "tagIds": ["tag_123"]\n}',
      condition: { field: 'operation', value: 'bulk_update_links' },
      required: { field: 'operation', value: 'bulk_update_links' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of Dub link fields to update based on the user's description (e.g. archived, tagIds, expiresAt, comments, UTM fields). Return ONLY the JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the changes to apply (e.g., "archive them and add the Q3 tag")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'bulkDeleteLinkIds',
      title: 'Link IDs',
      type: 'short-input',
      placeholder: 'Comma-separated link IDs (max 100)',
      condition: { field: 'operation', value: 'bulk_delete_links' },
      required: { field: 'operation', value: 'bulk_delete_links' },
    },
    {
      id: 'eventsEvent',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { label: 'Clicks', id: 'clicks' },
        { label: 'Leads', id: 'leads' },
        { label: 'Sales', id: 'sales' },
      ],
      value: () => 'clicks',
      condition: { field: 'operation', value: 'get_events' },
    },
    {
      id: 'eventsLinkId',
      title: 'Link ID',
      type: 'short-input',
      placeholder: 'Filter events by link ID',
      condition: { field: 'operation', value: 'get_events' },
    },
    {
      id: 'eventsExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Filter by external ID (prefix with ext_)',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
    },
    {
      id: 'eventsDomain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Filter by domain',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
    },
    {
      id: 'eventsInterval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: '24 Hours', id: '24h' },
        { label: '7 Days', id: '7d' },
        { label: '30 Days', id: '30d' },
        { label: '90 Days', id: '90d' },
        { label: '1 Year', id: '1y' },
        { label: 'Month to Date', id: 'mtd' },
        { label: 'Quarter to Date', id: 'qtd' },
        { label: 'Year to Date', id: 'ytd' },
        { label: 'All Time', id: 'all' },
      ],
      value: () => '24h',
      condition: { field: 'operation', value: 'get_events' },
    },
    {
      id: 'eventsStart',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (overrides interval)',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description. Return ONLY the timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the start date (e.g., "7 days ago", "start of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'eventsEnd',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (defaults to now)',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description. Return ONLY the timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "end of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'eventsCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'ISO 3166-1 alpha-2 code (e.g., US)',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
    },
    {
      id: 'eventsTimezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'IANA timezone (e.g., America/New_York)',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
    },
    {
      id: 'eventsSortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'desc' },
        { label: 'Ascending', id: 'asc' },
      ],
      value: () => 'desc',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
    },
    {
      id: 'eventsPage',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
    },
    {
      id: 'eventsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100 (max: 1000)',
      condition: { field: 'operation', value: 'get_events' },
      mode: 'advanced',
    },
    {
      id: 'qrUrl',
      title: 'Short Link URL',
      type: 'short-input',
      placeholder: 'https://dub.sh/my-link',
      condition: { field: 'operation', value: 'get_qr_code' },
      required: { field: 'operation', value: 'get_qr_code' },
    },
    {
      id: 'qrLogo',
      title: 'Custom Logo URL',
      type: 'short-input',
      placeholder: 'https://example.com/logo.png (paid plans only)',
      condition: { field: 'operation', value: 'get_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'qrSize',
      title: 'Size (px)',
      type: 'short-input',
      placeholder: '600',
      condition: { field: 'operation', value: 'get_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'qrLevel',
      title: 'Error Correction',
      type: 'dropdown',
      options: [
        { label: 'Low (L)', id: 'L' },
        { label: 'Medium (M)', id: 'M' },
        { label: 'Quartile (Q)', id: 'Q' },
        { label: 'High (H)', id: 'H' },
      ],
      value: () => 'L',
      condition: { field: 'operation', value: 'get_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'qrFgColor',
      title: 'Foreground Color',
      type: 'short-input',
      placeholder: '#000000',
      condition: { field: 'operation', value: 'get_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'qrBgColor',
      title: 'Background Color',
      type: 'short-input',
      placeholder: '#FFFFFF',
      condition: { field: 'operation', value: 'get_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'qrHideLogo',
      title: 'Hide Logo',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'qrMargin',
      title: 'Margin',
      type: 'short-input',
      placeholder: '2',
      condition: { field: 'operation', value: 'get_qr_code' },
      mode: 'advanced',
    },
    {
      id: 'domainsSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search by domain name',
      condition: { field: 'operation', value: 'list_domains' },
    },
    {
      id: 'domainsArchived',
      title: 'Include Archived',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_domains' },
      mode: 'advanced',
    },
    {
      id: 'domainsPage',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'list_domains' },
      mode: 'advanced',
    },
    {
      id: 'domainsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '50 (max: 100)',
      condition: { field: 'operation', value: 'list_domains' },
      mode: 'advanced',
    },
    {
      id: 'tagsSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search by tag name',
      condition: { field: 'operation', value: 'list_tags' },
    },
    {
      id: 'tagsSortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Name', id: 'name' },
        { label: 'Created At', id: 'createdAt' },
      ],
      value: () => 'name',
      condition: { field: 'operation', value: 'list_tags' },
      mode: 'advanced',
    },
    {
      id: 'tagsSortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      value: () => 'asc',
      condition: { field: 'operation', value: 'list_tags' },
      mode: 'advanced',
    },
    {
      id: 'tagsPage',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'list_tags' },
      mode: 'advanced',
    },
    {
      id: 'tagsPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100 (max: 100)',
      condition: { field: 'operation', value: 'list_tags' },
      mode: 'advanced',
    },
    {
      id: 'tagName',
      title: 'Tag Name',
      type: 'short-input',
      placeholder: 'e.g., Q3-campaign',
      condition: { field: 'operation', value: 'create_tag' },
      required: { field: 'operation', value: 'create_tag' },
    },
    {
      id: 'tagColor',
      title: 'Color',
      type: 'dropdown',
      options: [
        { label: 'Random', id: '' },
        { label: 'Red', id: 'red' },
        { label: 'Yellow', id: 'yellow' },
        { label: 'Green', id: 'green' },
        { label: 'Blue', id: 'blue' },
        { label: 'Purple', id: 'purple' },
        { label: 'Brown', id: 'brown' },
        { label: 'Gray', id: 'gray' },
        { label: 'Pink', id: 'pink' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_tag' },
      mode: 'advanced',
    },
    {
      id: 'foldersSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search by folder name',
      condition: { field: 'operation', value: 'list_folders' },
    },
    {
      id: 'foldersPage',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'list_folders' },
      mode: 'advanced',
    },
    {
      id: 'foldersPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '50 (max: 50)',
      condition: { field: 'operation', value: 'list_folders' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Dub API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'dub_create_link',
      'dub_upsert_link',
      'dub_get_link',
      'dub_update_link',
      'dub_delete_link',
      'dub_list_links',
      'dub_get_links_count',
      'dub_bulk_create_links',
      'dub_bulk_update_links',
      'dub_bulk_delete_links',
      'dub_get_analytics',
      'dub_get_events',
      'dub_get_qr_code',
      'dub_list_domains',
      'dub_list_tags',
      'dub_create_tag',
      'dub_list_folders',
    ],
    config: {
      tool: (params) => `dub_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        const isLinkMutation =
          params.operation === 'create_link' ||
          params.operation === 'upsert_link' ||
          params.operation === 'update_link'

        // The executor merges { ...inputs, ...transformedParams }, so a raw subBlock
        // id that shares its name with a tool param (e.g. 'domain', 'linkId') passes
        // through untouched unless explicitly cleared here. These fields are only
        // shown for the operations below; every other operation must null them out
        // so a value left over from a previous operation selection can't leak in.
        if (!isLinkMutation) {
          result.domain = undefined
          result.key = undefined
          result.title = undefined
          result.description = undefined
          result.externalId = undefined
          result.tagIds = undefined
          result.tenantId = undefined
          result.folderId = undefined
          result.trackConversion = undefined
        }
        if (params.operation !== 'create_link' && params.operation !== 'upsert_link') {
          result.url = undefined
        }
        if (
          params.operation !== 'get_link' &&
          params.operation !== 'update_link' &&
          params.operation !== 'delete_link'
        ) {
          result.linkId = undefined
        }
        if (params.operation !== 'list_links') {
          result.search = undefined
          result.showArchived = undefined
          result.page = undefined
          result.pageSize = undefined
        }

        if (isLinkMutation) {
          if (params.linkRewrite === 'true') result.rewrite = true
          if (params.linkArchived === 'true') result.archived = true
          if (params.tenantId) result.tenantId = params.tenantId
          if (params.folderId) result.folderId = params.folderId
          // Only ever send `true` or omit — an explicit `false` on update_link would
          // silently disable conversion tracking on links that already had it enabled,
          // since Dub's update is a partial PATCH (matches linkRewrite/linkArchived).
          result.trackConversion = params.trackConversion === 'true' ? true : undefined
        }
        if (params.operation === 'get_link') {
          if (params.getLinkExternalId) result.externalId = params.getLinkExternalId
          if (params.getLinkDomain) result.domain = params.getLinkDomain
          if (params.getLinkKey) result.key = params.getLinkKey
        }
        if (params.operation === 'update_link' && params.updateUrl) {
          result.url = params.updateUrl
        }
        if (params.operation === 'list_links') {
          if (params.listDomain) result.domain = params.listDomain
          if (params.listTagIds) result.tagIds = params.listTagIds
          if (params.listTenantId) result.tenantId = params.listTenantId
          if (params.listFolderId) result.folderId = params.listFolderId
          if (params.showArchived && params.showArchived !== 'false') result.showArchived = true
          if (params.page) result.page = Number(params.page)
          if (params.pageSize) result.pageSize = Number(params.pageSize)
          if (params.startingAfter) result.startingAfter = params.startingAfter
          if (params.endingBefore) result.endingBefore = params.endingBefore
        }
        if (params.operation === 'get_analytics') {
          if (params.analyticsEvent) result.event = params.analyticsEvent
          if (params.analyticsGroupBy) result.groupBy = params.analyticsGroupBy
          if (params.analyticsLinkId) result.linkId = params.analyticsLinkId
          if (params.analyticsExternalId) result.externalId = params.analyticsExternalId
          if (params.analyticsDomain) result.domain = params.analyticsDomain
          if (params.analyticsInterval) result.interval = params.analyticsInterval
          if (params.analyticsStart) result.start = params.analyticsStart
          if (params.analyticsEnd) result.end = params.analyticsEnd
          if (params.analyticsCountry) result.country = params.analyticsCountry
          if (params.analyticsTimezone) result.timezone = params.analyticsTimezone
        }
        if (params.operation === 'get_links_count') {
          if (params.countSearch) result.search = params.countSearch
          if (params.countDomain) result.domain = params.countDomain
          if (params.countTagIds) result.tagIds = params.countTagIds
          if (params.countTagNames) result.tagNames = params.countTagNames
          if (params.countFolderId) result.folderId = params.countFolderId
          if (params.countShowArchived === 'true') result.showArchived = true
          if (params.countGroupBy) result.groupBy = params.countGroupBy
        }
        if (params.operation === 'bulk_create_links') {
          if (params.bulkLinks) result.links = params.bulkLinks
        }
        if (params.operation === 'bulk_update_links') {
          if (params.bulkUpdateLinkIds) result.linkIds = params.bulkUpdateLinkIds
          if (params.bulkUpdateExternalIds) result.externalIds = params.bulkUpdateExternalIds
          if (params.bulkUpdateData) result.data = params.bulkUpdateData
        }
        if (params.operation === 'bulk_delete_links') {
          if (params.bulkDeleteLinkIds) result.linkIds = params.bulkDeleteLinkIds
        }
        if (params.operation === 'get_events') {
          if (params.eventsEvent) result.event = params.eventsEvent
          if (params.eventsLinkId) result.linkId = params.eventsLinkId
          if (params.eventsExternalId) result.externalId = params.eventsExternalId
          if (params.eventsDomain) result.domain = params.eventsDomain
          if (params.eventsInterval) result.interval = params.eventsInterval
          if (params.eventsStart) result.start = params.eventsStart
          if (params.eventsEnd) result.end = params.eventsEnd
          if (params.eventsCountry) result.country = params.eventsCountry
          if (params.eventsTimezone) result.timezone = params.eventsTimezone
          if (params.eventsSortOrder) result.sortOrder = params.eventsSortOrder
          if (params.eventsPage) result.page = Number(params.eventsPage)
          if (params.eventsLimit) result.limit = Number(params.eventsLimit)
        }
        if (params.operation === 'get_qr_code') {
          if (params.qrUrl) result.url = params.qrUrl
          if (params.qrLogo) result.logo = params.qrLogo
          if (params.qrSize) result.size = Number(params.qrSize)
          if (params.qrLevel) result.level = params.qrLevel
          if (params.qrFgColor) result.fgColor = params.qrFgColor
          if (params.qrBgColor) result.bgColor = params.qrBgColor
          if (params.qrHideLogo === 'true') result.hideLogo = true
          if (params.qrMargin) result.margin = Number(params.qrMargin)
        }
        if (params.operation === 'list_domains') {
          if (params.domainsSearch) result.search = params.domainsSearch
          if (params.domainsArchived === 'true') result.archived = true
          if (params.domainsPage) result.page = Number(params.domainsPage)
          if (params.domainsPageSize) result.pageSize = Number(params.domainsPageSize)
        }
        if (params.operation === 'list_tags') {
          if (params.tagsSearch) result.search = params.tagsSearch
          if (params.tagsSortBy) result.sortBy = params.tagsSortBy
          if (params.tagsSortOrder) result.sortOrder = params.tagsSortOrder
          if (params.tagsPage) result.page = Number(params.tagsPage)
          if (params.tagsPageSize) result.pageSize = Number(params.tagsPageSize)
        }
        if (params.operation === 'create_tag') {
          if (params.tagName) result.name = params.tagName
          if (params.tagColor) result.color = params.tagColor
        }
        if (params.operation === 'list_folders') {
          if (params.foldersSearch) result.search = params.foldersSearch
          if (params.foldersPage) result.page = Number(params.foldersPage)
          if (params.foldersPageSize) result.pageSize = Number(params.foldersPageSize)
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Dub API key' },
    url: { type: 'string', description: 'Destination URL for the short link' },
    linkId: { type: 'string', description: 'Link ID for get/update/delete operations' },
    domain: { type: 'string', description: 'Custom domain for the short link' },
    key: { type: 'string', description: 'Custom slug for the short link' },
    search: { type: 'string', description: 'Search query for listing links' },
    links: { type: 'json', description: 'JSON array of link objects for bulk create' },
    data: { type: 'json', description: 'JSON object of fields to apply for bulk update' },
    linkIds: { type: 'string', description: 'Comma-separated link IDs for bulk operations' },
  },
  outputs: {
    id: { type: 'string', description: 'Link ID, or Tag ID for Create Tag' },
    domain: { type: 'string', description: 'Domain of the short link' },
    key: { type: 'string', description: 'Slug of the short link' },
    url: { type: 'string', description: 'Destination URL' },
    shortLink: { type: 'string', description: 'Full short link URL' },
    qrCode: { type: 'string', description: 'QR code URL' },
    archived: { type: 'boolean', description: 'Whether the link is archived' },
    externalId: { type: 'string', description: 'External ID' },
    title: { type: 'string', description: 'OG title' },
    description: { type: 'string', description: 'OG description' },
    tags: {
      type: 'json',
      description:
        'Tags assigned to the link (id, name, color), or the full array of workspace tags for List Tags',
    },
    folderId: { type: 'string', description: 'Folder the link is organized into' },
    tenantId: { type: 'string', description: 'Tenant ID associated with the link' },
    trackConversion: { type: 'boolean', description: 'Whether conversion tracking is enabled' },
    clicks: { type: 'number', description: 'Number of clicks' },
    leads: { type: 'number', description: 'Number of leads' },
    conversions: { type: 'number', description: 'Number of conversions' },
    sales: { type: 'number', description: 'Number of sales' },
    saleAmount: { type: 'number', description: 'Total sale amount in cents' },
    lastClicked: { type: 'string', description: 'Last clicked timestamp' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    utm_source: { type: 'string', description: 'UTM source parameter' },
    utm_medium: { type: 'string', description: 'UTM medium parameter' },
    utm_campaign: { type: 'string', description: 'UTM campaign parameter' },
    utm_term: { type: 'string', description: 'UTM term parameter' },
    utm_content: { type: 'string', description: 'UTM content parameter' },
    links: {
      type: 'json',
      description: 'Array of links (id, domain, key, url, shortLink, clicks, tags, createdAt)',
    },
    count: { type: 'number', description: 'Number of items returned (list/count/events/bulk)' },
    data: {
      type: 'json',
      description: 'Grouped analytics data (timeseries, countries, devices, etc.)',
    },
    groups: {
      type: 'json',
      description: 'Per-group link counts when Count Links uses groupBy ([{ field, count }])',
    },
    events: {
      type: 'json',
      description: 'Array of events (event, timestamp, click, link, customer/sale data)',
    },
    created: {
      type: 'json',
      description: 'Bulk create: array of successfully created link objects',
    },
    errors: {
      type: 'json',
      description: 'Bulk create: array of per-link errors ({ link, error, code })',
    },
    updated: {
      type: 'json',
      description: 'Bulk update: array of updated link objects',
    },
    deletedCount: { type: 'number', description: 'Bulk delete: number of links deleted' },
    file: { type: 'file', description: 'QR code image (PNG) stored in execution files' },
    content: { type: 'string', description: 'QR code as base64-encoded PNG data' },
    domains: {
      type: 'json',
      description: 'List Domains: array of domain objects (slug, verified, primary, archived)',
      condition: { field: 'operation', value: 'list_domains' },
    },
    folders: {
      type: 'json',
      description: 'List Folders: array of folder objects (id, name, accessLevel)',
      condition: { field: 'operation', value: 'list_folders' },
    },
    name: {
      type: 'string',
      description: 'Create Tag: name of the created tag',
      condition: { field: 'operation', value: 'create_tag' },
    },
    color: {
      type: 'string',
      description: 'Create Tag: color assigned to the created tag',
      condition: { field: 'operation', value: 'create_tag' },
    },
  },
}

export const DubBlockMeta = {
  tags: ['link-management', 'marketing', 'data-analytics'],
  url: 'https://dub.co',
  templates: [
    {
      icon: DubIcon,
      title: 'Dub short link factory',
      prompt:
        'Build a workflow that takes a destination URL and campaign metadata, creates a tracked short link in Dub with UTM parameters and a custom slug, stores the link in a table, and returns it to the caller for use in outreach and marketing.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: DubIcon,
      title: 'Campaign link batcher',
      prompt:
        'Create a workflow that reads a table of campaign destinations, upserts a Dub short link for each row with consistent UTM tags, writes the resulting short URL back into the table, and posts a Slack confirmation summarizing how many links were created or refreshed.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DubIcon,
      title: 'Dub analytics digest',
      prompt:
        'Build a scheduled weekly workflow that pulls Dub link analytics — clicks, leads, sales, and top referrers — for active campaigns, writes a narrative summary highlighting winners and decliners, and delivers the digest to Slack with deep links into the Dub dashboard.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DubIcon,
      title: 'Short link hygiene auditor',
      prompt:
        'Create a scheduled monthly workflow that lists all Dub links, checks each destination for 4xx and 5xx responses, flags broken links in a table, and emails the marketing team a remediation list so dead campaign links never go live.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: DubIcon,
      title: 'Outbound link personalizer',
      prompt:
        'Build a workflow that reads a leads table, generates a per-lead Dub short link with the lead identifier in UTM and metadata, attaches the personalized link to the outreach email body, and tracks delivery in the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: DubIcon,
      title: 'Release announcement linker',
      prompt:
        'Create a workflow triggered by a GitHub release that creates a Dub short link for the release notes URL, posts the short link to the marketing Slack channel, and stores the mapping of release tag to short link in a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'devops', 'automation'],
      alsoIntegrations: ['github', 'slack'],
    },
    {
      icon: DubIcon,
      title: 'Top-converting links report',
      prompt:
        'Build a scheduled monthly workflow that pulls Dub analytics grouped by link, ranks top performers by leads and sales, identifies underperformers, writes a narrative report file with recommendations, and shares it with marketing leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'create-tracked-short-link',
      description:
        'Create a Dub short link for a destination URL with UTM parameters and an optional custom slug.',
      content:
        '# Create Tracked Short Link\n\nTurn a long destination URL into a branded, trackable Dub short link.\n\n## Steps\n1. Take the destination URL and any campaign metadata (source, medium, campaign name).\n2. Call Create Link with the URL. Set the UTM source, medium, and campaign fields so clicks attribute correctly, and set a custom slug when a memorable link is wanted.\n3. Add a custom domain, title, or tag IDs if the request specifies them.\n\n## Output\nReturn the full short link URL, its slug, the destination, and the QR code URL. Confirm which UTM parameters were applied.',
    },
    {
      name: 'report-link-analytics',
      description:
        'Pull Dub click, lead, and sales analytics for a link or campaign over a time window.',
      content:
        '# Report Link Analytics\n\nSummarize how a Dub short link or campaign is performing.\n\n## Steps\n1. Choose the Get Analytics operation. Set the event type (clicks, leads, sales, or composite) the request cares about.\n2. Scope to a specific link via link ID or external ID, or to a domain for a whole campaign. Set the interval (e.g., 7d, 30d) or explicit start and end dates.\n3. Set group-by to break results down by country, device, referrer, or top links when a breakdown is asked for; otherwise use count for totals.\n\n## Output\nReport the headline metrics (clicks, leads, sales, revenue) and, when grouped, the top segments. Call out notable winners and decliners versus the prior period when comparison data is available.',
    },
    {
      name: 'batch-create-campaign-links',
      description:
        'Upsert a Dub short link for each row in a list of destinations with consistent UTM tagging.',
      content:
        '# Batch Create Campaign Links\n\nGenerate consistent tracked links for many destinations at once.\n\n## Steps\n1. For each destination URL in the list, build the UTM parameters and slug from the row data so tagging is uniform across the batch.\n2. Use Upsert Link (keyed on external ID or slug) so re-runs refresh rather than duplicate existing links.\n3. Collect the resulting short link for each row.\n\n## Output\nReturn a table mapping each destination to its short link and external ID. Report how many links were created versus refreshed, and flag any rows that failed.',
    },
    {
      name: 'audit-existing-links',
      description:
        'List Dub links and check each destination for broken or stale URLs to flag for cleanup.',
      content:
        '# Audit Existing Links\n\nReview existing Dub links to catch broken or outdated destinations.\n\n## Steps\n1. Call List Links, optionally filtered by domain or tag IDs, paginating until all links are retrieved.\n2. For each link, inspect the destination URL and check it for 4xx or 5xx responses or obviously stale targets.\n3. Note links with low or zero clicks over a long period as candidates for archiving.\n\n## Output\nReturn a remediation list: short link, destination, detected issue (broken, redirecting, stale), and a suggested action. Sort broken links first.',
    },
  ],
} as const satisfies BlockMeta
