import type { RefObject } from 'react'
import { Badge, cn } from '@sim/emcn'
import { FileText } from '@sim/emcn/icons'
import type { KnowledgePreviewDocument } from '@/app/(landing)/knowledge/components/knowledge-sources-preview/data'

interface KnowledgeDocumentListProps {
  documents: readonly KnowledgePreviewDocument[]
  selectedDocumentId: string
  selectedDocumentRef: RefObject<HTMLButtonElement | null>
  onSelectDocument: (documentId: string) => void
}

/** The document columns and enabled status mirror the Knowledge Base resource table. */
export function KnowledgeDocumentList({
  documents,
  selectedDocumentId,
  selectedDocumentRef,
  onSelectDocument,
}: KnowledgeDocumentListProps) {
  return (
    <div className='min-h-0 flex-1 overflow-auto overscroll-contain'>
      <table className='w-full min-w-[620px] table-fixed border-collapse whitespace-nowrap text-left text-[13px]'>
        <caption className='sr-only'>Select a knowledge document</caption>
        <colgroup>
          <col className='w-[230px]' />
          <col className='w-[72px]' />
          <col className='w-[70px]' />
          <col className='w-[70px]' />
          <col className='w-[88px]' />
          <col className='w-[90px]' />
        </colgroup>
        <thead>
          <tr className='h-9 border-[var(--border)] border-b text-[var(--text-secondary)]'>
            <th scope='col' className='pl-4 font-normal'>
              Name
            </th>
            <th scope='col' className='font-normal'>
              Size
            </th>
            <th scope='col' className='font-normal'>
              Tokens
            </th>
            <th scope='col' className='font-normal'>
              Chunks
            </th>
            <th scope='col' className='font-normal'>
              Uploaded
            </th>
            <th scope='col' className='font-normal'>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const selected = document.id === selectedDocumentId
            return (
              <tr
                key={document.id}
                className={cn(
                  'h-11 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]',
                  selected && 'bg-[var(--surface-active)]'
                )}
              >
                <td className='pl-4'>
                  <button
                    ref={selected ? selectedDocumentRef : undefined}
                    type='button'
                    aria-label={`Open ${document.title}`}
                    aria-pressed={selected}
                    onClick={() => onSelectDocument(document.id)}
                    className='flex h-11 w-full items-center gap-2.5 pr-3 text-left text-[var(--text-body)] underline-offset-4 focus-visible:underline focus-visible:outline-none'
                  >
                    <FileText
                      aria-hidden='true'
                      className='size-[14px] shrink-0 text-[var(--text-icon)]'
                    />
                    <span className='truncate'>{document.title}</span>
                  </button>
                </td>
                <td className='tabular-nums'>{document.size}</td>
                <td className='tabular-nums'>{document.tokens}</td>
                <td className='tabular-nums'>{document.chunks.length}</td>
                <td>{document.updated}</td>
                <td>
                  <Badge variant='gray-secondary' size='sm'>
                    Enabled
                  </Badge>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {documents.length === 0 && (
        <p className='p-4 text-[var(--text-secondary)]'>No matching documents</p>
      )}
    </div>
  )
}
