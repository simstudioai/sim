import { describe, expect, it } from 'vitest'
import { PulseV3Block } from '@/blocks/blocks/pulse'

const file = { name: 'report.pdf', key: 'workspace/report.pdf', url: '/api/files/serve/report.pdf' }

describe('PulseV3Block tool calls', () => {
  it('accepts the numeric chunk size an Agent tool call sends', () => {
    const params = PulseV3Block.tools.config?.params?.(
      { file, chunkSize: 800 },
      {
        operation: 'pulse_parser_v2',
      }
    )

    expect(params?.chunkSize).toBe(800)
  })
})
