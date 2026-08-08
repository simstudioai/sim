/** @vitest-environment node */
import { Workflow } from '@sim/emcn/icons'
import { describe, expect, it } from 'vitest'
import { AgentSkillsIcon } from '@/components/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { mentionIcon } from './mention-icon'
import type { MentionKind } from './types'

describe('mentionIcon', () => {
  it('uses the product-wide glyph for a known kind', () => {
    expect(mentionIcon('workflow', 'x')).toBe(Workflow)
  })

  it('uses the shared skills glyph, not a one-off icon', () => {
    // The same glyph SkillTile and the chat context registry render.
    expect(mentionIcon('skill', 'x')).toBe(AgentSkillsIcon)
  })

  it('derives the file icon from the filename extension', () => {
    expect(mentionIcon('file', 'x', 'report.pdf')).toBe(getDocumentIcon('', 'report.pdf'))
    expect(mentionIcon('file', 'x', 'data.csv')).toBe(getDocumentIcon('', 'data.csv'))
  })

  it('returns undefined for an unrecognized kind so callers render no icon', () => {
    // The schema default is '' and a sim: link could carry a future kind — neither may crash render.
    expect(mentionIcon('' as unknown as MentionKind, 'x')).toBeUndefined()
    expect(mentionIcon('dataset' as unknown as MentionKind, 'x')).toBeUndefined()
  })
})
