/**
 * @vitest-environment node
 *
 * Guards the Attio attribute tools' `target` path parameter against values
 * outside the spec's enum.
 *
 * `/v2/{target}/{identifier}/attributes` declares `target` as
 * `{"type":"string","enum":["objects","lists"]}` (Attio OpenAPI,
 * https://api.attio.com/openapi/api). The Attio block constrains it with a
 * dropdown, but the block is only one caller: `target` is
 * `visibility: 'user-or-llm'`, so an LLM invoking the tool directly never sees
 * the dropdown and can steer the request at a different `/v2/<collection>`
 * route entirely, with the caller's Attio bearer token attached.
 *
 * `safeUrlPathSegment` is not a substitute here. It rejects separators and dot
 * segments, so it stops traversal — but `workspace_members`, `webhooks`, and
 * `tasks` are all single, separator-free segments that sail straight through
 * it. Only enumerating the two legal values closes this.
 *
 * Assertions resolve the built URL through `new URL(...)` and compare the
 * leading path segments, not template text.
 */
import { describe, expect, it } from 'vitest'
import { attioCreateAttributeTool } from '@/tools/attio/create_attribute'
import { attioGetAttributeTool } from '@/tools/attio/get_attribute'
import { attioListAttributesTool } from '@/tools/attio/list_attributes'
import { attioUpdateAttributeTool } from '@/tools/attio/update_attribute'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const TARGETED_TOOLS: ReadonlyArray<readonly [string, AnyTool]> = [
  ['attio_create_attribute', attioCreateAttributeTool as AnyTool],
  ['attio_get_attribute', attioGetAttributeTool as AnyTool],
  ['attio_update_attribute', attioUpdateAttributeTool as AnyTool],
  ['attio_list_attributes', attioListAttributesTool as AnyTool],
]

/** Every value the spec's enum permits. */
const LEGAL_TARGETS = ['objects', 'lists'] as const

/**
 * Single-segment Attio collections that are NOT in the enum. Each is a real
 * `/v2/<collection>` route, so reaching one is a genuine re-aim rather than a
 * 404, and none contains a separator — they are invisible to a traversal
 * guard.
 */
const OFF_ENUM_TARGETS = ['workspace_members', 'webhooks', 'tasks', 'notes', 'comments'] as const

function buildUrl(tool: AnyTool, target: unknown): URL {
  const build = tool.request.url as (params: Record<string, unknown>) => string
  return new URL(
    build({
      accessToken: 'TOKEN',
      target,
      identifier: 'people',
      attribute: 'name',
      title: 'Name',
      type: 'text',
    })
  )
}

describe('attio attribute tools constrain target to the spec enum', () => {
  for (const [id, tool] of TARGETED_TOOLS) {
    describe(id, () => {
      for (const target of OFF_ENUM_TARGETS) {
        it(`rejects target "${target}"`, () => {
          expect(() => buildUrl(tool, target)).toThrow(/target/)
        })
      }

      it('rejects a target that differs only by case', () => {
        expect(() => buildUrl(tool, 'Objects')).toThrow(/target/)
      })

      for (const target of LEGAL_TARGETS) {
        it(`still builds the documented route for target "${target}"`, () => {
          const url = buildUrl(tool, target)
          const segments = url.pathname.split('/').filter(Boolean)
          expect(segments.slice(0, 3)).toEqual(['v2', target, 'people'])
          expect(segments[3]).toBe('attributes')
        })
      }
    })
  }
})
