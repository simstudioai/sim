'use client'

import { useMemo } from 'react'
import { SimFileDiff } from '@/components/diff/sim-file-diff'
import { toFileDiffs } from '@/lib/diff/patch'
import type { UnifiedDiff } from '@/lib/diff/unified'

interface PatchViewProps {
  diff: UnifiedDiff
  /** Names the file when the diff carries no path, so its language is still inferred. */
  fallbackName: string
  wrapLines: boolean
}

/**
 * A code diff: syntax highlighted by file type, with word-level changes. A multi-file git diff
 * renders one titled section per file; a single file relies on the card header the embed
 * already draws.
 */
export function PatchView({ diff, fallbackName, wrapLines }: PatchViewProps) {
  /* Positions are invented for hunks without numbers, so numbers show only when every hunk has them. */
  const numbered = diff.hunks.every((hunk) => hunk.range !== undefined)
  const files = useMemo(() => toFileDiffs(diff, fallbackName), [diff, fallbackName])
  return (
    <div>
      {files.map((file, index) => (
        <SimFileDiff
          key={`${index}:${file.name}`}
          fileDiff={file}
          wrapLines={wrapLines}
          options={{
            disableFileHeader: files.length === 1,
            disableLineNumbers: !numbered,
            hunkSeparators: 'metadata',
          }}
        />
      ))}
    </div>
  )
}
