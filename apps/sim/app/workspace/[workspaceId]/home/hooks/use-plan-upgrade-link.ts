'use client'

import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import { useSettingsNavigationTarget } from '@/components/settings/settings-navigation-provider'
import { useSession } from '@/lib/auth/client'
import { CHAT_PLAN_REQUIRED_REASON } from '@/lib/billing/chat-plan'
import {
  buildHostedUpgradeUrl,
  buildUpgradeHref,
  HOSTED_BILLING_SETTINGS_URL,
} from '@/lib/billing/upgrade-reasons'
import type { UsageUpgradeTagPayload } from '@/lib/billing/usage-upgrade'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { useOptionalOrganization } from '@/lib/organizations/provider'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-context'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

interface PlanUpgradeLinkInput {
  reason: string
  action: UsageUpgradeTagPayload['action']
}

interface PlanUpgradeLink {
  href: string
  opensInNewTab: boolean
  buttonLabel: string
  /** Whether the viewer may change the plan or limit; when false, show `unavailableMessage`. */
  canManageBilling: boolean
  unavailableMessage: string
}

/**
 * Where a usage-upgrade prompt sends the viewer, and whether they may go: the payer's plan or
 * limit, or a free plan that does not include Chat. A workspace's plan links to its upgrade page;
 * self-hosted plans and limits live on the hosted account.
 */
export function usePlanUpgradeLink(data: PlanUpgradeLinkInput): PlanUpgradeLink {
  const { data: session } = useSession()
  const hostContext = useOptionalWorkspaceHostContext()
  const organizationContext = useOptionalOrganization()
  const { getSettingsHref } = useSettingsNavigation()
  const { hosted } = useDeploymentShape()
  const navigationTarget = useSettingsNavigationTarget()
  const planRequired = data.reason === CHAT_PLAN_REQUIRED_REASON

  // Self-hosted plan and limit both live on the hosted account, so local
  // workspace billing roles say nothing about who may change them.
  const href = hosted
    ? organizationContext
      ? getOrganizationSettingsHref(organizationContext.organization.id, 'billing')
      : planRequired && hostContext
        ? buildUpgradeHref(hostContext.workspace.id)
        : getSettingsHref({ section: 'billing' })
    : data.action === 'upgrade_plan'
      ? buildHostedUpgradeUrl()
      : HOSTED_BILLING_SETTINGS_URL
  const canManageBilling =
    !hosted ||
    (organizationContext
      ? organizationContext.viewer.isAdmin
      : Boolean(hostContext && canManageWorkspaceBilling(hostContext, session?.user?.id)))
  const action = planRequired
    ? 'upgrade this workspace’s plan'
    : 'manage this workspace’s usage limits'
  const unavailableMessage = organizationContext
    ? planRequired
      ? 'Contact an organization admin to upgrade this organization’s plan.'
      : 'Contact an organization admin to manage usage limits.'
    : hostContext?.hostOrganizationId
      ? `Contact an organization admin to ${action}.`
      : `Only the workspace owner can ${action}.`

  return {
    href,
    opensInNewTab: !hosted || navigationTarget === '_blank',
    buttonLabel: data.action === 'upgrade_plan' ? 'Upgrade Plan' : 'Increase Limit',
    canManageBilling,
    unavailableMessage,
  }
}
