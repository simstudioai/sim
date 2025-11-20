import JSZip from 'jszip'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { sanitizeForExport } from './json-sanitizer'

const logger = createLogger('WorkflowImportExport')

export interface WorkflowExportData {
  workflow: {
    id: string
    name: string
    description?: string
    color?: string
    folderId?: string | null
  }
  state: WorkflowState
  variables?: Array<{
    id: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
    value: any
  }>
}

export interface FolderExportData {
  id: string
  name: string
  parentId: string | null
}

export interface WorkspaceExportStructure {
  workspace: {
    name: string
    exportedAt: string
  }
  workflows: WorkflowExportData[]
  folders: FolderExportData[]
}

function sanitizePathSegment(name: string): string {
  return name.replace(/[^a-z0-9-_]/gi, '-')
}

function buildFolderPath(
  folderId: string | null | undefined,
  foldersMap: Map<string, FolderExportData>
): string {
  if (!folderId) return ''

  const path: string[] = []
  let currentId: string | null = folderId

  while (currentId && foldersMap.has(currentId)) {
    const folder: FolderExportData = foldersMap.get(currentId)!
    path.unshift(sanitizePathSegment(folder.name))
    currentId = folder.parentId
  }

  return path.join('/')
}

export async function exportWorkspaceToZip(
  workspaceName: string,
  workflows: WorkflowExportData[],
  folders: FolderExportData[]
): Promise<Blob> {
  const zip = new JSZip()
  const foldersMap = new Map(folders.map((f) => [f.id, f]))

  const metadata = {
    workspace: {
      name: workspaceName,
      exportedAt: new Date().toISOString(),
    },
    folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
  }

  zip.file('_workspace.json', JSON.stringify(metadata, null, 2))

  for (const workflow of workflows) {
    try {
      const workflowState = {
        ...workflow.state,
        metadata: {
          name: workflow.workflow.name,
          description: workflow.workflow.description,
          color: workflow.workflow.color,
          exportedAt: new Date().toISOString(),
        },
        variables: workflow.variables,
      }

      const exportState = sanitizeForExport(workflowState)
      const sanitizedName = sanitizePathSegment(workflow.workflow.name)
      const filename = `${sanitizedName}-${workflow.workflow.id}.json`

      const folderPath = buildFolderPath(workflow.workflow.folderId, foldersMap)
      const fullPath = folderPath ? `${folderPath}/${filename}` : filename

      zip.file(fullPath, JSON.stringify(exportState, null, 2))
    } catch (error) {
      logger.error(`Failed to export workflow ${workflow.workflow.id}:`, error)
    }
  }

  return await zip.generateAsync({ type: 'blob' })
}

export interface ImportedWorkflow {
  content: string
  name: string
  folderPath: string[]
}

export interface WorkspaceImportMetadata {
  workspaceName: string
  exportedAt?: string
}

export async function extractWorkflowsFromZip(
  zipFile: File
): Promise<{ workflows: ImportedWorkflow[]; metadata?: WorkspaceImportMetadata }> {
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer())
  const workflows: ImportedWorkflow[] = []
  let metadata: WorkspaceImportMetadata | undefined

  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue

    if (path === '_workspace.json') {
      try {
        const content = await file.async('string')
        const parsed = JSON.parse(content)
        metadata = {
          workspaceName: parsed.workspace?.name || 'Imported Workspace',
          exportedAt: parsed.workspace?.exportedAt,
        }
      } catch (error) {
        logger.error('Failed to parse workspace metadata:', error)
      }
      continue
    }

    if (!path.toLowerCase().endsWith('.json')) continue

    try {
      const content = await file.async('string')
      const pathParts = path.split('/').filter((p) => p.length > 0)
      const filename = pathParts.pop() || path

      workflows.push({
        content,
        name: filename,
        folderPath: pathParts,
      })
    } catch (error) {
      logger.error(`Failed to extract ${path}:`, error)
    }
  }

  return { workflows, metadata }
}

export async function extractWorkflowsFromFiles(files: File[]): Promise<ImportedWorkflow[]> {
  const workflows: ImportedWorkflow[] = []

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.json')) continue

    try {
      const content = await file.text()
      workflows.push({
        content,
        name: file.name,
        folderPath: [],
      })
    } catch (error) {
      logger.error(`Failed to read ${file.name}:`, error)
    }
  }

  return workflows
}

export function extractWorkflowName(content: string, filename: string): string {
  try {
    const parsed = JSON.parse(content)

    if (parsed.state?.metadata?.name && typeof parsed.state.metadata.name === 'string') {
      return parsed.state.metadata.name.trim()
    }
  } catch {
    // JSON parse failed, fall through to filename
  }

  let name = filename.replace(/\.json$/i, '')

  name = name.replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '')

  name = name
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

  return name.trim() || 'Imported Workflow'
}
