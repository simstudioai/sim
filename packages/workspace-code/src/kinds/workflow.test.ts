import { describe, expect, it } from 'vitest'
import { workflowCodec } from './workflow'

describe('workflowCodec', () => {
  it('keeps a file named __proto__ as a file, never the declaration prototype', () => {
    const parsed = workflowCodec.parse(
      'ingest',
      {
        'workflows/ingest/workflow.ts': 'export default 1\n',
        'workflows/ingest/__proto__': 'data\n',
      },
      []
    )

    expect(Object.keys(parsed.decl?.files ?? {}).sort()).toEqual(['__proto__', 'workflow.ts'])
    expect(Object.getOwnPropertyDescriptor(parsed.decl?.files, '__proto__')?.value).toBe('data\n')
  })
})
