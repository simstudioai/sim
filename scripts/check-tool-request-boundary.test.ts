import { describe, expect, test } from 'bun:test'
import { findToolRequestBoundaryViolations } from './check-tool-request-boundary'

describe('tool request boundary audit', () => {
  test('rejects direct and aliased ToolConfig request execution', () => {
    const violations = findToolRequestBoundaryViolations(`
      const direct = mistralParserTool.request.body(params)
      const computed = tool.request['headers'](params)
      const typedRequest = (customTool as ToolConfig).request
      const typed = typedRequest[\`method\`](params)
      const optional = tool.request?.url
      const requestConfig = customTool.request
      const url = requestConfig.url
      const { body } = requestConfig
    `)

    expect(violations.map((violation) => violation.expression)).toEqual([
      'mistralParserTool.request.body',
      "tool.request['headers']",
      'typedRequest[\`method\`]',
      'tool.request?.url',
      'requestConfig.url',
      'body',
    ])
  })

  test('allows declarations and ordinary request objects', () => {
    expect(
      findToolRequestBoundaryViolations(`
        const tool = { request: { url: '/api/tool', headers: () => ({}) } }
        const request = options.request
        request.headers.get('authorization')
        incomingRequest.headers.get('authorization')
      `)
    ).toEqual([])
  })
})
