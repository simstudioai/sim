import { z } from 'zod'

export const googleSlidesExportInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  presentationId: z
    .string()
    .trim()
    .min(1, 'Presentation ID is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Presentation ID contains invalid characters'),
  exportFormat: z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim().toUpperCase()
    return normalized || undefined
  }, z.enum(['PDF', 'PPTX', 'ODP', 'TXT', 'PNG', 'JPEG', 'SVG']).optional()),
})

export type GoogleSlidesExportInput = z.output<typeof googleSlidesExportInputSchema>
