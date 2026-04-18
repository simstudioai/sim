import { createDocumentPreviewRoute } from '@/app/api/workspaces/[id]/_preview/create-preview-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/workspaces/[id]/docx/preview
 * Compile docx source code and return the binary DOCX for streaming preview.
 */
export const POST = createDocumentPreviewRoute({
  taskId: 'docx-generate',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  label: 'DOCX',
})
