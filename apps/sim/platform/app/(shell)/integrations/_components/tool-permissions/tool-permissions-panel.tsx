'use client'

import { useQueryStates } from 'nuqs'
import { integrationViewParsers } from '@/app/o/[organizationId]/integrations/search-params'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions'
import { QueryBoundary } from '@/platform/design-system/components'
import { useToolPermissions } from '@/platform/lib/data/integrations'

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
  const [{ tools: search }, setParams] = useQueryStates(integrationViewParsers)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setParams({ tools: value }, options)
  )
  if (!view) {
    return (
      <QueryBoundary
        query={{ ...query, data: undefined }}
        failure='Could not load tool permissions'
        loadingLabel='Loading tool permissions'
      >
        {() => null}
      </QueryBoundary>
    )
  }
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
