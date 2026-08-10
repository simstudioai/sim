/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MintlifyBlock } from '@/blocks/blocks/mintlify'

/**
 * The executor merges `tools.config.params` on top of the raw inputs, so every
 * assertion runs against the merged result rather than the transform's return
 * value alone.
 */
function resolveParams(inputs: Record<string, unknown>) {
  return { ...inputs, ...MintlifyBlock.tools.config.params!(inputs) }
}

describe('MintlifyBlock', () => {
  describe('tool selection', () => {
    it('maps every operation option to a registered tool ID', () => {
      const operationSubBlock = MintlifyBlock.subBlocks.find((block) => block.id === 'operation')
      const operations = operationSubBlock?.options as { id: string }[]

      expect(operations.length).toBeGreaterThan(0)
      for (const { id } of operations) {
        const toolId = MintlifyBlock.tools.config!.tool!({ operation: id })
        expect(MintlifyBlock.tools.access).toContain(toolId)
      }
    })

    it('exposes one operation option per accessible tool', () => {
      const operationSubBlock = MintlifyBlock.subBlocks.find((block) => block.id === 'operation')
      const operations = operationSubBlock?.options as { id: string }[]
      expect(operations).toHaveLength(MintlifyBlock.tools.access!.length)
    })
  })

  describe('operation scoping', () => {
    it('clears advanced values retained from another operation', () => {
      const result = resolveParams({
        operation: 'get_feedback',
        projectId: 'proj_1',
        // Retained from a prior Get Page Views selection, whose limit ceiling is 250.
        offset: '100',
        limit: '200',
      })

      expect(result.offset).toBeUndefined()
      expect(result.limit).toBe(200)
    })

    it('clears a retained search filter when an analytics operation runs', () => {
      const result = resolveParams({
        operation: 'get_views',
        projectId: 'proj_1',
        query: 'stale query',
        groups: '["internal"]',
        tag: 'api-reference',
      })

      expect(result.query).toBeUndefined()
      expect(result.groups).toBeUndefined()
      expect(result.tag).toBeUndefined()
    })

    it('leaves the model arguments untouched on the agent-tool path', () => {
      const agentArgs = { projectId: 'proj_1', limit: 25 }
      expect(resolveParams(agentArgs)).toEqual(agentArgs)
    })
  })

  describe('param aliasing', () => {
    it('forwards the prose-check path under the tool param name', () => {
      const result = resolveParams({
        operation: 'detect_ai_prose',
        projectId: 'proj_1',
        deslopPath: 'guides/quickstart.mdx',
        content: '# Quickstart',
      })

      expect(result.path).toBe('guides/quickstart.mdx')
    })

    it('forwards the page-content path under the tool param name', () => {
      const result = resolveParams({
        operation: 'get_page_content',
        domain: 'acme',
        pagePath: 'guides/quickstart',
      })

      expect(result.path).toBe('guides/quickstart')
    })

    it('forwards the feedback filters under their tool param names', () => {
      const result = resolveParams({
        operation: 'get_feedback',
        projectId: 'proj_1',
        feedbackSource: 'contextual',
        feedbackStatus: 'pending,resolved',
      })

      expect(result.source).toBe('contextual')
      expect(result.status).toBe('pending,resolved')
    })
  })

  describe('numeric coercion', () => {
    it('coerces numeric inputs delivered as strings', () => {
      const result = resolveParams({
        operation: 'search',
        domain: 'acme',
        query: 'custom domains',
        pageSize: '25',
        scoreThreshold: '0.4',
      })

      expect(result.pageSize).toBe(25)
      expect(result.scoreThreshold).toBe(0.4)
    })

    it('drops a numeric input that cannot be parsed', () => {
      const result = resolveParams({
        operation: 'get_views',
        projectId: 'proj_1',
        limit: 'not-a-number',
      })

      expect(result.limit).toBeUndefined()
    })

    it('drops empty optional values', () => {
      const result = resolveParams({
        operation: 'get_searches',
        projectId: 'proj_1',
        dateFrom: '',
        cursor: '',
      })

      expect(result.dateFrom).toBeUndefined()
      expect(result.cursor).toBeUndefined()
    })
  })
})
