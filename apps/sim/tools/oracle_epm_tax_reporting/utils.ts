import type { OAuthConfig, ToolConfig } from '@/tools/types'

export const taxOAuth = {
  required: true,
  provider: 'oracle_epm_tax_reporting',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} satisfies OAuthConfig

export const taxAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle EPM service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Credential material injected by the executor',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Credential-bound Oracle environment URL injected by the executor',
  },
} satisfies ToolConfig['params']

/** Shared descriptions for the finite Tax Reporting tool inputs. */
export const taxFields = {
  application: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Exact Tax Reporting application name; use application discovery or a tenant-specific reference.',
  },
  jobType: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Supported saved job type: RULES, RULESET, EXPORT_METADATA, or IMPORT_METADATA.',
  },
  jobName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Exact deployed rule, ruleset, or saved job definition name. Names are case-sensitive.',
  },
  parameters: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'JSON object of documented job parameters or tenant-defined runtime prompts. Rule prompt values must be strings; preserve exact prompt names.',
  },
  dimension: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Exact dimension name, such as Entity or Jurisdiction, as configured in this tenant.',
  },
  memberName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact dimension member name.',
  },
  parentName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Parent member enabled for dynamic children, after a cube refresh.',
  },
  planType: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact Tax Reporting cube/plan type name configured in the application.',
  },
  gridDefinition: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON region with pov: {dimensions?: string[], members: string[][]}, columns and rows arrays of the same axis shape. Use exact tenant dimension/member names or documented member-selection expressions. Optional suppressMissingBlocks, suppressMissingRows, suppressMissingColumns booleans.',
  },
  dataGrid: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON grid with pov: string[], columns: string[][], rows: [{headers: string[], data: (string | number)[]}]. Values overwrite existing cells by default; #missing clears a cell. Cell notes and supporting details are not handled by this tool.',
  },
  aggregateEssbaseData: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Add numeric values to existing values when true; overwrite when false. Do not retry an uncertain additive import.',
  },
  dateFormat: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Data slices: MM-DD-YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, or YYYY/MM/DD. Supplemental member import: the tenant CSV date format (Oracle default MM-dd-yyyy).',
  },
  strictDateValidation: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Reject dates that do not match dateFormat (Oracle default true).',
  },
  clearEssbaseData: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Clear numeric cube data (default true). This is destructive.',
  },
  clearPlanningData: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Delete cell notes, attachments, and supporting details (default false). This is destructive.',
  },
  profileName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Name of an existing Tax Reporting copy or clear data profile; its saved configuration determines the affected POV.',
  },
  waitForCompletion: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Wait at most 120 seconds, subject to the execution deadline. Default false. Timeout or local cancellation does not cancel the Oracle job; check its status before resubmitting.',
  },
  jobId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Submitted Oracle job instance ID, not a job definition name.',
  },
  jobFamily: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'planning (default), supplemental_collection (fcmjobs), or supplemental_dimension (sdm/jobs). Use the family that submitted the job.',
  },
  childJobId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Child job ID from the parent job details child-job-details link.',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Page size, 1-100 (default 25). One page is returned.',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Zero-based offset, 0-100000 (default 0). No automatic fetch-all.',
  },
  messageType: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Filter detailed messages by INFO, ERROR, or WARNING.',
  },
  exportZipFileName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Optional ZIP output filename for the saved metadata export job.',
  },
  importZipFileName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Optional ZIP filename already uploaded to the Oracle repository for the saved metadata import job.',
  },
  refreshCube: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Refresh the cube after importing metadata when true.',
  },
  errorFile: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'ZIP filename for metadata import errors; an existing file of the same name is overwritten.',
  },
  fileName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Exact Oracle repository filename/path. Supply raw names, not pre-encoded URL text. Upload fails if a file already exists.',
  },
  collection: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact Supplemental Data collection name. Supplemental Data must be enabled.',
  },
  year: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Collection year member, for example FY26; tenant-specific.',
  },
  period: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Collection period member, for example Jan; tenant-specific.',
  },
  frequencyDimensions: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'JSON object of additional collection-interval frequency dimension names and member strings. Preserve case. For template deployment supply all configured dimensions (up to four), including Year/Period when applicable.',
  },
  collectionIntervalName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Existing Supplemental Data collection interval name.',
  },
  templates: {
    type: 'array',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Template name array. An explicit empty array deploys ALL templates for the interval; use named templates to limit scope.',
  },
  resetWorkflows: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Reset existing form workflows during deployment (default false).',
  },
  importMode: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Replace (default) or Update supplemental dimension members. Replace can remove existing members.',
  },
  delimiter: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Single-character supplemental CSV delimiter (Oracle default comma).',
  },
  groupName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Configured report group, such as Task Manager.',
  },
  reportName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact existing report name. Provide all parameters required by that report.',
  },
  generatedReportFileName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Output filename with matching extension. Existing files with this name are overwritten. Defaults to the report name in Oracle.',
  },
  format: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Report format.',
  },
  module: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Report generation: FCM (Task Manager) or SDM. Report status: FCCS (Task Manager) or SDM.',
  },
  reportStatusRoute: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'standalone (default): documented /arm job endpoint; generated_report: route used by Generate Report Job Status links; user_details: route used by User Details Job Status links. They are not interchangeable.',
  },
  downloadReport: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Store the completed report as a Sim file using its validated report-content link (default false). Requires a workflow execution context.',
  },
  file: {
    type: 'file',
    required: true,
    visibility: 'user-or-llm',
    description:
      'One authorized Sim UserFile to upload, up to 10 MiB. URLs alone are not accepted.',
  },
  directory: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Optional Oracle inbox or outbox directory, including a subdirectory. Other EPM product directories are not supported.',
  },
} satisfies ToolConfig['params']

/** Bound caller JSON before parsing or schema cloning (NetSuite request-budget precedent). */
export const TAX_INPUT_BYTES = 2 * 1024 * 1024
export function assertTaxInputBudget(input: unknown): void {
  let bytes = 0
  let nodes = 0
  const ancestors = new WeakSet<object>()
  const encoder = new TextEncoder()
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 12)
      throw new Error('Tax Reporting input exceeds the supported structural budget')
    if (typeof value === 'string') {
      if (value.length > TAX_INPUT_BYTES) throw new Error('Tax Reporting input exceeds 2 MiB')
      bytes += encoder.encode(JSON.stringify(value)).byteLength
    } else if (value && typeof value === 'object') {
      if (ancestors.has(value)) throw new Error('Tax Reporting input must not contain cycles')
      const keys = Object.keys(value)
      if (keys.length > 100000 - nodes)
        throw new Error('Tax Reporting input exceeds the supported structural budget')
      ancestors.add(value)
      bytes += 2 + keys.length * 2
      for (const key of keys) {
        const property = Object.getOwnPropertyDescriptor(value, key)
        if (!property || !('value' in property))
          throw new Error('Tax Reporting input must contain data values')
        if (!Array.isArray(value)) visit(key, depth + 1)
        visit(property.value, depth + 1)
      }
      ancestors.delete(value)
    } else if (value == null || ['boolean', 'number', 'undefined'].includes(typeof value)) {
      bytes += 24
    } else {
      throw new Error('Tax Reporting input must contain JSON data')
    }
    if (bytes > TAX_INPUT_BYTES) throw new Error('Tax Reporting input exceeds 2 MiB')
  }
  visit(input, 0)
}

/** Called after variable resolution in the block params callback, never during tool selection. */
export function parseTaxJsonInput(value: unknown, label: string): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  if (
    value.length > TAX_INPUT_BYTES ||
    new TextEncoder().encode(value).byteLength > TAX_INPUT_BYTES
  ) {
    throw new Error(`${label} exceeds 2 MiB`)
  }
  try {
    const parsed: unknown = JSON.parse(value)
    assertTaxInputBudget(parsed)
    return parsed
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

export function parseTaxBooleanInput(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Expected true or false')
}
