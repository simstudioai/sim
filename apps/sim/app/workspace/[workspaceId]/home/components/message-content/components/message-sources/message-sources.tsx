'use client'

import { cn } from '@sim/emcn'
import { SourceChip } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

/**
 * Right-edge fade so an overflowing strip reads as scrollable rather than cut.
 * The strip's trailing padding matches the fade width, so the last chip scrolls
 * fully clear of it.
 */
const STRIP_FADE_CLASSES =
  'pr-10 [-webkit-mask-image:linear-gradient(to_right,black_calc(100%_-_40px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%_-_40px),transparent)]'

interface MessageSourcesProps {
  sources: readonly SourceTagData[]
}

/**
 * Footer strip listing every document a reply cited, once each: one
 * horizontally scrolling row of {@link SourceChip}s that fades out at the right
 * edge instead of wrapping, so a long list stays a single quiet line under the
 * answer.
 */
export function MessageSources({ sources }: MessageSourcesProps) {
  if (sources.length === 0) return null

  return (
    <div
      className={cn(
        'flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        STRIP_FADE_CLASSES
      )}
    >
      {sources.map((source) => (
        <SourceChip key={source.url} source={source} />
      ))}
    </div>
  )
}
