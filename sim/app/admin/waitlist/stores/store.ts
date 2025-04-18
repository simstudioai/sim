import { create } from 'zustand'

// Define types inline since types.ts was deleted
export type WaitlistStatus = 'pending' | 'approved' | 'rejected' | 'signed_up'

export interface WaitlistEntry {
  id: string
  email: string
  status: WaitlistStatus
  createdAt: Date
  updatedAt: Date
}

interface WaitlistState {
  // Core data
  entries: WaitlistEntry[]
  filteredEntries: WaitlistEntry[]
  loading: boolean
  error: string | null

  // Filters
  status: string
  searchTerm: string

  // Pagination
  page: number
  totalEntries: number

  // Loading states
  actionLoading: string | null

  // Actions
  setStatus: (status: string) => void
  setSearchTerm: (searchTerm: string) => void
  setPage: (page: number) => void
  fetchEntries: () => Promise<void>
  setEntries: (entries: WaitlistEntry[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setActionLoading: (id: string | null) => void
}

export const useWaitlistStore = create<WaitlistState>((set, get) => ({
  // Core data
  entries: [],
  filteredEntries: [],
  loading: true,
  error: null,

  // Filters
  status: 'all',
  searchTerm: '',

  // Pagination
  page: 1,
  totalEntries: 0,

  // Loading states
  actionLoading: null,

  // Filter actions
  setStatus: (status) => {
    console.log('Store: Setting status to', status)
    set({
      status,
      page: 1,
      searchTerm: '',
      loading: true,
    })
    get().fetchEntries()
  },

  setSearchTerm: (searchTerm) => {
    set({ searchTerm, page: 1, loading: true })
    get().fetchEntries()
  },

  setPage: (page) => {
    set({ page, loading: true })
    get().fetchEntries()
  },

  // Data actions
  setEntries: (entries) => {
    set({
      entries,
      filteredEntries: entries,
      loading: false,
      error: null,
    })
  },

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setActionLoading: (id) => set({ actionLoading: id }),

  // Fetch data
  fetchEntries: async () => {
    const { status, page, searchTerm } = get()

    try {
      set({ loading: true, error: null })

      // Prevent caching with timestamp
      const timestamp = Date.now()
      const searchParam = searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ''
      const url = `/api/admin/waitlist?page=${page}&limit=50&status=${status}&t=${timestamp}${searchParam}`

      // Get the auth token
      const token = sessionStorage.getItem('admin-auth-token') || ''

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, must-revalidate',
        },
        cache: 'no-store',
      })

      if (!response.ok) {
        let errorMessage = `Error ${response.status}: ${response.statusText}`
        
        // Try to parse the error message from the response body
        try {
          const errorData = await response.json()
          if (errorData.message) {
            errorMessage = errorData.message
          }
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError)
        }
        
        throw new Error(errorMessage)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Failed to load waitlist entries')
      }

      // Process entries
      const entries = data.data.entries.map((entry: any) => ({
        ...entry,
        createdAt: new Date(entry.createdAt),
        updatedAt: new Date(entry.updatedAt),
      }))

      // Update state
      set({
        entries,
        filteredEntries: entries,
        totalEntries: data.data.total,
        loading: false,
        error: null,
      })
    } catch (error) {
      console.error('Error fetching waitlist entries:', error)
      set({
        error: error instanceof Error ? error.message : 'An unknown error occurred',
        loading: false,
      })
    }
  },
}))
