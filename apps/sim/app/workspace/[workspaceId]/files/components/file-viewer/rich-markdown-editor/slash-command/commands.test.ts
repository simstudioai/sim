/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
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
})
