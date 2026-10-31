'use client'

import { Users } from '@sim/emcn/icons'
import { PEOPLE_COLUMNS, PEOPLE_SEARCH_PLACEHOLDER } from '@/app/o/[organizationId]/people/columns'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

export default function PeopleLoading() {
  return (
    <ResourceChromeFallback
      icon={Users}
      title='People'
      columns={PEOPLE_COLUMNS}
      searchPlaceholder={PEOPLE_SEARCH_PLACEHOLDER}
      hasFilter
    />
  )
}
