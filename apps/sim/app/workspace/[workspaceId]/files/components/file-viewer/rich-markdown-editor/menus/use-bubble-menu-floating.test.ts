/**
 * @vitest-environment node
 */
import { Schema } from '@tiptap/pm/model'
import { AllSelection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { bubbleMenuAnchorRange } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/use-bubble-menu-floating'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: { inline: true },
  },
})

const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('first line'))])

describe('bubbleMenuAnchorRange', () => {
  it('collapses a whole-document selection to its leading position', () => {
    const selection = new AllSelection(doc)

    expect(bubbleMenuAnchorRange(selection)).toEqual({
      from: selection.from,
      to: selection.from,
    })
  })

  it('preserves ordinary text-selection geometry', () => {
    const selection = TextSelection.create(doc, 1, 6)

    expect(bubbleMenuAnchorRange(selection)).toEqual({ from: 1, to: 6 })
  })
})
