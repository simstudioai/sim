import { describe, expect, it } from 'vitest'
import type { InputFormatFile } from '@/lib/workflows/input-format'
import {
  controlValueToFiles,
  defaultFileFieldMode,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/starter/input-format-files'

const file: InputFormatFile = {
  id: 'f1',
  name: 'doc.pdf',
  url: '/api/files/serve/workspace%2Fws-1%2F1700000000000-doc.pdf?context=workspace',
  key: 'key',
  size: 10,
  type: 'application/pdf',
}

describe('controlValueToFiles', () => {
  it.concurrent('preserves the stable id of an existing file (matched by key)', () => {
    const control = [
      { name: 'doc.pdf', path: '/moved', key: 'key', size: 10, type: 'application/pdf' },
    ]
    expect(controlValueToFiles(control, [file])[0].id).toBe('f1')
  })
})

describe('defaultFileFieldMode', () => {
  it.concurrent('falls back to json for legacy free-form values (no data loss)', () => {
    expect(defaultFileFieldMode('C:/Users/x/budget.xlsx')).toBe('json')
    expect(defaultFileFieldMode('[{"data":"<base64>","name":"x.pdf"}]')).toBe('json')
    expect(defaultFileFieldMode('{"csv":"a,b,c"}')).toBe('json')
  })

  it.concurrent('uses json when only some entries are run-ready (no silent drop)', () => {
    expect(defaultFileFieldMode(JSON.stringify([file, { name: 'legacy-only' }]))).toBe('json')
  })
})
