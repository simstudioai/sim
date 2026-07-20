/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isTruthyAck,
  normalizeFiles,
  normalizeMemoryAccess,
  normalizeSessionParameters,
  normalizeStringList,
} from '@/tools/managed_agent/normalizers'

describe('isTruthyAck', () => {
  it('accepts boolean true and common string forms', () => {
    for (const v of [true, 'true', 'TRUE', ' 1 ', 'yes']) expect(isTruthyAck(v)).toBe(true)
  })
  it('rejects everything else', () => {
    for (const v of [false, 'false', '0', '', undefined, null, 1, {}]) {
      expect(isTruthyAck(v)).toBe(false)
    }
  })
})

describe('normalizeMemoryAccess', () => {
  it('passes through valid modes and drops others', () => {
    expect(normalizeMemoryAccess('read_write')).toBe('read_write')
    expect(normalizeMemoryAccess('read_only')).toBe('read_only')
    expect(normalizeMemoryAccess('nonsense')).toBeUndefined()
    expect(normalizeMemoryAccess(undefined)).toBeUndefined()
  })
})

describe('normalizeStringList', () => {
  it('handles arrays, json strings, comma-lists, and single strings', () => {
    expect(normalizeStringList(['a', ' b ', ''])).toEqual(['a', 'b'])
    expect(normalizeStringList('["x","y"]')).toEqual(['x', 'y'])
    expect(normalizeStringList('a, b ,c')).toEqual(['a', 'b', 'c'])
    expect(normalizeStringList('solo')).toEqual(['solo'])
    expect(normalizeStringList('')).toEqual([])
    expect(normalizeStringList(undefined)).toEqual([])
  })
})

describe('normalizeFiles', () => {
  it('reads the File ID column shape into a list of ids', () => {
    const rows = [{ cells: { 'File ID': 'file_1' } }, { cells: { 'File ID': ' file_2 ' } }]
    expect(normalizeFiles(rows)).toEqual(['file_1', 'file_2'])
  })
  it('accepts the flat shape and drops rows without a file id', () => {
    expect(normalizeFiles([{ fileId: 'file_ok' }, { fileId: '' }, {}])).toEqual(['file_ok'])
  })
  it('accepts plain string arrays and comma lists', () => {
    expect(normalizeFiles(['file_1', ' file_2 '])).toEqual(['file_1', 'file_2'])
    expect(normalizeFiles('file_1, file_2')).toEqual(['file_1', 'file_2'])
  })
  it('returns [] for empty input', () => {
    expect(normalizeFiles(undefined)).toEqual([])
    expect(normalizeFiles('')).toEqual([])
  })
})

describe('normalizeSessionParameters', () => {
  it('reads table rows keyed by Key/Value', () => {
    const rows = [{ cells: { Key: 'A', Value: '1' } }, { cells: { Key: 'B', Value: '2' } }]
    expect(normalizeSessionParameters(rows)).toEqual({ A: '1', B: '2' })
  })
  it('accepts a flat object and a json string', () => {
    expect(normalizeSessionParameters({ A: '1' })).toEqual({ A: '1' })
    expect(normalizeSessionParameters('[{"cells":{"Key":"A","Value":"1"}}]')).toEqual({ A: '1' })
  })
  it('drops blank keys and returns undefined when empty', () => {
    expect(normalizeSessionParameters([{ cells: { Key: ' ', Value: 'x' } }])).toBeUndefined()
    expect(normalizeSessionParameters([])).toBeUndefined()
    expect(normalizeSessionParameters(undefined)).toBeUndefined()
  })
})
