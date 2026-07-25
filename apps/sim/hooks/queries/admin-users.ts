import { createLogger } from '@sim/logger'
import { isValidUuid } from '@sim/utils/id'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'

const logger = createLogger('AdminUsersQuery')

export const ADMIN_USER_LIST_STALE_TIME = 30 * 1000

export const adminUserKeys = {
  all: ['adminUsers'] as const,
  lists: () => [...adminUserKeys.all, 'list'] as const,
  list: (offset: number, limit: number, searchQuery: string) =>
    [...adminUserKeys.lists(), offset, limit, searchQuery] as const,
  byEmails: (emails: string[]) => [...adminUserKeys.lists(), 'byEmails', emails] as const,
}

export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  banReason: string | null
}

interface AdminUserListData {
  users: AdminUser[]
  total: number
}

function mapUser(u: {
  id: string
  name: string
  email: string
  role?: string | null
  banned?: boolean | null
  banReason?: string | null
}): AdminUser {
  return {
    id: u.id,
    name: u.name || '',
    email: u.email,
    role: u.role ?? 'user',
    banned: u.banned ?? false,
    banReason: u.banReason ?? null,
  }
}

async function fetchAdminUsers(
  offset: number,
  limit: number,
  searchQuery: string,
  signal?: AbortSignal
): Promise<AdminUserListData> {
  if (isValidUuid(searchQuery.trim())) {
    const { data, error } = await client.admin.getUser(
      { query: { id: searchQuery.trim() } },
      { signal }
    )
    if (error) throw new Error(error.message ?? 'Failed to fetch user')
    if (!data) return { users: [], total: 0 }
    return { users: [mapUser(data)], total: 1 }
  }

  const { data, error } = await client.admin.listUsers(
    {
      query: {
        limit,
        offset,
        searchField: 'email',
        searchValue: searchQuery,
        searchOperator: 'contains',
      },
    },
    { signal }
  )
  if (error) throw new Error(error.message ?? 'Failed to fetch users')
  return {
    users: (data?.users ?? []).map(mapUser),
    total: data?.total ?? 0,
  }
}

async function fetchAdminUsersByEmails(
  emails: string[],
  signal?: AbortSignal
): Promise<AdminUser[]> {
  const results = await Promise.all(
    emails.map(async (email) => {
      const { data, error } = await client.admin.listUsers(
        {
          query: {
            limit: 1,
            filterField: 'email',
            filterValue: email,
            filterOperator: 'eq',
          },
        },
        { signal }
      )
      if (error) throw new Error(error.message ?? 'Failed to fetch user')
      const user = (data?.users ?? [])[0]
      return user ? mapUser(user) : null
    })
  )
  return results.filter((u): u is AdminUser => u !== null)
}

/** Resolves each email to its exact-match user; unmatched emails are dropped. */
export function useAdminUsersByEmails(emails: string[]) {
  return useQuery({
    queryKey: adminUserKeys.byEmails(emails),
    queryFn: ({ signal }) => fetchAdminUsersByEmails(emails, signal),
    enabled: emails.length > 0,
    staleTime: ADMIN_USER_LIST_STALE_TIME,
  })
}

export function useAdminUsers(offset: number, limit: number, searchQuery: string) {
  return useQuery({
    queryKey: adminUserKeys.list(offset, limit, searchQuery),
    queryFn: ({ signal }) => fetchAdminUsers(offset, limit, searchQuery, signal),
    enabled: searchQuery.length > 0,
    staleTime: ADMIN_USER_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

export function useSetUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'user' | 'admin' }) => {
      const result = await client.admin.setRole({ userId, role })
      return result
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() }),
    onError: (err) => {
      logger.error('Failed to set user role', err)
    },
  })
}

export function useBanUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, banReason }: { userId: string; banReason?: string }) => {
      const result = await client.admin.banUser({
        userId,
        ...(banReason ? { banReason } : {}),
      })
      return result
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() }),
    onError: (err) => {
      logger.error('Failed to ban user', err)
    },
  })
}

export function useUnbanUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      const result = await client.admin.unbanUser({ userId })
      return result
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() }),
    onError: (err) => {
      logger.error('Failed to unban user', err)
    },
  })
}

export function useImpersonateUser() {
  return useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      const result = await client.admin.impersonateUser({ userId })
      return result
    },
    onError: (err) => {
      logger.error('Failed to impersonate user', err)
    },
  })
}

export function useStopImpersonating() {
  return useMutation({
    mutationFn: async () => {
      const result = await client.admin.stopImpersonating()
      return result
    },
    onError: (err) => {
      logger.error('Failed to stop impersonating', err)
    },
  })
}
