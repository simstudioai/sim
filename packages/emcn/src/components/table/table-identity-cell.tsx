'use client'

import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * What the row identifies. `person` is the default every table gets; `resource`
 * is the deliberate override.
 */
export type TableIdentitySubject = 'person' | 'resource'

interface AvatarTreatment {
  /** Size and radius of the avatar box. */
  box: string
  /** Type size and colour of the monogram that stands in for a missing image. */
  monogram: string
  /**
   * Whether the caller's `color` fills the monogram's box. A person is never
   * tinted — the product gives people no colour, so a fill would invent one.
   */
  tinted: boolean
}

/**
 * The two treatments, each declared once and in full.
 *
 * `person` is a profile picture at chip height, falling back to the outlined
 * monogram Settings → General draws. `resource` is the sidebar workspace
 * header's tile, at that header's own size and radius, filled with the thing's
 * own colour — a workspace HAS a colour, and is small because it identifies a
 * container rather than a face.
 */
const AVATAR_TREATMENT: Record<TableIdentitySubject, AvatarTreatment> = {
  person: {
    box: 'size-[30px] rounded-full',
    monogram: 'border border-[var(--border)] text-[var(--text-primary)] text-caption',
    tinted: false,
  },
  resource: {
    /** `text-micro` (10px) stands in for the header's literal `text-[9px]`, which `sim-styling` forbids. */
    box: 'size-[16px] rounded-sm',
    monogram: 'text-white text-micro',
    tinted: true,
  },
}

const AVATAR_BOX_CLASS = 'flex-shrink-0 overflow-hidden'
const MONOGRAM_CLASS = 'flex items-center justify-center leading-none'
const RESOURCE_FALLBACK_COLOR = 'var(--brand-accent)'
/**
 * Row rhythm, which belongs to the table rather than to either treatment: a
 * chip's height as a floor so every row measures the same whichever avatar it
 * carries, and a gap matching the space between two adjacent columns — each
 * cell's `px-2` on either side of the boundary — so the row reads on one
 * horizontal rhythm rather than tightening at its left edge.
 */
const ROW_CLASS = 'flex min-h-[30px] min-w-0 items-center gap-4'

/** Props for {@link TableIdentityCell}. */
export interface TableIdentityCellProps {
  /** First line — the row's name. */
  primary: ReactNode
  /** Second, muted line — an email, a handle, a path. */
  secondary?: ReactNode
  /** Image URL. Without one the monogram stands in. */
  imageSrc?: string
  /**
   * Fill behind a RESOURCE's monogram — a workspace's own colour. Ignored for a
   * person, whose empty state is an outline.
   */
  color?: string
  /**
   * What this row identifies.
   * @default 'person'
   */
  subject?: TableIdentitySubject
}

/**
 * Up to two characters: the first letters of the first and last word, or just
 * the first. Mirrors `getInitials` in Settings → General, the empty state the
 * person treatment is drawn from.
 */
function initialsOf(primary: ReactNode): string {
  if (typeof primary !== 'string' || !primary.trim()) return ''
  const parts = primary.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  return parts[0][0].toUpperCase()
}

/**
 * The identity cell of a `Table` — an avatar beside a primary line over a muted
 * secondary line.
 *
 * Built from a plain `img`/`div` rather than the emcn `Avatar`, whose Radix root
 * is a `<span>` carrying a fallback border and `--surface-4` fill that neither
 * treatment wants. The sidebar footer and workspace header sidestep it the same
 * way.
 *
 * @example
 * ```tsx
 * <TableIdentityCell primary={member.name} secondary={member.email} imageSrc={member.image} />
 * <TableIdentityCell primary={workspace.name} color={workspace.color} subject='resource' />
 * ```
 */
export function TableIdentityCell({
  primary,
  secondary,
  imageSrc,
  color,
  subject = 'person',
}: TableIdentityCellProps) {
  const treatment = AVATAR_TREATMENT[subject]

  return (
    <div className={ROW_CLASS}>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=''
          referrerPolicy='no-referrer'
          className={cn(AVATAR_BOX_CLASS, treatment.box, 'object-cover')}
        />
      ) : (
        <div
          className={cn(AVATAR_BOX_CLASS, treatment.box, MONOGRAM_CLASS, treatment.monogram)}
          // A per-resource colour cannot be a class — the one case `sim-styling` allows.
          style={
            treatment.tinted ? { backgroundColor: color ?? RESOURCE_FALLBACK_COLOR } : undefined
          }
        >
          {initialsOf(primary)}
        </div>
      )}
      <div className='flex min-w-0 flex-col'>
        <span className='truncate text-[var(--text-body)] text-small leading-4'>{primary}</span>
        {secondary != null ? (
          <span className='truncate text-[var(--text-muted)] text-caption leading-[14px]'>
            {secondary}
          </span>
        ) : null}
      </div>
    </div>
  )
}
