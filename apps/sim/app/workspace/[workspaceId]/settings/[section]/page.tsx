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
  workspaceSectionUsesPermissionConfig,
} from '@/components/settings/navigation'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { canOpenOrganizationSettingsSection } from '@/lib/organizations/settings-access'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { isCustomBlocksEligibleForOrganization } from '@/lib/workflows/custom-blocks/operations'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import {
  resolveSettingsSection,
  type SettingsSection,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import { resolveWorkspaceGroup } from '@/ee/access-control/utils/permission-check'
import { isForkingAvailableForWorkspace } from '@/ee/workspace-forking/lib/lineage/authz'
import { SECTION_PREFETCHERS } from './prefetch'
import { SettingsPage } from './settings'

interface WorkspaceSettingsSectionPageProps {
  params: Promise<{ workspaceId: string; section: string }>
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
  return { title: resolveSettingsSection(section)?.meta.title ?? 'Settings' }
}

export default async function WorkspaceSettingsSectionPage({
  params,
}: WorkspaceSettingsSectionPageProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { workspaceId, section } = await params
  /** The layout already rejected an unknown segment; this narrows the type and fails safe. */
  const resolved = resolveSettingsSection(section)
  if (!resolved) notFound()
  const parsed = resolved.id

  /**
   * Independent given the session, and both gate the same render, so they overlap rather than
   * queue. Every await here sits in front of the section's body, so it is the length of this
   * chain that the user waits out.
   */
  const requiresPlatformAdmin = parsed === 'admin' || parsed === 'mothership'
  const [hostContext, isViewerPlatformAdmin] = await Promise.all([
    getWorkspaceHostContextForViewer(workspaceId, session.user.id),
    requiresPlatformAdmin ? isPlatformAdmin(session.user.id) : Promise.resolve(false),
  ])
  if (!hostContext) notFound()
  if (requiresPlatformAdmin && !isViewerPlatformAdmin) notFound()

  const queryClient = getQueryClient()
  /**
   * Start the viewer-scoped prefetch as soon as workspace access is established. Organization
   * and section-entitlement gates remain authoritative, but their independent reads no longer
   * serialize in front of this data. The promise is still awaited before dehydration below.
   */
  const sectionPrefetch =
    SECTION_PREFETCHERS[parsed]?.(queryClient, {
      workspaceId,
      userId: session.user.id,
    }) ?? Promise.resolve()

  const workspaceSection = WORKSPACE_SECTION_MAP[parsed]
  if (workspaceSection) {
    /**
     * The gate asks one question — is this section in the viewer's navigation — so it resolves
     * only the entitlements that can answer it, and only for the section being opened.
     *
     * `credentialGroups` is already on the host context, derived from the same owner billing one
     * await earlier, so asking again is a second feature-flag lookup for an answer in hand.
     *
     * `inbox` and `sandboxes` feed only `locked`, which marks a section as needing an upgrade
     * rather than hiding it. This gate reads membership alone, so their two billing round-trips
     * could not change the outcome for any section.
     *
     * `forks` is read only by the `forks` entry, so every other section resolved a lineage
     * check it could not act on. Passing `false` elsewhere is safe in the one direction that
     * matters: it can only remove `forks` from a list this gate is not asking about.
     *
     * Permission-group config is narrowed by the same policy map that hides navigation items.
     * Every other section is independent of that config, so resolving the viewer's group for it
     * can never change this gate's answer.
     */
    const [permissionGroup, forksAvailable, customBlocksAvailable] = await Promise.all([
      hostContext.hostOrganizationId &&
      hostContext.ownerBilling.isEnterprise &&
      workspaceSectionUsesPermissionConfig(workspaceSection)
        ? resolveWorkspaceGroup(session.user.id, hostContext.hostOrganizationId, workspaceId)
        : null,
      workspaceSection === 'forks'
        ? isForkingAvailableForWorkspace(hostContext.hostOrganizationId, session.user.id)
        : Promise.resolve(false),
      workspaceSection === 'custom-blocks' && hostContext.hostOrganizationId
        ? isCustomBlocksEligibleForOrganization(hostContext.hostOrganizationId)
        : Promise.resolve(false),
    ])
    const navigation = resolveWorkspaceNavigation({
      permission: hostContext.viewer.permission,
      permissionConfig: permissionGroup?.config ?? {},
      entitlements: {
        byok: isHosted,
        credentialGroups: hostContext.features?.credentialGroups ?? false,
        inbox: true,
        customBlocks: customBlocksAvailable,
        forks: forksAvailable,
        sandboxes: true,
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
      /**
       * Overlapped for the same reason: neither reads the other's result. The plan lookup is
       * skipped for the two sections that do not gate on it, so the only case that pays for a
       * lookup it does not use is one that was about to redirect anyway.
       */
      const needsEnterprisePlan =
        organizationSection !== 'members' && organizationSection !== 'billing'
      const [canOpenSection, isEnterpriseOrganization] = await Promise.all([
        canOpenOrganizationSettingsSection(
          hostContext.hostOrganizationId,
          session.user.id,
          organizationSection
        ),
        needsEnterprisePlan
          ? isOrganizationOnEnterprisePlan(hostContext.hostOrganizationId)
          : Promise.resolve(false),
      ])
      if (!canOpenSection) {
        redirectToGeneralSettings(workspaceId)
      }
      if (
        !isOrganizationSettingsSectionAvailable(
          organizationSection,
          getOrganizationSettingsFeatures(needsEnterprisePlan && isEnterpriseOrganization)
        )
      ) {
        redirectToGeneralSettings(workspaceId)
      }
    }
  }

  /** Awaiting is required because unsettled queries are omitted from dehydration. */
  await sectionPrefetch

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={null}>
        <SettingsPage section={parsed} />
      </Suspense>
    </HydrationBoundary>
  )
}
