import {
  Chip,
  ChipLink,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import Link from 'next/link'
import { organizationRoutes } from '@/lib/navigation/paths'

interface AccountPermissionsLinkProps {
  organizationId: string
  accounts: readonly { credentialId: string; displayName: string }[]
}

export function AccountPermissionsLink({ organizationId, accounts }: AccountPermissionsLinkProps) {
  const routes = organizationRoutes(organizationId)
  const [account] = accounts
  if (!account) return null
  if (accounts.length === 1)
    return (
      <ChipLink href={routes.accountToolPermissions(account.credentialId)}>
        Tool permissions
      </ChipLink>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip rightIcon={ChevronDown}>Tool permissions</Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {accounts.map((entry) => (
          <DropdownMenuItem key={entry.credentialId} asChild>
            <Link href={routes.accountToolPermissions(entry.credentialId)}>
              {entry.displayName}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
