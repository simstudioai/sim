import type {
  SelectorContextKey,
  SelectorManifestEntry,
  SelectorReadiness,
} from '@/lib/selectors/types'

export const DEFAULT_SELECTOR_STALE_TIME = 30_000
export const DEFAULT_SELECTOR_DETAIL_STALE_TIME = 300_000
export const STANDARD_SELECTOR_STALE_TIME = 60_000
export const SEARCH_SELECTOR_STALE_TIME = 15_000

const SERVER_SCOPE_KINDS = ['workflow', 'workspace'] as const

interface ServerManifestOptions {
  readiness?: SelectorReadiness
  sensitive?: readonly SelectorContextKey[]
  sourceFields?: Partial<Record<SelectorContextKey, readonly string[]>>
  listMode?: 'flat' | 'paginated'
  search?: boolean
  detail?: boolean
  unknownDetail?: boolean
  staleTime?: number
}

function providerSelector(
  extraContext: readonly SelectorContextKey[] = [],
  options: ServerManifestOptions = {}
): SelectorManifestEntry {
  return {
    classification: 'provider-server',
    context: {
      allowed: ['oauthCredential', ...extraContext],
      readiness: options.readiness ?? { all: ['oauthCredential'] },
      ...(options.sensitive ? { sensitive: options.sensitive } : {}),
      ...(options.sourceFields ? { sourceFields: options.sourceFields } : {}),
    },
    scopeKinds: [...SERVER_SCOPE_KINDS, 'organization'],
    listMode: options.listMode ?? 'flat',
    supportsSearch: options.search ?? false,
    supportsDetail: options.detail ?? false,
    resolvesUnknownIds: options.unknownDetail ?? false,
    staleTime: options.staleTime ?? STANDARD_SELECTOR_STALE_TIME,
  }
}

function rawProviderSelector(
  context: readonly SelectorContextKey[],
  options: ServerManifestOptions
): SelectorManifestEntry {
  return {
    classification: 'provider-server',
    context: {
      allowed: context,
      ...(options.readiness ? { readiness: options.readiness } : {}),
      ...(options.sensitive ? { sensitive: options.sensitive } : {}),
      ...(options.sourceFields ? { sourceFields: options.sourceFields } : {}),
    },
    scopeKinds: SERVER_SCOPE_KINDS,
    listMode: options.listMode ?? 'flat',
    supportsSearch: options.search ?? false,
    supportsDetail: options.detail ?? false,
    resolvesUnknownIds: options.unknownDetail ?? false,
    staleTime: options.staleTime ?? STANDARD_SELECTOR_STALE_TIME,
  }
}

function internalSelector(
  context: readonly SelectorContextKey[] = [],
  options: ServerManifestOptions = {}
): SelectorManifestEntry {
  return {
    classification: 'internal-server',
    context: {
      allowed: context,
      ...(options.readiness ? { readiness: options.readiness } : {}),
      ...(options.sensitive ? { sensitive: options.sensitive } : {}),
      ...(options.sourceFields ? { sourceFields: options.sourceFields } : {}),
    },
    scopeKinds: SERVER_SCOPE_KINDS,
    listMode: options.listMode ?? 'flat',
    supportsSearch: options.search ?? false,
    supportsDetail: options.detail ?? false,
    resolvesUnknownIds: options.unknownDetail ?? false,
    staleTime: options.staleTime ?? STANDARD_SELECTOR_STALE_TIME,
  }
}

export const selectorManifest = {
  'airtable.bases': providerSelector([], { detail: true }),
  'airtable.tables': providerSelector(['baseId'], {
    readiness: { all: ['oauthCredential', 'baseId'] },
    detail: true,
  }),
  'asana.workspaces': providerSelector([], { detail: true }),
  'attio.lists': providerSelector([], { detail: true }),
  'attio.objects': providerSelector([], { detail: true }),
  'bigquery.datasets': providerSelector(['projectId', 'impersonateUserEmail'], {
    readiness: { all: ['oauthCredential', 'projectId'] },
    listMode: 'paginated',
    detail: true,
  }),
  'bigquery.tables': providerSelector(['projectId', 'datasetId', 'impersonateUserEmail'], {
    readiness: { all: ['oauthCredential', 'projectId', 'datasetId'] },
    listMode: 'paginated',
    detail: true,
  }),
  'bitbucket.workspaces': providerSelector([], { listMode: 'paginated', detail: true }),
  'bitbucket.repositories': providerSelector(['workspaceSlug'], {
    readiness: { all: ['oauthCredential', 'workspaceSlug'] },
    listMode: 'paginated',
    detail: true,
  }),
  'calcom.eventTypes': providerSelector([], { detail: true }),
  'calcom.schedules': providerSelector([], { detail: true }),
  'clickup.workspaces': providerSelector(),
  'clickup.spaces': providerSelector(['teamId'], {
    readiness: { all: ['oauthCredential', 'teamId'] },
  }),
  'clickup.folders': providerSelector(['spaceId', 'listSpaceId'], {
    readiness: { all: ['oauthCredential'], any: ['spaceId', 'listSpaceId'] },
  }),
  'clickup.lists': providerSelector(['folderId', 'spaceId', 'listSpaceId'], {
    readiness: {
      all: ['oauthCredential'],
      any: ['folderId', 'spaceId', 'listSpaceId'],
    },
  }),
  'confluence.spaces': providerSelector(['domain'], {
    readiness: { all: ['oauthCredential', 'domain'] },
    listMode: 'paginated',
    detail: true,
    unknownDetail: true,
  }),
  'confluence.spacesById': providerSelector(['domain'], {
    readiness: { all: ['oauthCredential', 'domain'] },
    listMode: 'paginated',
    detail: true,
    unknownDetail: true,
  }),
  'confluence.pages': providerSelector(['domain'], {
    readiness: { all: ['oauthCredential', 'domain'] },
    search: true,
    detail: true,
  }),
  'google.tasks.lists': providerSelector(['impersonateUserEmail'], {
    listMode: 'paginated',
    detail: true,
  }),
  'gmail.labels': providerSelector(['impersonateUserEmail']),
  'google.calendar': providerSelector(['impersonateUserEmail'], {
    listMode: 'paginated',
    detail: true,
  }),
  'google.drive': providerSelector(['mimeType', 'fileId', 'impersonateUserEmail'], {
    listMode: 'paginated',
    search: true,
    detail: true,
    staleTime: SEARCH_SELECTOR_STALE_TIME,
  }),
  'google.sheets': providerSelector(['spreadsheetId', 'impersonateUserEmail'], {
    readiness: { all: ['oauthCredential', 'spreadsheetId'] },
  }),
  'harmonic.savedSearches': providerSelector([], { detail: true, unknownDetail: true }),
  'hubspot.lists': providerSelector([], { listMode: 'paginated', search: true, detail: true }),
  'hubspot.owners': providerSelector([], { listMode: 'paginated', detail: true }),
  'hubspot.pipelines': providerSelector(['objectType', 'customObjectTypeId']),
  'hubspot.pipelineStages': providerSelector(['objectType', 'customObjectTypeId', 'pipelineId'], {
    readiness: { all: ['oauthCredential', 'pipelineId'] },
  }),
  'hubspot.properties': providerSelector(['objectType', 'customObjectTypeId']),
  'jsm.requestTypes': providerSelector(['domain', 'serviceDeskId'], {
    readiness: { all: ['oauthCredential', 'domain', 'serviceDeskId'] },
    detail: true,
  }),
  'jsm.serviceDesks': providerSelector(['domain'], {
    readiness: { all: ['oauthCredential', 'domain'] },
    detail: true,
  }),
  'microsoft.planner.plans': providerSelector([], { listMode: 'paginated', detail: true }),
  'notion.databases': providerSelector([], { detail: true }),
  'notion.pages': providerSelector([], { detail: true }),
  'netsuite.recordTypes': providerSelector(['jobId'], {
    detail: true,
    unknownDetail: true,
  }),
  'netsuite.asyncTasks': providerSelector(['jobId'], {
    readiness: { all: ['oauthCredential', 'jobId'] },
    detail: true,
    unknownDetail: true,
  }),
  'pipedrive.pipelines': providerSelector([], { detail: true }),
  'sharepoint.lists': providerSelector(['siteId'], {
    readiness: { all: ['oauthCredential', 'siteId'] },
    listMode: 'paginated',
    detail: true,
  }),
  'trello.boards': providerSelector([], { detail: true }),
  'zoho_desk.organizations': providerSelector(),
  'zoho_desk.departments': providerSelector(['orgId'], {
    readiness: { all: ['oauthCredential', 'orgId'] },
  }),
  'zoho_desk.agents': providerSelector(['orgId'], {
    readiness: { all: ['oauthCredential', 'orgId'] },
  }),
  'zoom.meetings': providerSelector([], { listMode: 'paginated', detail: true }),
  'slack.channels': providerSelector([], {
    sourceFields: { oauthCredential: ['botToken'] },
    listMode: 'paginated',
    detail: true,
  }),
  'snowflake.databases': providerSelector(['database', 'schema'], {
    detail: true,
    unknownDetail: true,
  }),
  'snowflake.schemas': providerSelector(['database', 'schema'], {
    readiness: { all: ['oauthCredential', 'database'] },
    detail: true,
    unknownDetail: true,
  }),
  'snowflake.tables': providerSelector(['database', 'schema'], {
    readiness: { all: ['oauthCredential', 'database', 'schema'] },
    detail: true,
    unknownDetail: true,
  }),
  'snowflake.warehouses': providerSelector(['database', 'schema'], {
    detail: true,
    unknownDetail: true,
  }),
  'snowflake.roles': providerSelector(['database', 'schema'], {
    detail: true,
    unknownDetail: true,
  }),
  'snowflake.fileFormats': providerSelector(['database', 'schema'], {
    readiness: { all: ['oauthCredential', 'database', 'schema'] },
    detail: true,
    unknownDetail: true,
  }),
  'snowflake.procedures': providerSelector(['database', 'schema'], {
    readiness: { all: ['oauthCredential', 'database', 'schema'] },
    detail: true,
    unknownDetail: true,
  }),
  'slack.users': providerSelector([], {
    sourceFields: { oauthCredential: ['botToken'] },
    listMode: 'paginated',
    detail: true,
  }),
  'outlook.folders': providerSelector([], { listMode: 'paginated', detail: true }),
  'outlook.calendars': providerSelector([], { listMode: 'paginated', detail: true }),
  'microsoft.teams': providerSelector([], { listMode: 'paginated', detail: true }),
  'microsoft.chats': providerSelector([], { listMode: 'paginated', detail: true }),
  'microsoft.channels': providerSelector(['teamId'], {
    readiness: { all: ['oauthCredential', 'teamId'] },
    listMode: 'paginated',
    detail: true,
  }),
  'microsoft.planner': providerSelector(['planId'], {
    readiness: { all: ['oauthCredential', 'planId'] },
    listMode: 'paginated',
    detail: true,
  }),
  'onedrive.files': providerSelector(['mimeType'], { listMode: 'paginated', detail: true }),
  'onedrive.folders': providerSelector(['driveId'], { listMode: 'paginated', detail: true }),
  'sharepoint.sites': providerSelector([], {
    listMode: 'paginated',
    search: true,
    detail: true,
  }),
  'microsoft.excel': providerSelector(['driveId'], {
    listMode: 'paginated',
    search: true,
    detail: true,
  }),
  'microsoft.excel.drives': providerSelector(['siteId'], {
    readiness: { all: ['oauthCredential', 'siteId'] },
    listMode: 'paginated',
    detail: true,
  }),
  'microsoft.excel.sheets': providerSelector(['driveId', 'spreadsheetId'], {
    readiness: { all: ['oauthCredential', 'spreadsheetId'] },
    listMode: 'paginated',
  }),
  'microsoft.word': providerSelector(['driveId'], {
    listMode: 'paginated',
    search: true,
    detail: true,
  }),
  'wealthbox.contacts': providerSelector([], { search: true }),
  'jira.issues': providerSelector(['domain', 'projectId'], {
    readiness: { all: ['oauthCredential', 'domain'] },
    search: true,
    detail: true,
    staleTime: SEARCH_SELECTOR_STALE_TIME,
  }),
  'jira.projects': providerSelector(['domain'], {
    readiness: { all: ['oauthCredential', 'domain'] },
    listMode: 'paginated',
    search: true,
    detail: true,
  }),
  'linear.projects': providerSelector(['teamId'], {
    readiness: { all: ['oauthCredential', 'teamId'] },
    listMode: 'paginated',
    detail: true,
  }),
  'linear.teams': providerSelector([], { listMode: 'paginated', detail: true }),
  'monday.boards': providerSelector([], { detail: true }),
  'monday.groups': providerSelector(['boardId'], {
    readiness: { all: ['oauthCredential', 'boardId'] },
    detail: true,
  }),
  'webflow.sites': providerSelector(),
  'webflow.collections': providerSelector(['siteId'], {
    readiness: { all: ['oauthCredential', 'siteId'] },
  }),
  'webflow.items': providerSelector(['collectionId'], {
    readiness: { all: ['oauthCredential', 'collectionId'] },
    listMode: 'paginated',
    search: true,
    detail: true,
    staleTime: SEARCH_SELECTOR_STALE_TIME,
  }),
  'cloudwatch.logGroups': rawProviderSelector(
    ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion'],
    {
      readiness: { all: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion'] },
      sensitive: ['awsAccessKeyId', 'awsSecretAccessKey'],
      listMode: 'paginated',
      search: true,
      detail: true,
    }
  ),
  'cloudwatch.logStreams': rawProviderSelector(
    ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion', 'logGroupName'],
    {
      readiness: {
        all: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion', 'logGroupName'],
      },
      sensitive: ['awsAccessKeyId', 'awsSecretAccessKey'],
      listMode: 'paginated',
      search: true,
      detail: true,
    }
  ),
  'imap.mailboxes': rawProviderSelector(['host', 'port', 'secure', 'username', 'password'], {
    readiness: { all: ['host', 'username', 'password'] },
    sensitive: ['username', 'password'],
  }),
  'managedAgent.agents': providerSelector(),
  'managedAgent.environments': providerSelector(['environmentType']),
  'managedAgent.vaults': providerSelector(),
  'managedAgent.memoryStores': providerSelector(),
  'knowledge.documents': internalSelector(['knowledgeBaseId'], {
    readiness: { all: ['knowledgeBaseId'] },
    listMode: 'paginated',
    search: true,
    detail: true,
  }),
  'sim.workflows': internalSelector(['excludeWorkflowId'], { detail: true }),
  'table.columns': internalSelector(['tableId'], {
    readiness: { all: ['tableId'] },
    detail: true,
    staleTime: 0,
  }),
  'table.outputColumns': internalSelector(['tableId'], {
    readiness: { all: ['tableId'] },
    detail: true,
    staleTime: 0,
  }),
  'workspace.credentialProviders': internalSelector([], { detail: true }),
  'workspace.organizationMcpProviders': internalSelector([], { detail: true }),
  'workspace.credentialGroupProviders': internalSelector([], {
    detail: true,
  }),
  'workspace.secretNames': internalSelector(),
  'workspace.rawSecretNames': internalSelector(),
  'workspace.sandboxes': internalSelector(['language'], { detail: true }),
  'providers.ollamaEmbeddingModels': internalSelector(),
  'providers.openrouterEmbeddingModels': internalSelector(),
  'workspace.triggerTypes': {
    classification: 'local',
    context: { allowed: [] },
    scopeKinds: [],
    listMode: 'flat',
    supportsSearch: false,
    supportsDetail: false,
    resolvesUnknownIds: false,
    staleTime: STANDARD_SELECTOR_STALE_TIME,
  },
} as const satisfies Record<string, SelectorManifestEntry>

export type SelectorKey = keyof typeof selectorManifest
export type ServerSelectorKey = {
  [K in SelectorKey]: (typeof selectorManifest)[K]['classification'] extends 'local' ? never : K
}[SelectorKey]
export type ProviderSelectorKey = {
  [K in SelectorKey]: (typeof selectorManifest)[K]['classification'] extends 'provider-server'
    ? K
    : never
}[SelectorKey]
export type InternalSelectorKey = {
  [K in SelectorKey]: (typeof selectorManifest)[K]['classification'] extends 'internal-server'
    ? K
    : never
}[SelectorKey]
export type LocalSelectorKey = Exclude<SelectorKey, ServerSelectorKey>

export function getSelectorManifestEntry(key: SelectorKey): SelectorManifestEntry {
  return selectorManifest[key]
}

export function isSelectorReady(key: SelectorKey, context: Record<string, string>): boolean {
  const readiness = getSelectorManifestEntry(key).context.readiness
  if (!readiness) return true
  if (readiness.all?.some((field) => !context[field])) return false
  if (readiness.any?.length && !readiness.any.some((field) => Boolean(context[field]))) return false
  return true
}
