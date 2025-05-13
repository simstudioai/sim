'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircleIcon, InfoIcon, RotateCcwIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createLogger } from '@/lib/logs/console-logger'
import { FilterBar } from '../components/filter-bar/filter-bar'
import { Pagination } from '../components/pagination/pagination'
import { SearchBar } from '../components/search-bar/search-bar'
import { UserDataTable } from './components/user-data-table/user-data-table'
import { SortField, useUserStatsStore } from './stores/user-stats-store'

const logger = createLogger('UserStatsTable')

type AlertType = 'error' | null

export function UserStatsTable() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const {
    users,
    filteredUsers,
    filter,
    searchTerm,
    loading,
    error,
    sortField,
    sortDirection,
    pagination,
    setFilter,
    setSearchTerm,
    setPage,
    setSorting,
    setError,
    fetchUsers,
  } = useUserStatsStore()

  // Error alert state
  const [alertInfo, setAlertInfo] = useState<{
    type: AlertType
    message: string
  }>({ type: null, message: '' })

  // Auto-dismiss alert after 7 seconds
  useEffect(() => {
    if (alertInfo.type) {
      const timer = setTimeout(() => {
        setAlertInfo({ type: null, message: '' })
      }, 7000)
      return () => clearTimeout(timer)
    }
  }, [alertInfo])

  // Auth token for API calls
  const [apiToken, setApiToken] = useState('')

  // Set up auth token for API calls
  useEffect(() => {
    // Get admin token from session storage
    const token = sessionStorage.getItem('admin-auth-token') || ''
    setApiToken(token)

    // Get filter from URL on initial load
    const urlFilter = searchParams.get('filter') || 'all'
    // Make sure it's a valid filter
    const validFilter = ['all', 'active', 'inactive', 'paid'].includes(urlFilter)
      ? urlFilter
      : 'all'

    setFilter(validFilter)

    // Initial data fetch
    fetchUsers()
  }, [searchParams, setFilter, fetchUsers])

  // Handle filter change
  const handleFilterChange = useCallback(
    (newFilter: string) => {
      if (newFilter !== filter) {
        setFilter(newFilter)
        router.push(`?filter=${newFilter}`)
      }
    },
    [filter, setFilter, router]
  )

  // Handle sorting
  const handleSort = useCallback(
    (field: SortField) => {
      setSorting(field)
    },
    [setSorting]
  )

  // Navigation
  const handleNextPage = () => setPage(pagination.page + 1)
  const handlePrevPage = () => setPage(Math.max(pagination.page - 1, 1))
  const handleFirstPage = () => setPage(1)
  const handleLastPage = () => {
    const lastPage = Math.max(1, Math.ceil(pagination.total / 50))
    setPage(lastPage)
  }
  const handleRefresh = () => {
    fetchUsers()
    setAlertInfo({ type: null, message: '' })
  }

  // Format numbers helper
  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num)
  }

  // Format currency helper
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  // If not authenticated yet, show loading state
  if (!apiToken) {
    return (
      <div className="flex justify-center items-center py-20">
        <Skeleton className="h-16 w-16 rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-3 w-full p-4">
      {/* Top bar with filters, search and refresh */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-2">
        {/* Filter buttons in a single row */}
        <FilterBar
          currentFilter={filter}
          onFilterChange={handleFilterChange}
          filters={[
            { id: 'all', label: 'All Users' },
            { id: 'active', label: 'Active' },
            { id: 'inactive', label: 'Inactive' },
            { id: 'paid', label: 'Paid' },
          ]}
        />

        {/* Search and refresh aligned to the right */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <SearchBar initialValue={searchTerm} onSearch={setSearchTerm} disabled={loading} />
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={loading}
            className="flex-shrink-0 h-9 w-9 p-0"
          >
            <RotateCcwIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Error alert */}
      {alertInfo.type && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertDescription className="ml-2">{alertInfo.message}</AlertDescription>
        </Alert>
      )}

      {/* Original error alert - kept for backward compatibility */}
      {error && !alertInfo.type && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertDescription className="ml-2">
            {error}
            <Button onClick={handleRefresh} variant="outline" size="sm" className="ml-4">
              Try Again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="space-y-4">
          <div className="space-y-2 w-full">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <InfoIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">No users found</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {searchTerm
              ? 'No matching users found with the current search term'
              : `No ${filter === 'all' ? '' : filter} users found.`}
          </p>
        </div>
      ) : (
        <>
          {/* Table */}
          <UserDataTable
            users={filteredUsers}
            formatNumber={formatNumber}
            formatCurrency={formatCurrency}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
          />

          {/* Pagination - centered container */}
          {!searchTerm && (
            <div className="flex justify-center mt-4">
              <Pagination
                page={pagination.page}
                totalItems={pagination.total}
                itemsPerPage={50}
                loading={loading}
                onFirstPage={handleFirstPage}
                onPrevPage={handlePrevPage}
                onNextPage={handleNextPage}
                onLastPage={handleLastPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
