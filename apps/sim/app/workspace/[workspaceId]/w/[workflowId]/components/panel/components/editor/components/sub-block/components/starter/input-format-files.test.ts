import { describe, expect, it } from 'vitest'
import type { InputFormatFile } from '@/lib/workflows/input-format'
import {
  controlValueToFiles,
  defaultFileFieldMode,
  filesToControlValue,
  serializeInputFormatFiles,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/starter/input-format-files'

const file: InputFormatFile = {
  id: 'f1',
  name: 'doc.pdf',
  url: '/api/files/serve/workspace%2Fws-1%2F1700000000000-doc.pdf?context=workspace',
  key: 'key',
  size: 10,
  type: 'application/pdf',
}

describe('filesToControlValue', () => {
  it.concurrent('maps url -> path for the FileUpload value shape', () => {
    expect(filesToControlValue([file])).toEqual([
      {
        name: file.name,
        path: file.url,
        key: file.key,
        size: file.size,
        type: file.type,
      },
    ])
  })

  it.concurrent('round-trips through controlValueToFiles without data loss', () => {
    expect(controlValueToFiles(filesToControlValue([file]), [file])).toEqual([file])
  })
})

describe('controlValueToFiles', () => {
  it.concurrent('preserves the stable id of an existing file (matched by key)', () => {
    const control = [
      { name: 'doc.pdf', path: '/moved', key: 'key', size: 10, type: 'application/pdf' },
    ]
    expect(controlValueToFiles(control, [file])[0].id).toBe('f1')
  })

  it.concurrent('matches an existing file by url when key is absent', () => {
    const control = [{ name: 'doc.pdf', path: file.url, size: 10, type: 'application/pdf' }]
    expect(controlValueToFiles(control, [file])[0].id).toBe('f1')
  })

  it.concurrent('generates an id for a newly added file', () => {
    const control = [
      {
        name: 'new.pdf',
        path: '/api/files/serve/new',
        key: 'new',
        size: 5,
        type: 'application/pdf',
      },
    ]
    const result = controlValueToFiles(control, [file])
    expect(result[0].id).toEqual(expect.any(String))
    expect(result[0].id).not.toBe('f1')
    expect(result[0].url).toBe('/api/files/serve/new')
  })

  it.concurrent('normalizes a single object or null to an array', () => {
    const single = {
      name: file.name,
      path: file.url,
      key: file.key,
      size: file.size,
      type: file.type,
    }
    expect(controlValueToFiles(single, [file])).toEqual([file])
    expect(controlValueToFiles(null, [file])).toEqual([])
  })
})

describe('serializeInputFormatFiles', () => {
  it.concurrent('serializes to JSON that parses back to the same files', () => {
    expect(JSON.parse(serializeInputFormatFiles([file]))).toEqual([file])
  })

  it.concurrent('returns an empty string for no files', () => {
    expect(serializeInputFormatFiles([])).toBe('')
  })
})

describe('defaultFileFieldMode', () => {
  it.concurrent('defaults to upload for empty or whitespace values', () => {
    expect(defaultFileFieldMode(undefined)).toBe('upload')
    expect(defaultFileFieldMode('')).toBe('upload')
    expect(defaultFileFieldMode('   ')).toBe('upload')
  })

  it.concurrent('uses upload for an empty array or run-ready files', () => {
    expect(defaultFileFieldMode('[]')).toBe('upload')
    expect(defaultFileFieldMode(JSON.stringify([file]))).toBe('upload')
  })

  it.concurrent('falls back to json for legacy free-form values (no data loss)', () => {
    expect(defaultFileFieldMode('C:/Users/x/budget.xlsx')).toBe('json')
    expect(defaultFileFieldMode('[{"data":"<base64>","name":"x.pdf"}]')).toBe('json')
    expect(defaultFileFieldMode('{"csv":"a,b,c"}')).toBe('json')
  })

  it.concurrent('uses json when only some entries are run-ready (no silent drop)', () => {
    expect(defaultFileFieldMode(JSON.stringify([file, { name: 'legacy-only' }]))).toBe('json')
  })
})
