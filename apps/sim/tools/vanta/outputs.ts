import type { OutputProperty } from '@/tools/types'

export const VANTA_PAGE_INFO_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  startCursor: {
    type: 'string',
    description: 'Cursor pointing to the start of the current page',
    optional: true,
  },
  endCursor: {
    type: 'string',
    description:
      'Cursor pointing to the end of the current page; pass as pageCursor to fetch the next page',
    optional: true,
  },
  hasNextPage: { type: 'boolean', description: 'Whether another page exists after this one' },
  hasPreviousPage: { type: 'boolean', description: 'Whether a page exists before this one' },
}

const VANTA_OWNER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique ID of the owner', optional: true },
  displayName: { type: 'string', description: 'Display name of the owner', optional: true },
  emailAddress: { type: 'string', description: 'Email address of the owner', optional: true },
}

const VANTA_CUSTOM_FIELDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Custom field values configured in the Vanta instance',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Custom field label', optional: true },
      value: {
        type: 'json',
        description: 'Custom field value (string or list of strings)',
        optional: true,
      },
    },
  },
}

export const VANTA_FRAMEWORK_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The framework's unique ID" },
  displayName: { type: 'string', description: "The framework's display name" },
  shorthandName: { type: 'string', description: "The short version of the framework's name" },
  description: { type: 'string', description: "The framework's description" },
  numControlsCompleted: {
    type: 'number',
    description: 'Number of completed controls in the framework',
  },
  numControlsTotal: { type: 'number', description: 'Total number of controls in the framework' },
  numDocumentsPassing: {
    type: 'number',
    description: 'Number of passing documents in the framework',
  },
  numDocumentsTotal: { type: 'number', description: 'Total number of documents in the framework' },
  numTestsPassing: { type: 'number', description: 'Number of passing tests in the framework' },
  numTestsTotal: { type: 'number', description: 'Total number of tests in the framework' },
}

export const VANTA_FRAMEWORK_DETAIL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  ...VANTA_FRAMEWORK_OUTPUT_PROPERTIES,
  requirementCategories: {
    type: 'array',
    description:
      "The framework's requirement categories, each with requirements and mapped controls",
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Requirement category ID' },
        name: { type: 'string', description: 'Requirement category name' },
        shorthand: {
          type: 'string',
          description: 'Requirement category short name',
          optional: true,
        },
        requirements: {
          type: 'array',
          description: 'Requirements in this category, each listing its mapped controls',
        },
      },
    },
  },
}

export const VANTA_CONTROL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The control's unique ID" },
  externalId: { type: 'string', description: "The control's external ID", optional: true },
  name: { type: 'string', description: "The control's name" },
  description: { type: 'string', description: "The control's description" },
  source: { type: 'string', description: 'The control source, either "Vanta" or "Custom"' },
  domains: {
    type: 'array',
    description: 'Security domains the control belongs to',
    items: { type: 'string' },
  },
  owner: {
    type: 'json',
    description: "The control's owner",
    optional: true,
    properties: VANTA_OWNER_OUTPUT_PROPERTIES,
  },
  role: { type: 'string', description: "The control's GDPR role, if applicable", optional: true },
  customFields: VANTA_CUSTOM_FIELDS_OUTPUT,
  creationDate: {
    type: 'string',
    description: 'When the control was created (null for Vanta library controls)',
    optional: true,
  },
  modificationDate: {
    type: 'string',
    description: 'When the control was last modified (null for Vanta library controls)',
    optional: true,
  },
}

export const VANTA_CONTROL_DETAIL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  ...VANTA_CONTROL_OUTPUT_PROPERTIES,
  note: { type: 'string', description: 'A user-created note for the control', optional: true },
  status: {
    type: 'string',
    description: 'Control status (NO_EVIDENCE_MAPPED, NOT_STARTED, IN_PROGRESS, or COMPLETED)',
    optional: true,
  },
  numDocumentsPassing: {
    type: 'number',
    description: 'Number of passing documents linked to the control',
    optional: true,
  },
  numDocumentsTotal: {
    type: 'number',
    description: 'Total number of documents linked to the control',
    optional: true,
  },
  numTestsPassing: {
    type: 'number',
    description: 'Number of passing tests linked to the control',
    optional: true,
  },
  numTestsTotal: {
    type: 'number',
    description: 'Total number of tests linked to the control',
    optional: true,
  },
}

export const VANTA_TEST_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The test's unique ID" },
  name: { type: 'string', description: "The test's name" },
  description: { type: 'string', description: "The test's description" },
  failureDescription: { type: 'string', description: "The test's failure description" },
  remediationDescription: { type: 'string', description: "The test's remediation description" },
  category: { type: 'string', description: "The test's category" },
  status: {
    type: 'string',
    description:
      'Test run status (OK, DEACTIVATED, NEEDS_ATTENTION, IN_PROGRESS, INVALID, or NOT_APPLICABLE)',
  },
  integrations: {
    type: 'array',
    description: "The test's third-party integration dependencies",
    items: { type: 'string' },
  },
  lastTestRunDate: { type: 'string', description: 'Timestamp of the last test run' },
  latestFlipDate: {
    type: 'string',
    description: 'Most recent date the test flipped status',
    optional: true,
  },
  version: {
    type: 'json',
    description: "The test's version",
    optional: true,
    properties: {
      major: { type: 'number', description: 'Major version number' },
      minor: { type: 'number', description: 'Minor version number' },
    },
  },
  deactivatedStatusInfo: {
    type: 'json',
    description: "The test's deactivation status",
    optional: true,
    properties: {
      isDeactivated: { type: 'boolean', description: 'Whether the test is deactivated' },
      deactivatedReason: { type: 'string', description: 'Reason for deactivation', optional: true },
      lastUpdatedDate: {
        type: 'string',
        description: 'Date of the last deactivation status update',
        optional: true,
      },
    },
  },
  remediationStatusInfo: {
    type: 'json',
    description: "The test's remediation status",
    optional: true,
    properties: {
      status: { type: 'string', description: 'Remediation status' },
      soonestRemediateByDate: {
        type: 'string',
        description: 'Soonest remediate-by date',
        optional: true,
      },
      itemCount: { type: 'number', description: 'Number of items needing remediation' },
    },
  },
  owner: {
    type: 'json',
    description: "The test's owner",
    optional: true,
    properties: VANTA_OWNER_OUTPUT_PROPERTIES,
  },
}

export const VANTA_TEST_ENTITY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Identifier of the entity' },
  entityStatus: { type: 'string', description: 'Entity status (FAILING or DEACTIVATED)' },
  displayName: { type: 'string', description: 'Display name of the entity' },
  responseType: { type: 'string', description: 'Response type of the entity' },
  deactivatedReason: { type: 'string', description: 'Reason for deactivation', optional: true },
  createdDate: { type: 'string', description: 'Date the entity was first detected' },
  lastUpdatedDate: { type: 'string', description: 'Date of the last update to the entity' },
}

export const VANTA_DOCUMENT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The document's unique ID" },
  title: { type: 'string', description: "The document's title" },
  description: { type: 'string', description: "The document's description" },
  category: { type: 'string', description: "The document's category" },
  ownerId: { type: 'string', description: "User ID of the document's owner", optional: true },
  isSensitive: { type: 'boolean', description: 'Whether the document is sensitive' },
  uploadStatus: {
    type: 'string',
    description: 'Document status ("Needs document", "Needs update", "Not relevant", or "OK")',
  },
  uploadStatusDate: {
    type: 'string',
    description: 'Date the upload status last changed',
    optional: true,
  },
  url: { type: 'string', description: 'URL to view the document within Vanta', optional: true },
}

export const VANTA_DOCUMENT_DETAIL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  ...VANTA_DOCUMENT_OUTPUT_PROPERTIES,
  note: { type: 'string', description: 'A user note for the document', optional: true },
  nextRenewalDate: {
    type: 'string',
    description: 'When the document needs to be renewed',
    optional: true,
  },
  renewalCadence: {
    type: 'string',
    description: 'How often the document must be renewed',
    optional: true,
  },
  reminderWindow: {
    type: 'string',
    description: 'Reminder window ahead of the renewal date (P0D, P1D, P1W, P1M, or P3M)',
    optional: true,
  },
  subscribers: {
    type: 'array',
    description: 'Emails subscribed to the document',
    items: { type: 'string' },
  },
  deactivatedStatus: {
    type: 'json',
    description: "The document's deactivation status",
    optional: true,
    properties: {
      isDeactivated: { type: 'boolean', description: 'Whether the document is deactivated' },
      reason: {
        type: 'string',
        description: 'Reason the document was deactivated',
        optional: true,
      },
      creationDate: { type: 'string', description: 'Date the document was deactivated' },
      expiration: { type: 'string', description: 'Date the deactivation expires', optional: true },
    },
  },
}

export const VANTA_UPLOADED_FILE_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique ID of the uploaded file' },
  fileName: { type: 'string', description: 'File name of the upload', optional: true },
  title: { type: 'string', description: 'Title of the upload' },
  description: { type: 'string', description: 'Description of the upload', optional: true },
  mimeType: { type: 'string', description: 'MIME type of the uploaded file' },
  uploadedBy: {
    type: 'json',
    description: 'Actor who uploaded the file (a user or an application)',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Actor ID' },
      type: { type: 'string', description: 'Actor type (USER or APPLICATION)' },
    },
  },
  creationDate: { type: 'string', description: 'Date the file was uploaded' },
  updatedDate: { type: 'string', description: 'Date the file was last updated' },
  deletionDate: {
    type: 'string',
    description: 'Date the file was deleted (null if not deleted)',
    optional: true,
  },
  effectiveDate: { type: 'string', description: "The file's effective date", optional: true },
  url: { type: 'string', description: "The file's URL" },
}

export const VANTA_PERSON_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The person's unique ID" },
  userId: {
    type: 'string',
    description: 'ID of the associated Vanta user account, if one exists',
    optional: true,
  },
  emailAddress: { type: 'string', description: "The person's email address" },
  name: {
    type: 'json',
    description: "The person's name",
    optional: true,
    properties: {
      first: { type: 'string', description: 'First (given) name', optional: true },
      last: { type: 'string', description: 'Last (family) name', optional: true },
      display: { type: 'string', description: 'Display name used in Vanta' },
    },
  },
  employment: {
    type: 'json',
    description: "The person's employment information",
    optional: true,
    properties: {
      status: {
        type: 'string',
        description: 'Employment status (UPCOMING, CURRENT, ON_LEAVE, INACTIVE, or FORMER)',
      },
      startDate: { type: 'string', description: 'Employment start date' },
      endDate: { type: 'string', description: 'Employment end date, if present', optional: true },
      jobTitle: { type: 'string', description: 'Job title', optional: true },
    },
  },
  leaveInfo: {
    type: 'json',
    description: "The person's active or upcoming leave, if any",
    optional: true,
    properties: {
      status: { type: 'string', description: 'Leave status (ACTIVE or UPCOMING)' },
      startDate: { type: 'string', description: 'Start of the leave' },
      endDate: {
        type: 'string',
        description: 'End of the leave (null implies indefinite leave)',
        optional: true,
      },
    },
  },
  groupIds: {
    type: 'array',
    description: 'IDs of the groups the person belongs to',
    items: { type: 'string' },
  },
  tasksSummary: {
    type: 'json',
    description: "Aggregated status of the person's tasks",
    optional: true,
    properties: {
      status: {
        type: 'string',
        description:
          'Overall task status (e.g., NONE, DUE_SOON, OVERDUE, COMPLETE, PAUSED, or an OFFBOARDING_* variant)',
      },
      dueDate: {
        type: 'string',
        description: "Due date of the person's earliest-due task",
        optional: true,
      },
      completionDate: {
        type: 'string',
        description: "Date the person's tasks were completed",
        optional: true,
      },
    },
  },
}

export const VANTA_POLICY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The policy's unique ID" },
  name: { type: 'string', description: "The policy's name" },
  description: { type: 'string', description: "The policy's description" },
  status: { type: 'string', description: 'Policy status (OK or NEEDS_REMEDIATION)' },
  approvedAtDate: {
    type: 'string',
    description: "The policy's most recent approval date, if applicable",
    optional: true,
  },
  latestVersionStatus: {
    type: 'string',
    description:
      "Status of the policy's latest version (NOT_STARTED, DRAFT, PENDING_APPROVAL, APPROVED, RENEW_SOON, or EXPIRED)",
  },
  latestApprovedVersion: {
    type: 'json',
    description: 'The latest approved version of the policy, if available',
    optional: true,
    properties: {
      versionId: { type: 'string', description: 'ID of the latest approved version' },
      documents: {
        type: 'array',
        description: 'Available policy document versions, organized by language',
      },
    },
  },
}

export const VANTA_VENDOR_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: "The vendor's unique ID" },
  name: { type: 'string', description: "The vendor's display name" },
  status: { type: 'string', description: 'Vendor status (MANAGED, ARCHIVED, or IN_PROCUREMENT)' },
  websiteUrl: { type: 'string', description: "The vendor's website URL", optional: true },
  category: {
    type: 'string',
    description: "Display name of the vendor's category",
    optional: true,
  },
  servicesProvided: {
    type: 'string',
    description: 'Services provided by the vendor',
    optional: true,
  },
  additionalNotes: {
    type: 'string',
    description: 'Additional notes about the vendor',
    optional: true,
  },
  accountManagerName: {
    type: 'string',
    description: "The vendor's external account manager name",
    optional: true,
  },
  accountManagerEmail: {
    type: 'string',
    description: "The vendor's external account manager email",
    optional: true,
  },
  securityOwnerUserId: {
    type: 'string',
    description: "Vanta user ID of the vendor's security owner",
    optional: true,
  },
  businessOwnerUserId: {
    type: 'string',
    description: "Vanta user ID of the vendor's business owner",
    optional: true,
  },
  inherentRiskLevel: {
    type: 'string',
    description: 'Inherent risk level (CRITICAL, HIGH, MEDIUM, LOW, or UNSCORED)',
  },
  residualRiskLevel: {
    type: 'string',
    description: 'Residual risk level (CRITICAL, HIGH, MEDIUM, LOW, or UNSCORED)',
  },
  isRiskAutoScored: {
    type: 'boolean',
    description: "Whether the vendor's risk is automatically scored",
    optional: true,
  },
  isVisibleToAuditors: {
    type: 'boolean',
    description: 'Whether auditors can view this vendor',
    optional: true,
  },
  riskAttributeIds: {
    type: 'array',
    description: 'Risk attribute IDs assigned to the vendor',
    items: { type: 'string' },
  },
  vendorHeadquarters: {
    type: 'string',
    description: "Country code of the vendor's headquarters",
    optional: true,
  },
  contractStartDate: {
    type: 'string',
    description: 'Date the vendor contract began',
    optional: true,
  },
  contractRenewalDate: {
    type: 'string',
    description: 'Date the vendor contract is up for renewal',
    optional: true,
  },
  contractTerminationDate: {
    type: 'string',
    description: 'Date the vendor contract was terminated',
    optional: true,
  },
  contractAmount: {
    type: 'json',
    description: 'Contract amount for the vendor',
    optional: true,
    properties: {
      amount: { type: 'number', description: 'Amount of the contract' },
      currency: { type: 'string', description: 'Currency of the contract' },
    },
  },
  nextSecurityReviewDueDate: {
    type: 'string',
    description: 'Next due date for a security review',
    optional: true,
  },
  lastSecurityReviewCompletionDate: {
    type: 'string',
    description: 'Most recent date a security review was completed',
    optional: true,
  },
  authDetails: {
    type: 'json',
    description: "The vendor's authentication details",
    optional: true,
    properties: {
      method: {
        type: 'string',
        description: 'Authentication method (e.g., SSO, OKTA, USERNAME_PASSWORD)',
        optional: true,
      },
      passwordMFA: {
        type: 'boolean',
        description: 'Whether passwords require multi-factor authentication',
        optional: true,
      },
      passwordMinimumLength: {
        type: 'number',
        description: 'Minimum password length',
        optional: true,
      },
      passwordRequiresNumber: {
        type: 'boolean',
        description: 'Whether passwords require a number',
        optional: true,
      },
      passwordRequiresSymbol: {
        type: 'boolean',
        description: 'Whether passwords require a symbol',
        optional: true,
      },
    },
  },
  customFields: VANTA_CUSTOM_FIELDS_OUTPUT,
  latestDecision: {
    type: 'json',
    description: "The vendor's latest decision (null when no decision has been made)",
    optional: true,
    properties: {
      status: {
        type: 'string',
        description: 'Decision status (APPROVED, CONDITIONALLY_APPROVED, or NOT_APPROVED)',
      },
      lastUpdatedAt: { type: 'string', description: 'When the decision was last updated' },
    },
  },
  linkedTaskTrackerTaskProcurementRequest: {
    type: 'json',
    description: 'Linked task tracker procurement request, if any',
    optional: true,
    properties: {
      url: { type: 'string', description: 'URL of the procurement request' },
      service: { type: 'string', description: 'Task tracker service' },
    },
  },
}

export const VANTA_MONITORED_COMPUTER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique identifier of the monitored computer' },
  integrationId: { type: 'string', description: 'Integration that reports this computer' },
  lastCheckDate: {
    type: 'string',
    description: "Date of the computer's most recent report",
    optional: true,
  },
  screenlock: {
    type: 'string',
    description: 'Screenlock check outcome (PASS, FAIL, IN_PROGRESS, or NA)',
  },
  diskEncryption: {
    type: 'string',
    description: 'Disk encryption check outcome (PASS, FAIL, IN_PROGRESS, or NA)',
  },
  passwordManager: {
    type: 'string',
    description: 'Password manager check outcome (PASS, FAIL, IN_PROGRESS, or NA)',
  },
  antivirusInstallation: {
    type: 'string',
    description: 'Antivirus check outcome (PASS, FAIL, IN_PROGRESS, or NA)',
  },
  operatingSystem: {
    type: 'json',
    description: "The computer's operating system",
    optional: true,
    properties: {
      type: { type: 'string', description: 'Operating system type (macOS, linux, or windows)' },
      version: { type: 'string', description: 'Operating system version', optional: true },
    },
  },
  owner: {
    type: 'json',
    description: "The computer's owner",
    optional: true,
    properties: VANTA_OWNER_OUTPUT_PROPERTIES,
  },
  serialNumber: { type: 'string', description: 'Serial number of the computer', optional: true },
  udid: { type: 'string', description: 'Universal device ID of the computer', optional: true },
}

export const VANTA_RISK_SCENARIO_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  riskId: { type: 'string', description: 'Unique user-specified ID of the risk scenario' },
  description: { type: 'string', description: 'Description of the risk scenario' },
  likelihood: {
    type: 'number',
    description: 'Likelihood score (defaults to a 1-5 range; null when unscored)',
    optional: true,
  },
  impact: {
    type: 'number',
    description: 'Impact score (defaults to a 1-5 range; null when unscored)',
    optional: true,
  },
  residualLikelihood: {
    type: 'number',
    description: 'Residual likelihood score after treatments',
    optional: true,
  },
  residualImpact: {
    type: 'number',
    description: 'Residual impact score after treatments',
    optional: true,
  },
  categories: {
    type: 'array',
    description: 'Categories this risk scenario belongs to',
    items: { type: 'string' },
  },
  ciaCategories: {
    type: 'array',
    description: 'CIA categories (Confidentiality, Integrity, Availability)',
    items: { type: 'string' },
  },
  treatment: {
    type: 'string',
    description: 'Risk treatment decision (Mitigate, Transfer, Avoid, or Accept)',
    optional: true,
  },
  owner: {
    type: 'string',
    description: 'Email of the person responsible for this risk',
    optional: true,
  },
  note: {
    type: 'string',
    description: 'Additional context about the risk scenario',
    optional: true,
  },
  riskRegister: {
    type: 'string',
    description: 'Name of the associated risk register',
    optional: true,
  },
  customFields: VANTA_CUSTOM_FIELDS_OUTPUT,
  isArchived: { type: 'boolean', description: 'Whether the scenario is archived' },
  reviewStatus: {
    type: 'string',
    description:
      'Review status (APPROVED, DRAFT, NOT_REVIEWED, AWAITING_SUBMISSION, PENDING_APPROVAL, or REQUESTED_CHANGES)',
  },
  requiredApprovers: {
    type: 'array',
    description: 'Required approvers for this risk scenario',
    items: { type: 'string' },
  },
  type: { type: 'string', description: 'Scenario type ("Risk Scenario" or "Enterprise Risk")' },
  identificationDate: { type: 'string', description: 'Date this risk was identified' },
}

export const VANTA_VULNERABILITY_REMEDIATION_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique identifier of the remediation' },
  vulnerabilityId: { type: 'string', description: 'ID of the remediated vulnerability' },
  vulnerableAssetId: { type: 'string', description: 'ID of the vulnerable asset' },
  severity: { type: 'string', description: 'Severity of the vulnerability' },
  detectedDate: {
    type: 'string',
    description: 'Date the vulnerability was first detected',
    optional: true,
  },
  slaDeadlineDate: { type: 'string', description: 'SLA deadline for remediation', optional: true },
  remediationDate: {
    type: 'string',
    description: 'Date the vulnerability was remediated',
    optional: true,
  },
}

export const VANTA_VULNERABLE_ASSET_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique identifier of the vulnerable asset' },
  name: { type: 'string', description: 'Display name of the vulnerable asset' },
  assetType: {
    type: 'string',
    description:
      'Asset type (e.g., SERVER, SERVERLESS_FUNCTION, CONTAINER_REPOSITORY, CODE_REPOSITORY, WORKSTATION)',
  },
  hasBeenScanned: { type: 'boolean', description: 'Whether the asset has been scanned' },
  imageScanTag: {
    type: 'string',
    description:
      'Container image tag that vulnerabilities are retrieved for (container repositories only)',
    optional: true,
  },
  scanners: {
    type: 'array',
    description:
      'Integrations scanning this asset, with per-scanner asset details (resource ID, hostnames, IPs, image metadata)',
  },
}

export const VANTA_VULNERABILITY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Unique identifier of the vulnerability' },
  name: { type: 'string', description: 'Display name of the vulnerability' },
  description: { type: 'string', description: 'Description of the vulnerability' },
  severity: { type: 'string', description: 'Severity (LOW, MEDIUM, HIGH, or CRITICAL)' },
  vulnerabilityType: {
    type: 'string',
    description: 'Vulnerability type (CONFIGURATION, COMMON, or GROUPED)',
  },
  integrationId: { type: 'string', description: 'Integration that scans this vulnerability' },
  targetId: { type: 'string', description: 'ID of the resource the vulnerability was found on' },
  packageIdentifier: {
    type: 'string',
    description: 'Identifier of the affected package (COMMON and GROUPED vulnerabilities only)',
    optional: true,
  },
  cvssSeverityScore: { type: 'number', description: 'CVSS severity score', optional: true },
  scannerScore: { type: 'number', description: 'Scanner score', optional: true },
  isFixable: { type: 'boolean', description: 'Whether the vulnerability is fixable' },
  fixedVersion: {
    type: 'string',
    description: 'Package version that remediates the vulnerability',
    optional: true,
  },
  remediateByDate: {
    type: 'string',
    description: 'SLA date by which the vulnerability should be remediated',
    optional: true,
  },
  firstDetectedDate: { type: 'string', description: 'Date first detected by Vanta' },
  sourceDetectedDate: {
    type: 'string',
    description: 'Date first detected by the source',
    optional: true,
  },
  lastDetectedDate: { type: 'string', description: 'Date last detected', optional: true },
  scanSource: {
    type: 'string',
    description: 'Scanning tool that detected the vulnerability',
    optional: true,
  },
  externalURL: { type: 'string', description: 'External URL for the vulnerability' },
  relatedVulns: {
    type: 'array',
    description: 'Related vulnerabilities (GROUPED vulnerabilities only)',
    items: { type: 'string' },
  },
  relatedUrls: {
    type: 'array',
    description: 'Related URLs',
    items: { type: 'string' },
  },
  deactivateMetadata: {
    type: 'json',
    description: 'Deactivation metadata, if the vulnerability was deactivated',
    optional: true,
    properties: {
      isVulnDeactivatedIndefinitely: {
        type: 'boolean',
        description: 'Whether deactivated indefinitely',
      },
      deactivatedUntilDate: {
        type: 'string',
        description: 'Date the vulnerability will be reactivated',
        optional: true,
      },
      deactivationReason: { type: 'string', description: 'Reason for deactivation' },
      deactivatedOnDate: { type: 'string', description: 'Date the vulnerability was deactivated' },
      deactivatedBy: { type: 'string', description: 'User who deactivated the vulnerability' },
    },
  },
}
