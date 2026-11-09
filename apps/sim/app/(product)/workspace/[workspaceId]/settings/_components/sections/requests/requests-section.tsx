'use client'

import { RequestsPanel } from '@/app/(product)/_components/access-requests/requests-panel'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

/** The viewer's requests filed in this workspace; host organization administrators also review. */
export default function RequestsSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { hostContext } = useWorkspaceSettingsSection(workspaceId, 'requests')
  const reviewer = hostContext?.viewer.isHostOrganizationAdmin
  return (
    <RequestsPanel
      scope={{ kind: 'workspace', workspaceId }}
      reviewOrganizationId={(reviewer && hostContext?.hostOrganizationId) || undefined}
    />
  )
}
