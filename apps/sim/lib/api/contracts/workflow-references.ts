import { z } from 'zod'
import { WORKFLOW_RESOURCE_KINDS } from '@/lib/workflows/references/types'

export const portableResourceKindSchema = z.enum([...WORKFLOW_RESOURCE_KINDS, 'workflow'])
export const referenceOccurrenceSchema = z
  .object({
    blockId: z
      .string()
      .min(1)
      .max(256)
      .refine(
        (key) => !['__proto__', 'prototype', 'constructor'].includes(key),
        'Invalid reference block'
      )
      .describe('Source block identifier before graph ID regeneration.'),
    subBlockKey: z
      .string()
      .min(1)
      .max(256)
      .refine(
        (key) => !['__proto__', 'prototype', 'constructor'].includes(key),
        'Invalid reference field'
      )
      .describe('Registered source field key, including the tool index for nested Agent fields.'),
    valuePath: z
      .array(
        z.union([
          z
            .string()
            .min(1)
            .max(256)
            .refine(
              (key) => !['__proto__', 'prototype', 'constructor'].includes(key),
              'Invalid reference path'
            ),
          z.number().int().min(0).max(2000),
        ])
      )
      .max(8)
      .describe(
        'Path within the field value; strings address properties and numbers address array entries.'
      ),
    positions: z
      .array(z.number().int().min(0).max(2000))
      .max(2000)
      .optional()
      .describe('Positions occupied by this identifier in a multi-value field.'),
    encoding: z
      .enum(['scalar', 'array', 'csv', 'files', 'environment'])
      .describe('Registered encoding used to discover and rewrite the reference.'),
  })
  .strict()
export const portableReferenceSchema = z
  .object({
    kind: portableResourceKindSchema.describe('Resource or operation kind.'),
    sourceId: z
      .string()
      .min(1)
      .max(4096)
      .describe(
        'Untrusted source reference label; imports never use it to authorize or query a source workspace.'
      ),
    required: z
      .boolean()
      .describe('Whether the reference or configuration is required for this operation.'),
    occurrences: z
      .array(referenceOccurrenceSchema)
      .min(1)
      .max(10000)
      .describe('Every registered source block and field occurrence of this reference.'),
  })
  .strict()
export const workflowReferenceManifestSchema = z
  .object({
    version: z.literal(1).describe('Reference format or deployment version number.'),
    references: z
      .array(portableReferenceSchema)
      .max(10000)
      .describe('Non-secret resource identifiers and their registered occurrences.'),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.references.reduce((sum, entry) => sum + entry.occurrences.length, 0) > 10000) {
      ctx.addIssue({
        code: 'custom',
        message: 'Reference manifest exceeds 10000 field occurrences',
      })
    }
  })
export type WorkflowReferenceManifestBody = z.input<typeof workflowReferenceManifestSchema>
