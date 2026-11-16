import { describe, expect, it } from 'vitest'
import { ZoomBlock } from '@/blocks/blocks/zoom'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = ZoomBlock.tools.config?.params
  if (!mapper) throw new Error('Zoom block has no params mapper')
  return mapper(params, context)
}

/** What a tool call sends: the merged row params and model args with the mapper result over them. */
function toolCall(args: Record<string, unknown>, operation: string) {
  return { ...args, ...mapParams(args, { operation }) }
}

describe('Zoom tool calls', () => {
  it('sends a stored From/To Date range on List Recordings', () => {
    const sent = toolCall(
      { userId: 'me', fromDate: '2026-10-01', toDate: '2026-10-31' },
      'zoom_list_recordings'
    )
    expect(sent.from).toBe('2026-10-01')
    expect(sent.to).toBe('2026-10-31')
  })

  it("keeps the model's from/to when the row has no dates", () => {
    const sent = toolCall(
      { userId: 'me', from: '2026-10-01', to: '2026-10-15' },
      'zoom_list_recordings'
    )
    expect(sent.from).toBe('2026-10-01')
    expect(sent.to).toBe('2026-10-15')
  })

  it('sends a stored Permanently Delete action on Delete Recording', () => {
    const sent = toolCall({ meetingId: '123', deleteAction: 'delete' }, 'zoom_delete_recording')
    expect(sent.action).toBe('delete')
  })

  it("keeps the model's topic and list type", () => {
    expect(toolCall({ meetingId: '123', topic: 'Renamed' }, 'zoom_update_meeting').topic).toBe(
      'Renamed'
    )
    expect(toolCall({ userId: 'me', type: 'upcoming' }, 'zoom_list_meetings').type).toBe('upcoming')
  })

  it('accepts a numeric meeting ID from the model', () => {
    expect(toolCall({ meetingId: 85746065432 }, 'zoom_get_meeting').meetingId).toBe('85746065432')
  })

  it('coerces a stored meeting type and drops a stored "none" auto recording', () => {
    const sent = toolCall(
      { userId: 'me', topic: 'Standup', type: '8', autoRecording: 'none' },
      'zoom_create_meeting'
    )
    expect(sent.type).toBe(8)
    expect(sent.autoRecording).toBeUndefined()
  })

  it('does not turn auto recording off from a legacy row that stored "none" on Update Meeting', () => {
    const sent = toolCall({ meetingId: '123', autoRecording: 'none' }, 'zoom_update_meeting')
    expect(sent.autoRecording).toBeUndefined()
  })

  it("lets the model set auto recording from a new agent tool row's seed", () => {
    const field = ZoomBlock.subBlocks.find((subBlock) => subBlock.id === 'autoRecording')
    const seeded = field?.value?.({})
    const stored = seeded === undefined ? {} : { autoRecording: seeded }
    const sent = toolCall(
      { meetingId: '123', autoRecording: 'cloud', ...stored },
      'zoom_update_meeting'
    )
    expect(sent.autoRecording).toBe('cloud')
  })
})

describe('Zoom canvas update', () => {
  it('does not send a stale create topic', () => {
    const inputs = {
      operation: 'zoom_update_meeting',
      meetingId: '123',
      topic: 'Old create topic',
      topicUpdate: '',
    }
    expect({ ...inputs, ...mapParams(inputs) }.topic).not.toBe('Old create topic')
  })

  it('leaves the meeting type unchanged for a new Update Meeting block', () => {
    const typeField = ZoomBlock.subBlocks.find((subBlock) => subBlock.id === 'type')
    const seeded = typeField?.value?.({ operation: 'zoom_update_meeting' })
    const inputs = { operation: 'zoom_update_meeting', meetingId: '123', type: seeded }
    expect({ ...inputs, ...mapParams(inputs) }.type).toBeUndefined()
  })
})
