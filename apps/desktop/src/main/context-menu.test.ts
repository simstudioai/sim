import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { buildContextMenuTemplate } from '@/main/context-menu'

const handlers = {
  replaceMisspelling: vi.fn(),
  addToDictionary: vi.fn(),
  openLink: vi.fn(),
  copyLink: vi.fn(),
  inspect: vi.fn(),
}

const baseParams = {
  misspelledWord: '',
  dictionarySuggestions: [] as string[],
  isEditable: false,
  selectionText: '',
  linkURL: '',
  x: 0,
  y: 0,
}

describe('buildContextMenuTemplate', () => {
  it('returns nothing for bare canvas areas so custom web menus stay in charge', () => {
    expect(buildContextMenuTemplate(baseParams, { isDev: true }, handlers)).toEqual([])
  })

  it('offers edit roles in editable fields', () => {
    const template = buildContextMenuTemplate(
      { ...baseParams, isEditable: true },
      { isDev: false },
      handlers
    )
    const roles = template.map((item) => item.role)
    expect(roles).toContain('cut')
    expect(roles).toContain('copy')
    expect(roles).toContain('paste')
    expect(roles).toContain('selectAll')
  })

  it('offers copy for plain selections', () => {
    const template = buildContextMenuTemplate(
      { ...baseParams, selectionText: 'hello' },
      { isDev: false },
      handlers
    )
    expect(template.map((item) => item.role)).toEqual(['copy'])
  })

  it('offers spellcheck suggestions and add-to-dictionary', () => {
    const template = buildContextMenuTemplate(
      {
        ...baseParams,
        isEditable: true,
        misspelledWord: 'wrokflow',
        dictionarySuggestions: ['workflow', 'workflows'],
      },
      { isDev: false },
      handlers
    )
    const labels = template.map((item) => item.label)
    expect(labels).toContain('workflow')
    expect(labels).toContain('Add to Dictionary')
  })

  it('offers link actions', () => {
    const template = buildContextMenuTemplate(
      { ...baseParams, linkURL: 'https://docs.sim.ai' },
      { isDev: false },
      handlers
    )
    const labels = template.map((item) => item.label)
    expect(labels).toContain('Open Link in Browser')
    expect(labels).toContain('Copy Link')
  })

  it('adds Inspect Element only in dev and only when a menu is shown anyway', () => {
    const dev = buildContextMenuTemplate(
      { ...baseParams, selectionText: 'x' },
      { isDev: true },
      handlers
    )
    expect(dev.map((item) => item.label)).toContain('Inspect Element')
    const packaged = buildContextMenuTemplate(
      { ...baseParams, selectionText: 'x' },
      { isDev: false },
      handlers
    )
    expect(packaged.map((item) => item.label)).not.toContain('Inspect Element')
  })
})
