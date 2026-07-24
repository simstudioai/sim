import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Upper bound on the source content passed to the LLM (chars). */
const MAX_ARTIFACT_CONTENT_CHARS = 400_000
const MAX_DESIGN_INSTRUCTIONS_CHARS = 10_000

export const artifactGenerateBodySchema = z.object({
  title: z
    .string()
    .min(1, 'Artifact title is required')
    .max(200, 'Artifact title must be at most 200 characters'),
  content: z
    .string()
    .min(1, 'Artifact content is required')
    .max(
      MAX_ARTIFACT_CONTENT_CHARS,
      `Artifact content must be at most ${MAX_ARTIFACT_CONTENT_CHARS} characters`
    ),
  designInstructions: z
    .string()
    .max(
      MAX_DESIGN_INSTRUCTIONS_CHARS,
      `Design instructions must be at most ${MAX_DESIGN_INSTRUCTIONS_CHARS} characters`
    )
    .optional(),
  model: z.string().min(1, 'Model is required'),
  fileName: z.string().max(200, 'File name must be at most 200 characters').optional(),
  createShareLink: z.boolean().optional(),
  workflowId: z.string().min(1, 'Workflow ID is required'),
  workspaceId: z.string().optional(),
  apiKey: z.string().optional(),
  azureEndpoint: z.string().optional(),
  azureApiVersion: z.string().optional(),
  vertexProject: z.string().optional(),
  vertexLocation: z.string().optional(),
  vertexCredential: z.string().optional(),
  bedrockAccessKeyId: z.string().optional(),
  bedrockSecretKey: z.string().optional(),
  bedrockRegion: z.string().optional(),
})

export type ArtifactGenerateBody = z.input<typeof artifactGenerateBodySchema>

export const artifactGenerateResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    file: userFileSchema,
    url: z.string(),
    shareUrl: z.string().nullable(),
    title: z.string(),
    model: z.string(),
  }),
})

export type ArtifactGenerateResult = z.output<typeof artifactGenerateResponseSchema>

export const artifactGenerateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/artifact/generate',
  body: artifactGenerateBodySchema,
  response: {
    mode: 'json',
    schema: artifactGenerateResponseSchema,
  },
})
