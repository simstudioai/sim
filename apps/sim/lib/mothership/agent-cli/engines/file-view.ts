import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { PDFDocument } from 'pdf-lib'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type AgentCliEngine, agentCliFail } from '@/lib/mothership/agent-cli/types'
import { ObservationMediaType } from '@/lib/mothership/generated/observations'
import { readWorkspaceFileArtifact } from '@/lib/workspace-files/application/read-workspace-file-artifact'

const logger = createLogger('FileView')
const MAX_OBSERVATION_BYTES = 8 * 1024 * 1024

/** Visual observations use canonical authorized bytes, never model-provided fetch URLs. */
export const fileViewCommand: AgentCliEngine = {
  async execute(positionals, runtime, flags) {
    const reference = positionals[0]
    if (!reference) return agentCliFail('files view requires a workspace file reference.')
    if (!runtime.principal)
      return agentCliFail('Workspace authentication is unavailable. Retry the read.')
    try {
      const { file, buffer, contentType } = await readWorkspaceFileArtifact.execute({
        principal: runtime.principal,
        input: { workspaceId: runtime.workspaceId, reference, maxBytes: MAX_OBSERVATION_BYTES },
      })
      const mediaType = ObservationMediaType.safeParse(contentType.split(';')[0]?.trim())
      if (!mediaType.success) {
        return agentCliFail(
          'Visual inspection supports PNG, JPEG, WebP, GIF and PDF. Render other documents to PDF or page images first.'
        )
      }
      let bytes = buffer
      let pages: { first: number; last: number; total: number } | undefined
      if (mediaType.data === 'application/pdf') {
        const pdf = await PDFDocument.load(buffer)
        const total = pdf.getPageCount()
        const range =
          typeof flags.pages === 'string' ? /^(\d+)(?:-(\d+))?$/.exec(flags.pages) : null
        const first = range ? Number(range[1]) : 1
        const last = range ? Number(range[2] ?? range[1]) : total
        if (
          (flags.pages !== undefined && !range) ||
          first < 1 ||
          last < first ||
          last > total ||
          last - first + 1 > 20
        ) {
          return agentCliFail(
            `PDF has ${total} pages. Use --pages <first>-<last> to inspect at most 20 pages per call (page numbers start at 1).`
          )
        }
        pages = { first, last, total }
        if (first !== 1 || last !== total) {
          const selected = await PDFDocument.create()
          for (const page of await selected.copyPages(
            pdf,
            Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i)
          ))
            selected.addPage(page)
          bytes = Buffer.from(await selected.save())
        }
      } else if (flags.pages !== undefined) {
        return agentCliFail('--pages applies only to PDFs.')
      }
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({
          id: file.id,
          name: file.name,
          mediaType: mediaType.data,
          bytes: bytes.length,
          ...(pages ? { pages } : {}),
        }),
        observations: [
          {
            name: file.name,
            resourceId: file.id,
            mediaType: mediaType.data,
            data: bytes.toString('base64'),
            ...(pages ? { pageCount: pages.last - pages.first + 1 } : {}),
          },
        ],
      }
    } catch (error) {
      if (error instanceof OrchestrationError) return agentCliFail(error.message)
      logger.error('Artifact observation failed', { error: getErrorMessage(error) })
      return agentCliFail(
        'The artifact could not be read. Retry this read before making visual claims.'
      )
    }
  },
}
