import { describe, expect, it } from 'vitest'
import { readToolActivity } from '@/lib/mothership/tools/tool-activity'

describe('activity argument streaming', () => {
  const activity = {
    id: 'inputs',
    title: 'Checking {invoice} inputs',
    completedTitle: 'Checked {invoice} inputs',
  }
  const input = JSON.stringify({ activity, args: ['workflows', 'get'] })
  it('waits for a complete activity object but not the rest of the tool arguments', () => {
    const end = input.indexOf('},"args"') + 1
    for (let index = 0; index < end; index++)
      expect(readToolActivity(undefined, input.slice(0, index))).toBeUndefined()
    expect(readToolActivity(undefined, input.slice(0, end))).toEqual(activity)
    expect(readToolActivity({ activity })).toEqual(activity)
  })
  it('ignores nested business arguments and quoted content named activity', () => {
    expect(readToolActivity(undefined, JSON.stringify({ arguments: { activity } }))).toBeUndefined()
    expect(
      readToolActivity(undefined, JSON.stringify({ code: JSON.stringify({ activity }) }))
    ).toBeUndefined()
    expect(
      readToolActivity(undefined, JSON.stringify({ arguments: { activity }, activity }))
    ).toEqual(activity)
  })
  it('does not mistake an unrelated tool title or malformed activity for an intent', () => {
    expect(readToolActivity({ title: 'Invoice API' })).toBeUndefined()
    expect(readToolActivity({ activity: { title: 'Checking' } })).toBeUndefined()
    expect(readToolActivity({ activity })).toEqual(activity)
    expect(readToolActivity(undefined, '{"activity":{"title":"Checking",oops}')).toBeUndefined()
  })
})
