import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'

const firefliesAudioFileSchema = z
  .object({
    id: z.string().optional(),
    key: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
    name: z.string().optional(),
    size: z.number().nonnegative().optional(),
    type: z.string().optional(),
    context: z.string().optional(),
  })
  .passthrough()

export const firefliesUploadAudioInputSchema = z
  .object({
    apiKey: z.string().min(1, 'Missing API key for Fireflies API request'),
    audioFile: firefliesAudioFileSchema.optional(),
    audioUrl: z.string().optional(),
    title: z.string().optional(),
    webhook: z.string().optional(),
    language: z.string().optional(),
    attendees: z.unknown().optional(),
    clientReferenceId: z.string().optional(),
    [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
  })
  .superRefine((data, context) => {
    const file = data.audioFile
    if (!file?.key && !file?.url && !file?.path && !data.audioUrl) {
      context.addIssue({
        code: 'custom',
        message: 'Either an audio file or audio URL is required',
        path: ['audioUrl'],
      })
    }
  })

export type FirefliesUploadAudioInput = z.output<typeof firefliesUploadAudioInputSchema>
