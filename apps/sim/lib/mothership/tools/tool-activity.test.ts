/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG } from '@/lib/mothership/generated/tool-catalog-v1'
import { isToolHiddenInUi } from '@/lib/mothership/tools/client/hidden-tools'
import { readToolActivity } from '@/lib/mothership/tools/tool-activity'
import { TOOL_ICONS } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'

const visibleTools = Object.values(TOOL_CATALOG).filter(
  (tool) => tool.route !== 'subagent' && !tool.hidden && !isToolHiddenInUi(tool.id)
)

describe('tool icon catalog coverage', () => {
  it('covers subagent icons under their dispatch and stream names', () => {
    for (const tool of Object.values(TOOL_CATALOG)) {
      if (tool.route !== 'subagent') continue
      expect(Object.hasOwn(TOOL_ICONS, tool.id), tool.id).toBe(true)
      if (tool.subagentId) {
        expect(Object.hasOwn(TOOL_ICONS, tool.subagentId), tool.subagentId).toBe(true)
      }
    }
  })

  it.each(visibleTools)('provides an icon for visible tool $id', (tool) => {
    expect(Object.hasOwn(TOOL_ICONS, tool.id), `${tool.id} icon`).toBe(true)
  })
})

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
  it('retains both labels and accepts historical completion-only or identity-only metadata', () => {
    expect(readToolActivity({ activity })).toEqual(activity)
    expect(
      readToolActivity({ activity: { id: 'inputs', completedTitle: activity.completedTitle } })
    ).toEqual({
      id: 'inputs',
      completedTitle: activity.completedTitle,
    })
    expect(readToolActivity({ activity: { id: 'inputs' } })).toEqual({ id: 'inputs' })
  })
  it('preserves escaped quotes and braces in streamed labels', () => {
    const escaped = {
      id: 'quoted',
      title: 'Checking "invoice" inputs',
      completedTitle: 'Checked {invoice} inputs',
    }
    expect(readToolActivity(undefined, JSON.stringify({ activity: escaped }))).toEqual(escaped)
  })
})
