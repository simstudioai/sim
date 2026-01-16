'use client'

import { useState } from 'react'
import { Database, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Tooltip } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useTablesList } from '@/hooks/queries/use-tables'
import { useDebounce } from '@/hooks/use-debounce'
import { CreateTableModal } from './components/create-table-modal'
import { TableCard } from './components/table-card'

export function Tables() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const userPermissions = useUserPermissionsContext()

  const { data: tables = [], isLoading, error } = useTablesList(workspaceId)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // Filter tables by search query
  const filteredTables = tables.filter((table) => {
    if (!debouncedSearchQuery) return true

    const query = debouncedSearchQuery.toLowerCase()
    return (
      table.name.toLowerCase().includes(query) || table.description?.toLowerCase().includes(query)
    )
  })

  return (
    <>
      <div className='flex h-full flex-1 flex-col'>
        <div className='flex flex-1 overflow-hidden'>
          <div className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[28px] pb-[24px] dark:bg-[var(--bg)]'>
            {/* Header */}
            <div>
              <div className='flex items-start gap-[12px]'>
                <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#3B82F6] bg-[#EFF6FF] dark:border-[#1E40AF] dark:bg-[#1E3A5F]'>
                  <Database className='h-[14px] w-[14px] text-[#3B82F6] dark:text-[#60A5FA]' />
                </div>
                <h1 className='font-medium text-[18px]'>Tables</h1>
              </div>
              <p className='mt-[10px] text-[14px] text-[var(--text-tertiary)]'>
                Create and manage data tables for your workflows.
              </p>
            </div>

            {/* Search and Actions */}
            <div className='mt-[14px] flex items-center justify-between'>
              <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-4)] px-[8px]'>
                <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
                <Input
                  placeholder='Search'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
                />
              </div>
              <div className='flex items-center gap-[8px]'>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      onClick={() => setIsCreateModalOpen(true)}
                      disabled={userPermissions.canEdit !== true}
                      variant='tertiary'
                      className='h-[32px] rounded-[6px]'
                    >
                      <Plus className='mr-[6px] h-[14px] w-[14px]' />
                      Create Table
                    </Button>
                  </Tooltip.Trigger>
                  {userPermissions.canEdit !== true && (
                    <Tooltip.Content>Write permission required to create tables</Tooltip.Content>
                  )}
                </Tooltip.Root>
              </div>
            </div>

            {/* Content */}
            <div className='mt-[24px] grid grid-cols-1 gap-[20px] md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {isLoading ? (
                <LoadingSkeletons />
              ) : error ? (
                <ErrorState error={error} />
              ) : filteredTables.length === 0 ? (
                <EmptyState hasSearchQuery={!!searchQuery} />
              ) : (
                filteredTables.map((table) => (
                  <TableCard key={table.id} table={table} workspaceId={workspaceId} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <CreateTableModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </>
  )
}

function LoadingSkeletons() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className='flex h-full flex-col gap-[12px] rounded-[4px] bg-[var(--surface-3)] px-[8px] py-[6px] dark:bg-[var(--surface-4)]'
        >
          <div className='flex items-center justify-between gap-[8px]'>
            <div className='h-[17px] w-[120px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
            <div className='h-[22px] w-[90px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
          </div>
          <div className='flex flex-1 flex-col gap-[8px]'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-[12px]'>
                <div className='h-[15px] w-[50px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
                <div className='h-[15px] w-[50px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
              </div>
              <div className='h-[15px] w-[60px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
            </div>
            <div className='h-0 w-full border-[var(--divider)] border-t' />
            <div className='flex h-[36px] flex-col gap-[6px]'>
              <div className='h-[15px] w-full animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
              <div className='h-[15px] w-[75%] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

function ErrorState({ error }: { error: unknown }) {
  return (
    <div className='col-span-full flex h-64 items-center justify-center rounded-[4px] bg-[var(--surface-3)] dark:bg-[var(--surface-4)]'>
      <div className='text-center'>
        <p className='font-medium text-[var(--text-secondary)] text-sm'>Error loading tables</p>
        <p className='mt-1 text-[var(--text-muted)] text-xs'>
          {error instanceof Error ? error.message : 'An error occurred'}
        </p>
      </div>
    </div>
  )
}

function EmptyState({ hasSearchQuery }: { hasSearchQuery: boolean }) {
  return (
    <div className='col-span-full flex h-64 items-center justify-center rounded-[4px] bg-[var(--surface-3)] dark:bg-[var(--surface-4)]'>
      <div className='text-center'>
        <p className='font-medium text-[var(--text-secondary)] text-sm'>
          {hasSearchQuery ? 'No tables found' : 'No tables yet'}
        </p>
        <p className='mt-1 text-[var(--text-muted)] text-xs'>
          {hasSearchQuery
            ? 'Try adjusting your search query'
            : 'Create your first table to store structured data for your workflows'}
        </p>
      </div>
    </div>
  )
}
