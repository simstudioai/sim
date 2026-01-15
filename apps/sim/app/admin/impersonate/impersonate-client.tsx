'use client'

import { useCallback, useState } from 'react'
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/emcn'
import { client } from '@/lib/auth/auth-client'

const USERS_PER_PAGE = 10

interface User {
  id: string
  name: string
  email: string
  image: string | null
  role: string | null
  createdAt: string
}

interface Pagination {
  total: number
  limit: number
  offset: number
}

interface ImpersonateClientProps {
  currentUserId: string
}

/**
 * Extracts initials from a user's name.
 */
function getInitials(name: string | undefined | null): string {
  if (!name?.trim()) return ''
  const parts = name.trim().split(' ')
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  }
  return parts[0][0].toUpperCase()
}

/**
 * Formats a date string to a readable format.
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function ImpersonateClient({ currentUserId }: ImpersonateClientProps) {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    limit: USERS_PER_PAGE,
    offset: 0,
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)

  const totalPages = Math.ceil(pagination.total / pagination.limit)
  const hasNextPage = currentPage < totalPages
  const hasPrevPage = currentPage > 1

  const searchUsers = useCallback(
    async (page = 1) => {
      if (!searchTerm.trim()) {
        setUsers([])
        setPagination({ total: 0, limit: USERS_PER_PAGE, offset: 0 })
        return
      }

      setSearching(true)
      setError(null)

      const offset = (page - 1) * USERS_PER_PAGE

      try {
        const response = await fetch(
          `/api/admin/impersonate/search?q=${encodeURIComponent(searchTerm.trim())}&limit=${USERS_PER_PAGE}&offset=${offset}`
        )

        if (!response.ok) {
          throw new Error('Failed to search users')
        }

        const data = await response.json()
        setUsers(data.users)
        setPagination(data.pagination)
        setCurrentPage(page)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to search users')
        setUsers([])
      } finally {
        setSearching(false)
      }
    },
    [searchTerm]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      searchUsers(1)
    }
  }

  const goToPage = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) {
        searchUsers(page)
      }
    },
    [totalPages, searchUsers]
  )

  const nextPage = useCallback(() => {
    if (hasNextPage) {
      searchUsers(currentPage + 1)
    }
  }, [hasNextPage, currentPage, searchUsers])

  const prevPage = useCallback(() => {
    if (hasPrevPage) {
      searchUsers(currentPage - 1)
    }
  }, [hasPrevPage, currentPage, searchUsers])

  const handleImpersonate = async (userId: string) => {
    if (userId === currentUserId) {
      setError('You cannot impersonate yourself')
      return
    }

    setImpersonatingId(userId)
    setError(null)

    try {
      const result = await client.admin.impersonateUser({
        userId,
      })

      if (result.error) {
        throw new Error(result.error.message || 'Failed to impersonate user')
      }

      // Redirect to workspace after successful impersonation
      router.push('/workspace')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to impersonate user')
      setImpersonatingId(null)
    }
  }

  return (
    <div className='flex min-h-screen flex-col bg-[var(--bg)]'>
      {/* Header */}
      <div className='border-[var(--border)] border-b bg-[var(--bg-secondary)] px-6 py-4'>
        <div className='mx-auto flex max-w-5xl items-center gap-4'>
          <Link href='/workspace'>
            <Button variant='ghost' size='sm' className='gap-2'>
              <ArrowLeft className='h-4 w-4' />
              Back to Workspace
            </Button>
          </Link>
          <div className='h-6 w-px bg-[var(--border)]' />
          <h1 className='font-semibold text-[var(--text)] text-lg'>User Impersonation</h1>
        </div>
      </div>

      {/* Content */}
      <div className='mx-auto w-full max-w-5xl p-6'>
        {/* Search */}
        <div className='mb-6'>
          <label
            htmlFor='user-search'
            className='mb-2 block font-medium text-[var(--text-secondary)] text-sm'
          >
            Search for a user by name or email
          </label>
          <div className='flex gap-2'>
            <div className='relative flex-1'>
              <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-[var(--text-muted)]' />
              <Input
                id='user-search'
                type='text'
                placeholder='Enter name or email...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                className='pl-10'
              />
            </div>
            <Button onClick={() => searchUsers(1)} disabled={searching || !searchTerm.trim()}>
              {searching ? <Loader2 className='h-4 w-4 animate-spin' /> : 'Search'}
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className='mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4'>
            <div className='flex gap-3'>
              <AlertCircle className='h-5 w-5 flex-shrink-0 text-red-500' />
              <p className='text-red-200 text-sm'>{error}</p>
            </div>
          </div>
        )}

        {/* Results */}
        {users.length > 0 && (
          <div className='rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]'>
            <div className='border-[var(--border)] border-b px-4 py-3'>
              <p className='text-[var(--text-secondary)] text-sm'>
                Found {pagination.total} user{pagination.total !== 1 ? 's' : ''}
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className='text-right'>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className='flex items-center gap-3'>
                        <Avatar size='sm'>
                          <AvatarImage src={user.image || undefined} alt={user.name} />
                          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                        </Avatar>
                        <div className='flex items-center gap-2'>
                          <span className='font-medium text-[var(--text)]'>{user.name}</span>
                          {user.id === currentUserId && <Badge variant='blue'>You</Badge>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className='text-[var(--text-secondary)]'>{user.email}</TableCell>
                    <TableCell>
                      {user.role ? (
                        <Badge variant='gray'>{user.role}</Badge>
                      ) : (
                        <span className='text-[var(--text-muted)]'>-</span>
                      )}
                    </TableCell>
                    <TableCell className='text-[var(--text-secondary)]'>
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => handleImpersonate(user.id)}
                        disabled={impersonatingId === user.id || user.id === currentUserId}
                      >
                        {impersonatingId === user.id ? (
                          <>
                            <Loader2 className='mr-2 h-3 w-3 animate-spin' />
                            Impersonating...
                          </>
                        ) : (
                          'Impersonate'
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className='flex items-center justify-center border-[var(--border)] border-t px-4 py-3'>
                <div className='flex items-center gap-1'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={prevPage}
                    disabled={!hasPrevPage || searching}
                  >
                    <ChevronLeft className='h-3.5 w-3.5' />
                  </Button>

                  <div className='mx-3 flex items-center gap-4'>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let page: number
                      if (totalPages <= 5) {
                        page = i + 1
                      } else if (currentPage <= 3) {
                        page = i + 1
                      } else if (currentPage >= totalPages - 2) {
                        page = totalPages - 4 + i
                      } else {
                        page = currentPage - 2 + i
                      }

                      if (page < 1 || page > totalPages) return null

                      return (
                        <button
                          key={page}
                          onClick={() => goToPage(page)}
                          disabled={searching}
                          className={`font-medium text-sm transition-colors hover:text-[var(--text)] disabled:opacity-50 ${
                            page === currentPage ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    })}
                  </div>

                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={nextPage}
                    disabled={!hasNextPage || searching}
                  >
                    <ChevronRight className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {searchTerm && !searching && users.length === 0 && !error && (
          <div className='rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-8 text-center'>
            <p className='text-[var(--text-secondary)]'>No users found matching your search</p>
          </div>
        )}
      </div>
    </div>
  )
}
