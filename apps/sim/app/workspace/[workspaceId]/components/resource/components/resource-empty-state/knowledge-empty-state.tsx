import { Chip, ChipLink, Plus } from '@sim/emcn'
import { BookOpen } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'

/**
 * Neutral ink at graded strengths.
 *
 * `--surface-4`/`--surface-5` are near-white in light mode (#f5f5f5/#f3f3f3), so
 * skeleton geometry built on them dissolves against the page. Mixing
 * `--text-secondary` into transparent gives a real mid-grey that inverts with the
 * theme — the idiom the workflow editor's vignette uses for the one bar it needs
 * you to actually see.
 */
const INK = {
  heading: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  line: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
  chunk: 'color-mix(in srgb, var(--text-secondary) 11%, transparent)',
} as const

/**
 * Crisp at the top-left, dissolving through the bottom-right — the same
 * two-gradient intersect the landing page's workflow vignette uses, so the
 * geometry blends into the page rather than sitting on it as a card.
 *
 * Held back further than the tables grid on both axes: the document has to stay
 * whole for the graphic to mean anything, and only the chunks it fans into may
 * trail off.
 */
const CORNER_FADE =
  '[-webkit-mask-image:linear-gradient(to_right,#000_66%,transparent_100%),linear-gradient(to_bottom,#000_70%,transparent_100%)] [mask-image:linear-gradient(to_right,#000_66%,transparent_100%),linear-gradient(to_bottom,#000_70%,transparent_100%)] [-webkit-mask-composite:source-in] [mask-composite:intersect]'

/** Text-line widths inside the document; the first reads as its heading. */
const DOCUMENT_LINES = [64, 78, 58, 72, 46] as const

/**
 * Smooth steps at the editor vignette's 6px corner radius, fanning from the
 * document's right edge to the first column of chunks.
 */
const CHUNK_EDGE_PATHS = [
  'M130,71 H141 Q147,71 147,65 V51 Q147,45 153,45 H164',
  'M130,71 H164',
  'M130,71 H141 Q147,71 147,77 V91 Q147,97 153,97 H164',
] as const

const CHUNK_COLUMNS = [164, 190, 216, 242, 268, 294] as const
const CHUNK_ROWS = [35, 61, 87, 113] as const

/** Rows the edges actually land on — only those chunks read as filled. */
const CONNECTED_ROWS = new Set([35, 61, 87])

/** A document, and the chunks it is embedded as running off the far corner. */
function KnowledgeGraphic() {
  return (
    <div aria-hidden='true' className={`relative h-[148px] w-[320px] ${CORNER_FADE}`}>
      <div className='absolute top-[34px] left-[26px] h-[74px] w-[104px] rounded-[6px] border border-[var(--border-1)] px-3 pt-[13px]'>
        {DOCUMENT_LINES.map((width, index) => (
          <span
            key={width}
            className='mb-[9px] block h-[5px] rounded-full'
            style={{ width, background: index === 0 ? INK.heading : INK.line }}
          />
        ))}
      </div>

      <svg className='absolute inset-0' fill='none' viewBox='0 0 320 148' width='320' height='148'>
        {CHUNK_EDGE_PATHS.map((d) => (
          <path
            key={d}
            d={d}
            stroke='var(--workflow-edge)'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        ))}
      </svg>

      {CHUNK_ROWS.map((top) =>
        CHUNK_COLUMNS.map((left) => (
          <span
            key={`${left}-${top}`}
            className='absolute size-[20px] rounded-[5px] border border-[var(--border-1)]'
            style={{
              left,
              top,
              background:
                left === CHUNK_COLUMNS[0] && CONNECTED_ROWS.has(top) ? INK.chunk : undefined,
            }}
          />
        ))
      )}
    </div>
  )
}

const KNOWLEDGE_DOCS_URL = 'https://docs.sim.ai/knowledgebase'

interface KnowledgeEmptyStateProps {
  /** Opens the create-base modal — the same action the header's primary chip runs. */
  onCreate: () => void
  /** Mirrors the header chip's disabled state: no edit rights on the workspace. */
  createDisabled?: boolean
}

/** Empty state for the knowledge bases list when the workspace has none. */
export function KnowledgeEmptyState({
  onCreate,
  createDisabled = false,
}: KnowledgeEmptyStateProps) {
  return (
    <EmptyState
      graphic={<KnowledgeGraphic />}
      title='No knowledge bases yet'
      description='Upload documents to give your agents a memory they can search.'
      action={
        <div className='flex items-center gap-2'>
          <Chip variant='primary' onClick={onCreate} disabled={createDisabled} leftIcon={Plus}>
            New base
          </Chip>
          <ChipLink
            href={KNOWLEDGE_DOCS_URL}
            target='_blank'
            rel='noopener noreferrer'
            variant='border'
            leftIcon={BookOpen}
          >
            Docs
          </ChipLink>
        </div>
      }
    />
  )
}
