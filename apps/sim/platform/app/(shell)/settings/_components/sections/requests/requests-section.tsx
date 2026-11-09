import { RequestsPanel } from '@/platform/app/(shell)/_components/access-requests/requests-panel'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'

export default function RequestsSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  return (
    <RequestsPanel
      scope={{ kind: 'organization', organizationId }}
      reviewOrganizationId={organization.viewer.isAdmin ? organizationId : undefined}
    />
  )
}
