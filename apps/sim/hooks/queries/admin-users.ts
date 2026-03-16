import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  role: string | null
  banned: boolean | null
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
    throw new Error((error as { message?: string }).message || 'Failed to fetch users')
  }
  return {
    users: ((data as { users?: unknown[] })?.users ?? []).map((u: unknown) => {
      const user = u as Record<string, unknown>
      return {
        id: user.id as string,
        name: (user.name as string) || '',
        email: (user.email as string) || '',
        role: (user.role as string) ?? 'user',
        banned: (user.banned as boolean) ?? false,
        banReason: (user.banReason as string) ?? null,
      }
    }),
    total: (data as { total?: number })?.total ?? 0,
  }
}

export function useAdminUsers(offset: number, limit: number, enabled: boolean) {
  return useQuery({
    queryKey: adminUserKeys.list(offset, limit),
    queryFn: () => fetchAdminUsers(offset, limit),
    enabled,
    staleTime: 30 * 1000,
  })
}

export function useSetUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
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
