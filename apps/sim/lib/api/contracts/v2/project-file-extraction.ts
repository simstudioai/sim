import type { z } from 'zod'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2UnzipFileDataSchema } from '@/lib/api/contracts/v2/files'
import { v2ProjectFileParamsSchema } from '@/lib/api/contracts/v2/project-files'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2UnzipProjectFileDataSchema = v2UnzipFileDataSchema.meta({
  id: 'V2ProjectFileUnzipResult',
  title: 'Project unzip result',
  description: 'Outcome of unzipping a Project archive into a sibling folder.',
})
export type V2ProjectFileUnzipResult = z.output<typeof v2UnzipProjectFileDataSchema>

export const v2UnzipProjectFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/[fileId]/unzip',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2UnzipProjectFileDataSchema) },
})
