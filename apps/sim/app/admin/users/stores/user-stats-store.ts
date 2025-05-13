'use client'

import { create } from 'zustand'

export type SortDirection = 'asc' | 'desc'
export type SortField =
  | 'name'
  | 'email'
  | 'totalTokensUsed'
  | 'totalCost'
  | 'totalExecutions'
  | 'lastActive'
  | 'subscriptionPlan'
  | null

export interface UserStatsEntry {
  id: string
  name: string
  email: string
  totalTokensUsed: number
  totalCost: number
  totalManualExecutions: number
  totalApiCalls: number
  totalWebhookTriggers: number
  totalScheduledExecutions: number
  totalChatExecutions: number
  lastActive: Date
  subscriptionPlan: string | null
  subscriptionStatus: string | null
}

interface PaginationInfo {
  total: number
  page: number
  limit: number
  totalPages: number
}

interface UserStatsState {
  // Core data
  users: UserStatsEntry[]
  filteredUsers: UserStatsEntry[]
  loading: boolean
  error: string | null
  pagination: PaginationInfo

  // Filters
  filter: string
  searchTerm: string

  // Sorting
  sortField: SortField
  sortDirection: SortDirection

  // Actions
  setFilter: (filter: string) => void
  setSearchTerm: (searchTerm: string) => void
  setPage: (page: number) => void
  setSorting: (field: SortField, direction?: SortDirection) => void
  fetchUsers: () => Promise<void>
  setError: (error: string | null) => void
}

export const useUserStatsStore = create<UserStatsState>((set, get) => ({
  // Core data
  users: [],
  filteredUsers: [],
  loading: true,
  error: null,
  pagination: {
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 0,
  },

  // Filters
  filter: 'all',
  searchTerm: '',

  // Sorting
  sortField: 'lastActive',
  sortDirection: 'desc',

  // Error handling
  setError: (error) => set({ error }),

  // Filter actions
  setFilter: (filter) => {
    set({ filter, pagination: { ...get().pagination, page: 1 }, loading: true })
    get().fetchUsers()
  },

  setSearchTerm: (searchTerm) => {
    set({ searchTerm, pagination: { ...get().pagination, page: 1 }, loading: true })
    get().fetchUsers()
  },

  setPage: (page) => {
    set({ pagination: { ...get().pagination, page }, loading: true })
    get().fetchUsers()
  },

  // Sorting action
  setSorting: (field, direction) => {
    const currentSortField = get().sortField
    const currentSortDirection = get().sortDirection

    // If same field, toggle direction
    if (field === currentSortField && !direction) {
      direction = currentSortDirection === 'asc' ? 'desc' : 'asc'
    } else if (!direction) {
      // Default to descending for new fields
      direction = 'desc'
    }

    set({
      sortField: field,
      sortDirection: direction,
      loading: true,
    })
    get().fetchUsers()
  },

  // Fetch data
  fetchUsers: async () => {
    const { filter, pagination, searchTerm, sortField, sortDirection } = get()

    try {
      set({ loading: true, error: null })

      // Get the auth token
      const token = sessionStorage.getItem('admin-auth-token') || ''

      if (!token) {
        set({
          loading: false,
          error: 'Authentication token missing',
          users: [],
          filteredUsers: [],
        })
        return
      }

      // Build URL with query parameters for RESTful approach
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        filter,
        search: searchTerm,
      })

      // Add sort parameters if present
      if (sortField) {
        params.append('sortField', sortField)
        params.append('sortDirection', sortDirection)
      }

      // Single RESTful API call that handles filtering, sorting, and pagination
      const response = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, must-revalidate',
        },
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Failed to load users')
      }

      // Ensure we have valid arrays
      const users = Array.isArray(data.data.users)
        ? data.data.users.map((user: any) => ({
            ...user,
            lastActive: new Date(user.lastActive),
          }))
        : []

      // Update state with server-processed data
      set({
        users,
        filteredUsers: users,
        pagination: data.data.pagination || {
          total: 0,
          page: 1,
          limit: 50,
          totalPages: 0,
        },
        loading: false,
        error: null,
      })
    } catch (error) {
      console.error('Error fetching user statistics:', error)
      set({
        error: error instanceof Error ? error.message : 'An unknown error occurred',
        loading: false,
        users: [],
        filteredUsers: [],
      })
    }
  },
}))
