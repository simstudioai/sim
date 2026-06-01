import { customTools, db, mcpServers, mothershipSettings, skill } from '@sim/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type {
  MothershipCustomToolRef,
  MothershipMcpToolRef,
  MothershipSettings,
  MothershipSkillRef,
} from '@/lib/api/contracts/mothership-settings'

type MothershipSettingsInput = {
  workspaceId: string
  mcpTools: MothershipMcpToolRef[]
  customTools: MothershipCustomToolRef[]
  skills: MothershipSkillRef[]
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = getKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function defaultSettings(workspaceId: string): MothershipSettings {
  return {
    workspaceId,
    mcpTools: [],
    customTools: [],
    skills: [],
  }
}

function mapRowToSettings(row: typeof mothershipSettings.$inferSelect): MothershipSettings {
  return {
    workspaceId: row.workspaceId,
    mcpTools: Array.isArray(row.mcpToolRefs) ? (row.mcpToolRefs as MothershipMcpToolRef[]) : [],
    customTools: Array.isArray(row.customToolRefs)
      ? (row.customToolRefs as MothershipCustomToolRef[])
      : [],
    skills: Array.isArray(row.skillRefs) ? (row.skillRefs as MothershipSkillRef[]) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getMothershipSettings(workspaceId: string): Promise<MothershipSettings> {
  const [row] = await db
    .select()
    .from(mothershipSettings)
    .where(eq(mothershipSettings.workspaceId, workspaceId))
    .limit(1)

  return row ? mapRowToSettings(row) : defaultSettings(workspaceId)
}

export async function updateMothershipSettings(
  input: MothershipSettingsInput
): Promise<MothershipSettings> {
  const mcpTools = await filterMcpToolRefs(input.workspaceId, input.mcpTools)
  const customToolRefs = await filterCustomToolRefs(input.workspaceId, input.customTools)
  const skillRefs = await filterSkillRefs(input.workspaceId, input.skills)
  const now = new Date()

  const [row] = await db
    .insert(mothershipSettings)
    .values({
      workspaceId: input.workspaceId,
      mcpToolRefs: mcpTools,
      customToolRefs,
      skillRefs,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: mothershipSettings.workspaceId,
      set: {
        mcpToolRefs: mcpTools,
        customToolRefs,
        skillRefs,
        updatedAt: now,
      },
    })
    .returning()

  return mapRowToSettings(row)
}

async function filterMcpToolRefs(
  workspaceId: string,
  refs: MothershipMcpToolRef[]
): Promise<MothershipMcpToolRef[]> {
  const deduped = dedupeBy(refs, (ref) => `${ref.serverId}:${ref.toolName}`)
  const serverIds = [...new Set(deduped.map((ref) => ref.serverId))]
  if (serverIds.length === 0) return []

  const serverRows = await db
    .select({ id: mcpServers.id, name: mcpServers.name })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.workspaceId, workspaceId),
        inArray(mcpServers.id, serverIds),
        isNull(mcpServers.deletedAt)
      )
    )

  const serversById = new Map(serverRows.map((server) => [server.id, server.name]))
  return deduped
    .filter((ref) => serversById.has(ref.serverId))
    .map((ref) => ({
      serverId: ref.serverId,
      serverName: serversById.get(ref.serverId) ?? ref.serverName,
      toolName: ref.toolName,
      title: ref.title ?? ref.toolName,
    }))
}

async function filterCustomToolRefs(
  workspaceId: string,
  refs: MothershipCustomToolRef[]
): Promise<MothershipCustomToolRef[]> {
  const deduped = dedupeBy(refs, (ref) => ref.customToolId)
  const toolIds = deduped.map((ref) => ref.customToolId)
  if (toolIds.length === 0) return []

  const toolRows = await db
    .select({ id: customTools.id, title: customTools.title })
    .from(customTools)
    .where(and(eq(customTools.workspaceId, workspaceId), inArray(customTools.id, toolIds)))

  const titlesById = new Map(toolRows.map((tool) => [tool.id, tool.title]))
  return deduped
    .filter((ref) => titlesById.has(ref.customToolId))
    .map((ref) => ({
      customToolId: ref.customToolId,
      title: titlesById.get(ref.customToolId) ?? ref.title,
    }))
}

async function filterSkillRefs(
  workspaceId: string,
  refs: MothershipSkillRef[]
): Promise<MothershipSkillRef[]> {
  const deduped = dedupeBy(refs, (ref) => ref.skillId)
  const skillIds = deduped.map((ref) => ref.skillId)
  if (skillIds.length === 0) return []

  const skillRows = await db
    .select({ id: skill.id, name: skill.name })
    .from(skill)
    .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, skillIds)))

  const namesById = new Map(skillRows.map((row) => [row.id, row.name]))
  return deduped
    .filter((ref) => namesById.has(ref.skillId))
    .map((ref) => ({
      skillId: ref.skillId,
      name: namesById.get(ref.skillId) ?? ref.name,
    }))
}
