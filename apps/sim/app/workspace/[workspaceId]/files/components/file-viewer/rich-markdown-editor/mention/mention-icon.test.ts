/** @vitest-environment node */
import { Box, File } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { mentionIcon } from './mention-icon'
import type { MentionKind } from './types'

describe('mentionIcon', () => {
  it('returns the category icon for a known kind', () => {
    expect(mentionIcon('file', 'x')).toBe(File)
  })

  it('falls back to a generic icon for an empty or unrecognized kind (never undefined)', () => {
    // The schema default is '' and a sim: link could carry a future kind — neither may crash render.
    expect(mentionIcon('' as unknown as MentionKind, 'x')).toBe(Box)
    expect(mentionIcon('dataset' as unknown as MentionKind, 'x')).toBe(Box)
  })
})
