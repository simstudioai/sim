'use client'

import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import {
  type AccountSettingsSection,
  ORGANIZATION_SETTINGS_GROUPS,
  type OrganizationSettingsSection,
} from '@/components/settings/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import { useSession } from '@/lib/auth/client'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import {
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
} from '@/lib/billing/subscriptions/utils'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSurfaceSettingsNavigation,
  resolveOrganizationSurfaceSection,
} from '@/app/o/[organizationId]/settings/navigation'
import { warmOrganizationSettingsSectionQuery } from '@/app/o/[organizationId]/settings/settings-query-warmers'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useOrganizationBillingSummary } from '@/hooks/queries/organization-billing-summary'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

export type SettingsSectionKey = AccountSettingsSection | OrganizationSettingsSection

const SECTION_ICONS: Partial<Record<SettingsSectionKey, IconName>> = {
  general: 'I116',
  billing: 'I138',
  'knowledge-graphs': 'I004',
  members: 'I133',
  'connected-accounts': 'I100',
  usage: 'I135',
  whitelabeling: 'I036',
  'recently-deleted': 'I061',
  requests: 'I073',
  'audit-logs': 'I075',
  'access-control': 'I050',
  sso: 'I137',
  security: 'I136',
  'data-retention': 'I046',
  'data-drains': 'I117',
  integrations: 'I070',
  'search-mcp': 'I126',
  'search-slack': 'I123',
  admin: 'I107',
  mothership: 'I128',
}

interface SettingsNavItem {
  key: SettingsSectionKey
  title: string
  description?: string
  icon: IconName
  href: string
}

export interface SettingsNavGroup {
  key: string
  title: string
  items: SettingsNavItem[]
}

/**
 * The viewer's Settings rail. Order, labels and gates are the organization surface's own
 * (`organizationSurfaceSettingsNavigation`), with the plan refreshed from the shared billing summary
 * so a portal change shows on focus. A listed row authorizes nothing: the page and its APIs gate
 * themselves.
 */
export function useSettingsNavigation() {
  const { organization, viewer, connectedAccountsAvailable, searchAccess, settingsFeatures } =
    useOrganizationContext()
  const knowledgeGraphs = useFeatureFlag('mothership-memory-spaces')
  const pathname = usePathname()
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const refreshPlan = viewer.isAdmin && settingsFeatures.hosted && settingsFeatures.billingEnabled
  const { data: summary, error } = useOrganizationBillingSummary(organization.id, {
    enabled: refreshPlan,
  })
  const accessDenied =
    refreshPlan && isApiClientError(error) && [401, 403, 404].includes(error.status)
  const isAdmin = viewer.isAdmin && !accessDenied
  /** Server features paint immediately; the shared summary keeps portal changes current on focus. */
  const features = {
    ...settingsFeatures,
    hasEnterprisePlan:
      refreshPlan && summary
        ? summary.data.subscriptionState === 'active' &&
          isEnterprise(summary.data.subscriptionPlan) &&
          hasUsableSubscriptionAccess(summary.data.subscriptionStatus, summary.data.billingBlocked)
        : settingsFeatures.hasEnterprisePlan,
    /**
     * Refreshed from the same summary, or the item the plan gate just hid would reappear only on
     * reload. Governance keeps its own rule — an entitled status, block state ignored — because a
     * failing payment does not stop the organization's permission groups from applying.
     */
    governanceActive:
      refreshPlan && summary
        ? isEnterprise(summary.data.subscriptionPlan) &&
          hasPaidSubscriptionStatus(summary.data.subscriptionStatus)
        : settingsFeatures.governanceActive,
  }
  const routes = organizationRoutes(organization.id)
  const items = organizationSurfaceSettingsNavigation(
    isAdmin,
    features,
    {
      connectedAccounts: connectedAccountsAvailable,
      search: searchAccess.memberScoped,
      knowledgeGraphs,
    },
    session?.user?.role === 'admin'
  )
  const groups: SettingsNavGroup[] = ORGANIZATION_SETTINGS_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    items: items
      .filter((item) => item.group === group.key)
      .map((item) => ({
        key: item.id,
        title: item.label,
        description: item.description,
        icon: SECTION_ICONS[item.id] ?? 'I116',
        href: routes.settingsSection(item.id),
      })),
  })).filter((group) => group.items.length > 0)

  return {
    groups,
    activeSection: resolveOrganizationSurfaceSection(pathname ?? '')?.section ?? 'general',
    isAdmin,
    hosted: settingsFeatures.hosted,
    /** Where Back to app lands when no return URL was remembered on the way in. */
    backHref: searchAccess.memberScoped ? routes.home : WORKSPACE_SETTINGS_PATH,
    warmSection: (section: SettingsSectionKey) =>
      warmOrganizationSettingsSectionQuery(
        queryClient,
        { organizationId: organization.id, isAdmin },
        section
      ),
  }
}
