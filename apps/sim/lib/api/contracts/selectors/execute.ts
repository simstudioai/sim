import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import {
  MAX_ID_LENGTH,
  organizationIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import { type SelectorKey, selectorManifest } from '@/lib/selectors/manifest'
import { selectorContextKeys } from '@/lib/selectors/types'

const selectorKeySet = new Set<string>(Object.keys(selectorManifest))
const selectorContextKeySet = new Set<string>(selectorContextKeys)

export const selectorKeySchema = z.custom<SelectorKey>(
  (value) => typeof value === 'string' && selectorKeySet.has(value),
  { error: 'Unknown selector key' }
)

export const selectorScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('organization'), organizationId: organizationIdSchema }).strict(),
  z
    .object({
      kind: z.literal('workflow'),
      workflowId: workflowIdSchema.max(MAX_ID_LENGTH, 'Workflow ID is too long'),
      workspaceId: workspaceIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('workspace'),
      workspaceId: workspaceIdSchema,
    })
    .strict(),
])

export const selectorContextSchema = z
  .record(z.string().min(1).max(64), z.string().max(16 * 1024))
  .superRefine((context, issueContext) => {
    const keys = Object.keys(context)
    if (keys.length > selectorContextKeys.length) {
      issueContext.addIssue({
        code: 'custom',
        message: 'Selector context contains too many fields',
      })
    }
    for (const key of keys) {
      if (!selectorContextKeySet.has(key)) {
        issueContext.addIssue({
          code: 'custom',
          path: [key],
          message: 'Unknown selector context field',
        })
      }
    }
    const characters = Object.values(context).reduce((total, value) => total + value.length, 0)
    if (characters > 128 * 1024) {
      issueContext.addIssue({
        code: 'custom',
        message: 'Selector context exceeds its aggregate size limit',
      })
    }
  })

export const selectorRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('list'),
      search: z.string().max(1_024).optional(),
      cursor: z
        .string()
        .min(1)
        .max(16 * 1024)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('detail'),
      id: z
        .string()
        .min(1)
        .max(16 * 1024),
    })
    .strict(),
])

export const executeSelectorBodySchema = z
  .object({
    selectorKey: selectorKeySchema,
    scope: selectorScopeSchema,
    context: selectorContextSchema,
    request: selectorRequestSchema,
  })
  .strict()

const safeOptionMetaValueSchema = z.union([
  z.string().max(16 * 1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

export const selectorOptionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(16 * 1024),
    label: z
      .string()
      .min(1)
      .max(16 * 1024),
    meta: z.record(z.string().min(1).max(128), safeOptionMetaValueSchema).optional(),
  })
  .strict()

export const executeSelectorResponseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('list'),
      items: z.array(selectorOptionSchema).max(MAX_SELECTOR_OPTIONS),
      nextCursor: z
        .string()
        .min(1)
        .max(16 * 1024)
        .optional(),
      truncated: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('detail'),
      item: selectorOptionSchema.nullable(),
    })
    .strict(),
])

export const executeSelectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/selectors/execute',
  body: executeSelectorBodySchema,
  response: {
    mode: 'json',
    schema: executeSelectorResponseSchema,
  },
})

export type ExecuteSelectorBody = z.input<typeof executeSelectorBodySchema>
export type ExecuteSelectorRequest = z.output<typeof executeSelectorBodySchema>
export type ExecuteSelectorResponse = z.output<typeof executeSelectorResponseSchema>
