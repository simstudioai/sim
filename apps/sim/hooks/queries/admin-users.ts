import { createLogger } from '@sim/logger'
import { isValidUuid } from '@sim/utils/id'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'

const logger = createLogger('AdminUsersQuery')

export const adminUserKeys = {
  all: ['adminUsers'] as const,
  lists: () => [...adminUserKeys.all, 'list'] as const,
  list: (offset: number, limit: number, searchQuery: string) =>
    [...adminUserKeys.lists(), offset, limit, searchQuery] as const,
}

interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  banned: boolean
  banReason: string | null
}

interface AdminUsersResponse {
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
  searchQuery: string
): Promise<AdminUsersResponse> {
  if (isValidUuid(searchQuery.trim())) {
    const { data, error } = await client.admin.getUser({ query: { id: searchQuery.trim() } })
    if (error) throw new Error(error.message ?? 'Failed to fetch user')
    if (!data) return { users: [], total: 0 }
    return { users: [mapUser(data)], total: 1 }
  }

  const { data, error } = await client.admin.listUsers({
    query: {
      limit,
      offset,
      searchField: 'email',
      searchValue: searchQuery,
      searchOperator: 'contains',
    },
  })
  if (error) throw new Error(error.message ?? 'Failed to fetch users')
  return {
    users: (data?.users ?? []).map(mapUser),
    total: data?.total ?? 0,
  }
}

export function useAdminUsers(offset: number, limit: number, searchQuery: string) {
  return useQuery({
    queryKey: adminUserKeys.list(offset, limit, searchQuery),
    queryFn: () => fetchAdminUsers(offset, limit, searchQuery),
    enabled: searchQuery.length > 0,
    staleTime: 30 * 1000,
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
    },
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
    },
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
    },
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
