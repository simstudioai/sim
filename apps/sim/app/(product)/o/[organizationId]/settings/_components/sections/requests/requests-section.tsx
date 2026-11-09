import { RequestsPanel } from '@/app/(product)/_components/access-requests/requests-panel'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'

export default function RequestsSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  return (
    <RequestsPanel
      scope={{ kind: 'organization', organizationId }}
      reviewOrganizationId={organization.viewer.isAdmin ? organizationId : undefined}
    />
  )
}
