/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  CUSTOM_BLOCK_BOOLEAN_FALSE,
  CUSTOM_BLOCK_BOOLEAN_TRUE,
  CUSTOM_BLOCK_BOOLEAN_UNSET,
  customBlockBooleanOptions,
  customBlockInputControl,
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

  it('falls back to a plain input for an unknown or absent type', () => {
    expect(customBlockInputControl('something-new')).toBe('input')
    expect(customBlockInputControl(undefined)).toBe('input')
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
