import { Chip, cn, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@sim/emcn'
import { ArrowUpRight } from '@sim/emcn/icons'
import type { Evidence, RunBlock } from '@/app/playground/org/lib/types'

const MONO = 'font-mono text-caption'

/** One piece of investigation evidence: a run trace, a slice of the run log, or a block diff. */
export function EvidenceView({ evidence }: { evidence: Evidence }) {
  switch (evidence.type) {
    case 'run':
      return (
        <EvidenceFrame
          title={`Run ${evidence.runId}`}
          subtitle={evidence.summary}
          action='Open in Logs'
        >
          <RunTrace blocks={evidence.blocks} />
        </EvidenceFrame>
      )
    case 'runs':
      return (
        <EvidenceFrame title={evidence.title} subtitle='' action='Open in Logs'>
          <Table>
            <TableHeader>
              <TableRow>
                {evidence.columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.rows.map((row, index) => (
                <TableRow
                  key={index}
                  className={cn(
                    evidence.flagged.includes(index) && 'bg-[var(--badge-error-bg)]/40'
                  )}
                >
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className='text-caption'>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </EvidenceFrame>
      )
    case 'diff':
      return (
        <EvidenceFrame title={evidence.title} subtitle={evidence.subtitle} action='Open workflow'>
          <DiffLines lines={evidence.lines} />
        </EvidenceFrame>
      )
  }
}

export function DiffLines({ lines }: { lines: { kind: 'add' | 'del' | 'ctx'; text: string }[] }) {
  return (
    <div className='overflow-x-auto py-1'>
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            MONO,
            'whitespace-pre px-3 py-0.5',
            line.kind === 'add' && 'bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]',
            line.kind === 'del' && 'bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]',
            line.kind === 'ctx' && 'text-[var(--text-body)]'
          )}
        >
          {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
          {line.text}
        </div>
      ))}
    </div>
  )
}

interface EvidenceFrameProps {
  title: string
  subtitle: string
  action?: string
  children: React.ReactNode
}

function EvidenceFrame({ title, subtitle, action, children }: EvidenceFrameProps) {
  return (
    <div className='overflow-hidden rounded-lg border border-[var(--border)]'>
      <div className='flex items-center gap-2 border-[var(--border)] border-b bg-[var(--surface-2)] px-3 py-1.5'>
        <span className='shrink-0 text-[var(--text-body)] text-caption'>{title}</span>
        <span className='min-w-0 flex-1 truncate text-[var(--text-muted)] text-caption'>
          {subtitle}
        </span>
        {action && (
          <Chip rightIcon={ArrowUpRight} className='h-[22px] shrink-0'>
            {action}
          </Chip>
        )}
      </div>
      {children}
    </div>
  )
}

/** Block-by-block run trace, the same shape as the Logs trace view. */
function RunTrace({ blocks }: { blocks: RunBlock[] }) {
  const total = Math.max(...blocks.map((block) => block.start + block.duration))
  return (
    <div className='flex flex-col py-1'>
      {blocks.map((block) => (
        <div
          key={block.id}
          className={cn(
            'grid grid-cols-[minmax(0,200px)_80px_minmax(0,1fr)_64px] items-center gap-x-3 px-3 py-1.5 text-caption',
            block.highlight && 'bg-[var(--surface-active)]'
          )}
        >
          <span
            className='truncate text-[var(--text-body)]'
            style={{ paddingLeft: block.depth * 14 }}
          >
            {block.name}
          </span>
          <span className='truncate text-[var(--text-muted)]'>{block.type}</span>
          <div className='relative h-[8px] rounded-sm bg-[var(--surface-3)]'>
            <div
              className={cn(
                'absolute inset-y-0 rounded-sm',
                block.highlight ? 'bg-[var(--caution)]' : 'bg-[var(--text-icon)]'
              )}
              style={{
                left: `${(block.start / total) * 100}%`,
                width: `max(2px, ${(block.duration / total) * 100}%)`,
              }}
            />
          </div>
          <span className='text-right text-[var(--text-muted)] tabular-nums'>
            {block.duration.toLocaleString()} ms
          </span>
          {block.output && (
            <span
              className={cn(
                MONO,
                'col-span-4 truncate text-[var(--text-muted)]',
                block.highlight && 'text-[var(--text-body)]'
              )}
              style={{ paddingLeft: block.depth * 14 }}
            >
              {block.output}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
