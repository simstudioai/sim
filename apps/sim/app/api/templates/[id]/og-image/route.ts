import { db } from '@sim/db'
import { templates } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { uploadFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('TemplateOGImageAPI')

/**
 * PUT /api/templates/[id]/og-image
 * Upload a pre-generated OG image for a template.
 * Accepts base64-encoded image data in the request body.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized OG image upload attempt for template: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [template] = await db
      .select({ id: templates.id, workflowId: templates.workflowId })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1)

    if (!template) {
      logger.warn(`[${requestId}] Template not found for OG image upload: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const body = await request.json()
    const { imageData } = body

    if (!imageData || typeof imageData !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid imageData (expected base64 string)' },
        { status: 400 }
      )
    }

    const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData
    const imageBuffer = Buffer.from(base64Data, 'base64')

    const maxSize = 5 * 1024 * 1024
    if (imageBuffer.length > maxSize) {
      return NextResponse.json({ error: 'Image too large. Maximum size is 5MB.' }, { status: 400 })
    }

    const timestamp = Date.now()
    const storageKey = `og-images/templates/${id}/${timestamp}.png`

    logger.info(`[${requestId}] Uploading OG image for template ${id}: ${storageKey}`)

    const uploadResult = await uploadFile({
      file: imageBuffer,
      fileName: storageKey,
      contentType: 'image/png',
      context: 'og-images',
      preserveKey: true,
      customKey: storageKey,
      metadata: {
        templateId: id,
        uploadedAt: new Date().toISOString(),
        purpose: 'og-image',
      },
    })

    const baseUrl = getBaseUrl()
    const ogImageUrl = `${baseUrl}${uploadResult.path}?context=og-images`

    await db
      .update(templates)
      .set({
        ogImageUrl,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))

    logger.info(`[${requestId}] Successfully uploaded OG image for template ${id}: ${ogImageUrl}`)

    return NextResponse.json({
      success: true,
      ogImageUrl,
    })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Error uploading OG image for template ${id}:`, error)
    return NextResponse.json({ error: 'Failed to upload OG image' }, { status: 500 })
  }
}

/**
 * DELETE /api/templates/[id]/og-image
 * Remove the OG image for a template.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await db
      .update(templates)
      .set({
        ogImageUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))

    logger.info(`[${requestId}] Removed OG image for template ${id}`)

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Error removing OG image for template ${id}:`, error)
    return NextResponse.json({ error: 'Failed to remove OG image' }, { status: 500 })
  }
}
