/** @vitest-environment node */
import { INTEGRATION_METADATA } from '@sim/deployment-config/integration-metadata'
import { stripVersionSuffix } from '@sim/utils/string'
import { describe, expect, it, vi } from 'vitest'
import { getExposedIntegrationTools } from '@/lib/integrations/tool-catalog'
import type { ToolSchema } from '@/lib/mothership/chat/payload'
import { projectIntegrationCatalog } from '@/lib/mothership/integrations/application/catalog'

/** Registration assertions must exercise the executable registry, not the global empty mock. */
vi.unmock('@/tools/registry')
vi.mock('@/lib/mothership/chat/payload', () => ({ buildIntegrationToolSchemas: vi.fn() }))
vi.mock('@/lib/mothership/mcp-tools', () => ({ buildTaggedMcpToolSchemas: vi.fn() }))
vi.mock('@/lib/mcp/application/use-cases', () => ({ listMcpServersUseCase: { execute: vi.fn() } }))

const tools: ToolSchema[] = getExposedIntegrationTools().map((tool) => ({
  name: tool.toolId,
  service: tool.service,
  description: tool.config.description,
  input_schema: {},
}))
const input = { mode: 'agent' as const, mcpServerIds: [], limit: 0 }

describe('integration discovery identity registry', () => {
  it('preserves every existing callable service ID, including services outside the public catalog', () => {
    const services = new Set(tools.map((tool) => tool.service))
    expect(services.has('google_calendar')).toBe(true)
    for (const service of services) {
      const result = projectIntegrationCatalog(tools, { ...input, service })
      expect(result.operations.map((operation) => operation.toolId).sort()).toEqual(
        tools
          .filter((tool) => tool.service === service)
          .map((tool) => tool.name)
          .sort()
      )
    }
  })

  it('keeps generated integration names and slugs aligned with the real callable catalog', () => {
    const services = new Set(tools.map((tool) => tool.service))
    for (const integration of INTEGRATION_METADATA) {
      const service = stripVersionSuffix(integration.type)
      if (!services.has(service)) continue
      const canonical = projectIntegrationCatalog(tools, { ...input, service })
      for (const alias of [integration.type, integration.name, integration.slug]) {
        expect(
          projectIntegrationCatalog(tools, { ...input, service: alias }),
          `${integration.name}: ${alias} must discover the same operations as ${service}`
        ).toEqual(canonical)
      }
    }
  })
})
