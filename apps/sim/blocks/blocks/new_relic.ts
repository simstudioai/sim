import { NewRelicIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { NewRelicCustomAttributes, NewRelicResponse } from '@/tools/new_relic/types'

function parseCustomAttributes(value: unknown): NewRelicCustomAttributes | undefined {
  if (!value) return undefined
  if (typeof value !== 'string') return value as NewRelicCustomAttributes

  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    return JSON.parse(trimmed) as NewRelicCustomAttributes
  } catch (error) {
    throw new Error(
      `Invalid JSON for customAttributes: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export const NewRelicBlock: BlockConfig<NewRelicResponse> = {
  type: 'new_relic',
  name: 'New Relic',
  description: 'Query observability data and record deployments in New Relic',
  longDescription:
    'Integrate New Relic into workflows. Run NRQL queries, search monitored entities, fetch entity details, and record deployment change events.',
  docsLink: 'https://docs.sim.ai/tools/new_relic',
  category: 'tools',
  authMode: AuthMode.ApiKey,
  integrationType: IntegrationType.Analytics,
  tags: ['monitoring', 'data-analytics', 'incident-management'],
  bgColor: '#000000',
  icon: NewRelicIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run NRQL Query', id: 'new_relic_nrql_query' },
        { label: 'Search Entities', id: 'new_relic_search_entities' },
        { label: 'Get Entity', id: 'new_relic_get_entity' },
        { label: 'Create Deployment Event', id: 'new_relic_create_deployment_event' },
      ],
      value: () => 'new_relic_nrql_query',
    },
    {
      id: 'apiKey',
      title: 'User API Key',
      type: 'short-input',
      placeholder: 'NRAK-...',
      password: true,
      required: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'dropdown',
      options: [
        { label: 'US', id: 'us' },
        { label: 'EU', id: 'eu' },
      ],
      value: () => 'us',
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: '1234567',
      condition: { field: 'operation', value: 'new_relic_nrql_query' },
      required: true,
    },
    {
      id: 'nrql',
      title: 'NRQL Query',
      type: 'code',
      placeholder: 'SELECT count(*) FROM Transaction SINCE 1 hour ago',
      condition: { field: 'operation', value: 'new_relic_nrql_query' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a New Relic NRQL query based on the user's request.

Return ONLY the NRQL query - no explanations, no extra text.`,
        placeholder: 'Describe the New Relic data you want to query...',
      },
    },
    {
      id: 'timeout',
      title: 'Timeout (Seconds)',
      type: 'short-input',
      placeholder: '70',
      condition: { field: 'operation', value: 'new_relic_nrql_query' },
      mode: 'advanced',
    },
    {
      id: 'query',
      title: 'Entity Search Query',
      type: 'long-input',
      placeholder: 'name like "api" and domainType = "APM-APPLICATION"',
      condition: { field: 'operation', value: 'new_relic_search_entities' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a New Relic entity search query based on the user's request.

Examples:
name like "api"
domainType = "APM-APPLICATION"
reporting is false and lastReportingChangeAt > 1651708800000

Return ONLY the entity search query - no explanations, no extra text.`,
        placeholder: 'Describe the entities you want to find...',
      },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Next cursor from prior search',
      condition: { field: 'operation', value: 'new_relic_search_entities' },
      mode: 'advanced',
    },
    {
      id: 'guid',
      title: 'Entity GUID',
      type: 'short-input',
      placeholder: 'Entity GUID',
      condition: { field: 'operation', value: 'new_relic_get_entity' },
      required: true,
    },
    {
      id: 'entityGuid',
      title: 'Entity GUID',
      type: 'short-input',
      placeholder: 'Entity GUID',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      required: true,
    },
    {
      id: 'version',
      title: 'Version',
      type: 'short-input',
      placeholder: '1.2.3 or commit SHA',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      required: true,
    },
    {
      id: 'shortDescription',
      title: 'Short Description',
      type: 'short-input',
      placeholder: 'Deploy version 1.2.3',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a concise New Relic deployment change description based on the user's request.

Return ONLY the description text - no explanations, no extra text.`,
        placeholder: 'Describe the deployment...',
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Deployment details',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
    },
    {
      id: 'changelog',
      title: 'Changelog',
      type: 'long-input',
      placeholder: 'Release notes, summary, or changelog URL',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
    },
    {
      id: 'commit',
      title: 'Commit',
      type: 'short-input',
      placeholder: 'Commit SHA or build identifier',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
    },
    {
      id: 'deepLink',
      title: 'Deep Link',
      type: 'short-input',
      placeholder: 'https://github.com/org/repo/actions/runs/123',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
    },
    {
      id: 'user',
      title: 'User',
      type: 'short-input',
      placeholder: 'deploy-bot@example.com',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
    },
    {
      id: 'groupId',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'release-2026-05-19',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
    },
    {
      id: 'customAttributes',
      title: 'Custom Attributes',
      type: 'code',
      language: 'json',
      placeholder: '{"isProduction": true, "region": "us-east-1", "instances": 2}',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of New Relic change tracking custom attributes based on the user's request.
Use only string, number, and boolean values.

Return ONLY the JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the custom metadata to attach...',
        generationType: 'json-object',
      },
    },
    {
      id: 'deploymentType',
      title: 'Deployment Type',
      type: 'dropdown',
      options: [
        { label: 'Basic', id: 'basic' },
        { label: 'Blue Green', id: 'blue green' },
        { label: 'Canary', id: 'canary' },
        { label: 'Rolling', id: 'rolling' },
        { label: 'Shadow', id: 'shadow' },
      ],
      value: () => 'basic',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
    },
    {
      id: 'timestamp',
      title: 'Timestamp (Epoch ms)',
      type: 'short-input',
      placeholder: '1767225600000',
      condition: { field: 'operation', value: 'new_relic_create_deployment_event' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an epoch millisecond timestamp based on the user's request.

Return ONLY the numeric timestamp - no explanations, no extra text.`,
        placeholder: 'Describe the deployment time...',
        generationType: 'timestamp',
      },
    },
  ],
  tools: {
    access: [
      'new_relic_nrql_query',
      'new_relic_search_entities',
      'new_relic_get_entity',
      'new_relic_create_deployment_event',
    ],
    config: {
      tool: (params) => String(params.operation || 'new_relic_nrql_query'),
      params: (params) => {
        const baseParams = {
          apiKey: params.apiKey,
          region: params.region || 'us',
        }

        switch (params.operation) {
          case 'new_relic_nrql_query':
            return {
              ...baseParams,
              accountId: Number(params.accountId),
              nrql: params.nrql,
              timeout: params.timeout ? Number(params.timeout) : undefined,
            }

          case 'new_relic_search_entities':
            return {
              ...baseParams,
              query: params.query,
              cursor: params.cursor,
            }

          case 'new_relic_get_entity':
            return {
              ...baseParams,
              guid: params.guid,
            }

          case 'new_relic_create_deployment_event':
            return {
              ...baseParams,
              entityGuid: params.entityGuid,
              version: params.version,
              shortDescription: params.shortDescription,
              description: params.description,
              changelog: params.changelog,
              commit: params.commit,
              deepLink: params.deepLink,
              user: params.user,
              groupId: params.groupId,
              customAttributes: parseCustomAttributes(params.customAttributes),
              deploymentType: params.deploymentType,
              timestamp: params.timestamp ? Number(params.timestamp) : undefined,
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'New Relic user API key' },
    region: { type: 'string', description: 'New Relic data center region' },
    accountId: { type: 'number', description: 'New Relic account ID' },
    nrql: { type: 'string', description: 'NRQL query' },
    timeout: { type: 'number', description: 'Optional NRQL timeout in seconds' },
    query: { type: 'string', description: 'Entity search query' },
    cursor: { type: 'string', description: 'Entity search pagination cursor' },
    guid: { type: 'string', description: 'Entity GUID' },
    entityGuid: { type: 'string', description: 'Deployment entity GUID' },
    version: { type: 'string', description: 'Deployment version' },
    shortDescription: { type: 'string', description: 'Short deployment description' },
    description: { type: 'string', description: 'Deployment description' },
    changelog: { type: 'string', description: 'Deployment changelog text or URL' },
    commit: { type: 'string', description: 'Deployment commit SHA or identifier' },
    deepLink: { type: 'string', description: 'Deployment, build, or release URL' },
    user: { type: 'string', description: 'Deployment user' },
    groupId: { type: 'string', description: 'Deployment group ID' },
    customAttributes: { type: 'json', description: 'Custom change event metadata' },
    deploymentType: { type: 'string', description: 'Deployment type' },
    timestamp: { type: 'number', description: 'Deployment timestamp in epoch milliseconds' },
  },
  outputs: {
    results: { type: 'json', description: 'NRQL result rows' },
    resultCount: { type: 'number', description: 'Number of NRQL result rows' },
    count: { type: 'number', description: 'Number of matching entities' },
    query: { type: 'string', description: 'Entity search query New Relic executed' },
    entities: { type: 'json', description: 'Matching New Relic entities (guid, name, entityType)' },
    nextCursor: { type: 'string', description: 'Cursor for the next entity search page' },
    entity: { type: 'json', description: 'New Relic entity details (guid, name, entityType)' },
    event: { type: 'json', description: 'Created change tracking event metadata' },
    messages: { type: 'json', description: 'New Relic change tracking messages' },
  },
}
