import { z } from 'zod'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const latexCompilers = [
  'pdflatex',
  'xelatex',
  'lualatex',
  'platex',
  'uplatex',
  'context',
] as const

const MAX_LATEX_SOURCE_CHARS = 1_000_000
const MAX_LATEX_RESOURCES = 25

const latexResourceSchema = z
  .object({
    path: z
      .string()
      .min(1, 'resource path cannot be empty')
      .max(512, 'resource path must be at most 512 characters')
      .refine(
        (path) => !path.startsWith('/') && path.split(/[/\\]/).every((segment) => segment !== '..'),
        'resource path must be relative and must not contain ".." segments'
      ),
    content: z
      .string()
      .min(1, 'resource content cannot be empty')
      .max(MAX_LATEX_SOURCE_CHARS, 'resource content must be at most 1,000,000 characters')
      .optional(),
    file: z
      .string()
      .min(1, 'resource file cannot be empty')
      .max(MAX_LATEX_SOURCE_CHARS, 'resource file must be at most 1,000,000 characters of base64')
      .optional(),
    url: z
      .string()
      .url('resource url must be a valid URL')
      .max(2048, 'resource url must be at most 2048 characters')
      .refine(
        (url) => url.startsWith('https://') || url.startsWith('http://'),
        'resource url must use http or https'
      )
      .optional(),
  })
  .superRefine((resource, ctx) => {
    const provided = [resource.content, resource.file, resource.url].filter(
      (value) => value !== undefined
    )
    if (provided.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: `resource "${resource.path}" must provide exactly one of content, file, or url`,
      })
    }
  })

export const latexCompileBodySchema = z.object({
  content: z
    .string()
    .min(1, 'content cannot be empty')
    .max(MAX_LATEX_SOURCE_CHARS, 'content must be at most 1,000,000 characters'),
  compiler: z.enum(latexCompilers).optional(),
  fileName: z.string().max(255, 'fileName must be at most 255 characters').optional(),
  resources: z
    .array(latexResourceSchema)
    .max(MAX_LATEX_RESOURCES, `resources must contain at most ${MAX_LATEX_RESOURCES} entries`)
    .optional(),
  workspaceId: z.string().optional(),
  workflowId: z.string().optional(),
  executionId: z.string().optional(),
})

export type LatexCompileBody = z.input<typeof latexCompileBodySchema>

export const latexCompileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/latex',
  body: latexCompileBodySchema,
  response: {
    mode: 'json',
    schema: genericToolResponseSchema,
  },
})
