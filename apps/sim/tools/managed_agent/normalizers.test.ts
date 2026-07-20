/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isTruthyAck,
  normalizeEnvType,
  normalizeFiles,
  normalizeMemoryAccess,
  normalizeSessionParameters,
  normalizeStringList,
} from '@/tools/managed_agent/normalizers'

describe('normalizeEnvType', () => {
  it('passes through cloud and self_hosted', () => {
    expect(normalizeEnvType('cloud')).toBe('cloud')
    expect(normalizeEnvType('self_hosted')).toBe('self_hosted')
  })

  it('returns undefined for anything else', () => {
    expect(normalizeEnvType(undefined)).toBeUndefined()
    expect(normalizeEnvType('')).toBeUndefined()
    expect(normalizeEnvType('Cloud')).toBeUndefined()
    expect(normalizeEnvType('other')).toBeUndefined()
  })
})

describe('normalizeMemoryAccess', () => {
  it('passes through the two supported modes', () => {
    expect(normalizeMemoryAccess('read_write')).toBe('read_write')
    expect(normalizeMemoryAccess('read_only')).toBe('read_only')
  })

  it('returns undefined for anything else', () => {
    expect(normalizeMemoryAccess(undefined)).toBeUndefined()
    expect(normalizeMemoryAccess('')).toBeUndefined()
    expect(normalizeMemoryAccess('write')).toBeUndefined()
    expect(normalizeMemoryAccess('READ_WRITE')).toBeUndefined()
  })
})

describe('normalizeStringList', () => {
  it('returns empty when the value is undefined / null / non-string non-array', () => {
    expect(normalizeStringList(undefined)).toEqual([])
    expect(normalizeStringList(null)).toEqual([])
    expect(normalizeStringList(42)).toEqual([])
    expect(normalizeStringList({})).toEqual([])
    expect(normalizeStringList(true)).toEqual([])
  })

  it('preserves array-of-string input and trims each entry', () => {
    expect(normalizeStringList(['a', ' b ', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('drops non-string and blank entries from an array', () => {
    expect(normalizeStringList(['a', '', '   ', null, 5, 'b'])).toEqual(['a', 'b'])
  })

  it('parses a JSON-encoded array string', () => {
    expect(normalizeStringList('["vlt_1","vlt_2"]')).toEqual(['vlt_1', 'vlt_2'])
  })

  it('falls back to comma-split when the JSON array parse fails', () => {
    // The leading `[` triggers the JSON attempt; broken JSON should not
    // then silently vanish — the raw comma-split path is preferred.
    // In practice broken JSON is not comma-separated, so the string is
    // returned as a single entry after the trim.
    expect(normalizeStringList('[not json')).toEqual(['[not json'])
  })

  it('splits comma-separated strings and trims each item', () => {
    expect(normalizeStringList('vlt_1, vlt_2 ,vlt_3')).toEqual(['vlt_1', 'vlt_2', 'vlt_3'])
  })

  it('accepts a single-value string', () => {
    expect(normalizeStringList('vlt_only')).toEqual(['vlt_only'])
  })

  it('returns empty for a whitespace-only string', () => {
    expect(normalizeStringList('   ')).toEqual([])
  })
})

describe('normalizeFiles', () => {
  it('returns empty for non-array input', () => {
    expect(normalizeFiles(undefined)).toEqual([])
    expect(normalizeFiles(null)).toEqual([])
    expect(normalizeFiles('file_id')).toEqual([])
    expect(normalizeFiles({})).toEqual([])
  })

  it('accepts the flat {fileId, mountPath?} shape', () => {
    expect(
      normalizeFiles([
        { fileId: 'file_1', mountPath: '/data/one' },
        { fileId: 'file_2' },
      ])
    ).toEqual([
      { fileId: 'file_1', mountPath: '/data/one' },
      { fileId: 'file_2' },
    ])
  })

  it('accepts the table-subblock {cells: {Key, Value}} shape', () => {
    expect(
      normalizeFiles([
        { id: 'r1', cells: { Key: 'file_1', Value: '/data/one' } },
        { id: 'r2', cells: { Key: 'file_2', Value: '' } },
      ])
    ).toEqual([
      { fileId: 'file_1', mountPath: '/data/one' },
      { fileId: 'file_2' },
    ])
  })

  it("accepts the block's declared column names (`File ID` / `Mount path`)", () => {
    // The cloud block declares `columns: ['File ID', 'Mount path']`, so
    // the table subblock stores each row keyed by exactly those strings.
    // Regression test — the previous normalizer only knew about
    // `Key`/`Value` and silently dropped every row.
    expect(
      normalizeFiles([
        { id: 'r1', cells: { 'File ID': 'file_1', 'Mount path': '/data/one' } },
        { id: 'r2', cells: { 'File ID': 'file_2', 'Mount path': '' } },
      ])
    ).toEqual([
      { fileId: 'file_1', mountPath: '/data/one' },
      { fileId: 'file_2' },
    ])
  })

  it('drops rows with no file id and rows that are not objects', () => {
    expect(
      normalizeFiles([
        { fileId: '' },
        { cells: { Key: '  ' } },
        null,
        undefined,
        'garbage',
        { cells: {} },
        { fileId: 'file_ok' },
      ])
    ).toEqual([{ fileId: 'file_ok' }])
  })

  it('omits mountPath when it is blank / whitespace-only', () => {
    expect(
      normalizeFiles([
        { fileId: 'file_1', mountPath: '   ' },
        { fileId: 'file_2', mountPath: '/mount' },
      ])
    ).toEqual([{ fileId: 'file_1' }, { fileId: 'file_2', mountPath: '/mount' }])
  })
})

describe('normalizeSessionParameters', () => {
  it('returns undefined for empty / non-object / non-string values', () => {
    expect(normalizeSessionParameters(undefined)).toBeUndefined()
    expect(normalizeSessionParameters(null)).toBeUndefined()
    expect(normalizeSessionParameters(42)).toBeUndefined()
    expect(normalizeSessionParameters(true)).toBeUndefined()
    expect(normalizeSessionParameters('')).toBeUndefined()
    expect(normalizeSessionParameters('   ')).toBeUndefined()
  })

  it('collapses the table-row shape into a flat Record<string,string>', () => {
    // This is the shape the workflow `table` subblock stores — the bug the
    // metadata: {} on the wire regression was caused by NOT handling this.
    const rows = [
      { id: 'r1', cells: { Key: 'SOURCE_TYPE', Value: 'git' } },
      { id: 'r2', cells: { Key: 'SOURCE_URL', Value: 'https://example/repo.git' } },
      { id: 'r3', cells: { Key: 'DEST_DIR', Value: 'repo' } },
    ]
    expect(normalizeSessionParameters(rows)).toEqual({
      SOURCE_TYPE: 'git',
      SOURCE_URL: 'https://example/repo.git',
      DEST_DIR: 'repo',
    })
  })

  it('accepts a JSON-encoded array-of-rows string', () => {
    const encoded = JSON.stringify([
      { cells: { Key: 'K1', Value: 'V1' } },
      { cells: { Key: 'K2', Value: 'V2' } },
    ])
    expect(normalizeSessionParameters(encoded)).toEqual({ K1: 'V1', K2: 'V2' })
  })

  it('accepts the flat Record<string,string> shape', () => {
    expect(normalizeSessionParameters({ A: '1', B: '2' })).toEqual({ A: '1', B: '2' })
  })

  it('drops rows with a blank key', () => {
    const rows = [
      { cells: { Key: '', Value: 'ignored' } },
      { cells: { Key: '   ', Value: 'also-ignored' } },
      { cells: { Key: 'KEEP', Value: 'yes' } },
    ]
    expect(normalizeSessionParameters(rows)).toEqual({ KEEP: 'yes' })
  })

  it('coerces non-string values to empty string but preserves the key', () => {
    const rows = [
      { cells: { Key: 'A', Value: 'str' } },
      { cells: { Key: 'B', Value: 42 } },
      { cells: { Key: 'C', Value: null } },
    ]
    expect(normalizeSessionParameters(rows)).toEqual({ A: 'str', B: '', C: '' })
  })

  it('returns undefined when every row is dropped', () => {
    expect(
      normalizeSessionParameters([{ cells: { Key: '', Value: 'x' } }, { cells: {} }])
    ).toBeUndefined()
  })

  it('returns undefined for a non-parseable JSON string', () => {
    // Non-`[`-prefixed strings are not parsed and not comma-split for
    // metadata (unlike vault lists) — they cannot form a valid k/v map.
    expect(normalizeSessionParameters('not json')).toBeUndefined()
    expect(normalizeSessionParameters('[broken')).toBeUndefined()
  })
})

describe('isTruthyAck', () => {
  it('accepts the real boolean true', () => {
    expect(isTruthyAck(true)).toBe(true)
  })

  it('accepts common string checked-forms (case-insensitive, trimmed)', () => {
    for (const on of ['true', 'True', 'TRUE', '1', 'yes', 'YES', '  true  ']) {
      expect(isTruthyAck(on)).toBe(true)
    }
  })

  it('rejects false, empty, and every other string form', () => {
    for (const off of [false, '', '   ', 'false', '0', 'no', 'off', 'random']) {
      expect(isTruthyAck(off)).toBe(false)
    }
  })

  it('rejects undefined / null / non-string non-boolean values', () => {
    expect(isTruthyAck(undefined)).toBe(false)
    expect(isTruthyAck(null)).toBe(false)
    expect(isTruthyAck(1)).toBe(false)
    expect(isTruthyAck({})).toBe(false)
    expect(isTruthyAck([])).toBe(false)
  })
})
