import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('ShortIoQrAPI')

const ShortIoQrSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  linkId: z.string().min(1, 'Link ID is required'),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  size: z.number().min(1).max(99).optional(),
  type: z.enum(['png', 'svg']).optional(),
  useDomainSettings: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Short.io QR request: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validated = ShortIoQrSchema.parse(body)

    const qrBody: Record<string, unknown> = {
      useDomainSettings: validated.useDomainSettings ?? true,
    }
    if (validated.color) qrBody.color = validated.color
    if (validated.backgroundColor) qrBody.backgroundColor = validated.backgroundColor
    if (validated.size) qrBody.size = validated.size
    if (validated.type) qrBody.type = validated.type

    const response = await fetch(`https://api.short.io/links/qr/${validated.linkId}`, {
      method: 'POST',
      headers: {
        Authorization: validated.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(qrBody),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      logger.error(`[${requestId}] Short.io QR API error: ${errorText}`)
      return NextResponse.json(
        { success: false, error: `Short.io API error: ${errorText}` },
        { status: response.status }
      )
    }

    const contentType = response.headers.get('Content-Type') ?? 'image/png'
    const fileBuffer = Buffer.from(await response.arrayBuffer())
    const mimeType = contentType.split(';')[0]?.trim() || 'image/png'
    const ext = validated.type === 'svg' ? 'svg' : 'png'
    const fileName = `qr-${validated.linkId}.${ext}`

    logger.info(`[${requestId}] QR code generated`, {
      linkId: validated.linkId,
      size: fileBuffer.length,
      mimeType,
    })

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: fileName,
          mimeType,
          data: fileBuffer.toString('base64'),
          size: fileBuffer.length,
        },
      },
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
        },
        { status: 400 }
      )
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${requestId}] Short.io QR error: ${message}`)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
