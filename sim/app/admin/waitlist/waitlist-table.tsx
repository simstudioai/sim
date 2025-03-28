'use client'

import { useEffect, useState } from 'react'
import { CheckIcon, MailIcon, RotateCcwIcon, SearchIcon, XIcon } from 'lucide-react'
import { WaitlistEntry, WaitlistStatus } from '@/lib/waitlist/service'

interface WaitlistTableProps {
  status: WaitlistStatus
}

export function ClientWaitlistTable({ status }: WaitlistTableProps) {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [filteredEntries, setFilteredEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalEntries, setTotalEntries] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const pageSize = 10

  // Fetch entries on mount and when status or page changes
  useEffect(() => {
    fetchEntries()
  }, [status, page])

  // Filter entries when search term changes
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredEntries(entries)
    } else {
      const term = searchTerm.toLowerCase()
      setFilteredEntries(entries.filter((entry) => entry.email.toLowerCase().includes(term)))
    }
  }, [searchTerm, entries])

  const fetchEntries = async () => {
    try {
      setLoading(true)
      setError(null)

      // Make API call to the server endpoint
      const response = await fetch(
        `/api/admin/waitlist?page=${page}&limit=${pageSize}&status=${status}`
      )

      if (!response.ok) {
        throw new Error('Failed to fetch waitlist entries')
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Unknown error')
      }

      const newEntries = data.data.entries.map((entry: any) => ({
        ...entry,
        status: entry.status as WaitlistStatus,
        createdAt: new Date(entry.createdAt),
        updatedAt: new Date(entry.updatedAt),
      }))

      setEntries(newEntries)
      setFilteredEntries(newEntries)
      setTotalEntries(data.data.total)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load waitlist entries')
      console.error('Error fetching waitlist entries:', error)
    } finally {
      setLoading(false)
    }
  }

  // Handle approving a user
  const handleApprove = async (email: string, id: string) => {
    try {
      setActionLoading(id)
      setError(null)

      const response = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action: 'approve' }),
      })

      if (!response.ok) {
        throw new Error('Failed to approve user')
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Failed to approve user')
      }

      // If we're viewing pending entries, remove this entry from the list
      if (status === 'pending') {
        const updatedEntries = entries.filter((entry) => entry.id !== id)
        setEntries(updatedEntries)
        setFilteredEntries(
          searchTerm.trim() === ''
            ? updatedEntries
            : updatedEntries.filter((entry) =>
                entry.email.toLowerCase().includes(searchTerm.toLowerCase())
              )
        )
      } else {
        // Otherwise refresh the list
        fetchEntries()
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to approve user')
      console.error('Error approving user:', error)
    } finally {
      setActionLoading(null)
    }
  }

  // Handle rejecting a user
  const handleReject = async (email: string, id: string) => {
    try {
      setActionLoading(id)
      setError(null)

      const response = await fetch('/api/admin/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action: 'reject' }),
      })

      if (!response.ok) {
        throw new Error('Failed to reject user')
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Failed to reject user')
      }

      // If we're viewing pending entries, remove this entry from the list
      if (status === 'pending') {
        const updatedEntries = entries.filter((entry) => entry.id !== id)
        setEntries(updatedEntries)
        setFilteredEntries(
          searchTerm.trim() === ''
            ? updatedEntries
            : updatedEntries.filter((entry) =>
                entry.email.toLowerCase().includes(searchTerm.toLowerCase())
              )
        )
      } else {
        // Otherwise refresh the list
        fetchEntries()
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to reject user')
      console.error('Error rejecting user:', error)
    } finally {
      setActionLoading(null)
    }
  }

  // Handle pagination
  const nextPage = () => {
    setPage((prev) => prev + 1)
  }

  const prevPage = () => {
    setPage((prev) => Math.max(prev - 1, 1))
  }

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
  }

  // Helper function to format date
  const formatDate = (date: Date) => {
    const now = new Date()
    const diffInMs = now.getTime() - date.getTime()
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))

    if (diffInDays < 1) return 'today'
    if (diffInDays === 1) return 'yesterday'
    if (diffInDays < 30) return `${diffInDays} days ago`

    return date.toLocaleDateString()
  }

  if (loading) {
    return <div className="flex justify-center py-8">Loading waitlist entries...</div>
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        <p>{error}</p>
        <button
          onClick={fetchEntries}
          className="mt-4 px-4 py-2 bg-muted hover:bg-muted/80 rounded-md text-sm"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Search bar */}
      <div className="mb-4 relative">
        <div className="relative">
          <input
            type="text"
            placeholder="Search by email..."
            value={searchTerm}
            onChange={handleSearchChange}
            className="w-full px-4 py-2 pl-10 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {searchTerm ? 'No matching entries found' : `No ${status} entries found in the waitlist.`}
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <table className="min-w-full divide-y divide-border">
              <thead>
                <tr>
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-foreground">
                    Email
                  </th>
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-foreground">
                    Joined
                  </th>
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3.5 text-right text-sm font-semibold text-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-4 text-sm font-medium">{entry.email}</td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">
                      {formatDate(new Date(entry.createdAt))}
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${
                          entry.status === 'approved'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                            : entry.status === 'rejected'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-right">
                      <div className="flex items-center justify-end space-x-2">
                        {entry.status !== 'approved' && (
                          <button
                            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                            onClick={() => handleApprove(entry.email, entry.id)}
                            disabled={actionLoading === entry.id}
                          >
                            {actionLoading === entry.id ? (
                              <RotateCcwIcon className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckIcon className="h-4 w-4 text-green-500" />
                            )}
                          </button>
                        )}

                        {entry.status !== 'rejected' && (
                          <button
                            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                            onClick={() => handleReject(entry.email, entry.id)}
                            disabled={actionLoading === entry.id}
                          >
                            {actionLoading === entry.id ? (
                              <RotateCcwIcon className="h-4 w-4 animate-spin" />
                            ) : (
                              <XIcon className="h-4 w-4 text-red-500" />
                            )}
                          </button>
                        )}

                        <button
                          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                          onClick={() => window.open(`mailto:${entry.email}`)}
                        >
                          <MailIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!searchTerm && (
            <div className="flex items-center justify-between mt-4">
              <button
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
                onClick={prevPage}
                disabled={page === 1}
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {Math.ceil(totalEntries / pageSize) || 1}
              </span>
              <button
                className="px-4 py-2 text-sm border rounded-md hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
                onClick={nextPage}
                disabled={page >= Math.ceil(totalEntries / pageSize)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
