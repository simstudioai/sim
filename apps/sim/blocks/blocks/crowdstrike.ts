import { CrowdStrikeIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalJsonInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { CrowdStrikeResponse } from '@/tools/crowdstrike/types'

export const CrowdStrikeBlock: BlockConfig<CrowdStrikeResponse> = {
  type: 'crowdstrike',
  name: 'CrowdStrike',
  description: 'Query CrowdStrike Identity Protection sensors and documented aggregates',
  longDescription:
    'Integrate CrowdStrike Identity Protection into workflows to search sensors, fetch documented sensor details by device ID, and run documented sensor aggregate queries.',
  docsLink: 'https://docs.sim.ai/integrations/crowdstrike',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#E01F3D',
  iconColor: '#E01F3D',
  icon: CrowdStrikeIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query Sensors', id: 'crowdstrike_query_sensors' },
        { label: 'Get Sensor Details', id: 'crowdstrike_get_sensor_details' },
        { label: 'Get Sensor Aggregates', id: 'crowdstrike_get_sensor_aggregates' },
      ],
      value: () => 'crowdstrike_query_sensors',
      required: true,
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'CrowdStrike Falcon API client ID',
      required: true,
    },
    {
      id: 'clientSecret',
      title: 'Client Secret',
      type: 'short-input',
      password: true,
      placeholder: 'CrowdStrike Falcon API client secret',
      required: true,
    },
    {
      id: 'cloud',
      title: 'Cloud Region',
      type: 'dropdown',
      options: [
        { label: 'US-1', id: 'us-1' },
        { label: 'US-2', id: 'us-2' },
        { label: 'EU-1', id: 'eu-1' },
        { label: 'US-GOV-1', id: 'us-gov-1' },
        { label: 'US-GOV-2', id: 'us-gov-2' },
      ],
      value: () => 'us-1',
      required: true,
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'hostname:"server-01" or status:"protected"',
      condition: { field: 'operation', value: 'crowdstrike_query_sensors' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a CrowdStrike Identity Protection Falcon Query Language filter string for sensor search. Use exact field names, operators, and values only. Return ONLY the filter string - no explanations, no extra text.',
        placeholder:
          'Describe the sensors you want to search, for example "sensors with hostnames starting with web" or "sensors with protected status"...',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'crowdstrike_query_sensors' },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'crowdstrike_query_sensors' },
      mode: 'advanced',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'status.asc',
      condition: { field: 'operation', value: 'crowdstrike_query_sensors' },
      mode: 'advanced',
    },
    {
      id: 'ids',
      title: 'Sensor IDs',
      type: 'code',
      language: 'json',
      placeholder: '["device-id-1", "device-id-2"]',
      condition: { field: 'operation', value: 'crowdstrike_get_sensor_details' },
      required: { field: 'operation', value: 'crowdstrike_get_sensor_details' },
    },
    {
      id: 'aggregateQuery',
      title: 'Aggregate Query',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "field": "field_name",\n  "name": "aggregate_name",\n  "size": 10,\n  "type": "aggregate_type"\n}',
      condition: { field: 'operation', value: 'crowdstrike_get_sensor_aggregates' },
      required: { field: 'operation', value: 'crowdstrike_get_sensor_aggregates' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a CrowdStrike Identity Protection sensor aggregate query JSON object using documented aggregate body fields such as field, filter, size, sort, type, date_ranges, ranges, extended_bounds, and sub_aggregates. Return ONLY valid JSON.',
        placeholder:
          'Describe the aggregation you want to run, for example "count sensors by status"...',
        generationType: 'json-object',
      },
    },
  ],

  tools: {
    access: [
      'crowdstrike_get_sensor_aggregates',
      'crowdstrike_get_sensor_details',
      'crowdstrike_query_sensors',
    ],
    config: {
      tool: (params) =>
        typeof params.operation === 'string' ? params.operation : 'crowdstrike_query_sensors',
      params: (params) => {
        const mapped: Record<string, unknown> = {
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          cloud: params.cloud,
        }

        if (params.operation === 'crowdstrike_query_sensors') {
          if (params.filter) mapped.filter = params.filter

          const limit = parseOptionalNumberInput(params.limit, 'limit', {
            integer: true,
            max: 200,
            min: 1,
          })
          const offset = parseOptionalNumberInput(params.offset, 'offset', {
            integer: true,
            min: 0,
          })

          if (limit != null) mapped.limit = limit
          if (offset != null) mapped.offset = offset
          if (params.sort) mapped.sort = params.sort
        }

        if (params.operation === 'crowdstrike_get_sensor_details') {
          const ids = parseOptionalJsonInput(params.ids, 'sensor IDs')
          if (ids !== undefined) mapped.ids = ids
        }

        if (params.operation === 'crowdstrike_get_sensor_aggregates') {
          const aggregateQuery = parseOptionalJsonInput(params.aggregateQuery, 'aggregate query')
          if (aggregateQuery !== undefined) mapped.aggregateQuery = aggregateQuery
        }

        return mapped
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Selected CrowdStrike operation' },
    clientId: { type: 'string', description: 'CrowdStrike Falcon API client ID' },
    clientSecret: { type: 'string', description: 'CrowdStrike Falcon API client secret' },
    cloud: { type: 'string', description: 'CrowdStrike Falcon cloud region' },
    filter: { type: 'string', description: 'Falcon Query Language filter' },
    ids: { type: 'json', description: 'JSON array of CrowdStrike sensor device IDs' },
    aggregateQuery: {
      type: 'json',
      description: 'CrowdStrike sensor aggregate query body as JSON',
    },
    limit: { type: 'number', description: 'Maximum number of records to return' },
    offset: { type: 'number', description: 'Pagination offset' },
    sort: { type: 'string', description: 'Sort expression' },
  },

  outputs: {
    sensors: {
      type: 'json',
      description:
        'CrowdStrike identity sensor records (agentVersion, cid, deviceId, heartbeatTime, hostname, idpPolicyId, idpPolicyName, ipAddress, kerberosConfig, ldapConfig, ldapsConfig, machineDomain, ntlmConfig, osVersion, rdpToDcConfig, smbToDcConfig, status, statusCauses, tiEnabled)',
    },
    aggregates: {
      type: 'json',
      description:
        'CrowdStrike aggregate result groups (name, buckets, docCountErrorUpperBound, sumOtherDocCount)',
    },
    pagination: {
      type: 'json',
      description: 'Pagination metadata (limit, offset, total) for query responses',
    },
    count: { type: 'number', description: 'Number of records returned by the selected operation' },
  },
}

export const CrowdStrikeBlockMeta = {
  tags: ['identity', 'monitoring'],
  url: 'https://www.crowdstrike.com',
  templates: [
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike sensor coverage gaps',
      prompt:
        'Create a scheduled workflow that queries CrowdStrike Identity Protection sensors, identifies devices reporting an unprotected or degraded status, opens a PagerDuty incident for critical gaps, and posts the list to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty', 'slack'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike weekly sensor digest',
      prompt:
        'Create a scheduled weekly workflow that runs CrowdStrike sensor aggregate queries by status and OS version, summarizes coverage and unprotected counts, and writes a digest file for security leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike + Okta coverage check',
      prompt:
        'Build a workflow that lists CrowdStrike Identity Protection sensors and cross-references them with Okta users and devices to find accounts active on endpoints that have no protected sensor, then writes the findings to a security table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
      alsoIntegrations: ['okta'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike asset inventory',
      prompt:
        'Create a scheduled workflow that queries CrowdStrike Identity Protection sensors per device, identifies endpoints reporting an unprotected status, and writes the gap list to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike stale sensor finder',
      prompt:
        'Build a scheduled workflow that queries CrowdStrike sensors, flags devices whose last heartbeat is older than a threshold, and writes the stale-sensor list to a SOC investigation table for follow-up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike coverage report doc',
      prompt:
        'Create a scheduled workflow that aggregates CrowdStrike sensor status, OS version, and policy assignment, and generates a coverage report doc in Google Docs for the security team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'reporting'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: CrowdStrikeIcon,
      title: 'CrowdStrike policy drift watcher',
      prompt:
        'Build a scheduled workflow that queries CrowdStrike Identity Protection sensors, compares each device’s assigned IdP policy against the expected baseline, and writes mismatches to a SOC review queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'audit-identity-sensors',
      description:
        'Query CrowdStrike Identity Protection sensors and report on coverage, status, and devices missing protection.',
      content:
        '# Audit CrowdStrike Identity Sensors\n\nReview Identity Protection sensor coverage across the fleet.\n\n## Steps\n1. Query sensors, optionally filtered by status or hostname.\n2. For sensors of interest, pull detailed attributes (version, last seen, assigned policy).\n3. Flag sensors that are offline, stale, or out of policy.\n\n## Output\nA coverage report listing healthy sensors, plus any that are offline, stale, or misconfigured for SOC review.',
    },
    {
      name: 'summarize-sensor-aggregates',
      description:
        'Pull documented CrowdStrike sensor aggregates and summarize the fleet distribution by version, status, or platform.',
      content:
        '# Summarize CrowdStrike Sensor Aggregates\n\nBuild a high-level picture of the sensor fleet.\n\n## Steps\n1. Request the documented sensor aggregates (e.g. counts by version, status, or platform).\n2. Compute the distribution and identify outliers, such as a large share of outdated versions.\n3. Compare against the expected baseline.\n\n## Output\nA fleet summary with key counts and any segments that need attention (outdated, offline).',
    },
  ],
} as const satisfies BlockMeta
