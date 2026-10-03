import { describe, expect, it } from 'vitest'
import { SIM_EVENT_PAYLOAD_FIELDS } from '@/lib/workspace-events/constants'
import { simWorkspaceEventTrigger } from '@/triggers/sim'

describe('sim workspace event outputs', () => {
  it('trigger outputs align key-for-key with the shared payload field constants', () => {
    const outputKeys = Object.keys(simWorkspaceEventTrigger.outputs).sort()
    const payloadKeys = Object.keys(SIM_EVENT_PAYLOAD_FIELDS).sort()
    expect(outputKeys).toEqual(payloadKeys)
  })
})
