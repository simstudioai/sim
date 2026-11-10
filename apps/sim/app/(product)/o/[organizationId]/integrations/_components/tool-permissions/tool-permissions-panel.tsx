'use client'

import { FailureNotice } from '@sim/emcn/status'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import { ToolPermissions } from '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/tool-permissions'
import { useToolPermissions, useToolPermissionsSearch } from '@/platform/lib/data/integrations'

interface ToolPermissionsPanelProps {
  organizationId: string
  credentialId: string
  /** The account's own page names it; inside an integration's page the heading already has. */
  showHeading?: boolean
}

export function ToolPermissionsPanel({
  organizationId,
  credentialId,
  showHeading = false,
}: ToolPermissionsPanelProps) {
  const { query, view, pending, save } = useToolPermissions(organizationId, credentialId)
  const { search, setSearch } = useToolPermissionsSearch()
  if (query.error)
    return (
      <FailureNotice
        message='Could not load tool permissions'
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  if (!view) return null
  return (
    <>
      {showHeading && (
        <ProviderHeading
          name={view.heading.name}
          description={view.heading.account}
          icon={view.heading.icon}
        />
      )}
      <ToolPermissions
        permissions={view.permissions}
        query={search}
        onQueryChange={setSearch}
        pending={pending}
        onChange={save}
      />
    </>
  )
}
