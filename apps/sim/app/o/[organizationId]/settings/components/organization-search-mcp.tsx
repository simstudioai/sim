'use client'

import { getSearchMcpUrl } from '@/lib/knowledge/mcp/urls'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SearchMcpConnection } from '@/app/o/[organizationId]/settings/components/search-mcp-connection'

export function OrganizationSearchMcp() {
  const { organization } = useOrganizationContext()
  const endpoint = getSearchMcpUrl(organization.id)

  return (
    <div className='flex max-w-xl flex-col gap-4'>
      <SearchMcpConnection key={organization.id} endpoint={endpoint} />
    </div>
  )
}
