import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  getOrganizationSettingsFeatures,
  isOrganizationSettingsSectionAvailable,
  type OrganizationSettingsSection,
  resolveWorkspaceNavigation,
  type WorkspaceSettingsSection,
} from '@/components/settings/navigation'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { hasWorkspaceInboxAccess } from '@/lib/billing/core/subscription'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { canOpenOrganizationSettingsSection } from '@/lib/organizations/settings-access'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import {
  allNavigationItems,
  getSettingsSectionMeta,
  type SettingsSection,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import { resolveWorkspaceGroup } from '@/ee/access-control/utils/permission-check'
import { isForkingAvailableForWorkspace } from '@/ee/workspace-forking/lib/lineage/authz'
import { prefetchGeneralSettings, prefetchUserProfile } from './prefetch'
import { SettingsPage } from './settings'

interface WorkspaceSettingsSectionPageProps {
  params: Promise<{ workspaceId: string; section: string }>
}

const SECTION_ALIASES: Readonly<Record<string, SettingsSection>> = {
  subscription: 'billing',
  team: 'organization',
  'api-keys': 'apikeys',
}

const TOP_LEVEL_REDIRECTS: Readonly<Record<string, (workspaceId: string) => string>> = {
  integrations: (workspaceId) => `/workspace/${workspaceId}/integrations`,
  skills: (workspaceId) => `/workspace/${workspaceId}/skills`,
}

const WORKSPACE_SECTION_MAP: Partial<Record<SettingsSection, WorkspaceSettingsSection>> = {
  teammates: 'teammates',
  secrets: 'secrets',
  byok: 'byok',
  'custom-tools': 'custom-tools',
  mcp: 'mcp',
  'workflow-mcp-servers': 'workflow-mcp-servers',
  apikeys: 'api-keys',
  inbox: 'inbox',
  'recently-deleted': 'recently-deleted',
  forks: 'forks',
  'custom-blocks': 'custom-blocks',
}

const ORGANIZATION_SECTION_MAP: Partial<Record<SettingsSection, OrganizationSettingsSection>> = {
  organization: 'members',
  billing: 'billing',
  'access-control': 'access-control',
  'audit-logs': 'audit-logs',
  sso: 'sso',
  'data-retention': 'data-retention',
  'data-drains': 'data-drains',
  whitelabeling: 'whitelabeling',
}

function parseSection(section: string): SettingsSection | null {
  const normalized = SECTION_ALIASES[section] ?? section
  return allNavigationItems.some((item) => item.id === normalized)
    ? (normalized as SettingsSection)
    : null
}

export async function generateMetadata({
  params,
}: WorkspaceSettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params
  const parsed = parseSection(section)
  const meta = parsed ? getSettingsSectionMeta(parsed) : null
  return { title: meta?.label ?? 'Settings' }
}

export default async function WorkspaceSettingsSectionPage({
  params,
}: WorkspaceSettingsSectionPageProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { workspaceId, section } = await params
  const topLevelHref = TOP_LEVEL_REDIRECTS[section]?.(workspaceId)
  if (topLevelHref) redirect(topLevelHref)
  const parsed = parseSection(section)
  if (!parsed) notFound()

  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
  if (!hostContext) notFound()

  if (parsed === 'admin' || parsed === 'mothership') {
    if (!(await isPlatformAdmin(session.user.id))) notFound()
  }

  const workspaceSection = WORKSPACE_SECTION_MAP[parsed]
  if (workspaceSection) {
    const [permissionGroup, forksAvailable, inboxAvailable] = await Promise.all([
      hostContext.hostOrganizationId && hostContext.ownerBilling.isEnterprise
        ? resolveWorkspaceGroup(session.user.id, hostContext.hostOrganizationId, workspaceId)
        : null,
      isForkingAvailableForWorkspace(hostContext.hostOrganizationId, session.user.id),
      hasWorkspaceInboxAccess(workspaceId),
    ])
    const customBlocksAvailable = isHosted
      ? hostContext.ownerBilling.isEnterprise
      : isTruthy(getEnv('NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED'))
    const navigation = resolveWorkspaceNavigation({
      permission: hostContext.viewer.permission,
      permissionConfig: permissionGroup?.config ?? {},
      entitlements: {
        byok: isHosted,
        inbox: inboxAvailable,
        customBlocks: customBlocksAvailable,
        forks: forksAvailable,
      },
    })
    if (!navigation.some((item) => item.id === workspaceSection)) notFound()
  }

  const organizationSection = ORGANIZATION_SECTION_MAP[parsed]
  if (organizationSection) {
    if (!isBillingEnabled && (parsed === 'billing' || parsed === 'organization')) {
      redirect(`/workspace/${workspaceId}/settings/general`)
    }
    if (!hostContext.hostOrganizationId) {
      if (parsed !== 'billing' || hostContext.workspace.billedAccountUserId !== session.user.id) {
        notFound()
      }
    } else {
      if (!hostContext.viewer.isHostOrganizationAdmin) notFound()
      if (
        !(await canOpenOrganizationSettingsSection(
          hostContext.hostOrganizationId,
          session.user.id,
          organizationSection
        ))
      ) {
        notFound()
      }
      const hasEnterprisePlan =
        organizationSection !== 'members' &&
        organizationSection !== 'billing' &&
        (await isOrganizationOnEnterprisePlan(hostContext.hostOrganizationId))
      if (
        !isOrganizationSettingsSectionAvailable(
          organizationSection,
          getOrganizationSettingsFeatures(hasEnterprisePlan)
        )
      ) {
        notFound()
      }
    }
  }

  const queryClient = getQueryClient()
  void prefetchGeneralSettings(queryClient)
  void prefetchUserProfile(queryClient)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={null}>
        <SettingsPage section={parsed} />
      </Suspense>
    </HydrationBoundary>
  )
}
