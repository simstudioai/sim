import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { and, inArray, notInArray } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/mothership/tools/server/base-tool'

const logger = createLogger('FileTabs')

/** Row contexts that open as a file tab: workspace files and chat uploads. */
const FILE_TAB_CONTEXTS = ['workspace', 'mothership']

/**
 * The ids among `fileIds` whose rows must not open as a file tab: any context other than a
 * workspace file or chat upload belongs to another resource (a test's source, for one), which
 * opens as that resource instead.
 */
export async function findNonTabFileIds(fileIds: string[]): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set()
  const rows = await db
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(
      and(
        inArray(workspaceFiles.id, fileIds),
        notInArray(workspaceFiles.context, FILE_TAB_CONTEXTS)
      )
    )
  return new Set(rows.map((row) => row.id))
}

/**
 * Marks a file-editing tool's result `fileTab: false` when the file it touched is not a file tab,
 * so the browser, which promotes edited files to tabs from the result, leaves it alone.
 */
export function withFileTabFlag<TArgs, TResult extends { data?: Record<string, unknown> }>(
  tool: BaseServerTool<TArgs, TResult>
): BaseServerTool<TArgs, TResult> {
  return {
    ...tool,
    async execute(args, context) {
      const result = await tool.execute(args, context)
      const id = toStringOrNull(result.data?.id)
      if (id === null) return result
      let isTab: boolean
      try {
        isTab = !(await findNonTabFileIds([id])).has(id)
      } catch (error) {
        // The edit already saved, so a failed lookup opens no tab rather than failing it.
        logger.error('Could not check whether an edited file is a file tab', { id, error })
        isTab = false
      }
      return isTab ? result : { ...result, data: { ...result.data, fileTab: false } }
    },
  }
}
