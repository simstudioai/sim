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
import { hasWorkspaceInboxAccess, hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
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
import { prefetchGeneralSettings } from './prefetch'
import { SettingsPage } from './settings'

interface WorkspaceSettingsSectionPageProps {
  params: Promise<{ workspaceId: string; section: string }>
}

const SECTION_ALIASES: Readonly<Record<string, SettingsSection>> = {
  subscription: 'billing',
  team: 'organization',
  'api-keys': 'apikeys',
  // Verified domains moved into the SSO page; keep old links working.
  domains: 'sso',
}

const TOP_LEVEL_REDIRECTS: Readonly<Record<string, (workspaceId: string) => string>> = {
  integrations: (workspaceId) => `/workspace/${workspaceId}/integrations`,
  skills: (workspaceId) => `/workspace/${workspaceId}/skills`,
  // Cookie preferences moved into General; keep old links working.
  privacy: (workspaceId) => `/workspace/${workspaceId}/settings/general?view=privacy`,
}

const WORKSPACE_SECTION_MAP: Partial<Record<SettingsSection, WorkspaceSettingsSection>> = {
  teammates: 'teammates',
  secrets: 'secrets',
  'credential-groups': 'credential-groups',
  byok: 'byok',
  sandboxes: 'sandboxes',
  'custom-tools': 'custom-tools',
  mcp: 'mcp',
  'workflow-mcp-servers': 'workflow-mcp-servers',
  apikeys: 'api-keys',
  inbox: 'inbox',
  'recently-deleted': 'recently-deleted',
  forks: 'forks',
  'custom-blocks': 'custom-blocks',
  'self-host': 'self-host',
}

const ORGANIZATION_SECTION_MAP: Partial<Record<SettingsSection, OrganizationSettingsSection>> = {
  organization: 'members',
  billing: 'billing',
  'access-control': 'access-control',
  'audit-logs': 'audit-logs',
  sso: 'sso',
  sessions: 'sessions',
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

/**
 * Settings availability varies across workspaces, so a preserved section may
 * need to land on the destination workspace's universally available page.
 */
function redirectToGeneralSettings(workspaceId: string): never {
  redirect(`/workspace/${workspaceId}/settings/general`)
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
    const [permissionGroup, forksAvailable, inboxAvailable, sandboxes, credentialGroupsAvailable] =
      await Promise.all([
        hostContext.hostOrganizationId && hostContext.ownerBilling.isEnterprise
          ? resolveWorkspaceGroup(session.user.id, hostContext.hostOrganizationId, workspaceId)
          : null,
        isForkingAvailableForWorkspace(hostContext.hostOrganizationId, session.user.id),
        hasWorkspaceInboxAccess(workspaceId),
        hasWorkspaceSandboxAccess(workspaceId),
        isCredentialGroupsAvailable(hostContext.ownerBilling),
      ])
    const customBlocksAvailable = isHosted
      ? hostContext.ownerBilling.isEnterprise
      : isTruthy(getEnv('NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED'))
    const navigation = resolveWorkspaceNavigation({
      permission: hostContext.viewer.permission,
      permissionConfig: permissionGroup?.config ?? {},
      entitlements: {
        byok: isHosted,
        credentialGroups: credentialGroupsAvailable,
        inbox: inboxAvailable,
        customBlocks: customBlocksAvailable,
        forks: forksAvailable,
        sandboxes,
      },
    })
    if (!navigation.some((item) => item.id === workspaceSection)) {
      redirectToGeneralSettings(workspaceId)
    }
  }

  const organizationSection = ORGANIZATION_SECTION_MAP[parsed]
  if (organizationSection) {
    if (!isBillingEnabled && (parsed === 'billing' || parsed === 'organization')) {
      redirectToGeneralSettings(workspaceId)
    }
    if (!hostContext.hostOrganizationId) {
      if (parsed !== 'billing' || hostContext.workspace.billedAccountUserId !== session.user.id) {
        redirectToGeneralSettings(workspaceId)
      }
    } else {
      if (!hostContext.viewer.isHostOrganizationAdmin) {
        redirectToGeneralSettings(workspaceId)
      }
      if (
        !(await canOpenOrganizationSettingsSection(
          hostContext.hostOrganizationId,
          session.user.id,
          organizationSection
        ))
      ) {
        redirectToGeneralSettings(workspaceId)
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
        redirectToGeneralSettings(workspaceId)
      }
    }
  }

  const queryClient = getQueryClient()
  /**
   * Awaited, not fired and forgotten: only a settled query is dehydrated, so an unawaited
   * prefetch is dropped from the payload and the panel waterfalls anyway. The viewer's
   * profile is already seeded by the workspace layout under the same key, so it is not
   * repeated here.
   */
  await prefetchGeneralSettings(queryClient)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={null}>
        <SettingsPage section={parsed} />
      </Suspense>
    </HydrationBoundary>
  )
}
