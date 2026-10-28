import { copyFileItemsBodySchema, copyFileItemsResponseSchema } from '@/lib/api/contracts/file-copy'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2CopyFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/copy',
  query: noInputSchema,
  body: copyFileItemsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(copyFileItemsResponseSchema), status: 201 },
})
