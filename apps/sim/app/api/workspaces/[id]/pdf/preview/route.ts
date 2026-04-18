import { createDocumentPreviewRoute } from '@/app/api/workspaces/[id]/_preview/create-preview-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/workspaces/[id]/pdf/preview
 * Compile PDF-Lib source code and return the binary PDF for streaming preview.
 */
export const POST = createDocumentPreviewRoute({
  taskId: 'pdf-generate',
  contentType: 'application/pdf',
  label: 'PDF',
})
