'use client'

import { Link } from '@sim/emcn/icons'
import {
  NEW_SIM_LINK_ACTION,
  SIM_LINK_COLUMNS,
  SIM_LINKS_SEARCH_PLACEHOLDER,
} from '@/app/o/[organizationId]/links/columns'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

export default function SimLinksLoading() {
  return (
    <ResourceChromeFallback
      icon={Link}
      title='Sim Links'
      columns={SIM_LINK_COLUMNS}
      actions={[NEW_SIM_LINK_ACTION]}
      searchPlaceholder={SIM_LINKS_SEARCH_PLACEHOLDER}
      hasSort
    />
  )
}
