import { VantaIcon } from '@/components/icons'
import { VantaBlockDisplay } from '@/blocks/blocks/vanta.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { ToolResponse } from '@/tools/types'

const LIST_OPERATIONS = [
  'list_frameworks',
  'list_framework_controls',
  'list_controls',
  'list_control_tests',
  'list_control_documents',
  'list_tests',
  'list_test_entities',
  'list_documents',
  'list_document_uploads',
  'list_people',
  'list_policies',
  'list_vendors',
  'list_monitored_computers',
  'list_vulnerabilities',
  'list_vulnerability_remediations',
  'list_vulnerable_assets',
  'list_risk_scenarios',
]

const DOCUMENT_ID_OPERATIONS = [
  'get_document',
  'list_document_uploads',
  'upload_document_file',
  'download_document_file',
  'submit_document',
]

const CONTROL_ID_OPERATIONS = ['get_control', 'list_control_tests', 'list_control_documents']

/**
 * Maps a tri-state dropdown value ("any" | "true" | "false") to an optional
 * boolean tool param.
 */
function triStateToBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

/** Maps an "all" dropdown sentinel to undefined so no filter is sent. */
function dropdownFilter(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value !== 'all' ? value : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export const VantaBlock: BlockConfig<ToolResponse> = {
  ...VantaBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Frameworks', id: 'list_frameworks' },
        { label: 'Get Framework', id: 'get_framework' },
        { label: 'List Framework Controls', id: 'list_framework_controls' },
        { label: 'List Controls', id: 'list_controls' },
        { label: 'Get Control', id: 'get_control' },
        { label: 'List Control Tests', id: 'list_control_tests' },
        { label: 'List Control Documents', id: 'list_control_documents' },
        { label: 'List Tests', id: 'list_tests' },
        { label: 'Get Test', id: 'get_test' },
        { label: 'List Test Entities', id: 'list_test_entities' },
        { label: 'List Documents', id: 'list_documents' },
        { label: 'Get Document', id: 'get_document' },
        { label: 'List Document Uploads', id: 'list_document_uploads' },
        { label: 'Upload Document File', id: 'upload_document_file' },
        { label: 'Download Document File', id: 'download_document_file' },
        { label: 'Submit Document', id: 'submit_document' },
        { label: 'List People', id: 'list_people' },
        { label: 'Get Person', id: 'get_person' },
        { label: 'List Policies', id: 'list_policies' },
        { label: 'Get Policy', id: 'get_policy' },
        { label: 'List Vendors', id: 'list_vendors' },
        { label: 'Get Vendor', id: 'get_vendor' },
        { label: 'List Monitored Computers', id: 'list_monitored_computers' },
        { label: 'List Vulnerabilities', id: 'list_vulnerabilities' },
        { label: 'List Vulnerability Remediations', id: 'list_vulnerability_remediations' },
        { label: 'List Vulnerable Assets', id: 'list_vulnerable_assets' },
        { label: 'Get Vulnerable Asset', id: 'get_vulnerable_asset' },
        { label: 'List Risk Scenarios', id: 'list_risk_scenarios' },
        { label: 'Get Risk Scenario', id: 'get_risk_scenario' },
      ],
      value: () => 'list_frameworks',
    },
    {
      id: 'frameworkId',
      title: 'Framework ID',
      type: 'short-input',
      placeholder: 'Framework ID (e.g., soc2)',
      condition: { field: 'operation', value: ['get_framework', 'list_framework_controls'] },
      required: { field: 'operation', value: ['get_framework', 'list_framework_controls'] },
    },
    {
      id: 'controlId',
      title: 'Control ID',
      type: 'short-input',
      placeholder: 'Control ID',
      condition: { field: 'operation', value: CONTROL_ID_OPERATIONS },
      required: { field: 'operation', value: CONTROL_ID_OPERATIONS },
    },
    {
      id: 'testId',
      title: 'Test ID',
      type: 'short-input',
      placeholder: 'Test ID (e.g., test-aws-cloudtrail-enabled)',
      condition: { field: 'operation', value: ['get_test', 'list_test_entities'] },
      required: { field: 'operation', value: ['get_test', 'list_test_entities'] },
    },
    {
      id: 'entityStatus',
      title: 'Entity Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Failing', id: 'FAILING' },
        { label: 'Deactivated', id: 'DEACTIVATED' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_test_entities' },
    },
    {
      id: 'documentId',
      title: 'Document ID',
      type: 'short-input',
      placeholder: 'Document ID',
      condition: { field: 'operation', value: DOCUMENT_ID_OPERATIONS },
      required: { field: 'operation', value: DOCUMENT_ID_OPERATIONS },
    },
    {
      id: 'uploadedFileId',
      title: 'Uploaded File ID',
      type: 'short-input',
      placeholder: 'Uploaded file ID (from List Document Uploads)',
      condition: { field: 'operation', value: 'download_document_file' },
      required: { field: 'operation', value: 'download_document_file' },
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload evidence file',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: 'upload_document_file' },
      required: { field: 'operation', value: 'upload_document_file' },
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference file from previous blocks',
      mode: 'advanced',
      condition: { field: 'operation', value: 'upload_document_file' },
      required: { field: 'operation', value: 'upload_document_file' },
    },
    {
      id: 'uploadFileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional file name override',
      condition: { field: 'operation', value: 'upload_document_file' },
      mode: 'advanced',
    },
    {
      id: 'uploadMimeType',
      title: 'MIME Type',
      type: 'short-input',
      placeholder: 'e.g., application/pdf (used when the file has no type of its own)',
      condition: { field: 'operation', value: 'upload_document_file' },
      mode: 'advanced',
    },
    {
      id: 'uploadDescription',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Description of the uploaded evidence',
      condition: { field: 'operation', value: 'upload_document_file' },
    },
    {
      id: 'effectiveAtDate',
      title: 'Effective Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2026-06-01)',
      condition: { field: 'operation', value: 'upload_document_file' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2026-06-01) for when the document is effective from. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'frameworkMatchesAny',
      title: 'Framework IDs',
      type: 'short-input',
      placeholder: 'Comma-separated framework IDs (e.g., soc2,iso27001)',
      condition: { field: 'operation', value: ['list_controls', 'list_documents'] },
    },
    {
      id: 'documentStatusFilter',
      title: 'Document Statuses',
      type: 'short-input',
      placeholder: 'Comma-separated: Needs document, Needs update, Not relevant, OK',
      condition: { field: 'operation', value: 'list_documents' },
      mode: 'advanced',
    },
    {
      id: 'statusFilter',
      title: 'Test Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'OK', id: 'OK' },
        { label: 'Needs Attention', id: 'NEEDS_ATTENTION' },
        { label: 'In Progress', id: 'IN_PROGRESS' },
        { label: 'Deactivated', id: 'DEACTIVATED' },
        { label: 'Invalid', id: 'INVALID' },
        { label: 'Not Applicable', id: 'NOT_APPLICABLE' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_tests' },
    },
    {
      id: 'frameworkFilter',
      title: 'Framework ID',
      type: 'short-input',
      placeholder: 'Filter tests by framework ID (e.g., soc2)',
      condition: { field: 'operation', value: 'list_tests' },
    },
    {
      id: 'integrationFilter',
      title: 'Integration ID',
      type: 'short-input',
      placeholder: 'Filter tests by integration ID (e.g., aws)',
      condition: { field: 'operation', value: 'list_tests' },
      mode: 'advanced',
    },
    {
      id: 'controlFilter',
      title: 'Control ID',
      type: 'short-input',
      placeholder: 'Filter tests by control ID',
      condition: { field: 'operation', value: 'list_tests' },
      mode: 'advanced',
    },
    {
      id: 'ownerFilter',
      title: 'Owner User ID',
      type: 'short-input',
      placeholder: 'Filter tests by owner user ID',
      condition: { field: 'operation', value: 'list_tests' },
      mode: 'advanced',
    },
    {
      id: 'categoryFilter',
      title: 'Test Category',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Accounts Access', id: 'ACCOUNTS_ACCESS' },
        { label: 'Account Security', id: 'ACCOUNT_SECURITY' },
        { label: 'Account Setup', id: 'ACCOUNT_SETUP' },
        { label: 'Computers', id: 'COMPUTERS' },
        { label: 'Custom', id: 'CUSTOM' },
        { label: 'Data Storage', id: 'DATA_STORAGE' },
        { label: 'Employees', id: 'EMPLOYEES' },
        { label: 'Infrastructure', id: 'INFRASTRUCTURE' },
        { label: 'IT', id: 'IT' },
        { label: 'Logging', id: 'LOGGING' },
        { label: 'Monitoring Alerts', id: 'MONITORING_ALERTS' },
        { label: 'People', id: 'PEOPLE' },
        { label: 'Policies', id: 'POLICIES' },
        { label: 'Risk Analysis', id: 'RISK_ANALYSIS' },
        { label: 'Security Alert Management', id: 'SECURITY_ALERT_MANAGEMENT' },
        { label: 'Software Development', id: 'SOFTWARE_DEVELOPMENT' },
        { label: 'Vendors', id: 'VENDORS' },
        { label: 'Vulnerability Management', id: 'VULNERABILITY_MANAGEMENT' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_tests' },
      mode: 'advanced',
    },
    {
      id: 'isInRollout',
      title: 'In Rollout',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'list_tests' },
      mode: 'advanced',
    },
    {
      id: 'personId',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Person ID',
      condition: { field: 'operation', value: 'get_person' },
      required: { field: 'operation', value: 'get_person' },
    },
    {
      id: 'emailAndNameFilter',
      title: 'Email or Name',
      type: 'short-input',
      placeholder: 'Filter people by email address or name',
      condition: { field: 'operation', value: 'list_people' },
    },
    {
      id: 'employmentStatus',
      title: 'Employment Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Upcoming', id: 'UPCOMING' },
        { label: 'Current', id: 'CURRENT' },
        { label: 'On Leave', id: 'ON_LEAVE' },
        { label: 'Inactive', id: 'INACTIVE' },
        { label: 'Former', id: 'FORMER' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_people' },
    },
    {
      id: 'groupIdsMatchesAny',
      title: 'Group IDs',
      type: 'short-input',
      placeholder: 'Comma-separated group IDs',
      condition: { field: 'operation', value: 'list_people' },
      mode: 'advanced',
    },
    {
      id: 'tasksSummaryStatusMatchesAny',
      title: 'Task Summary Statuses',
      type: 'short-input',
      placeholder: 'Comma-separated: NONE, DUE_SOON, OVERDUE, COMPLETE, PAUSED, ...',
      condition: { field: 'operation', value: 'list_people' },
      mode: 'advanced',
    },
    {
      id: 'taskTypeMatchesAny',
      title: 'Task Types',
      type: 'short-input',
      placeholder: 'Comma-separated: COMPLETE_TRAININGS, ACCEPT_POLICIES, ...',
      condition: { field: 'operation', value: 'list_people' },
      mode: 'advanced',
    },
    {
      id: 'taskStatusMatchesAny',
      title: 'Task Statuses',
      type: 'short-input',
      placeholder: 'Comma-separated: COMPLETE, DUE_SOON, OVERDUE, NONE',
      condition: { field: 'operation', value: 'list_people' },
      mode: 'advanced',
    },
    {
      id: 'policyId',
      title: 'Policy ID',
      type: 'short-input',
      placeholder: 'Policy ID',
      condition: { field: 'operation', value: 'get_policy' },
      required: { field: 'operation', value: 'get_policy' },
    },
    {
      id: 'vendorId',
      title: 'Vendor ID',
      type: 'short-input',
      placeholder: 'Vendor ID',
      condition: { field: 'operation', value: 'get_vendor' },
      required: { field: 'operation', value: 'get_vendor' },
    },
    {
      id: 'vendorName',
      title: 'Vendor Name',
      type: 'short-input',
      placeholder: 'Filter vendors by name',
      condition: { field: 'operation', value: 'list_vendors' },
    },
    {
      id: 'vendorStatusFilter',
      title: 'Vendor Statuses',
      type: 'short-input',
      placeholder: 'Comma-separated: MANAGED, ARCHIVED, IN_PROCUREMENT',
      condition: { field: 'operation', value: 'list_vendors' },
      mode: 'advanced',
    },
    {
      id: 'complianceStatusFilterMatchesAny',
      title: 'Compliance Issues',
      type: 'short-input',
      placeholder: 'Comma-separated: HD_NOT_ENCRYPTED, AV_NOT_INSTALLED, ...',
      condition: { field: 'operation', value: 'list_monitored_computers' },
      mode: 'advanced',
    },
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search query',
      condition: { field: 'operation', value: ['list_vulnerabilities', 'list_vulnerable_assets'] },
    },
    {
      id: 'severity',
      title: 'Severity',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Critical', id: 'CRITICAL' },
        { label: 'High', id: 'HIGH' },
        { label: 'Medium', id: 'MEDIUM' },
        { label: 'Low', id: 'LOW' },
      ],
      value: () => 'all',
      condition: {
        field: 'operation',
        value: ['list_vulnerabilities', 'list_vulnerability_remediations'],
      },
    },
    {
      id: 'integrationId',
      title: 'Integration ID',
      type: 'short-input',
      placeholder: 'Filter by integration ID',
      condition: {
        field: 'operation',
        value: [
          'list_vulnerabilities',
          'list_vulnerability_remediations',
          'list_vulnerable_assets',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'isFixAvailable',
      title: 'Fix Available',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'list_vulnerabilities' },
      mode: 'advanced',
    },
    {
      id: 'isDeactivated',
      title: 'Deactivated',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'list_vulnerabilities' },
      mode: 'advanced',
    },
    {
      id: 'includeVulnerabilitiesWithoutSlas',
      title: 'Include Without SLAs',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'list_vulnerabilities' },
      mode: 'advanced',
    },
    {
      id: 'packageIdentifier',
      title: 'Package Identifier',
      type: 'short-input',
      placeholder: 'Filter by affected package',
      condition: { field: 'operation', value: 'list_vulnerabilities' },
      mode: 'advanced',
    },
    {
      id: 'externalVulnerabilityId',
      title: 'External Vulnerability ID',
      type: 'short-input',
      placeholder: 'Filter by external ID (e.g., CVE-2026-1234)',
      condition: { field: 'operation', value: 'list_vulnerabilities' },
      mode: 'advanced',
    },
    {
      id: 'vulnerableAssetId',
      title: 'Vulnerable Asset ID',
      type: 'short-input',
      placeholder: 'Vulnerable asset ID',
      condition: {
        field: 'operation',
        value: ['list_vulnerabilities', 'get_vulnerable_asset'],
      },
      required: { field: 'operation', value: 'get_vulnerable_asset' },
    },
    {
      id: 'slaDeadlineAfterDate',
      title: 'SLA Deadline After',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2026-06-01)',
      condition: { field: 'operation', value: 'list_vulnerabilities' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2026-06-01) for the start of the SLA deadline range. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'slaDeadlineBeforeDate',
      title: 'SLA Deadline Before',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2026-06-30)',
      condition: { field: 'operation', value: 'list_vulnerabilities' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2026-06-30) for the end of the SLA deadline range. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'isRemediatedOnTime',
      title: 'Remediated On Time',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'list_vulnerability_remediations' },
      mode: 'advanced',
    },
    {
      id: 'remediatedAfterDate',
      title: 'Remediated After',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2026-06-01)',
      condition: { field: 'operation', value: 'list_vulnerability_remediations' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2026-06-01) for the start of the remediation date range. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'remediatedBeforeDate',
      title: 'Remediated Before',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2026-06-30)',
      condition: { field: 'operation', value: 'list_vulnerability_remediations' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 date (e.g., 2026-06-30) for the end of the remediation date range. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'assetType',
      title: 'Asset Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Server', id: 'SERVER' },
        { label: 'Serverless Function', id: 'SERVERLESS_FUNCTION' },
        { label: 'Container', id: 'CONTAINER' },
        { label: 'Container Repository', id: 'CONTAINER_REPOSITORY' },
        { label: 'Container Repository Image', id: 'CONTAINER_REPOSITORY_IMAGE' },
        { label: 'Code Repository', id: 'CODE_REPOSITORY' },
        { label: 'Manifest File', id: 'MANIFEST_FILE' },
        { label: 'Workstation', id: 'WORKSTATION' },
        { label: 'Other', id: 'OTHER' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_vulnerable_assets' },
    },
    {
      id: 'assetExternalAccountId',
      title: 'External Account ID',
      type: 'short-input',
      placeholder: 'Filter assets by external account ID',
      condition: { field: 'operation', value: 'list_vulnerable_assets' },
      mode: 'advanced',
    },
    {
      id: 'riskScenarioId',
      title: 'Risk Scenario ID',
      type: 'short-input',
      placeholder: 'Risk scenario ID',
      condition: { field: 'operation', value: 'get_risk_scenario' },
      required: { field: 'operation', value: 'get_risk_scenario' },
    },
    {
      id: 'searchString',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search risk scenarios',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
    },
    {
      id: 'riskType',
      title: 'Scenario Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Risk Scenario', id: 'Risk Scenario' },
        { label: 'Enterprise Risk', id: 'Enterprise Risk' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'includeIgnored',
      title: 'Include Ignored',
      type: 'dropdown',
      options: [
        { label: 'Any', id: 'any' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'ownerMatchesAny',
      title: 'Owner Emails',
      type: 'short-input',
      placeholder: 'Comma-separated owner emails',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'categoryMatchesAny',
      title: 'Risk Categories',
      type: 'short-input',
      placeholder: 'Comma-separated risk categories',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'ciaCategoryMatchesAny',
      title: 'CIA Categories',
      type: 'short-input',
      placeholder: 'Comma-separated: Confidentiality, Integrity, Availability',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'treatmentTypeMatchesAny',
      title: 'Treatments',
      type: 'short-input',
      placeholder: 'Comma-separated: Mitigate, Transfer, Avoid, Accept',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'inherentScoreGroupMatchesAny',
      title: 'Inherent Score Groups',
      type: 'short-input',
      placeholder: 'Comma-separated: Very low, Low, Med, High, Critical',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'residualScoreGroupMatchesAny',
      title: 'Residual Score Groups',
      type: 'short-input',
      placeholder: 'Comma-separated: Very low, Low, Med, High, Critical',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'reviewStatusMatchesAny',
      title: 'Review Statuses',
      type: 'short-input',
      placeholder: 'Comma-separated: APPROVED, DRAFT, NOT_REVIEWED, ...',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'dropdown',
      options: [
        { label: 'Default', id: 'all' },
        { label: 'Description', id: 'description' },
        { label: 'Created At', id: 'createdAt' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '10 (max 100)',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'pageCursor',
      title: 'Page Cursor',
      type: 'short-input',
      placeholder: 'endCursor from the previous response',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'dropdown',
      options: [
        { label: 'US (api.vanta.com)', id: 'us' },
        { label: 'Gov / FedRAMP (api.vanta-gov.com)', id: 'gov' },
      ],
      value: () => 'us',
      mode: 'advanced',
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'Vanta OAuth application client ID',
      required: true,
    },
    {
      id: 'clientSecret',
      title: 'Client Secret',
      type: 'short-input',
      placeholder: 'Vanta OAuth application client secret',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'vanta_list_frameworks',
      'vanta_get_framework',
      'vanta_list_framework_controls',
      'vanta_list_controls',
      'vanta_get_control',
      'vanta_list_control_tests',
      'vanta_list_control_documents',
      'vanta_list_tests',
      'vanta_get_test',
      'vanta_list_test_entities',
      'vanta_list_documents',
      'vanta_get_document',
      'vanta_list_document_uploads',
      'vanta_upload_document_file',
      'vanta_download_document_file',
      'vanta_submit_document',
      'vanta_list_people',
      'vanta_get_person',
      'vanta_list_policies',
      'vanta_get_policy',
      'vanta_list_vendors',
      'vanta_get_vendor',
      'vanta_list_monitored_computers',
      'vanta_list_vulnerabilities',
      'vanta_list_vulnerability_remediations',
      'vanta_list_vulnerable_assets',
      'vanta_get_vulnerable_asset',
      'vanta_list_risk_scenarios',
      'vanta_get_risk_scenario',
    ],
    config: {
      tool: (params) => `vanta_${params.operation}`,
      params: (params) => {
        const { operation, ...rest } = params
        const result: Record<string, unknown> = {}

        result.region = dropdownFilter(rest.region) ?? 'us'

        if (LIST_OPERATIONS.includes(operation)) {
          result.pageSize =
            rest.pageSize !== undefined && rest.pageSize !== '' && rest.pageSize !== null
              ? Number(rest.pageSize)
              : undefined
          result.pageCursor = optionalString(rest.pageCursor)
        }

        switch (operation) {
          case 'list_test_entities':
            result.entityStatus = dropdownFilter(rest.entityStatus)
            break
          case 'upload_document_file': {
            const normalizedFile = normalizeFileInput(rest.file, { single: true })
            if (normalizedFile) result.file = normalizedFile
            result.fileName = optionalString(rest.uploadFileName)
            result.mimeType = optionalString(rest.uploadMimeType)
            result.description = optionalString(rest.uploadDescription)
            result.effectiveAtDate = optionalString(rest.effectiveAtDate)
            break
          }
          case 'list_documents':
            result.statusMatchesAny = optionalString(rest.documentStatusFilter)
            break
          case 'list_tests':
            result.statusFilter = dropdownFilter(rest.statusFilter)
            result.categoryFilter = dropdownFilter(rest.categoryFilter)
            result.isInRollout = triStateToBoolean(rest.isInRollout)
            break
          case 'list_people':
            result.employmentStatus = dropdownFilter(rest.employmentStatus)
            break
          case 'list_vendors':
            result.name = optionalString(rest.vendorName)
            result.statusMatchesAny = optionalString(rest.vendorStatusFilter)
            break
          case 'list_vulnerabilities':
            result.q = optionalString(rest.searchQuery)
            result.severity = dropdownFilter(rest.severity)
            result.isFixAvailable = triStateToBoolean(rest.isFixAvailable)
            result.isDeactivated = triStateToBoolean(rest.isDeactivated)
            result.includeVulnerabilitiesWithoutSlas = triStateToBoolean(
              rest.includeVulnerabilitiesWithoutSlas
            )
            break
          case 'list_vulnerability_remediations':
            result.severity = dropdownFilter(rest.severity)
            result.isRemediatedOnTime = triStateToBoolean(rest.isRemediatedOnTime)
            break
          case 'list_vulnerable_assets':
            result.q = optionalString(rest.searchQuery)
            result.assetType = dropdownFilter(rest.assetType)
            break
          case 'list_risk_scenarios':
            result.type = dropdownFilter(rest.riskType)
            result.includeIgnored = triStateToBoolean(rest.includeIgnored)
            result.orderBy = dropdownFilter(rest.orderBy)
            break
          default:
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    clientId: { type: 'string', description: 'Vanta OAuth application client ID' },
    clientSecret: { type: 'string', description: 'Vanta OAuth application client secret' },
    region: { type: 'string', description: 'Vanta API region (us or gov)' },
    frameworkId: { type: 'string', description: 'Framework ID' },
    controlId: { type: 'string', description: 'Control ID' },
    testId: { type: 'string', description: 'Test ID' },
    entityStatus: { type: 'string', description: 'Test entity status filter' },
    documentId: { type: 'string', description: 'Document ID' },
    uploadedFileId: { type: 'string', description: 'Uploaded file ID' },
    file: { type: 'json', description: 'Evidence file to upload' },
    uploadFileName: { type: 'string', description: 'Optional file name override' },
    uploadMimeType: {
      type: 'string',
      description: 'MIME type override used when the uploaded content has no type of its own',
    },
    uploadDescription: { type: 'string', description: 'Description of the uploaded evidence' },
    effectiveAtDate: { type: 'string', description: 'Effective date of the document (ISO 8601)' },
    frameworkMatchesAny: { type: 'string', description: 'Comma-separated framework ID filters' },
    documentStatusFilter: { type: 'string', description: 'Comma-separated document statuses' },
    statusFilter: { type: 'string', description: 'Test status filter' },
    frameworkFilter: { type: 'string', description: 'Framework ID filter for tests' },
    integrationFilter: { type: 'string', description: 'Integration ID filter for tests' },
    controlFilter: { type: 'string', description: 'Control ID filter for tests' },
    ownerFilter: { type: 'string', description: 'Owner user ID filter for tests' },
    categoryFilter: { type: 'string', description: 'Test category filter' },
    isInRollout: { type: 'string', description: 'Rollout filter (any, true, or false)' },
    personId: { type: 'string', description: 'Person ID' },
    emailAndNameFilter: { type: 'string', description: 'Email or name filter for people' },
    employmentStatus: { type: 'string', description: 'Employment status filter' },
    groupIdsMatchesAny: { type: 'string', description: 'Comma-separated group ID filters' },
    tasksSummaryStatusMatchesAny: {
      type: 'string',
      description: 'Comma-separated task summary status filters',
    },
    taskTypeMatchesAny: { type: 'string', description: 'Comma-separated task type filters' },
    taskStatusMatchesAny: { type: 'string', description: 'Comma-separated task status filters' },
    policyId: { type: 'string', description: 'Policy ID' },
    vendorId: { type: 'string', description: 'Vendor ID' },
    vendorName: { type: 'string', description: 'Vendor name filter' },
    vendorStatusFilter: { type: 'string', description: 'Comma-separated vendor statuses' },
    complianceStatusFilterMatchesAny: {
      type: 'string',
      description: 'Comma-separated computer compliance issue filters',
    },
    searchQuery: { type: 'string', description: 'Search query' },
    severity: { type: 'string', description: 'Severity filter' },
    integrationId: { type: 'string', description: 'Integration ID filter' },
    isFixAvailable: { type: 'string', description: 'Fix availability filter (any, true, false)' },
    isDeactivated: { type: 'string', description: 'Deactivation filter (any, true, false)' },
    includeVulnerabilitiesWithoutSlas: {
      type: 'string',
      description: 'Include vulnerabilities without SLAs (any, true, false)',
    },
    packageIdentifier: { type: 'string', description: 'Package identifier filter' },
    externalVulnerabilityId: { type: 'string', description: 'External vulnerability ID filter' },
    vulnerableAssetId: { type: 'string', description: 'Vulnerable asset ID' },
    slaDeadlineAfterDate: { type: 'string', description: 'SLA deadline range start (ISO 8601)' },
    slaDeadlineBeforeDate: { type: 'string', description: 'SLA deadline range end (ISO 8601)' },
    isRemediatedOnTime: {
      type: 'string',
      description: 'On-time remediation filter (any, true, false)',
    },
    remediatedAfterDate: { type: 'string', description: 'Remediation range start (ISO 8601)' },
    remediatedBeforeDate: { type: 'string', description: 'Remediation range end (ISO 8601)' },
    assetType: { type: 'string', description: 'Vulnerable asset type filter' },
    assetExternalAccountId: { type: 'string', description: 'External account ID filter' },
    riskScenarioId: { type: 'string', description: 'Risk scenario ID' },
    searchString: { type: 'string', description: 'Search string for risk scenarios' },
    riskType: { type: 'string', description: 'Risk scenario type filter' },
    includeIgnored: { type: 'string', description: 'Include ignored scenarios (any, true, false)' },
    ownerMatchesAny: { type: 'string', description: 'Comma-separated owner email filters' },
    categoryMatchesAny: { type: 'string', description: 'Comma-separated risk category filters' },
    ciaCategoryMatchesAny: { type: 'string', description: 'Comma-separated CIA category filters' },
    treatmentTypeMatchesAny: { type: 'string', description: 'Comma-separated treatment filters' },
    inherentScoreGroupMatchesAny: {
      type: 'string',
      description: 'Comma-separated inherent score group filters',
    },
    residualScoreGroupMatchesAny: {
      type: 'string',
      description: 'Comma-separated residual score group filters',
    },
    reviewStatusMatchesAny: {
      type: 'string',
      description: 'Comma-separated review status filters',
    },
    orderBy: { type: 'string', description: 'Risk scenario sort field (description or createdAt)' },
    pageSize: { type: 'number', description: 'Maximum number of items per page (1-100)' },
    pageCursor: { type: 'string', description: 'Pagination cursor from the previous response' },
  },
  outputs: {
    frameworks: {
      type: 'array',
      description: 'Frameworks in the Vanta account',
      condition: { field: 'operation', value: 'list_frameworks' },
    },
    framework: {
      type: 'json',
      description: 'The requested framework with requirement categories',
      condition: { field: 'operation', value: 'get_framework' },
    },
    controls: {
      type: 'array',
      description: 'Controls matching the filters',
      condition: { field: 'operation', value: ['list_controls', 'list_framework_controls'] },
    },
    control: {
      type: 'json',
      description: 'The requested control',
      condition: { field: 'operation', value: 'get_control' },
    },
    tests: {
      type: 'array',
      description: 'Tests matching the filters',
      condition: { field: 'operation', value: ['list_tests', 'list_control_tests'] },
    },
    test: {
      type: 'json',
      description: 'The requested test',
      condition: { field: 'operation', value: 'get_test' },
    },
    entities: {
      type: 'array',
      description: 'Failing or deactivated entities for the test',
      condition: { field: 'operation', value: 'list_test_entities' },
    },
    documents: {
      type: 'array',
      description: 'Documents matching the filters',
      condition: { field: 'operation', value: ['list_documents', 'list_control_documents'] },
    },
    document: {
      type: 'json',
      description: 'The requested document',
      condition: { field: 'operation', value: 'get_document' },
    },
    uploads: {
      type: 'array',
      description: 'Files uploaded to the document',
      condition: { field: 'operation', value: 'list_document_uploads' },
    },
    upload: {
      type: 'json',
      description: 'Metadata of the uploaded file',
      condition: { field: 'operation', value: 'upload_document_file' },
    },
    file: {
      type: 'file',
      description: 'Downloaded file stored in execution files',
      condition: { field: 'operation', value: 'download_document_file' },
    },
    name: {
      type: 'string',
      description: 'Name of the downloaded file',
      condition: { field: 'operation', value: 'download_document_file' },
    },
    mimeType: {
      type: 'string',
      description: 'MIME type of the downloaded file',
      condition: { field: 'operation', value: 'download_document_file' },
    },
    size: {
      type: 'number',
      description: 'Size of the downloaded file in bytes',
      condition: { field: 'operation', value: 'download_document_file' },
    },
    documentId: {
      type: 'string',
      description: 'ID of the submitted document',
      condition: { field: 'operation', value: 'submit_document' },
    },
    submitted: {
      type: 'boolean',
      description: 'Whether the document collection was submitted',
      condition: { field: 'operation', value: 'submit_document' },
    },
    people: {
      type: 'array',
      description: 'People matching the filters',
      condition: { field: 'operation', value: 'list_people' },
    },
    person: {
      type: 'json',
      description: 'The requested person',
      condition: { field: 'operation', value: 'get_person' },
    },
    policies: {
      type: 'array',
      description: 'Policies in the Vanta account',
      condition: { field: 'operation', value: 'list_policies' },
    },
    policy: {
      type: 'json',
      description: 'The requested policy',
      condition: { field: 'operation', value: 'get_policy' },
    },
    vendors: {
      type: 'array',
      description: 'Vendors matching the filters',
      condition: { field: 'operation', value: 'list_vendors' },
    },
    vendor: {
      type: 'json',
      description: 'The requested vendor',
      condition: { field: 'operation', value: 'get_vendor' },
    },
    computers: {
      type: 'array',
      description: 'Monitored computers matching the filters',
      condition: { field: 'operation', value: 'list_monitored_computers' },
    },
    vulnerabilities: {
      type: 'array',
      description: 'Vulnerabilities matching the filters',
      condition: { field: 'operation', value: 'list_vulnerabilities' },
    },
    remediations: {
      type: 'array',
      description: 'Vulnerability remediations matching the filters',
      condition: { field: 'operation', value: 'list_vulnerability_remediations' },
    },
    assets: {
      type: 'array',
      description: 'Vulnerable assets matching the filters',
      condition: { field: 'operation', value: 'list_vulnerable_assets' },
    },
    asset: {
      type: 'json',
      description: 'The requested vulnerable asset',
      condition: { field: 'operation', value: 'get_vulnerable_asset' },
    },
    riskScenarios: {
      type: 'array',
      description: 'Risk scenarios matching the filters',
      condition: { field: 'operation', value: 'list_risk_scenarios' },
    },
    riskScenario: {
      type: 'json',
      description: 'The requested risk scenario',
      condition: { field: 'operation', value: 'get_risk_scenario' },
    },
    pageInfo: {
      type: 'json',
      description: 'Cursor pagination info (endCursor, hasNextPage) for the returned page',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
  },
}

export const VantaBlockMeta = {
  tags: ['monitoring', 'automation', 'document-processing'],
  url: 'https://www.vanta.com',
  templates: [
    {
      icon: VantaIcon,
      title: 'Vanta failing test alerts',
      prompt:
        'Create a scheduled workflow that lists Vanta tests with status NEEDS_ATTENTION each morning, fetches the failing entities for each test, and posts a remediation digest to a Slack channel.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta evidence uploader',
      prompt:
        'Build a workflow that takes a generated report file, uploads it as evidence to the matching Vanta document with a description and effective date, and then submits the document collection for review.',
      modules: ['files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'document-processing'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta vulnerability SLA watcher',
      prompt:
        'Create a scheduled workflow that lists Vanta vulnerabilities with SLA deadlines in the next 7 days, groups them by severity and vulnerable asset, and emails the security team a prioritized remediation list.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta compliance status report',
      prompt:
        'Build a scheduled workflow that lists Vanta frameworks with their control and test completion counts, has an agent summarize progress and gaps per framework, and writes a weekly compliance report to a table.',
      modules: ['scheduled', 'agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'monitoring'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta onboarding task chaser',
      prompt:
        'Create a scheduled workflow that lists current Vanta people with overdue security tasks, and sends each person a direct Slack message listing what they still need to complete.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation', 'people'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta vendor review pipeline',
      prompt:
        'Build a scheduled workflow that lists Vanta vendors whose next security review is due within 30 days, looks up each vendor’s risk levels and contract dates, and creates a review task in the team’s project tracker.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['automation', 'vendor-management'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: VantaIcon,
      title: 'Vanta compliance Q&A agent',
      prompt:
        'Create an agent that answers compliance questions by querying Vanta: it can look up framework progress, control status, failing tests and their entities, policy approval status, and risk scenarios, and grounds every answer in the returned data.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['agentic', 'research'],
    },
  ],
  skills: [
    {
      name: 'triage-failing-vanta-tests',
      description:
        'Find failing Vanta tests, pull their failing entities, and produce a prioritized remediation list.',
      content:
        '# Triage Failing Vanta Tests\n\nTurn the current Vanta test status into an actionable remediation list.\n\n## Steps\n1. Use List Tests with Test Status set to Needs Attention to find failing tests. Narrow with Framework ID or Integration ID if asked.\n2. For each failing test, use List Test Entities with Entity Status set to Failing to get the exact resources that fail.\n3. Read each test’s failure description and remediation description from the output to explain what is wrong and how to fix it.\n4. Group results by test category and order by the number of failing entities.\n\n## Output\nReturn a prioritized list: test name, why it fails, the failing resources, and the documented remediation steps.',
    },
    {
      name: 'upload-vanta-evidence',
      description:
        'Attach an evidence file to a Vanta document and submit the collection for review.',
      content:
        '# Upload Evidence to Vanta\n\nAttach a file to the right evidence document and make it visible to auditors.\n\n## Steps\n1. Use List Documents (filter by framework or status "Needs document" / "Needs update") to find the target document and note its ID.\n2. Use Upload Document File with the document ID, the file, a clear Description (e.g., "Q3 access review evidence"), and optionally an Effective Date.\n3. Use Submit Document with the same document ID so the evidence moves out of draft and becomes visible to auditors.\n4. Confirm with Get Document that the upload status is now OK.\n\n## Output\nReturn the uploaded file metadata and the document’s final status.',
    },
    {
      name: 'vanta-compliance-snapshot',
      description: 'Summarize framework, control, and test completion across a Vanta account.',
      content:
        '# Vanta Compliance Snapshot\n\nProduce a concise status report across all frameworks.\n\n## Steps\n1. Use List Frameworks to get every framework with its control, document, and test completion counts.\n2. For frameworks that are behind, use List Framework Controls and Get Control to find controls with failing or missing evidence.\n3. Use List Tests with Test Status set to Needs Attention to count open issues per framework.\n4. Compute completion percentages from the numeric outputs (numControlsCompleted / numControlsTotal, etc.).\n\n## Output\nReturn a per-framework table: completion percentages, failing test count, and the controls that need attention.',
    },
    {
      name: 'vanta-vulnerability-sla-report',
      description:
        'List Vanta vulnerabilities approaching their SLA deadlines with affected assets.',
      content:
        '# Vulnerabilities Approaching SLA\n\nFind what must be remediated soon and where.\n\n## Steps\n1. Use List Vulnerabilities with SLA Deadline Before set to the cutoff date (e.g., 7 days from now) and SLA Deadline After set to today.\n2. Narrow with Severity (CRITICAL or HIGH first) and Fix Available set to Yes for quick wins.\n3. For each vulnerability, use Get Vulnerable Asset with its asset ID to identify the affected server, repository, or workstation.\n4. Use List Vulnerability Remediations with Remediated On Time set to No to report recent SLA misses.\n\n## Output\nReturn vulnerabilities grouped by severity with remediate-by dates, fixed versions when available, and the affected assets.',
    },
    {
      name: 'vanta-people-task-audit',
      description: 'Find people with overdue security tasks in Vanta and what each still owes.',
      content:
        '# Audit Outstanding Security Tasks\n\nIdentify who is blocking compliance and why.\n\n## Steps\n1. Use List People with Task Summary Statuses set to OVERDUE,DUE_SOON and Employment Status set to Current.\n2. Read each person’s tasksSummary output for the due date, and use Task Types to narrow to a specific obligation (e.g., COMPLETE_TRAININGS or ACCEPT_POLICIES) when asked.\n3. Use Get Person for any individual to confirm employment, group membership, and leave status before escalating.\n\n## Output\nReturn each person’s name, email, overdue items, and due dates, ordered by how overdue they are.',
    },
  ],
} as const satisfies BlockMeta
