import type { CSSProperties, RefObject } from 'react'
import { Upload, X } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import styles from '@/app/(landing)/components/hero/components/hero-visual/hero-visual.module.css'
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_VIEWBOX,
  KB_FILES,
  KB_NAME,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/** Which beat of the knowledge-base flow the modal is showing. */
export type KbStage = 'empty' | 'files' | 'embeddings'

interface StageKbProps {
  stage: KbStage
  /** The Create button. The root cursor targets this to create. */
  createRef: RefObject<HTMLSpanElement | null>
}

interface KnowledgeBasePanelProps extends StageKbProps {
  motion?: 'modal' | 'morph'
}

/** Compact knowledge-base create UI used by the hero animation. */
export function KnowledgeBasePanel({
  stage,
  createRef,
  motion = 'modal',
}: KnowledgeBasePanelProps) {
  const creating = stage === 'embeddings'

  const content = (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-[var(--border-1)] bg-[var(--bg)]',
        motion === 'morph' && 'h-full'
      )}
    >
      <div className='flex items-center justify-between px-4 pt-3 pb-2.5'>
        <span className='font-medium text-[15px] text-[var(--text-primary)]'>
          Create Knowledge Base
        </span>
        <X className='size-4 text-[var(--text-muted)]' />
      </div>

      <div className='flex flex-col gap-4 px-4 pb-4'>
        <div className='flex flex-col gap-[9px]'>
          <span className='text-[13px] text-[var(--text-muted)]'>Name</span>
          <div className='flex h-[30px] items-center rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 text-[14px] text-[var(--text-body)]'>
            {KB_NAME}
          </div>
        </div>

        <div className='flex flex-col gap-[9px]'>
          <span className='text-[13px] text-[var(--text-muted)]'>
            {creating ? 'Embeddings' : 'Upload Documents'}
          </span>
          <div className='relative h-[188px]'>
            {stage === 'empty' && (
              <div className='absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--border-1)] border-dashed bg-[var(--surface-5)] text-center'>
                <Upload className='size-5 text-[var(--text-muted)]' />
                <span className='text-[var(--text-primary)] text-caption'>Drop files here</span>
                <span className='text-[var(--text-tertiary)] text-xs'>PDF, DOCX, TXT, CSV, MD</span>
              </div>
            )}

            {stage === 'files' && (
              <div className='absolute inset-0 flex flex-col justify-center gap-2'>
                {KB_FILES.map((file, i) => (
                  <div
                    key={file.name}
                    className={cn(
                      'flex items-center gap-2 rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] p-2',
                      styles.fileRow
                    )}
                    style={{ '--drop-delay': `${120 + i * 170}ms` } as CSSProperties}
                  >
                    <file.icon className='size-4 flex-shrink-0 text-[var(--text-muted)]' />
                    <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-caption'>
                      {file.name}
                    </span>
                    <span className='flex-shrink-0 text-[var(--text-muted)] text-xs'>
                      {file.size}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {creating && (
              <div className='absolute inset-0 flex flex-col items-center justify-center gap-1.5'>
                <svg
                  className='h-[150px] w-full'
                  viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
                  fill='none'
                  aria-hidden='true'
                >
                  <title>embedding graph</title>
                  {GRAPH_EDGES.map(([a, b], i) => {
                    const from = GRAPH_NODES[a]
                    const to = GRAPH_NODES[b]
                    return (
                      <path
                        key={`${a}-${b}`}
                        d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                        pathLength={1}
                        className={styles.embedLink}
                        stroke='var(--text-subtle)'
                        strokeWidth={0.5}
                        style={{ '--pop-delay': `${i * 45}ms` } as CSSProperties}
                      />
                    )
                  })}
                  {GRAPH_NODES.map((node, i) => (
                    <circle
                      key={`${node.x}-${node.y}`}
                      cx={node.x}
                      cy={node.y}
                      r={node.hub ? 3.4 : i % 3 === 0 ? 2.4 : 1.9}
                      className={node.hub ? styles.embedHub : styles.embedNode}
                      fill={
                        node.hub
                          ? 'var(--text-primary)'
                          : i % 2 === 0
                            ? 'var(--text-secondary)'
                            : 'var(--text-muted)'
                      }
                      style={{ '--pop-delay': `${300 + i * 40}ms` } as CSSProperties}
                    />
                  ))}
                </svg>
                <span className='text-[var(--text-muted)] text-caption'>
                  Generating embeddings…
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className='flex items-center justify-end gap-2 rounded-b-lg bg-[var(--surface-3)] px-4 pt-2 pb-2'>
        <span className='flex h-[30px] items-center rounded-lg px-2 text-[14px] text-[var(--text-body)]'>
          Cancel
        </span>
        <span
          ref={createRef}
          className='flex h-[30px] items-center rounded-lg bg-[var(--text-primary)] px-2 text-[14px] text-[var(--text-inverse)]'
        >
          {creating ? 'Creating…' : 'Create'}
        </span>
      </div>
    </div>
  )

  if (motion === 'morph') {
    return <div className={cn('h-full w-full', styles.kbContentMorph)}>{content}</div>
  }

  return (
    <div
      className={cn(
        'w-full max-w-[420px] rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-[var(--shadow-overlay)]',
        styles.modal
      )}
    >
      {content}
    </div>
  )
}

/** Standalone centered knowledge-base create modal. */
export function StageKb({ stage, createRef }: StageKbProps) {
  return (
    <div className='flex h-full w-full items-center justify-center px-8'>
      <KnowledgeBasePanel stage={stage} createRef={createRef} />
    </div>
  )
}
