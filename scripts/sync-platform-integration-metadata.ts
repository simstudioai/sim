/**
 * Generate the public provider metadata used by the isolated Platform from the workspace catalog
 * and credential enrollment definitions. Pass --check to detect upstream changes without writing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import catalog from '@sim/deployment-config/integrations.json'
import { SIM_DOCS_URL } from '@sim/utils/site'
import ts from '@typescript/typescript6'
import matter from 'gray-matter'
import searchDocs from '../apps/docs/content/docs/search/meta.json'
import { GmailV2Block } from '../apps/sim/blocks/blocks/gmail'
import { getManagedOAuthConnectorPolicy } from '../apps/sim/lib/auth/connectors/managed-oauth'
import { getOrganizationCredentialTypeCatalog } from '../apps/sim/lib/credential-groups/credential-types'
import {
  getManagedMcpConnector,
  MANAGED_MCP_CONNECTOR_IDS,
} from '../apps/sim/lib/credential-groups/managed-mcp-connectors'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  getCredentialGroupProviderService,
} from '../apps/sim/lib/credential-groups/providers'
import { SLACK_SEARCH_USER_SCOPES } from '../apps/sim/lib/credential-groups/slack-managed-user-scopes'
import { getCanonicalScopesForProvider, getScopeDescription } from '../apps/sim/lib/oauth/utils'
import {
  isManagedSearchMcpProvider,
  MANAGED_SEARCH_MCP_READ_TOOLS,
  type ManagedSearchMcpProvider,
} from '../apps/sim/lib/sim-search/live/managed-mcp-config'
import { LIVE_SEARCH_SCOPE_FIELDS } from '../apps/sim/lib/sim-search/live/policy-schema'
import {
  LIVE_SEARCH_PROVIDER_CATALOG,
  LIVE_SEARCH_PROVIDER_IDS,
  type LiveSearchProviderId,
} from '../apps/sim/lib/sim-search/live/provider-catalog'
import { getToolMetadata } from '../apps/sim/tools/metadata'
import { formatGeneratedSource } from './format-generated-source'
import { sourceProviderCatalog } from './platform-search-source-catalog'

const root = resolve(import.meta.dir, '..')
const output = resolve(root, 'apps/sim/platform/lib/integrations/metadata.generated.ts')

const SCOPE_LABELS: Record<string, string> = {
  'meeting:read:search': 'Search past meetings',
  'meeting:read:assets': 'Read meeting assets',
  'mpim:history': 'Read group direct message history',
  'mpim:read': 'View group direct message conversations',
  'search:read.files': 'Search files',
  'search:read.public': 'Search public channels',
  'search:read.private': 'Search private channels you can access',
  'search:read.mpim': 'Search group direct messages you can access',
  'search:read.im': 'Search direct messages you can access',
}

const SEARCH_READ_LABELS = {
  coda: {
    search: 'Search pages and table rows',
    url_convert: null,
    content_read: 'Read page content',
    document_outline: 'Read document outlines',
    table_rows_read: 'Read table rows',
  },
  fireflies: {
    fireflies_get_transcripts: 'Search meeting titles and transcripts',
    fireflies_get_transcript: 'Read transcripts with speakers and timestamps',
    fireflies_get_summary: 'Read available meeting summaries',
  },
  granola: {
    query_granola_meetings: 'Search meeting notes',
    list_meetings: 'Find meetings by date',
    get_meetings: 'Read meeting notes',
    get_meeting_transcript: 'Read available meeting transcripts',
  },
  hubspot: {
    get_user_details: null,
    search_crm_objects: 'Search CRM records',
    get_crm_objects: 'Read CRM records',
  },
  lucid: {
    search: 'Search document titles',
    fetch: 'Read document content',
    lucid_search_document: 'Search within a document',
    lucid_get_document_metadata: 'Read document details',
    lucid_list_folder_contents: 'Browse folders',
  },
  notion: {
    'notion-get-tool-access': null,
    'notion-search': 'Find pages and databases by keyword',
    'notion-ai-search': 'Search with AI when available',
    'notion-fetch': 'Read pages and databases',
    'notion-list-private-pages': 'Browse private pages',
    'notion-list-shared-pages': 'Browse shared pages',
    'notion-list-favorite-pages': 'Browse favorite pages',
    'notion-list-recent-pages': 'Browse recent pages',
  },
  zoom: {
    search_meetings: 'Search past meetings',
    get_meeting_assets: 'Read available transcripts, notes, and summaries',
  },
} satisfies {
  [P in ManagedSearchMcpProvider]: Record<
    (typeof MANAGED_SEARCH_MCP_READ_TOOLS)[P][number],
    string | null
  >
}

function searchReads(id: string) {
  if (!isManagedSearchMcpProvider(id)) return []
  const labels: Record<string, string | null> = SEARCH_READ_LABELS[id]
  return MANAGED_SEARCH_MCP_READ_TOOLS[id].flatMap((tool) => {
    const label = labels[tool]
    return label ? [{ id: tool, label }] : []
  })
}

function describeScope(id: string, provider: string) {
  const canonical = getScopeDescription(id, provider)
  return { id, label: canonical === id ? (SCOPE_LABELS[id] ?? id) : canonical }
}

function zoomScopes() {
  // Zoom's preregistered OAuth client holds secrets; read only its static scope declaration.
  const file = resolve(root, 'apps/sim/lib/mcp/oauth/shared-clients.ts')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
  const client = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'getSharedZoomMcpClient'
  )
  const scope = client?.body?.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'scope'
    )?.initializer
  if (!scope || !ts.isStringLiteral(scope))
    throw new Error('Check the Zoom MCP scope declaration in shared-clients.ts')
  return scope.text.split(' ')
}

function requestedScopes(id: LiveSearchProviderId | 'salesforce') {
  if (id === 'gitlab') return []
  if (isManagedSearchMcpProvider(id)) {
    if (id !== 'zoom') return null
    return zoomScopes().map((scope) => describeScope(scope, id))
  }
  const oauthId =
    id === 'salesforce' ? id : LIVE_SEARCH_PROVIDER_CATALOG[id].credentialProviderIds[0]
  const scopes =
    id === 'slack'
      ? SLACK_SEARCH_USER_SCOPES
      : [
          ...getCanonicalScopesForProvider(oauthId),
          ...(getManagedOAuthConnectorPolicy(oauthId)?.additionalScopes ?? []),
        ]
  return [...new Set(scopes)].map((scope) => describeScope(scope, oauthId))
}

const ids: (LiveSearchProviderId | 'salesforce')[] = [...LIVE_SEARCH_PROVIDER_IDS, 'salesforce']
const providers = ids.sort().map((id) => {
  const slug = id.replaceAll('_', '-')
  const block = catalog.integrations.find((entry) => entry.slug === slug)
  const source = block ?? (id === 'lucid' ? getManagedMcpConnector('lucid') : undefined)
  if (!source) throw new Error(`No canonical integration description for ${id}`)
  return {
    id,
    name: source.name,
    description: source.description,
    setupGuideUrl: `${SIM_DOCS_URL}/search/${searchDocs.pages.includes(slug) ? slug : 'connect-your-account'}`,
    searchResource: LIVE_SEARCH_SCOPE_FIELDS[id]?.label ?? null,
    searchReads: searchReads(id),
    requestedScopes: requestedScopes(id),
  }
})
const gmailTools = (GmailV2Block.tools?.access ?? []).flatMap((id) => {
  const tool = getToolMetadata(id)
  return tool?.oauth && tool.assistant && tool.name && tool.description
    ? [{ id, label: tool.name, description: tool.description, kind: tool.assistant.effect }]
    : []
})
const secretGuide = 'generic-secrets'
const { title, description } = matter.read(
  resolve(root, `apps/docs/content/docs/search/${secretGuide}.mdx`)
).data
if (typeof title !== 'string' || typeof description !== 'string')
  throw new Error('Generic Secrets needs a name and description in its Search guide')

const credentialGroupCatalog = [
  ...CREDENTIAL_GROUP_PROVIDER_IDS.map((provider) => ({
    key: `oauth:${provider}`,
    provider,
    method: 'oauth',
    name: getCredentialGroupProviderService(provider).name,
  })),
  ...MANAGED_MCP_CONNECTOR_IDS.map((provider) => ({
    key: `mcp:${provider}`,
    provider,
    method: 'mcp',
    name:
      getManagedMcpConnector(provider).name +
      (provider === 'hubspot' || provider === 'zoom' ? ' (member access)' : ''),
  })),
].sort((left, right) => left.name.localeCompare(right.name))

const generated = formatGeneratedSource(
  `/** Generated by scripts/sync-platform-integration-metadata.ts. */
export const providerMetadata = ${JSON.stringify(providers)} as const
export const credentialTypeCatalog = ${JSON.stringify(getOrganizationCredentialTypeCatalog().map(({ id, label }) => ({ value: id, label })))} as const
export const credentialGroupCatalog = ${JSON.stringify(credentialGroupCatalog)} as const
export const gmailToolMetadata = ${JSON.stringify(gmailTools)} as const
export const memberSecretMetadata = ${JSON.stringify({ name: title, description, setupGuideUrl: `${SIM_DOCS_URL}/search/${secretGuide}` })} as const
`,
  output,
  root
)
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== generated)
    throw new Error(
      'Platform integration metadata is stale. Run bun scripts/sync-platform-integration-metadata.ts'
    )
} else {
  writeFileSync(output, generated)
}

const sourceOutput = resolve(root, 'apps/sim/platform/lib/integrations/source-catalog.generated.ts')
const sourceGenerated = formatGeneratedSource(
  `/** Generated by scripts/sync-platform-integration-metadata.ts. */
export const searchSourceCatalog = ${JSON.stringify(sourceProviderCatalog(providers))} as const
`,
  sourceOutput,
  root
)
if (process.argv.includes('--check')) {
  if (readFileSync(sourceOutput, 'utf8') !== sourceGenerated)
    throw new Error(
      'Platform search source metadata is stale. Run bun scripts/sync-platform-integration-metadata.ts'
    )
} else {
  writeFileSync(sourceOutput, sourceGenerated)
}
