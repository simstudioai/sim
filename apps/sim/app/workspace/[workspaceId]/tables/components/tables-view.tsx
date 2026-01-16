'use client'

import { useState } from 'react'
import { Database, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Tooltip } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useTablesList } from '@/hooks/queries/use-tables'
import { useDebounce } from '@/hooks/use-debounce'
import { CreateModal } from './create-modal'
import { EmptyState } from './empty-state'
import { ErrorState } from './error-state'
import { LoadingState } from './loading-state'
import { TableCard } from './table-card'

export function TablesView() {
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
                <LoadingState />
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

      <CreateModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </>
  )
}
