/**
 * @vitest-environment node
 */
import type { Editor, Range } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import { filterSlashCommands, SLASH_COMMANDS } from './commands'

describe('filterSlashCommands', () => {
  it('returns a copy of all commands for an empty query', () => {
    const all = filterSlashCommands('')
    expect(all).toHaveLength(SLASH_COMMANDS.length)
    expect(all).not.toBe(SLASH_COMMANDS)
  })

  it('matches on title case-insensitively', () => {
    expect(filterSlashCommands('HEAD').map((c) => c.title)).toEqual([
      'Heading 1',
      'Heading 2',
      'Heading 3',
    ])
  })

  it('matches on alias', () => {
    expect(filterSlashCommands('todo').map((c) => c.title)).toContain('Checklist')
    expect(filterSlashCommands('hr').map((c) => c.title)).toContain('Divider')
  })

  it('trims whitespace in the query', () => {
    expect(filterSlashCommands('  table ').map((c) => c.title)).toEqual(['Table'])
  })

  it('returns empty for no match', () => {
    expect(filterSlashCommands('zzz')).toEqual([])
  })
})

describe('SLASH_COMMANDS registry', () => {
  it('every command has the required fields', () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.title).toBeTruthy()
      expect(command.group).toBeTruthy()
      expect(command.icon).toBeTruthy()
      expect(Array.isArray(command.aliases)).toBe(true)
      expect(typeof command.run).toBe('function')
    }
  })

  it('has unique titles (stable React keys)', () => {
    const titles = SLASH_COMMANDS.map((c) => c.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('Image command replaces the trigger and hands the caret to the host insertImage handler', () => {
    const insertImage = vi.fn()
    const deleteRange = vi.fn(() => chain)
    const chain = { focus: () => chain, deleteRange, run: () => true }
    const editor = {
      chain: () => chain,
      storage: { slashCommand: { insertImage } },
      state: { selection: { from: 7 } },
    } as unknown as Editor

    const image = SLASH_COMMANDS.find((c) => c.title === 'Image')
    expect(image).toBeDefined()
    image?.run({ editor, range: { from: 5, to: 6 } as Range })

    expect(deleteRange).toHaveBeenCalledWith({ from: 5, to: 6 })
    expect(insertImage).toHaveBeenCalledWith(7)
  })

  it('Image command is a no-op when no handler is wired', () => {
    const chain = { focus: () => chain, deleteRange: () => chain, run: () => true }
    const editor = {
      chain: () => chain,
      storage: { slashCommand: { insertImage: null } },
      state: { selection: { from: 0 } },
    } as unknown as Editor
    expect(() =>
      SLASH_COMMANDS.find((c) => c.title === 'Image')?.run({
        editor,
        range: { from: 0, to: 1 } as Range,
      })
    ).not.toThrow()
  })
})
