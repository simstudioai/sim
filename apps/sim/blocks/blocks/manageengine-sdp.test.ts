import { describe, expect, it } from 'vitest'
import { ManageEngineSdpBlock } from '@/blocks/blocks/manageengine-sdp'
import { buildSdpChangeEntity } from '@/tools/manageengine_sdp/entity-builders'

type Params = Record<string, unknown>

const mapParams = (params: Params): Params =>
  ManageEngineSdpBlock.tools.config?.params?.(params as never) as Params

describe('ManageEngine SDP cross-operation scoping', () => {
  it("never sends another module's record id", () => {
    // Every id field populated, as they would be after switching operations.
    const stale = {
      requestId: 'r1',
      problemId: 'p1',
      changeId: 'c1',
      assetId: 'a1',
      solutionId: 's1',
    }
    const mapped = mapParams({ operation: 'get_request', ...stale })
    expect(mapped.requestId).toBe('r1')
    expect(mapped.problemId).toBeUndefined()
    expect(mapped.changeId).toBeUndefined()
    expect(mapped.assetId).toBeUndefined()
    expect(mapped.solutionId).toBeUndefined()
  })

  it("routes each module's title into the shared `title` param and clears the rest", () => {
    const titles = { problemTitle: 'P', changeTitle: 'C', solutionTitle: 'S' }
    expect(mapParams({ operation: 'create_problem', ...titles }).title).toBe('P')
    expect(mapParams({ operation: 'create_change', ...titles }).title).toBe('C')
    expect(mapParams({ operation: 'create_solution', ...titles }).title).toBe('S')
    // A request write uses `subject`, so `title` must not leak into it.
    expect(
      mapParams({ operation: 'create_request', subject: 'R', ...titles }).title
    ).toBeUndefined()
  })

  it('does not carry a stale request status onto a change write', () => {
    const mapped = mapParams({
      operation: 'create_change',
      status: 'Resolved',
      changeStatus: 'Open',
    })
    expect(mapped.status).toBe('Open')
  })
})

/**
 * Regression: a switch cannot distinguish "untouched" from "explicitly off", so
 * using one on an edit operation silently overwrites server state the user never
 * intended to change. ServiceDesk Plus documents no default for either flag, so
 * the create side still sends its value explicitly.
 */
describe('ManageEngine SDP edit-safe booleans', () => {
  it('omits `emergency` when an update leaves the tri-state unchanged', () => {
    const mapped = mapParams({
      operation: 'update_change',
      changeId: '99',
      scheduledStartTime: '2026-09-10T09:00:00.000Z',
      updateEmergency: '',
    })
    expect(mapped.emergency).toBeUndefined()
    expect(buildSdpChangeEntity({ accessToken: 't', ...mapped } as never)).not.toHaveProperty(
      'emergency'
    )
  })

  it('sends `emergency` on an update only when explicitly chosen', () => {
    expect(
      mapParams({ operation: 'update_change', changeId: '99', updateEmergency: 'true' }).emergency
    ).toBe(true)
    expect(
      mapParams({ operation: 'update_change', changeId: '99', updateEmergency: 'false' }).emergency
    ).toBe(false)
  })
})
