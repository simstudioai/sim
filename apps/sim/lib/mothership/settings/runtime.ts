import { customTools, db, skill, user, settings as userSettings } from '@sim/db'
import { and, eq, inArray } from 'drizzle-orm'
import type { ToolSchema } from '@/lib/copilot/chat/payload'
import { createMcpToolId } from '@/lib/mcp/utils'
import { AGENT } from '@/executor/constants'
import { getMothershipSettings } from './operations'

interface BuildMothershipToolsParams {
  workspaceId: string
  userId: string
}

interface MothershipToolRuntimePayload {
  tools: ToolSchema[]
  catalogContext?: string
}

function isObjectSchema(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { type: 'object', properties: {} }
}

function customToolParameters(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  const fn = (schema as { function?: { parameters?: unknown } }).function
  return isObjectSchema(fn?.parameters)
}

function customToolDescription(schema: unknown, fallback: string): string {
  if (!schema || typeof schema !== 'object') return fallback
  const description = (schema as { function?: { description?: unknown } }).function?.description
  return typeof description === 'string' && description.trim() ? description : fallback
}

async function isEffectiveSuperUser(userId: string): Promise<boolean> {
  if (!userId) return false

  const [row] = await db
    .select({
      role: user.role,
      superUserModeEnabled: userSettings.superUserModeEnabled,
    })
    .from(user)
    .leftJoin(userSettings, eq(userSettings.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1)

  return row?.role === 'admin' && (row.superUserModeEnabled ?? false)
}

export async function buildMothershipToolsForRequest({
  workspaceId,
  userId,
}: BuildMothershipToolsParams): Promise<MothershipToolRuntimePayload> {
  if (!(await isEffectiveSuperUser(userId))) {
    return { tools: [] }
  }

  const settings = await getMothershipSettings(workspaceId)
  const tools: ToolSchema[] = []
  const catalogLines: string[] = []

  if (settings.mcpTools.length > 0) {
    const selectedKeys = new Set(
      settings.mcpTools.map((tool) => `${tool.serverId}:${tool.toolName}`)
    )
    const { mcpService } = await import('@/lib/mcp/service')
    const discoveredTools = await mcpService.discoverTools(userId, workspaceId)
    for (const tool of discoveredTools) {
      if (!selectedKeys.has(`${tool.serverId}:${tool.name}`)) continue
      const catalogName = `${tool.serverName} / ${tool.name}`
      tools.push({
        name: createMcpToolId(tool.serverId, tool.name),
        description: tool.description || `MCP tool: ${tool.name} (${tool.serverName})`,
        input_schema: { ...tool.inputSchema },
        defer_loading: true,
        params: {
          mothershipToolKind: 'mcp',
          mothershipToolName: catalogName,
          mothershipToolTitle: tool.name,
        },
      })
      catalogLines.push(`- MCP: ${catalogName} (load with type "mcp" and name "${catalogName}")`)
    }
  }

  if (settings.customTools.length > 0) {
    const customToolIds = settings.customTools.map((tool) => tool.customToolId)
    const rows = await db
      .select()
      .from(customTools)
      .where(and(eq(customTools.workspaceId, workspaceId), inArray(customTools.id, customToolIds)))

    for (const tool of rows) {
      tools.push({
        name: `${AGENT.CUSTOM_TOOL_PREFIX}${tool.id}`,
        description: customToolDescription(tool.schema, tool.title),
        input_schema: customToolParameters(tool.schema),
        defer_loading: true,
        params: {
          mothershipToolKind: 'custom_tool',
          mothershipToolName: tool.title,
          mothershipToolTitle: tool.title,
        },
      })
      catalogLines.push(
        `- Custom tool: ${tool.title} (load with type "custom_tool" and name "${tool.title}")`
      )
    }
  }

  if (settings.skills.length > 0) {
    const skillIds = settings.skills.map((s) => s.skillId)
    const rows = await db
      .select({ id: skill.id, name: skill.name, description: skill.description })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, skillIds)))

    for (const s of rows) {
      tools.push({
        name: `load_skill_${s.id}`,
        description: `Load the "${s.name}" skill to get specialized instructions. ${s.description}`,
        input_schema: { type: 'object', properties: {} },
        defer_loading: true,
        params: {
          mothershipToolKind: 'skill',
          mothershipToolName: s.name,
          mothershipToolTitle: s.name,
        },
      })
      catalogLines.push(
        `- Skill: ${s.name} - ${s.description} (load with type "skill" and name "${s.name}")`
      )
    }
  }

  return {
    tools,
    catalogContext:
      catalogLines.length > 0
        ? [
            '## Mothership Tool Catalog',
            'The following workspace tools are available on request. Use `load_custom_tool` to load one before calling it.',
            ...catalogLines,
          ].join('\n')
        : undefined,
  }
}
