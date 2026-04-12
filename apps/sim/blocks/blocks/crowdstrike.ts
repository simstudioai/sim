import { CrowdStrikeIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { CrowdStrikeResponse } from '@/tools/crowdstrike/types'

const FILTER_OPERATIONS = [
  'crowdstrike_query_sensors',
  'crowdstrike_query_crowdscore',
  'crowdstrike_query_incidents',
  'crowdstrike_query_behaviors',
]
const LIMIT_OFFSET_OPERATIONS = [
  'crowdstrike_query_behaviors',
  'crowdstrike_query_crowdscore',
  'crowdstrike_query_incidents',
  'crowdstrike_query_sensors',
]
const SORT_OPERATIONS = [
  'crowdstrike_query_behaviors',
  'crowdstrike_query_crowdscore',
  'crowdstrike_query_incidents',
  'crowdstrike_query_sensors',
]

export const CrowdStrikeBlock: BlockConfig<CrowdStrikeResponse> = {
  type: 'crowdstrike',
  name: 'CrowdStrike',
  description: 'Search Falcon sensors, CrowdScore, incidents, and behaviors',
  longDescription:
    'Integrate CrowdStrike Falcon into workflows to search identity sensors, environment CrowdScore, incidents, and behaviors using documented Falcon query endpoints.',
  docsLink: 'https://docs.sim.ai/tools/crowdstrike',
  category: 'tools',
  integrationType: IntegrationType.Security,
  tags: ['monitoring', 'incident-management'],
  bgColor: '#E01F3D',
  icon: CrowdStrikeIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Identity Sensors', id: 'crowdstrike_query_sensors' },
        { label: 'Get CrowdScore', id: 'crowdstrike_query_crowdscore' },
        { label: 'Search Incidents', id: 'crowdstrike_query_incidents' },
        { label: 'Search Behaviors', id: 'crowdstrike_query_behaviors' },
      ],
      value: () => 'crowdstrike_query_sensors',
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
      placeholder: 'hostname:"server-01" or status:30',
      condition: {
        field: 'operation',
        value: FILTER_OPERATIONS,
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a CrowdStrike Falcon Query Language filter string for the selected operation. Use exact field names, operators, and values only. Return ONLY the filter string - no explanations, no extra text.',
        placeholder:
          'Describe the CrowdStrike records you want to filter, for example "sensors with hostnames starting with web" or "incidents in progress"...',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: LIMIT_OFFSET_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: LIMIT_OFFSET_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'sort',
      title: 'Sort',
      type: 'short-input',
      placeholder: 'created_timestamp.asc',
      condition: { field: 'operation', value: SORT_OPERATIONS },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'crowdstrike_query_behaviors',
      'crowdstrike_query_crowdscore',
      'crowdstrike_query_incidents',
      'crowdstrike_query_sensors',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const mapped: Record<string, unknown> = {
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          cloud: params.cloud,
        }

        if (params.filter) mapped.filter = params.filter
        if (params.limit != null && params.limit !== '') mapped.limit = Number(params.limit)
        if (params.offset != null && params.offset !== '') mapped.offset = Number(params.offset)
        if (params.sort) mapped.sort = params.sort

        return mapped
      },
    },
  },

  inputs: {
    clientId: { type: 'string', description: 'CrowdStrike Falcon API client ID' },
    clientSecret: { type: 'string', description: 'CrowdStrike Falcon API client secret' },
    cloud: { type: 'string', description: 'CrowdStrike Falcon cloud region' },
    filter: { type: 'string', description: 'Falcon Query Language filter' },
    limit: { type: 'string', description: 'Maximum number of records to return' },
    offset: { type: 'string', description: 'Pagination offset' },
    sort: { type: 'string', description: 'Sort expression' },
  },

  outputs: {
    sensors: {
      type: 'json',
      description:
        'CrowdStrike identity sensor summaries (agentId, hostname, ipAddress, macAddress)',
    },
    crowdScores: {
      type: 'json',
      description: 'CrowdStrike CrowdScore entities (entityId, entityType, score, lastUpdated)',
    },
    incidents: {
      type: 'json',
      description:
        'CrowdStrike incident summaries (incidentId, name, createdTimestamp, status, severity)',
    },
    behaviors: {
      type: 'json',
      description:
        'CrowdStrike behavior summaries (behaviorId, incidentId, name, createdTimestamp)',
    },
    pagination: {
      type: 'json',
      description: 'Pagination metadata (offset, limit, total, expiresAt) for paginated responses',
    },
    count: { type: 'number', description: 'Number of records returned by the selected operation' },
  },
}
