import { createLogger } from '@sim/logger'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { executeInE2B, type SandboxFile } from '@/lib/execution/e2b'
import { CodeLanguage } from '@/lib/execution/languages'
import { getTableById, queryRows } from '@/lib/table/service'
import { getServePathPrefix } from '@/lib/uploads'
import {
  downloadWorkspaceFile,
  findWorkspaceFileRecord,
  getSandboxWorkspaceFilePath,
  getWorkspaceFile,
  listWorkspaceFiles,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('GenerateVisualizationTool')

interface VisualizationArgs {
  code: string
  inputTables?: string[]
  inputFiles?: string[]
  fileName?: string
  overwriteFileId?: string
}

interface VisualizationResult {
  success: boolean
  message: string
  fileId?: string
  fileName?: string
  downloadUrl?: string
}

function csvEscapeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

const TEXT_EXTENSIONS = new Set(['csv', 'json', 'txt', 'md', 'html', 'xml', 'tsv', 'yaml', 'yml'])
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_TOTAL_SIZE = 50 * 1024 * 1024

function validateGeneratedWorkspaceFileName(fileName: string): string | null {
  const trimmed = fileName.trim()
  if (!trimmed) return 'File name cannot be empty'
  if (trimmed.includes('/')) {
    return 'Workspace files use a flat namespace. Use a plain file name like "chart.png", not a path like "charts/chart.png".'
  }
  return null
}

async function collectSandboxFiles(
  workspaceId: string,
  inputFiles?: string[],
  inputTables?: string[],
  messageId?: string
): Promise<SandboxFile[]> {
  const reqLogger = logger.withMetadata({ messageId })
  const sandboxFiles: SandboxFile[] = []
  let totalSize = 0

  if (inputFiles?.length) {
    const allFiles = await listWorkspaceFiles(workspaceId)
    for (const fileRef of inputFiles) {
      const record = findWorkspaceFileRecord(allFiles, fileRef)
      if (!record) {
        reqLogger.warn('Sandbox input file not found', { fileRef })
        continue
      }
      const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
      if (!TEXT_EXTENSIONS.has(ext)) {
        reqLogger.warn('Skipping non-text sandbox input file', {
          fileId: record.id,
          fileName: record.name,
          ext,
        })
        continue
      }
      if (record.size > MAX_FILE_SIZE) {
        reqLogger.warn('Sandbox input file exceeds size limit', {
          fileId: record.id,
          fileName: record.name,
          size: record.size,
        })
        continue
      }
      if (totalSize + record.size > MAX_TOTAL_SIZE) {
        logger.warn('Sandbox input total size limit reached, skipping remaining files')
        break
      }
      const buffer = await downloadWorkspaceFile(record)
      totalSize += buffer.length
      const textContent = buffer.toString('utf-8')
      sandboxFiles.push({
        path: getSandboxWorkspaceFilePath(record),
        content: textContent,
      })
      sandboxFiles.push({
        path: `/home/user/${record.name}`,
        content: textContent,
      })
    }
  }

  if (inputTables?.length) {
    for (const tableId of inputTables) {
      const table = await getTableById(tableId)
      if (!table) {
        reqLogger.warn('Sandbox input table not found', { tableId })
        continue
      }
      const { rows } = await queryRows(tableId, workspaceId, { limit: 10000 }, 'sandbox-input')
      const schema = table.schema as { columns: Array<{ name: string; type?: string }> }
      const cols = schema.columns.map((c) => c.name)
      const typeComment = `# types: ${schema.columns.map((c) => `${c.name}=${c.type || 'string'}`).join(', ')}`
      const csvLines = [typeComment, cols.join(',')]
      for (const row of rows) {
        csvLines.push(
          cols.map((c) => csvEscapeValue((row.data as Record<string, unknown>)[c])).join(',')
        )
      }
      const csvContent = csvLines.join('\n')
      if (totalSize + csvContent.length > MAX_TOTAL_SIZE) {
        logger.warn('Sandbox input total size limit reached, skipping remaining tables')
        break
      }
      totalSize += csvContent.length
      sandboxFiles.push({ path: `/home/user/tables/${tableId}.csv`, content: csvContent })
    }
  }

  return sandboxFiles
}

export const generateVisualizationServerTool: BaseServerTool<
  VisualizationArgs,
  VisualizationResult
> = {
  name: 'generate_visualization',

  async execute(
    params: VisualizationArgs,
    context?: ServerToolContext
  ): Promise<VisualizationResult> {
    const reqLogger = logger.withMetadata({ messageId: context?.messageId })

    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    const { code } = params
    if (!code) {
      return { success: false, message: 'code is required' }
    }

    try {
      const sandboxFiles = await collectSandboxFiles(
        workspaceId,
        params.inputFiles,
        params.inputTables,
        context.messageId
      )

      const wrappedCode = [
        'import matplotlib',
        "matplotlib.use('Agg')",
        'import matplotlib.pyplot as plt',
        '',
        code,
        '',
        '# Auto-save if user did not explicitly call savefig',
        'import os as _os',
        "if not _os.path.exists('/home/user/output.png'):",
        '    if plt.get_fignums():',
        "        plt.savefig('/home/user/output.png', dpi=150, bbox_inches='tight')",
        '        plt.close()',
      ].join('\n')

      const result = await executeInE2B({
        code: wrappedCode,
        language: CodeLanguage.Python,
        timeoutMs: 60_000,
        sandboxFiles,
      })

      if (result.error) {
        return { success: false, message: `Python execution failed: ${result.error}` }
      }

      let imageBase64: string | undefined

      if (result.images?.length) {
        imageBase64 = result.images[0]
      }

      if (!imageBase64) {
        return {
          success: false,
          message: `Code ran but produced no image. Make sure your code creates a matplotlib figure and calls plt.savefig('/home/user/output.png'). Stdout: ${result.stdout?.slice(0, 500) || '(empty)'}`,
        }
      }

      const fileName = params.fileName || 'chart.png'
      const fileNameValidationError = validateGeneratedWorkspaceFileName(fileName)
      if (fileNameValidationError) {
        return { success: false, message: fileNameValidationError }
      }
      const imageBuffer = Buffer.from(imageBase64, 'base64')

      if (params.overwriteFileId) {
        const existing = await getWorkspaceFile(workspaceId, params.overwriteFileId)
        if (!existing) {
          return {
            success: false,
            message: `File not found for overwrite: ${params.overwriteFileId}`,
          }
        }
        assertServerToolNotAborted(context)
        const updated = await updateWorkspaceFileContent(
          workspaceId,
          params.overwriteFileId,
          context.userId,
          imageBuffer,
          'image/png'
        )
        reqLogger.info('Chart image overwritten', {
          fileId: updated.id,
          fileName: updated.name,
          size: imageBuffer.length,
        })
        const pathPrefix = getServePathPrefix()
        return {
          success: true,
          message: `Chart updated in "${updated.name}" (${imageBuffer.length} bytes)`,
          fileId: updated.id,
          fileName: updated.name,
          downloadUrl: `${pathPrefix}${encodeURIComponent(updated.key)}?context=workspace`,
        }
      }

      assertServerToolNotAborted(context)
      const uploaded = await uploadWorkspaceFile(
        workspaceId,
        context.userId,
        imageBuffer,
        fileName,
        'image/png'
      )

      reqLogger.info('Chart image saved', {
        fileId: uploaded.id,
        fileName: uploaded.name,
        size: imageBuffer.length,
      })

      return {
        success: true,
        message: `Chart saved as "${uploaded.name}" (${imageBuffer.length} bytes)`,
        fileId: uploaded.id,
        fileName: uploaded.name,
        downloadUrl: uploaded.url,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      reqLogger.error('Visualization generation failed', { error: msg })
      return { success: false, message: `Failed to generate visualization: ${msg}` }
    }
  },
}
