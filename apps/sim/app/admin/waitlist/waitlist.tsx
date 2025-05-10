'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircleIcon, InfoIcon, RotateCcwIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Logger } from '@/lib/logs/console-logger'
import { BatchActions } from './components/batch-actions/batch-actions'
import { BatchResultsModal } from './components/batch-results-modal/batch-results-modal'
import { FilterBar } from './components/filter-bar/filter-bar'
import { Pagination } from './components/pagination/pagination'
import { SearchBar } from './components/search-bar/search-bar'
import { WaitlistAlert } from './components/waitlist-alert/waitlist-alert'
import { WaitlistTable as WaitlistDataTable } from './components/waitlist-table/waitlist-table'
import { useWaitlistStore } from './stores/store'

const logger = new Logger('WaitlistTable')

type AlertType = 'error' | 'email-error' | 'rate-limit' | null

export function WaitlistTable() {
  const router = useRouter()
  const searchParams = useSearchParams()

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

  // State for selected emails (for batch operations)
  const [selectedEmails, setSelectedEmails] = useState<Record<string, boolean>>({})
  const [showBatchDialog, setShowBatchDialog] = useState(false)
  const [batchActionLoading, setBatchActionLoading] = useState(false)
  const [batchResults, setBatchResults] = useState<Array<{
    email: string
    success: boolean
    message: string
  }> | null>(null)

  // Helper to check if any emails are selected
  const hasSelectedEmails = Object.values(selectedEmails).some(Boolean)

  // Count of selected emails
  const selectedEmailsCount = Object.values(selectedEmails).filter(Boolean).length

  // Toggle selection of a single email
  const toggleEmailSelection = (email: string) => {
    setSelectedEmails((prev) => ({
      ...prev,
      [email]: !prev[email],
    }))
  }

  // Clear all selections
  const clearSelections = () => {
    setSelectedEmails({})
  }

  // Select/deselect all visible emails
  const toggleSelectAll = () => {
    if (filteredEntries.some((entry) => selectedEmails[entry.email])) {
      // If any are selected, deselect all
      const newSelection = { ...selectedEmails }
      filteredEntries.forEach((entry) => {
        newSelection[entry.email] = false
      })
      setSelectedEmails(newSelection)
    } else {
      // Select all visible entries
      const newSelection = { ...selectedEmails }
      filteredEntries.forEach((entry) => {
        newSelection[entry.email] = true
      })
      setSelectedEmails(newSelection)
    }
  }

  // Handle batch approval
  const handleBatchApprove = async () => {
    try {
      setBatchActionLoading(true)
      setBatchResults(null)
      setAlertInfo({ type: null, message: '' })

      // Get list of selected emails
      const emails = Object.entries(selectedEmails)
        .filter(([_, isSelected]) => isSelected)
        .map(([email]) => email)

      if (emails.length === 0) {
        setAlertInfo({
          type: 'error',
          message: 'No emails selected for batch approval',
        })
        return
      }

      const response = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ emails, action: 'batchApprove' }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Handle specific error types
        if (response.status === 429) {
          setAlertInfo({
            type: 'rate-limit',
            message: 'Rate limit exceeded. Please try again later with fewer emails.',
          })
          setBatchResults(data.results || null)
          return
        } else if (data.message?.includes('email') || data.message?.includes('resend')) {
          setAlertInfo({
            type: 'email-error',
            message: `Email delivery failed: ${data.message}`,
          })
          setBatchResults(data.results || null)
          return
        } else {
          setAlertInfo({
            type: 'error',
            message: data.message || 'Failed to approve users',
          })
          setBatchResults(data.results || null)
          return
        }
      }

      if (!data.success) {
        setAlertInfo({
          type: 'error',
          message: data.message || 'Failed to approve some or all users',
        })
        setBatchResults(data.results || null)
        return
      }

      // Success
      setShowBatchDialog(true)
      setBatchResults(data.results || [])

      // Clear selections for successfully approved emails
      if (data.results && Array.isArray(data.results)) {
        const successfulEmails = data.results
          .filter((result: { success: boolean }) => result.success)
          .map((result: { email: string }) => result.email)

        if (successfulEmails.length > 0) {
          const newSelection = { ...selectedEmails }
          successfulEmails.forEach((email: string) => {
            newSelection[email] = false
          })
          setSelectedEmails(newSelection)

          // Refresh the entries to show updated statuses
          fetchEntries()
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to approve users'
      setAlertInfo({
        type: 'error',
        message: errorMessage,
      })
      logger.error('Error batch approving users:', error)
    } finally {
      setBatchActionLoading(false)
    }
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
    <div className="space-y-3 w-full p-4">
      {/* Top bar with filters, search and refresh */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-2">
        {/* Filter buttons in a single row */}
        <FilterBar currentStatus={status} onStatusChange={handleStatusChange} />

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

      {/* Enhanced Alert system */}
      <WaitlistAlert
        type={alertInfo.type}
        message={alertInfo.message}
        onDismiss={() => setAlertInfo({ type: null, message: '' })}
        onRefresh={alertInfo.type === 'error' ? handleRefresh : undefined}
      />

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

      {/* Select All row - only shown when not in approved view and entries exist */}
      {status !== 'approved' && filteredEntries.length > 0 && !loading && (
        <BatchActions
          hasSelectedEmails={hasSelectedEmails}
          selectedCount={selectedEmailsCount}
          loading={batchActionLoading}
          onToggleSelectAll={toggleSelectAll}
          onClearSelections={clearSelections}
          onBatchApprove={handleBatchApprove}
          entriesExist={filteredEntries.length > 0}
          someSelected={filteredEntries.some((entry) => selectedEmails[entry.email])}
        />
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
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
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
          <WaitlistDataTable
            entries={filteredEntries}
            status={status}
            actionLoading={actionLoading}
            selectedEmails={selectedEmails}
            onToggleSelection={toggleEmailSelection}
            onApprove={handleApprove}
            onReject={handleReject}
            onResendApproval={handleResendApproval}
            formatDate={formatDate}
            getDetailedTimeTooltip={getDetailedTimeTooltip}
          />

          {/* Pagination */}
          {!searchTerm && (
            <Pagination
              page={page}
              totalItems={totalEntries}
              itemsPerPage={50}
              loading={loading}
              onFirstPage={handleFirstPage}
              onPrevPage={handlePrevPage}
              onNextPage={handleNextPage}
              onLastPage={handleLastPage}
            />
          )}
        </>
      )}

      {/* Batch results dialog */}
      <BatchResultsModal
        open={showBatchDialog}
        onOpenChange={setShowBatchDialog}
        results={batchResults}
        onClose={() => {
          setShowBatchDialog(false)
          setBatchResults(null)
        }}
      />
    </div>
  )
}
