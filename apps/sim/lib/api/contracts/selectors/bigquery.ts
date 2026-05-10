import { z } from 'zod'
import {
  credentialWorkflowImpersonateBodySchema,
  definePostSelector,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'

const bigQueryDatasetSchema = z
  .object({
    datasetReference: z
      .object({
        datasetId: z.string(),
        projectId: z.string(),
      })
      .passthrough(),
    friendlyName: z.string().optional(),
  })
  .passthrough()

const bigQueryTableSchema = z
  .object({
    tableReference: z.object({ tableId: z.string() }).passthrough(),
    friendlyName: z.string().optional(),
  })
  .passthrough()

export const bigQueryDatasetsBodySchema = credentialWorkflowImpersonateBodySchema.extend({
  projectId: z.string().min(1),
})

export const bigQueryTablesBodySchema = bigQueryDatasetsBodySchema.extend({
  datasetId: z.string().min(1),
})

export const bigQueryDatasetsSelectorContract = definePostSelector(
  '/api/tools/google_bigquery/datasets',
  bigQueryDatasetsBodySchema,
  z.object({ datasets: z.array(bigQueryDatasetSchema) })
)

export const bigQueryTablesSelectorContract = definePostSelector(
  '/api/tools/google_bigquery/tables',
  bigQueryTablesBodySchema,
  z.object({ tables: z.array(bigQueryTableSchema) })
)

export type BigQueryDatasetsSelectorBody = ContractBodyInput<
  typeof bigQueryDatasetsSelectorContract
>
export type BigQueryTablesSelectorBody = ContractBodyInput<typeof bigQueryTablesSelectorContract>

export type BigQueryDatasetsSelectorResponse = ContractJsonResponse<
  typeof bigQueryDatasetsSelectorContract
>
export type BigQueryTablesSelectorResponse = ContractJsonResponse<
  typeof bigQueryTablesSelectorContract
>
