import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
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

const firefliesGraphqlErrorSchema = z
  .object({
    message: z.string(),
  })
  .passthrough()

const firefliesUploadAudioResultSchema = z
  .object({
    success: z.boolean(),
    title: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .passthrough()

export const firefliesUploadAudioBodySchema = z
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

export const firefliesUploadAudioResponseSchema = z
  .object({
    data: z
      .object({
        uploadAudio: firefliesUploadAudioResultSchema.nullable().optional(),
      })
      .nullable()
      .optional(),
    errors: z.array(firefliesGraphqlErrorSchema).optional(),
  })
  .passthrough()

export const firefliesUploadAudioContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/fireflies/upload-audio',
  body: firefliesUploadAudioBodySchema,
  response: { mode: 'json', schema: firefliesUploadAudioResponseSchema },
})

export type FirefliesUploadAudioBody = ContractBody<typeof firefliesUploadAudioContract>
export type FirefliesUploadAudioBodyInput = ContractBodyInput<typeof firefliesUploadAudioContract>
export type FirefliesUploadAudioResponse = ContractJsonResponse<typeof firefliesUploadAudioContract>
