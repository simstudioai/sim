/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { JiraBlock } from '@/blocks/blocks/jira'
import * as jiraTools from '@/tools/jira'
import type { ToolConfig } from '@/tools/types'

/**
 * Output names the block declares for its webhook trigger payload rather than
 * for a tool result. No Jira tool emits these, by design.
 */
const TRIGGER_ONLY_OUTPUTS = new Set([
  'event_type',
  'issue_id',
  'issue_key',
  'project_key',
  'project_name',
  'issue_type_name',
  'priority_name',
  'status_name',
  'assignee_name',
  'assignee_email',
  'reporter_name',
  'reporter_email',
  'comment_id',
  'comment_body',
  'worklog_id',
  'time_spent',
  'changelog',
  'sprint',
  'version',
  'jira',
  'user',
  'webhook',
])

const toolOutputNames = new Set<string>()
for (const tool of Object.values(jiraTools) as ToolConfig[]) {
  if (!tool?.id?.startsWith('jira_')) continue
  for (const name of Object.keys(tool.outputs ?? {})) toolOutputNames.add(name)
}

const declaredOutputs = Object.keys(JiraBlock.outputs ?? {})

describe('jira block outputs match what the tools actually emit', () => {
  it('reads a non-trivial set of tool outputs', () => {
    expect(toolOutputNames.size).toBeGreaterThan(20)
  })

  it('declares no phantom output that no Jira tool ever emits', () => {
    const phantoms = declaredOutputs.filter(
      (name) => !TRIGGER_ONLY_OUTPUTS.has(name) && !toolOutputNames.has(name)
    )
    expect(phantoms).toEqual([])
  })

  it.each(['body', 'toStatus', 'transitionName', 'success', 'statusName', 'assigneeName'])(
    'declares %s, which Jira tools emit',
    (name: string) => {
      expect(toolOutputNames.has(name)).toBe(true)
      expect(declaredOutputs).toContain(name)
    }
  )
})
