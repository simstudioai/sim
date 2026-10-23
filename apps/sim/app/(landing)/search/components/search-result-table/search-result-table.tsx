import { cn } from '@sim/emcn'
import { FileText, Search } from '@sim/emcn/icons'

export interface SearchResultFile {
  name: string
  size: string
  owner: string
}

interface SearchResultTableProps {
  query: string
  files: readonly SearchResultFile[]
  elapsed: number
  reducedMotion: boolean
}

/** A search result draws its frame, then reveals the platform file columns and matching rows. */
export function SearchResultTable({
  query,
  files,
  elapsed,
  reducedMotion,
}: SearchResultTableProps) {
  const visible = (at: number) => reducedMotion || elapsed >= at

  return (
    <div
      data-search-result-table
      className='relative h-[208px] w-full shrink-0 overflow-hidden rounded-lg bg-[var(--bg)] text-[13px] text-[var(--text-body)]'
    >
      <svg
        aria-hidden='true'
        viewBox='0 0 660 208'
        preserveAspectRatio='none'
        className='pointer-events-none absolute inset-0 size-full fill-none stroke-[var(--border)]'
      >
        <rect
          x='0.5'
          y='0.5'
          width='659'
          height='207'
          rx='8'
          pathLength='1'
          strokeDasharray='1'
          strokeDashoffset={reducedMotion ? 0 : 1}
          vectorEffect='non-scaling-stroke'
        >
          {!reducedMotion && (
            <animate attributeName='stroke-dashoffset' from='1' to='0' dur='0.9s' fill='freeze' />
          )}
        </rect>
        {[44, 76, 120, 164].map((y, index) => (
          <path
            key={y}
            d={`M 0 ${y} H 660`}
            pathLength='1'
            strokeDasharray='1'
            strokeDashoffset={reducedMotion ? 0 : 1}
            vectorEffect='non-scaling-stroke'
          >
            {!reducedMotion && (
              <animate
                attributeName='stroke-dashoffset'
                from='1'
                to='0'
                begin={`${0.45 + index * 0.12}s`}
                dur='0.5s'
                fill='freeze'
              />
            )}
          </path>
        ))}
      </svg>
      <div
        className={cn(
          'flex h-11 items-center gap-2 px-3 transition-[opacity,filter] duration-300 motion-reduce:transition-none',
          visible(400) ? 'opacity-100 blur-none' : 'opacity-0 blur-sm'
        )}
      >
        <Search className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        <span className='min-w-0 flex-1 truncate'>{query}</span>
        <span className='shrink-0 text-[11px] text-[var(--text-secondary)]'>
          {files.length} files
        </span>
      </div>
      <table className='w-full table-fixed border-collapse text-left'>
        <colgroup>
          <col />
          <col className='w-[72px]' />
          <col className='w-[64px]' />
        </colgroup>
        <thead
          className={cn(
            'h-8 text-[var(--text-secondary)] transition-opacity duration-300 motion-reduce:transition-none',
            visible(800) ? 'opacity-100' : 'opacity-0'
          )}
        >
          <tr>
            <th className='px-3 font-normal'>Name</th>
            <th className='font-normal'>Size</th>
            <th className='font-normal'>Owner</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file, index) => (
            <tr
              key={file.name}
              data-search-file-row
              className={cn(
                'h-11 transition-[opacity,filter,translate] duration-500 motion-reduce:transition-none',
                visible(1100 + index * 250)
                  ? 'translate-y-0 opacity-100 blur-none'
                  : 'translate-y-1 opacity-0 blur-sm'
              )}
            >
              <td className='px-3'>
                <span className='flex min-w-0 items-center gap-2'>
                  <FileText className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  <span className='truncate'>{file.name}</span>
                </span>
              </td>
              <td className='text-[12px]'>{file.size}</td>
              <td className='text-[12px]'>{file.owner}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
