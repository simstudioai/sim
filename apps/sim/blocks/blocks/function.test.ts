/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { USER_FILE_ACCESSIBLE_PROPERTIES } from '@/lib/workflows/types'
import { FunctionBlock } from '@/blocks/blocks/function'

describe('Function block file surface', () => {
  it('has no file configuration fields', () => {
    // Files reach the sandbox by being referenced in code as
    // <block.file.path> — the same way every other block output is referenced.
    // A dedicated field would be a second way to say the same thing, and would
    // need a home in the panel that the reference syntax does not.
    const ids = FunctionBlock.subBlocks.map((subBlock) => subBlock.id)

    expect(ids).not.toContain('files')
    expect(ids).not.toContain('uploadedFiles')
    expect(ids).not.toContain('collectOutputFiles')
    expect(FunctionBlock.inputs).not.toHaveProperty('files')
    expect(FunctionBlock.inputs).not.toHaveProperty('collectOutputFiles')
  })

  it('returns harvested files so downstream blocks can consume them', () => {
    expect(FunctionBlock.outputs.files).toMatchObject({ type: 'file[]' })
  })

  it('offers path alongside base64 as a referenceable file property', () => {
    // This is what puts `.path` in the tag dropdown: block-outputs.ts maps the
    // list into `${path}.${prop}` suggestions.
    expect(USER_FILE_ACCESSIBLE_PROPERTIES).toContain('path')
    expect(USER_FILE_ACCESSIBLE_PROPERTIES).toContain('base64')
  })
})
