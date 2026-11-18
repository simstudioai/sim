import { describe, expect, it } from 'vitest'
import { ReductoV3Block } from '@/blocks/blocks/reducto'

const file = { name: 'report.pdf', key: 'workspace/report.pdf', url: '/api/files/serve/report.pdf' }

describe('ReductoV3Block tool calls', () => {
  it('accepts the page array an Agent tool call sends', () => {
    const params = ReductoV3Block.tools.config?.params?.(
      { file, pages: [1, 3] },
      {
        operation: 'reducto_parser_v2',
      }
    )

    expect(params?.pages).toEqual([1, 3])
  })
})
