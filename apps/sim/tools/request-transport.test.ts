import { describe, expect, it } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { tools } from '@/tools/registry'
import { prepareToolRequest } from '@/tools/request-transport'
import type { ToolConfig } from '@/tools/types'

vi.unmock('@/tools/registry')

const privateProvenanceTools = Object.entries(tools).filter(
  ([, tool]) => tool.request.modelInput?.mode === 'private-provenance'
)

describe('private-provenance tool registry invariant', () => {
  it('covers at least one registered tool', () => {
    expect(privateProvenanceTools.length).toBeGreaterThan(0)
  })

  it.each(privateProvenanceTools)(
    '%s is internal and receives the private provenance header and body envelope',
    (registryId, tool) => {
      const url = typeof tool.request.url === 'function' ? tool.request.url({}) : tool.request.url

      expect(url, `${registryId} must use an authenticated internal route`).toMatch(/^\/api\//)
      expect(
        tool.request.body,
        `${registryId} must have a JSON body for its private provenance envelope`
      ).toBeTypeOf('function')

      const transportProbe: ToolConfig = {
        ...tool,
        request: {
          ...tool.request,
          url,
          method: 'POST',
          headers: () => ({ 'Content-Type': 'application/json' }),
          body: () => ({ probe: true }),
          modelInput: {
            mode: 'private-provenance',
            inputPaths: () => [],
          },
        },
      }
      const prepared = prepareToolRequest(transportProbe, {}, new ResolvedSecretTraceRegistry())
      const body = JSON.parse(prepared.body ?? '{}') as Record<string, unknown>

      expect(prepared.headers.get(PRIVATE_MODEL_INPUT_PROVENANCE_HEADER)).toBe(
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
      expect(body[RESOLVED_SECRET_PROVENANCE_FIELD]).toEqual({
        version: 1,
        complete: true,
        entries: [],
      })
    }
  )
})
