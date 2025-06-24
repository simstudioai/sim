'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('InvitesSent')

type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired'

type Invitation = {
  id: string
  email: string
  status: InvitationStatus
  createdAt: string
}

const getInvitationStatusStyles = (status: InvitationStatus) => {
  switch (status) {
    case 'accepted':
      return 'inline-flex items-center rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400'
    case 'pending':
      return 'inline-flex items-center rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    case 'rejected':
      return 'inline-flex items-center rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300'
    case 'expired':
      return 'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    default:
      return 'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
}

const formatInvitationStatus = (status: InvitationStatus): string => {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function InvitesSent() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const params = useParams()
  const workspaceId = params.workspaceId as string

  useEffect(() => {
    async function fetchInvitations() {
      if (!workspaceId) {
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/workspaces/invitations')

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          throw new Error(errorData.error || `Failed to fetch invitations (${response.status})`)
        }

        const data = await response.json()
        const filteredInvitations = (data.invitations || []).filter(
          (inv: Invitation) => inv.status === 'pending'
        )
        setInvitations(filteredInvitations)
      } catch (err) {
        logger.error('Error fetching invitations:', err)
        const errorMessage = err instanceof Error ? err.message : 'Failed to load invitations'
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    fetchInvitations()
  }, [workspaceId])

  const TableSkeleton = () => (
    <div className='space-y-2'>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className='flex items-center justify-between'>
          <Skeleton className='h-6 w-3/4' />
          <Skeleton className='h-6 w-16' />
        </div>
      ))}
    </div>
  )

  if (error) {
    return (
      <div className='mt-4'>
        <h3 className='mb-2 font-medium text-sm'>Sent Invitations</h3>
        <div className='rounded-md border border-red-200 bg-red-50 p-3'>
          <p className='text-red-800 text-sm'>{error}</p>
        </div>
      </div>
    )
  }

  if (!workspaceId) {
    return null
  }

  return (
    <div className='mt-4 transition-all duration-300'>
      <h3 className='mb-3 font-medium text-sm'>Sent Invitations</h3>

      {isLoading ? (
        <TableSkeleton />
      ) : invitations.length === 0 ? (
        <div className='rounded-md border bg-muted/30 p-4 text-center'>
          <p className='text-muted-foreground text-sm'>No pending invitations</p>
        </div>
      ) : (
        <div className='overflow-hidden rounded-md border'>
          <div className='max-h-[250px] overflow-auto'>
            <Table>
              <TableHeader>
                <TableRow className='border-x-0 border-t-0 hover:bg-transparent'>
                  <TableHead className='px-3 py-2 font-medium text-muted-foreground text-xs'>
                    Email
                  </TableHead>
                  <TableHead className='px-3 py-2 font-medium text-muted-foreground text-xs'>
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow
                    key={invitation.id}
                    className='border-x-0 border-t-0 hover:bg-accent/50'
                  >
                    <TableCell className='px-3 py-2'>
                      <span
                        className='block max-w-[200px] truncate font-medium text-sm'
                        title={invitation.email}
                      >
                        {invitation.email}
                      </span>
                    </TableCell>
                    <TableCell className='px-3 py-2'>
                      <span className={getInvitationStatusStyles(invitation.status)}>
                        {formatInvitationStatus(invitation.status)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
