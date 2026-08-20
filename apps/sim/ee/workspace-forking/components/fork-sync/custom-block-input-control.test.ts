/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { subBlockTypeForField } from '@/blocks/custom/build-config'
import {
  CUSTOM_BLOCK_BOOLEAN_FALSE,
  CUSTOM_BLOCK_BOOLEAN_TRUE,
  CUSTOM_BLOCK_BOOLEAN_UNSET,
  customBlockBooleanOptions,
  customBlockInputControl,
  isForkSyncConfigurableField,
} from '@/ee/workspace-forking/components/fork-sync/custom-block-input-control'

describe('customBlockInputControl', () => {
  it('matches how the canvas renders each field type', () => {
    // Mirrors `subBlockTypeForField`: a field configured here must behave the way it will
    // once the block is open in the editor.
    expect(customBlockInputControl('boolean')).toBe('switch')
    expect(customBlockInputControl('object')).toBe('textarea')
    expect(customBlockInputControl('array')).toBe('textarea')
    expect(customBlockInputControl('string')).toBe('input')
    expect(customBlockInputControl('number')).toBe('input')
  })

  it('refuses to offer a file input rather than rendering a text box for it', () => {
    // `file[]` is an upload on the canvas. A text box would write a plain string into a field
    // that expects file references — worse than not offering it, because it looks configured.
    expect(customBlockInputControl('file[]')).toBe('unsupported')
  })

  it('stays in step with the canvas mapping for every declared field type', () => {
    // The union a Start field can declare. Deriving from `subBlockTypeForField` means a type
    // added there surfaces here instead of silently falling through to a text box — which is
    // exactly how `file[]` came to be mis-rendered.
    const byCanvasKind = {
      switch: 'switch',
      code: 'textarea',
      'file-upload': 'unsupported',
    } as const

    for (const fieldType of ['string', 'number', 'boolean', 'object', 'array', 'file[]']) {
      const canvasKind = subBlockTypeForField(fieldType) as keyof typeof byCanvasKind
      expect(customBlockInputControl(fieldType)).toBe(byCanvasKind[canvasKind] ?? 'input')
    }
  })

  it('falls back to a plain input for an unknown or absent type', () => {
    expect(customBlockInputControl('something-new')).toBe('input')
    expect(customBlockInputControl(undefined)).toBe('input')
  })
})

describe('isForkSyncConfigurableField', () => {
  it('excludes a custom block’s file input from the Sync gate', () => {
    // The modal renders it disabled, so a REQUIRED one could never be satisfied: Sync would
    // stay off forever while the hint told the user to set it in a workflow they can only
    // reach by syncing. The sync no longer clears the field, so skipping the gate is safe.
    expect(isForkSyncConfigurableField({ parentKind: 'custom-block', fieldType: 'file[]' })).toBe(
      false
    )
  })

  it('still gates every custom-block input that HAS a control', () => {
    for (const fieldType of ['string', 'number', 'boolean', 'object', 'array']) {
      expect(isForkSyncConfigurableField({ parentKind: 'custom-block', fieldType })).toBe(true)
    }
  })

  it('leaves every other parent kind gated', () => {
    // Only custom-block inputs classify their own control here; a selector-backed dependent
    // is always configurable.
    for (const parentKind of ['credential', 'knowledge-base', 'table'] as const) {
      expect(isForkSyncConfigurableField({ parentKind, fieldType: 'file[]' })).toBe(true)
    }
  })
})

describe('customBlockBooleanOptions', () => {
  it('lets an OPTIONAL flag return to the workflow default', () => {
    // Without this a single click permanently pins the flag: a two-segment switch has no
    // transition back to "nothing selected", so every later sync would keep overriding the
    // child's declared default.
    const options = customBlockBooleanOptions(false)

    expect(options.map((o) => o.value)).toEqual([
      CUSTOM_BLOCK_BOOLEAN_TRUE,
      CUSTOM_BLOCK_BOOLEAN_FALSE,
      CUSTOM_BLOCK_BOOLEAN_UNSET,
    ])
  })

  it('offers a REQUIRED flag only real values', () => {
    // The Sync gate demands a value, so "unset" is not a state it can end in — offering it
    // would present a choice that cannot be submitted.
    const options = customBlockBooleanOptions(true)

    expect(options.map((o) => o.value)).toEqual([
      CUSTOM_BLOCK_BOOLEAN_TRUE,
      CUSTOM_BLOCK_BOOLEAN_FALSE,
    ])
  })
})
