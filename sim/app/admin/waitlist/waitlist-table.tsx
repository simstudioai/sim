'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  InfoIcon,
  MailIcon,
  RotateCcwIcon,
  SearchIcon,
  UserCheckIcon,
  UserIcon,
  UserXIcon,
  XIcon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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

// Alert types for more specific error display
type AlertType = 'error' | 'email-error' | 'rate-limit' | null

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
    actionLoading,
    setStatus,
    setSearchTerm,
    setPage,
    setActionLoading,
    setError,
    fetchEntries,
  } = useWaitlistStore()

  // Local state for search input with debounce
  const [searchInputValue, setSearchInputValue] = useState(searchTerm)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Enhanced error state
  const [alertInfo, setAlertInfo] = useState<{
    type: AlertType
    message: string
    entryId?: string
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

  // Handle individual approval
  const handleApprove = async (email: string, id: string) => {
    try {
      setActionLoading(id)
      setError(null)
      setAlertInfo({ type: null, message: '' })

      const response = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ email, action: 'approve' }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Handle specific error types
        if (response.status === 429) {
          setAlertInfo({
            type: 'rate-limit',
            message: 'Rate limit exceeded. Please try again later.',
            entryId: id,
          })
          return
        } else if (data.message?.includes('email') || data.message?.includes('resend')) {
          setAlertInfo({
            type: 'email-error',
            message: `Email delivery failed: ${data.message}`,
            entryId: id,
          })
          return
        } else {
          setAlertInfo({
            type: 'error',
            message: data.message || 'Failed to approve user',
            entryId: id,
          })
          return
        }
      }

      if (!data.success) {
        if (data.message?.includes('email') || data.message?.includes('resend')) {
          setAlertInfo({
            type: 'email-error',
            message: `Email delivery failed: ${data.message}`,
            entryId: id,
          })
          return
        } else {
          setAlertInfo({
            type: 'error',
            message: data.message || 'Failed to approve user',
            entryId: id,
          })
          return
        }
      }

      // Success - don't refresh the table, just clear any errors
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to approve user'
      setAlertInfo({
        type: 'error',
        message: errorMessage,
        entryId: id,
      })
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
      setAlertInfo({ type: null, message: '' })

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
        setAlertInfo({
          type: 'error',
          message: data.message || 'Failed to reject user',
          entryId: id,
        })
        return
      }

      // Success - don't refresh the table
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reject user'
      setAlertInfo({
        type: 'error',
        message: errorMessage,
        entryId: id,
      })
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
      setAlertInfo({ type: null, message: '' })

      const response = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ email, action: 'resend' }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Handle specific error types
        if (response.status === 429) {
          setAlertInfo({
            type: 'rate-limit',
            message: 'Rate limit exceeded. Please try again later.',
            entryId: id,
          })
          return
        } else if (data.message?.includes('email') || data.message?.includes('resend')) {
          setAlertInfo({
            type: 'email-error',
            message: `Email delivery failed: ${data.message}`,
            entryId: id,
          })
          return
        } else {
          setAlertInfo({
            type: 'error',
            message: data.message || 'Failed to resend approval email',
            entryId: id,
          })
          return
        }
      }

      if (!data.success) {
        if (data.message?.includes('email') || data.message?.includes('resend')) {
          setAlertInfo({
            type: 'email-error',
            message: `Email delivery failed: ${data.message}`,
            entryId: id,
          })
          return
        } else {
          setAlertInfo({
            type: 'error',
            message: data.message || 'Failed to resend approval email',
            entryId: id,
          })
          return
        }
      }

      // No UI update needed on success, just clear error state
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to resend approval email'
      setAlertInfo({
        type: 'email-error',
        message: errorMessage,
        entryId: id,
      })
      logger.error('Error resending approval email:', error)
    } finally {
      setActionLoading(null)
    }
  }

  // Navigation
  const handleNextPage = () => setPage(page + 1)
  const handlePrevPage = () => setPage(Math.max(page - 1, 1))
  const handleFirstPage = () => setPage(1)
  const handleLastPage = () => {
    const lastPage = Math.max(1, Math.ceil(totalEntries / 50))
    setPage(lastPage)
  }
  const handleRefresh = () => {
    fetchEntries()
    setAlertInfo({ type: null, message: '' })
  }

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

      {/* Search and refresh bar */}
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
        </div>
      </div>

      {/* Enhanced Alert system */}
      {alertInfo.type && (
        <Alert
          variant={
            alertInfo.type === 'error'
              ? 'destructive'
              : alertInfo.type === 'email-error'
                ? 'destructive'
                : alertInfo.type === 'rate-limit'
                  ? 'default'
                  : 'default'
          }
          className="mx-6 w-auto"
        >
          <AlertCircleIcon className="h-4 w-4" />
          <AlertTitle className="ml-2">
            {alertInfo.type === 'email-error'
              ? 'Email Delivery Failed'
              : alertInfo.type === 'rate-limit'
                ? 'Rate Limit Exceeded'
                : 'Error'}
          </AlertTitle>
          <AlertDescription className="ml-2 flex items-center justify-between">
            <span>{alertInfo.message}</span>
            <Button
              onClick={() => setAlertInfo({ type: null, message: '' })}
              variant="outline"
              size="sm"
              className="ml-4"
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Original error alert - kept for backward compatibility */}
      {error && !alertInfo.type && (
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
                  <TableHead className="min-w-[180px]">Email</TableHead>
                  <TableHead className="min-w-[150px]">Joined</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow
                    key={entry.id}
                    className={`hover:bg-muted/30 ${
                      alertInfo.entryId === entry.id && alertInfo.type
                        ? alertInfo.type === 'error' || alertInfo.type === 'email-error'
                          ? 'bg-red-50'
                          : 'bg-amber-50'
                        : ''
                    }`}
                  >
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
            <div className="flex items-center justify-center gap-2 mx-6 my-4 pb-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFirstPage}
                  disabled={page === 1 || loading}
                  title="First Page"
                >
                  <ChevronsLeftIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={page === 1 || loading}
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                  <span className="ml-1">Prev</span>
                </Button>
              </div>

              <span className="text-sm text-muted-foreground mx-2">
                Page {page} of {Math.ceil(totalEntries / 50) || 1}
                &nbsp;•&nbsp;
                {totalEntries} total entries
              </span>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={page >= Math.ceil(totalEntries / 50) || loading}
                >
                  <span className="mr-1">Next</span>
                  <ChevronRightIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLastPage}
                  disabled={page >= Math.ceil(totalEntries / 50) || loading}
                  title="Last Page"
                >
                  <ChevronsRightIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
