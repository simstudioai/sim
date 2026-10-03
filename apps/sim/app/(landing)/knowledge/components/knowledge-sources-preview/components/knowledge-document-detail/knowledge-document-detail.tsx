'use client'

import { type RefObject, useEffect, useRef, useState } from 'react'
import { Badge, Chip, Switch } from '@sim/emcn'
import { ArrowLeft, ChevronDown, ChevronUp, FileText } from '@sim/emcn/icons'
import type { KnowledgePreviewDocument } from '@/app/(landing)/knowledge/components/knowledge-sources-preview/data'
import { ResourceOptions } from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'

interface KnowledgeDocumentDetailProps {
  document: KnowledgePreviewDocument
  backButtonRef?: RefObject<HTMLButtonElement | null>
  onBack?: () => void
}

/** Production document navigation: chunk table, then a plain, read-only chunk editor. */
export function KnowledgeDocumentDetail({
  document,
  backButtonRef,
  onBack,
}: KnowledgeDocumentDetailProps) {
  const chunkBackButtonRef = useRef<HTMLButtonElement>(null)
  const chunkButtonsRef = useRef<Map<number, HTMLButtonElement> | null>(null)
  const chunkButtons = (chunkButtonsRef.current ??= new Map())
  const openedChunkIndexRef = useRef<number | null>(null)
  const [query, setQuery] = useState('')
  const [chunkIndex, setChunkIndex] = useState<number | null>(null)
  const chunkOpen = chunkIndex !== null
  const chunk = chunkIndex === null ? null : document.chunks[chunkIndex]
  const tokensPerChunk = Math.round(document.tokens / document.chunks.length)

  useEffect(() => {
    if (chunkOpen) chunkBackButtonRef.current?.focus({ preventScroll: true })
    else if (openedChunkIndexRef.current !== null) {
      chunkButtons.get(openedChunkIndexRef.current)?.focus({ preventScroll: true })
    }
  }, [chunkOpen])

  return (
    <>
      <div className='flex h-11 shrink-0 items-center gap-2 border-[var(--border)] border-b px-4 text-[var(--text-primary)] text-base'>
        {chunk ? (
          <Chip
            ref={chunkBackButtonRef}
            leftIcon={ArrowLeft}
            aria-label='Back to chunks'
            onClick={() => setChunkIndex(null)}
          />
        ) : onBack ? (
          <Chip
            ref={backButtonRef}
            leftIcon={ArrowLeft}
            aria-label='Back to documents'
            onClick={onBack}
          />
        ) : (
          <FileText aria-hidden='true' className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        )}
        <span className='min-w-0 flex-1 truncate'>
          {chunk ? `Chunk #${chunkIndex}` : document.title}
        </span>
        {chunk && chunkIndex !== null && (
          <>
            <Chip
              leftIcon={ChevronUp}
              aria-label='Previous chunk'
              disabled={chunkIndex === 0}
              onClick={() => setChunkIndex(chunkIndex - 1)}
            />
            <Chip
              leftIcon={ChevronDown}
              aria-label='Next chunk'
              disabled={chunkIndex === document.chunks.length - 1}
              onClick={() => setChunkIndex(chunkIndex + 1)}
            />
          </>
        )}
      </div>
      {chunk ? (
        <>
          <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap px-6 py-6 text-[var(--text-body)] text-sm leading-relaxed'>
            {chunk.title}
            {'\n\n'}
            {chunk.content}
          </div>
          <div className='flex shrink-0 items-center justify-between border-[var(--border)] border-t px-4 py-2.5 text-[var(--text-secondary)] text-caption'>
            <span className='flex items-center gap-2'>
              Tokenizer{' '}
              <Switch checked={false} disabled aria-label='Tokenizer disabled in preview' />
            </span>
            <span>{tokensPerChunk} tokens</span>
          </div>
        </>
      ) : (
        <>
          <ResourceOptions
            search={{ value: query, onChange: setQuery, placeholder: 'Search chunks...' }}
          />
          <div className='min-h-0 flex-1 overflow-auto overscroll-contain'>
            <table className='w-full min-w-[380px] table-fixed border-collapse text-left text-[13px]'>
              <colgroup>
                <col className='w-[220px]' />
                <col className='w-[50px]' />
                <col className='w-[60px]' />
                <col className='w-[80px]' />
              </colgroup>
              <thead>
                <tr className='h-9 border-[var(--border)] border-b text-[var(--text-secondary)]'>
                  <th scope='col' className='pl-4 font-normal'>
                    Content
                  </th>
                  <th scope='col' className='font-normal'>
                    Index
                  </th>
                  <th scope='col' className='font-normal'>
                    Tokens
                  </th>
                  <th scope='col' className='font-normal'>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {document.chunks.map((item, index) => {
                  if (!`${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase()))
                    return null
                  return (
                    <tr
                      key={item.title}
                      className='h-11 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
                    >
                      <td className='pl-4'>
                        <button
                          ref={(node) => {
                            if (node) chunkButtons.set(index, node)
                            else chunkButtons.delete(index)
                          }}
                          type='button'
                          onClick={() => {
                            openedChunkIndexRef.current = index
                            setChunkIndex(index)
                          }}
                          className='block h-11 w-full truncate pr-4 text-left text-[var(--text-body)] underline-offset-4 focus-visible:underline focus-visible:outline-none'
                        >
                          <span className='sr-only'>Open chunk {index}: </span>
                          {item.content}
                        </button>
                      </td>
                      <td className='font-mono'>{index}</td>
                      <td className='tabular-nums'>{tokensPerChunk}</td>
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
          </div>
        </>
      )}
    </>
  )
}
