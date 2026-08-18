import { EmptyState } from '@/components/empty-state/empty-state'
import {
  Bar,
  Vignette,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/vignette'

/**
 * A document fanning into the chunks it is embedded as — the moment that makes a
 * knowledge base a knowledge base, drawn in the editor vignette's connector
 * language (6px-radius smooth steps in `--workflow-edge`).
 */
const CHUNK_EDGE_PATHS = [
  'M190,80 H207 Q213,80 213,74 V52 Q213,46 219,46 H236',
  'M190,80 H236',
  'M190,80 H207 Q213,80 213,86 V108 Q213,114 219,114 H236',
] as const

function KnowledgeGraphic() {
  return (
    <Vignette>
      <svg className='absolute inset-0' fill='none' viewBox='0 0 320 148' width='320' height='148'>
        <defs>
          <linearGradient
            id='knowledge-empty-edge'
            x1='190'
            y1='0'
            x2='236'
            y2='0'
            gradientUnits='userSpaceOnUse'
          >
            <stop stopColor='var(--workflow-edge)' />
            <stop offset='1' stopColor='var(--workflow-edge)' />
          </linearGradient>
        </defs>
        {CHUNK_EDGE_PATHS.map((d) => (
          <path
            key={d}
            d={d}
            stroke='url(#knowledge-empty-edge)'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        ))}
      </svg>

      <span className='absolute top-[22px] left-[78px] h-[92px] w-[124px] rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-1)] opacity-40' />
      <span className='absolute top-[28px] left-[72px] h-[92px] w-[124px] rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)] opacity-70' />

      <div className='absolute top-[34px] left-[66px] h-[92px] w-[124px] rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)]'>
        <div className='flex items-center gap-2 px-3 pt-3 pb-2.5'>
          <span className='size-[14px] shrink-0 rounded-[4px] bg-[var(--surface-5)]' />
          <Bar className='h-2 w-[62px]' />
        </div>
        <div className='space-y-[7px] px-3'>
          <Bar className='h-2 w-[98px]' />
          <Bar className='h-2 w-[84px]' />
          <span className='block h-2 w-[92px] rounded-[3px] bg-[color-mix(in_srgb,var(--brand-knowledge)_26%,transparent)]' />
          <Bar className='h-2 w-[70px]' />
        </div>
      </div>

      {[35, 69, 103].map((top, index) => (
        <span
          key={top}
          className='absolute left-[236px] size-[22px] rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-3)]'
          style={{ top }}
        >
          <span
            className='absolute inset-[5px] rounded-[3px]'
            style={{
              background:
                index === 1
                  ? 'color-mix(in srgb, var(--brand-knowledge) 34%, transparent)'
                  : 'var(--surface-5)',
            }}
          />
        </span>
      ))}
    </Vignette>
  )
}

/** Empty state for the knowledge bases list when the workspace has none. */
export function KnowledgeEmptyState() {
  return (
    <EmptyState
      graphic={<KnowledgeGraphic />}
      title='No knowledge bases yet'
      description='Upload documents to give your agents a memory they can search.'
    />
  )
}
