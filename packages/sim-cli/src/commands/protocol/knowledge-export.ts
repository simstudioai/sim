import { basename, join } from 'node:path'
import type { Command } from 'commander'
import { clientFrom } from '../../context'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { resolvePath, SimApiError } from '../../http/client'
import { isTerminalSafeContentType, saveToFile, streamToStdout } from './files-get'
import { printProtocolResult } from './result'

interface KnowledgeExportOptions {
  outputFile?: string
  force?: boolean
  vectors: boolean
}

/**
 * The file name a `Content-Disposition: attachment; filename="..."` header
 * carries, or `null` when the header names none.
 *
 * Only the quoted form is read: the export route always emits it, with a name
 * the server has already stripped of quotes, slashes, and control characters.
 * Only the base name is kept so a directory in the header can never decide
 * where the archive lands on the caller's disk.
 */
export function attachmentFileName(contentDisposition: string | null): string | null {
  const match = contentDisposition ? /filename="([^"]*)"/.exec(contentDisposition) : null
  if (!match) return null
  const base = basename(match[1].trim())
  return base && base !== '.' && base !== '..' ? base : null
}

export function attachKnowledgeExport(knowledge: Command): void {
  knowledge
    .command('export')
    .argument('<knowledgeBaseId>', 'Knowledge base to export')
    .allowExcessArguments(false)
    .description('Export a knowledge base as a .simkb.zip bundle')
    .option(
      '-o, --output-file <path>',
      'Write the bundle to this path instead of the name the server suggests; pass - to stream it to stdout'
    )
    .option('--force', 'Overwrite --output-file if it already exists')
    .option(
      '--no-vectors',
      'Leave chunk vectors out of the bundle, so an import re-embeds every chunk'
    )
    .action(async (knowledgeBaseId: string, options: KnowledgeExportOptions, command: Command) => {
      const writesToStdout = options.outputFile === '-'
      if (writesToStdout && options.force) {
        throw new SimApiError('--force requires --output-file <path>', 0)
      }

      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()
      const operation = V2_OPERATIONS.exportKnowledgeBase
      const response = await client.requestRaw(resolvePath(operation.path, { knowledgeBaseId }), {
        method: operation.method,
        query: { workspaceId, vectors: options.vectors },
      })
      if (!response.body) {
        throw new SimApiError('Knowledge base export response was empty.', response.status)
      }

      if (writesToStdout) {
        const contentType = response.headers.get('content-type')
        if (process.stdout.isTTY && !isTerminalSafeContentType(contentType)) {
          await response.body.cancel()
          throw new SimApiError(
            `Refusing to write ${contentType ?? 'unknown content'} to an interactive terminal. Use --output-file <path> or pipe stdout.`,
            0
          )
        }

        await streamToStdout(response.body)
        return
      }

      const target =
        options.outputFile ??
        join(
          process.cwd(),
          attachmentFileName(response.headers.get('content-disposition')) ??
            `${knowledgeBaseId}.simkb.zip`
        )

      await saveToFile(response.body, target, Boolean(options.force))
      printProtocolResult(profile.output, {
        id: knowledgeBaseId,
        path: target,
        status: 'saved',
        vectors: options.vectors,
      })
    })
}
