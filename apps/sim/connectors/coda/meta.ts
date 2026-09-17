import { CodaIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const codaConnectorMeta: ConnectorMeta = {
  id: 'coda',
  name: 'Coda',
  description: 'Sync Coda pages and tables',
  version: '1.0.0',
  icon: CodaIcon,
  search: true,
  searchDocsUrl: 'https://docs.sim.ai/search/coda',
  supportedAccessModes: ['admin', 'workspace'],
  auth: {
    mode: 'oauth',
    provider: 'coda',
    requiredScopes: [],
    adminCredentialType: 'service_account',
  },
  mirrorsSourceAcls: true,
  adminSetupHint:
    'Use a Coda API token that can read the documents and their sharing permissions. Direct shares match verified Sim email addresses. An Enterprise org-admin token and organization ID are needed for organization-wide discovery and group, workspace, or domain grants. Link-only shares do not grant search access.',
  rehydrateOnFullSync: true,
  configFields: [
    {
      id: 'docSelector',
      title: 'Documents',
      type: 'selector',
      selectorKey: 'coda.docs',
      canonicalParamId: 'docIds',
      mode: 'basic',
      multi: true,
      required: false,
      preserveValueOnModeChange: true,
      placeholder: 'All accessible, previously opened documents',
      descriptionInAdminMode:
        'The picker shows documents the token owner can access and has opened. Switch to document IDs for other Enterprise organization documents.',
    },
    {
      id: 'docIds',
      title: 'Document IDs',
      type: 'short-input',
      canonicalParamId: 'docIds',
      mode: 'advanced',
      multi: true,
      required: false,
      preserveValueOnModeChange: true,
      placeholder: 'Leave empty to discover documents',
      description: 'Explicit IDs also include accessible documents the token owner has not opened.',
      descriptionInAdminMode:
        'Leave empty for discovery, or enter document IDs. Without an organization ID, discovery only includes documents the token owner has opened.',
    },
    {
      id: 'organizationId',
      title: 'Enterprise organization ID',
      type: 'short-input',
      showInAdminModeOnly: true,
      required: false,
      placeholder: 'org-… (optional)',
      description:
        'Requires a Coda Enterprise organization administrator. Enables organization-wide page indexing and directory permissions. Leave empty for token-accessible pages and tables with direct email shares.',
    },
  ],
  tagDefinitions: [
    { id: 'document', displayName: 'Document', fieldType: 'text' },
    { id: 'resourceType', displayName: 'Resource Type', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
