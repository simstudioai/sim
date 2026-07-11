import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  getLegacyTopLevelWorkspaceHref,
  getSettingsSectionMeta,
  LEGACY_SETTINGS_SECTIONS,
  parseSettingsPathSection,
  resolveLegacySettingsHref,
  resolveWorkspaceNavigation,
  WORKSPACE_SETTINGS_ITEMS,
  WORKSPACE_SETTINGS_PATH_ALIASES,
} from '@/components/settings/navigation'
import { WorkspaceSettingsRenderer } from '@/components/settings/workspace-settings-renderer'
import { getSession } from '@/lib/auth'
import { hasWorkspaceInboxAccess } from '@/lib/billing/core/subscription'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { resolveWorkspaceGroup } from '@/ee/access-control/utils/permission-check'
import { isForkingAvailableForWorkspace } from '@/ee/workspace-forking/lib/lineage/authz'

interface WorkspaceSettingsSectionPageProps {
  params: Promise<{ workspaceId: string; section: string }>
}

export async function generateMetadata({
  params,
}: WorkspaceSettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params
  const parsed = parseSettingsPathSection({
    path: section,
    items: WORKSPACE_SETTINGS_ITEMS,
    defaultSection: null,
    aliases: WORKSPACE_SETTINGS_PATH_ALIASES,
  })
  const meta = parsed ? getSettingsSectionMeta('workspace', parsed) : null
  return { title: meta ? `${meta.label} - Workspace settings` : 'Settings' }
}

export default async function WorkspaceSettingsSectionPage({
  params,
}: WorkspaceSettingsSectionPageProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { workspaceId, section } = await params
  const topLevelHref = getLegacyTopLevelWorkspaceHref(workspaceId, section)
  if (topLevelHref) redirect(topLevelHref)

  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
  if (!hostContext) notFound()

  const legacy = LEGACY_SETTINGS_SECTIONS.find((item) => item.legacySection === section)
  if (legacy && (legacy.plane !== 'workspace' || legacy.section !== section)) {
    redirect(
      resolveLegacySettingsHref({
        legacySection: section,
        workspaceId,
        hostOrganizationId: hostContext.hostOrganizationId,
        isTargetOrganizationMember: hostContext.viewer.isHostOrganizationMember,
      })
    )
  }

  const parsed = parseSettingsPathSection({
    path: section,
    items: WORKSPACE_SETTINGS_ITEMS,
    defaultSection: null,
    aliases: WORKSPACE_SETTINGS_PATH_ALIASES,
  })
  if (!parsed) notFound()

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
  if (!navigation.some((item) => item.id === parsed)) notFound()

  return <WorkspaceSettingsRenderer section={parsed} />
}
