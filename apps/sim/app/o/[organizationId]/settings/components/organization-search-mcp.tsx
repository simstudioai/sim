'use client'

import { SearchMcpConnection } from '@/components/search-mcp-connection'
import { getSearchMcpUrl } from '@/lib/knowledge/mcp/urls'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

export function OrganizationSearchMcp() {
  const { organization } = useOrganizationContext()
  const endpoint = getSearchMcpUrl('organization', organization.id)

  return (
    <div className='flex max-w-xl flex-col gap-4'>
      <SearchMcpConnection key={organization.id} endpoint={endpoint} flush />
    </div>
  )
}
