'use client'

import { Link } from '@sim/emcn/icons'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  INSTALL_EXTENSION_ACTION,
  NEW_SIM_LINK_ACTION,
  SIM_LINK_COLUMNS,
  SIM_LINKS_SEARCH_PLACEHOLDER,
} from '@/app/o/[organizationId]/links/columns'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

export default function SimLinksLoading() {
  const { hosted } = useDeploymentShape()
  return (
    <div inert aria-busy className='contents'>
      <ResourceChromeFallback
        icon={Link}
        title='Links'
        columns={SIM_LINK_COLUMNS}
        actions={hosted ? [INSTALL_EXTENSION_ACTION, NEW_SIM_LINK_ACTION] : [NEW_SIM_LINK_ACTION]}
        searchPlaceholder={SIM_LINKS_SEARCH_PLACEHOLDER}
        hasSort
      />
    </div>
  )
}
