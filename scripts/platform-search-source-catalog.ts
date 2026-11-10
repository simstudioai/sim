import { codaConnectorMeta } from '../apps/sim/connectors/coda/meta'
import { confluenceConnectorMeta } from '../apps/sim/connectors/confluence/meta'
import { githubConnectorMeta } from '../apps/sim/connectors/github/meta'
import { gitlabConnectorMeta } from '../apps/sim/connectors/gitlab/meta'
import { gmailConnectorMeta } from '../apps/sim/connectors/gmail/meta'
import { googleCalendarConnectorMeta } from '../apps/sim/connectors/google-calendar/meta'
import { googleDriveConnectorMeta } from '../apps/sim/connectors/google-drive/meta'
import { getSearchConnectionLabels } from '../apps/sim/lib/sim-search/connection-labels'
import {
  LIVE_SEARCH_PROVIDER_CATALOG,
  type LiveSearchProviderId,
} from '../apps/sim/lib/sim-search/live/provider-catalog'
import { liveSearchSourceMeta } from '../apps/sim/lib/sim-search/live/source-settings'

const SERVICE_PROVIDERS = [
  gmailConnectorMeta,
  googleDriveConnectorMeta,
  googleCalendarConnectorMeta,
  confluenceConnectorMeta,
  githubConnectorMeta,
  gitlabConnectorMeta,
  codaConnectorMeta,
]

export function sourceProviderCatalog(
  providers: readonly { id: LiveSearchProviderId | 'salesforce'; name: string }[]
) {
  return providers.flatMap(({ id, name }) => {
    if (id === 'salesforce') return []
    const meta = liveSearchSourceMeta(
      SERVICE_PROVIDERS.find((entry) => entry.id === id) ?? null,
      true,
      { githubInstallation: id === 'github' }
    )
    return {
      id,
      name,
      supportedModes: LIVE_SEARCH_PROVIDER_CATALOG[id].modes,
      docs: meta?.searchDocsUrl,
      connectionLabels: getSearchConnectionLabels(id),
      fields: (meta?.configFields ?? [])
        .filter((field) => !field.hideInAdminMode)
        .map((field) => ({
          id: field.canonicalParamId ?? field.id,
          label: field.titleInAdminMode ?? field.title,
          required: Boolean(field.required || field.requiredInAdminMode),
          optional: field.setupGroup === 'options',
          placeholder: field.placeholder,
          mode: field.mode,
          options: field.options?.map((option) => ({ value: option.id, label: option.label })),
        })),
    }
  })
}
