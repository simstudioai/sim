import { createLogger } from '@sim/logger'
import type { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { OracleEpmError } from '@/lib/internal/oracle-epm/errors'
import {
  createLibraryFile,
  createLibraryFolder,
  createReportSnapshot,
  deleteLibraryArtifact,
  downloadBookOutput,
  downloadReportOutput,
  downloadReportSnapshotOutput,
  exportLibraryArtifact,
  getBook,
  getBookGlobalPov,
  getJob,
  getLibraryArtifact,
  getReport,
  getReportGlobalPov,
  getReportPackage,
  getReportPrompts,
  getReportSnapshot,
  importLibraryArtifact,
  listBooks,
  listLibraryArtifacts,
  listReportSnapshots,
  listReports,
  type NarrativeOperationContext,
  refreshReportPackageDataSources,
  waitForJob,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import {
  narrativeAuthSchema,
  narrativeCreateFileInputSchema,
  narrativeCreateFolderInputSchema,
  narrativeDownloadInputSchema,
  narrativeExportInputSchema,
  narrativeImportInputSchema,
  narrativeListInputSchema,
  narrativePdfDownloadInputSchema,
  narrativeRefreshInputSchema,
  narrativeResourceInputSchema,
  narrativeSnapshotInputSchema,
  narrativeWaitInputSchema,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('OracleEpmNarrativeReporting')

function operation<T extends z.ZodType>(
  schema: T,
  execute: (input: z.output<T>, context: NarrativeOperationContext) => Promise<ToolResponse>
): InternalToolOperationHandler {
  return async (request) => {
    request.signal?.throwIfAborted()
    const auth = narrativeAuthSchema.safeParse(request.input)
    if (!auth.success)
      return Response.json(
        {
          success: false,
          error: 'Select a valid Oracle EPM service-account credential',
        },
        { status: 401 }
      )
    const parsed = schema.safeParse(request.input)
    if (!parsed.success)
      return Response.json(
        {
          success: false,
          error: 'Invalid Narrative Reporting operation input',
          details: parsed.error.issues.map(({ path, message }) => ({ path, message })),
        },
        { status: 400 }
      )
    try {
      const credential = await resolveOAuthAccountId(auth.data.oauthCredential)
      request.signal?.throwIfAborted()
      if (
        credential?.credentialType !== 'service_account' ||
        credential.providerId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID
      ) {
        return Response.json(
          { success: false, error: 'Select an Oracle EPM service-account credential' },
          { status: 403 }
        )
      }
      const result = await execute(parsed.data, {
        client: createOracleEpmClient(auth.data),
        execution: request.context,
        signal: request.signal,
      })
      request.signal?.throwIfAborted()
      return Response.json(result)
    } catch (error) {
      request.signal?.throwIfAborted()
      const category = error instanceof OracleEpmError ? error.category : 'operation_failed'
      logger.error('Narrative Reporting operation failed', {
        requestId: request.requestId,
        toolId: request.toolId,
        category,
      })
      const status =
        error instanceof OracleEpmError
          ? (error.status ??
            (error.category === 'invalid_input'
              ? 400
              : error.category === 'payload_too_large'
                ? 413
                : 502))
          : isPayloadSizeLimitError(error)
            ? 413
            : 500
      return Response.json(
        {
          success: false,
          error:
            error instanceof OracleEpmError
              ? error.message
              : isPayloadSizeLimitError(error)
                ? 'Narrative Reporting files exceed the v1 size limit (100 MiB download, 99 MiB upload)'
                : 'Narrative Reporting operation failed',
        },
        { status }
      )
    }
  }
}

const handlers: Readonly<Record<string, InternalToolOperationHandler>> = {
  oracle_epm_narrative_reporting_list_library_artifacts: operation(
    narrativeListInputSchema,
    listLibraryArtifacts
  ),
  oracle_epm_narrative_reporting_get_library_artifact: operation(
    narrativeResourceInputSchema,
    getLibraryArtifact
  ),
  oracle_epm_narrative_reporting_create_library_folder: operation(
    narrativeCreateFolderInputSchema,
    createLibraryFolder
  ),
  oracle_epm_narrative_reporting_create_library_file: operation(
    narrativeCreateFileInputSchema,
    createLibraryFile
  ),
  oracle_epm_narrative_reporting_delete_library_artifact: operation(
    narrativeResourceInputSchema,
    deleteLibraryArtifact
  ),
  oracle_epm_narrative_reporting_list_reports: operation(narrativeListInputSchema, listReports),
  oracle_epm_narrative_reporting_get_report: operation(narrativeResourceInputSchema, getReport),
  oracle_epm_narrative_reporting_get_report_global_pov: operation(
    narrativeResourceInputSchema,
    getReportGlobalPov
  ),
  oracle_epm_narrative_reporting_get_report_prompts: operation(
    narrativeResourceInputSchema,
    getReportPrompts
  ),
  oracle_epm_narrative_reporting_download_report_output: operation(
    narrativePdfDownloadInputSchema,
    downloadReportOutput
  ),
  oracle_epm_narrative_reporting_list_books: operation(narrativeListInputSchema, listBooks),
  oracle_epm_narrative_reporting_get_book: operation(narrativeResourceInputSchema, getBook),
  oracle_epm_narrative_reporting_get_book_global_pov: operation(
    narrativeResourceInputSchema,
    getBookGlobalPov
  ),
  oracle_epm_narrative_reporting_download_book_output: operation(
    narrativeDownloadInputSchema,
    downloadBookOutput
  ),
  oracle_epm_narrative_reporting_list_report_snapshots: operation(
    narrativeListInputSchema,
    listReportSnapshots
  ),
  oracle_epm_narrative_reporting_get_report_snapshot: operation(
    narrativeResourceInputSchema,
    getReportSnapshot
  ),
  oracle_epm_narrative_reporting_create_report_snapshot: operation(
    narrativeSnapshotInputSchema,
    createReportSnapshot
  ),
  oracle_epm_narrative_reporting_download_report_snapshot_output: operation(
    narrativePdfDownloadInputSchema,
    downloadReportSnapshotOutput
  ),
  oracle_epm_narrative_reporting_get_report_package: operation(
    narrativeResourceInputSchema,
    getReportPackage
  ),
  oracle_epm_narrative_reporting_refresh_package_data_sources: operation(
    narrativeRefreshInputSchema,
    refreshReportPackageDataSources
  ),
  oracle_epm_narrative_reporting_get_job: operation(narrativeResourceInputSchema, getJob),
  oracle_epm_narrative_reporting_wait_for_job: operation(narrativeWaitInputSchema, waitForJob),
  oracle_epm_narrative_reporting_export_library_artifact: operation(
    narrativeExportInputSchema,
    exportLibraryArtifact
  ),
  oracle_epm_narrative_reporting_import_library_artifact: operation(
    narrativeImportInputSchema,
    importLibraryArtifact
  ),
}

export const executeOracleEpmNarrativeReportingTool: InternalToolOperationHandler = (request) => {
  const handler = Object.hasOwn(handlers, request.toolId) ? handlers[request.toolId] : undefined
  return handler
    ? handler(request)
    : Promise.resolve(
        Response.json(
          {
            success: false,
            error: 'Unsupported Narrative Reporting operation',
          },
          { status: 400 }
        )
      )
}
