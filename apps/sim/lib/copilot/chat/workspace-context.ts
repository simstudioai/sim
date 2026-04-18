import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  mcpServers,
  userTableDefinitions,
  userTableRows,
  workflow,
  workflowFolder,
  workflowSchedule,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import { toError } from '@/lib/core/utils/helpers'
import { getAccessibleOAuthCredentials } from '@/lib/credentials/environment'
import { listWorkspaceFiles } from '@/lib/uploads/contexts/workspace'
import { listCustomTools } from '@/lib/workflows/custom-tools/operations'
import { listSkills } from '@/lib/workflows/skills/operations'
import {
  assertActiveWorkspaceAccess,
  getUsersWithPermissions,
  getWorkspaceWithOwner,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceContext')

const PROVIDER_SERVICES: Record<string, string[]> = {
  google: ['Gmail', 'Sheets', 'Calendar', 'Drive'],
  'google-service-account': ['Gmail', 'Sheets', 'Calendar', 'Drive'],
  slack: ['Slack'],
  github: ['GitHub'],
  microsoft: ['Outlook', 'OneDrive'],
  linear: ['Linear'],
  notion: ['Notion'],
  stripe: ['Stripe'],
  airtable: ['Airtable'],
  jira: ['Jira'],
  confluence: ['Confluence'],
}

export interface WorkspaceMdData {
  workspace: { id: string; name: string; ownerId: string } | null
  members: Array<{ name: string; email: string; permissionType: string }>
  workflows: Array<{
    id: string
    name: string
    description?: string | null
    isDeployed: boolean
    lastRunAt?: Date | null
    folderPath?: string | null
  }>
  knowledgeBases: Array<{
    id: string
    name: string
    description?: string | null
    connectorTypes?: string[]
  }>
  tables: Array<{ id: string; name: string; description?: string | null; rowCount: number }>
  files: Array<{ id: string; name: string; type: string; size: number }>
  oauthIntegrations: Array<{ providerId: string }>
  envVariables: string[]
  tasks?: Array<{ id: string; title: string; updatedAt: Date }>
  customTools?: Array<{ id: string; name: string }>
  mcpServers?: Array<{ id: string; name: string; url?: string | null; enabled: boolean }>
  skills?: Array<{ id: string; name: string; description: string }>
  jobs?: Array<{
    id: string
    title: string | null
    prompt: string
    cronExpression: string | null
    status: string
    lifecycle: string
    sourceTaskName: string | null
  }>
}

function normalizeFolderPathForVfs(folderPath?: string | null): string | null {
  if (!folderPath) return null
  const segments = folderPath
    .split('/')
    .map((segment) => normalizeVfsSegment(segment))
    .filter(Boolean)
  return segments.length > 0 ? segments.join('/') : null
}

function buildWorkflowStatePath(workflowName: string, folderPath?: string | null): string {
  const normalizedFolderPath = normalizeFolderPathForVfs(folderPath)
  const normalizedWorkflowName = normalizeVfsSegment(workflowName)
  return normalizedFolderPath
    ? `workflows/${normalizedFolderPath}/${normalizedWorkflowName}/state.json`
    : `workflows/${normalizedWorkflowName}/state.json`
}

/**
 * Pure formatting: build WORKSPACE.md content from pre-fetched data.
 * No DB access — callers are responsible for providing the data.
 */
export function buildWorkspaceMd(data: WorkspaceMdData): string {
  const sections: string[] = []

  if (data.workspace) {
    sections.push(
      `## Workspace\n- **Name**: ${data.workspace.name}\n- **ID**: ${data.workspace.id}\n- **Owner**: ${data.workspace.ownerId}`
    )
  }

  if (data.members.length > 0) {
    const lines = data.members.map((m) => {
      const display = m.name ? `${m.name} (${m.email})` : m.email
      return `- ${display} — ${m.permissionType}`
    })
    sections.push(`## Members\n${lines.join('\n')}`)
  }

  if (data.workflows.length > 0) {
    const rootWorkflows: typeof data.workflows = []
    const folderWorkflows = new Map<string, typeof data.workflows>()

    for (const wf of data.workflows) {
      if (wf.folderPath) {
        const existing = folderWorkflows.get(wf.folderPath) ?? []
        existing.push(wf)
        folderWorkflows.set(wf.folderPath, existing)
      } else {
        rootWorkflows.push(wf)
      }
    }

    const formatWf = (wf: (typeof data.workflows)[0], indent: string) => {
      const parts = [`${indent}- **${wf.name}** (${wf.id})`]
      if (wf.description) parts.push(`${indent}  ${wf.description}`)
      const flags: string[] = []
      if (wf.isDeployed) flags.push('deployed')
      if (wf.lastRunAt) flags.push(`last run: ${wf.lastRunAt.toISOString().split('T')[0]}`)
      if (flags.length > 0) parts[0] += ` — ${flags.join(', ')}`
      if (wf.folderPath) {
        parts.push(
          `${indent}  VFS state path: \`${buildWorkflowStatePath(wf.name, wf.folderPath)}\``
        )
      }
      return parts.join('\n')
    }

    const lines: string[] = []
    if (data.workflows.some((workflow) => workflow.folderPath)) {
      lines.push(
        'Use the canonical VFS state path shown under nested workflows. Do not infer nested workflow paths from the leaf workflow name alone.'
      )
    }
    for (const wf of rootWorkflows) {
      lines.push(formatWf(wf, ''))
    }
    const sortedFolders = [...folderWorkflows.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    for (const [folder, wfs] of sortedFolders) {
      lines.push(`- 📁 **${folder}/**`)
      for (const wf of wfs) {
        lines.push(formatWf(wf, '  '))
      }
    }
    sections.push(`## Workflows (${data.workflows.length})\n${lines.join('\n')}`)
  } else {
    sections.push('## Workflows (0)\n(none)')
  }

  if (data.knowledgeBases.length > 0) {
    const lines = data.knowledgeBases.map((kb) => {
      let line = `- **${kb.name}** (${kb.id})`
      if (kb.description) line += ` — ${kb.description}`
      if (kb.connectorTypes && kb.connectorTypes.length > 0) {
        line += ` | connectors: ${kb.connectorTypes.join(', ')}`
      }
      return line
    })
    sections.push(`## Knowledge Bases (${data.knowledgeBases.length})\n${lines.join('\n')}`)
  } else {
    sections.push('## Knowledge Bases (0)\n(none)')
  }

  if (data.tables.length > 0) {
    const lines = data.tables.map((t) => {
      let line = `- **${t.name}** (${t.id}) — ${t.rowCount} rows`
      if (t.description) line += `, ${t.description}`
      return line
    })
    sections.push(`## Tables (${data.tables.length})\n${lines.join('\n')}`)
  } else {
    sections.push('## Tables (0)\n(none)')
  }

  if (data.files.length > 0) {
    const lines = data.files.map(
      (f) => `- **${f.name}** (${f.id}) — ${f.type}, ${formatSize(f.size)}`
    )
    sections.push(`## Files (${data.files.length})\n${lines.join('\n')}`)
  } else {
    sections.push('## Files (0)\n(none)')
  }

  if (data.oauthIntegrations.length > 0) {
    const providers = [...new Set(data.oauthIntegrations.map((c) => c.providerId))]
    const lines = providers.map((p) => {
      const services = PROVIDER_SERVICES[p]
      return services ? `- ${p} (${services.join(', ')})` : `- ${p}`
    })
    sections.push(`## Connected Integrations\n${lines.join('\n')}`)
  } else {
    sections.push('## Connected Integrations\n(none)')
  }

  if (data.envVariables.length > 0) {
    const lines = data.envVariables.map((v) => `- ${v}`)
    sections.push(`## Environment Variables (${data.envVariables.length})\n${lines.join('\n')}`)
  }

  if (data.customTools && data.customTools.length > 0) {
    const lines = data.customTools.map((t) => `- **${t.name}** (${t.id})`)
    sections.push(`## Custom Tools (${data.customTools.length})\n${lines.join('\n')}`)
  }

  if (data.mcpServers && data.mcpServers.length > 0) {
    const lines = data.mcpServers.map((s) => {
      const status = s.enabled ? 'enabled' : 'disabled'
      return `- **${s.name}** (${s.id}) — ${status}${s.url ? `, ${s.url}` : ''}`
    })
    sections.push(`## MCP Servers (${data.mcpServers.length})\n${lines.join('\n')}`)
  }

  if (data.skills && data.skills.length > 0) {
    const lines = data.skills.map((s) => `- **${s.name}** (${s.id}) — ${s.description}`)
    sections.push(`## Skills (${data.skills.length})\n${lines.join('\n')}`)
  }

  if (data.jobs && data.jobs.length > 0) {
    const lines = data.jobs.map((j) => {
      const displayName = j.title || j.id
      let line = `- **${displayName}** (${j.id}) — ${j.status}`
      if (j.lifecycle !== 'persistent') line += ` [${j.lifecycle}]`
      if (j.cronExpression) line += `, cron: ${j.cronExpression}`
      if (j.sourceTaskName) line += `, task: ${j.sourceTaskName}`
      const promptPreview = j.prompt.length > 80 ? `${j.prompt.slice(0, 77)}...` : j.prompt
      line += `\n  ${promptPreview}`
      return line
    })
    sections.push(`## Jobs (${data.jobs.length})\n${lines.join('\n')}`)
  }

  return sections.join('\n\n')
}

/**
 * Generate WORKSPACE.md content from actual database state.
 * Auto-injected into the system prompt and served as a top-level VFS file.
 * The LLM never writes it directly.
 */
export async function generateWorkspaceContext(
  workspaceId: string,
  userId: string
): Promise<string> {
  try {
    await assertActiveWorkspaceAccess(workspaceId, userId)
    const wsRow = await getWorkspaceWithOwner(workspaceId)
    if (!wsRow) {
      return '## Workspace\n(unavailable)'
    }

    const [
      members,
      workflows,
      folderRows,
      kbs,
      tables,
      files,
      credentials,
      customTools,
      mcpServerRows,
      skillRows,
      jobRows,
    ] = await Promise.all([
      getUsersWithPermissions(workspaceId),

      db
        .select({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          isDeployed: workflow.isDeployed,
          lastRunAt: workflow.lastRunAt,
          folderId: workflow.folderId,
        })
        .from(workflow)
        .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt))),

      db
        .select({
          id: workflowFolder.id,
          name: workflowFolder.name,
          parentId: workflowFolder.parentId,
        })
        .from(workflowFolder)
        .where(and(eq(workflowFolder.workspaceId, workspaceId), isNull(workflowFolder.archivedAt))),

      db
        .select({
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          description: knowledgeBase.description,
        })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt))),

      db
        .select({
          id: userTableDefinitions.id,
          name: userTableDefinitions.name,
          description: userTableDefinitions.description,
        })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, workspaceId),
            isNull(userTableDefinitions.archivedAt)
          )
        ),

      listWorkspaceFiles(workspaceId),

      getAccessibleOAuthCredentials(workspaceId, userId),

      listCustomTools({ userId, workspaceId }),

      db
        .select({
          id: mcpServers.id,
          name: mcpServers.name,
          url: mcpServers.url,
          enabled: mcpServers.enabled,
        })
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt))),

      listSkills({ workspaceId }),

      db
        .select({
          id: workflowSchedule.id,
          jobTitle: workflowSchedule.jobTitle,
          prompt: workflowSchedule.prompt,
          cronExpression: workflowSchedule.cronExpression,
          status: workflowSchedule.status,
          lifecycle: workflowSchedule.lifecycle,
          sourceTaskName: workflowSchedule.sourceTaskName,
        })
        .from(workflowSchedule)
        .where(
          and(
            eq(workflowSchedule.sourceWorkspaceId, workspaceId),
            eq(workflowSchedule.sourceType, 'job'),
            isNull(workflowSchedule.archivedAt)
          )
        ),
    ])

    const rowCounts =
      tables.length > 0
        ? await Promise.all(
            tables.map(async (t) => {
              const [row] = await db
                .select({ count: count() })
                .from(userTableRows)
                .where(eq(userTableRows.tableId, t.id))
              return row?.count ?? 0
            })
          )
        : []

    const kbIds = kbs.map((kb) => kb.id)
    const connectorRows =
      kbIds.length > 0
        ? await db
            .select({
              knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
              connectorType: knowledgeConnector.connectorType,
            })
            .from(knowledgeConnector)
            .where(
              and(
                inArray(knowledgeConnector.knowledgeBaseId, kbIds),
                isNull(knowledgeConnector.archivedAt),
                isNull(knowledgeConnector.deletedAt)
              )
            )
        : []
    const connectorTypesByKb = new Map<string, string[]>()
    for (const row of connectorRows) {
      const types = connectorTypesByKb.get(row.knowledgeBaseId) ?? []
      if (!types.includes(row.connectorType)) {
        types.push(row.connectorType)
      }
      connectorTypesByKb.set(row.knowledgeBaseId, types)
    }

    const folderPathMap = new Map<string, string>()
    const folderById = new Map(folderRows.map((f) => [f.id, f]))
    function resolveFolderPath(id: string): string {
      const cached = folderPathMap.get(id)
      if (cached !== undefined) return cached
      const folder = folderById.get(id)
      if (!folder) return id
      const parentPath = folder.parentId ? resolveFolderPath(folder.parentId) : ''
      const normalizedName = normalizeVfsSegment(folder.name)
      const path = parentPath ? `${parentPath}/${normalizedName}` : normalizedName
      folderPathMap.set(id, path)
      return path
    }

    return buildWorkspaceMd({
      workspace: wsRow,
      members,
      workflows: workflows.map((wf) => ({
        ...wf,
        folderPath: wf.folderId ? resolveFolderPath(wf.folderId) : null,
      })),
      knowledgeBases: kbs.map((kb) => ({
        ...kb,
        connectorTypes: connectorTypesByKb.get(kb.id),
      })),
      tables: tables.map((t, i) => ({ ...t, rowCount: rowCounts[i] ?? 0 })),
      files: files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size })),
      oauthIntegrations: credentials.map((c) => ({ providerId: c.providerId })),
      envVariables: [],
      customTools: customTools.map((t) => ({ id: t.id, name: t.title })),
      mcpServers: mcpServerRows,
      skills: skillRows.map((s) => ({ id: s.id, name: s.name, description: s.description })),
      jobs: jobRows
        .filter((j) => j.status !== 'completed')
        .map((j) => ({
          id: j.id,
          title: j.jobTitle,
          prompt: j.prompt || '',
          cronExpression: j.cronExpression,
          status: j.status,
          lifecycle: j.lifecycle,
          sourceTaskName: j.sourceTaskName,
        })),
    })
  } catch (err) {
    logger.error('Failed to generate workspace context', {
      workspaceId,
      error: toError(err).message,
    })
    return '## Workspace\n(unavailable)\n\n## Workflows\n(unavailable)\n\n## Knowledge Bases\n(unavailable)\n\n## Tables\n(unavailable)\n\n## Files\n(unavailable)\n\n## Connected Integrations\n(unavailable)'
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
