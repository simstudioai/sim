'use client'

import { Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import { KnowledgeHeader } from '@/app/workspace/[workspaceId]/knowledge/components'

interface DocumentLoadingProps {
  knowledgeBaseId: string
  knowledgeBaseName: string
  documentName: string
}

function ChunkTableRowSkeleton() {
  return (
    <tr className='border-b'>
      <td className='px-4 py-3'>
        <div className='h-3.5 w-3.5 animate-pulse rounded bg-muted' />
      </td>
      <td className='px-4 py-3'>
        <div className='h-4 w-6 animate-pulse rounded bg-muted' />
      </td>
      <td className='px-4 py-3'>
        <div className='space-y-2'>
          <div className='h-4 w-full animate-pulse rounded bg-muted' />
          <div className='h-4 w-3/4 animate-pulse rounded bg-muted' />
          <div className='h-4 w-1/2 animate-pulse rounded bg-muted' />
        </div>
      </td>
      <td className='px-4 py-3'>
        <div className='h-3 w-8 animate-pulse rounded bg-muted' />
      </td>
      <td className='px-4 py-3'>
        <div className='h-6 w-16 animate-pulse rounded-md bg-muted' />
      </td>
      <td className='px-4 py-3'>
        <div className='flex items-center gap-1'>
          <div className='h-8 w-8 animate-pulse rounded bg-muted' />
          <div className='h-8 w-8 animate-pulse rounded bg-muted' />
        </div>
      </td>
    </tr>
  )
}

function ChunkTableSkeleton({
  isSidebarCollapsed,
  rowCount = 5,
}: {
  isSidebarCollapsed: boolean
  rowCount?: number
}) {
  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='sticky top-0 z-10 border-b bg-background'>
        <table className='w-full table-fixed'>
          <colgroup>
            <col className='w-[5%]' />
            <col className='w-[8%]' />
            <col className={`${isSidebarCollapsed ? 'w-[57%]' : 'w-[55%]'}`} />
            <col className='w-[10%]' />
            <col className='w-[10%]' />
            <col className='w-[12%]' />
          </colgroup>
          <thead>
            <tr>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <div className='h-3.5 w-3.5 animate-pulse rounded bg-muted' />
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Index</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Content</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Tokens</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Status</span>
              </th>
              <th className='px-4 pt-2 pb-3 text-left font-medium'>
                <span className='text-muted-foreground text-xs leading-none'>Actions</span>
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <div className='flex-1 overflow-auto'>
        <table className='w-full table-fixed'>
          <colgroup>
            <col className='w-[5%]' />
            <col className='w-[8%]' />
            <col className={`${isSidebarCollapsed ? 'w-[57%]' : 'w-[55%]'}`} />
            <col className='w-[10%]' />
            <col className='w-[10%]' />
            <col className='w-[12%]' />
          </colgroup>
          <tbody>
            {Array.from({ length: rowCount }).map((_, i) => (
              <ChunkTableRowSkeleton key={i} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DocumentLoading({
  knowledgeBaseId,
  knowledgeBaseName,
  documentName,
}: DocumentLoadingProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const breadcrumbs = [
    {
      id: 'knowledge-root',
      label: 'Knowledge',
      href: `/workspace/${workspaceId}/knowledge`,
    },
    {
      id: `knowledge-base-${knowledgeBaseId}`,
      label: knowledgeBaseName,
      href: `/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`,
    },
    {
      id: `document-${knowledgeBaseId}-${documentName}`,
      label: documentName,
    },
  ]

  return (
    <div className='flex h-[100vh] flex-col pl-64'>
      {/* Header with Breadcrumbs */}
      <KnowledgeHeader breadcrumbs={breadcrumbs} />

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto'>
            <div className='px-6 pb-6'>
              {/* Search Section */}
              <div className='mb-4 flex items-center justify-between pt-1'>
                <div className='relative max-w-md'>
                  <div className='relative flex items-center'>
                    <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
                    <input
                      type='text'
                      placeholder='Search chunks...'
                      disabled
                      className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    />
                  </div>
                </div>

                <Button disabled variant='primary' className='flex items-center gap-1'>
                  <div className='h-3.5 w-3.5 animate-pulse rounded bg-primary-foreground/30' />
                  <span>Create Chunk</span>
                </Button>
              </div>

              {/* Table container */}
              <ChunkTableSkeleton isSidebarCollapsed={false} rowCount={8} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
