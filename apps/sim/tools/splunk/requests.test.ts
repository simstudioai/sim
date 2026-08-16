/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createSearchJobTool } from '@/tools/splunk/create_search_job'
import { getFiredAlertsTool } from '@/tools/splunk/get_fired_alerts'
import { listSavedSearchesTool } from '@/tools/splunk/list_saved_searches'

const BASE = { baseUrl: 'https://splunk.example.com:8089' }

function buildBody(tool: typeof createSearchJobTool, params: Record<string, unknown>): string {
  const body = tool.request.body
  if (!body) throw new Error('tool has no body builder')
  return body(params as Parameters<NonNullable<typeof tool.request.body>>[0]) as unknown as string
}

describe('createSearchJobTool exec_mode', () => {
  it('defaults to normal when the caller leaves it empty', () => {
    expect(buildBody(createSearchJobTool, { ...BASE, search: 'index=main' })).toContain(
      'exec_mode=normal'
    )
  })

  it('rejects oneshot instead of returning a job with no search ID', () => {
    expect(() =>
      buildBody(createSearchJobTool, { ...BASE, search: 'index=main', execMode: 'oneshot' })
    ).toThrow(/cannot use exec_mode=oneshot/)
  })

  it('rejects an execution mode Splunk does not define', () => {
    expect(() =>
      buildBody(createSearchJobTool, { ...BASE, search: 'index=main', execMode: 'turbo' })
    ).toThrow(/Invalid Splunk execution mode/)
  })
})

describe('listSavedSearchesTool', () => {
  it('limits the response with f, which the reference prescribes for this endpoint', () => {
    const url = listSavedSearchesTool.request.url({ ...BASE } as never)
    expect(url).toContain('f=search')
    expect(url).toContain('f=cron_schedule')
  })
})

describe('getFiredAlertsTool', () => {
  it('sends no pagination to an endpoint documented as taking no request parameters', () => {
    const url = getFiredAlertsTool.request.url({ ...BASE, name: 'Errors' } as never)
    expect(url).toBe(
      'https://splunk.example.com:8089/services/alerts/fired_alerts/Errors?output_mode=json'
    )
    expect(url).not.toContain('count=')
    expect(url).not.toContain('offset=')
  })
})
