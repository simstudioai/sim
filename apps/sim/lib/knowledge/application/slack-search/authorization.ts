import type { Principal, SlackInstallationPrincipal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import {
  findSlackSearchInstallation,
  loadSlackSearchCredential,
  type SlackSearchInstallation,
} from '@/lib/knowledge/application/slack-search/repository'
import {
  findSharedSlackSearchInstallation,
  requireSlackSearchAppAvailable,
} from '@/lib/slack-search/shared-app'

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
  return authorizeSlackSearchBinding(principal, installation, expected)
}

async function authorizeSlackSearchBinding(
  principal: SlackInstallationPrincipal,
  installation: SlackSearchInstallation,
  expected?: { installationId: string; revision: string }
) {
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
  await requireSlackSearchAppAvailable(installation.appId, installation.organizationId)
  const secret = await loadSlackSearchCredential(
    installation.credentialId,
    installation.organizationId
  )
  if (secret.version !== installation.credentialVersion)
    throw new OrchestrationError('forbidden', 'Slack bot requires revalidation')
  return { installation, secret }
}

/** A retired custom bot may only point to the active shared app in the same organization and team. */
export async function authorizeSlackSearchRedirect(
  principal: Principal,
  expected?: { installationId: string; revision: string }
) {
  requireSlackInstallationPrincipal(principal)
  const installation = await findSlackSearchInstallation(principal.credentialId)
  if (!installation || installation.enabled) return null
  const context = await authorizeSlackSearchBinding(principal, installation, expected)
  if (context.secret.appKind !== 'custom') return null
  const replacement = await findSharedSlackSearchInstallation(installation.organizationId)
  if (
    !replacement ||
    replacement.organizationId !== installation.organizationId ||
    replacement.teamId !== installation.teamId ||
    replacement.appId === installation.appId
  )
    return null
  const secret = await loadSlackSearchCredential(
    replacement.credentialId,
    installation.organizationId
  )
  if (secret.version !== replacement.credentialVersion)
    throw new OrchestrationError('forbidden', 'Slack bot requires revalidation')
  return { ...context, replacement }
}
