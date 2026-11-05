import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import type { Scenario } from '@/platform/fixtures'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'

const RESEARCH_GRAPH = { id: 'eb7dbf79-55c6-4ec7-a5b5-15099e83c3d5', name: 'Research' }
const STRESS_GRAPH_NAMES = [
  'Customer interviews',
  'Release planning',
  'Product feedback',
  'Security review',
  'Implementation notes',
  'Competitive research',
  'Support investigations',
  'Quarterly planning',
  'Research interviews with customer operations teams across regional offices and partner organizations',
] as const

interface GraphsFixture {
  spaces: { id: string | null; name: string }[]
  activeSpaceId: string | null
}

export function createGraphsFixture(scenario: Scenario): GraphsFixture {
  const spaces: GraphsFixture['spaces'] = [{ id: null, name: 'Default' }]
  if (scenario !== 'empty') spaces.push(RESEARCH_GRAPH)
  if (scenario === 'stress') {
    spaces.push(...STRESS_GRAPH_NAMES.map((name) => ({ id: generateId(), name })))
  }
  return { spaces, activeSpaceId: scenario === 'stress' ? RESEARCH_GRAPH.id : null }
}

export async function knowledgeGraphsFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
) {
  const collection = `/api/organizations/${state.organizationId}/memory-spaces`
  const graphs = state.knowledgeGraphs
  if (path === collection && request.method === 'GET') return graphs
  if (path === collection && request.method === 'POST') {
    const body = toRecord(await request.json())
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 100 || name.toLowerCase() === 'default') {
      return Response.json(
        { error: 'Choose a name of 1–100 characters other than Default' },
        { status: 400 }
      )
    }
    const id = generateId()
    graphs.spaces.push({ id, name })
    graphs.activeSpaceId = id
    return { activeSpaceId: id }
  }
  if (path === `${collection}/active` && request.method === 'PUT') {
    const { spaceId } = toRecord(await request.json())
    const graph = graphs.spaces.find((space) => space.id === spaceId)
    if (!graph) return Response.json({ error: 'Knowledge graph not found' }, { status: 404 })
    graphs.activeSpaceId = graph.id
    return { activeSpaceId: graph.id }
  }
}
