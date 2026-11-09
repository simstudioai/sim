import 'server-only'
import { createLoader, parseAsString } from 'nuqs/server'
import { slackSearchOnboardingInputSchema } from '@/lib/api/contracts/knowledge/slack'
import {
  type SearchConnectionTarget,
  searchConnectionTargetSchema,
} from '@/lib/knowledge/search/connection-target'
import {
  integrationSearchParsers,
  integrationViewParsers,
  serializeIntegrationView,
} from '@/lib/organizations/integrations-search-params'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { type SurfaceScope, surfaceHref } from '@/platform/lib/data/organization-model'
import { requireSessionViewer } from '@/platform/lib/data/server-read'
import { GENERIC_SECRETS_SEGMENT, integrationSegment } from '@/platform/shared/integrations'

/** Reads a link from before providers had their own route, so it can be sent there. */
const loadIntegrationView = createLoader({ ...integrationSearchParsers, ...integrationViewParsers })

const loadConnectionParams = createLoader({
  connectorType: parseAsString.withDefault(''),
  connectionMode: parseAsString.withDefault(''),
  optionId: parseAsString.withDefault(''),
  savedProviderId: parseAsString.withDefault(''),
  provider: parseAsString.withDefault(''),
  connectorId: parseAsString.withDefault(''),
  credentialId: parseAsString.withDefault(''),
})

type IntegrationLinks =
  | { kind: 'invalid' }
  | { kind: 'redirect'; href: string }
  | {
      kind: 'page'
      userId: string
      connectionTarget?: SearchConnectionTarget
      slackToken?: string
    }

/**
 * What a link into the Integrations index asks for: a connection Search or a chat requested, a
 * Slack onboarding to hand back to its thread, or a provider from before providers had their own
 * page. A malformed request is `invalid`, which the page answers as not found.
 */
export async function readIntegrationLinks(
  scope: SurfaceScope,
  searchParams: Record<string, string | string[] | undefined>
): Promise<IntegrationLinks> {
  const selection = loadConnectionParams(searchParams)
  const connector = SEARCH_CONNECTORS.find((entry) => entry.type === selection.connectorType)
  const requested =
    selection.connectorType ||
    selection.connectorId ||
    selection.credentialId ||
    selection.connectionMode ||
    selection.optionId ||
    selection.savedProviderId ||
    selection.provider
      ? searchConnectionTargetSchema.safeParse({
          type: 'link',
          ...(selection.connectionMode ? { connectionMode: selection.connectionMode } : {}),
          ...(selection.optionId ? { optionId: selection.optionId } : {}),
          ...(selection.savedProviderId ? { savedProviderId: selection.savedProviderId } : {}),
          provider: selection.provider || connector?.providerId,
          connectorType: selection.connectorType,
          ...(selection.connectorId ? { connectorId: selection.connectorId } : {}),
          ...(selection.credentialId ? { credentialId: selection.credentialId } : {}),
        })
      : undefined
  if (requested && !requested.success) return { kind: 'invalid' }
  const { slack } = searchParams
  const context =
    slack === undefined ? undefined : slackSearchOnboardingInputSchema.safeParse({ token: slack })
  if (context && !context.success) return { kind: 'invalid' }
  const view = loadIntegrationView(searchParams)
  if (view.integration) {
    const segment =
      view.integration === 'secrets'
        ? GENERIC_SECRETS_SEGMENT
        : integrationSegment(view.integration)
    return {
      kind: 'redirect',
      href: serializeIntegrationView(
        surfaceHref(scope, `/integrations/${encodeURIComponent(segment)}`),
        { q: view.q, account: view.account, tools: view.tools }
      ),
    }
  }
  const { principal } = await requireSessionViewer()
  return {
    kind: 'page',
    userId: principal.userId,
    connectionTarget: requested?.data,
    slackToken: context?.data?.token,
  }
}
