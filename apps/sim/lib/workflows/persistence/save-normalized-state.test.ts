/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseWorkflowStateForPersistence } from '@/lib/workflows/persistence/save-normalized-state'

/**
 * A checkpoint blob as the revert route builds it: JSONB-derived blocks and edges, plus a
 * real `Date` for `deployedAt`.
 */
function checkpointState(overrides?: Record<string, unknown>) {
  return {
    blocks: {
      'block-1': {
        id: 'block-1',
        type: 'starter',
        name: 'Start',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    isDeployed: false,
    lastSaved: 1_754_000_000_000,
    ...overrides,
  }
}

describe('parseWorkflowStateForPersistence', () => {
  /**
   * The revert used to reach this schema by POSTing the blob over HTTP, so every value
   * arrived JSON-serialized. In-process the blob keeps its runtime types. Both forms must
   * parse identically, or a checkpoint that reverted before would start failing.
   */
  it('accepts a Date for deployedAt exactly as it accepted the serialized string', () => {
    const deployedAt = new Date('2026-01-02T03:04:05.678Z')

    const fromDate = parseWorkflowStateForPersistence(checkpointState({ deployedAt }))
    /**
     * Serialized and parsed as two steps, not `structuredClone`: the point is the
     * lossy JSON round trip that turns the `Date` into a string, which a
     * structured clone would preserve and so would not exercise the wire form.
     */
    const serialized = JSON.stringify(checkpointState({ deployedAt }))
    const overTheWire = parseWorkflowStateForPersistence(JSON.parse(serialized))

    expect(fromDate.success).toBe(true)
    expect(overTheWire.success).toBe(true)
    expect(fromDate.data?.deployedAt).toEqual(deployedAt)
    expect(overTheWire.data?.deployedAt).toEqual(fromDate.data?.deployedAt)
  })

  it('round-trips a JSONB-shaped blob without dropping blocks or edges', () => {
    const state = checkpointState()

    const parsed = parseWorkflowStateForPersistence(state)

    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data?.blocks ?? {})).toEqual(['block-1'])
    expect(parsed.data?.lastSaved).toBe(1_754_000_000_000)
  })

  it('accepts a null deployedAt, which the revert passes for a never-deployed checkpoint', () => {
    const parsed = parseWorkflowStateForPersistence(checkpointState({ deployedAt: null }))

    expect(parsed.success).toBe(true)
    expect(parsed.data?.deployedAt).toBeNull()
  })

  /** The validation the removed HTTP hop used to provide: a malformed blob must not be written. */
  it('rejects a blob whose blocks are malformed', () => {
    const parsed = parseWorkflowStateForPersistence({
      blocks: { 'block-1': { id: 'block-1' } },
      edges: [],
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects a blob missing blocks entirely', () => {
    expect(parseWorkflowStateForPersistence({ edges: [] }).success).toBe(false)
  })
})
