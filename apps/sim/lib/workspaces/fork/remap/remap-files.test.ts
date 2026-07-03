/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { remapForkFileUploadValue } from '@/lib/workspaces/fork/remap/remap-files'

const map = (entries: Record<string, string>) => (key: string) => entries[key] ?? null

describe('remapForkFileUploadValue', () => {
  it('rewrites a copied single object key, preserving other fields', () => {
    const value = { key: 'src/a.pdf', name: 'a.pdf', type: 'application/pdf', size: 10 }
    const result = remapForkFileUploadValue(value, map({ 'src/a.pdf': 'child/a.pdf' }))
    expect(result).toEqual({ key: 'child/a.pdf', name: 'a.pdf', type: 'application/pdf', size: 10 })
  })

  it('clears a single object whose file was not copied', () => {
    const value = { key: 'src/a.pdf', name: 'a.pdf' }
    expect(remapForkFileUploadValue(value, map({}))).toBe('')
  })

  it('remaps copied items and drops uncopied ones in an array', () => {
    const value = [
      { key: 'src/a.pdf', name: 'a.pdf' },
      { key: 'src/b.pdf', name: 'b.pdf' },
    ]
    const result = remapForkFileUploadValue(value, map({ 'src/a.pdf': 'child/a.pdf' }))
    expect(result).toEqual([{ key: 'child/a.pdf', name: 'a.pdf' }])
  })

  it('handles a JSON-stringified value and re-serializes', () => {
    const value = JSON.stringify({ key: 'src/a.pdf', name: 'a.pdf' })
    const result = remapForkFileUploadValue(value, map({ 'src/a.pdf': 'child/a.pdf' }))
    expect(result).toBe(JSON.stringify({ key: 'child/a.pdf', name: 'a.pdf' }))
  })

  it('falls back to the path field when there is no key', () => {
    const value = { path: 'src/a.pdf', name: 'a.pdf' }
    const result = remapForkFileUploadValue(value, map({ 'src/a.pdf': 'child/a.pdf' }))
    expect(result).toEqual({ path: 'child/a.pdf', name: 'a.pdf' })
  })

  it('returns the value unchanged when no items match', () => {
    const value = { key: 'src/a.pdf', name: 'a.pdf' }
    const sameKey = map({ 'src/a.pdf': 'src/a.pdf' })
    expect(remapForkFileUploadValue(value, sameKey)).toBe(value)
  })

  it('returns empty/unparseable values untouched', () => {
    expect(remapForkFileUploadValue('', map({}))).toBe('')
    expect(remapForkFileUploadValue(null, map({}))).toBe(null)
  })
})
