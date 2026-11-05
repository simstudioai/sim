'use client'

import { useQueryStates } from 'nuqs'
import { integrationViewParsers } from '@/app/o/[organizationId]/integrations/search-params'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { QueryFailure } from '@/platform/app/(shell)/integrations/_components/query-failure/query-failure'
import { ToolPermissions } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions'
import { InlineNotice } from '@/platform/design-system/components'
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
  if (query.error) return <QueryFailure message='Could not load tool permissions' query={query} />
  if (!view) return <InlineNotice message='Loading tool permissions' />
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
