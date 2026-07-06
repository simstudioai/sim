import { CloudflareIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { CloudflareResponse } from '@/tools/cloudflare/types'

export const CloudflareBlock: BlockConfig<CloudflareResponse> = {
  type: 'cloudflare',
  name: 'Cloudflare',
  description: 'Manage DNS, domains, certificates, and cache',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Cloudflare into the workflow. Manage zones (domains), DNS records, SSL/TLS certificates, zone settings, DNS analytics, and cache purging via the Cloudflare API.',
  docsLink: 'https://docs.sim.ai/integrations/cloudflare',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#F38020',
  icon: CloudflareIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Zones', id: 'list_zones' },
        { label: 'Get Zone Details', id: 'get_zone' },
        { label: 'Create Zone', id: 'create_zone' },
        { label: 'Delete Zone', id: 'delete_zone' },
        { label: 'List DNS Records', id: 'list_dns_records' },
        { label: 'Create DNS Record', id: 'create_dns_record' },
        { label: 'Update DNS Record', id: 'update_dns_record' },
        { label: 'Delete DNS Record', id: 'delete_dns_record' },
        { label: 'List Certificates', id: 'list_certificates' },
        { label: 'Get Zone Settings', id: 'get_zone_settings' },
        { label: 'Update Zone Setting', id: 'update_zone_setting' },
        { label: 'DNS Analytics', id: 'dns_analytics' },
        { label: 'Purge Cache', id: 'purge_cache' },
      ],
      value: () => 'list_zones',
    },

    // List Zones inputs
    {
      id: 'name',
      title: 'Domain Name',
      type: 'short-input',
      placeholder: 'Filter by domain (e.g., example.com)',
      condition: { field: 'operation', value: 'list_zones' },
      mode: 'advanced',
    },
    {
      id: 'status',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Active', id: 'active' },
        { label: 'Pending', id: 'pending' },
        { label: 'Initializing', id: 'initializing' },
        { label: 'Moved', id: 'moved' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_zones' },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (default: 1)',
      condition: { field: 'operation', value: 'list_zones' },
      mode: 'advanced',
    },
    {
      id: 'per_page',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Results per page (default: 20, max: 50)',
      condition: { field: 'operation', value: 'list_zones' },
      mode: 'advanced',
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Filter by account ID',
      condition: { field: 'operation', value: 'list_zones' },
      mode: 'advanced',
    },
    {
      id: 'order',
      title: 'Sort Field',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Name', id: 'name' },
        { label: 'Status', id: 'status' },
        { label: 'Account ID', id: 'account.id' },
        { label: 'Account Name', id: 'account.name' },
        { label: 'Plan ID', id: 'plan.id' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_zones' },
      mode: 'advanced',
    },
    {
      id: 'direction',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_zones' },
      mode: 'advanced',
    },
    {
      id: 'match',
      title: 'Match Logic',
      type: 'dropdown',
      options: [
        { label: 'All (default)', id: '' },
        { label: 'Any', id: 'any' },
        { label: 'All', id: 'all' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_zones' },
      mode: 'advanced',
    },

    // Create Zone inputs
    {
      id: 'name',
      title: 'Domain Name',
      type: 'short-input',
      required: true,
      placeholder: 'e.g., example.com',
      condition: { field: 'operation', value: 'create_zone' },
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Cloudflare account ID',
      condition: { field: 'operation', value: 'create_zone' },
    },
    {
      id: 'zoneType',
      title: 'Zone Type',
      type: 'dropdown',
      options: [
        { label: 'Full (Cloudflare DNS)', id: 'full' },
        { label: 'Partial (CNAME Setup)', id: 'partial' },
        { label: 'Secondary (Secondary DNS)', id: 'secondary' },
      ],
      value: () => 'full',
      condition: { field: 'operation', value: 'create_zone' },
      mode: 'advanced',
    },
    // Get Zone inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'get_zone' },
    },

    // Delete Zone inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID to delete',
      condition: { field: 'operation', value: 'delete_zone' },
    },

    // List DNS Records inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'list_dns_records' },
    },
    {
      id: 'type',
      title: 'Record Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'A', id: 'A' },
        { label: 'AAAA', id: 'AAAA' },
        { label: 'CNAME', id: 'CNAME' },
        { label: 'MX', id: 'MX' },
        { label: 'TXT', id: 'TXT' },
        { label: 'NS', id: 'NS' },
        { label: 'SRV', id: 'SRV' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'name',
      title: 'Name Filter',
      type: 'short-input',
      placeholder: 'Filter by record name (exact match)',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'content',
      title: 'Content Filter',
      type: 'short-input',
      placeholder: 'Filter by record content (exact match)',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'direction',
      title: 'Sort Direction',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'match',
      title: 'Match Logic',
      type: 'dropdown',
      options: [
        { label: 'All (default)', id: '' },
        { label: 'Any', id: 'any' },
        { label: 'All', id: 'all' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'order',
      title: 'Sort Field',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Type', id: 'type' },
        { label: 'Name', id: 'name' },
        { label: 'Content', id: 'content' },
        { label: 'TTL', id: 'ttl' },
        { label: 'Proxied', id: 'proxied' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'proxied',
      title: 'Proxied Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Proxied Only', id: 'true' },
        { label: 'DNS Only', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Free-text search across record properties',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'tag',
      title: 'Tag Filter',
      type: 'short-input',
      placeholder: 'Exact tag name to filter by',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'tag_match',
      title: 'Tag Match Logic',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Any', id: 'any' },
        { label: 'All', id: 'all' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'commentFilter',
      title: 'Comment Filter',
      type: 'short-input',
      placeholder: 'Filter by comment content (substring match)',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (default: 1)',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },
    {
      id: 'per_page',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Results per page (default: 100, max: 5000000)',
      condition: { field: 'operation', value: 'list_dns_records' },
      mode: 'advanced',
    },

    // Create DNS Record inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'create_dns_record' },
    },
    {
      id: 'type',
      title: 'Record Type',
      type: 'dropdown',
      options: [
        { label: 'A', id: 'A' },
        { label: 'AAAA', id: 'AAAA' },
        { label: 'CNAME', id: 'CNAME' },
        { label: 'MX', id: 'MX' },
        { label: 'TXT', id: 'TXT' },
        { label: 'NS', id: 'NS' },
        { label: 'SRV', id: 'SRV' },
      ],
      value: () => 'A',
      condition: { field: 'operation', value: 'create_dns_record' },
    },
    {
      id: 'name',
      title: 'Record Name',
      type: 'short-input',
      required: true,
      placeholder: 'e.g., example.com or sub.example.com',
      condition: { field: 'operation', value: 'create_dns_record' },
    },
    {
      id: 'content',
      title: 'Record Content',
      type: 'short-input',
      required: true,
      placeholder: 'e.g., 192.0.2.1 or target.example.com',
      condition: { field: 'operation', value: 'create_dns_record' },
    },
    {
      id: 'ttl',
      title: 'TTL (seconds)',
      type: 'short-input',
      placeholder: '1 (automatic)',
      condition: { field: 'operation', value: 'create_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'proxied',
      title: 'Proxied',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'create_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'MX/SRV priority (e.g., 10)',
      condition: { field: 'operation', value: 'create_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'short-input',
      placeholder: 'Optional comment',
      condition: { field: 'operation', value: 'create_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags (e.g., production,web)',
      condition: { field: 'operation', value: 'create_dns_record' },
      mode: 'advanced',
    },

    // Update DNS Record inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'update_dns_record' },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter DNS record ID',
      condition: { field: 'operation', value: 'update_dns_record' },
    },
    {
      id: 'type',
      title: 'Record Type',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'A', id: 'A' },
        { label: 'AAAA', id: 'AAAA' },
        { label: 'CNAME', id: 'CNAME' },
        { label: 'MX', id: 'MX' },
        { label: 'TXT', id: 'TXT' },
        { label: 'NS', id: 'NS' },
        { label: 'SRV', id: 'SRV' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'name',
      title: 'Record Name',
      type: 'short-input',
      placeholder: 'e.g., example.com or sub.example.com',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'content',
      title: 'New Content',
      type: 'short-input',
      placeholder: 'e.g., 192.0.2.1',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'ttl',
      title: 'TTL (seconds)',
      type: 'short-input',
      placeholder: '1 (automatic)',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'proxied',
      title: 'Proxied',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'MX/SRV priority (e.g., 10)',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'short-input',
      placeholder: 'Optional comment',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags (e.g., production,web)',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },

    // Delete DNS Record inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'delete_dns_record' },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter DNS record ID to delete',
      condition: { field: 'operation', value: 'delete_dns_record' },
    },

    // List Certificates inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'list_certificates' },
    },
    {
      id: 'status',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Active', id: 'active' },
        { label: 'Pending', id: 'pending' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_certificates' },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (default: 1)',
      condition: { field: 'operation', value: 'list_certificates' },
      mode: 'advanced',
    },
    {
      id: 'per_page',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Results per page (default: 20, min: 5, max: 50)',
      condition: { field: 'operation', value: 'list_certificates' },
      mode: 'advanced',
    },
    {
      id: 'deploy',
      title: 'Environment',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Production', id: 'production' },
        { label: 'Staging', id: 'staging' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_certificates' },
      mode: 'advanced',
    },

    // Get Zone Settings inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'get_zone_settings' },
    },

    // Update Zone Setting inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'update_zone_setting' },
    },
    {
      id: 'settingId',
      title: 'Setting',
      type: 'dropdown',
      options: [
        { label: 'SSL Mode', id: 'ssl' },
        { label: 'Always Use HTTPS', id: 'always_use_https' },
        { label: 'Security Level', id: 'security_level' },
        { label: 'Cache Level', id: 'cache_level' },
        { label: 'Browser Cache TTL', id: 'browser_cache_ttl' },
        { label: 'Rocket Loader', id: 'rocket_loader' },
        { label: 'Email Obfuscation', id: 'email_obfuscation' },
        { label: 'Hotlink Protection', id: 'hotlink_protection' },
        { label: 'IP Geolocation', id: 'ip_geolocation' },
        { label: 'HTTP/2', id: 'http2' },
        { label: 'HTTP/3', id: 'http3' },
        { label: 'WebSockets', id: 'websockets' },
        { label: 'TLS 1.3', id: 'tls_1_3' },
        { label: 'Minimum TLS Version', id: 'min_tls_version' },
      ],
      value: () => 'ssl',
      condition: { field: 'operation', value: 'update_zone_setting' },
    },
    {
      id: 'value',
      title: 'Value',
      type: 'short-input',
      required: true,
      placeholder: 'e.g., full, strict, on, off, medium',
      condition: { field: 'operation', value: 'update_zone_setting' },
      wandConfig: {
        enabled: true,
        prompt: `Generate the correct value for a Cloudflare zone setting based on the user's description.

Common settings and their valid values:
- ssl: "off", "flexible", "full", "strict"
- always_use_https: "on", "off"
- security_level: "off", "essentially_off", "low", "medium", "high", "under_attack"
- cache_level: "aggressive", "basic", "simplified"
- browser_cache_ttl: number in seconds (e.g., 14400 for 4 hours, 86400 for 1 day)
- rocket_loader: "on", "off"
- email_obfuscation: "on", "off"
- hotlink_protection: "on", "off"
- ip_geolocation: "on", "off"
- http2: "on", "off"
- http3: "on", "off"
- websockets: "on", "off"
- tls_1_3: "on", "off", "zrt"
- min_tls_version: "1.0", "1.1", "1.2", "1.3"

For simple string/boolean settings, return the plain value (e.g., "full", "on").
For numeric settings like browser_cache_ttl, return the number (e.g., 14400).

Return ONLY the value - no explanations, no extra text.`,
        placeholder:
          'Describe the setting value (e.g., "enable strict SSL", "cache everything")...',
      },
    },

    // DNS Analytics inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'dns_analytics' },
    },
    {
      id: 'since',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601 or relative (e.g., 2024-01-01T00:00:00Z or -6h)',
      condition: { field: 'operation', value: 'dns_analytics' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a timestamp or relative time expression for the Cloudflare DNS Analytics API based on the user's description.
Cloudflare accepts either ISO 8601 timestamps (e.g., 2024-01-01T00:00:00Z) or relative expressions (e.g., -6h, -7d, -30d).
Examples:
- "last 6 hours" -> -6h
- "last 24 hours" -> -24h
- "last 7 days" -> -7d
- "last 30 days" -> -30d
- "since January 1st 2024" -> 2024-01-01T00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z
- "1 hour ago" -> -1h

Return ONLY the timestamp or relative expression - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start time (e.g., "last 7 days", "since January 1st")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'until',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601 or relative (e.g., 2024-01-31T23:59:59Z or now)',
      condition: { field: 'operation', value: 'dns_analytics' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a timestamp or relative time expression for the Cloudflare DNS Analytics API based on the user's description.
Cloudflare accepts either ISO 8601 timestamps (e.g., 2024-01-31T23:59:59Z) or relative expressions (e.g., now).
Examples:
- "now" -> now
- "today" -> Today's date at 23:59:59Z
- "end of yesterday" -> Yesterday's date at 23:59:59Z
- "end of last month" -> Last day of previous month at 23:59:59Z

Return ONLY the timestamp or relative expression - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end time (e.g., "now", "end of yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'metrics',
      title: 'Metrics',
      type: 'short-input',
      placeholder: 'Comma-separated (e.g., queryCount,uncachedCount,responseTimeAvg)',
      required: { field: 'operation', value: 'dns_analytics' },
      condition: { field: 'operation', value: 'dns_analytics' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Cloudflare DNS Analytics metrics based on the user's description.

Available metrics:
- queryCount: Total number of DNS queries
- uncachedCount: Number of DNS queries not served from cache
- staleCount: Number of stale DNS responses served
- responseTimeAvg: Average response time in milliseconds
- responseTimeMedian: Median response time in milliseconds
- responseTime90th: 90th percentile response time
- responseTime99th: 99th percentile response time

Examples:
- "query counts" -> queryCount
- "all query metrics" -> queryCount,uncachedCount,staleCount
- "response times" -> responseTimeAvg,responseTimeMedian,responseTime90th,responseTime99th
- "everything" -> queryCount,uncachedCount,staleCount,responseTimeAvg,responseTimeMedian,responseTime90th,responseTime99th

Return ONLY the comma-separated metric names - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe what to measure (e.g., "query counts and response times")...',
      },
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'short-input',
      placeholder: 'Comma-separated (e.g., queryName,queryType,responseCode)',
      condition: { field: 'operation', value: 'dns_analytics' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Cloudflare DNS Analytics dimensions based on the user's description.

Available dimensions:
- queryName: DNS record name being queried
- queryType: DNS query type (A, AAAA, CNAME, MX, etc.)
- responseCode: DNS response code (NOERROR, NXDOMAIN, SERVFAIL, etc.)
- responseCached: Whether the response was cached
- coloName: Cloudflare data center handling the query
- origin: Origin server
- dayOfWeek: Day of the week
- tcp: Whether the query used TCP
- ipVersion: IP version (4 or 6)

Examples:
- "by record type" -> queryType
- "by record name and type" -> queryName,queryType
- "by data center" -> coloName
- "by response code and cache status" -> responseCode,responseCached

Return ONLY the comma-separated dimension names - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe how to group results (e.g., "by record type and name")...',
      },
    },
    {
      id: 'filters',
      title: 'Filters',
      type: 'short-input',
      placeholder: 'e.g., queryType==A',
      condition: { field: 'operation', value: 'dns_analytics' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Cloudflare DNS Analytics filter expression based on the user's description.

Filter syntax: field==value or field!=value
Multiple filters can be combined with semicolons: field1==value1;field2==value2

Available filter fields:
- queryType: DNS record type (A, AAAA, CNAME, MX, TXT, NS, SRV, etc.)
- queryName: DNS record name
- responseCode: DNS response code (NOERROR, NXDOMAIN, SERVFAIL, REFUSED)
- responseCached: Whether cached (0 or 1)
- coloName: Data center name
- origin: Origin server

Examples:
- "only A records" -> queryType==A
- "only CNAME records" -> queryType==CNAME
- "failed queries" -> responseCode==SERVFAIL
- "non-existent domains" -> responseCode==NXDOMAIN
- "A records that weren't cached" -> queryType==A;responseCached==0
- "queries for example.com" -> queryName==example.com

Return ONLY the filter expression - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe what to filter (e.g., "only A records", "failed queries")...',
      },
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'e.g., +queryCount or -responseTimeAvg',
      condition: { field: 'operation', value: 'dns_analytics' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (e.g., 100)',
      condition: { field: 'operation', value: 'dns_analytics' },
      mode: 'advanced',
    },

    // Purge Cache inputs
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: { field: 'operation', value: 'purge_cache' },
    },
    {
      id: 'purge_everything',
      title: 'Purge Everything',
      type: 'dropdown',
      options: [
        { label: 'Yes - Purge All', id: 'true' },
        { label: 'No - Purge Specific', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'purge_cache' },
    },
    {
      id: 'files',
      title: 'Files to Purge',
      type: 'long-input',
      placeholder:
        'Comma-separated URLs (e.g., https://example.com/style.css, https://example.com/app.js)',
      condition: { field: 'operation', value: 'purge_cache' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of URLs to purge from Cloudflare's cache based on the user's description.

Each URL should be a full URL including the protocol (https://).
Examples:
- "the homepage and about page of example.com" -> https://example.com/, https://example.com/about
- "all CSS and JS files" -> https://example.com/style.css, https://example.com/app.js
- "the API endpoint" -> https://example.com/api/v1/data

Return ONLY the comma-separated URLs - no explanations, no extra text.`,
        placeholder: 'Describe what to purge (e.g., "homepage and CSS files")...',
      },
    },
    {
      id: 'tags',
      title: 'Cache Tags',
      type: 'short-input',
      placeholder: 'Comma-separated cache tags (Enterprise only)',
      condition: { field: 'operation', value: 'purge_cache' },
      mode: 'advanced',
    },
    {
      id: 'hosts',
      title: 'Hostnames',
      type: 'short-input',
      placeholder: 'Comma-separated hostnames (Enterprise only)',
      condition: { field: 'operation', value: 'purge_cache' },
      mode: 'advanced',
    },
    {
      id: 'prefixes',
      title: 'URL Prefixes',
      type: 'short-input',
      placeholder: 'Comma-separated URL prefixes (Enterprise only)',
      condition: { field: 'operation', value: 'purge_cache' },
      mode: 'advanced',
    },

    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Cloudflare API token',
      password: true,
    },
  ],
  tools: {
    access: [
      'cloudflare_list_zones',
      'cloudflare_get_zone',
      'cloudflare_create_zone',
      'cloudflare_delete_zone',
      'cloudflare_list_dns_records',
      'cloudflare_create_dns_record',
      'cloudflare_update_dns_record',
      'cloudflare_delete_dns_record',
      'cloudflare_list_certificates',
      'cloudflare_get_zone_settings',
      'cloudflare_update_zone_setting',
      'cloudflare_dns_analytics',
      'cloudflare_purge_cache',
    ],
    config: {
      tool: (params) => `cloudflare_${params.operation}`,
      params: (params) => {
        const result = { ...params }

        if (result.ttl) result.ttl = Number(result.ttl)
        if (result.priority) result.priority = Number(result.priority)
        if (result.limit) result.limit = Number(result.limit)
        if (result.page) result.page = Number(result.page)
        if (result.per_page) result.per_page = Number(result.per_page)

        if (result.proxied === 'true') result.proxied = true
        else if (result.proxied === 'false') result.proxied = false
        else if (result.proxied === '') result.proxied = undefined

        if (result.purge_everything === 'true') result.purge_everything = true
        else if (result.purge_everything === 'false') result.purge_everything = false

        if (result.type === '' && result.operation !== 'create_dns_record') {
          result.type = undefined
        }
        if (result.status === '') result.status = undefined
        if (result.order === '') result.order = undefined
        if (result.direction === '') result.direction = undefined
        if (result.match === '') result.match = undefined
        if (result.tag_match === '') result.tag_match = undefined
        if (result.deploy === '') result.deploy = undefined

        if (result.operation === 'update_dns_record') {
          if (result.content === '') result.content = undefined
          if (result.name === '') result.name = undefined
          if (result.comment === '') result.comment = undefined
        }

        if (result.operation === 'create_zone' && result.zoneType) {
          result.type = result.zoneType
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Cloudflare API token' },
    zoneId: { type: 'string', description: 'Zone ID' },
    accountId: { type: 'string', description: 'Cloudflare account ID' },
    zoneType: { type: 'string', description: 'Zone type (full, partial, or secondary)' },
    order: { type: 'string', description: 'Sort field for listing zones' },
    direction: { type: 'string', description: 'Sort direction (asc, desc)' },
    match: { type: 'string', description: 'Match logic for filters (any, all)' },
    recordId: { type: 'string', description: 'DNS record ID' },
    name: { type: 'string', description: 'Domain or record name' },
    type: { type: 'string', description: 'DNS record type' },
    content: { type: 'string', description: 'DNS record content' },
    ttl: { type: 'number', description: 'Time to live in seconds' },
    proxied: { type: 'boolean', description: 'Whether Cloudflare proxy is enabled' },
    priority: { type: 'number', description: 'Record priority (MX/SRV)' },
    comment: { type: 'string', description: 'Record comment' },
    search: { type: 'string', description: 'Free-text search across record properties' },
    tag: { type: 'string', description: 'Filter by an exact tag name' },
    tag_match: { type: 'string', description: 'Tag filter match logic (any, all)' },
    commentFilter: { type: 'string', description: 'Filter records by comment content' },
    settingId: { type: 'string', description: 'Zone setting ID' },
    value: { type: 'string', description: 'Setting value' },
    since: { type: 'string', description: 'Start date for analytics' },
    until: { type: 'string', description: 'End date for analytics' },
    metrics: { type: 'string', description: 'Comma-separated metrics to retrieve' },
    dimensions: { type: 'string', description: 'Comma-separated dimensions to group by' },
    filters: { type: 'string', description: 'Filters to apply (e.g., queryType==A)' },
    sort: { type: 'string', description: 'Sort order for results' },
    limit: { type: 'number', description: 'Maximum number of results' },
    status: { type: 'string', description: 'Status filter for zones or certificates' },
    page: { type: 'number', description: 'Page number for pagination' },
    per_page: { type: 'number', description: 'Number of results per page' },
    deploy: {
      type: 'string',
      description: 'Filter certificates by deployment environment (staging, production)',
    },
    purge_everything: { type: 'boolean', description: 'Purge all cached content' },
    files: { type: 'string', description: 'Comma-separated URLs to purge' },
    tags: { type: 'string', description: 'Comma-separated cache tags to purge (Enterprise only)' },
    hosts: { type: 'string', description: 'Comma-separated hostnames to purge (Enterprise only)' },
    prefixes: {
      type: 'string',
      description: 'Comma-separated URL prefixes to purge (Enterprise only)',
    },
  },
  outputs: {
    zones: { type: 'json', description: 'List of zones/domains' },
    records: { type: 'json', description: 'List of DNS records' },
    certificates: { type: 'json', description: 'List of SSL/TLS certificate packs' },
    settings: { type: 'json', description: 'List of zone settings' },
    totals: { type: 'json', description: 'Aggregate DNS analytics totals' },
    min: { type: 'json', description: 'Minimum values across the DNS analytics period' },
    max: { type: 'json', description: 'Maximum values across the DNS analytics period' },
    query: { type: 'json', description: 'Echo of the DNS analytics query parameters sent' },
    validation_errors: { type: 'json', description: 'Validation issues for certificate packs' },
    data: { type: 'json', description: 'Raw analytics data rows from the DNS analytics report' },
    data_lag: {
      type: 'number',
      description: 'Processing lag in seconds before analytics data becomes available',
    },
    rows: { type: 'number', description: 'Total number of rows in the DNS analytics result set' },
    id: { type: 'string', description: 'Resource ID' },
    zone_id: { type: 'string', description: 'Zone ID the record belongs to' },
    zone_name: { type: 'string', description: 'Zone domain name' },
    name: { type: 'string', description: 'Resource name' },
    status: { type: 'string', description: 'Resource status' },
    paused: { type: 'boolean', description: 'Whether the zone is paused' },
    type: { type: 'string', description: 'Zone or record type' },
    name_servers: { type: 'json', description: 'Assigned Cloudflare name servers' },
    original_name_servers: { type: 'json', description: 'Original registrar name servers' },
    plan: {
      type: 'json',
      description:
        'Zone plan information (id, name, price, currency, frequency, is_subscribed, legacy_id)',
    },
    account: { type: 'json', description: 'Account the zone belongs to (id, name)' },
    owner: { type: 'json', description: 'Zone owner information (id, name, type)' },
    activated_on: { type: 'string', description: 'ISO 8601 date when the zone was activated' },
    development_mode: {
      type: 'number',
      description: 'Seconds remaining in development mode (0 = off)',
    },
    meta: {
      type: 'json',
      description: 'Resource metadata (zone: cdn_only, dns_only, etc.; DNS record: source)',
    },
    vanity_name_servers: { type: 'json', description: 'Custom vanity name servers' },
    permissions: { type: 'json', description: 'User permissions for the zone' },
    content: { type: 'string', description: 'DNS record value (e.g., IP address)' },
    proxiable: { type: 'boolean', description: 'Whether the record can be proxied' },
    proxied: { type: 'boolean', description: 'Whether Cloudflare proxy is enabled' },
    ttl: { type: 'number', description: 'TTL in seconds (1 = automatic)' },
    locked: { type: 'boolean', description: 'Whether the record is locked' },
    priority: { type: 'number', description: 'Priority for MX and SRV records' },
    comment: { type: 'string', description: 'Record comment' },
    tags: { type: 'json', description: 'Tags associated with the record or cache tags to purge' },
    comment_modified_on: {
      type: 'string',
      description: 'ISO 8601 timestamp when the comment was last modified',
    },
    tags_modified_on: {
      type: 'string',
      description: 'ISO 8601 timestamp when tags were last modified',
    },
    created_on: { type: 'string', description: 'Creation date (ISO 8601)' },
    modified_on: { type: 'string', description: 'Last modified date (ISO 8601)' },
    value: { type: 'string', description: 'Setting value (complex values are JSON-stringified)' },
    editable: { type: 'boolean', description: 'Whether the setting can be modified' },
    time_remaining: { type: 'number', description: 'Seconds until setting can be modified again' },
    total_count: { type: 'number', description: 'Total count of results' },
  },
}

export const CloudflareBlockMeta = {
  tags: ['cloud', 'monitoring'],
  url: 'https://www.cloudflare.com',
  templates: [
    {
      icon: CloudflareIcon,
      title: 'Cloudflare DNS change tracker',
      prompt:
        'Create a scheduled workflow that pulls every Cloudflare DNS record for my zones each hour, diffs the snapshot against the previous run, logs added, removed, and modified records to a table, and posts a Slack alert when sensitive records like MX or NS change.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cache purge on deploy',
      prompt:
        'Build a workflow that fires when a Vercel deployment succeeds on production, purges the Cloudflare cache for the affected hostnames, verifies the new content is being served, and posts a confirmation message to Slack with the purged paths.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['vercel', 'slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'SSL and zone health check',
      prompt:
        'Create a scheduled weekly workflow that inspects every Cloudflare zone for SSL certificate status, security level, and zone settings drift, logs findings to a table, and opens Linear tickets for any zones that need attention.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'enterprise'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: CloudflareIcon,
      title: 'DNS analytics digest',
      prompt:
        'Build a scheduled workflow that pulls Cloudflare DNS analytics for the top zones every Monday, identifies query spikes, anomalies, and surges in particular record types, and emails a written analysis to the platform team with traffic graphs and recommendations.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'analysis'],
    },
    {
      icon: CloudflareIcon,
      title: 'Zone provisioning workflow',
      prompt:
        'Create a workflow that accepts a domain name from a form, creates a new Cloudflare zone, sets opinionated default DNS records and zone settings, generates the nameserver instructions, and posts the setup summary to Slack so the team can finalize delegation.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'DNS record bulk importer',
      prompt:
        'Build a workflow that reads a table of DNS records — name, type, content, TTL — validates each row, creates or updates the matching record in Cloudflare, and writes results back to the table so DNS changes are versioned and reviewable.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
    {
      icon: CloudflareIcon,
      title: 'Zone settings policy enforcer',
      prompt:
        'Create a scheduled workflow that reads a baseline of required Cloudflare zone settings from a knowledge base, compares it against every zone weekly, automatically reverts unauthorized changes, and emails a compliance report to security leadership.',
      modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'audit-dns-records',
      description:
        'Pull all DNS records for a Cloudflare zone and report on misconfigurations, dangling records, and sensitive record changes.',
      content:
        '# Audit Cloudflare DNS Records\n\nExport and review the DNS configuration for a zone to catch misconfigurations and risky records.\n\n## Steps\n1. Resolve the zone ID for the target domain.\n2. List every DNS record (A, AAAA, CNAME, MX, TXT, NS) for the zone.\n3. Flag records that point to deprovisioned hosts, wildcard CNAMEs, missing SPF/DMARC TXT records, and proxied vs. unproxied mismatches.\n4. Group findings by record type and severity.\n\n## Output\nA prioritized list of DNS issues with the record name, type, current value, and recommended fix.',
    },
    {
      name: 'purge-cache',
      description:
        'Purge Cloudflare cache for specific URLs or an entire zone after a deploy, then confirm what was cleared.',
      content:
        '# Purge Cloudflare Cache\n\nClear cached content so visitors see the latest deploy.\n\n## Steps\n1. Identify the affected zone and the paths or hostnames that changed.\n2. Purge by specific files when possible; only purge everything for the zone if the change is global.\n3. Confirm the purge succeeded and note the timestamp.\n\n## Output\nA short confirmation listing the zone, the purged URLs (or "full zone"), and the purge time.',
    },
    {
      name: 'check-ssl-and-zone-settings',
      description:
        'Inspect SSL certificate status and security settings for Cloudflare zones and report drift from a desired baseline.',
      content:
        '# Check SSL and Zone Settings\n\nVerify SSL/TLS posture and key security settings across zones.\n\n## Steps\n1. List the target zones.\n2. For each zone read SSL mode, certificate status/expiry, minimum TLS version, and security level.\n3. Compare against the desired baseline (e.g. Full Strict, TLS 1.2+).\n4. Flag expiring certs and any setting weaker than the baseline.\n\n## Output\nA per-zone table of SSL status, settings, and any drift that needs remediation.',
    },
    {
      name: 'provision-new-zone',
      description:
        'Onboard a new domain onto Cloudflare: create the zone, add starter DNS records, and return the nameservers to hand off for delegation.',
      content:
        '# Provision a New Cloudflare Zone\n\nStand up a new domain on Cloudflare so it can be pointed at Cloudflare nameservers.\n\n## Steps\n1. Create the zone for the domain under the target account.\n2. Add the initial DNS records the domain needs (A/AAAA for the apex, CNAME for www, MX/TXT for mail as required).\n3. Read back the assigned Cloudflare name servers from the created zone.\n4. Summarize the zone ID, initial records created, and the name servers the registrar needs to be updated to.\n\n## Output\nThe new zone ID, the records created, and the name servers to hand off for delegation.',
    },
    {
      name: 'setup-email-authentication-records',
      description:
        'Add or update the SPF, DKIM, and DMARC TXT records a zone needs to authenticate outbound email and improve deliverability.',
      content:
        '# Set Up Email Authentication Records\n\nEmail providers (Google Workspace, Microsoft 365, transactional senders) require SPF, DKIM, and DMARC TXT records to authenticate mail and avoid it being marked as spam.\n\n## Steps\n1. Resolve the zone ID for the sending domain.\n2. List existing TXT records to check for conflicting or duplicate SPF/DMARC entries.\n3. Create or update the SPF TXT record (`v=spf1 ...`), the DKIM selector TXT record, and the DMARC TXT record (`_dmarc` name, `v=DMARC1; ...` policy) with the values the mail provider supplies.\n4. Confirm each record was created with the correct name, type, and content.\n\n## Output\nA confirmation of the SPF, DKIM, and DMARC records now in place, with their record IDs and TTLs.',
    },
  ],
} as const satisfies BlockMeta
