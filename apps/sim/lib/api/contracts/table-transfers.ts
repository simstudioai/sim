import { exportTableAsyncBodySchema, tableIdParamsSchema } from '@/lib/api/contracts/tables'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  v2CreateTableImportBodySchema,
  v2CreateTableImportDataSchema,
  v2TableExportDownloadDataSchema,
  v2TableExportParamsSchema,
  v2TableExportSchema,
  v2TableImportParamsSchema,
  v2TableImportSchema,
  v2TableTransferWorkspaceQuerySchema,
} from '@/lib/api/contracts/v2/tables'

export const createTableImportResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/imports',
  body: v2CreateTableImportBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2CreateTableImportDataSchema), status: 201 },
})

export const getTableImportResourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/imports/[importId]',
  params: v2TableImportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableImportSchema) },
})

export const createTableExportResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/exports',
  params: tableIdParamsSchema,
  body: exportTableAsyncBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportSchema), status: 201 },
})

export const getTableExportResourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/exports/[exportId]',
  params: v2TableExportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportSchema) },
})

export const cancelTableExportResourceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/exports/[exportId]',
  params: v2TableExportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportSchema) },
})

export const downloadTableExportResourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/exports/[exportId]/download',
  params: v2TableExportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportDownloadDataSchema) },
})
