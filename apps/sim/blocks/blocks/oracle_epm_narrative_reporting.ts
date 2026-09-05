import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'
import type { NarrativeResponse } from '@/tools/oracle_epm_narrative_reporting/types'

const OPERATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  list_library_artifacts: ['folderId', 'limit', 'offset', 'q', 'orderBy'],
  get_library_artifact: ['resourceId'],
  create_library_folder: ['name', 'description', 'systemPath'],
  create_library_file: [
    'name',
    'description',
    'systemPath',
    'providerFile',
    'mimeType',
    'overwrite',
  ],
  delete_library_artifact: ['resourceId'],
  list_reports: ['limit', 'offset', 'q', 'orderBy'],
  get_report: ['resourceId'],
  get_report_global_pov: ['resourceId'],
  get_report_prompts: ['resourceId'],
  download_report_output: ['resourceId', 'fileName', 'globalPov', 'prompts'],
  list_books: ['limit', 'offset', 'q', 'orderBy'],
  get_book: ['resourceId'],
  get_book_global_pov: ['resourceId'],
  download_book_output: ['resourceId', 'format', 'fileName', 'globalPov'],
  list_report_snapshots: ['limit', 'offset', 'q', 'orderBy'],
  get_report_snapshot: ['resourceId'],
  create_report_snapshot: [
    'reportId',
    'reportName',
    'libraryLocation',
    'snapShotName',
    'globalPov',
    'prompts',
    'overwrite',
  ],
  download_report_snapshot_output: ['resourceId', 'fileName'],
  get_report_package: ['resourceId'],
  refresh_package_data_sources: ['reportPackageName', 'refreshableSources'],
  get_job: ['resourceId'],
  wait_for_job: ['resourceId', 'maxWaitSeconds'],
  export_library_artifact: [
    'artifactName',
    'artifactType',
    'exportLocation',
    'exportFormat',
    'exportLibraryFolder',
    'saveAsFile',
    'applicationName',
    'errorFile',
  ],
  import_library_artifact: [
    'importFile',
    'importLocation',
    'importFormat',
    'importFolder',
    'deleteAfterImport',
    'importPermissions',
    'overwrite',
    'errorFile',
  ],
}
const RESOURCE_FIELDS: Readonly<Record<string, string>> = {
  get_library_artifact: 'artifactId',
  delete_library_artifact: 'artifactId',
  get_report: 'reportId',
  get_report_global_pov: 'reportId',
  get_report_prompts: 'reportId',
  download_report_output: 'reportId',
  get_book: 'bookId',
  get_book_global_pov: 'bookId',
  download_book_output: 'bookId',
  get_report_snapshot: 'snapshotId',
  download_report_snapshot_output: 'snapshotId',
  get_report_package: 'packageId',
  get_job: 'jobId',
  wait_for_job: 'jobId',
}
const TOOL_IDS: Readonly<Record<string, string>> = {
  list_library_artifacts: 'oracle_epm_narrative_reporting_list_library_artifacts',
  get_library_artifact: 'oracle_epm_narrative_reporting_get_library_artifact',
  create_library_folder: 'oracle_epm_narrative_reporting_create_library_folder',
  create_library_file: 'oracle_epm_narrative_reporting_create_library_file',
  delete_library_artifact: 'oracle_epm_narrative_reporting_delete_library_artifact',
  list_reports: 'oracle_epm_narrative_reporting_list_reports',
  get_report: 'oracle_epm_narrative_reporting_get_report',
  get_report_global_pov: 'oracle_epm_narrative_reporting_get_report_global_pov',
  get_report_prompts: 'oracle_epm_narrative_reporting_get_report_prompts',
  download_report_output: 'oracle_epm_narrative_reporting_download_report_output',
  list_books: 'oracle_epm_narrative_reporting_list_books',
  get_book: 'oracle_epm_narrative_reporting_get_book',
  get_book_global_pov: 'oracle_epm_narrative_reporting_get_book_global_pov',
  download_book_output: 'oracle_epm_narrative_reporting_download_book_output',
  list_report_snapshots: 'oracle_epm_narrative_reporting_list_report_snapshots',
  get_report_snapshot: 'oracle_epm_narrative_reporting_get_report_snapshot',
  create_report_snapshot: 'oracle_epm_narrative_reporting_create_report_snapshot',
  download_report_snapshot_output: 'oracle_epm_narrative_reporting_download_report_snapshot_output',
  get_report_package: 'oracle_epm_narrative_reporting_get_report_package',
  refresh_package_data_sources: 'oracle_epm_narrative_reporting_refresh_package_data_sources',
  get_job: 'oracle_epm_narrative_reporting_get_job',
  wait_for_job: 'oracle_epm_narrative_reporting_wait_for_job',
  export_library_artifact: 'oracle_epm_narrative_reporting_export_library_artifact',
  import_library_artifact: 'oracle_epm_narrative_reporting_import_library_artifact',
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('Expected a string value')
  return value.trim() || undefined
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Expected true or false')
}

export const OracleEpmNarrativeReportingBlock: BlockConfig<NarrativeResponse> = {
  type: 'oracle_epm_narrative_reporting',
  name: 'Oracle EPM Narrative Reporting',
  description:
    'Work with Narrative Reporting reports, books, library artifacts, snapshots, and jobs',
  longDescription:
    'Connect a reusable Oracle EPM service-account credential to the environment stored in that credential. Discover library artifacts, reports and books; render reports, books and report snapshots to execution files; inspect package metadata; and submit or monitor snapshot, refresh, export and import jobs. Downloads are capped at 100 MiB. Job submission is not completion. Leave block retries disabled for create, delete, snapshot, refresh, export and import operations; reconcile an uncertain Oracle outcome before submitting again. Temporary-file transfer and package list/preview/published-output operations remain unavailable pending verified Oracle contracts. Doclet lifecycle, publishing, bursting and database backups are not supported.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_epm_narrative_reporting',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle EPM Narrative Reporting',
    sentences: {
      byOperation: {
        list_library_artifacts: [
          'List Library Artifacts',
          {
            text: ', matching',
            field: 'q',
          },
          {
            text: ', up to',
            field: 'limit',
          },
        ],
        get_library_artifact: [
          {
            text: 'Read library artifact',
            field: ['artifactSelector', 'manualArtifactId'],
            core: true,
          },
        ],
        create_library_folder: [
          {
            text: 'Create Library Folder',
            field: 'name',
            core: true,
          },
        ],
        create_library_file: [
          {
            text: 'Create Library File',
            field: 'name',
            core: true,
          },
        ],
        delete_library_artifact: [
          {
            text: 'Delete library artifact',
            field: ['artifactSelector', 'manualArtifactId'],
            core: true,
          },
        ],
        list_reports: [
          'List Reports',
          {
            text: ', matching',
            field: 'q',
          },
          {
            text: ', up to',
            field: 'limit',
          },
        ],
        get_report: [
          {
            text: 'Read report',
            field: ['reportSelector', 'manualReportId'],
            core: true,
          },
        ],
        get_report_global_pov: [
          {
            text: 'Read report global pov',
            field: ['reportSelector', 'manualReportId'],
            core: true,
          },
        ],
        get_report_prompts: [
          {
            text: 'Read report prompts',
            field: ['reportSelector', 'manualReportId'],
            core: true,
          },
        ],
        download_report_output: [
          {
            text: 'Download report output',
            field: ['reportSelector', 'manualReportId'],
            core: true,
          },
        ],
        list_books: [
          'List Books',
          {
            text: ', matching',
            field: 'q',
          },
          {
            text: ', up to',
            field: 'limit',
          },
        ],
        get_book: [
          {
            text: 'Read book',
            field: ['bookSelector', 'manualBookId'],
            core: true,
          },
        ],
        get_book_global_pov: [
          {
            text: 'Read book global pov',
            field: ['bookSelector', 'manualBookId'],
            core: true,
          },
        ],
        download_book_output: [
          {
            text: 'Download book output',
            field: ['bookSelector', 'manualBookId'],
            core: true,
          },
        ],
        list_report_snapshots: [
          'List Report Snapshots',
          {
            text: ', matching',
            field: 'q',
          },
          {
            text: ', up to',
            field: 'limit',
          },
        ],
        get_report_snapshot: [
          {
            text: 'Read report snapshot',
            field: 'snapshotId',
            core: true,
          },
        ],
        create_report_snapshot: [
          'Create a report snapshot',
          {
            text: 'from',
            field: ['reportSelector', 'manualReportId'],
          },
          {
            text: 'or report named',
            field: 'reportName',
          },
        ],
        download_report_snapshot_output: [
          {
            text: 'Download report snapshot output',
            field: 'snapshotId',
            core: true,
          },
        ],
        get_report_package: [
          {
            text: 'Read report package',
            field: 'packageId',
            core: true,
          },
        ],
        refresh_package_data_sources: [
          {
            text: 'Refresh Package Data Sources',
            field: 'reportPackageName',
            core: true,
          },
        ],
        get_job: [
          {
            text: 'Read job',
            field: 'jobId',
            core: true,
          },
        ],
        wait_for_job: [
          {
            text: 'Wait for job',
            field: 'jobId',
            core: true,
          },
        ],
        export_library_artifact: [
          {
            text: 'Export Library Artifact',
            field: 'artifactName',
            core: true,
          },
        ],
        import_library_artifact: [
          {
            text: 'Import Library Artifact',
            field: 'importFile',
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        {
          id: 'list_library_artifacts',
          label: 'List Library Artifacts',
        },
        {
          id: 'get_library_artifact',
          label: 'Get Library Artifact',
        },
        {
          id: 'create_library_folder',
          label: 'Create Library Folder',
        },
        {
          id: 'create_library_file',
          label: 'Create Library File',
        },
        {
          id: 'delete_library_artifact',
          label: 'Delete Library Artifact',
        },
        {
          id: 'list_reports',
          label: 'List Reports',
        },
        {
          id: 'get_report',
          label: 'Get Report',
        },
        {
          id: 'get_report_global_pov',
          label: 'Get Report Global POV',
        },
        {
          id: 'get_report_prompts',
          label: 'Get Report Prompts',
        },
        {
          id: 'download_report_output',
          label: 'Download Report Output',
        },
        {
          id: 'list_books',
          label: 'List Books',
        },
        {
          id: 'get_book',
          label: 'Get Book',
        },
        {
          id: 'get_book_global_pov',
          label: 'Get Book Global POV',
        },
        {
          id: 'download_book_output',
          label: 'Download Book Output',
        },
        {
          id: 'list_report_snapshots',
          label: 'List Report Snapshots',
        },
        {
          id: 'get_report_snapshot',
          label: 'Get Report Snapshot',
        },
        {
          id: 'create_report_snapshot',
          label: 'Create Report Snapshot',
        },
        {
          id: 'download_report_snapshot_output',
          label: 'Download Report Snapshot Output',
        },
        {
          id: 'get_report_package',
          label: 'Get Report Package',
        },
        {
          id: 'refresh_package_data_sources',
          label: 'Refresh Package Data Sources',
        },
        {
          id: 'get_job',
          label: 'Get Job',
        },
        {
          id: 'wait_for_job',
          label: 'Wait for Job',
        },
        {
          id: 'export_library_artifact',
          label: 'Export Library Artifact',
        },
        {
          id: 'import_library_artifact',
          label: 'Import Library Artifact',
        },
      ],
      value: () => 'list_reports',
    },
    {
      id: 'credential',
      title: 'Oracle EPM Account',
      type: 'oauth-input',
      serviceId: 'oracle-epm-narrative-reporting',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle EPM credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle EPM Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      placeholder: 'Optional repository folder UUID. Omit to list the library collection.',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum objects on one page (1–100, default 50).',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Zero-based page offset (0–1,000,000, default 0).',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
      mode: 'advanced',
    },
    {
      id: 'q',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle SCIM filter per RFC 7644 using names or dates supplied by the user, such as name co "Budget". Return ONLY the SCIM filter expression.',
        placeholder: 'Describe the artifacts or reports to find',
      },
      title: 'Q',
      type: 'short-input',
      placeholder: 'Oracle SCIM filter expression, for example name co "Budget".',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
      mode: 'advanced',
    },
    {
      id: 'orderBy',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate comma-separated field:asc or field:desc sort terms using documented Narrative Reporting fields name, description, creationDate, or modifiedDate. Return ONLY the comma-separated sort terms.',
        placeholder: 'Describe the desired ordering',
      },
      title: 'Order By',
      type: 'short-input',
      placeholder:
        'Comma-separated field:asc or field:desc sort terms supported by this collection.',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
      mode: 'advanced',
    },
    {
      id: 'artifactSelector',
      title: 'Library Artifact',
      type: 'file-selector',
      canonicalParamId: 'artifactId',
      serviceId: 'oracle-epm-narrative-reporting',
      selectorKey: 'oracle_epm_narrative_reporting.artifacts',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select library artifact',
      condition: {
        field: 'operation',
        value: ['get_library_artifact', 'delete_library_artifact'],
      },
      required: {
        field: 'operation',
        value: ['get_library_artifact', 'delete_library_artifact'],
      },
    },
    {
      id: 'manualArtifactId',
      title: 'Library Artifact ID',
      type: 'short-input',
      canonicalParamId: 'artifactId',
      dependsOn: ['credential'],
      mode: 'advanced',
      placeholder: 'Enter native library artifact ID',
      condition: {
        field: 'operation',
        value: ['get_library_artifact', 'delete_library_artifact'],
      },
      required: {
        field: 'operation',
        value: ['get_library_artifact', 'delete_library_artifact'],
      },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Library artifact name.',
      condition: {
        field: 'operation',
        value: ['create_library_folder', 'create_library_file'],
      },
      required: {
        field: 'operation',
        value: ['create_library_folder', 'create_library_file'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Optional library artifact description.',
      condition: {
        field: 'operation',
        value: ['create_library_folder', 'create_library_file'],
      },
      mode: 'advanced',
    },
    {
      id: 'systemPath',
      title: 'System Path',
      type: 'short-input',
      placeholder: 'Library destination folder path; do not provide a URL.',
      condition: {
        field: 'operation',
        value: ['create_library_folder', 'create_library_file'],
      },
      required: {
        field: 'operation',
        value: ['create_library_file'],
      },
    },
    {
      id: 'providerFile',
      title: 'Provider File',
      type: 'short-input',
      placeholder: 'Existing Oracle temporary file ID or name, not a Sim UserFile or URL.',
      condition: {
        field: 'operation',
        value: ['create_library_file'],
      },
      required: {
        field: 'operation',
        value: ['create_library_file'],
      },
    },
    {
      id: 'mimeType',
      title: 'Mime Type',
      type: 'dropdown',
      options: [
        { id: 'application/zip', label: 'application/zip' },
        { id: 'application/x-zip-compressed', label: 'application/x-zip-compressed' },
        { id: 'text/plain', label: 'text/plain' },
        { id: 'text/csv', label: 'text/csv' },
        { id: 'font/ttf', label: 'font/ttf' },
        { id: 'application/pdf', label: 'application/pdf' },
        { id: 'application/vnd.ms-excel', label: 'application/vnd.ms-excel' },
        { id: 'application/vnd.ms-word', label: 'application/vnd.ms-word' },
        { id: 'application/vnd.ms-powerpoint', label: 'application/vnd.ms-powerpoint' },
        {
          id: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          label: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        {
          id: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          label: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        {
          id: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          label: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
      ],
      placeholder: 'MIME type of the existing provider file (must be supported by Oracle).',
      condition: {
        field: 'operation',
        value: ['create_library_file'],
      },
      required: {
        field: 'operation',
        value: ['create_library_file'],
      },
    },
    {
      id: 'overwrite',
      title: 'Overwrite',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['create_library_file', 'import_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'reportSelector',
      title: 'Report',
      type: 'file-selector',
      canonicalParamId: 'reportId',
      serviceId: 'oracle-epm-narrative-reporting',
      selectorKey: 'oracle_epm_narrative_reporting.reports',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select report',
      condition: {
        field: 'operation',
        value: [
          'get_report',
          'get_report_global_pov',
          'get_report_prompts',
          'download_report_output',
          'create_report_snapshot',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_report',
          'get_report_global_pov',
          'get_report_prompts',
          'download_report_output',
        ],
      },
    },
    {
      id: 'manualReportId',
      title: 'Report ID',
      type: 'short-input',
      canonicalParamId: 'reportId',
      dependsOn: ['credential'],
      mode: 'advanced',
      placeholder: 'Enter native report ID',
      condition: {
        field: 'operation',
        value: [
          'get_report',
          'get_report_global_pov',
          'get_report_prompts',
          'download_report_output',
          'create_report_snapshot',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_report',
          'get_report_global_pov',
          'get_report_prompts',
          'download_report_output',
        ],
      },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder:
        'Optional output filename. Downloads are stored as UserFile objects and capped at 100 MiB.',
      condition: {
        field: 'operation',
        value: [
          'download_report_output',
          'download_book_output',
          'download_report_snapshot_output',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'globalPov',
      wandConfig: {
        enabled: true,
        prompt:
          'Use only dimension and member selections supplied by the user or a Global POV result. Format comma-separated dimension:member pairs. Do not invent IDs. Return ONLY the comma-separated POV selections.',
        placeholder: 'Describe the POV selections',
      },
      title: 'Global Pov',
      type: 'short-input',
      placeholder: 'Comma-separated dimension:member selections.',
      condition: {
        field: 'operation',
        value: ['download_report_output', 'download_book_output', 'create_report_snapshot'],
      },
    },
    {
      id: 'prompts',
      wandConfig: {
        enabled: true,
        prompt:
          'Use only prompt IDs and selections supplied by the user or Get Report Prompts. Format comma-separated promptId:selection pairs and semicolon-separated multi-selections. Do not invent IDs. Return ONLY the prompt selections.',
        placeholder: 'Describe the prompt selections',
      },
      title: 'Prompts',
      type: 'short-input',
      placeholder:
        'Comma-separated promptId:selection values; semicolons separate multiple selections.',
      condition: {
        field: 'operation',
        value: ['download_report_output', 'create_report_snapshot'],
      },
    },
    {
      id: 'bookSelector',
      title: 'Book',
      type: 'file-selector',
      canonicalParamId: 'bookId',
      serviceId: 'oracle-epm-narrative-reporting',
      selectorKey: 'oracle_epm_narrative_reporting.books',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select book',
      condition: {
        field: 'operation',
        value: ['get_book', 'get_book_global_pov', 'download_book_output'],
      },
      required: {
        field: 'operation',
        value: ['get_book', 'get_book_global_pov', 'download_book_output'],
      },
    },
    {
      id: 'manualBookId',
      title: 'Book ID',
      type: 'short-input',
      canonicalParamId: 'bookId',
      dependsOn: ['credential'],
      mode: 'advanced',
      placeholder: 'Enter native book ID',
      condition: {
        field: 'operation',
        value: ['get_book', 'get_book_global_pov', 'download_book_output'],
      },
      required: {
        field: 'operation',
        value: ['get_book', 'get_book_global_pov', 'download_book_output'],
      },
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        {
          id: 'pdf',
          label: 'pdf',
        },
        {
          id: 'xlsx',
          label: 'xlsx',
        },
      ],
      condition: {
        field: 'operation',
        value: ['download_book_output'],
      },
    },
    {
      id: 'snapshotId',
      title: 'Snapshot ID',
      type: 'short-input',
      placeholder: 'Native resource ID returned by its matching discovery operation.',
      condition: {
        field: 'operation',
        value: ['get_report_snapshot', 'download_report_snapshot_output'],
      },
      required: {
        field: 'operation',
        value: ['get_report_snapshot', 'download_report_snapshot_output'],
      },
    },
    {
      id: 'reportName',
      title: 'Report Name',
      type: 'short-input',
      placeholder: 'Library report name or path. Required when reportId is omitted.',
      condition: {
        field: 'operation',
        value: ['create_report_snapshot'],
      },
    },
    {
      id: 'libraryLocation',
      title: 'Library Location',
      type: 'short-input',
      placeholder: 'Optional destination folder for the report snapshot.',
      condition: {
        field: 'operation',
        value: ['create_report_snapshot'],
      },
    },
    {
      id: 'snapShotName',
      title: 'Snap Shot Name',
      type: 'short-input',
      placeholder: 'Optional report snapshot name (Oracle spelling is snapShotName).',
      condition: {
        field: 'operation',
        value: ['create_report_snapshot'],
      },
    },
    {
      id: 'snapshotOverwrite',
      title: 'Snapshot Overwrite',
      type: 'dropdown',
      options: [
        {
          id: 'false',
          label: 'false',
        },
        {
          id: 'true',
          label: 'true',
        },
      ],
      condition: {
        field: 'operation',
        value: ['create_report_snapshot'],
      },
      mode: 'advanced',
    },
    {
      id: 'packageId',
      title: 'Package ID',
      type: 'short-input',
      placeholder: 'Native report package ID obtained from Oracle',
      condition: {
        field: 'operation',
        value: ['get_report_package'],
      },
      required: {
        field: 'operation',
        value: ['get_report_package'],
      },
    },
    {
      id: 'reportPackageName',
      title: 'Report Package Name',
      type: 'short-input',
      placeholder: 'Report package name or library path, NOT its UUID.',
      condition: {
        field: 'operation',
        value: ['refresh_package_data_sources'],
      },
      required: {
        field: 'operation',
        value: ['refresh_package_data_sources'],
      },
    },
    {
      id: 'refreshableSources',
      wandConfig: {
        enabled: true,
        prompt:
          'Format only the data source names supplied by the user as a JSON array of strings. Return ONLY the JSON array.',
        placeholder: 'Name the data sources to refresh',
      },
      title: 'Refreshable Sources',
      type: 'long-input',
      placeholder:
        'JSON array of data source names, for example ["source"]. Omit for the provider default.',
      condition: {
        field: 'operation',
        value: ['refresh_package_data_sources'],
      },
      mode: 'advanced',
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Job ID returned by a submission operation',
      condition: {
        field: 'operation',
        value: ['get_job', 'wait_for_job'],
      },
      required: {
        field: 'operation',
        value: ['get_job', 'wait_for_job'],
      },
    },
    {
      id: 'maxWaitSeconds',
      title: 'Max Wait Seconds',
      type: 'short-input',
      placeholder:
        'Maximum wait in seconds (10–240, default 120). A local timeout does not cancel the Oracle job.',
      condition: {
        field: 'operation',
        value: ['wait_for_job'],
      },
      mode: 'advanced',
    },
    {
      id: 'artifactName',
      title: 'Artifact Name',
      type: 'short-input',
      placeholder: 'Library artifact name or path to export.',
      condition: {
        field: 'operation',
        value: ['export_library_artifact'],
      },
      required: {
        field: 'operation',
        value: ['export_library_artifact'],
      },
    },
    {
      id: 'artifactType',
      title: 'Artifact Type',
      type: 'dropdown',
      options: [
        { id: 'ReportPackageResourceType', label: 'ReportPackageResourceType' },
        { id: 'ReportResourceType', label: 'ReportResourceType' },
        { id: 'ReportSnapshotResourceType', label: 'ReportSnapshotResourceType' },
        { id: 'FolderResourceType', label: 'FolderResourceType' },
        { id: 'FileResourceType', label: 'FileResourceType' },
        { id: 'FontResourceType', label: 'FontResourceType' },
        { id: 'BurstingDefinitionResourceType', label: 'BurstingDefinitionResourceType' },
        { id: 'BookResourceType', label: 'BookResourceType' },
      ],
      placeholder: 'Oracle resource type, for example ReportResourceType or BookResourceType.',
      condition: {
        field: 'operation',
        value: ['export_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'exportLocation',
      title: 'Export Location',
      type: 'dropdown',
      options: [
        {
          id: 'Temporary',
          label: 'Temporary',
        },
        {
          id: 'Library',
          label: 'Library',
        },
        {
          id: 'File',
          label: 'File',
        },
      ],
      condition: {
        field: 'operation',
        value: ['export_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'exportFormat',
      title: 'Export Format',
      type: 'dropdown',
      options: [
        {
          id: 'Native',
          label: 'Native',
        },
        {
          id: 'File',
          label: 'File',
        },
        {
          id: 'LCM',
          label: 'LCM',
        },
      ],
      condition: {
        field: 'operation',
        value: ['export_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'exportLibraryFolder',
      title: 'Export Library Folder',
      type: 'short-input',
      placeholder: 'Library export destination folder when exportLocation is Library.',
      condition: {
        field: 'operation',
        value: ['export_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'saveAsFile',
      title: 'Save As File',
      type: 'short-input',
      placeholder: 'Optional provider-side export filename.',
      condition: {
        field: 'operation',
        value: ['export_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'applicationName',
      title: 'Application Name',
      type: 'short-input',
      placeholder: 'Application name, required for an LCM report export.',
      condition: {
        field: 'operation',
        value: 'export_library_artifact',
        and: { field: 'exportFormat', value: 'LCM' },
      },
      required: {
        field: 'operation',
        value: 'export_library_artifact',
        and: { field: 'exportFormat', value: 'LCM' },
      },
    },
    {
      id: 'errorFile',
      title: 'Error File',
      type: 'short-input',
      placeholder: 'Optional provider-side error filename.',
      condition: {
        field: 'operation',
        value: ['export_library_artifact', 'import_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'importFile',
      title: 'Import File',
      type: 'short-input',
      placeholder: 'Existing provider-side import file ID or path.',
      condition: {
        field: 'operation',
        value: ['import_library_artifact'],
      },
      required: {
        field: 'operation',
        value: ['import_library_artifact'],
      },
    },
    {
      id: 'importLocation',
      title: 'Import Location',
      type: 'dropdown',
      options: [
        {
          id: 'Temporary',
          label: 'Temporary',
        },
        {
          id: 'Library',
          label: 'Library',
        },
        {
          id: 'File',
          label: 'File',
        },
      ],
      condition: {
        field: 'operation',
        value: ['import_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'importFormat',
      title: 'Import Format',
      type: 'dropdown',
      options: [
        {
          id: 'Native',
          label: 'Native',
        },
        {
          id: 'File',
          label: 'File',
        },
      ],
      condition: {
        field: 'operation',
        value: ['import_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'importFolder',
      title: 'Import Folder',
      type: 'short-input',
      placeholder: 'Optional library destination folder.',
      condition: {
        field: 'operation',
        value: ['import_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'deleteAfterImport',
      title: 'Delete After Import',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['import_library_artifact'],
      },
      mode: 'advanced',
    },
    {
      id: 'importPermissions',
      title: 'Import Permissions',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['import_library_artifact'],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'oracle_epm_narrative_reporting_list_library_artifacts',
      'oracle_epm_narrative_reporting_get_library_artifact',
      'oracle_epm_narrative_reporting_create_library_folder',
      'oracle_epm_narrative_reporting_create_library_file',
      'oracle_epm_narrative_reporting_delete_library_artifact',
      'oracle_epm_narrative_reporting_list_reports',
      'oracle_epm_narrative_reporting_get_report',
      'oracle_epm_narrative_reporting_get_report_global_pov',
      'oracle_epm_narrative_reporting_get_report_prompts',
      'oracle_epm_narrative_reporting_download_report_output',
      'oracle_epm_narrative_reporting_list_books',
      'oracle_epm_narrative_reporting_get_book',
      'oracle_epm_narrative_reporting_get_book_global_pov',
      'oracle_epm_narrative_reporting_download_book_output',
      'oracle_epm_narrative_reporting_list_report_snapshots',
      'oracle_epm_narrative_reporting_get_report_snapshot',
      'oracle_epm_narrative_reporting_create_report_snapshot',
      'oracle_epm_narrative_reporting_download_report_snapshot_output',
      'oracle_epm_narrative_reporting_get_report_package',
      'oracle_epm_narrative_reporting_refresh_package_data_sources',
      'oracle_epm_narrative_reporting_get_job',
      'oracle_epm_narrative_reporting_wait_for_job',
      'oracle_epm_narrative_reporting_export_library_artifact',
      'oracle_epm_narrative_reporting_import_library_artifact',
    ],
    config: {
      tool: (params) => {
        const operation = String(params.operation ?? '')
        if (!Object.hasOwn(TOOL_IDS, operation))
          throw new Error('Unsupported Narrative Reporting operation')
        return TOOL_IDS[operation]
      },
      params: (params) => {
        const operation = String(params.operation ?? '')
        if (!Object.hasOwn(OPERATION_FIELDS, operation))
          throw new Error('Unsupported Narrative Reporting operation')
        const result: Record<string, unknown> = { oauthCredential: params.oauthCredential }
        for (const key of OPERATION_FIELDS[operation]) {
          const blockKey =
            key === 'resourceId'
              ? RESOURCE_FIELDS[operation]
              : key === 'overwrite' && operation === 'create_report_snapshot'
                ? 'snapshotOverwrite'
                : key
          const value = params[blockKey]
          if (['limit', 'offset', 'maxWaitSeconds'].includes(key))
            result[key] = parseOptionalNumberInput(
              value,
              key,
              key === 'limit'
                ? { integer: true, min: 1, max: 100 }
                : key === 'offset'
                  ? { integer: true, min: 0, max: 1_000_000 }
                  : { integer: true, min: 10, max: 240 }
            )
          else if (
            ['overwrite', 'deleteAfterImport', 'importPermissions'].includes(key) &&
            blockKey !== 'snapshotOverwrite'
          )
            result[key] = optionalBoolean(value)
          else if (key === 'refreshableSources') {
            if (value !== undefined && value !== null && value !== '') {
              try {
                result[key] = typeof value === 'string' ? JSON.parse(value) : value
              } catch {
                throw new Error('Refreshable sources must be a JSON array of strings')
              }
            }
          } else result[key] = optionalString(value)
        }
        return result
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Selected operation',
    },
    oauthCredential: {
      type: 'string',
      description: 'Oracle EPM service-account credential',
    },
    folderId: {
      type: 'string',
      description: 'Optional repository folder UUID. Omit to list the library collection.',
    },
    limit: {
      type: 'number',
      description: 'Maximum objects on one page (1–100, default 50).',
    },
    offset: {
      type: 'number',
      description: 'Zero-based page offset (0–1,000,000, default 0).',
    },
    q: {
      type: 'string',
      description: 'Oracle SCIM filter expression, for example name co "Budget".',
    },
    orderBy: {
      type: 'string',
      description:
        'Comma-separated field:asc or field:desc sort terms supported by this collection.',
    },
    artifactId: {
      type: 'string',
      description: 'Native resource ID returned by its matching discovery operation.',
    },
    name: {
      type: 'string',
      description: 'Library artifact name.',
    },
    description: {
      type: 'string',
      description: 'Optional library artifact description.',
    },
    systemPath: {
      type: 'string',
      description: 'Library destination folder path; do not provide a URL.',
    },
    providerFile: {
      type: 'string',
      description: 'Existing Oracle temporary file ID or name, not a Sim UserFile or URL.',
    },
    mimeType: {
      type: 'string',
      description: 'MIME type of the existing provider file (must be supported by Oracle).',
    },
    overwrite: {
      type: 'boolean',
      description: 'Whether to overwrite an existing artifact. Default false.',
    },
    reportId: {
      type: 'string',
      description: 'Native resource ID returned by its matching discovery operation.',
    },
    fileName: {
      type: 'string',
      description:
        'Optional output filename. Downloads are stored as UserFile objects and capped at 100 MiB.',
    },
    globalPov: {
      type: 'string',
      description: 'Comma-separated dimension:member selections.',
    },
    prompts: {
      type: 'string',
      description:
        'Comma-separated promptId:selection values; semicolons separate multiple selections.',
    },
    bookId: {
      type: 'string',
      description: 'Native resource ID returned by its matching discovery operation.',
    },
    format: {
      type: 'string',
      description: 'Book output format: pdf (default) or xlsx.',
    },
    snapshotId: {
      type: 'string',
      description: 'Native resource ID returned by its matching discovery operation.',
    },
    reportName: {
      type: 'string',
      description: 'Library report name or path. Required when reportId is omitted.',
    },
    libraryLocation: {
      type: 'string',
      description: 'Optional destination folder for the report snapshot.',
    },
    snapShotName: {
      type: 'string',
      description: 'Optional report snapshot name (Oracle spelling is snapShotName).',
    },
    snapshotOverwrite: {
      type: 'string',
      description: 'Whether to overwrite the report snapshot: string "true" or "false".',
    },
    packageId: {
      type: 'string',
      description:
        'Native report package ID obtained from Oracle; package discovery is not yet supported by this integration.',
    },
    reportPackageName: {
      type: 'string',
      description: 'Report package name or library path, NOT its UUID.',
    },
    refreshableSources: {
      type: 'json',
      description: 'Optional data sources to refresh; omit for the provider default.',
    },
    jobId: {
      type: 'string',
      description:
        'Oracle job ID returned by snapshot creation, package refresh, export, or import submission.',
    },
    maxWaitSeconds: {
      type: 'number',
      description:
        'Maximum wait in seconds (10–240, default 120). A local timeout does not cancel the Oracle job.',
    },
    artifactName: {
      type: 'string',
      description: 'Library artifact name or path to export.',
    },
    artifactType: {
      type: 'string',
      description: 'Oracle resource type, for example ReportResourceType or BookResourceType.',
    },
    exportLocation: {
      type: 'string',
      description:
        'Export destination: Temporary (default), Library, or File. Temporary result links are not automatically downloaded.',
    },
    exportFormat: {
      type: 'string',
      description:
        'Native (default), File, or LCM. LCM requires applicationName and supports reports only.',
    },
    exportLibraryFolder: {
      type: 'string',
      description: 'Library export destination folder when exportLocation is Library.',
    },
    saveAsFile: {
      type: 'string',
      description: 'Optional provider-side export filename.',
    },
    applicationName: {
      type: 'string',
      description: 'Application name, required for an LCM report export.',
    },
    errorFile: {
      type: 'string',
      description: 'Optional provider-side error filename.',
    },
    importFile: {
      type: 'string',
      description: 'Existing provider-side import file ID or path.',
    },
    importLocation: {
      type: 'string',
      description: 'Import source: Temporary, Library, or File.',
    },
    importFormat: {
      type: 'string',
      description: 'Import format: Native (default) or File.',
    },
    importFolder: {
      type: 'string',
      description: 'Optional library destination folder.',
    },
    deleteAfterImport: {
      type: 'boolean',
      description: 'Delete the provider import file after import. Default false.',
    },
    importPermissions: {
      type: 'boolean',
      description: 'Import permissions from the archive. Default false.',
    },
  },
  outputs: {
    artifacts: {
      type: 'json',
      description:
        'Repository artifacts [{artifactId, name, description, type, typeID, pathName, modifiedDate}]',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts'],
      },
    },
    offset: {
      type: 'number',
      description: 'Provider page offset, when returned',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
    },
    limit: {
      type: 'number',
      description: 'Provider page limit, when returned',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
    },
    count: {
      type: 'number',
      description: 'Provider page count, when returned',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page exists, when returned',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
    },
    totalResults: {
      type: 'number',
      description: 'Provider total, when returned',
      condition: {
        field: 'operation',
        value: ['list_library_artifacts', 'list_reports', 'list_books', 'list_report_snapshots'],
      },
    },
    artifact: {
      type: 'json',
      description:
        'Repository artifact metadata (artifactId, name, description, type, typeID, pathName, modifiedDate)',
      condition: {
        field: 'operation',
        value: ['get_library_artifact', 'create_library_folder', 'create_library_file'],
      },
    },
    deleted: {
      type: 'boolean',
      description: 'Artifact deletion confirmed',
      condition: {
        field: 'operation',
        value: ['delete_library_artifact'],
      },
    },
    artifactId: {
      type: 'string',
      description: 'Deleted repository artifact ID',
      condition: {
        field: 'operation',
        value: ['delete_library_artifact'],
      },
    },
    reports: {
      type: 'json',
      description:
        'Reports [{reportId, name, description, instanceType, datasourceNames, modifiedDate}]',
      condition: {
        field: 'operation',
        value: ['list_reports'],
      },
    },
    report: {
      type: 'json',
      description:
        'Report metadata (reportId, name, description, instanceType, datasourceNames, modifiedDate)',
      condition: {
        field: 'operation',
        value: ['get_report'],
      },
    },
    dimensions: {
      type: 'json',
      description:
        'POV dimensions [{dimensionId, name, hidden, fixedSelection, suggestedMembers: [{memberId, name, alias}]}]',
      condition: {
        field: 'operation',
        value: ['get_report_global_pov', 'get_book_global_pov'],
      },
    },
    prompts: {
      type: 'json',
      description:
        'Prompts [{promptId, label, dimensionName, allowMultipleSelections, suggestedMembers, defaultSelection}]',
      condition: {
        field: 'operation',
        value: ['get_report_prompts'],
      },
    },
    file: {
      type: 'file',
      description: 'Canonical execution UserFile, never inline base64; maximum 100 MiB',
      condition: {
        field: 'operation',
        value: [
          'download_report_output',
          'download_book_output',
          'download_report_snapshot_output',
        ],
      },
    },
    books: {
      type: 'json',
      description: 'Books [{bookId, name, description, pathName, datasourceNames, modifiedDate}]',
      condition: {
        field: 'operation',
        value: ['list_books'],
      },
    },
    book: {
      type: 'json',
      description:
        'Book metadata (bookId, name, description, pathName, datasourceNames, modifiedDate)',
      condition: {
        field: 'operation',
        value: ['get_book'],
      },
    },
    snapshots: {
      type: 'json',
      description: 'Report snapshots [{reportId, name, description, instanceType, modifiedDate}]',
      condition: {
        field: 'operation',
        value: ['list_report_snapshots'],
      },
    },
    snapshot: {
      type: 'json',
      description:
        'Report metadata (reportId, name, description, instanceType, datasourceNames, modifiedDate)',
      condition: {
        field: 'operation',
        value: ['get_report_snapshot'],
      },
    },
    job: {
      type: 'json',
      description:
        'Oracle job (jobId, status, descriptiveStatus, details, jobName, jobType); null if a wait times out before its first response',
      condition: {
        field: 'operation',
        value: [
          'create_report_snapshot',
          'refresh_package_data_sources',
          'get_job',
          'wait_for_job',
          'export_library_artifact',
          'import_library_artifact',
        ],
      },
    },
    reportPackage: {
      type: 'json',
      description:
        'Package metadata (reportPackageId, name, description, libraryPath, reportPackageType, modifiedDate)',
      condition: {
        field: 'operation',
        value: ['get_report_package'],
      },
    },
    jobId: {
      type: 'string',
      description: 'Oracle job ID, including on timeout',
      condition: {
        field: 'operation',
        value: ['wait_for_job'],
      },
    },
    completed: {
      type: 'boolean',
      description: 'True only when Oracle reports success',
      condition: {
        field: 'operation',
        value: ['wait_for_job'],
      },
    },
    timedOut: {
      type: 'boolean',
      description: 'Local wait timed out; Oracle job was not cancelled',
      condition: {
        field: 'operation',
        value: ['wait_for_job'],
      },
    },
    attempts: {
      type: 'number',
      description: 'Number of status reads',
      condition: {
        field: 'operation',
        value: ['wait_for_job'],
      },
    },
  },
}

export const OracleEpmNarrativeReportingBlockMeta = {
  tags: ['document-processing', 'cloud'],
  url: 'https://www.oracle.com/performance-management/narrative-reporting/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'EPM management report delivery',
      prompt:
        'Build a scheduled workflow that selects a management report, renders its PDF for the requested POV, and returns the stored file for distribution.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'EPM executive briefing book',
      prompt:
        'Build a workflow triggered before an executive meeting that renders an existing briefing book as PDF and returns the execution file.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'EPM budget book export',
      prompt:
        'Build a scheduled workflow that renders an existing budget book as XLSX for a selected fiscal-year POV and returns the file.',
      modules: ['scheduled', 'files', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'EPM snapshot checkpoint',
      prompt:
        'Build a month-end workflow that submits report snapshot creation, waits for the returned job, and records the job ID and outcome in a table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'EPM package refresh monitor',
      prompt:
        'Build a scheduled workflow that refreshes an existing package’s data sources, waits for its job, and records success, failure, or a timeout for follow-up.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'EPM library inventory',
      prompt:
        'Build a scheduled workflow that pages through library artifacts, projects names and modification times, and stores the inventory in a table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'EPM library migration check',
      prompt:
        'Build a manually triggered workflow that imports an existing provider-side archive after approval, waits for the job, and lists the destination library artifacts for verification.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'render-management-report',
      description: 'Render a management report with explicit POV and prompt selections.',
      content:
        '# Render a management report with explicit POV and prompt selections.\n\n## Steps\n1. Use List Reports and keep its reportId.\n2. Read Get Report Global POV and Get Report Prompts to obtain native dimension and prompt IDs.\n3. Run Download Report Output with the desired selections.\n4. Return the UserFile. Files larger than 100 MiB are unsupported.\n\n## Output\nReturn the operation result and any job ID or stored file; do not imply completion on timeout.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-reporting-cloud/raepr/op-epm-rest-v1-reports-id-executedreport-get.html',
    },
    {
      name: 'render-executive-book',
      description: 'Produce a briefing book from an existing native book.',
      content:
        '# Produce a briefing book from an existing native book.\n\n## Steps\n1. Use List Books and retain bookId.\n2. Inspect Get Book Global POV.\n3. Run Download Book Output with PDF and the required POV.\n4. Return the stored file, subject to the 100 MiB cap.\n\n## Output\nReturn the operation result and any job ID or stored file; do not imply completion on timeout.\n\nSource: https://www.oracle.com/performance-management/narrative-reporting/',
    },
    {
      name: 'refresh-package-data',
      description: 'Refresh an existing package and track the Oracle job.',
      content:
        '# Refresh an existing package and track the Oracle job.\n\n## Steps\n1. Confirm the package name or path; do not substitute its UUID.\n2. Run Refresh Package Data Sources once.\n3. Pass job.jobId to Wait for Job.\n4. Report completed and timedOut separately. A timeout does not cancel the job.\n\n## Output\nReturn the operation result and any job ID or stored file; do not imply completion on timeout.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-reporting-cloud/raepr/op-https-servername-port-number-epm-rest-v1-jobs-post.html',
    },
    {
      name: 'inventory-library-artifacts',
      description: 'Inspect the library without changing provider content.',
      content:
        '# Inspect the library without changing provider content.\n\n## Steps\n1. Run List Library Artifacts with a page limit no greater than 100.\n2. Retain repository artifactId values, names, and metadata.\n3. Advance offset while the provider reports more results, with a workflow-level page bound.\n4. Never reuse an artifactId as a report or package ID without verified compatibility.\n\n## Output\nReturn the operation result and any job ID or stored file; do not imply completion on timeout.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-reporting-cloud/raepr/op-epm-rest-v1-artifacts-get.html',
    },
    {
      name: 'checkpoint-report-snapshot',
      description: 'Capture a report snapshot for a reporting checkpoint, not a database backup.',
      content:
        '# Capture a report snapshot for a reporting checkpoint, not a database backup.\n\n## Steps\n1. Identify a report using List Reports.\n2. Submit Create Report Snapshot with its reportId, the destination, and a snapshot name.\n3. Wait for the returned job separately.\n4. List Report Snapshots to discover the resulting native ID and download its output if no larger than 100 MiB.\n\n## Output\nReturn the operation result and any job ID or stored file; do not imply completion on timeout.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-reporting-cloud/raepr/op-https-servername-port-number-epm-rest-v1-jobs-post.html',
    },
    {
      name: 'track-library-transfer',
      description:
        'Track an authorized artifact export or import without following unverified URLs.',
      content:
        '# Track an authorized artifact export or import without following unverified URLs.\n\n## Steps\n1. Obtain explicit approval and the provider-side artifact or import file reference.\n2. Submit Export Library Artifact or Import Library Artifact once.\n3. Wait for Job with the returned ID.\n4. Verify Library destinations through List Library Artifacts. Do not promise automatic Temporary-export downloading; its result-link relations require upstream support.\n\n## Output\nReturn the operation result and any job ID or stored file; do not imply completion on timeout.\n\nSource: https://docs.oracle.com/en/cloud/saas/enterprise-performance-reporting-cloud/raepr/op-https-servername-port-number-epm-rest-v1-jobs-jobid-get.html',
    },
  ],
} as const satisfies BlockMeta
