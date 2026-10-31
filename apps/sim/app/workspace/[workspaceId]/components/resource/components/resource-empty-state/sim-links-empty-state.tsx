import { Chip, cn } from '@sim/emcn'
import { EmptyState } from '@/components/empty-state/empty-state'
import { HAIRLINE } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/hairline'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

/**
 * Skeleton ink — see the `INK` note in `tables-empty-state.tsx` for why not the surface
 * ramp. `mark` is the tables selection ring's opaque mix, so the held link reads as the
 * one drawn shortcut rather than more placeholder.
 */
const INK = {
  title: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  detail: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
  mark: 'color-mix(in srgb, var(--text-secondary) 46%, var(--bg))',
} as const

/** The logs feed's falloff — a link directory is the same repeating structure. */
const DIRECTORY_FADE =
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)] [mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)]'

interface LinkRow {
  name: number
  destination: number
}

/** The held link leads, wholly inside the fade's opaque head, so its card never dissolves. */
const ROWS: readonly LinkRow[] = [
  { name: 54, destination: 132 },
  { name: 70, destination: 108 },
  { name: 46, destination: 140 },
  { name: 62, destination: 118 },
] as const

const HELD_ROW = 0
const ROW_PITCH = 38
const PILL_X = 12
const PILL_PADDING = 10

/** A link directory: short names pointing at their destinations, one held in a card. */
function SimLinksGraphic() {
  return (
    <svg
      viewBox='0 0 286 148'
      width={286}
      height={148}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className={cn('block max-w-none shrink-0', DIRECTORY_FADE, MASK_NO_REPEAT)}
    >
      {ROWS.map((row, index) => {
        const y = 6 + index * ROW_PITCH
        const held = index === HELD_ROW
        const ink = held ? INK.mark : INK.title
        const arrowX = PILL_X + row.name + PILL_PADDING * 2 + 10
        return (
          <g key={y}>
            {held ? (
              <rect
                x='0.5'
                y={y - 2}
                width='285'
                height='36'
                rx='8'
                fill='var(--surface-2)'
                {...HAIRLINE}
              />
            ) : null}
            <rect
              x={PILL_X}
              y={y + 8}
              width={row.name + PILL_PADDING * 2}
              height='16'
              rx='8'
              fill='var(--surface-2)'
              stroke={held ? INK.mark : 'var(--border)'}
              strokeWidth={held ? 1.4 : HAIRLINE.strokeWidth}
            />
            <rect
              x={PILL_X + PILL_PADDING}
              y={y + 14}
              width={row.name}
              height='4'
              rx='2'
              fill={ink}
            />
            <path
              d={`M ${arrowX} ${y + 16} H ${arrowX + 18} M ${arrowX + 13} ${y + 11.5} L ${arrowX + 18} ${y + 16} L ${arrowX + 13} ${y + 20.5}`}
              stroke={ink}
              strokeWidth={1.4}
              strokeLinecap='round'
              strokeLinejoin='round'
            />
            <rect
              x={arrowX + 28}
              y={y + 14}
              width={row.destination}
              height='4'
              rx='2'
              fill={INK.detail}
            />
          </g>
        )
      })}
    </svg>
  )
}

interface SimLinksEmptyStateProps {
  onCreate: () => void
}

/** Empty state for an organization with no Sim links yet. */
export function SimLinksEmptyState({ onCreate }: SimLinksEmptyStateProps) {
  return (
    <EmptyState
      graphic={<SimLinksGraphic />}
      title='Sim Links'
      description='Create links like sim/handbook for the pages your team opens most.'
      action={
        <Chip variant='primary' onClick={onCreate}>
          New link
        </Chip>
      }
    />
  )
}
