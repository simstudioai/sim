import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { slackSearchOnboardingInputSchema } from '@/lib/api/contracts/knowledge/slack'
import {
  searchConnectionPath,
  searchConnectionTargetSchema,
} from '@/lib/knowledge/search/connection-target'
import { organizationRoutes } from '@/lib/navigation/paths'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { slackSearchIntegrationsPath } from '@/lib/slack-search/onboarding'
import { requireIntegrationsViewer } from '@/app/o/[organizationId]/integrations/access'
import { HydratedIntegrations } from '@/app/o/[organizationId]/integrations/hydrated-integrations'
import {
  loadIntegrationConnectionParams,
  loadIntegrationView,
  serializeIntegrationView,
} from '@/app/o/[organizationId]/integrations/search-params'
import {
  GENERIC_SECRETS_SEGMENT,
  integrationPath,
  integrationSegment,
} from '@/platform/lib/data/integrations-types'

export const metadata: Metadata = {
  title: 'Integrations',
  referrer: 'no-referrer',
}

interface OrganizationIntegrationsPageProps {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<{
    slack?: string | string[]
    connectionMode?: string | string[]
    optionId?: string | string[]
    provider?: string | string[]
    connectorType?: string | string[]
    connectorId?: string | string[]
    credentialId?: string | string[]
    integration?: string | string[]
    account?: string | string[]
    tools?: string | string[]
    q?: string | string[]
  }>
}

export default async function OrganizationIntegrationsPage({
  params,
  searchParams,
}: OrganizationIntegrationsPageProps) {
  const { organizationId } = await params
  const query = await searchParams
  const { slack } = query
  const selection = loadIntegrationConnectionParams(query)
  const connector = SEARCH_CONNECTORS.find((entry) => entry.type === selection.connectorType)
  const requested =
    selection.connectorType ||
    selection.connectorId ||
    selection.credentialId ||
    selection.connectionMode ||
    selection.optionId ||
    selection.provider
      ? searchConnectionTargetSchema.safeParse({
          type: 'link',
          ...(selection.connectionMode ? { connectionMode: selection.connectionMode } : {}),
          ...(selection.optionId ? { optionId: selection.optionId } : {}),
          provider: selection.provider || connector?.providerId,
          connectorType: selection.connectorType,
          ...(selection.connectorId ? { connectorId: selection.connectorId } : {}),
          ...(selection.credentialId ? { credentialId: selection.credentialId } : {}),
        })
      : undefined
  if (requested && !requested.success) notFound()
  const connectionTarget = requested?.data
  const context =
    slack === undefined ? undefined : slackSearchOnboardingInputSchema.safeParse({ token: slack })
  if (context && !context.success) notFound()
  const slackToken = context?.data?.token
  const viewer = await requireIntegrationsViewer(
    organizationId,
    connectionTarget
      ? searchConnectionPath(organizationId, connectionTarget)
      : slackToken
        ? slackSearchIntegrationsPath(organizationId, slackToken)
        : organizationRoutes(organizationId).integrations
  )
  const { userId } = viewer.principal
  const view = await loadIntegrationView(query)
  if (view.integration) {
    const segment =
      view.integration === 'secrets'
        ? GENERIC_SECRETS_SEGMENT
        : integrationSegment(view.integration)
    redirect(
      serializeIntegrationView(integrationPath(organizationId, segment), {
        q: view.q,
        account: view.account,
        tools: view.tools,
      })
    )
  }
  return (
    <HydratedIntegrations
      {...viewer}
      connectionRequest={connectionTarget ? { target: connectionTarget, userId } : undefined}
      slackOnboarding={slackToken ? { token: slackToken, userId } : undefined}
    />
  )
}
