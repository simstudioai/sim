'use client'

import {
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@sim/emcn'
import { Building, RefreshCw } from '@sim/emcn/icons'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationList } from '@/hooks/queries/organization'

interface OrganizationMenuItemsProps {
  currentOrganizationId?: string
  onNavigate?: () => void
}

/** Organization destinations come from membership, independently of workspace access. */
export function OrganizationMenuItems({
  currentOrganizationId,
  onNavigate,
}: OrganizationMenuItemsProps) {
  const query = useOrganizationList()
  const organizations = query.data?.filter(({ id }) => id !== currentOrganizationId) ?? []

  if (query.isError) {
    return (
      <>
        <DropdownMenuItem
          disabled={query.isFetching}
          onSelect={(event) => {
            event.preventDefault()
            void query.refetch()
          }}
        >
          <RefreshCw className='size-[14px]' />
          Retry loading organizations
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </>
    )
  }

  if (query.isLoading) {
    return <DropdownMenuItem disabled>Loading organizations…</DropdownMenuItem>
  }

  if (!organizations.length) return null

  return (
    <>
      <DropdownMenuLabel>Organizations</DropdownMenuLabel>
      {organizations.map((organization) => {
        const href = organizationRoutes(organization.id).home
        return (
          <DropdownMenuItem key={organization.id} asChild>
            <SettingsGuardedLink href={href} onNavigate={onNavigate}>
              <Building className='size-[14px]' />
              <DropdownMenuItemLabel label={organization.name} />
            </SettingsGuardedLink>
          </DropdownMenuItem>
        )
      })}
      <DropdownMenuSeparator />
    </>
  )
}
