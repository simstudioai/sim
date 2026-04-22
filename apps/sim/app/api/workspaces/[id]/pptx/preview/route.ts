import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDocumentPreviewRoute } from '@/app/api/workspaces/[id]/_preview/create-preview-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/workspaces/[id]/pptx/preview
 * Compile PptxGenJS source code and return the binary PPTX for streaming preview.
 */
export const POST = withRouteHandler(
  createDocumentPreviewRoute({
    taskId: 'pptx-generate',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PPTX',
  })
)
