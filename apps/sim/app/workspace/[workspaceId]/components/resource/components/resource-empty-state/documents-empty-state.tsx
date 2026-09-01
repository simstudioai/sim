import { Chip, cn } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'
import { EmptyStateDocsLink } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/docs-link'
import { HAIRLINE } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/hairline'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

const KNOWLEDGE_DOCS_URL = 'https://docs.sim.ai/knowledgebase'

/**
 * Ruled text — see the `INK` note in `tables-empty-state.tsx` for why not the surface
 * ramp. The heading line takes the stronger mix so the sheet reads as a document
 * rather than as blank ruling.
 */
const INK = {
  heading: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  body: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
} as const

/** Widths of the ruled body lines, in viewBox units. */
const BODY_LINES = [
  { y: 84, width: 62 },
  { y: 98, width: 54 },
  { y: 112, width: 66 },
] as const

/**
 * The front sheet, with the top-right corner turned back.
 *
 * The dog-ear is the one signifier no other graphic in the set uses — the folder is a
 * container, the knowledge mark is a shelf of volumes, and this has to read as the
 * pages inside one of them.
 */
const SHEET = [
  'M 58 34',
  'H 128',
  'L 148 54',
  'V 140',
  'Q 148 146 142 146',
  'H 58',
  'Q 52 146 52 140',
  'V 40',
  'Q 52 34 58 34',
  'Z',
].join(' ')

/** The turned-back corner itself, drawn over the sheet so its two edges both read. */
const DOG_EAR = ['M 128 34', 'L 148 54', 'H 134', 'Q 128 54 128 48', 'Z'].join(' ')

/**
 * Dissolves upward, the direction the stack recedes — the same call the folder makes.
 * The sheets behind are a repeating structure and cost nothing cropped, while the front
 * sheet stays crisp where the copy begins beneath it.
 */
const STACK_FADE =
  '[-webkit-mask-image:linear-gradient(to_top,#000_56%,transparent_100%)] [mask-image:linear-gradient(to_top,#000_56%,transparent_100%)]'

/**
 * The artwork's own bounds, so the frame follows the drawing rather than a round number.
 *
 * The sheets are authored around the front sheet's origin and step up and to the right,
 * which leaves the drawn mass off-centre inside any round-numbered viewBox — enough that
 * the mark sat visibly right of the copy beneath it. Framing on these bounds centres the
 * two. They are read off the shapes below by hand, so retuning the stack means updating
 * them here.
 */
const ART = { minX: 52, maxX: 166, minY: 18, maxY: 146 } as const
const ART_PADDING = 10
const VIEW_BOX_WIDTH = ART.maxX - ART.minX + ART_PADDING * 2
const VIEW_BOX_HEIGHT = ART.maxY - ART.minY + ART_PADDING * 2
const VIEW_BOX = `${ART.minX - ART_PADDING} ${ART.minY - ART_PADDING} ${VIEW_BOX_WIDTH} ${VIEW_BOX_HEIGHT}`

/** Matches the other resource graphics, so the set centres as one collection. */
const MARK_HEIGHT = 148

/**
 * A stack of sheets, the front one dog-eared and ruled. The two behind it step up and
 * to the right, so the stack reads as depth rather than as a single thick page.
 */
function DocumentsGraphic() {
  return (
    <svg
      viewBox={VIEW_BOX}
      width={(MARK_HEIGHT * VIEW_BOX_WIDTH) / VIEW_BOX_HEIGHT}
      height={MARK_HEIGHT}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className={cn('block max-w-none shrink-0', STACK_FADE, MASK_NO_REPEAT)}
    >
      <rect x='70' y='18' width='96' height='112' rx='6' fill='var(--surface-4)' {...HAIRLINE} />
      <rect x='61' y='26' width='96' height='112' rx='6' fill='var(--surface-3)' {...HAIRLINE} />

      <path d={SHEET} fill='var(--surface-2)' {...HAIRLINE} />
      <path d={DOG_EAR} fill='var(--surface-4)' {...HAIRLINE} />

      <rect x='68' y='64' width='44' height='6' rx='3' fill={INK.heading} />
      {BODY_LINES.map((line) => (
        <rect
          key={line.y}
          x='68'
          y={line.y}
          width={line.width}
          height='5'
          rx='2.5'
          fill={INK.body}
        />
      ))}
    </svg>
  )
}

interface DocumentsEmptyStateProps {
  /** Opens the file picker — the same action the header's primary chip runs. */
  onAddDocuments: () => void
  /** Mirrors the header chip's disabled state: no edit rights on the workspace. */
  addDisabled?: boolean
}

/** Empty state for a knowledge base that holds no documents yet. */
export function DocumentsEmptyState({
  onAddDocuments,
  addDisabled = false,
}: DocumentsEmptyStateProps) {
  return (
    <EmptyState
      graphic={<DocumentsGraphic />}
      title='Documents'
      description='Upload documents so your agents can search this base.'
      action={
        <>
          <Chip variant='primary' onClick={onAddDocuments} disabled={addDisabled} leftIcon={Plus}>
            New documents
          </Chip>
          <EmptyStateDocsLink href={KNOWLEDGE_DOCS_URL} />
        </>
      }
    />
  )
}
