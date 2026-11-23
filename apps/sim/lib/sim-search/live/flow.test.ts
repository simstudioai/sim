import { describe, expect, it } from 'vitest'
import { readFlow, searchFlow } from '@/lib/sim-search/live/flow'
import type { NativeClient, NativeSearchInput } from '@/lib/sim-search/live/types'

const ORIGIN = 'https://backend.branch.flowengineering.com'
const PROJECT_ID = 'c9fb5f5c-5b3b-44b7-b978-37ead6a707cf'
const ENTITY_ID = 'b2c74c54-a8cb-4b4a-96d9-5a386a7a5f25'
const reference = { id: ENTITY_ID, container: PROJECT_ID }
const entity = {
  id: ENTITY_ID,
  type: 'requirement',
  values: { name: 'Operating temperature', description: '<p>Operate below 85 C.</p>' },
  formulas: {},
  formulaTemplates: {},
  links: { inbound: [], outbound: [], crosslinks: [], inboundOrder: {} },
  updatedAt: '2026-10-01T12:00:00Z',
}
const input = {
  query: 'temperature',
  limit: 10,
  scopes: [],
  native: { provider: 'flow', query: 'temperature', project: PROJECT_ID },
} satisfies NativeSearchInput

function client(json: NativeClient['json']): NativeClient {
  return {
    json,
    text: async () => {
      throw new Error('Unexpected text request')
    },
    bytes: async () => {
      throw new Error('Unexpected binary request')
    },
  }
}

/** Failure modes: stale hits bypassing current reads, missing project scope, malformed entity states, and wrong entity identities. */
describe('Flow live entity boundary', () => {
  it.each([
    { location: 'search project', id: '.' },
    { location: 'search project', id: '..' },
    { location: 'read project', id: '.' },
    { location: 'read project', id: '..' },
    { location: 'read entity', id: '.' },
    { location: 'read entity', id: '..' },
  ])(
    'rejects a dot segment in $location ($id) before requesting a different endpoint',
    async ({ location, id }) => {
      const requests: string[] = []
      const api = client(async (path) => {
        requests.push(path)
        return []
      })
      await expect(
        location === 'search project'
          ? searchFlow(
              api,
              { ...input, native: { ...input.native, provider: 'flow', project: id } },
              ORIGIN
            )
          : readFlow(
              api,
              { ...reference, ...(location === 'read project' ? { container: id } : { id }) },
              ORIGIN
            )
      ).rejects.toThrow('path traversal')
      expect(requests).toEqual([])
    }
  )

  it('reads current project-bound content rather than returning stale search previews', async () => {
    const api = client(async (path) => {
      if (path === `/project/${PROJECT_ID}/entities/search`) {
        return [
          {
            entity_id: ENTITY_ID,
            name: 'Old title',
            human_id: 'REQ-1',
            entity_type: 'requirement',
            legacy_human_id: null,
          },
        ]
      }
      if (path === `/project/${PROJECT_ID}/entities/${ENTITY_ID}`) return [entity]
      throw new Error('Unknown Flow endpoint')
    })
    const page = await searchFlow(api, input, ORIGIN)
    expect(page.documents).toHaveLength(1)
    expect(page.documents[0]?.title).toBe('REQ-1 · Operating temperature')
    expect(page.documents[0]?.content).toContain('Operate below 85 C.')
    expect(page.documents[0]?.modifiedAt).toBe(entity.updatedAt)
    expect(page.documents[0]?.url).toBe(`${ORIGIN}/project/${PROJECT_ID}/entities/${ENTITY_ID}`)
    const document = await readFlow(api, reference, ORIGIN)
    expect(document.title).toBe('Operating temperature')
  })

  it.each([
    { name: 'null', value: null },
    { name: 'array', value: [] },
    { name: 'missing', value: undefined },
  ])(
    'rejects an entity with malformed fields $name instead of an empty document',
    async ({ value: values }) => {
      await expect(
        readFlow(
          client(async () => [{ ...entity, values }]),
          reference,
          ORIGIN
        )
      ).rejects.toThrow('no longer available')
    }
  )

  it.each([
    ['revoked access', []],
    ['deleted entity', [{ ...entity, deleted: true }]],
    ['changed identity', [{ ...entity, id: 'another-item' }]],
  ])('does not return an old reference after %s', async (_reason, rows) => {
    await expect(
      readFlow(
        client(async () => rows),
        reference,
        ORIGIN
      )
    ).rejects.toThrow('no longer available')
  })

  it('marks current access omissions as partial instead of returning the indexed hit', async () => {
    const api = client(async (path) => {
      if (path.endsWith('/entities/search')) {
        return [
          {
            entity_id: ENTITY_ID,
            name: 'Stale sensitive title',
            human_id: 'REQ-1',
            entity_type: 'requirement',
            legacy_human_id: null,
          },
        ]
      }
      return []
    })
    expect(await searchFlow(api, input, ORIGIN)).toMatchObject({ documents: [], partial: true })
  })

  it('rejects references without their originating project', async () => {
    await expect(
      readFlow(
        client(async () => [entity]),
        { id: ENTITY_ID },
        ORIGIN
      )
    ).rejects.toThrow('Invalid Flow item reference')
  })
})
