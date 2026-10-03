'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge, Chip, ChipModal, ChipModalBody, ChipModalHeader, cn } from '@sim/emcn'
import { ChevronRight, Database } from '@sim/emcn/icons'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { usePreviewDialogFocus } from '@/app/(landing)/hooks/use-preview-dialog-focus'
import { KnowledgeDocumentDetail } from '@/app/(landing)/knowledge/components/knowledge-sources-preview/components/knowledge-document-detail'
import { KnowledgeDocumentList } from '@/app/(landing)/knowledge/components/knowledge-sources-preview/components/knowledge-document-list'
import {
  KNOWLEDGE_PREVIEW_SOURCES,
  type KnowledgePreviewDocument,
} from '@/app/(landing)/knowledge/components/knowledge-sources-preview/data'
import { ResourceOptions } from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'

const DOCUMENTS: readonly KnowledgePreviewDocument[] = KNOWLEDGE_PREVIEW_SOURCES.flatMap(
  (source): readonly KnowledgePreviewDocument[] => source.documents
)

/** Documents and their chunk table are native Knowledge views, shown together as an open product scene. */
export function KnowledgeSourcesPreview() {
  const firstSourceRef = useRef<HTMLButtonElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const selectedDocumentRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef(false)
  const [query, setQuery] = useState('')
  const [selectedDocumentId, setSelectedDocumentId] = useState(DOCUMENTS[0].id)
  const [detailOpen, setDetailOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const sourcesOpenerRef = usePreviewDialogFocus(sourcesOpen, firstSourceRef)
  const selectedDocument = DOCUMENTS.find((item) => item.id === selectedDocumentId) ?? DOCUMENTS[0]
  const documents = DOCUMENTS.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    if (detailOpen && backButtonRef.current?.offsetParent) {
      backButtonRef.current.focus()
    } else if (returnFocusRef.current) {
      selectedDocumentRef.current?.focus()
      returnFocusRef.current = false
    }
  }, [detailOpen])

  return (
    <div
      role='group'
      aria-label='Explore knowledge sources'
      className='@container absolute inset-0 text-[var(--text-body)] text-small'
    >
      <div className='absolute @max-[600px]:inset-x-3 @max-[600px]:top-8 top-[10%] @max-[600px]:bottom-5 bottom-[12%] left-[8%] flex min-h-0 @max-[600px]:w-auto w-[80%] flex-col @max-[600px]:overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-xs'>
        <MenuPreviewHeader
          icon={Database}
          title={
            <>
              <span>Knowledge Base</span>
              <ChevronRight className='size-3 text-[var(--text-secondary)]' />
              <span>Product knowledge</span>
            </>
          }
        />
        <div
          className={cn(
            'min-h-0 flex-1 flex-col',
            detailOpen ? '@min-[600px]:flex hidden' : 'flex'
          )}
        >
          <ResourceOptions
            search={{ value: query, onChange: setQuery, placeholder: 'Search documents...' }}
            aside={
              <span className='flex items-center gap-1'>
                {KNOWLEDGE_PREVIEW_SOURCES.map((source, index) => (
                  <span key={source.id} className={index > 0 ? '@max-[850px]:hidden' : undefined}>
                    <Chip
                      ref={index === 0 ? firstSourceRef : undefined}
                      leftIcon={source.icon}
                      onClick={(event) => {
                        sourcesOpenerRef.current = event.currentTarget
                        setSourcesOpen(true)
                      }}
                      aria-haspopup='dialog'
                      aria-label={`View connected sources including ${source.name}`}
                    >
                      {source.label}
                    </Chip>
                  </span>
                ))}
              </span>
            }
          />
          <KnowledgeDocumentList
            documents={documents}
            selectedDocumentId={selectedDocument.id}
            selectedDocumentRef={selectedDocumentRef}
            onSelectDocument={(documentId) => {
              setSelectedDocumentId(documentId)
              setDetailOpen(true)
            }}
          />
        </div>
        <div
          className={cn(
            '@min-[600px]:absolute @min-[600px]:top-[39%] @min-[600px]:right-[-10%] @min-[600px]:bottom-[-8%] min-h-0 @min-[600px]:w-[54%] min-w-0 flex-1 flex-col @min-[600px]:overflow-hidden @min-[600px]:rounded-lg @min-[600px]:border @min-[600px]:border-[var(--border)] @min-[600px]:bg-[var(--bg)] @min-[600px]:shadow-xs',
            detailOpen ? 'flex' : '@min-[600px]:flex hidden'
          )}
        >
          <KnowledgeDocumentDetail
            key={selectedDocument.id}
            document={selectedDocument}
            backButtonRef={backButtonRef}
            onBack={() => {
              returnFocusRef.current = true
              setDetailOpen(false)
            }}
          />
        </div>
      </div>
      <ChipModal open={sourcesOpen} onOpenChange={setSourcesOpen} srTitle='Connected Sources'>
        <ChipModalHeader onClose={() => setSourcesOpen(false)}>Connected Sources</ChipModalHeader>
        <ChipModalBody>
          {KNOWLEDGE_PREVIEW_SOURCES.map((source) => {
            const Icon = source.icon
            return (
              <div key={source.id} className='flex items-center gap-2.5 rounded-lg px-2 py-2'>
                <div className='flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)]'>
                  <Icon className='size-5' />
                </div>
                <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <div className='flex items-center gap-2 text-[var(--text-primary)] text-small'>
                    {source.name}
                    <Badge variant='gray-secondary' size='sm' dot>
                      Active
                    </Badge>
                  </div>
                  <p className='text-[var(--text-secondary)] text-xs'>
                    Last sync: Sep 4, 9:41 AM · {source.documents.length} docs
                  </p>
                </div>
              </div>
            )
          })}
        </ChipModalBody>
      </ChipModal>
    </div>
  )
}
