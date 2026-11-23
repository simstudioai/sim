/**
 * Query keys for an organization's connected accounts. Not a `'use client'` module, so a server
 * prefetch can seed the same entry the client hook reads.
 */
export const ORGANIZATION_ACCOUNTS_STALE_TIME = 30_000

export const organizationAccountsKeys = {
  all: ['organization-accounts'] as const,
  connection: () => [...organizationAccountsKeys.all, 'connection'] as const,
  personal: () => [...organizationAccountsKeys.all, 'personal'] as const,
  workspaces: () => [...organizationAccountsKeys.all, 'workspace'] as const,
  workspace: (workspaceId?: string) =>
    [...organizationAccountsKeys.workspaces(), workspaceId ?? ''] as const,
  access: (id?: string) => [...organizationAccountsKeys.detail(id), 'access'] as const,
  people: (id?: string) => [...organizationAccountsKeys.detail(id), 'people'] as const,
  peopleList: (id: string, search?: string, optionId?: string) =>
    [
      ...organizationAccountsKeys.people(id),
      { search: search ?? '', optionId: optionId ?? '' },
    ] as const,
  databricks: (id?: string) => [...organizationAccountsKeys.detail(id), 'databricks'] as const,
  details: () => [...organizationAccountsKeys.all, 'detail'] as const,
  detail: (organizationId?: string) =>
    [...organizationAccountsKeys.details(), organizationId ?? ''] as const,
}
