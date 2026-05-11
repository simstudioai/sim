import { z } from 'zod'
import {
  isLargeValueStorageKey,
  LARGE_VALUE_KINDS,
  LARGE_VALUE_REF_MARKER,
  LARGE_VALUE_REF_VERSION,
} from '@/lib/execution/payloads/large-value-ref'

export const largeValueRefSchema = z
  .object({
    [LARGE_VALUE_REF_MARKER]: z.literal(true),
    version: z.literal(LARGE_VALUE_REF_VERSION),
    id: z.string().regex(/^lv_[A-Za-z0-9_-]{12}$/, 'Invalid large value reference ID'),
    kind: z.enum(LARGE_VALUE_KINDS),
    size: z.number().int().positive(),
    key: z.string().optional(),
    executionId: z.string().optional(),
    preview: z.unknown().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.key && !isLargeValueStorageKey(value.key, value.id, value.executionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key'],
        message: 'Large value reference key must point to execution-scoped server storage',
      })
    }
  })

export type LargeValueRefResponse = z.output<typeof largeValueRefSchema>
