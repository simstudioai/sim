import type { Principal, SlackInstallationPrincipal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import {
  findSlackSearchInstallation,
  loadSlackSearchCredential,
} from '@/lib/knowledge/application/slack-search/repository'
import { requireSlackSearchAppAvailable } from '@/lib/slack-search/shared-app'

export function requireSlackInstallationPrincipal(
  principal: Principal
): asserts principal is SlackInstallationPrincipal {
  if (principal.kind !== 'slack_installation')
    throw new OrchestrationError('forbidden', 'Slack installation authority is required')
  const receivedAt = principal.receivedAt.getTime()
  if (
    !Number.isFinite(receivedAt) ||
    receivedAt > Date.now() ||
    receivedAt < Date.now() - 24 * 60 * 60 * 1000
  )
    throw new OrchestrationError('forbidden', 'Slack delivery has expired')
}

/** Rechecks the binding and exact authenticated secret on every lifecycle boundary. */
export async function authorizeSlackSearchInstallation(
  principal: Principal,
  expected?: { installationId: string; revision: string }
) {
  requireSlackInstallationPrincipal(principal)
  const installation = await findSlackSearchInstallation(principal.credentialId)
  if (!installation || !installation.enabled) return null
  if (
    installation.appId !== principal.appId ||
    installation.teamId !== principal.teamId ||
    installation.credentialVersion !== principal.credentialVersion ||
    (expected &&
      (expected.installationId !== installation.id || expected.revision !== installation.revision))
  ) {
    throw new OrchestrationError('forbidden', 'Slack Search binding is no longer valid')
  }
  await requireOrganizationSearchAvailable(installation.organizationId)
  await requireSlackSearchAppAvailable(installation.appId)
  const secret = await loadSlackSearchCredential(
    installation.credentialId,
    installation.organizationId
  )
  if (secret.version !== installation.credentialVersion)
    throw new OrchestrationError('forbidden', 'Slack bot requires revalidation')
  return { installation, secret }
}
