import { describe, expect, it } from 'vitest'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { SettingsAction } from '@/components/settings/settings-header'
import { orderHeaderActions } from '@/components/settings/settings-header'

const noop = () => {}

/** Labels in the order the header renders them. */
function rendered(actions: SettingsAction[]): string[] {
  return orderHeaderActions(actions).map(({ action }) => action.text)
}

const save = (dirty: boolean) =>
  saveDiscardActions({ dirty, saving: false, onSave: noop, onDiscard: noop })

describe('orderHeaderActions', () => {
  it('puts Delete before Discard and Save no matter how the caller ordered them', () => {
    // The natural way to write this array — Save/Discard first, then Delete —
    // is what every settings detail page did, and it rendered Delete to the
    // right of the primary chip.
    const actions: SettingsAction[] = [
      ...save(true),
      { id: 'delete', text: 'Delete', onSelect: noop },
    ]

    expect(rendered(actions)).toEqual(['Delete', 'Discard', 'Save'])
  })

  it('matches the skills detail header: secondary actions, then Delete, then Save', () => {
    const actions: SettingsAction[] = [
      { text: 'Share', onSelect: noop },
      { id: 'delete', text: 'Delete', onSelect: noop },
      ...save(true),
    ]

    expect(rendered(actions)).toEqual(['Share', 'Delete', 'Discard', 'Save'])
  })

  it('keeps Save right-most when there is nothing to discard', () => {
    const actions: SettingsAction[] = [
      ...save(false),
      { id: 'delete', text: 'Delete', onSelect: noop },
    ]

    expect(rendered(actions)).toEqual(['Delete', 'Save'])
  })

  it('sends any primary action to the end, not just Save', () => {
    // Workflow MCP servers: Add workflows is the primary, Delete must precede it.
    const actions: SettingsAction[] = [
      { text: 'Edit server', onSelect: noop },
      { text: 'Add workflows', variant: 'primary', onSelect: noop },
      { id: 'delete', text: 'Delete', onSelect: noop },
    ]

    expect(rendered(actions)).toEqual(['Edit server', 'Delete', 'Add workflows'])
  })

  it('places Delete by its id, not by where the caller listed it', () => {
    // A page with no primary action still must not leave Delete in the slot a
    // primary would occupy — files detail is exactly this shape.
    const actions: SettingsAction[] = [
      { id: 'delete', text: 'Delete', onSelect: noop },
      { text: 'Download', onSelect: noop },
      { text: 'Share', onSelect: noop },
    ]

    expect(rendered(actions)).toEqual(['Download', 'Share', 'Delete'])
  })

  it('preserves caller order within a band', () => {
    const actions: SettingsAction[] = [
      { text: 'Refresh', onSelect: noop },
      { text: 'Edit', onSelect: noop },
      { id: 'delete', text: 'Delete', onSelect: noop },
    ]

    expect(rendered(actions)).toEqual(['Refresh', 'Edit', 'Delete'])
  })

  it('leaves a destructive bulk action left of the primary', () => {
    // Passwords: `Delete all` is destructive but must not outrank `Import`.
    // This is what keeps a red chip from becoming the right-most control.
    const actions: SettingsAction[] = [
      { text: 'Delete all', variant: 'destructive', onSelect: noop },
      { text: 'Import', variant: 'primary', onSelect: noop },
    ]

    expect(rendered(actions)).toEqual(['Delete all', 'Import'])
  })

  it('ranks a destructive action alongside secondary ones, not after Discard', () => {
    const actions: SettingsAction[] = [
      ...save(true),
      { text: 'Sign out all members', variant: 'destructive', onSelect: noop },
    ]

    expect(rendered(actions)).toEqual(['Sign out all members', 'Discard', 'Save'])
  })

  it('treats primary as the stronger signal when an action is both', () => {
    const actions: SettingsAction[] = [
      { text: 'Other', onSelect: noop },
      { id: 'discard', text: 'Odd', variant: 'primary', onSelect: noop },
    ]

    expect(rendered(actions)).toEqual(['Other', 'Odd'])
  })

  it('carries each action original index so ref-routed handlers stay bound', () => {
    const actions: SettingsAction[] = [
      ...save(true), // indices 0 (Discard), 1 (Save)
      { id: 'delete', text: 'Delete', onSelect: noop }, // index 2
    ]

    expect(orderHeaderActions(actions).map(({ action, index }) => [action.text, index])).toEqual([
      ['Delete', 2],
      ['Discard', 0],
      ['Save', 1],
    ])
  })

  it('tolerates an absent or empty action list', () => {
    expect(orderHeaderActions(undefined)).toEqual([])
    expect(orderHeaderActions([])).toEqual([])
  })

  it('does not mutate the caller array', () => {
    // The shell sorts a prop read off a live ref; reordering it in place would
    // renumber the indices the handlers are routed through.
    const actions: SettingsAction[] = [
      ...save(true),
      { id: 'delete', text: 'Delete', onSelect: noop },
    ]
    const before = actions.map((a) => a.text)

    orderHeaderActions(actions)

    expect(actions.map((a) => a.text)).toEqual(before)
  })
})
