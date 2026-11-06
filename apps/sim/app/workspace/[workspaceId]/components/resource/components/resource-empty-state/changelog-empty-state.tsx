import { cn } from '@sim/emcn'
import { EmptyState } from '@/components/empty-state/empty-state'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

/**
 * Skeleton ink — see the `INK` note in `tables-empty-state.tsx` for why not the surface
 * ramp. `mark` is the tables selection ring's opaque mix, so the latest release reads as
 * the one drawn entry rather than more placeholder.
 */
const INK = {
  title: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  detail: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
  mark: 'color-mix(in srgb, var(--text-secondary) 46%, var(--bg))',
} as const

/** The logs feed's falloff — a release history is the same repeating structure. */
const TIMELINE_FADE =
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)] [mask-image:linear-gradient(to_bottom,#000_44%,transparent_100%)]'

interface Release {
  top: number
  notes: readonly number[]
}

const LATEST: Release = { top: 10, notes: [118, 92] } as const

/** Ends inside the 148px viewBox; the fade carries the timeline past it. */
const EARLIER: Release = { top: 70, notes: [104, 126, 80] } as const

const SPINE_X = 24
const NOTE_PITCH = 12

interface ReleaseNotesProps {
  release: Release
}

function ReleaseNotes({ release }: ReleaseNotesProps) {
  return release.notes.map((width, index) => {
    const y = release.top + 26 + index * NOTE_PITCH
    return (
      <g key={y}>
        <circle cx='46' cy={y + 2} r='1.8' fill={INK.title} />
        <rect x='54' y={y} width={width} height='4' rx='2' fill={INK.detail} />
      </g>
    )
  })
}

/** A release timeline: the latest release ringed at the head, earlier ones falling away below. */
function ChangelogGraphic() {
  const latestY = LATEST.top + 8
  return (
    <svg
      viewBox='0 0 260 148'
      width={260}
      height={148}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className={cn('block max-w-none shrink-0', TIMELINE_FADE, MASK_NO_REPEAT)}
    >
      <line x1={SPINE_X} x2={SPINE_X} y1='18' y2='160' stroke='var(--border)' strokeWidth={1.4} />

      <circle
        cx={SPINE_X}
        cy={latestY}
        r='6'
        fill='var(--surface-2)'
        stroke={INK.mark}
        strokeWidth={1.6}
      />
      <circle cx={SPINE_X} cy={latestY} r='2.4' fill={INK.mark} />
      <rect
        x='42'
        y={LATEST.top + 2}
        width='40'
        height='13'
        rx='6.5'
        fill='var(--surface-2)'
        stroke={INK.mark}
        strokeWidth={1.3}
      />
      <rect x='50' y={LATEST.top + 6.5} width='24' height='4' rx='2' fill={INK.mark} />
      <rect x='92' y={LATEST.top + 6.5} width='34' height='4' rx='2' fill={INK.detail} />
      <ReleaseNotes release={LATEST} />

      <circle cx={SPINE_X} cy={EARLIER.top + 8} r='4' fill={INK.title} />
      <rect x='42' y={EARLIER.top + 2} width='40' height='13' rx='6.5' fill={INK.detail} />
      <rect x='50' y={EARLIER.top + 6.5} width='24' height='4' rx='2' fill={INK.title} />
      <rect x='92' y={EARLIER.top + 6.5} width='34' height='4' rx='2' fill={INK.detail} />
      <ReleaseNotes release={EARLIER} />
    </svg>
  )
}

/** Empty state for a workspace that has no published releases yet. */
export function ChangelogEmptyState() {
  return (
    <EmptyState
      graphic={<ChangelogGraphic />}
      title='Changelog'
      description='Sim publishes a release here when it ships changes to this workspace.'
    />
  )
}
