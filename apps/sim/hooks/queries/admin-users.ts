import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/auth/auth-client'

const logger = createLogger('AdminUsersQuery')

export const adminUserKeys = {
  all: ['adminUsers'] as const,
  lists: () => [...adminUserKeys.all, 'list'] as const,
  list: (offset: number, limit: number) => [...adminUserKeys.lists(), offset, limit] as const,
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

async function fetchAdminUsers(offset: number, limit: number): Promise<AdminUsersResponse> {
  const { data, error } = await client.admin.listUsers({
    query: { limit, offset },
  })
  if (error) {
    throw new Error(error.message ?? 'Failed to fetch users')
  }
  return {
    users: (data?.users ?? []).map((u) => ({
      id: u.id,
      name: u.name || '',
      email: u.email,
      role: u.role ?? 'user',
      banned: u.banned ?? false,
      banReason: u.banReason ?? null,
    })),
    total: data?.total ?? 0,
  }
}

export function useAdminUsers(offset: number, limit: number, enabled: boolean) {
  return useQuery({
    queryKey: adminUserKeys.list(offset, limit),
    queryFn: () => fetchAdminUsers(offset, limit),
    enabled,
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
