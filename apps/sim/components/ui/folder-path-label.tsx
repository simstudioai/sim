import { cn } from '@sim/emcn'

/**
 * Ancestors kept before the path collapses. Three is the widest chain that still
 * reads at the ~30% of a menu row this label is allowed to occupy.
 */
const MAX_VISIBLE_SEGMENTS = 3
const ELLIPSIS = '…'

/**
 * Collapses a root-first folder chain so an over-long path drops whole ancestors
 * instead of clipping one mid-word: `Growth / … / Q3` rather than `Growth / Mark…`.
 *
 * The root orients and the leaf disambiguates, so those are the two that survive;
 * everything between them is what the reader can least act on.
 */
export function collapseFolderPath(segments: readonly string[]): string[] {
  if (segments.length <= MAX_VISIBLE_SEGMENTS) return [...segments]
  return [segments[0], ELLIPSIS, segments[segments.length - 1]]
}

export interface FolderPathLabelProps {
  /** Root-first ancestor names of the row's resource. */
  segments: readonly string[]
  /**
   * Pinned lead-in that never clips — the resource family (`Files`, `Workflows`)
   * when the label doubles as the row's disambiguator.
   */
  prefix?: string
  className?: string
}

/**
 * Right-aligned location receipt for a menu row. Head segments yield their space
 * first so the leaf — the segment that tells two same-named rows apart — is the
 * last thing to clip.
 */
export function FolderPathLabel({ segments, prefix, className }: FolderPathLabelProps) {
  const visible = collapseFolderPath(segments)
  const leaf = visible.at(-1)
  const head = visible.slice(0, -1)
  const hasLeadIn = Boolean(prefix) || head.length > 0

  if (!hasLeadIn && !leaf) return null

  return (
    <span
      className={cn('ml-auto flex min-w-0 pl-2 text-[var(--text-subtle)] text-small', className)}
    >
      {prefix && <span className='flex-shrink-0'>{prefix}</span>}
      {head.length > 0 && (
        <span className='min-w-0 truncate whitespace-pre [flex-shrink:9999]'>
          {prefix ? ` / ${head.join(' / ')}` : head.join(' / ')}
        </span>
      )}
      {leaf && (
        <>
          {hasLeadIn && <span className='flex-shrink-0 whitespace-pre'> / </span>}
          <span className='min-w-0 truncate'>{leaf}</span>
        </>
      )}
    </span>
  )
}
