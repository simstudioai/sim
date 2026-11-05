import type { PersonalOrganizationAccount } from '@/lib/api/contracts/organization-accounts'

export const PERSONAL_ACCOUNT_STATUS_LABELS = {
  active: null,
  needs_reauth: 'Reconnect needed',
  revoked: 'Disconnected',
} as const satisfies Record<PersonalOrganizationAccount['status'], string | null>

/** A person's accounts by organization, named alphabetically, as `[id, group]` entries. */
export function groupByOrganization(accounts: PersonalOrganizationAccount[]) {
  const groups = new Map<string, { name: string; accounts: PersonalOrganizationAccount[] }>()
  for (const account of accounts) {
    const group = groups.get(account.organizationId)
    if (group) group.accounts.push(account)
    else groups.set(account.organizationId, { name: account.organizationName, accounts: [account] })
  }
  return [...groups.entries()].sort(([, left], [, right]) => left.name.localeCompare(right.name))
}
