import { describe, expect, it } from 'vitest'
import type { ToolConfig } from '@/tools/types'
import { upstashRedisExpireTool } from '@/tools/upstash/redis_expire'
import { upstashRedisHGetTool } from '@/tools/upstash/redis_hget'
import { upstashRedisIncrbyTool } from '@/tools/upstash/redis_incrby'
import { upstashRedisLRangeTool } from '@/tools/upstash/redis_lrange'

const connection = { restUrl: 'https://example.upstash.io', restToken: 'token' }

/** Builds a tool's request path from untyped params, the way an agent's tool call arrives. */
function requestPath<P>(tool: ToolConfig<P>, params: Record<string, unknown>): string {
  const { url } = tool.request
  return new URL(typeof url === 'function' ? url({ ...connection, ...params } as P) : url).pathname
}

describe('Upstash REST paths', () => {
  it('refuses a dot-segment key that would turn the field into the command', () => {
    expect(() => requestPath(upstashRedisHGetTool, { key: '..', field: 'flushall' })).toThrow(
      'key cannot be "." or ".."'
    )
  })

  it.each([
    ['increment', upstashRedisIncrbyTool, { key: 'k', increment: '../../flushall' }],
    ['seconds', upstashRedisExpireTool, { key: 'k', seconds: '1/../../flushall' }],
    ['start', upstashRedisLRangeTool, { key: 'k', start: '../../flushall', stop: 1 }],
  ] as const)('refuses a non-integer %s', (name, tool, params) => {
    expect(() => requestPath(tool as ToolConfig, params)).toThrow(`${name} must be an integer`)
  })

  it('keeps ordinary keys, fields, and negative integers in their own segments', () => {
    expect(requestPath(upstashRedisHGetTool, { key: 'user/1', field: 'a b' })).toBe(
      '/hget/user%2F1/a%20b'
    )
    expect(requestPath(upstashRedisLRangeTool, { key: 'list', start: 0, stop: -1 })).toBe(
      '/lrange/list/0/-1'
    )
    expect(requestPath(upstashRedisIncrbyTool, { key: 'n', increment: '-5' })).toBe('/incrby/n/-5')
  })
})
