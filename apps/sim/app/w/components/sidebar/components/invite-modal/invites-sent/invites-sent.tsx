'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type Invitation = {
  id: string
  email: string
  status: 'pending' | 'accepted' | 'rejected' | 'expired'
  createdAt: string
}

export function InvitesSent() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { activeWorkspaceId } = useWorkflowRegistry()

  useEffect(() => {
    async function fetchInvitations() {
      if (!activeWorkspaceId) return

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/workspaces/invitations')

        if (!response.ok) {
          throw new Error('Failed to fetch invitations')
        }

        const data = await response.json()
        setInvitations(data.invitations || [])
      } catch (err) {
        console.error('Error fetching invitations:', err)
        setError('Failed to load invitations')
      } finally {
        setIsLoading(false)
      }
    }

    fetchInvitations()
  }, [activeWorkspaceId])

  const TableSkeleton = () => (
    <div className='space-y-2'>
      {Array(5)
        .fill(0)
        .map((_, i) => (
          <div key={i} className='flex items-center justify-between'>
            <Skeleton className='h-6 w-3/4' />
            <Skeleton className='h-6 w-16' />
          </div>
        ))}
    </div>
  )

  if (error) {
    return <div className='py-2 text-red-500 text-sm'>{error}</div>
  }

  return (
    <div className='mt-4 transition-all duration-300'>
      <h3 className='font-medium text-sm'>Sent Invitations</h3>

      {isLoading ? (
        <TableSkeleton />
      ) : invitations.length === 0 ? (
        <div className='py-2 text-muted-foreground text-sm'>No invitations sent yet</div>
      ) : (
        <div className='overflow-auto' style={{ maxHeight: '250px' }}>
          <Table>
            <TableHeader>
              <TableRow className='border-x-0 border-t-0 border-b hover:bg-transparent'>
                <TableHead className='!font-sm !text-sm w-3/4 px-2 text-muted-foreground'>
                  Email
                </TableHead>
                <TableHead className='!font-sm !text-sm w-1/4 px-2 text-muted-foreground'>
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow
                  key={invitation.id}
                  className={cn('border-x-0 border-t-0 border-b', 'hover:bg-transparent')}
                >
                  <TableCell className='w-3/4 px-2 py-2'>{invitation.email}</TableCell>
                  <TableCell className='w-1/4 px-2 py-2'>
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-semibold text-xs ${
                        invitation.status === 'accepted'
                          ? 'border-green-200 bg-green-50 text-green-700'
                          : 'border-gray-200 bg-gray-100 text-slate-700'
                      }`}
                    >
                      {invitation.status.charAt(0).toUpperCase() + invitation.status.slice(1)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
