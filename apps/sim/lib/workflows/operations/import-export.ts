import { createLogger } from '@sim/logger'
import JSZip from 'jszip'
import {
  type ExportWorkflowState,
  sanitizeForExport,
} from '@/lib/workflows/sanitization/json-sanitizer'
import { regenerateWorkflowIds } from '@/stores/workflows/utils'
import type { Variable, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowImportExport')

export interface WorkflowExportData {
  workflow: {
    id: string
    name: string
    description?: string
    color?: string
    folderId?: string | null
    sortOrder?: number
  }
  state: WorkflowState
  variables?: Record<string, Variable>
}

export interface FolderExportData {
  id: string
  name: string
  parentId: string | null
  sortOrder?: number
}

export interface WorkspaceExportStructure {
  workspace: {
    name: string
    exportedAt: string
  }
  workflows: WorkflowExportData[]
  folders: FolderExportData[]
}

/**
 * Sanitizes a string for use as a path segment in a ZIP file.
 */
export function sanitizePathSegment(name: string): string {
  return name.replace(/[^a-z0-9-_]/gi, '-')
}

/**
 * Downloads a file to the user's device.
 */
export function downloadFile(
  content: Blob | string,
  filename: string,
  mimeType = 'application/json'
): void {
  try {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (error) {
    logger.error('Failed to download file:', error)
  }
}

/**
 * Fetches a workflow's state and variables for export.
 * Returns null if the workflow cannot be fetched.
 */
export async function fetchWorkflowForExport(
  workflowId: string,
  workflowMeta: { name: string; description?: string; color?: string; folderId?: string | null }
): Promise<WorkflowExportData | null> {
  try {
    const workflowResponse = await fetch(`/api/workflows/${workflowId}`)
    if (!workflowResponse.ok) {
      logger.error(`Failed to fetch workflow ${workflowId}`)
      return null
    }

    const { data: workflowData } = await workflowResponse.json()
    if (!workflowData?.state) {
      logger.warn(`Workflow ${workflowId} has no state`)
      return null
    }

    const variablesResponse = await fetch(`/api/workflows/${workflowId}/variables`)
    let workflowVariables: Record<string, Variable> | undefined
    if (variablesResponse.ok) {
      const variablesData = await variablesResponse.json()
      workflowVariables = variablesData?.data
    }

    return {
      workflow: {
        id: workflowId,
        name: workflowMeta.name,
        description: workflowMeta.description,
        color: workflowMeta.color,
        folderId: workflowMeta.folderId,
      },
      state: workflowData.state,
      variables: workflowVariables,
    }
  } catch (error) {
    logger.error(`Failed to fetch workflow ${workflowId} for export:`, error)
    return null
  }
}

/**
 * Exports a single workflow to a JSON string.
 */
export function exportWorkflowToJson(workflowData: WorkflowExportData): string {
  const workflowState = {
    ...workflowData.state,
    metadata: {
      name: workflowData.workflow.name,
      description: workflowData.workflow.description,
      color: workflowData.workflow.color,
      exportedAt: new Date().toISOString(),
    },
    variables: workflowData.variables,
  }

  const exportState = sanitizeForExport(workflowState)
  return JSON.stringify(exportState, null, 2)
}

/**
 * Exports multiple workflows to a ZIP file.
 * Workflows are placed at the root level (no folder structure).
 */
export async function exportWorkflowsToZip(workflows: WorkflowExportData[]): Promise<Blob> {
  const zip = new JSZip()
  const seenFilenames = new Set<string>()

  for (const workflow of workflows) {
    const jsonContent = exportWorkflowToJson(workflow)
    const baseName = sanitizePathSegment(workflow.workflow.name)
    let filename = `${baseName}.json`
    let counter = 1

    while (seenFilenames.has(filename.toLowerCase())) {
      filename = `${baseName}-${counter}.json`
      counter++
    }
    seenFilenames.add(filename.toLowerCase())
    zip.file(filename, jsonContent)
  }

  return await zip.generateAsync({ type: 'blob' })
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
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      sortOrder: f.sortOrder,
    })),
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
          sortOrder: workflow.workflow.sortOrder,
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

/**
 * Export a folder and its contents to a ZIP file.
 * Preserves nested folder structure with paths relative to the exported folder.
 *
 * @param folderName - Name of the folder being exported
 * @param workflows - Workflows to export (should be filtered to only those in the folder subtree)
 * @param folders - Subfolders within the exported folder (parentId should be null for direct children)
 */
export async function exportFolderToZip(
  folderName: string,
  workflows: WorkflowExportData[],
  folders: FolderExportData[]
): Promise<Blob> {
  const zip = new JSZip()
  const foldersMap = new Map(folders.map((f) => [f.id, f]))

  const metadata = {
    folder: {
      name: folderName,
      exportedAt: new Date().toISOString(),
    },
    folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
  }

  zip.file('_folder.json', JSON.stringify(metadata, null, 2))

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
  sortOrder?: number
}

export interface WorkspaceImportMetadata {
  workspaceName: string
  exportedAt?: string
  folders?: Array<{
    id: string
    name: string
    parentId: string | null
    sortOrder?: number
  }>
}

function extractSortOrder(content: string): number | undefined {
  try {
    const parsed = JSON.parse(content)
    return parsed.state?.metadata?.sortOrder ?? parsed.metadata?.sortOrder
  } catch {
    return undefined
  }
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
          folders: parsed.folders,
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
        sortOrder: extractSortOrder(content),
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
        sortOrder: extractSortOrder(content),
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

/**
 * Normalize subblock values by converting empty strings to null and filtering out invalid subblocks.
 * This provides backwards compatibility for workflows exported before the null sanitization fix,
 * preventing Zod validation errors like "Expected array, received string".
 *
 * Also filters out malformed subBlocks that may have been created by bugs in previous exports:
 * - SubBlocks with key "undefined" (caused by assigning to undefined key)
 * - SubBlocks missing required fields like `id`
 * - SubBlocks with `type: "unknown"` (indicates malformed data)
 */
function normalizeSubblockValues(blocks: Record<string, any>): Record<string, any> {
  const normalizedBlocks: Record<string, any> = {}

  Object.entries(blocks).forEach(([blockId, block]) => {
    const normalizedBlock = { ...block }

    if (block.subBlocks) {
      const normalizedSubBlocks: Record<string, any> = {}

      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
        // Skip subBlocks with invalid keys (literal "undefined" string)
        if (subBlockId === 'undefined') {
          logger.warn(`Skipping malformed subBlock with key "undefined" in block ${blockId}`)
          return
        }

        // Skip subBlocks that are null or not objects
        if (!subBlock || typeof subBlock !== 'object') {
          logger.warn(`Skipping invalid subBlock ${subBlockId} in block ${blockId}: not an object`)
          return
        }

        // Skip subBlocks with type "unknown" (malformed data)
        if (subBlock.type === 'unknown') {
          logger.warn(
            `Skipping malformed subBlock ${subBlockId} in block ${blockId}: type is "unknown"`
          )
          return
        }

        // Skip subBlocks missing required id field
        if (!subBlock.id) {
          logger.warn(
            `Skipping malformed subBlock ${subBlockId} in block ${blockId}: missing id field`
          )
          return
        }

        const normalizedSubBlock = { ...subBlock }

        // Convert empty strings to null for consistency
        if (normalizedSubBlock.value === '') {
          normalizedSubBlock.value = null
        }

        normalizedSubBlocks[subBlockId] = normalizedSubBlock
      })

      normalizedBlock.subBlocks = normalizedSubBlocks
    }

    normalizedBlocks[blockId] = normalizedBlock
  })

  return normalizedBlocks
}

/**
 * Parse and validate workflow JSON content for import.
 * Handles both new format (with version/exportedAt/state) and legacy format (blocks/edges at root).
 */
export function parseWorkflowJson(
  jsonContent: string,
  regenerateIdsFlag = true
): {
  data: WorkflowState | null
  errors: string[]
} {
  const errors: string[] = []

  try {
    // Parse JSON content
    let data: any
    try {
      data = JSON.parse(jsonContent)
    } catch (parseError) {
      errors.push(
        `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Parse error'}`
      )
      return { data: null, errors }
    }

    // Validate top-level structure
    if (!data || typeof data !== 'object') {
      errors.push('Invalid JSON: Root must be an object')
      return { data: null, errors }
    }

    // Handle new export format (version/exportedAt/state) or old format (blocks/edges at root)
    let workflowData: any
    if (data.version && data.state) {
      // New format with versioning
      logger.info('Parsing workflow JSON with version', {
        version: data.version,
        exportedAt: data.exportedAt,
      })
      workflowData = data.state
    } else {
      // Old format - blocks/edges at root level
      logger.info('Parsing legacy workflow JSON format')
      workflowData = data
    }

    // Validate required fields
    if (!workflowData.blocks || typeof workflowData.blocks !== 'object') {
      errors.push('Missing or invalid field: blocks')
      return { data: null, errors }
    }

    if (!Array.isArray(workflowData.edges)) {
      errors.push('Missing or invalid field: edges (must be an array)')
      return { data: null, errors }
    }

    // Validate blocks have required fields
    Object.entries(workflowData.blocks).forEach(([blockId, block]: [string, any]) => {
      if (!block || typeof block !== 'object') {
        errors.push(`Invalid block ${blockId}: must be an object`)
        return
      }

      if (!block.id) {
        errors.push(`Block ${blockId} missing required field: id`)
      }
      if (!block.type) {
        errors.push(`Block ${blockId} missing required field: type`)
      }
      if (
        !block.position ||
        typeof block.position.x !== 'number' ||
        typeof block.position.y !== 'number'
      ) {
        errors.push(`Block ${blockId} missing or invalid position`)
      }
    })

    // Validate edges have required fields
    workflowData.edges.forEach((edge: any, index: number) => {
      if (!edge || typeof edge !== 'object') {
        errors.push(`Invalid edge at index ${index}: must be an object`)
        return
      }

      if (!edge.id) {
        errors.push(`Edge at index ${index} missing required field: id`)
      }
      if (!edge.source) {
        errors.push(`Edge at index ${index} missing required field: source`)
      }
      if (!edge.target) {
        errors.push(`Edge at index ${index} missing required field: target`)
      }
    })

    // If there are errors, return null
    if (errors.length > 0) {
      return { data: null, errors }
    }

    // Normalize non-string subblock values (convert empty strings to null)
    // This handles exported workflows that may have empty strings for non-string types
    const normalizedBlocks = normalizeSubblockValues(workflowData.blocks || {})

    // Construct the workflow state with defaults
    let workflowState: WorkflowState = {
      blocks: normalizedBlocks,
      edges: workflowData.edges || [],
      loops: workflowData.loops || {},
      parallels: workflowData.parallels || {},
      metadata: workflowData.metadata,
      variables: Array.isArray(workflowData.variables) ? workflowData.variables : undefined,
    }

    if (regenerateIdsFlag) {
      const { idMap: _, ...regeneratedState } = regenerateWorkflowIds(workflowState, {
        clearTriggerRuntimeValues: true,
      })
      workflowState = {
        ...regeneratedState,
        metadata: workflowState.metadata,
        variables: workflowState.variables,
      }
      logger.info('Regenerated IDs for imported workflow to avoid conflicts')
    }

    logger.info('Successfully parsed workflow JSON', {
      blocksCount: Object.keys(workflowState.blocks).length,
      edgesCount: workflowState.edges.length,
      loopsCount: Object.keys(workflowState.loops).length,
      parallelsCount: Object.keys(workflowState.parallels).length,
    })

    return { data: workflowState, errors: [] }
  } catch (error) {
    logger.error('Failed to parse workflow JSON:', error)
    errors.push(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return { data: null, errors }
  }
}

export interface GenerateWorkflowJsonOptions {
  workflowId: string
  name?: string
  description?: string
  variables?: Array<{
    id: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'
    value: any
  }>
}

/**
 * Generate JSON export for a workflow.
 * This is a pure function that takes the workflow state and metadata and returns the JSON string.
 */
export function generateWorkflowJson(
  workflowState: WorkflowState,
  options: GenerateWorkflowJsonOptions
): string {
  const variablesRecord: Record<string, Variable> | undefined = options.variables?.reduce(
    (acc, v) => {
      acc[v.id] = {
        id: v.id,
        name: v.name,
        type: v.type,
        value: v.value,
      }
      return acc
    },
    {} as Record<string, Variable>
  )

  const stateWithMetadata: WorkflowState = {
    ...workflowState,
    metadata: {
      name: options.name,
      description: options.description,
      exportedAt: new Date().toISOString(),
    },
    variables: variablesRecord,
  }

  const exportState: ExportWorkflowState = sanitizeForExport(stateWithMetadata)
  const jsonString = JSON.stringify(exportState, null, 2)

  logger.info('Workflow JSON generated successfully', {
    version: exportState.version,
    exportedAt: exportState.exportedAt,
    blocksCount: Object.keys(exportState.state.blocks).length,
    edgesCount: exportState.state.edges.length,
    jsonLength: jsonString.length,
  })

  return jsonString
}
