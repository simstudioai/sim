import { MintlifyIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/** Default ceiling on indexed pages per sync when `maxPages` is not configured. */
export const DEFAULT_MAX_PAGES = 500

/** Hard ceiling on the configurable `maxPages` value. */
export const MAX_PAGES_LIMIT = 5000

export const mintlifyConnectorMeta: ConnectorMeta = {
  id: 'mintlify',
  name: 'Mintlify',
  description: 'Sync pages from a hosted Mintlify documentation site',
  version: '1.0.0',
  icon: MintlifyIcon,

  /**
   * The key is sent as a bearer token to the documentation host itself, not to
   * `api.mintlify.com` — Mintlify's own API keys authenticate the dashboard and
   * assistant APIs, which have no page-listing endpoint. It is therefore only
   * useful for a site fronted by a proxy that accepts a bearer token, so it is
   * declared optional and public sites can be connected with no key at all.
   */
  auth: {
    mode: 'apiKey',
    label: 'Access Token',
    placeholder: 'Only needed if your docs site requires a bearer token',
    optional: true,
  },

  configFields: [
    {
      id: 'siteUrl',
      title: 'Documentation Site URL',
      type: 'short-input',
      placeholder: 'https://docs.yourcompany.com',
      required: true,
      description:
        'Base URL of your published Mintlify site. Pages are discovered from the llms.txt file Mintlify hosts there.',
    },
    {
      id: 'pathPrefix',
      title: 'Path Prefix',
      type: 'short-input',
      placeholder: 'e.g. /guides',
      required: false,
      description: 'Only sync pages whose path starts with this prefix (leave empty for all pages)',
    },
    {
      id: 'maxPages',
      title: 'Max Pages',
      type: 'short-input',
      placeholder: `e.g. 200 (default: ${DEFAULT_MAX_PAGES}, max: ${MAX_PAGES_LIMIT})`,
      required: false,
      description: 'Maximum number of documentation pages to index',
    },
  ],

  tagDefinitions: [
    { id: 'section', displayName: 'Section', fieldType: 'text' },
    { id: 'description', displayName: 'Description', fieldType: 'text' },
  ],
}
