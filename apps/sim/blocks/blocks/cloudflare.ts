import { CloudflareIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { CloudflareResponse } from '@/tools/cloudflare/types'

/**
 * Per-operation aliases from a tool param name to the subBlock id that supplies
 * it, keyed by operation.
 *
 * Block state is keyed by subBlock id, so two controls sharing an id share one
 * stored value and the last definition in file order wins the seeded default.
 * That is fine — and deliberate — when both controls mean the same thing (a zone
 * id, a page number, a record name). It is not fine when they differ: a control
 * in `mode: 'advanced'` is serialized whenever its stored value is non-empty,
 * *before* its own `condition` is evaluated (`shouldSerializeSubBlock` in
 * `serializer/index.ts`), so a hidden filter from one operation would otherwise
 * arrive as a written value on another — a `list_dns_records` "Content Filter"
 * silently overwriting a record's content on `update_dns_record`, or a
 * `list_zones` status reaching `list_tunnels`, whose status enum is disjoint.
 *
 * Every such control therefore carries its own id and is republished here under
 * the tool's param name, before any coercion in the mapper reads it.
 *
 * Which side of a collision gets the new id is not a free choice. Block state
 * is never migrated, and `extractBlockParams` (`serializer/index.ts`) drops a
 * stored value whose id matches no subBlock config — a deleted input — so the
 * renamed side silently loses whatever shipped workflows stored. The read
 * filters therefore keep their original ids, where losing a value means
 * returning the whole zone under `success: true`, and the write controls take
 * the new ones, where losing a value means a PATCH simply omits the field.
 */
const SUBBLOCK_ALIASES: Record<string, Record<string, string>> = {
  create_zone: { type: 'zoneType' },
  create_dns_record: { type: 'recordType', proxied: 'recordProxied', tags: 'recordTags' },
  update_dns_record: {
    type: 'updateRecordType',
    name: 'updateRecordName',
    content: 'updateRecordContent',
    proxied: 'updateRecordProxied',
    tags: 'updateRecordTags',
  },
  list_dns_records: { order: 'dnsOrder' },
  list_certificates: { status: 'certificateStatus' },
  create_ruleset: { name: 'rulesetName' },
  update_ruleset_rule: { enabled: 'updateRuleEnabled' },
  create_rate_limit_rule: { action: 'rateLimitAction' },
  update_rate_limit_rule: {
    action: 'updateRateLimitAction',
    enabled: 'updateRuleEnabled',
    actionParameters: 'rateLimitActionParameters',
  },
  create_access_application: { type: 'appType', tags: 'accessAppTags' },
  update_access_application: { type: 'updateAppType', tags: 'accessAppTags' },
  update_access_policy: { decision: 'updatePolicyDecision' },
  list_access_applications: { name: 'listNameFilter', domain: 'accessAppDomainFilter' },
  list_access_groups: { name: 'listNameFilter' },
  list_access_service_tokens: { name: 'listNameFilter' },
  list_worker_scripts: { tags: 'workerTagFilter' },
  list_tunnels: { status: 'tunnelStatus', name: 'listNameFilter' },
  list_r2_buckets: { cursor: 'r2Cursor' },
  list_rulesets: { cursor: 'rulesetCursor' },
}

/**
 * Access application types whose request schema makes `domain` mandatory.
 *
 * `access_app_request` is an `anyOf` over per-type variants: `domain` is
 * required on the self_hosted, ssh, vnc, and rdp variants, optional and
 * writable on bookmark and mcp_portal, read-only on app_launcher, warp, biso,
 * and proxy_endpoint, and absent from saas, infrastructure, and mcp.
 */
const DOMAIN_REQUIRED_APP_TYPES = ['self_hosted', 'ssh', 'vnc', 'rdp'] as const

/** Every alias subBlock id, so none of them can reach a tool as a param. */
const ALIASED_SUBBLOCK_IDS = [
  ...new Set(Object.values(SUBBLOCK_ALIASES).flatMap((aliases) => Object.values(aliases))),
]

export const CloudflareBlock: BlockConfig<CloudflareResponse> = {
  type: 'cloudflare',
  name: 'Cloudflare',
  description: 'Manage DNS, WAF, Zero Trust access, and edge infrastructure',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Cloudflare into the workflow. Manage zones (domains), DNS records, SSL/TLS certificates, zone settings, DNS analytics, and cache purging. Configure WAF rulesets, managed rule overrides, and rate limiting rules through the current Rulesets engine. Administer Cloudflare Access (Zero Trust) applications, policies, groups, identity providers, and service tokens, and inspect R2 buckets, Workers scripts and routes, and Cloudflare Tunnels.',
  docsLink: 'https://docs.sim.ai/integrations/cloudflare',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#F5F6FA',
  icon: CloudflareIcon,
  canvasPresentation: {
    defaultTitle: 'Cloudflare',
    sentences: {
      byOperation: {
        list_zones: [
          'List zones',
          { text: 'named', field: 'name' },
          { text: ', with status', field: 'status' },
        ],
        get_zone: [{ text: 'Read details of zone', field: 'zoneId', core: true }],
        create_zone: [
          { text: 'Add zone', field: 'name', core: true },
          { text: ', set up as', field: 'zoneType' },
        ],
        delete_zone: [{ text: 'Delete zone', field: 'zoneId', core: true }],
        list_dns_records: [
          { text: 'List DNS records in zone', field: 'zoneId', core: true },
          { text: ', of type', field: 'type' },
          { text: ', named', field: 'name' },
        ],
        create_dns_record: [
          { text: 'Add DNS record', field: 'name', core: true },
          { text: 'of type', field: 'recordType' },
          { text: ', pointing at', field: 'content' },
        ],
        update_dns_record: [
          { text: 'Update DNS record', field: 'recordId', core: true },
          { text: ', pointing it at', field: 'updateRecordContent' },
          { text: ', with TTL', field: 'ttl' },
        ],
        delete_dns_record: [
          { text: 'Delete DNS record', field: 'recordId', core: true },
          { text: 'from zone', field: 'zoneId' },
        ],
        list_certificates: [
          { text: 'List certificate packs for zone', field: 'zoneId', core: true },
          { text: ', with status', field: 'certificateStatus' },
        ],
        get_zone_settings: [
          { text: 'Read settings of zone', field: 'zoneId', core: true },
          { text: ', limited to', field: 'settingIds' },
        ],
        update_zone_setting: [
          { text: 'Set', field: 'settingId', core: true },
          { text: 'to', field: 'value' },
          { text: 'on zone', field: 'zoneId' },
        ],
        dns_analytics: [
          { text: 'Report DNS analytics for zone', field: 'zoneId', core: true },
          { text: ', from', field: 'since', core: true },
          { text: 'to', field: 'until', core: true },
        ],
        purge_cache: [
          { text: 'Purge cache for zone', field: 'zoneId', core: true },
          { text: ', limited to', field: ['files', 'prefixes', 'hosts', 'tags'] },
        ],
        list_rulesets: [{ text: 'List rulesets in zone', field: 'zoneId', core: true }],
        get_ruleset: [
          { text: 'Read ruleset', field: 'rulesetId', core: true },
          { text: 'in zone', field: 'zoneId' },
        ],
        get_ruleset_entrypoint: [
          { text: 'Read the entry point ruleset for phase', field: 'phase', core: true },
          { text: 'in zone', field: 'zoneId' },
        ],
        create_ruleset: [
          { text: 'Create a ruleset for phase', field: 'phase', core: true },
          { text: 'in zone', field: 'zoneId' },
        ],
        create_ruleset_rule: [
          { text: 'Add a rule that runs', field: 'action', core: true },
          { text: 'when', field: 'expression', core: true },
          { text: ', to ruleset', field: 'rulesetId' },
        ],
        update_ruleset_rule: [
          { text: 'Update rule', field: 'ruleId', core: true },
          { text: 'in ruleset', field: 'rulesetId' },
          { text: ', to run', field: 'action' },
        ],
        delete_ruleset_rule: [
          { text: 'Delete rule', field: 'ruleId', core: true },
          { text: 'from ruleset', field: 'rulesetId' },
        ],
        list_managed_ruleset_overrides: [
          { text: 'List WAF managed ruleset overrides for zone', field: 'zoneId', core: true },
        ],
        list_rate_limit_rules: [
          { text: 'List rate limiting rules in zone', field: 'zoneId', core: true },
        ],
        create_rate_limit_rule: [
          { text: 'Rate limit', field: 'expression', core: true },
          { text: 'to', field: 'requestsPerPeriod', core: true },
          { text: 'requests every', field: 'period' },
        ],
        update_rate_limit_rule: [
          { text: 'Update rate limiting rule', field: 'ruleId', core: true },
          { text: 'to', field: 'requestsPerPeriod' },
          { text: 'requests every', field: 'period' },
        ],
        list_access_applications: [
          { text: 'List Access applications in account', field: 'accountId', core: true },
          { text: ', matching', field: ['listNameFilter', 'accessAppDomainFilter', 'search'] },
        ],
        get_access_application: [{ text: 'Read Access application', field: 'appId', core: true }],
        create_access_application: [
          { text: 'Protect', field: 'domain', core: true },
          { text: 'with an Access application named', field: 'name' },
        ],
        update_access_application: [
          { text: 'Update Access application', field: 'appId', core: true },
          { text: ', securing', field: 'domain' },
        ],
        delete_access_application: [
          { text: 'Delete Access application', field: 'appId', core: true },
        ],
        list_access_policies: [
          { text: 'List Access policies on application', field: 'appId', core: true },
        ],
        create_access_policy: [
          { text: 'Add Access policy', field: 'name', core: true },
          { text: 'that will', field: 'decision', core: true },
          { text: 'on application', field: 'appId' },
        ],
        update_access_policy: [
          { text: 'Update Access policy', field: 'policyId', core: true },
          { text: 'to', field: 'updatePolicyDecision' },
          { text: 'on application', field: 'appId' },
        ],
        delete_access_policy: [
          { text: 'Delete Access policy', field: 'policyId', core: true },
          { text: 'from application', field: 'appId' },
        ],
        list_access_groups: [
          { text: 'List Access groups in account', field: 'accountId', core: true },
        ],
        list_access_identity_providers: [
          { text: 'List Access identity providers in account', field: 'accountId', core: true },
        ],
        list_access_service_tokens: [
          { text: 'List Access service tokens in account', field: 'accountId', core: true },
        ],
        create_access_service_token: [
          { text: 'Create Access service token', field: 'name', core: true },
          { text: ', valid for', field: 'duration' },
        ],
        revoke_access_service_token: [
          { text: 'Revoke Access service token', field: 'serviceTokenId', core: true },
        ],
        list_r2_buckets: [
          { text: 'List R2 buckets in account', field: 'accountId', core: true },
          { text: ', named like', field: 'name_contains' },
        ],
        get_r2_bucket: [{ text: 'Read R2 bucket', field: 'bucketName', core: true }],
        create_r2_bucket: [
          { text: 'Create R2 bucket', field: 'bucketName', core: true },
          { text: 'in', field: 'locationHint' },
        ],
        delete_r2_bucket: [{ text: 'Delete R2 bucket', field: 'bucketName', core: true }],
        list_worker_scripts: [
          { text: 'List Worker scripts in account', field: 'accountId', core: true },
        ],
        get_worker_script_settings: [
          { text: 'Read settings of Worker script', field: 'scriptName', core: true },
        ],
        list_worker_routes: [{ text: 'List Worker routes in zone', field: 'zoneId', core: true }],
        list_tunnels: [
          { text: 'List tunnels in account', field: 'accountId', core: true },
          { text: ', with status', field: 'tunnelStatus' },
        ],
        get_tunnel: [{ text: 'Read tunnel', field: 'tunnelId', core: true }],
        get_tunnel_configuration: [
          { text: 'Read the configuration of tunnel', field: 'tunnelId', core: true },
        ],
      },
    },
  },
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
        { label: 'List Rulesets', id: 'list_rulesets' },
        { label: 'Get Ruleset', id: 'get_ruleset' },
        { label: 'Get Phase Entry Point Ruleset', id: 'get_ruleset_entrypoint' },
        { label: 'Create Ruleset', id: 'create_ruleset' },
        { label: 'Create Ruleset Rule', id: 'create_ruleset_rule' },
        { label: 'Update Ruleset Rule', id: 'update_ruleset_rule' },
        { label: 'Delete Ruleset Rule', id: 'delete_ruleset_rule' },
        { label: 'List Managed Ruleset Overrides', id: 'list_managed_ruleset_overrides' },
        { label: 'List Rate Limiting Rules', id: 'list_rate_limit_rules' },
        { label: 'Create Rate Limiting Rule', id: 'create_rate_limit_rule' },
        { label: 'Update Rate Limiting Rule', id: 'update_rate_limit_rule' },
        { label: 'List Access Applications', id: 'list_access_applications' },
        { label: 'Get Access Application', id: 'get_access_application' },
        { label: 'Create Access Application', id: 'create_access_application' },
        { label: 'Update Access Application', id: 'update_access_application' },
        { label: 'Delete Access Application', id: 'delete_access_application' },
        { label: 'List Access Policies', id: 'list_access_policies' },
        { label: 'Create Access Policy', id: 'create_access_policy' },
        { label: 'Update Access Policy', id: 'update_access_policy' },
        { label: 'Delete Access Policy', id: 'delete_access_policy' },
        { label: 'List Access Groups', id: 'list_access_groups' },
        { label: 'List Access Identity Providers', id: 'list_access_identity_providers' },
        { label: 'List Access Service Tokens', id: 'list_access_service_tokens' },
        { label: 'Create Access Service Token', id: 'create_access_service_token' },
        { label: 'Revoke Access Service Token', id: 'revoke_access_service_token' },
        { label: 'List R2 Buckets', id: 'list_r2_buckets' },
        { label: 'Get R2 Bucket', id: 'get_r2_bucket' },
        { label: 'Create R2 Bucket', id: 'create_r2_bucket' },
        { label: 'Delete R2 Bucket', id: 'delete_r2_bucket' },
        { label: 'List Worker Scripts', id: 'list_worker_scripts' },
        { label: 'Get Worker Script Settings', id: 'get_worker_script_settings' },
        { label: 'List Worker Routes', id: 'list_worker_routes' },
        { label: 'List Tunnels', id: 'list_tunnels' },
        { label: 'Get Tunnel', id: 'get_tunnel' },
        { label: 'Get Tunnel Configuration', id: 'get_tunnel_configuration' },
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
      id: 'dnsOrder',
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
      id: 'recordType',
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
      id: 'recordProxied',
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
      placeholder: 'MX/URI priority (e.g., 10)',
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
      id: 'recordTags',
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
      id: 'updateRecordType',
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
      /**
       * Renaming a live DNS record is a write, and this control is advanced, so
       * sharing the bare `name` id let a name typed under any other operation
       * reach the PATCH and rename the record.
       */
      id: 'updateRecordName',
      title: 'Record Name',
      type: 'short-input',
      placeholder: 'e.g., example.com or sub.example.com',
      condition: { field: 'operation', value: 'update_dns_record' },
      mode: 'advanced',
    },
    {
      id: 'updateRecordContent',
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
      id: 'updateRecordProxied',
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
      placeholder: 'MX/URI priority (e.g., 10)',
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
      id: 'updateRecordTags',
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
      id: 'certificateStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All statuses', id: 'all' },
        { label: 'Active only', id: '' },
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
    {
      /**
       * Cloudflare retired the endpoint that read every setting in one request,
       * so this operation reads one setting per request. Naming the settings
       * keeps the fan-out to what the workflow actually reads.
       */
      id: 'settingIds',
      title: 'Settings',
      type: 'short-input',
      placeholder: 'Comma-separated setting IDs (blank reads the default set)',
      condition: { field: 'operation', value: 'get_zone_settings' },
      mode: 'advanced',
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
      value: () => 'false',
      condition: { field: 'operation', value: 'purge_cache' },
    },
    {
      id: 'files',
      title: 'Files to Purge',
      type: 'long-input',
      placeholder:
        'Comma-separated URLs (e.g., https://example.com/style.css, https://example.com/app.js)',
      condition: {
        field: 'operation',
        value: 'purge_cache',
        and: { field: 'purge_everything', value: 'true', not: true },
      },
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
      condition: {
        field: 'operation',
        value: 'purge_cache',
        and: { field: 'purge_everything', value: 'true', not: true },
      },
      mode: 'advanced',
    },
    {
      id: 'hosts',
      title: 'Hostnames',
      type: 'short-input',
      placeholder: 'Comma-separated hostnames (Enterprise only)',
      condition: {
        field: 'operation',
        value: 'purge_cache',
        and: { field: 'purge_everything', value: 'true', not: true },
      },
      mode: 'advanced',
    },
    {
      id: 'prefixes',
      title: 'URL Prefixes',
      type: 'short-input',
      placeholder: 'Comma-separated URL prefixes (Enterprise only)',
      condition: {
        field: 'operation',
        value: 'purge_cache',
        and: { field: 'purge_everything', value: 'true', not: true },
      },
      mode: 'advanced',
    },

    // Zone ID for zone-scoped WAF, rate limiting, and Workers routes operations
    {
      id: 'zoneId',
      title: 'Zone ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter zone ID',
      condition: {
        field: 'operation',
        value: [
          'list_rulesets',
          'get_ruleset',
          'get_ruleset_entrypoint',
          'create_ruleset',
          'create_ruleset_rule',
          'update_ruleset_rule',
          'delete_ruleset_rule',
          'list_managed_ruleset_overrides',
          'list_rate_limit_rules',
          'create_rate_limit_rule',
          'update_rate_limit_rule',
          'list_worker_routes',
        ],
      },
    },

    // Account ID for account-scoped Access, R2, Workers scripts, and Tunnels operations
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Cloudflare account ID',
      condition: {
        field: 'operation',
        value: [
          'list_access_applications',
          'get_access_application',
          'create_access_application',
          'update_access_application',
          'delete_access_application',
          'list_access_policies',
          'create_access_policy',
          'update_access_policy',
          'delete_access_policy',
          'list_access_groups',
          'list_access_identity_providers',
          'list_access_service_tokens',
          'create_access_service_token',
          'revoke_access_service_token',
          'list_r2_buckets',
          'get_r2_bucket',
          'create_r2_bucket',
          'delete_r2_bucket',
          'list_worker_scripts',
          'get_worker_script_settings',
          'list_tunnels',
          'get_tunnel',
          'get_tunnel_configuration',
        ],
      },
    },

    // Ruleset inputs
    {
      id: 'phase',
      title: 'Phase',
      type: 'dropdown',
      options: [
        { label: 'WAF Custom Rules', id: 'http_request_firewall_custom' },
        { label: 'WAF Managed Rules', id: 'http_request_firewall_managed' },
        { label: 'Rate Limiting', id: 'http_ratelimit' },
        { label: 'Request Transform', id: 'http_request_transform' },
        { label: 'Late Request Transform', id: 'http_request_late_transform' },
        { label: 'Dynamic Redirects', id: 'http_request_dynamic_redirect' },
        { label: 'Request Cache Settings', id: 'http_request_cache_settings' },
        { label: 'Config Settings', id: 'http_config_settings' },
        { label: 'Origin', id: 'http_request_origin' },
        { label: 'Response Headers Transform', id: 'http_response_headers_transform' },
        { label: 'Response Compression', id: 'http_response_compression' },
        { label: 'Custom Errors', id: 'http_custom_errors' },
        { label: 'Super Bot Fight Mode', id: 'http_request_sbfm' },
      ],
      value: () => 'http_request_firewall_custom',
      required: true,
      condition: { field: 'operation', value: ['get_ruleset_entrypoint', 'create_ruleset'] },
    },
    {
      id: 'rulesetName',
      title: 'Ruleset Name',
      type: 'short-input',
      required: true,
      placeholder: 'e.g. Zone rate limiting ruleset',
      condition: { field: 'operation', value: 'create_ruleset' },
    },
    {
      id: 'kind',
      title: 'Ruleset Kind',
      type: 'dropdown',
      options: [
        { label: 'Zone (phase entry point)', id: 'zone' },
        { label: 'Custom', id: 'custom' },
      ],
      value: () => 'zone',
      condition: { field: 'operation', value: 'create_ruleset' },
      mode: 'advanced',
    },
    {
      id: 'rules',
      title: 'Initial Rules',
      type: 'long-input',
      placeholder: 'JSON array of rules to seed the ruleset with',
      condition: { field: 'operation', value: 'create_ruleset' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a Cloudflare ruleset rules array from the user's description.

Each rule is an object with:
- "action": the action to take, e.g. "block", "challenge", "managed_challenge", "js_challenge", "log", "skip", "execute"
- "expression": a Cloudflare filter expression selecting matching requests
- "description": optional human-readable description
- "enabled": optional boolean, defaults to true

A rate limiting rule (http_ratelimit phase) also takes "ratelimit" with "characteristics", "period", and "requests_per_period".

Examples:
- "block traffic from Russia" -> [{"action":"block","expression":"(ip.geoip.country eq \\"RU\\")","description":"Block RU"}]
- "rate limit the login endpoint to 10 requests a minute per IP" -> [{"action":"block","expression":"(http.request.uri.path eq \\"/login\\")","description":"Login rate limit","ratelimit":{"characteristics":["ip.src","cf.colo.id"],"period":60,"requests_per_period":10}}]

Return ONLY the JSON array - no explanations, no markdown fences.`,
        placeholder: 'Describe the rules to seed this ruleset with...',
        generationType: 'json-array',
      },
    },
    {
      id: 'rulesetId',
      title: 'Ruleset ID',
      type: 'short-input',
      required: true,
      placeholder: 'From "List Rulesets" or "Get Phase Entry Point Ruleset"',
      condition: {
        field: 'operation',
        value: ['get_ruleset', 'create_ruleset_rule', 'update_ruleset_rule', 'delete_ruleset_rule'],
      },
    },
    {
      id: 'rulesetId',
      title: 'Rate Limiting Ruleset ID',
      type: 'short-input',
      required: true,
      placeholder: 'From "List Rate Limiting Rules"',
      condition: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
    },
    {
      id: 'ruleId',
      title: 'Rule ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter rule ID',
      condition: {
        field: 'operation',
        value: ['update_ruleset_rule', 'delete_ruleset_rule', 'update_rate_limit_rule'],
      },
    },
    {
      id: 'action',
      title: 'Action',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['create_ruleset_rule', 'update_ruleset_rule'],
      },
      placeholder: 'block, challenge, managed_challenge, js_challenge, log, skip, execute',
      condition: {
        field: 'operation',
        value: ['create_ruleset_rule', 'update_ruleset_rule'],
      },
    },
    {
      id: 'rateLimitAction',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Block', id: 'block' },
        { label: 'Managed Challenge', id: 'managed_challenge' },
        { label: 'JS Challenge', id: 'js_challenge' },
        { label: 'Interactive Challenge', id: 'challenge' },
        { label: 'Log', id: 'log' },
      ],
      value: () => 'block',
      condition: { field: 'operation', value: 'create_rate_limit_rule' },
    },
    {
      /**
       * The update endpoint replaces the rule, so a seeded action would rewrite
       * whatever the rule currently does the moment anything else is edited.
       * This control carries no default: the user has to state the action the
       * replaced rule should end up with.
       */
      id: 'updateRateLimitAction',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Block', id: 'block' },
        { label: 'Managed Challenge', id: 'managed_challenge' },
        { label: 'JS Challenge', id: 'js_challenge' },
        { label: 'Interactive Challenge', id: 'challenge' },
        { label: 'Log', id: 'log' },
      ],
      required: true,
      condition: { field: 'operation', value: 'update_rate_limit_rule' },
    },
    {
      id: 'expression',
      title: 'Expression',
      type: 'long-input',
      required: {
        field: 'operation',
        value: [
          'create_ruleset_rule',
          'update_ruleset_rule',
          'create_rate_limit_rule',
          'update_rate_limit_rule',
        ],
      },
      placeholder: '(http.request.uri.path matches "^/api/")',
      condition: {
        field: 'operation',
        value: [
          'create_ruleset_rule',
          'update_ruleset_rule',
          'create_rate_limit_rule',
          'update_rate_limit_rule',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Cloudflare Ruleset Engine filter expression from the user's description.

Syntax uses fields, operators, and logical connectors:
- ip.src, ip.src.country, ip.src.asnum
- http.host, http.request.uri.path, http.request.uri.query, http.request.method
- http.user_agent, http.referer
- cf.threat_score, cf.bot_management.score, cf.client.bot
- ssl

Operators: eq, ne, lt, gt, contains, matches (regex), in { }
Connectors: and, or, not, with parentheses

Examples:
- "block traffic from the UK and France" -> (ip.src.country in {"GB" "FR"})
- "everything under /api" -> (http.request.uri.path matches "^/api/")
- "the login page from non-verified bots" -> (http.request.uri.path eq "/login" and cf.client.bot)
- "all requests" -> true

Return ONLY the expression - no explanations, no quotes around the whole expression, no extra text.`,
        placeholder:
          'Describe the traffic to match (e.g., "requests to /api from outside the US")...',
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Human-readable description of the rule',
      condition: {
        field: 'operation',
        value: [
          'create_ruleset',
          'create_ruleset_rule',
          'update_ruleset_rule',
          'create_rate_limit_rule',
          'update_rate_limit_rule',
        ],
      },
    },
    {
      id: 'enabled',
      title: 'Enabled',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['create_ruleset_rule', 'create_rate_limit_rule'],
      },
      mode: 'advanced',
    },
    {
      /**
       * The update endpoints replace the rule, so `enabled` is a live on/off
       * switch for WAF and rate limiting there rather than a starting state.
       * Sharing the create control's id let a `false` chosen while drafting a
       * new rule reach a later update and disable an enforcing rule — from a
       * field the operation does not render in basic mode, since an advanced
       * control serializes on stored value alone, before its `condition` runs.
       */
      id: 'updateRuleEnabled',
      title: 'Enabled',
      type: 'dropdown',
      options: [
        { label: 'Leave unchanged (Cloudflare re-enables the rule)', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['update_ruleset_rule', 'update_rate_limit_rule'],
      },
      mode: 'advanced',
    },
    {
      id: 'ref',
      title: 'Reference Tag',
      type: 'short-input',
      placeholder: 'Stable reference that survives rule updates',
      condition: {
        field: 'operation',
        value: ['create_ruleset_rule', 'update_ruleset_rule', 'update_rate_limit_rule'],
      },
      mode: 'advanced',
    },
    {
      id: 'ratelimit',
      title: 'Rate Limiting Configuration',
      type: 'long-input',
      placeholder:
        '{"characteristics":["cf.colo.id","ip.src"],"period":60,"requests_per_period":100}',
      condition: { field: 'operation', value: 'update_ruleset_rule' },
      mode: 'advanced',
    },
    {
      id: 'logging',
      title: 'Logging Configuration',
      type: 'long-input',
      placeholder: '{"enabled":true}',
      condition: {
        field: 'operation',
        value: ['update_ruleset_rule', 'update_rate_limit_rule'],
      },
      mode: 'advanced',
    },
    {
      id: 'actionParameters',
      title: 'Action Parameters',
      type: 'long-input',
      /**
       * An `execute` rule carries the managed ruleset it deploys here, and the
       * update endpoint replaces the rule — so leaving this blank resets
       * action_parameters to {} and unbinds that ruleset.
       */
      required: { field: 'action', value: 'execute' },
      placeholder: '{"id":"<MANAGED_RULESET_ID>","overrides":{"action":"log"}}',
      condition: {
        field: 'operation',
        value: ['create_ruleset_rule', 'update_ruleset_rule'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate the JSON action_parameters object for a Cloudflare ruleset rule from the user's description.

For an "execute" rule that deploys a WAF managed ruleset:
{"id":"<MANAGED_RULESET_ID>"}

To override the whole managed ruleset:
{"id":"<MANAGED_RULESET_ID>","overrides":{"action":"log"}}

To override specific categories:
{"id":"<MANAGED_RULESET_ID>","overrides":{"categories":[{"category":"wordpress","action":"block","enabled":true}]}}

To override specific rules:
{"id":"<MANAGED_RULESET_ID>","overrides":{"rules":[{"id":"<RULE_ID>","action":"log","enabled":true}]}}

"action" and "enabled" are overridable at every level. Individual managed rulesets may accept more: an OWASP Core Ruleset rule override also takes "score_threshold", e.g.
{"id":"<OWASP_RULESET_ID>","overrides":{"rules":[{"id":"<RULE_ID>","score_threshold":60,"action":"managed_challenge"}]}}

Return ONLY the JSON object - no explanations, no markdown fences.`,
        placeholder:
          'Describe the action parameters (e.g., "deploy the Cloudflare Managed Ruleset in log mode")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'position',
      title: 'Position',
      type: 'short-input',
      placeholder: '{"index":1} or {"before":"<RULE_ID>"} or {"after":"<RULE_ID>"}',
      condition: { field: 'operation', value: 'create_ruleset_rule' },
      mode: 'advanced',
    },

    // Rate limiting inputs
    {
      id: 'characteristics',
      title: 'Characteristics',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
      placeholder: 'cf.colo.id,ip.src',
      condition: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Cloudflare rate limiting counting characteristics from the user's description.

cf.colo.id is mandatory in every list. ip.src and cf.unique_visitor_id are mutually exclusive - include at most one, and neither is required. Do not add an IP or visitor characteristic the user did not ask for; a rule keyed on host, path, country, header, cookie or JA3/JA4 alone is valid.

Available characteristics:
- cf.colo.id (mandatory)
- ip.src
- cf.unique_visitor_id
- http.host
- http.request.uri.path
- ip.src.asnum
- ip.src.country
- http.request.headers["<name>"]
- http.request.cookies["<name>"]
- http.request.uri.args["<name>"]
- cf.bot_management.ja3_hash
- cf.bot_management.ja4

Examples:
- "per IP address" -> cf.colo.id,ip.src
- "per visitor" -> cf.colo.id,cf.unique_visitor_id
- "per API key header" -> cf.colo.id,http.request.headers["x-api-key"]
- "per country" -> cf.colo.id,ip.src.country

Return ONLY the comma-separated list - no explanations, no extra text.`,
        placeholder:
          'Describe how to group counters (e.g., "per IP address", "per API key header")...',
      },
    },
    {
      id: 'period',
      title: 'Period (seconds)',
      type: 'dropdown',
      options: [
        { label: '10 seconds', id: '10' },
        { label: '1 minute', id: '60' },
        { label: '2 minutes', id: '120' },
        { label: '5 minutes', id: '300' },
        { label: '10 minutes', id: '600' },
        { label: '1 hour', id: '3600' },
      ],
      value: () => '60',
      required: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
      condition: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
    },
    {
      id: 'requestsPerPeriod',
      title: 'Requests Per Period',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
      placeholder: 'e.g., 100',
      condition: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
    },
    {
      id: 'mitigationTimeout',
      title: 'Mitigation Timeout (seconds)',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'No timeout', id: '0' },
        { label: '10 seconds', id: '10' },
        { label: '1 minute', id: '60' },
        { label: '2 minutes', id: '120' },
        { label: '5 minutes', id: '300' },
        { label: '10 minutes', id: '600' },
        { label: '1 hour', id: '3600' },
        { label: '1 day', id: '86400' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
      mode: 'advanced',
    },
    {
      id: 'counting_expression',
      title: 'Counting Expression',
      type: 'long-input',
      placeholder: 'Expression selecting which requests are counted, if different from the match',
      condition: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
      mode: 'advanced',
    },
    {
      id: 'requestsToOrigin',
      title: 'Count Only Origin Requests',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['create_rate_limit_rule', 'update_rate_limit_rule'],
      },
      mode: 'advanced',
    },
    {
      /**
       * A rate limiting rule carries its custom mitigation response here, and
       * the update endpoint replaces the rule — so leaving this blank resets
       * action_parameters to {} and the rule falls back to Cloudflare's default
       * block page. It gets its own id because the WAF control of the same name
       * holds a managed-ruleset payload, which is not what this rule takes.
       */
      id: 'rateLimitActionParameters',
      title: 'Action Parameters',
      type: 'long-input',
      placeholder:
        '{"response":{"status_code":429,"content":"{\\"error\\":\\"rate limited\\"}","content_type":"application/json"}}',
      condition: { field: 'operation', value: 'update_rate_limit_rule' },
      wandConfig: {
        enabled: true,
        prompt: `Generate the JSON action_parameters object for a Cloudflare rate limiting rule from the user's description.

Only a "block" action takes action_parameters, and only to define a custom response:
{"response":{"status_code":429,"content":"You have been rate limited.","content_type":"text/plain"}}

status_code must be in the 400-499 range. content_type is one of "text/plain", "text/html", or "application/json". For a JSON body, "content" is the JSON payload as a string:
{"response":{"status_code":429,"content":"{\\"error\\":\\"rate limited\\"}","content_type":"application/json"}}

Challenge and log actions take no action_parameters - return {} for those.

Return ONLY the JSON object - no explanations, no markdown fences.`,
        placeholder:
          'Describe the mitigation response (e.g., "return a 429 with a JSON error body")...',
        generationType: 'json-object',
      },
      mode: 'advanced',
    },

    // Access application inputs
    {
      id: 'appId',
      title: 'Application ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Access application ID',
      condition: {
        field: 'operation',
        value: [
          'get_access_application',
          'update_access_application',
          'delete_access_application',
          'list_access_policies',
          'create_access_policy',
          'update_access_policy',
          'delete_access_policy',
        ],
      },
    },
    {
      id: 'appType',
      title: 'Application Type',
      type: 'dropdown',
      options: [
        { label: 'Self-Hosted', id: 'self_hosted' },
        { label: 'SaaS', id: 'saas' },
        { label: 'SSH', id: 'ssh' },
        { label: 'VNC', id: 'vnc' },
        { label: 'App Launcher', id: 'app_launcher' },
        { label: 'WARP', id: 'warp' },
        { label: 'Browser Isolation', id: 'biso' },
        { label: 'Bookmark', id: 'bookmark' },
        { label: 'Infrastructure', id: 'infrastructure' },
        { label: 'RDP', id: 'rdp' },
        { label: 'MCP', id: 'mcp' },
        { label: 'MCP Portal', id: 'mcp_portal' },
        { label: 'Proxy Endpoint', id: 'proxy_endpoint' },
      ],
      value: () => 'self_hosted',
      required: true,
      condition: { field: 'operation', value: 'create_access_application' },
    },
    {
      /**
       * Updating an Access application replaces it, so a seeded type would
       * rewrite what a live application IS as soon as anything else is edited.
       * No default: the caller states the type the replaced application keeps.
       */
      id: 'updateAppType',
      title: 'Application Type',
      type: 'dropdown',
      options: [
        { label: 'Self-Hosted', id: 'self_hosted' },
        { label: 'SaaS', id: 'saas' },
        { label: 'SSH', id: 'ssh' },
        { label: 'VNC', id: 'vnc' },
        { label: 'App Launcher', id: 'app_launcher' },
        { label: 'WARP', id: 'warp' },
        { label: 'Browser Isolation', id: 'biso' },
        { label: 'Bookmark', id: 'bookmark' },
        { label: 'Infrastructure', id: 'infrastructure' },
        { label: 'RDP', id: 'rdp' },
        { label: 'MCP', id: 'mcp' },
        { label: 'MCP Portal', id: 'mcp_portal' },
        { label: 'Proxy Endpoint', id: 'proxy_endpoint' },
      ],
      required: true,
      condition: { field: 'operation', value: 'update_access_application' },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'e.g., internal.example.com — required for self_hosted, ssh, vnc, and rdp apps',
      required: (values) =>
        values?.operation === 'update_access_application'
          ? { field: 'updateAppType', value: [...DOMAIN_REQUIRED_APP_TYPES] }
          : { field: 'appType', value: [...DOMAIN_REQUIRED_APP_TYPES] },
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
    },
    {
      /** `saas_app` is required on the saas request variant and rejected elsewhere. */
      id: 'saasApp',
      title: 'SaaS Application',
      type: 'long-input',
      required: true,
      placeholder: '{"auth_type":"saml","consumer_service_url":"https://example.com/acs"}',
      condition: (values) =>
        values?.operation === 'update_access_application'
          ? {
              field: 'updateAppType',
              value: 'saas',
              and: { field: 'operation', value: 'update_access_application' },
            }
          : {
              field: 'appType',
              value: 'saas',
              and: { field: 'operation', value: 'create_access_application' },
            },
    },
    {
      /** `target_criteria` is required on the infrastructure and rdp variants. */
      id: 'targetCriteria',
      title: 'Target Criteria',
      type: 'long-input',
      required: true,
      placeholder: '[{"port":22,"protocol":"ssh","target_attributes":{"hostname":["app"]}}]',
      condition: (values) =>
        values?.operation === 'update_access_application'
          ? {
              field: 'updateAppType',
              value: ['infrastructure', 'rdp'],
              and: { field: 'operation', value: 'update_access_application' },
            }
          : {
              field: 'appType',
              value: ['infrastructure', 'rdp'],
              and: { field: 'operation', value: 'create_access_application' },
            },
    },
    {
      id: 'accessAppDomainFilter',
      title: 'Domain Filter',
      type: 'short-input',
      placeholder: 'Filter by the hostname the application secures',
      condition: { field: 'operation', value: 'list_access_applications' },
      mode: 'advanced',
    },
    {
      id: 'name',
      title: 'Application Name',
      type: 'short-input',
      placeholder: 'Friendly name shown in the dashboard',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
    },
    {
      id: 'listNameFilter',
      title: 'Name Filter',
      type: 'short-input',
      placeholder: 'Filter by name',
      condition: {
        field: 'operation',
        value: [
          'list_access_applications',
          'list_access_groups',
          'list_access_service_tokens',
          'list_tunnels',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'aud',
      title: 'Audience Tag',
      type: 'short-input',
      placeholder: 'Filter by application AUD tag',
      condition: { field: 'operation', value: 'list_access_applications' },
      mode: 'advanced',
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Free-text search',
      condition: {
        field: 'operation',
        value: ['list_access_applications', 'list_access_groups', 'list_access_service_tokens'],
      },
      mode: 'advanced',
    },
    {
      id: 'exact',
      title: 'Exact Match',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_access_applications' },
      mode: 'advanced',
    },
    {
      id: 'sessionDuration',
      title: 'Session Duration',
      type: 'short-input',
      placeholder: 'e.g., 24h',
      condition: {
        field: 'operation',
        value: [
          'create_access_application',
          'update_access_application',
          'create_access_policy',
          'update_access_policy',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'allowedIdps',
      title: 'Allowed Identity Providers',
      type: 'short-input',
      placeholder: 'Comma-separated identity provider IDs',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'appLauncherVisible',
      title: 'Show in App Launcher',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'autoRedirectToIdentity',
      title: 'Auto Redirect to Identity Provider',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'customDenyMessage',
      title: 'Custom Deny Message',
      type: 'short-input',
      placeholder: 'Message shown to denied users',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'customDenyUrl',
      title: 'Custom Deny URL',
      type: 'short-input',
      placeholder: 'https://example.com/denied',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'logoUrl',
      title: 'Logo URL',
      type: 'short-input',
      placeholder: 'https://example.com/logo.png',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'accessAppTags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tag names',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'policies',
      title: 'Policies',
      type: 'long-input',
      placeholder: 'JSON array of reusable policy IDs or inline policy objects',
      condition: {
        field: 'operation',
        value: ['create_access_application', 'update_access_application'],
      },
      mode: 'advanced',
    },

    // Access policy inputs
    {
      id: 'policyId',
      title: 'Policy ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Access policy ID',
      condition: {
        field: 'operation',
        value: ['update_access_policy', 'delete_access_policy'],
      },
    },
    {
      id: 'name',
      title: 'Policy Name',
      type: 'short-input',
      required: true,
      placeholder: 'e.g., Allow engineering team',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
    },
    {
      id: 'decision',
      title: 'Decision',
      type: 'dropdown',
      options: [
        { label: 'Allow', id: 'allow' },
        { label: 'Deny', id: 'deny' },
        { label: 'Non-Identity (service tokens)', id: 'non_identity' },
        { label: 'Bypass (skip Access entirely)', id: 'bypass' },
      ],
      value: () => 'allow',
      required: true,
      condition: { field: 'operation', value: 'create_access_policy' },
    },
    {
      /**
       * Updating a policy replaces it, so a seeded allow would silently widen a
       * live deny, bypass, or non_identity policy the moment its rules are
       * edited. No default: the caller states the decision.
       */
      id: 'updatePolicyDecision',
      title: 'Decision',
      type: 'dropdown',
      options: [
        { label: 'Allow', id: 'allow' },
        { label: 'Deny', id: 'deny' },
        { label: 'Non-Identity (service tokens)', id: 'non_identity' },
        { label: 'Bypass (skip Access entirely)', id: 'bypass' },
      ],
      required: true,
      condition: { field: 'operation', value: 'update_access_policy' },
    },
    {
      id: 'include',
      title: 'Include Rules',
      type: 'long-input',
      required: true,
      placeholder: '[{"email_domain":{"domain":"example.com"}}]',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Cloudflare Access rules from the user's description. These are evaluated with OR logic.

Rule shapes:
- {"email":{"email":"user@example.com"}}
- {"email_domain":{"domain":"example.com"}}
- {"email_list":{"id":"<LIST_ID>"}}
- {"everyone":{}}
- {"ip":{"ip":"192.0.2.1/32"}}
- {"ip_list":{"id":"<LIST_ID>"}}
- {"group":{"id":"<ACCESS_GROUP_ID>"}}
- {"service_token":{"token_id":"<SERVICE_TOKEN_ID>"}}
- {"any_valid_service_token":{}}
- {"certificate":{}}
- {"geo":{"country_code":"US"}}
- {"azureAD":{"id":"<GROUP_ID>","connection_id":"<IDP_ID>"}}
- {"okta":{"name":"<GROUP_NAME>","connection_id":"<IDP_ID>"}}
- {"gsuite":{"email":"<GROUP_EMAIL>","connection_id":"<IDP_ID>"}}

Examples:
- "anyone at example.com" -> [{"email_domain":{"domain":"example.com"}}]
- "a specific person" -> [{"email":{"email":"user@example.com"}}]
- "any service token" -> [{"any_valid_service_token":{}}]
- "everyone" -> [{"everyone":{}}]

Return ONLY the JSON array - no explanations, no markdown fences.`,
        placeholder: 'Describe who should match (e.g., "anyone with an @example.com email")...',
        generationType: 'json-array',
      },
    },
    {
      id: 'exclude',
      title: 'Exclude Rules',
      type: 'long-input',
      placeholder: 'JSON array of Access rules evaluated with NOT logic',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
      mode: 'advanced',
    },
    {
      id: 'require',
      title: 'Require Rules',
      type: 'long-input',
      placeholder: 'JSON array of Access rules evaluated with AND logic',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
      mode: 'advanced',
    },
    {
      id: 'precedence',
      title: 'Precedence',
      type: 'short-input',
      placeholder: 'Evaluation order within the application',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
      mode: 'advanced',
    },
    {
      id: 'approvalRequired',
      title: 'Approval Required',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
      mode: 'advanced',
    },
    {
      id: 'isolationRequired',
      title: 'Browser Isolation Required',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
      mode: 'advanced',
    },
    {
      id: 'purposeJustificationRequired',
      title: 'Purpose Justification Required',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
      mode: 'advanced',
    },
    {
      id: 'purposeJustificationPrompt',
      title: 'Purpose Justification Prompt',
      type: 'short-input',
      placeholder: 'Why do you need access?',
      condition: {
        field: 'operation',
        value: ['create_access_policy', 'update_access_policy'],
      },
      mode: 'advanced',
    },

    // Access service token inputs
    {
      id: 'name',
      title: 'Service Token Name',
      type: 'short-input',
      required: true,
      placeholder: 'e.g., ci-pipeline',
      condition: { field: 'operation', value: 'create_access_service_token' },
    },
    {
      id: 'duration',
      title: 'Duration',
      type: 'short-input',
      placeholder: 'e.g., 8760h',
      condition: { field: 'operation', value: 'create_access_service_token' },
      mode: 'advanced',
    },
    {
      id: 'serviceTokenId',
      title: 'Service Token ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter the service token ID to revoke',
      condition: { field: 'operation', value: 'revoke_access_service_token' },
    },

    // R2 inputs
    {
      id: 'bucketName',
      title: 'Bucket Name',
      type: 'short-input',
      required: true,
      placeholder: 'Enter R2 bucket name',
      condition: {
        field: 'operation',
        value: ['get_r2_bucket', 'create_r2_bucket', 'delete_r2_bucket'],
      },
    },
    {
      id: 'locationHint',
      title: 'Location Hint',
      type: 'dropdown',
      options: [
        { label: 'Automatic', id: '' },
        { label: 'Asia-Pacific', id: 'apac' },
        { label: 'Eastern Europe', id: 'eeur' },
        { label: 'Eastern North America', id: 'enam' },
        { label: 'Western Europe', id: 'weur' },
        { label: 'Western North America', id: 'wnam' },
        { label: 'Oceania', id: 'oc' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_r2_bucket' },
      mode: 'advanced',
    },
    {
      id: 'storageClass',
      title: 'Storage Class',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Standard', id: 'Standard' },
        { label: 'Infrequent Access', id: 'InfrequentAccess' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_r2_bucket' },
      mode: 'advanced',
    },
    {
      id: 'jurisdiction',
      title: 'Jurisdiction',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'European Union', id: 'eu' },
        { label: 'FedRAMP', id: 'fedramp' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['list_r2_buckets', 'get_r2_bucket', 'create_r2_bucket', 'delete_r2_bucket'],
      },
      mode: 'advanced',
    },
    {
      id: 'name_contains',
      title: 'Name Contains',
      type: 'short-input',
      placeholder: 'Filter buckets by name substring',
      condition: { field: 'operation', value: 'list_r2_buckets' },
      mode: 'advanced',
    },
    {
      id: 'start_after',
      title: 'Start After',
      type: 'short-input',
      placeholder: 'Bucket name to start listing after',
      condition: { field: 'operation', value: 'list_r2_buckets' },
      mode: 'advanced',
    },
    {
      /**
       * R2 returns its cursor at `result_info.cursor` and the Rulesets API at
       * `result_info.cursors.after`. The two are not interchangeable, so a
       * cursor carried across from the other list 400s.
       */
      id: 'r2Cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous call',
      condition: { field: 'operation', value: 'list_r2_buckets' },
      mode: 'advanced',
    },
    {
      id: 'rulesetCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous call',
      condition: { field: 'operation', value: 'list_rulesets' },
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
      condition: { field: 'operation', value: 'list_r2_buckets' },
      mode: 'advanced',
    },

    // Workers inputs
    {
      id: 'scriptName',
      title: 'Script Name',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Worker script name',
      condition: { field: 'operation', value: 'get_worker_script_settings' },
    },
    {
      id: 'workerTagFilter',
      title: 'Tag Filter',
      type: 'short-input',
      placeholder: 'Filter scripts by tag',
      condition: { field: 'operation', value: 'list_worker_scripts' },
      mode: 'advanced',
    },

    // Tunnel inputs
    {
      id: 'tunnelId',
      title: 'Tunnel ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter tunnel ID',
      condition: { field: 'operation', value: ['get_tunnel', 'get_tunnel_configuration'] },
    },
    {
      id: 'tunnelStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Healthy', id: 'healthy' },
        { label: 'Degraded', id: 'degraded' },
        { label: 'Down', id: 'down' },
        { label: 'Inactive', id: 'inactive' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_tunnels' },
      mode: 'advanced',
    },
    {
      id: 'uuid',
      title: 'Tunnel UUID',
      type: 'short-input',
      placeholder: 'Filter by tunnel UUID',
      condition: { field: 'operation', value: 'list_tunnels' },
      mode: 'advanced',
    },
    {
      id: 'is_deleted',
      title: 'Show Deleted Tunnels',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_tunnels' },
      mode: 'advanced',
    },
    {
      id: 'include_prefix',
      title: 'Include Name Prefix',
      type: 'short-input',
      placeholder: 'Only tunnels whose name starts with this prefix',
      condition: { field: 'operation', value: 'list_tunnels' },
      mode: 'advanced',
    },
    {
      id: 'exclude_prefix',
      title: 'Exclude Name Prefix',
      type: 'short-input',
      placeholder: 'Skip tunnels whose name starts with this prefix',
      condition: { field: 'operation', value: 'list_tunnels' },
      mode: 'advanced',
    },
    {
      id: 'existed_at',
      title: 'Existed At',
      type: 'short-input',
      placeholder: 'RFC 3339 timestamp',
      condition: { field: 'operation', value: 'list_tunnels' },
      mode: 'advanced',
    },
    {
      id: 'was_active_at',
      title: 'Was Active At',
      type: 'short-input',
      placeholder: 'RFC 3339 timestamp',
      condition: { field: 'operation', value: 'list_tunnels' },
      mode: 'advanced',
    },
    {
      id: 'was_inactive_at',
      title: 'Was Inactive At',
      type: 'short-input',
      placeholder: 'RFC 3339 timestamp',
      condition: { field: 'operation', value: 'list_tunnels' },
      mode: 'advanced',
    },

    // Shared pagination for the new list operations
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (default: 1)',
      condition: {
        field: 'operation',
        value: [
          'list_access_applications',
          'list_access_policies',
          'list_access_groups',
          'list_access_service_tokens',
          'list_tunnels',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'per_page',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Results per page',
      condition: {
        field: 'operation',
        value: [
          'list_access_applications',
          'list_access_policies',
          'list_access_groups',
          'list_access_service_tokens',
          'list_r2_buckets',
          'list_rulesets',
          'list_tunnels',
        ],
      },
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
      'cloudflare_list_rulesets',
      'cloudflare_get_ruleset',
      'cloudflare_get_ruleset_entrypoint',
      'cloudflare_create_ruleset',
      'cloudflare_create_ruleset_rule',
      'cloudflare_update_ruleset_rule',
      'cloudflare_delete_ruleset_rule',
      'cloudflare_list_managed_ruleset_overrides',
      'cloudflare_list_rate_limit_rules',
      'cloudflare_create_rate_limit_rule',
      'cloudflare_update_rate_limit_rule',
      'cloudflare_list_access_applications',
      'cloudflare_get_access_application',
      'cloudflare_create_access_application',
      'cloudflare_update_access_application',
      'cloudflare_delete_access_application',
      'cloudflare_list_access_policies',
      'cloudflare_create_access_policy',
      'cloudflare_update_access_policy',
      'cloudflare_delete_access_policy',
      'cloudflare_list_access_groups',
      'cloudflare_list_access_identity_providers',
      'cloudflare_list_access_service_tokens',
      'cloudflare_create_access_service_token',
      'cloudflare_revoke_access_service_token',
      'cloudflare_list_r2_buckets',
      'cloudflare_get_r2_bucket',
      'cloudflare_create_r2_bucket',
      'cloudflare_delete_r2_bucket',
      'cloudflare_list_worker_scripts',
      'cloudflare_get_worker_script_settings',
      'cloudflare_list_worker_routes',
      'cloudflare_list_tunnels',
      'cloudflare_get_tunnel',
      'cloudflare_get_tunnel_configuration',
    ],
    config: {
      tool: (params) => `cloudflare_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = { ...params }
        const operation = typeof result.operation === 'string' ? result.operation : ''

        for (const [toolParam, aliasId] of Object.entries(SUBBLOCK_ALIASES[operation] ?? {})) {
          result[toolParam] = result[aliasId]
        }
        /**
         * The executor merges this mapper's output over the raw inputs
         * (`finalInputs = { ...inputs, ...transformedParams }` in
         * `executor/handlers/generic/generic-handler.ts`), so a key this mapper
         * merely omits survives as its raw subBlock string. Every alias id must
         * therefore be assigned `undefined` rather than destructured away.
         */
        for (const aliasId of ALIASED_SUBBLOCK_IDS) {
          result[aliasId] = undefined
        }

        if (result.proxied === 'true') result.proxied = true
        else if (result.proxied === 'false') result.proxied = false
        else if (result.proxied === '') result.proxied = undefined

        if (result.purge_everything === 'true') result.purge_everything = true
        else if (result.purge_everything === 'false') result.purge_everything = false

        /**
         * `tags`, `hosts`, and `prefixes` are advanced controls, and an advanced
         * control serializes on stored value alone — the serializer returns
         * `isNonEmptyValue(...)` before it ever evaluates the
         * `and: { field: 'purge_everything', not: true }` guard
         * (`serializer/index.ts`). So a target typed while purging specific
         * content survives the switch to "Purge Everything", and the tool then
         * refuses the whole purge over a field the editor no longer renders.
         * This mapper is the only layer that can override a stale raw input.
         */
        if (operation === 'purge_cache' && result.purge_everything === true) {
          result.files = undefined
          result.tags = undefined
          result.hosts = undefined
          result.prefixes = undefined
        }

        if (result.type === '') result.type = undefined
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

        /**
         * A blank optional number must reach the tool as `undefined`, not as
         * `Number('')` — which is `0`, a value the tools then forward because
         * they test presence rather than truthiness. `0` is out of range for
         * `ttl` and silently rewrites an MX record's `priority`.
         */
        const numericFields = [
          'ttl',
          'priority',
          'limit',
          'page',
          'per_page',
          'period',
          'requestsPerPeriod',
          'mitigationTimeout',
          'precedence',
        ] as const
        for (const field of numericFields) {
          if (result[field] === '' || result[field] == null) {
            result[field] = undefined
          } else {
            result[field] = Number(result[field])
          }
        }

        const booleanFields = [
          'enabled',
          'exact',
          'appLauncherVisible',
          'autoRedirectToIdentity',
          'approvalRequired',
          'isolationRequired',
          'purposeJustificationRequired',
          'requestsToOrigin',
          'is_deleted',
        ] as const
        for (const field of booleanFields) {
          if (result[field] === 'true') result[field] = true
          else if (result[field] === 'false') result[field] = false
          else if (result[field] === '') result[field] = undefined
        }

        const optionalStringFields = [
          'phase',
          'action',
          'locationHint',
          'storageClass',
          'jurisdiction',
        ] as const
        for (const field of optionalStringFields) {
          if (result[field] === '') result[field] = undefined
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
    zoneType: {
      type: 'string',
      description:
        'Zone type to create (full, partial, or secondary). Cloudflare also defines an internal type, which is not creatable here but can appear on zones returned by reads',
    },
    order: { type: 'string', description: 'Sort field when listing zones' },
    direction: { type: 'string', description: 'Sort direction (asc, desc)' },
    match: { type: 'string', description: 'Match logic for filters (any, all)' },
    recordId: { type: 'string', description: 'DNS record ID' },
    name: { type: 'string', description: 'Domain or record name' },
    type: { type: 'string', description: 'DNS record type' },
    recordType: { type: 'string', description: 'DNS record type for record creation' },
    recordProxied: {
      type: 'string',
      description: 'Whether the created DNS record is proxied through Cloudflare',
    },
    certificateStatus: { type: 'string', description: 'Certificate pack status filter' },
    dnsOrder: { type: 'string', description: 'Sort field when listing DNS records' },
    recordTags: { type: 'string', description: 'Tags applied to a created DNS record' },
    updateRecordType: {
      type: 'string',
      description: 'Record type a replaced DNS record ends up with',
    },
    updateRecordName: {
      type: 'string',
      description: 'Record name a replaced DNS record ends up with',
    },
    updateRecordContent: {
      type: 'string',
      description: 'Content a replaced DNS record ends up with',
    },
    updateRecordProxied: {
      type: 'string',
      description: 'Whether a replaced DNS record ends up proxied through Cloudflare',
    },
    updateRecordTags: { type: 'string', description: 'Tags a replaced DNS record ends up with' },
    updateRuleEnabled: {
      type: 'string',
      description: 'Whether a replaced WAF or rate limiting rule ends up enabled',
    },
    r2Cursor: { type: 'string', description: 'Pagination cursor when listing R2 buckets' },
    rulesetCursor: { type: 'string', description: 'Pagination cursor when listing rulesets' },
    workerTagFilter: { type: 'string', description: 'Tag filter when listing Worker scripts' },
    accessAppTags: { type: 'string', description: 'Tag names applied to an Access application' },
    listNameFilter: {
      type: 'string',
      description:
        'Name filter shared by the Access application, group, service token, and tunnel list operations',
    },
    accessAppDomainFilter: {
      type: 'string',
      description: 'Domain filter when listing Access applications',
    },
    tunnelStatus: { type: 'string', description: 'Status filter when listing tunnels' },

    appType: { type: 'string', description: 'Access application type' },
    updateAppType: {
      type: 'string',
      description: 'Access application type a replaced application ends up with',
    },
    updatePolicyDecision: {
      type: 'string',
      description: 'Decision a replaced Access policy ends up applying',
    },
    rateLimitAction: {
      type: 'string',
      description: 'Action applied once a rate limit is exceeded',
    },
    updateRateLimitAction: {
      type: 'string',
      description: 'Action a replaced rate limiting rule ends up applying',
    },
    content: { type: 'string', description: 'DNS record content' },
    ttl: { type: 'number', description: 'Time to live in seconds' },
    proxied: { type: 'boolean', description: 'Whether Cloudflare proxy is enabled' },
    priority: {
      type: 'number',
      description:
        'Record priority. Cloudflare accepts this top-level field for MX and URI records only; an SRV record carries its priority inside the record content instead',
    },
    comment: { type: 'string', description: 'Record comment' },
    search: { type: 'string', description: 'Free-text search across record properties' },
    tag: { type: 'string', description: 'Filter by an exact tag name' },
    tag_match: { type: 'string', description: 'Tag filter match logic (any, all)' },
    commentFilter: { type: 'string', description: 'Filter records by comment content' },
    settingId: { type: 'string', description: 'Zone setting ID' },
    settingIds: {
      type: 'string',
      description: 'Comma-separated zone setting IDs to read, or blank for the default set',
    },
    value: { type: 'string', description: 'Setting value' },
    since: { type: 'string', description: 'Start date for analytics' },
    until: { type: 'string', description: 'End date for analytics' },
    metrics: { type: 'string', description: 'Comma-separated metrics to retrieve' },
    dimensions: { type: 'string', description: 'Comma-separated dimensions to group by' },
    filters: { type: 'string', description: 'Filters to apply (e.g., queryType==A)' },
    sort: { type: 'string', description: 'Sort order for results' },
    limit: { type: 'number', description: 'Maximum number of results' },
    status: { type: 'string', description: 'Status filter when listing zones' },
    page: { type: 'number', description: 'Page number for pagination' },
    per_page: { type: 'number', description: 'Number of results per page' },
    deploy: {
      type: 'string',
      description: 'Filter certificates by deployment environment (staging, production)',
    },
    purge_everything: { type: 'boolean', description: 'Purge all cached content' },
    files: { type: 'string', description: 'Comma-separated URLs to purge' },
    tags: { type: 'string', description: 'Comma-separated DNS record tags' },
    hosts: { type: 'string', description: 'Comma-separated hostnames to purge (Enterprise only)' },
    prefixes: {
      type: 'string',
      description: 'Comma-separated URL prefixes to purge (Enterprise only)',
    },
    rulesetId: { type: 'string', description: 'Ruleset ID' },
    ruleId: { type: 'string', description: 'Rule ID within a ruleset' },
    phase: { type: 'string', description: 'Ruleset phase' },
    rulesetName: { type: 'string', description: 'Name for a newly created ruleset' },
    kind: { type: 'string', description: 'Ruleset kind for ruleset creation' },
    rules: { type: 'string', description: 'JSON array of rules to seed a new ruleset with' },
    action: { type: 'string', description: 'Action a rule performs' },
    expression: { type: 'string', description: 'Cloudflare filter expression' },
    description: { type: 'string', description: 'Rule description' },
    enabled: { type: 'boolean', description: 'Whether the rule is enabled' },
    ref: { type: 'string', description: 'Rule reference tag' },
    actionParameters: { type: 'string', description: 'JSON action parameters for a rule' },
    rateLimitActionParameters: {
      type: 'string',
      description: 'JSON action parameters a replaced rate limiting rule ends up with',
    },
    ratelimit: {
      type: 'string',
      description: 'JSON rate limiting configuration to preserve when replacing a rule',
    },
    logging: {
      type: 'string',
      description: 'JSON logging configuration to preserve when replacing a rule',
    },
    position: { type: 'string', description: 'JSON position object for a new rule' },
    characteristics: {
      type: 'string',
      description: 'Comma-separated rate limiting counting characteristics',
    },
    period: { type: 'number', description: 'Rate limiting counting period in seconds' },
    requestsPerPeriod: {
      type: 'number',
      description: 'Requests allowed within the rate limiting period',
    },
    mitigationTimeout: {
      type: 'number',
      description: 'Seconds the rate limiting action stays applied',
    },
    counting_expression: {
      type: 'string',
      description: 'Expression selecting which requests are counted',
    },
    requestsToOrigin: {
      type: 'boolean',
      description: 'Whether only requests reaching the origin are counted',
    },
    appId: { type: 'string', description: 'Access application ID' },
    policyId: { type: 'string', description: 'Access policy ID' },
    serviceTokenId: { type: 'string', description: 'Access service token ID' },
    domain: { type: 'string', description: 'Hostname and path secured by Access' },
    aud: { type: 'string', description: 'Access application audience tag' },
    exact: { type: 'boolean', description: 'Whether Access list filters must match exactly' },
    sessionDuration: { type: 'string', description: 'Access session duration' },
    allowedIdps: { type: 'string', description: 'Comma-separated identity provider IDs' },
    appLauncherVisible: {
      type: 'boolean',
      description: 'Whether the application appears in the App Launcher',
    },
    autoRedirectToIdentity: {
      type: 'boolean',
      description: 'Whether users skip the identity provider picker',
    },
    customDenyMessage: { type: 'string', description: 'Message shown when access is denied' },
    customDenyUrl: { type: 'string', description: 'URL denied users are redirected to' },
    logoUrl: { type: 'string', description: 'Application logo URL' },
    policies: { type: 'string', description: 'JSON array of policies to attach' },
    saasApp: {
      type: 'string',
      description: 'JSON SaaS configuration for a saas-typed Access application',
    },
    targetCriteria: {
      type: 'string',
      description: 'JSON target criteria for an infrastructure- or rdp-typed Access application',
    },
    decision: { type: 'string', description: 'Access policy decision' },
    include: { type: 'string', description: 'JSON array of Access rules evaluated with OR logic' },
    exclude: { type: 'string', description: 'JSON array of Access rules evaluated with NOT logic' },
    require: { type: 'string', description: 'JSON array of Access rules evaluated with AND logic' },
    precedence: { type: 'number', description: 'Access policy evaluation order' },
    approvalRequired: {
      type: 'boolean',
      description: 'Whether an approver must grant each access request',
    },
    isolationRequired: {
      type: 'boolean',
      description: 'Whether sessions must run in a remote isolated browser',
    },
    purposeJustificationRequired: {
      type: 'boolean',
      description: 'Whether users must state a reason for access',
    },
    purposeJustificationPrompt: {
      type: 'string',
      description: 'Prompt shown when a justification is required',
    },
    duration: { type: 'string', description: 'Service token lifetime' },
    bucketName: { type: 'string', description: 'R2 bucket name' },
    locationHint: { type: 'string', description: 'R2 bucket location hint' },
    storageClass: { type: 'string', description: 'R2 default storage class' },
    jurisdiction: { type: 'string', description: 'R2 data-residency jurisdiction' },
    name_contains: { type: 'string', description: 'Filter R2 buckets by name substring' },
    start_after: { type: 'string', description: 'R2 bucket name to start listing after' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    scriptName: { type: 'string', description: 'Workers script name' },
    tunnelId: { type: 'string', description: 'Cloudflare Tunnel ID' },
    uuid: { type: 'string', description: 'Filter tunnels by UUID' },
    is_deleted: { type: 'boolean', description: 'Whether to return deleted tunnels' },
    include_prefix: { type: 'string', description: 'Only include tunnels with this name prefix' },
    exclude_prefix: { type: 'string', description: 'Exclude tunnels with this name prefix' },
    existed_at: { type: 'string', description: 'Return tunnels that existed at this timestamp' },
    was_active_at: {
      type: 'string',
      description: 'Return tunnels that were active at this timestamp',
    },
    was_inactive_at: {
      type: 'string',
      description: 'Return tunnels that were inactive at this timestamp',
    },
  },
  outputs: {
    zones: { type: 'json', description: 'List of zones/domains' },
    records: { type: 'json', description: 'List of DNS records' },
    certificates: { type: 'json', description: 'List of SSL/TLS certificate packs' },
    settings: { type: 'json', description: 'List of zone settings' },
    unreadable: {
      type: 'json',
      description: 'Requested zone settings Cloudflare refused, with the reason for each',
    },
    totals: { type: 'json', description: 'Aggregate DNS analytics totals' },
    min: {
      type: 'json',
      description:
        'Per-metric DNS analytics minimums. Cloudflare documents this as currently always an empty object',
    },
    max: {
      type: 'json',
      description:
        'Per-metric DNS analytics maximums. Cloudflare documents this as currently always an empty object',
    },
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
    priority: { type: 'number', description: 'Record priority, returned for MX and URI records' },
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
    time_remaining: {
      type: 'number',
      description:
        'Development mode countdown in seconds — documented only on the zones_development_mode setting, positive until it expires and negative afterwards',
    },
    total_count: { type: 'number', description: 'Total count of results' },
    rulesets: { type: 'json', description: 'Rulesets defined on the zone' },
    rules: { type: 'json', description: 'Rules contained in a ruleset, in evaluation order' },
    kind: { type: 'string', description: 'Ruleset kind (managed, custom, root, or zone)' },
    description: { type: 'string', description: 'Ruleset, rule, or resource description' },
    phase: { type: 'string', description: 'Phase the ruleset runs in' },
    version: { type: 'string', description: 'Ruleset or rule version' },
    last_updated: { type: 'string', description: 'RFC 3339 timestamp of the last change' },
    ruleset_id: { type: 'string', description: 'Entry point ruleset ID' },
    deployments: {
      type: 'json',
      description: 'Managed rulesets deployed on the zone and their overrides',
    },
    applications: { type: 'json', description: 'Access applications in the account' },
    policies: { type: 'json', description: 'Access policies' },
    groups: { type: 'json', description: 'Access groups in the account' },
    identity_providers: { type: 'json', description: 'Access identity providers in the account' },
    service_tokens: { type: 'json', description: 'Access service tokens in the account' },
    domain: { type: 'string', description: 'Hostname and path secured by Access' },
    aud: { type: 'string', description: 'Access application audience tag' },
    session_duration: { type: 'string', description: 'How long an Access session stays valid' },
    allowed_idps: { type: 'json', description: 'Identity provider IDs allowed on the application' },
    app_launcher_visible: {
      type: 'boolean',
      description: 'Whether the application appears in the App Launcher',
    },
    auto_redirect_to_identity: {
      type: 'boolean',
      description: 'Whether users skip the identity provider picker',
    },
    custom_deny_message: { type: 'string', description: 'Message shown when access is denied' },
    custom_deny_url: { type: 'string', description: 'URL denied users are redirected to' },
    logo_url: { type: 'string', description: 'Application logo URL' },
    self_hosted_domains: {
      type: 'json',
      description: 'Additional hostnames and paths secured by the application',
    },
    destinations: { type: 'json', description: 'Destinations secured by the application' },
    decision: { type: 'string', description: 'Access policy decision' },
    precedence: { type: 'number', description: 'Access policy evaluation order' },
    include: { type: 'json', description: 'Access rules evaluated with OR logic' },
    exclude: { type: 'json', description: 'Access rules evaluated with NOT logic' },
    require: { type: 'json', description: 'Access rules evaluated with AND logic' },
    approval_required: {
      type: 'boolean',
      description: 'Whether an approver must grant each access request',
    },
    isolation_required: {
      type: 'boolean',
      description: 'Whether sessions must run in a remote isolated browser',
    },
    purpose_justification_required: {
      type: 'boolean',
      description: 'Whether users must state a reason for access',
    },
    purpose_justification_prompt: {
      type: 'string',
      description: 'Prompt shown when a justification is required',
    },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    client_id: { type: 'string', description: 'Service token client ID' },
    client_secret: {
      type: 'string',
      description: 'Service token client secret, returned only once at creation',
    },
    expires_at: { type: 'string', description: 'Service token expiry timestamp' },
    last_seen_at: { type: 'string', description: 'When the service token was last used' },
    duration: { type: 'string', description: 'Service token lifetime' },
    enabled: { type: 'boolean', description: 'Whether the resource is enabled' },
    buckets: { type: 'json', description: 'R2 buckets in the account' },
    creation_date: { type: 'string', description: 'R2 bucket creation timestamp' },
    location: { type: 'string', description: 'R2 bucket location' },
    storage_class: { type: 'string', description: 'R2 bucket default storage class' },
    jurisdiction: { type: 'string', description: 'R2 data-residency jurisdiction' },
    cursor: { type: 'string', description: 'Pagination cursor for the next page' },
    scripts: { type: 'json', description: 'Workers scripts in the account' },
    routes: { type: 'json', description: 'Workers routes on the zone' },
    bindings: { type: 'json', description: 'Resource bindings available to a Workers script' },
    compatibility_date: { type: 'string', description: 'Workers runtime compatibility date' },
    compatibility_flags: { type: 'json', description: 'Workers runtime compatibility flags' },
    limits: { type: 'json', description: 'Workers execution limits' },
    logpush: { type: 'boolean', description: 'Whether Workers Logpush is enabled' },
    migrations: { type: 'json', description: 'Durable Object migrations' },
    observability: { type: 'json', description: 'Workers observability configuration' },
    placement: { type: 'json', description: 'Workers smart placement configuration' },
    tail_consumers: { type: 'json', description: 'Workers consuming tail events' },
    usage_model: { type: 'string', description: 'Workers billing usage model' },
    tunnels: { type: 'json', description: 'Cloudflare Tunnels in the account' },
    tunnel_id: { type: 'string', description: 'Tunnel the configuration belongs to' },
    account_id: { type: 'string', description: 'Account the tunnel belongs to' },
    account_tag: { type: 'string', description: 'Account tag the tunnel belongs to' },
    config: { type: 'json', description: 'Tunnel ingress and origin request configuration' },
    config_src: { type: 'string', description: 'Where the tunnel configuration is managed' },
    source: { type: 'string', description: 'Where the tunnel configuration is managed' },
    tun_type: { type: 'string', description: 'Tunnel type' },
    remote_config: { type: 'boolean', description: 'Whether the tunnel is remotely managed' },
    deleted_at: { type: 'string', description: 'Tunnel deletion timestamp' },
    conns_active_at: {
      type: 'string',
      description: 'When the tunnel last had active connections',
    },
    conns_inactive_at: {
      type: 'string',
      description: 'When the tunnel last lost all connections',
    },
    connections: { type: 'json', description: 'Active connector connections for the tunnel' },
  },
}

/**
 * Tool param names an alias may safely read a stored value back from.
 *
 * A value sitting under the bare param name is a workflow saved before that
 * control was renamed — unless a control still claims the name and could have
 * put the value there itself. Two claims disqualify a name:
 *
 * - a `mode: 'advanced'` control, because `shouldSerializeSubBlock` serializes
 *   one on stored value alone, before its `condition` runs, so the value may be
 *   another operation's hidden field bleeding across;
 * - a control with a seeded default, because block state is seeded by subBlock
 *   id whatever the selected operation, so the value may be a default nobody
 *   chose (`decision` reads back as `allow` from the create-policy control).
 *
 * Excluding both keeps the legacy read from re-opening what the aliases closed.
 */
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
      title: 'Cloudflare cache purge on deploy',
      prompt:
        'Build a workflow that fires when a Vercel deployment succeeds on production, purges the Cloudflare cache for the affected hostnames, verifies the new content is being served, and posts a confirmation message to Slack with the purged paths.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['vercel', 'slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cloudflare SSL and zone check',
      prompt:
        'Create a scheduled weekly workflow that inspects every Cloudflare zone for SSL certificate status, security level, and zone settings drift, logs findings to a table, and opens Linear tickets for any zones that need attention.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'enterprise'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cloudflare DNS analytics digest',
      prompt:
        'Build a scheduled workflow that pulls Cloudflare DNS analytics for the top zones every Monday, identifies query spikes, anomalies, and surges in particular record types, and emails a written analysis to the platform team with traffic graphs and recommendations.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'analysis'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cloudflare zone provisioning',
      prompt:
        'Create a workflow that accepts a domain name from a form, creates a new Cloudflare zone, sets opinionated default DNS records and zone settings, generates the nameserver instructions, and posts the setup summary to Slack so the team can finalize delegation.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cloudflare DNS bulk importer',
      prompt:
        'Build a workflow that reads a table of DNS records — name, type, content, TTL — validates each row, creates or updates the matching record in Cloudflare, and writes results back to the table so DNS changes are versioned and reviewable.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cloudflare zone policy enforcer',
      prompt:
        'Create a scheduled workflow that reads a baseline of required Cloudflare zone settings from a knowledge base, compares it against every zone weekly, automatically reverts unauthorized changes, and emails a compliance report to security leadership.',
      modules: ['knowledge-base', 'scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'monitoring'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cloudflare WAF and rate limit rollout',
      prompt:
        'Build a workflow that reads a table of WAF rules — expression, action, and rate limit — validates each row against the zone it targets, deploys it into the matching Cloudflare ruleset phase, and posts a Slack summary of every rule created, changed, or skipped.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'security', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CloudflareIcon,
      title: 'Cloudflare Zero Trust access review',
      prompt:
        'Create a scheduled monthly workflow that lists every Cloudflare Access application and its policies, flags applications with no policy, overly broad email-domain rules, or bypass decisions, logs the findings to a table, and emails an access review to security leadership.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['security', 'enterprise', 'monitoring'],
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
    {
      name: 'deploy-waf-custom-rule',
      description:
        'Add a WAF custom rule to a Cloudflare zone through the Rulesets engine, blocking or challenging traffic that matches a filter expression.',
      content:
        '# Deploy a WAF Custom Rule\n\nWAF custom rules live in the `http_request_firewall_custom` phase of the Rulesets engine, so the ruleset ID has to be resolved before a rule can be added.\n\n## Steps\n1. Resolve the zone ID for the target domain.\n2. Read the `http_request_firewall_custom` phase entry point ruleset for that zone to get its ruleset ID and current rules.\n3. Write the filter expression for the traffic to act on (e.g. `(ip.src.country in {"GB" "FR"})` or `(http.request.uri.path matches "^/admin")`).\n4. Create the rule in that ruleset with the chosen action — `block`, `managed_challenge`, `js_challenge`, `challenge`, `skip`, or `log`. Start with `log` to observe impact before enforcing.\n5. Read the ruleset back and confirm the new rule appears in the intended evaluation order.\n\n## Output\nThe ruleset ID, the new rule ID, its expression and action, and its position in the evaluation order.\n\n## Cautions\nRules take effect on live traffic immediately. A broad expression with `block` can lock out legitimate users, so verify the expression in `log` mode first.',
    },
    {
      name: 'rate-limit-an-api-endpoint',
      description:
        'Protect an API path from abuse with a Cloudflare rate limiting rule using the current Rulesets-based rate limiting API.',
      content:
        '# Rate Limit an API Endpoint\n\nRate limiting rules are rules in the `http_ratelimit` phase entry point ruleset. The legacy `rate_limits` endpoint is no longer the way to do this.\n\n## Steps\n1. Resolve the zone ID for the domain serving the API.\n2. List the existing rate limiting rules to get the `http_ratelimit` entry point ruleset ID and see what is already in place.\n3. Decide the counting characteristics. `cf.colo.id` is mandatory. `ip.src` (per IP) and `cf.unique_visitor_id` (per visitor) are mutually exclusive - include at most one, and neither is required; a rule keyed on host, path, country, header or cookie alone is valid. Add `http.request.headers["<name>"]` to count per API key.\n4. Pick a counting period (10, 60, 120, 300, 600, or 3600 seconds) and the request allowance for that period.\n5. Create the rule with the matching expression (e.g. `(http.request.uri.path matches "^/api/")`), the counting configuration, and the mitigation action.\n6. Read the rules back and confirm the new rule and its limit.\n\n## Output\nThe ruleset ID, the new rule ID, the expression, and the effective limit (requests per period, characteristics, and mitigation timeout).\n\n## Cautions\nThe rule applies to live traffic as soon as it is created. Size the allowance against real traffic before choosing `block` over `log` or `managed_challenge`.',
    },
    {
      name: 'review-zero-trust-access',
      description:
        'Audit Cloudflare Access applications and their policies to find unprotected apps, over-broad rules, and bypass decisions.',
      content:
        '# Review Zero Trust Access\n\nAccess applications and policies are account-scoped. An application with no policy denies everyone; a broad `allow` policy lets in more than intended.\n\n## Steps\n1. List the Access applications in the account.\n2. For each application, list its policies in precedence order.\n3. List the configured identity providers so `allowed_idps` values can be read as names rather than IDs.\n4. Flag applications with no policies, `allow` policies whose include rules are a whole email domain or `everyone`, any `bypass` decision, and applications with no `allowed_idps` restriction.\n5. Note session durations that are longer than the organization allows.\n\n## Output\nA per-application summary of domain, type, identity providers, policy decisions and include rules, and the flagged findings ranked by risk.',
    },
  ],
} as const satisfies BlockMeta
