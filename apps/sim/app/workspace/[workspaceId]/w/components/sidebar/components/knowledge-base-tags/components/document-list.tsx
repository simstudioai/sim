import { cn } from '@/lib/utils'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components/icons/document-icons'

interface Document {
  id: string
  name: string
  tagValue: string
}

interface DocumentListProps {
  documents: Document[]
  totalCount: number
  maxHeight?: 'max-h-32' | 'max-h-80'
  showMoreText?: boolean
}

export function DocumentList({
  documents,
  totalCount,
  maxHeight = 'max-h-32',
  showMoreText = true,
}: DocumentListProps) {
  const displayLimit = 5
  const hasMore = totalCount > displayLimit

  return (
    <div className='rounded-md border border-border bg-background'>
      <div className={cn(maxHeight, 'overflow-y-auto')}>
        {documents.slice(0, displayLimit).map((doc) => {
          const DocumentIcon = getDocumentIcon('', doc.name)
          return (
            <div
              key={doc.id}
              className='flex items-center gap-3 border-border/50 border-b p-3 transition-colors last:border-b-0 hover:bg-muted/30'
            >
              <DocumentIcon className='h-4 w-4 flex-shrink-0' />
              <div className='min-w-0 flex-1 overflow-hidden'>
                <div className='truncate font-medium text-sm' style={{ maxWidth: '300px' }}>
                  {doc.name}
                </div>
                {doc.tagValue && (
                  <div className='mt-1 text-muted-foreground text-xs'>
                    Tag value: <span className='font-medium'>{doc.tagValue}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {hasMore && showMoreText && (
          <div className='flex items-center gap-3 p-3 text-muted-foreground text-sm'>
            <div className='h-4 w-4' />
            <div className='font-medium'>and {totalCount - displayLimit} more documents...</div>
          </div>
        )}
      </div>
    </div>
  )
}
