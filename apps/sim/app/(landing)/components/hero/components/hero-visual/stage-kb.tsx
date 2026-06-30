import type { CSSProperties, RefObject } from 'react'
import { Upload, X } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_VIEWBOX,
  KB_FILES,
  KB_NAME,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/** Which beat of the knowledge-base flow the modal is showing. */
export type KbStage = 'empty' | 'files' | 'embeddings'

interface KnowledgeBasePanelProps {
  stage: KbStage
  /** The Create button - the root cursor targets this to "create". */
  createRef: RefObject<HTMLSpanElement | null>
  /**
   * `modal` renders the standalone centered modal (its own chrome + entrance);
   * `morph` renders the content only, filling its host, so a satellite block can
   * morph into it in scene space.
   */
  motion?: 'modal' | 'morph'
}

/**
 * The knowledge-base create UI - a faithful, decorative replica of the real
 * `ChipModal` create flow. First an empty dropzone ("Drop files here"); then
 * files drop in from above as if dragged from Finder; then the document area
 * becomes an embedding map that builds itself node by node while the footer
 * reads "Creating…". The Create button is exposed as a cursor target.
 */
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
                      'flex items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] p-2',
                      'animate-hero-file-drop opacity-0 [animation-delay:var(--drop-delay)] motion-reduce:animate-none motion-reduce:opacity-100'
                    )}
                    style={{ '--drop-delay': `${120 + i * 170}ms` } as CSSProperties}
                  >
                    <file.icon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                    <span className='min-w-0 flex-1 truncate text-[14px] text-[var(--text-body)]'>
                      {file.name}
                    </span>
                    <span className='flex-shrink-0 text-[14px] text-[var(--text-muted)]'>
                      {file.size}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {creating && (
              <div className='absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-3'>
                <svg
                  className='h-[140px] w-full'
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
                        className='animate-hero-edge-draw [animation-delay:var(--pop-delay)] [stroke-dasharray:1] [stroke-dashoffset:1] motion-reduce:animate-none motion-reduce:[stroke-dashoffset:0]'
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
                      className={cn(
                        'opacity-0 [transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none motion-reduce:opacity-100',
                        node.hub
                          ? 'animate-[hero-node-pop_440ms_cubic-bezier(0.16,1,0.3,1)_var(--pop-delay)_forwards,hero-graph-pulse_2600ms_ease-in-out_calc(var(--pop-delay)+800ms)_infinite]'
                          : 'animate-hero-node-pop [animation-delay:var(--pop-delay)]'
                      )}
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
    return (
      <div className='h-full w-full animate-hero-kb-content-morph opacity-0 motion-reduce:animate-none motion-reduce:opacity-100'>
        {content}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'w-full max-w-[420px] rounded-xl border border-[var(--border-muted)] bg-[var(--surface-4)] p-[3px] shadow-[var(--shadow-overlay)]',
        'animate-hero-modal-in motion-reduce:animate-none'
      )}
    >
      {content}
    </div>
  )
}
