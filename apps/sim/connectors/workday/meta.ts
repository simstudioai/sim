import { WorkdayIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

/**
 * Workday Help knowledge articles, read through the public `helpArticle` v1 REST
 * service (`GET /ccx/api/helpArticle/v1/{tenant}/articleVersions`).
 *
 * Scope is deliberately narrow, and the connector is named for it. `helpArticle`
 * is the only Workday REST service whose documented response carries a title
 * alongside the article body as plain text, which is what a knowledge base
 * indexes. Worker, organization, and compensation data — what Sim's Workday
 * *tools* read over SOAP — are records rather than documents and are out of scope.
 *
 * ## Why the credential is a customer API client rather than `mode: 'oauth'`
 *
 * Workday REST is OAuth-2.0-only; it does not accept the WS-Security username
 * and password the SOAP tools use. It still cannot become a Sim OAuth provider:
 *
 * - Better Auth's `genericOAuth` takes **static** `authorizationUrl`/`tokenUrl`
 *   strings registered once at module load — see the comment on
 *   `salesforceConnector` in `lib/auth/connectors/providers.ts`, which enumerates
 *   Salesforce's two fixed login hosts for exactly this reason. Workday's
 *   endpoints are `https://{tenantHost}/ccx/oauth2/{tenant}/token`, where both
 *   the host and the tenant segment are per-customer and unbounded, so there is
 *   no finite set to enumerate.
 * - Every provider in that file supplies Sim's own `env.*_CLIENT_ID/SECRET`.
 *   Workday API clients are registered by the customer inside their own tenant
 *   (the "Register API Client for Integrations" task), so no Sim-owned Workday
 *   application exists whose credentials could be configured there.
 *
 * The connector therefore carries the customer's API client itself. The
 * non-secret client ID is a config field; the client secret and the refresh
 * token are both secrets and so share the connector's single encrypted key as
 * `clientSecret:refreshToken` — the packing the Gong connector already uses for
 * its `accessKey:accessKeySecret` pair. They buy a short-lived bearer token once
 * per sync run.
 *
 * ## Why the article status filter is required
 *
 * `/articleVersions` lists article *versions*, not articles: every row carries a
 * `version` number and a `parentArticle` reference to the article it belongs to,
 * and the service publishes no "latest version only" filter or sort order — the
 * whole document has eleven paths and none of them addresses an article. An
 * unfiltered sync therefore indexes each historical revision as its own
 * document, so the status filter is required and has no default: the operator
 * picks the scope explicitly, and the option that indexes every revision says so
 * on its label.
 *
 * The three options are the ones the service's own prose enumerates — "an
 * article version can have a status of Published, Draft, or Archived". What the
 * `status` *query parameter* accepts for them is the one thing the published
 * spec does not settle: it is an untyped `array` of `string` with no enum and no
 * `x-workday-populated-by`, unlike the sibling `audience` parameter, whose model
 * names `/values/common/audiences` as its value source. The connector resolves
 * the chosen name against `/articleStatuses` and sends the Workday ID;
 * `validateConfig` reads the filtered response back and refuses the
 * configuration if the tenant answered with a version in another status.
 */
export const workdayConnectorMeta: ConnectorMeta = {
  id: 'workday',
  name: 'Workday Help',
  description: 'Sync Workday Help knowledge articles into your knowledge base',
  version: '1.0.0',
  icon: WorkdayIcon,

  auth: {
    mode: 'apiKey',
    label: 'Client Secret & Refresh Token',
    placeholder: 'clientSecret:refreshToken',
  },

  configFields: [
    {
      id: 'tenantUrl',
      title: 'Tenant Host',
      type: 'short-input',
      placeholder: 'e.g. https://wd5-impl-services1.workday.com',
      required: true,
      description:
        'Host of your Workday instance, without the tenant or any path. Must be a Workday-hosted domain.',
    },
    {
      id: 'tenant',
      title: 'Tenant',
      type: 'short-input',
      placeholder: 'e.g. acme_pt1',
      required: true,
      description: 'Workday tenant name, as it appears in your Workday URLs.',
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'e.g. NDdiMGE0ZmQtZjk1YS00...',
      required: true,
      description:
        'Client ID of the Workday API Client for Integrations whose client secret and refresh token you entered above. Register it with a non-expiring refresh token: Sim stores the token you enter and cannot replace one the tenant rotates.',
    },
    {
      id: 'status',
      title: 'Article Status',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Published', id: 'Published' },
        { label: 'Draft', id: 'Draft' },
        { label: 'Archived', id: 'Archived' },
        { label: 'Every status — indexes every historical revision', id: 'all' },
      ],
      description:
        'Which article versions to sync, resolved against the statuses your tenant returns. Workday exposes no "latest version only" filter, so an article that has held the chosen status more than once still contributes one document per revision.',
    },
    {
      id: 'audience',
      title: 'Audience',
      type: 'short-input',
      required: false,
      multi: true,
      placeholder: 'e.g. All Employees (optional)',
      description:
        'Comma-separated audience names to sync, resolved against the audiences your tenant returns. A Workday ID is accepted in place of a name. Leave blank to sync every audience.',
    },
    {
      id: 'maxVersions',
      title: 'Max Article Versions',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
      description: 'Stop syncing after this many article versions.',
    },
  ],

  tagDefinitions: [
    { id: 'article', displayName: 'Article', fieldType: 'text' },
    { id: 'category', displayName: 'Category', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'audience', displayName: 'Audience', fieldType: 'text' },
    { id: 'articleTags', displayName: 'Tags', fieldType: 'text' },
    { id: 'language', displayName: 'Language', fieldType: 'text' },
    { id: 'version', displayName: 'Version', fieldType: 'number' },
    { id: 'created', displayName: 'Created', fieldType: 'date' },
    { id: 'lastUpdated', displayName: 'Last Updated', fieldType: 'date' },
  ],
}
