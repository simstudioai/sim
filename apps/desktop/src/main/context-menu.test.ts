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
