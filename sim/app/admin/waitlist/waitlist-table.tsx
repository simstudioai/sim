'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircleIcon,
  CheckIcon,
  CheckSquareIcon,
  InfoIcon,
  MailIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
  UserCheckIcon,
  UserIcon,
  UserXIcon,
  XIcon,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Logger } from '@/lib/logs/console-logger'
import { useWaitlistStore } from './stores/store'

const logger = new Logger('WaitlistTable')

interface FilterButtonProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  className?: string
}

// Filter button component
const FilterButton = ({ active, onClick, icon, label, className }: FilterButtonProps) => (
  <Button
    variant={active ? 'default' : 'ghost'}
    size="sm"
    onClick={onClick}
    className={`flex items-center gap-2 ${className || ''}`}
  >
    {icon}
    <span>{label}</span>
  </Button>
)

export function WaitlistTable() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Get all values from the store
  const {
    entries,
    filteredEntries,
    status,
    searchTerm,
    page,
    totalEntries,
    loading,
    error,
    selectedIds,
    actionLoading,
    bulkActionLoading,
    setStatus,
    setSearchTerm,
    setPage,
    toggleSelectEntry,
    selectAll,
    deselectAll,
    setActionLoading,
    setBulkActionLoading,
    setError,
    fetchEntries,
  } = useWaitlistStore()

  // Local state for search input with debounce
  const [searchInputValue, setSearchInputValue] = useState(searchTerm)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auth token for API calls
  const [apiToken, setApiToken] = useState('')
  const [authChecked, setAuthChecked] = useState(false)

  // Check authentication and redirect if needed
  useEffect(() => {
    // Check if user is authenticated
    const token = sessionStorage.getItem('admin-auth-token') || ''
    const isAuth = sessionStorage.getItem('admin-auth') === 'true'

    setApiToken(token)

    // If not authenticated, redirect to admin home page to show the login form
    if (!isAuth || !token) {
      logger.warn('Not authenticated, redirecting to admin page')
      router.push('/admin')
      return
    }

    setAuthChecked(true)
  }, [router])

  // Get status from URL on initial load - only if authenticated
  useEffect(() => {
    if (!authChecked) return

    const urlStatus = searchParams.get('status') || 'all'
    // Make sure it's a valid status
    const validStatus = ['all', 'pending', 'approved', 'rejected'].includes(urlStatus)
      ? urlStatus
      : 'all'

    setStatus(validStatus)
  }, [searchParams, setStatus, authChecked])

  // Handle status filter change
  const handleStatusChange = useCallback(
    (newStatus: string) => {
      if (newStatus !== status) {
        setStatus(newStatus)
        router.push(`?status=${newStatus}`)
      }
    },
    [status, setStatus, router]
  )

  // Handle search input change with debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchInputValue(value)

    // Clear any existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Set a new timeout for debounce
    searchTimeoutRef.current = setTimeout(() => {
      setSearchTerm(value)
    }, 500) // 500ms debounce
  }

  // Toggle selection of all entries
  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredEntries.length) {
      deselectAll()
    } else {
      selectAll()
    }
  }

  // Handle individual approval
  const handleApprove = async (email: string, id: string) => {
    try {
      setActionLoading(id)
      setError(null)

      const response = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ email, action: 'approve' }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to approve user')
      }

      // Refresh the data
      fetchEntries()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to approve user')
      logger.error('Error approving user:', error)
    } finally {
      setActionLoading(null)
    }
  }

  // Handle individual rejection
  const handleReject = async (email: string, id: string) => {
    try {
      setActionLoading(id)
      setError(null)

      const response = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ email, action: 'reject' }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to reject user')
      }

      // Refresh the data
      fetchEntries()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to reject user')
      logger.error('Error rejecting user:', error)
    } finally {
      setActionLoading(null)
    }
  }

  // Handle resending approval email
  const handleResendApproval = async (email: string, id: string) => {
    try {
      setActionLoading(id)
      setError(null)

      const response = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ email, action: 'resend' }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to resend approval email')
      }

      // Refresh the data
      fetchEntries()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to resend approval email')
      logger.error('Error resending approval email:', error)
    } finally {
      setActionLoading(null)
    }
  }

  // Handle bulk approval
  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return

    setBulkActionLoading(true)
    setError(null)

    try {
      const selectedEmails = filteredEntries
        .filter((entry) => selectedIds.has(entry.id))
        .map((entry) => entry.email)

      const response = await fetch('/api/admin/waitlist/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          emails: selectedEmails,
          action: 'approve',
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to approve selected users')
      }

      // Refresh data
      fetchEntries()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to approve selected users')
      logger.error('Error approving users:', error)
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Handle bulk rejection
  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return

    setBulkActionLoading(true)
    setError(null)

    try {
      const selectedEmails = filteredEntries
        .filter((entry) => selectedIds.has(entry.id))
        .map((entry) => entry.email)

      const response = await fetch('/api/admin/waitlist/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          emails: selectedEmails,
          action: 'reject',
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to reject selected users')
      }

      // Refresh data
      fetchEntries()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to reject selected users')
      logger.error('Error rejecting users:', error)
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Handle bulk resend approval
  const handleBulkResend = async () => {
    if (selectedIds.size === 0) return

    setBulkActionLoading(true)
    setError(null)

    try {
      const selectedEmails = filteredEntries
        .filter((entry) => selectedIds.has(entry.id) && entry.status === 'approved')
        .map((entry) => entry.email)

      if (selectedEmails.length === 0) {
        setError('No approved users selected')
        setBulkActionLoading(false)
        return
      }

      const response = await fetch('/api/admin/waitlist/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          emails: selectedEmails,
          action: 'resend',
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to resend approval emails')
      }

      // Refresh data
      fetchEntries()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to resend approval emails')
      logger.error('Error resending approval emails:', error)
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Navigation
  const handleNextPage = () => setPage(page + 1)
  const handlePrevPage = () => setPage(Math.max(page - 1, 1))
  const handleRefresh = () => fetchEntries()

  // Format date helper
  const formatDate = (date: Date) => {
    const now = new Date()
    const diffInMs = now.getTime() - date.getTime()
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))

    if (diffInDays < 1) return 'today'
    if (diffInDays === 1) return 'yesterday'
    if (diffInDays < 30) return `${diffInDays} days ago`

    return date.toLocaleDateString()
  }

  // Get formatted timestamp for tooltips
  const getDetailedTimeTooltip = (date: Date) => {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // If not authenticated yet, show loading state
  if (!authChecked) {
    return (
      <div className="flex justify-center items-center py-20">
        <Skeleton className="h-16 w-16 rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full">
      {/* Filter bar - similar to logs.tsx */}
      <div className="border-b px-6">
        <div className="flex flex-wrap items-center gap-2 py-3">
          <div className="flex justify-between items-center">
            {/* Filter buttons */}
            <div className="flex items-center gap-2 overflow-x-auto">
              <FilterButton
                active={status === 'all'}
                onClick={() => handleStatusChange('all')}
                icon={<UserIcon className="h-4 w-4" />}
                label="All"
                className={
                  status === 'all'
                    ? 'bg-blue-100 text-blue-900 hover:bg-blue-200 hover:text-blue-900'
                    : ''
                }
              />
              <FilterButton
                active={status === 'pending'}
                onClick={() => handleStatusChange('pending')}
                icon={<UserIcon className="h-4 w-4" />}
                label="Pending"
                className={
                  status === 'pending'
                    ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 hover:text-amber-900'
                    : ''
                }
              />
              <FilterButton
                active={status === 'approved'}
                onClick={() => handleStatusChange('approved')}
                icon={<UserCheckIcon className="h-4 w-4" />}
                label="Approved"
                className={
                  status === 'approved'
                    ? 'bg-green-100 text-green-900 hover:bg-green-200 hover:text-green-900'
                    : ''
                }
              />
              <FilterButton
                active={status === 'rejected'}
                onClick={() => handleStatusChange('rejected')}
                icon={<UserXIcon className="h-4 w-4" />}
                label="Rejected"
                className={
                  status === 'rejected'
                    ? 'bg-red-100 text-red-900 hover:bg-red-200 hover:text-red-900'
                    : ''
                }
              />
              <FilterButton
                active={status === 'signed_up'}
                onClick={() => handleStatusChange('signed_up')}
                icon={<CheckIcon className="h-4 w-4" />}
                label="Signed Up"
                className={
                  status === 'signed_up'
                    ? 'bg-purple-100 text-purple-900 hover:bg-purple-200 hover:text-purple-900'
                    : ''
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Search and bulk actions bar */}
      <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-4 md:items-center px-6">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by email..."
            value={searchInputValue}
            onChange={handleSearchChange}
            className="w-full pl-10"
            disabled={loading}
          />
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={loading}
            className="h-9 w-9"
          >
            <RotateCcwIcon className={`h-4 w-4 ${loading ? 'animate-spin text-blue-500' : ''}`} />
          </Button>

          {selectedIds.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground whitespace-nowrap ml-2">
                {selectedIds.size} selected
              </span>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleBulkApprove}
                      disabled={bulkActionLoading || status === 'approved' || loading}
                      size="sm"
                      className="bg-green-500 hover:bg-green-600 text-white"
                    >
                      {bulkActionLoading ? (
                        <RotateCcwIcon className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <CheckIcon className="h-4 w-4 mr-1" />
                      )}
                      Approve All
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Approve all selected users and send them access emails
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {status === 'approved' && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleBulkResend}
                        disabled={bulkActionLoading || loading}
                        size="sm"
                        className="bg-blue-500 hover:bg-blue-600 text-white"
                      >
                        {bulkActionLoading ? (
                          <RotateCcwIcon className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <MailIcon className="h-4 w-4 mr-1" />
                        )}
                        Resend All
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Resend approval emails to all selected users</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleBulkReject}
                      disabled={bulkActionLoading || status === 'rejected' || loading}
                      size="sm"
                      variant="destructive"
                    >
                      {bulkActionLoading ? (
                        <RotateCcwIcon className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <XIcon className="h-4 w-4 mr-1" />
                      )}
                      Reject All
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reject all selected users</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <Alert variant="destructive" className="mx-6 w-auto">
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
        <div className="space-y-4 px-6">
          <div className="space-y-2 w-full">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-md border mx-6 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <InfoIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">No entries found</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {searchTerm
              ? 'No matching entries found with the current search term'
              : `No ${status === 'all' ? '' : status} entries found in the waitlist.`}
          </p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="rounded-md border mx-6 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <div className="flex items-center">
                      <button onClick={handleToggleSelectAll} className="focus:outline-none">
                        {selectedIds.size === filteredEntries.length ? (
                          <CheckSquareIcon className="h-4 w-4 text-primary" />
                        ) : (
                          <SquareIcon className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  </TableHead>
                  <TableHead className="min-w-[180px]">Email</TableHead>
                  <TableHead className="min-w-[150px]">Joined</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-muted/30">
                    <TableCell>
                      <button
                        onClick={() => toggleSelectEntry(entry.id)}
                        className="focus:outline-none"
                      >
                        {selectedIds.has(entry.id) ? (
                          <CheckSquareIcon className="h-4 w-4 text-primary" />
                        ) : (
                          <SquareIcon className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium">{entry.email}</TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">{formatDate(entry.createdAt)}</span>
                          </TooltipTrigger>
                          <TooltipContent>{getDetailedTimeTooltip(entry.createdAt)}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      {/* Status badge */}
                      <div className="py-2.5 px-4">
                        {entry.status === 'pending' && (
                          <Badge
                            variant="outline"
                            className="bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200"
                          >
                            <InfoIcon className="mr-1 h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                        {entry.status === 'approved' && (
                          <Badge
                            variant="outline"
                            className="bg-green-100 text-green-800 border border-green-200 hover:bg-green-200"
                          >
                            <UserCheckIcon className="mr-1 h-3 w-3" />
                            Approved
                          </Badge>
                        )}
                        {entry.status === 'rejected' && (
                          <Badge
                            variant="outline"
                            className="bg-red-100 text-red-800 border border-red-200 hover:bg-red-200"
                          >
                            <UserXIcon className="mr-1 h-3 w-3" />
                            Rejected
                          </Badge>
                        )}
                        {entry.status === 'signed_up' && (
                          <Badge
                            variant="outline"
                            className="bg-purple-100 text-purple-800 border border-purple-200 hover:bg-purple-200"
                          >
                            <CheckIcon className="mr-1 h-3 w-3" />
                            Signed Up
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {entry.status !== 'approved' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => handleApprove(entry.email, entry.id)}
                                  disabled={actionLoading === entry.id}
                                  className="hover:border-green-500 hover:text-green-600"
                                >
                                  {actionLoading === entry.id ? (
                                    <RotateCcwIcon className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <CheckIcon className="h-4 w-4 text-green-500" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Approve user and send access email</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}

                        {entry.status === 'approved' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleResendApproval(entry.email, entry.id)}
                                  disabled={actionLoading === entry.id}
                                  className="hover:border-blue-500 hover:text-blue-600"
                                >
                                  {actionLoading === entry.id ? (
                                    <RotateCcwIcon className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <>
                                      <MailIcon className="h-4 w-4 mr-1" />
                                      Resend Approval
                                    </>
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Resend approval email with sign-up link
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}

                        {entry.status !== 'rejected' && entry.status !== 'approved' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => handleReject(entry.email, entry.id)}
                                  disabled={actionLoading === entry.id}
                                  className="hover:border-red-500 hover:text-red-600"
                                >
                                  {actionLoading === entry.id ? (
                                    <RotateCcwIcon className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <XIcon className="h-4 w-4 text-red-500" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reject user</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}

                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="outline"
                                onClick={() =>
                                  window.open(
                                    `https://mail.google.com/mail/?view=cm&fs=1&to=${entry.email}`
                                  )
                                }
                                className="hover:border-blue-500 hover:text-blue-600"
                              >
                                <MailIcon className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Email user in Gmail</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {!searchTerm && (
            <div className="flex items-center justify-between mx-6 my-4 pb-2">
              <Button variant="outline" size="sm" onClick={handlePrevPage} disabled={page === 1}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {Math.ceil(totalEntries / 50) || 1}
                &nbsp;•&nbsp;
                {totalEntries} total entries
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={page >= Math.ceil(totalEntries / 50)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
