/**
 * @vitest-environment node
 *
 * Guards the Daytona sandbox-scoped tools against path traversal through
 * `sandboxId`, which is `visibility: 'user-or-llm'` and therefore reachable by
 * prompt injection.
 *
 * `encodeURIComponent` alone did not close this: `.` and `..` are unreserved,
 * so they survive encoding and the URL parser then strips them as dot segments.
 * `https://proxy.app.daytona.io/toolbox/../files/upload-v2` resolves to
 * `https://proxy.app.daytona.io/files/upload-v2` with the caller's Daytona
 * bearer token still attached. Assertions resolve through `new URL(...)` — the
 * same normalization `fetch` performs — instead of matching the raw template,
 * because string matching is exactly what let this through.
 */
import { describe, expect, it } from 'vitest'
import * as daytonaTools from '@/tools/daytona/index'
import { daytonaToolboxUrl, encodeSandboxId } from '@/tools/daytona/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const TOOLBOX_PREFIX = '/toolbox/'
const API_PREFIX = '/api/sandbox/'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * earlier `encodeURIComponent`-only fix looked correct while the hole was live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../files/upload-v2',
  '..%2f..%2ffiles',
  'sbx_abc/../../files',
  'sbx_abc?token=attacker',
  'sbx_abc#fragment',
  '\\..\\..',
] as const

const LEGITIMATE_IDS = [
  'sbx_abc123',
  '3f2a9c1e-7b64-4d80-9f11-2c6a5e8b0d43',
  'my-sandbox',
  'sandbox.v2',
  '..foo',
  'foo..',
] as const

const SAFE_ID = 'SAFEID'

/**
 * The slice of a tool this harness reads. `ToolConfig`'s param type sits in the
 * contravariant position of `request.url`, so no concrete member of the barrel's
 * union is assignable to a widened `ToolConfig<Record<string, unknown>, …>`. The
 * barrel is therefore seeded as `unknown` below and narrowed by {@link isDaytonaTool},
 * which is the single point where the type is established.
 */
type AnyTool = ToolConfig<Record<string, unknown>, ToolResponse>

function isDaytonaTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('daytona_')
  )
}

function buildParams(tool: AnyTool, sandboxId: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token', sandboxId }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey' || name === 'sandboxId') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = 'value'
    }
  }
  return params
}

function buildPath(tool: AnyTool, sandboxId: string): string {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, sandboxId))).pathname
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const SANDBOX_SCOPED_TOOLS = Object.values<unknown>(daytonaTools)
  .filter(isDaytonaTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildPath(tool, SAFE_ID).includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('daytona sandboxId traversal safety', () => {
  it('covers every sandbox-scoped Daytona tool', () => {
    expect(SANDBOX_SCOPED_TOOLS.length).toBeGreaterThanOrEqual(9)
  })

  describe.each(SANDBOX_SCOPED_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildPath(tool, SAFE_ID))

    it('stays under a sandbox-scoped prefix for a benign id', () => {
      const path = buildPath(tool, SAFE_ID)

      expect(path.startsWith(TOOLBOX_PREFIX) || path.startsWith(API_PREFIX)).toBe(true)
    })

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (sandboxId) => {
      let path: string
      try {
        path = buildPath(tool, sandboxId)
      } catch {
        return
      }

      expect(path.startsWith(TOOLBOX_PREFIX) || path.startsWith(API_PREFIX)).toBe(true)

      const actual = segmentsOf(path)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (sandboxId) => {
      const actual = segmentsOf(buildPath(tool, sandboxId))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? sandboxId : segment)
      })
    })
  })
})

describe('daytonaToolboxUrl', () => {
  it.each(['..', '.', '  ..  '])('rejects the dot segment %j', (sandboxId) => {
    expect(() => daytonaToolboxUrl(sandboxId, '/files/upload-v2')).toThrow(/Sandbox ID/)
  })

  it('rejects a traversal attempt that carries a path separator', () => {
    expect(() => daytonaToolboxUrl('sbx_abc/../../files', '/files/upload-v2')).toThrow(
      /Sandbox ID cannot contain a path separator/
    )
  })

  it('keeps a dot-bearing id that is not a dot segment inside /toolbox/', () => {
    const url = new URL(daytonaToolboxUrl('sbx..abc', '/files/upload-v2'))

    expect(url.origin).toBe('https://proxy.app.daytona.io')
    expect(url.pathname.startsWith(TOOLBOX_PREFIX)).toBe(true)
    expect(url.pathname).toBe('/toolbox/sbx..abc/files/upload-v2')
  })

  it('builds the upload path the API route relies on', () => {
    const url = new URL(daytonaToolboxUrl('sbx_abc123', '/files/upload-v2?path=%2Ftmp%2Fa.txt'))

    expect(url.pathname).toBe('/toolbox/sbx_abc123/files/upload-v2')
    expect(url.searchParams.get('path')).toBe('/tmp/a.txt')
  })
})

describe('encodeSandboxId', () => {
  it('rejects an empty id', () => {
    expect(() => encodeSandboxId('   ')).toThrow(/Sandbox ID/)
  })

  it.each(LEGITIMATE_IDS)('leaves %j untouched', (sandboxId) => {
    expect(encodeSandboxId(sandboxId)).toBe(sandboxId)
  })
})

/**
 * The lifecycle tools echo `sandboxId` back as the output id when the API
 * returns no body. That runs in `transformResponse`, so the sandbox has already
 * been started, stopped, or irreversibly deleted by the time it executes — a
 * `.trim()` on a non-string id would surface the successful call as an unnamed
 * `TypeError`. `sandboxId` is declared `type: 'string'` but arrives unvalidated,
 * and `safeUrlPathSegment` now accepts a numeric id, so a number reaches here.
 */
describe('the sandbox id echoed back by the lifecycle tools', () => {
  const lifecycleTools = [
    daytonaTools.daytonaStartSandboxTool,
    daytonaTools.daytonaStopSandboxTool,
    daytonaTools.daytonaDeleteSandboxTool,
  ] as AnyTool[]

  const emptyBody = () => new Response('', { status: 200 })

  it.each(lifecycleTools.map((tool) => [tool.id, tool] as const))(
    '%s reports a numeric sandboxId instead of throwing after the request went out',
    async (_id, tool) => {
      const result = await tool.transformResponse!(emptyBody(), {
        apiKey: 'k',
        sandboxId: 12345 as unknown as string,
      })

      expect(result.output.sandbox.id).toBe('12345')
    }
  )

  it.each(lifecycleTools.map((tool) => [tool.id, tool] as const))(
    '%s still trims a string sandboxId',
    async (_id, tool) => {
      const result = await tool.transformResponse!(emptyBody(), {
        apiKey: 'k',
        sandboxId: '  sbx_abc123  ',
      })

      expect(result.output.sandbox.id).toBe('sbx_abc123')
    }
  )
})
