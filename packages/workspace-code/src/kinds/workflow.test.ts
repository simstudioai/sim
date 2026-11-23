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

  it('refuses a base.json that is not a base, rather than reading the folder as never read', () => {
    const parsed = workflowCodec.parse(
      'ingest',
      {
        'workflows/ingest/workflow.ts': 'export default 1\n',
        'workflows/ingest/.sim/base.json': JSON.stringify({
          workflowId: 'wf_1',
          workspaceId: 'ws',
        }),
      },
      []
    )

    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => finding.code)).toEqual(['E_DECL_SHAPE'])
  })

  it('reads a base written before bases carried a version', () => {
    const base = { workflowId: 'wf_1', workspaceId: 'ws', fingerprint: 'sf1:a', catalogHash: 'c' }
    const parsed = workflowCodec.parse(
      'ingest',
      {
        'workflows/ingest/workflow.ts': 'export default 1\n',
        'workflows/ingest/.sim/base.json': JSON.stringify(base),
      },
      []
    )

    expect(parsed.decl?.base).toEqual({ version: 1, ...base })
  })
})
