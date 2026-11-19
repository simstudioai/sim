/**
 * A thunk probed as reading no block value is frozen into the catalog as a constant, so a read the
 * probe misses turns a value-dependent field into a fixed one.
 */
import { describe, expect, it } from 'vitest'
import { probeThunk } from '@/lib/workflows/code/catalog/probe'

describe('probeThunk', () => {
  it.each([
    ['Object.hasOwn', (values: Record<string, unknown>) => Object.hasOwn(values, 'model')],
    ['hasOwnProperty.call', (values: Record<string, unknown>) => Object.hasOwn(values, 'model')],
    ['the in operator', (values: Record<string, unknown>) => 'model' in values],
  ])('records a key-presence check through %s as a read of that key', (_form, thunk) => {
    const probe = probeThunk(thunk, { model: 'gpt' })
    expect(probe.ok).toBe(true)
    expect([...probe.reads]).toEqual(['model'])
  })
})
