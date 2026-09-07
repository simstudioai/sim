import { OrganizationPageLoading } from '@/app/o/[organizationId]/components/organization-page'

export default function Loading() {
  return (
    <OrganizationPageLoading
      title='Integrations'
      description='Connect the sources your organization searches'
    />
  )
}
