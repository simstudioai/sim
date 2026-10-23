import type { OutputProperty } from '@/tools/types'

export const VANTA_PAGE_INFO_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  startCursor: {
    type: 'string',
    nullable: true,
    description: 'Cursor pointing to the start of the current page',
  },
  endCursor: {
    type: 'string',
    nullable: true,
    description:
      'Cursor pointing to the end of the current page; pass as pageCursor to fetch the next page',
  },
  hasNextPage: { type: 'boolean', description: 'Whether another page exists after this one' },
  hasPreviousPage: { type: 'boolean', description: 'Whether a page exists before this one' },
}

const VANTA_OWNER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: 'Unique ID of the owner' },
  displayName: { type: 'string', nullable: true, description: 'Display name of the owner' },
  emailAddress: { type: 'string', nullable: true, description: 'Email address of the owner' },
}

const VANTA_CUSTOM_FIELDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Custom field values configured in the Vanta instance',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', nullable: true, description: 'Custom field label' },
      value: {
        type: 'json',
        nullable: true,
        description: 'Custom field value (string or list of strings)',
      },
    },
  },
}

export const VANTA_FRAMEWORK_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: "The framework's unique ID" },
  displayName: { type: 'string', nullable: true, description: "The framework's display name" },
  shorthandName: {
    type: 'string',
    nullable: true,
    description: "The short version of the framework's name",
  },
  description: { type: 'string', nullable: true, description: "The framework's description" },
  numControlsCompleted: {
    type: 'number',
    nullable: true,
    description: 'Number of completed controls in the framework',
  },
  numControlsTotal: {
    type: 'number',
    nullable: true,
    description: 'Total number of controls in the framework',
  },
  numDocumentsPassing: {
    type: 'number',
    nullable: true,
    description: 'Number of passing documents in the framework',
  },
  numDocumentsTotal: {
    type: 'number',
    nullable: true,
    description: 'Total number of documents in the framework',
  },
  numTestsPassing: {
    type: 'number',
    nullable: true,
    description: 'Number of passing tests in the framework',
  },
  numTestsTotal: {
    type: 'number',
    nullable: true,
    description: 'Total number of tests in the framework',
  },
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
        id: { type: 'string', nullable: true, description: 'Requirement category ID' },
        name: { type: 'string', nullable: true, description: 'Requirement category name' },
        shorthand: {
          type: 'string',
          nullable: true,
          description: 'Requirement category short name',
        },
        requirements: {
          type: 'array',
          description: 'Requirements in this category, each listing its mapped controls',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', nullable: true, description: 'Requirement ID' },
              name: { type: 'string', nullable: true, description: 'Requirement name' },
              shorthand: { type: 'string', nullable: true, description: 'Requirement shorthand' },
              description: {
                type: 'string',
                nullable: true,
                description: 'Requirement description',
              },
              controls: {
                type: 'array',
                description: 'Controls mapped to the requirement',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', nullable: true, description: 'Control ID' },
                    externalId: {
                      type: 'string',
                      nullable: true,
                      description: 'External control ID',
                    },
                    name: { type: 'string', nullable: true, description: 'Control name' },
                    description: {
                      type: 'string',
                      nullable: true,
                      description: 'Control description',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

export const VANTA_CONTROL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: "The control's unique ID" },
  externalId: { type: 'string', nullable: true, description: "The control's external ID" },
  name: { type: 'string', nullable: true, description: "The control's name" },
  description: { type: 'string', nullable: true, description: "The control's description" },
  source: {
    type: 'string',
    nullable: true,
    description: 'The control source, either "Vanta" or "Custom"',
  },
  domains: {
    type: 'array',
    description: 'Security domains the control belongs to',
    items: { type: 'string' },
  },
  owner: {
    type: 'json',
    nullable: true,
    description: "The control's owner",
    properties: VANTA_OWNER_OUTPUT_PROPERTIES,
  },
  role: { type: 'string', nullable: true, description: "The control's GDPR role, if applicable" },
  customFields: VANTA_CUSTOM_FIELDS_OUTPUT,
  creationDate: {
    type: 'string',
    nullable: true,
    description: 'When the control was created (null for Vanta library controls)',
  },
  modificationDate: {
    type: 'string',
    nullable: true,
    description: 'When the control was last modified (null for Vanta library controls)',
  },
}

export const VANTA_CONTROL_DETAIL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  ...VANTA_CONTROL_OUTPUT_PROPERTIES,
  note: { type: 'string', nullable: true, description: 'A user-created note for the control' },
  status: {
    type: 'string',
    nullable: true,
    description: 'Control status (NO_EVIDENCE_MAPPED, NOT_STARTED, IN_PROGRESS, or COMPLETED)',
  },
  numDocumentsPassing: {
    type: 'number',
    nullable: true,
    description: 'Number of passing documents linked to the control',
  },
  numDocumentsTotal: {
    type: 'number',
    nullable: true,
    description: 'Total number of documents linked to the control',
  },
  numTestsPassing: {
    type: 'number',
    nullable: true,
    description: 'Number of passing tests linked to the control',
  },
  numTestsTotal: {
    type: 'number',
    nullable: true,
    description: 'Total number of tests linked to the control',
  },
}

export const VANTA_TEST_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: "The test's unique ID" },
  name: { type: 'string', nullable: true, description: "The test's name" },
  description: { type: 'string', nullable: true, description: "The test's description" },
  failureDescription: {
    type: 'string',
    nullable: true,
    description: "The test's failure description",
  },
  remediationDescription: {
    type: 'string',
    nullable: true,
    description: "The test's remediation description",
  },
  category: { type: 'string', nullable: true, description: "The test's category" },
  status: {
    type: 'string',
    nullable: true,
    description:
      'Test run status (OK, DEACTIVATED, NEEDS_ATTENTION, IN_PROGRESS, INVALID, or NOT_APPLICABLE)',
  },
  integrations: {
    type: 'array',
    description: "The test's third-party integration dependencies",
    items: { type: 'string' },
  },
  lastTestRunDate: {
    type: 'string',
    nullable: true,
    description: 'Timestamp of the last test run',
  },
  latestFlipDate: {
    type: 'string',
    nullable: true,
    description: 'Most recent date the test flipped status',
  },
  version: {
    type: 'json',
    nullable: true,
    description: "The test's version",
    properties: {
      major: { type: 'number', nullable: true, description: 'Major version number' },
      minor: { type: 'number', nullable: true, description: 'Minor version number' },
    },
  },
  deactivatedStatusInfo: {
    type: 'json',
    nullable: true,
    description: "The test's deactivation status",
    properties: {
      isDeactivated: {
        type: 'boolean',
        nullable: true,
        description: 'Whether the test is deactivated',
      },
      deactivatedReason: { type: 'string', nullable: true, description: 'Reason for deactivation' },
      lastUpdatedDate: {
        type: 'string',
        nullable: true,
        description: 'Date of the last deactivation status update',
      },
    },
  },
  remediationStatusInfo: {
    type: 'json',
    nullable: true,
    description: "The test's remediation status",
    properties: {
      status: { type: 'string', nullable: true, description: 'Remediation status' },
      soonestRemediateByDate: {
        type: 'string',
        nullable: true,
        description: 'Soonest remediate-by date',
      },
      itemCount: {
        type: 'number',
        nullable: true,
        description: 'Number of items needing remediation',
      },
    },
  },
  owner: {
    type: 'json',
    nullable: true,
    description: "The test's owner",
    properties: VANTA_OWNER_OUTPUT_PROPERTIES,
  },
}

export const VANTA_TEST_ENTITY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: 'Identifier of the entity' },
  entityStatus: {
    type: 'string',
    nullable: true,
    description: 'Entity status (FAILING or DEACTIVATED)',
  },
  displayName: { type: 'string', nullable: true, description: 'Display name of the entity' },
  responseType: { type: 'string', nullable: true, description: 'Response type of the entity' },
  deactivatedReason: { type: 'string', nullable: true, description: 'Reason for deactivation' },
  createdDate: {
    type: 'string',
    nullable: true,
    description: 'Date the entity was first detected',
  },
  lastUpdatedDate: {
    type: 'string',
    nullable: true,
    description: 'Date of the last update to the entity',
  },
}

export const VANTA_DOCUMENT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: "The document's unique ID" },
  title: { type: 'string', nullable: true, description: "The document's title" },
  description: { type: 'string', nullable: true, description: "The document's description" },
  category: { type: 'string', nullable: true, description: "The document's category" },
  ownerId: { type: 'string', nullable: true, description: "User ID of the document's owner" },
  isSensitive: {
    type: 'boolean',
    nullable: true,
    description: 'Whether the document is sensitive',
  },
  uploadStatus: {
    type: 'string',
    nullable: true,
    description: 'Document status ("Needs document", "Needs update", "Not relevant", or "OK")',
  },
  uploadStatusDate: {
    type: 'string',
    nullable: true,
    description: 'Date the upload status last changed',
  },
  url: { type: 'string', nullable: true, description: 'URL to view the document within Vanta' },
}

export const VANTA_DOCUMENT_DETAIL_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  ...VANTA_DOCUMENT_OUTPUT_PROPERTIES,
  note: { type: 'string', nullable: true, description: 'A user note for the document' },
  nextRenewalDate: {
    type: 'string',
    nullable: true,
    description: 'When the document needs to be renewed',
  },
  renewalCadence: {
    type: 'string',
    nullable: true,
    description: 'How often the document must be renewed',
  },
  reminderWindow: {
    type: 'string',
    nullable: true,
    description: 'Reminder window ahead of the renewal date (P0D, P1D, P1W, P1M, or P3M)',
  },
  subscribers: {
    type: 'array',
    description: 'Emails subscribed to the document',
    items: { type: 'string' },
  },
  deactivatedStatus: {
    type: 'json',
    nullable: true,
    description: "The document's deactivation status",
    properties: {
      isDeactivated: {
        type: 'boolean',
        nullable: true,
        description: 'Whether the document is deactivated',
      },
      reason: {
        type: 'string',
        nullable: true,
        description: 'Reason the document was deactivated',
      },
      creationDate: {
        type: 'string',
        nullable: true,
        description: 'Date the document was deactivated',
      },
      expiration: { type: 'string', nullable: true, description: 'Date the deactivation expires' },
    },
  },
}

export const VANTA_UPLOADED_FILE_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: 'Unique ID of the uploaded file' },
  fileName: { type: 'string', nullable: true, description: 'File name of the upload' },
  title: { type: 'string', nullable: true, description: 'Title of the upload' },
  description: { type: 'string', nullable: true, description: 'Description of the upload' },
  mimeType: { type: 'string', nullable: true, description: 'MIME type of the uploaded file' },
  uploadedBy: {
    type: 'json',
    nullable: true,
    description: 'Actor who uploaded the file (a user or an application)',
    properties: {
      id: { type: 'string', nullable: true, description: 'Actor ID' },
      type: { type: 'string', nullable: true, description: 'Actor type (USER or APPLICATION)' },
    },
  },
  creationDate: { type: 'string', nullable: true, description: 'Date the file was uploaded' },
  updatedDate: { type: 'string', nullable: true, description: 'Date the file was last updated' },
  deletionDate: {
    type: 'string',
    nullable: true,
    description: 'Date the file was deleted (null if not deleted)',
  },
  effectiveDate: { type: 'string', nullable: true, description: "The file's effective date" },
  url: { type: 'string', nullable: true, description: "The file's URL" },
}

export const VANTA_PERSON_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: "The person's unique ID" },
  userId: {
    type: 'string',
    nullable: true,
    description: 'ID of the associated Vanta user account, if one exists',
  },
  emailAddress: { type: 'string', nullable: true, description: "The person's email address" },
  name: {
    type: 'json',
    nullable: true,
    description: "The person's name",
    properties: {
      first: { type: 'string', nullable: true, description: 'First (given) name' },
      last: { type: 'string', nullable: true, description: 'Last (family) name' },
      display: { type: 'string', nullable: true, description: 'Display name used in Vanta' },
    },
  },
  employment: {
    type: 'json',
    nullable: true,
    description: "The person's employment information",
    properties: {
      status: {
        type: 'string',
        nullable: true,
        description: 'Employment status (UPCOMING, CURRENT, ON_LEAVE, INACTIVE, or FORMER)',
      },
      startDate: { type: 'string', nullable: true, description: 'Employment start date' },
      endDate: { type: 'string', nullable: true, description: 'Employment end date, if present' },
      jobTitle: { type: 'string', nullable: true, description: 'Job title' },
    },
  },
  leaveInfo: {
    type: 'json',
    nullable: true,
    description: "The person's active or upcoming leave, if any",
    properties: {
      status: { type: 'string', nullable: true, description: 'Leave status (ACTIVE or UPCOMING)' },
      startDate: { type: 'string', nullable: true, description: 'Start of the leave' },
      endDate: {
        type: 'string',
        nullable: true,
        description: 'End of the leave (null implies indefinite leave)',
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
    nullable: true,
    description: "Aggregated status of the person's tasks",
    properties: {
      status: {
        type: 'string',
        nullable: true,
        description:
          'Overall task status (e.g., NONE, DUE_SOON, OVERDUE, COMPLETE, PAUSED, or an OFFBOARDING_* variant)',
      },
      dueDate: {
        type: 'string',
        nullable: true,
        description: "Due date of the person's earliest-due task",
      },
      completionDate: {
        type: 'string',
        nullable: true,
        description: "Date the person's tasks were completed",
      },
    },
  },
}

export const VANTA_POLICY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: "The policy's unique ID" },
  name: { type: 'string', nullable: true, description: "The policy's name" },
  description: { type: 'string', nullable: true, description: "The policy's description" },
  status: {
    type: 'string',
    nullable: true,
    description: 'Policy status (OK or NEEDS_REMEDIATION)',
  },
  approvedAtDate: {
    type: 'string',
    nullable: true,
    description: "The policy's most recent approval date, if applicable",
  },
  latestVersionStatus: {
    type: 'string',
    nullable: true,
    description:
      "Status of the policy's latest version (NOT_STARTED, DRAFT, PENDING_APPROVAL, APPROVED, RENEW_SOON, or EXPIRED)",
  },
  latestApprovedVersion: {
    type: 'json',
    nullable: true,
    description: 'The latest approved version of the policy, if available',
    properties: {
      versionId: {
        type: 'string',
        nullable: true,
        description: 'ID of the latest approved version',
      },
      documents: {
        type: 'array',
        description: 'Available policy document versions, organized by language',
        items: {
          type: 'object',
          properties: {
            language: { type: 'string', nullable: true, description: 'Document language' },
            slugId: { type: 'string', nullable: true, description: 'Document slug ID' },
            url: { type: 'string', nullable: true, description: 'Document URL' },
          },
        },
      },
    },
  },
}

export const VANTA_VENDOR_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: "The vendor's unique ID" },
  name: { type: 'string', nullable: true, description: "The vendor's display name" },
  status: {
    type: 'string',
    nullable: true,
    description: 'Vendor status (MANAGED, ARCHIVED, or IN_PROCUREMENT)',
  },
  websiteUrl: { type: 'string', nullable: true, description: "The vendor's website URL" },
  category: {
    type: 'string',
    nullable: true,
    description: "Display name of the vendor's category",
  },
  servicesProvided: {
    type: 'string',
    nullable: true,
    description: 'Services provided by the vendor',
  },
  additionalNotes: {
    type: 'string',
    nullable: true,
    description: 'Additional notes about the vendor',
  },
  accountManagerName: {
    type: 'string',
    nullable: true,
    description: "The vendor's external account manager name",
  },
  accountManagerEmail: {
    type: 'string',
    nullable: true,
    description: "The vendor's external account manager email",
  },
  securityOwnerUserId: {
    type: 'string',
    nullable: true,
    description: "Vanta user ID of the vendor's security owner",
  },
  businessOwnerUserId: {
    type: 'string',
    nullable: true,
    description: "Vanta user ID of the vendor's business owner",
  },
  inherentRiskLevel: {
    type: 'string',
    nullable: true,
    description: 'Inherent risk level (CRITICAL, HIGH, MEDIUM, LOW, or UNSCORED)',
  },
  residualRiskLevel: {
    type: 'string',
    nullable: true,
    description: 'Residual risk level (CRITICAL, HIGH, MEDIUM, LOW, or UNSCORED)',
  },
  isRiskAutoScored: {
    type: 'boolean',
    nullable: true,
    description: "Whether the vendor's risk is automatically scored",
  },
  isVisibleToAuditors: {
    type: 'boolean',
    nullable: true,
    description: 'Whether auditors can view this vendor',
  },
  riskAttributeIds: {
    type: 'array',
    description: 'Risk attribute IDs assigned to the vendor',
    items: { type: 'string' },
  },
  vendorHeadquarters: {
    type: 'string',
    nullable: true,
    description: "Country code of the vendor's headquarters",
  },
  contractStartDate: {
    type: 'string',
    nullable: true,
    description: 'Date the vendor contract began',
  },
  contractRenewalDate: {
    type: 'string',
    nullable: true,
    description: 'Date the vendor contract is up for renewal',
  },
  contractTerminationDate: {
    type: 'string',
    nullable: true,
    description: 'Date the vendor contract was terminated',
  },
  contractAmount: {
    type: 'json',
    nullable: true,
    description: 'Contract amount for the vendor',
    properties: {
      amount: { type: 'number', nullable: true, description: 'Amount of the contract' },
      currency: { type: 'string', nullable: true, description: 'Currency of the contract' },
    },
  },
  nextSecurityReviewDueDate: {
    type: 'string',
    nullable: true,
    description: 'Next due date for a security review',
  },
  lastSecurityReviewCompletionDate: {
    type: 'string',
    nullable: true,
    description: 'Most recent date a security review was completed',
  },
  authDetails: {
    type: 'json',
    nullable: true,
    description: "The vendor's authentication details",
    properties: {
      method: {
        type: 'string',
        nullable: true,
        description: 'Authentication method (e.g., SSO, OKTA, USERNAME_PASSWORD)',
      },
      passwordMFA: {
        type: 'boolean',
        nullable: true,
        description: 'Whether passwords require multi-factor authentication',
      },
      passwordMinimumLength: {
        type: 'number',
        nullable: true,
        description: 'Minimum password length',
      },
      passwordRequiresNumber: {
        type: 'boolean',
        nullable: true,
        description: 'Whether passwords require a number',
      },
      passwordRequiresSymbol: {
        type: 'boolean',
        nullable: true,
        description: 'Whether passwords require a symbol',
      },
    },
  },
  customFields: VANTA_CUSTOM_FIELDS_OUTPUT,
  latestDecision: {
    type: 'json',
    nullable: true,
    description: "The vendor's latest decision (null when no decision has been made)",
    properties: {
      status: {
        type: 'string',
        nullable: true,
        description: 'Decision status (APPROVED, CONDITIONALLY_APPROVED, or NOT_APPROVED)',
      },
      lastUpdatedAt: {
        type: 'string',
        nullable: true,
        description: 'When the decision was last updated',
      },
    },
  },
  linkedTaskTrackerTaskProcurementRequest: {
    type: 'json',
    nullable: true,
    description: 'Linked task tracker procurement request, if any',
    properties: {
      url: { type: 'string', nullable: true, description: 'URL of the procurement request' },
      service: { type: 'string', nullable: true, description: 'Task tracker service' },
    },
  },
}

export const VANTA_MONITORED_COMPUTER_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: {
    type: 'string',
    nullable: true,
    description: 'Unique identifier of the monitored computer',
  },
  integrationId: {
    type: 'string',
    nullable: true,
    description: 'Integration that reports this computer',
  },
  lastCheckDate: {
    type: 'string',
    nullable: true,
    description: "Date of the computer's most recent report",
  },
  screenlock: {
    type: 'string',
    nullable: true,
    description: 'Screenlock check outcome (PASS, FAIL, IN_PROGRESS, or NA)',
  },
  diskEncryption: {
    type: 'string',
    nullable: true,
    description: 'Disk encryption check outcome (PASS, FAIL, IN_PROGRESS, or NA)',
  },
  passwordManager: {
    type: 'string',
    nullable: true,
    description: 'Password manager check outcome (PASS, FAIL, IN_PROGRESS, or NA)',
  },
  antivirusInstallation: {
    type: 'string',
    nullable: true,
    description: 'Antivirus check outcome (PASS, FAIL, IN_PROGRESS, or NA)',
  },
  operatingSystem: {
    type: 'json',
    nullable: true,
    description: "The computer's operating system",
    properties: {
      type: {
        type: 'string',
        nullable: true,
        description: 'Operating system type (macOS, linux, or windows)',
      },
      version: { type: 'string', nullable: true, description: 'Operating system version' },
    },
  },
  owner: {
    type: 'json',
    nullable: true,
    description: "The computer's owner",
    properties: VANTA_OWNER_OUTPUT_PROPERTIES,
  },
  serialNumber: { type: 'string', nullable: true, description: 'Serial number of the computer' },
  udid: { type: 'string', nullable: true, description: 'Universal device ID of the computer' },
}

export const VANTA_RISK_SCENARIO_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  riskId: {
    type: 'string',
    nullable: true,
    description: 'Unique user-specified ID of the risk scenario',
  },
  description: { type: 'string', nullable: true, description: 'Description of the risk scenario' },
  likelihood: {
    type: 'number',
    nullable: true,
    description: 'Likelihood score (defaults to a 1-5 range; null when unscored)',
  },
  impact: {
    type: 'number',
    nullable: true,
    description: 'Impact score (defaults to a 1-5 range; null when unscored)',
  },
  residualLikelihood: {
    type: 'number',
    nullable: true,
    description: 'Residual likelihood score after treatments',
  },
  residualImpact: {
    type: 'number',
    nullable: true,
    description: 'Residual impact score after treatments',
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
    nullable: true,
    description: 'Risk treatment decision (Mitigate, Transfer, Avoid, or Accept)',
  },
  owner: {
    type: 'string',
    nullable: true,
    description: 'Email of the person responsible for this risk',
  },
  note: {
    type: 'string',
    nullable: true,
    description: 'Additional context about the risk scenario',
  },
  riskRegister: {
    type: 'string',
    nullable: true,
    description: 'Name of the associated risk register',
  },
  customFields: VANTA_CUSTOM_FIELDS_OUTPUT,
  isArchived: { type: 'boolean', nullable: true, description: 'Whether the scenario is archived' },
  reviewStatus: {
    type: 'string',
    nullable: true,
    description:
      'Review status (APPROVED, DRAFT, NOT_REVIEWED, AWAITING_SUBMISSION, PENDING_APPROVAL, or REQUESTED_CHANGES)',
  },
  requiredApprovers: {
    type: 'array',
    description: 'Required approvers for this risk scenario',
    items: { type: 'string' },
  },
  type: {
    type: 'string',
    nullable: true,
    description: 'Scenario type ("Risk Scenario" or "Enterprise Risk")',
  },
  identificationDate: {
    type: 'string',
    nullable: true,
    description: 'Date this risk was identified',
  },
}

export const VANTA_VULNERABILITY_REMEDIATION_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: 'Unique identifier of the remediation' },
  vulnerabilityId: {
    type: 'string',
    nullable: true,
    description: 'ID of the remediated vulnerability',
  },
  vulnerableAssetId: { type: 'string', nullable: true, description: 'ID of the vulnerable asset' },
  severity: { type: 'string', nullable: true, description: 'Severity of the vulnerability' },
  detectedDate: {
    type: 'string',
    nullable: true,
    description: 'Date the vulnerability was first detected',
  },
  slaDeadlineDate: { type: 'string', nullable: true, description: 'SLA deadline for remediation' },
  remediationDate: {
    type: 'string',
    nullable: true,
    description: 'Date the vulnerability was remediated',
  },
}

export const VANTA_VULNERABLE_ASSET_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: 'Unique identifier of the vulnerable asset' },
  name: { type: 'string', nullable: true, description: 'Display name of the vulnerable asset' },
  assetType: {
    type: 'string',
    nullable: true,
    description:
      'Asset type (e.g., SERVER, SERVERLESS_FUNCTION, CONTAINER_REPOSITORY, CODE_REPOSITORY, WORKSTATION)',
  },
  hasBeenScanned: {
    type: 'boolean',
    nullable: true,
    description: 'Whether the asset has been scanned',
  },
  imageScanTag: {
    type: 'string',
    nullable: true,
    description:
      'Container image tag that vulnerabilities are retrieved for (container repositories only)',
  },
  scanners: {
    type: 'array',
    description:
      'Integrations scanning this asset, with per-scanner asset details (resource ID, hostnames, IPs, image metadata)',
    items: {
      type: 'object',
      properties: {
        resourceId: { type: 'string', nullable: true, description: 'Vanta resource ID' },
        integrationId: { type: 'string', nullable: true, description: 'Scanning integration ID' },
        targetId: {
          type: 'string',
          nullable: true,
          description: 'Asset identifier in the scanning source',
        },
        imageDigest: { type: 'string', nullable: true, description: 'Container image digest' },
        imagePushedAtDate: {
          type: 'string',
          nullable: true,
          description: 'Container image push date',
        },
        parentAccountOrOrganization: {
          type: 'string',
          nullable: true,
          description: 'Parent account or organization',
        },
        biosUuid: { type: 'string', nullable: true, description: 'BIOS UUID' },
        imageTags: {
          type: 'array',
          description: 'Container image tags',
          items: { type: 'string' },
        },
        ipv4s: { type: 'array', description: 'IPv4 addresses', items: { type: 'string' } },
        ipv6s: { type: 'array', description: 'IPv6 addresses', items: { type: 'string' } },
        macAddresses: { type: 'array', description: 'MAC addresses', items: { type: 'string' } },
        hostnames: { type: 'array', description: 'Host names', items: { type: 'string' } },
        fqdns: {
          type: 'array',
          description: 'Fully qualified domain names',
          items: { type: 'string' },
        },
        operatingSystems: {
          type: 'array',
          description: 'Operating systems',
          items: { type: 'string' },
        },
        assetTags: {
          type: 'array',
          description: 'Tags from the scanning source',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', nullable: true, description: 'Tag key' },
              value: { type: 'string', nullable: true, description: 'Tag value' },
            },
          },
        },
      },
    },
  },
}

export const VANTA_VULNERABILITY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', nullable: true, description: 'Unique identifier of the vulnerability' },
  name: { type: 'string', nullable: true, description: 'Display name of the vulnerability' },
  description: { type: 'string', nullable: true, description: 'Description of the vulnerability' },
  severity: {
    type: 'string',
    nullable: true,
    description: 'Severity (LOW, MEDIUM, HIGH, or CRITICAL)',
  },
  vulnerabilityType: {
    type: 'string',
    nullable: true,
    description: 'Vulnerability type (CONFIGURATION, COMMON, or GROUPED)',
  },
  integrationId: {
    type: 'string',
    nullable: true,
    description: 'Integration that scans this vulnerability',
  },
  targetId: {
    type: 'string',
    nullable: true,
    description: 'ID of the resource the vulnerability was found on',
  },
  packageIdentifier: {
    type: 'string',
    nullable: true,
    description: 'Identifier of the affected package (COMMON and GROUPED vulnerabilities only)',
  },
  cvssSeverityScore: { type: 'number', nullable: true, description: 'CVSS severity score' },
  scannerScore: { type: 'number', nullable: true, description: 'Scanner score' },
  isFixable: {
    type: 'boolean',
    nullable: true,
    description: 'Whether the vulnerability is fixable',
  },
  fixedVersion: {
    type: 'string',
    nullable: true,
    description: 'Package version that remediates the vulnerability',
  },
  remediateByDate: {
    type: 'string',
    nullable: true,
    description: 'SLA date by which the vulnerability should be remediated',
  },
  firstDetectedDate: {
    type: 'string',
    nullable: true,
    description: 'Date first detected by Vanta',
  },
  sourceDetectedDate: {
    type: 'string',
    nullable: true,
    description: 'Date first detected by the source',
  },
  lastDetectedDate: { type: 'string', nullable: true, description: 'Date last detected' },
  scanSource: {
    type: 'string',
    nullable: true,
    description: 'Scanning tool that detected the vulnerability',
  },
  externalURL: {
    type: 'string',
    nullable: true,
    description: 'External URL for the vulnerability',
  },
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
    nullable: true,
    description: 'Deactivation metadata, if the vulnerability was deactivated',
    properties: {
      isVulnDeactivatedIndefinitely: {
        type: 'boolean',
        nullable: true,
        description: 'Whether deactivated indefinitely',
      },
      deactivatedUntilDate: {
        type: 'string',
        nullable: true,
        description: 'Date the vulnerability will be reactivated',
      },
      deactivationReason: {
        type: 'string',
        nullable: true,
        description: 'Reason for deactivation',
      },
      deactivatedOnDate: {
        type: 'string',
        nullable: true,
        description: 'Date the vulnerability was deactivated',
      },
      deactivatedBy: {
        type: 'string',
        nullable: true,
        description: 'User who deactivated the vulnerability',
      },
    },
  },
}
