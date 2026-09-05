import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import {
  oracleFusionExactInteger,
  serializeOracleFusionJsonBody,
} from '@/lib/internal/oracle-fusion/request-body'

export class RiskInputError extends Error {}
export class RiskResponseError extends Error {}

export const RISK_PAGE_SIZE = 100
export const RISK_MAX_OFFSET = 1_000_000
const MAX_INT64 = '9223372036854775807'

export const riskIdentifierSchema = z.unknown().transform((value, context) => {
  const normalized = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 19 })
  if (
    normalized === undefined ||
    normalized.length > MAX_INT64.length ||
    (normalized.length === MAX_INT64.length && normalized > MAX_INT64)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected an exact non-negative int64 identifier',
    })
    return z.NEVER
  }
  return normalized
})

export const riskKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      encodeOracleFusionPathSegment(value)
      return true
    } catch {
      return false
    }
  }, 'Expected an Oracle identifier or opaque key, not a URL')

export const riskPagingSchema = z.object({
  limit: z.number().int().min(1).max(RISK_PAGE_SIZE).default(RISK_PAGE_SIZE),
  offset: z.number().int().min(0).max(RISK_MAX_OFFSET).default(0),
  q: z.string().trim().max(4096).optional(),
  orderBy: z.string().trim().max(1024).optional(),
  totalResults: z.boolean().optional(),
})

function nullableField<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === undefined ? null : value), schema.nullable())
}
const nullableString = nullableField(z.string())
const nullableBoolean = nullableField(z.boolean())
const nullableIdentifier = nullableField(riskIdentifierSchema)
const nullableNumber = nullableField(
  z
    .union([
      z
        .number()
        .finite()
        .refine((value) => !Number.isInteger(value) || Number.isSafeInteger(value)),
      z
        .string()
        .max(256)
        .regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/),
    ])
    .transform((value) => String(value))
)
const requestInteger = riskIdentifierSchema.transform(oracleFusionExactInteger)

/** Oracle 26C scalar projections; links are consumed separately and children are paginated explicitly. */
export const riskResourceSchemas = {
  /** 26C: op-frcprocesses-processid-get.html */
  process: z.object({
    ApprovedBy: nullableString,
    ApprovedDate: nullableString,
    AssessmentFlag: nullableBoolean,
    AuditTestingFlag: nullableBoolean,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DetailedDescription: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    Name: nullableString,
    ProcessId: riskIdentifierSchema,
    ReviewStartDate: nullableString,
    ReviewedBy: nullableString,
    ReviewedDate: nullableString,
    RevisionDate: nullableString,
    RevisionNumber: nullableNumber,
    StateCode: nullableString,
    Status: nullableString,
    TotalRevisions: nullableNumber,
    Type: nullableString,
  }),
  /** 26C: op-frcrisks-riskid-get.html */
  risk: z.object({
    ApprovedBy: nullableString,
    ApprovedDate: nullableString,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DetailedDescription: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    Name: nullableString,
    ReviewStartDate: nullableString,
    ReviewedBy: nullableString,
    ReviewedDate: nullableString,
    RevisionDate: nullableString,
    RiskAnalysisModelId: nullableIdentifier,
    RiskContextModelId: nullableIdentifier,
    RiskId: riskIdentifierSchema,
    StateCode: nullableString,
    Status: nullableString,
    TotalRevisions: nullableNumber,
    Type: nullableString,
  }),
  /** 26C: op-frccontrols-controlid-get.html */
  control: z.object({
    ApprovedBy: nullableString,
    ApprovedDate: nullableString,
    AssessmentFlag: nullableString,
    AuditTestingFlag: nullableString,
    ControlCost: nullableNumber,
    ControlFrequency: nullableString,
    ControlId: riskIdentifierSchema,
    ControlMethod: nullableString,
    ControlType: nullableString,
    CreationDate: nullableString,
    DetailedDescription: nullableString,
    EnforcementType: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    Name: nullableString,
    ReviewStartDate: nullableString,
    ReviewedBy: nullableString,
    ReviewedDate: nullableString,
    RevisionDate: nullableString,
    StartDate: nullableString,
    StateCode: nullableString,
    Status: nullableString,
    TotalRevisions: nullableNumber,
  }),
  /** 26C: op-frcissues-issueid-get.html */
  issue: z.object({
    Action: nullableString,
    ApprovedBy: nullableString,
    ApprovedDate: nullableString,
    ClosedDate: nullableString,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DetailedDescription: nullableString,
    HoldDate: nullableString,
    IssueId: riskIdentifierSchema,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    LikelihoodCode: nullableString,
    Name: nullableString,
    OpenDate: nullableString,
    OriginObjectId: nullableIdentifier,
    OriginObjectTypeCode: nullableString,
    ReasonCode: nullableString,
    RemedDate: nullableString,
    RemediationFlag: nullableBoolean,
    ReviewedBy: nullableString,
    ReviewedDate: nullableString,
    RevisionNumber: nullableNumber,
    Severity: nullableString,
    StartDate: nullableString,
    StateCode: nullableString,
    StateDate: nullableString,
    Status: nullableString,
    Type: nullableString,
    ValidDate: nullableString,
    ValidatedBy: nullableString,
    ValidatedDate: nullableString,
  }),
  /** 26C: op-frcprocesses-processid-child-comments-id-get.html */
  process_comment: z.object({
    CreatedBy: nullableString,
    CreationDate: nullableString,
    Id: riskIdentifierSchema,
    UserComment: nullableString,
  }),
  /** 26C: op-frcprocesses-processid-child-perspectives-perspectivesuniqid-get.html */
  process_perspective: z.object({
    Name: nullableString,
    PerspItemId: nullableIdentifier,
    ProcessId: nullableIdentifier,
  }),
  /** 26C: op-frcrisks-riskid-child-comments-id-get.html */
  risk_comment: z.object({
    CreatedBy: nullableString,
    CreationDate: nullableString,
    Id: riskIdentifierSchema,
    UserComment: nullableString,
  }),
  /** 26C: op-frcrisks-riskid-child-perspectives-perspectivesuniqid-get.html */
  risk_perspective: z.object({
    Name: nullableString,
    PerspItemId: nullableIdentifier,
    RiskId: nullableIdentifier,
  }),
  /** 26C: op-frccontrols-controlid-child-comments-id-get.html */
  control_comment: z.object({
    CreatedBy: nullableString,
    CreationDate: nullableString,
    Id: riskIdentifierSchema,
    UserComment: nullableString,
  }),
  /** 26C: op-frccontrols-controlid-child-perspectives-perspectivesuniqid-get.html */
  control_perspective: z.object({
    ControlId: nullableIdentifier,
    PerspItemId: nullableIdentifier,
  }),
  /** 26C: op-frcprocesses-processid-child-relatedrisks-relatedrisksuniqid-get.html */
  process_risk: z.object({
    ProcessId: nullableIdentifier,
    RiskId: nullableIdentifier,
  }),
  /** 26C: op-frcrisks-riskid-child-relatedprocesses-relatedprocessesuniqid-get.html */
  risk_process: z.object({
    ProcessId: nullableIdentifier,
    RiskId: nullableIdentifier,
  }),
  /** 26C: op-frcrisks-riskid-child-relatedcontrols-relatedcontrolsuniqid-get.html */
  risk_control: z.object({
    ChildId: nullableIdentifier,
    ParentId: nullableIdentifier,
  }),
  /** 26C: op-frccontrols-controlid-child-relatedrisks-relatedrisksuniqid-get.html */
  control_risk: z.object({
    ChildId: nullableIdentifier,
    ParentId: nullableIdentifier,
  }),
  /** 26C: op-frcprocesses-processid-child-actionitems-actionid-get.html */
  process_action_item: z.object({
    ActionId: riskIdentifierSchema,
    CompletedDate: nullableString,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DetailedDescription: nullableString,
    DueDate: nullableString,
    EstimatedCompletionDate: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    Name: nullableString,
    PriorityCode: nullableString,
    ProcessId: nullableIdentifier,
    ProgressCode: nullableString,
    StartDate: nullableString,
    StateCode: nullableString,
  }),
  /** 26C: op-frcprocessassessmentresults-resultid-get.html */
  process_assessment_result: z.object({
    ActivityCode: nullableString,
    ApprovedBy: nullableString,
    ApprovedDate: nullableString,
    AssessedBy: nullableString,
    AssessedDate: nullableString,
    AssessmentId: nullableIdentifier,
    CompletionDate: nullableString,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DueDate: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    ObjectVersionNumber: nullableNumber,
    ProcessId: nullableIdentifier,
    ResponseCode: nullableString,
    ResultId: riskIdentifierSchema,
    ResultSummary: nullableString,
    ReviewedBy: nullableString,
    ReviewedDate: nullableString,
    StateCode: nullableString,
    SurveyId: nullableIdentifier,
  }),
  /** 26C: op-frcriskassessmentresults-resultid-get.html */
  risk_assessment_result: z.object({
    ActivityCode: nullableString,
    ApprovedBy: nullableString,
    ApprovedDate: nullableString,
    AssessedBy: nullableString,
    AssessedDate: nullableString,
    AssessmentId: nullableIdentifier,
    CompletionDate: nullableString,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DueDate: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    ObjectVersionNumber: nullableNumber,
    ResponseCode: nullableString,
    ResultId: riskIdentifierSchema,
    ResultSummary: nullableString,
    ReviewedBy: nullableString,
    ReviewedDate: nullableString,
    RiskId: nullableIdentifier,
    StateCode: nullableString,
    SurveyId: nullableIdentifier,
  }),
  /** 26C: op-frccontrolassessmentresults-resultid-get.html */
  control_assessment_result: z.object({
    ActivityCode: nullableString,
    ApprovedBy: nullableString,
    ApprovedDate: nullableString,
    AssessedBy: nullableString,
    AssessedDate: nullableString,
    AssessmentId: nullableIdentifier,
    CompletionDate: nullableString,
    ControlId: nullableIdentifier,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DueDate: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    ObjectVersionNumber: nullableNumber,
    ResponseCode: nullableString,
    ResultId: riskIdentifierSchema,
    ResultSummary: nullableString,
    ReviewedBy: nullableString,
    ReviewedDate: nullableString,
    StateCode: nullableString,
    SurveyId: nullableIdentifier,
  }),
  /** 26C: op-frccontrols-controlid-child-assertions-assertionsuniqid-get.html */
  control_assertion: z.object({
    AssertionCode: nullableString,
    ControlId: nullableIdentifier,
  }),
  /** 26C: op-frccontrols-controlid-child-testplans-testplanid-get.html */
  control_test_plan: z.object({
    ControlId: nullableIdentifier,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DetailedDescription: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    Name: nullableString,
    RevisionDate: nullableString,
    SampleSize: nullableNumber,
    TestPlanFrequency: nullableString,
    TestPlanId: riskIdentifierSchema,
  }),
  /** 26C: op-frccontrols-controlid-child-testplans-testplanid-child-steps-stepid-get.html */
  test_plan_step: z.object({
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DetailedDescription: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    StepId: riskIdentifierSchema,
    StepOrder: nullableNumber,
    TestPlanId: nullableIdentifier,
  }),
  /** 26C: op-frccontrols-controlid-child-testplans-testplanid-child-planactivity-planactivityuniqid-get.html */
  test_plan_activity: z.object({
    ActivityCode: nullableString,
    ControlId: nullableIdentifier,
    TestPlanId: nullableIdentifier,
  }),
  /** 26C: op-advancedcontrols-id-get.html */
  advanced_control: z.object({
    CreatedBy: nullableString,
    CreationDate: nullableString,
    Description: nullableString,
    EnforcementType: nullableNumber,
    Id: riskIdentifierSchema,
    LastRunDate: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    LatestJobId: nullableIdentifier,
    Name: nullableString,
    ScheduledBy: nullableString,
    StateCode: nullableString,
    Status: nullableString,
    StatusId: nullableNumber,
    Type: nullableNumber,
  }),
  /** 26C: op-advancedcontrols-id-child-comments-id3-get.html */
  advanced_control_comment: z.object({
    CreatedBy: nullableString,
    CreationDate: nullableString,
    Id: nullableIdentifier,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    UserComment: nullableString,
  }),
  /** 26C: op-advancedcontrols-id-child-perspectives-perspectivesuniqid-get.html */
  advanced_control_perspective: z.object({
    ControlId: nullableIdentifier,
    Name: nullableString,
    TreeId: nullableIdentifier,
  }),
  /** 26C: op-advancedcontrols-id-child-incidents-id4-get.html */
  incident: z.object({
    AccessPointName: nullableString,
    AccessPointType: nullableString,
    ClosedBy: nullableString,
    ClosedDate: nullableString,
    ConflictingAccPointName: nullableString,
    ConflictingRoles: nullableString,
    ControlId: nullableIdentifier,
    ControlName: nullableString,
    ControlType: nullableNumber,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DataSource: nullableString,
    Entitlement: nullableString,
    GlobalUserId: nullableIdentifier,
    GlobalUserName: nullableString,
    GroupingValue: nullableString,
    Id: nullableString,
    IncidentInformation: nullableString,
    IncidentInformationCodes: nullableString,
    IncidentVersion: nullableNumber,
    IsIntraRoleViol: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    Priority: nullableNumber,
    ResultGroup: nullableString,
    ResultInvestigator: nullableString,
    RevisionDate: nullableString,
    Role: nullableString,
    State: nullableString,
    Status: nullableString,
    UserFirstName: nullableString,
    UserLastName: nullableString,
  }),
  /** 26C: op-advancedcontrols-id-child-incidents-id4-child-comments-id6-get.html */
  incident_comment: z.object({
    CreatedBy: nullableString,
    CreationDate: nullableString,
    Delegated: nullableString,
    Id: nullableIdentifier,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    UserComment: nullableString,
  }),
  /** 26C: op-advancedcontrols-id-child-incidents-id4-child-dynamicattributes-id7-get.html */
  incident_attribute: z.object({
    AttributeName: nullableString,
    AttributeValue: nullableString,
    Id: nullableString,
  }),
  /** 26C: op-advancedcontrols-id-child-incidents-id4-child-perspectives-treeid-get.html */
  incident_perspective: z.object({
    IncidentId: nullableString,
    Name: nullableString,
    TreeId: riskIdentifierSchema,
  }),
  /** 26C: op-openincidents-resultid-get.html */
  open_incident: z.object({
    ConflictingRoles: nullableString,
    ControlId: nullableIdentifier,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    DatasourceName: nullableString,
    GlobalUserEmail: nullableString,
    GlobalUserId: nullableString,
    GlobalUserName: nullableString,
    IncidentInformation: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    ResultId: nullableString,
    Role: nullableString,
    Status: nullableString,
    Type: nullableNumber,
  }),
  /** 26C: op-advancedcontrolsjobs-id-get.html */
  advanced_control_job: z.object({
    CreatedBy: nullableString,
    EndDate: nullableString,
    FailedItems: nullableNumber,
    Id: riskIdentifierSchema,
    JobType: nullableString,
    LastUpdatedBy: nullableString,
    Name: nullableString,
    Result: nullableString,
    ScheduledBy: nullableString,
    StartDate: nullableString,
    StatusId: nullableNumber,
    StatusMessage: nullableString,
    SuccessfullyProcessedItems: nullableNumber,
  }),
  /** 26C: op-advancedcontrolsrolesprovisioning-advancedcontrolsrolesprovisioninguniqid-get.html */
  simulation_result: z.object({
    conflictingRole: nullableString,
    controlId: nullableIdentifier,
    controlName: nullableString,
    incidentPath: nullableString,
    incidentPathCode: nullableString,
    inputRoleCode: nullableString,
    inputRoleName: nullableString,
  }),
  /** 26C: op-userassignmentgroups-groupid-get.html */
  assignment_group: z.object({
    CreatedBy: nullableString,
    CreationDate: nullableString,
    GroupId: nullableString,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    MemberCount: nullableNumber,
    Name: nullableString,
    OrphanCount: nullableNumber,
    PrivilegeCode: nullableString,
    RoleType: nullableString,
    SecurableType: nullableString,
  }),
  /** 26C: op-userassignmentgroups-groupid-child-members-id-get.html */
  group_member: z.object({
    Displayname: nullableString,
    GroupId: nullableString,
    Id: riskIdentifierSchema,
    IsOrphan: nullableNumber,
    PersonId: nullableIdentifier,
    UserId: nullableString,
    Username: nullableString,
  }),
  /** 26C: op-userassignmentgroups-groupid-child-securityassignments-id-get.html */
  group_security_assignment: z.object({
    AccessorDisplayName: nullableString,
    AccessorId: nullableString,
    AccessorType: nullableString,
    CreatedBy: nullableString,
    CreationDate: nullableString,
    Id: riskIdentifierSchema,
    IsEditor: nullableNumber,
    IsOwner: nullableNumber,
    IsViewer: nullableNumber,
    LastUpdateDate: nullableString,
    LastUpdatedBy: nullableString,
    SecurableId: nullableString,
  }),
  /** 26C: op-userassignmentgroups-groupid-child-eligibleusers-userguid-get.html */
  group_eligible_user: z.object({
    DisplayName: nullableString,
    PersonId: nullableIdentifier,
    RoleType: nullableString,
    SecurableType: nullableString,
    UserGuid: nullableString,
  }),
  /** 26C: op-userassignmentsecurabletypes-securabletype-get.html */
  securable_type: z.object({
    Meaning: nullableString,
    SecurableType: nullableString,
  }),
  /** 26C: op-userassignmentsecurabletypes-securabletype-child-roletypes-roletype-get.html */
  securable_role_type: z.object({
    Meaning: nullableString,
    PrivilegeCode: nullableString,
    RoleType: nullableString,
    SecurableType: nullableString,
  }),
  /** 26C: op-userassignmentsecurabletypes-securabletype-child-eligibleusers-userguid-get.html */
  securable_eligible_user: z.object({
    DisplayName: nullableString,
    PersonId: nullableIdentifier,
    RoleType: nullableString,
    SecurableType: nullableString,
    UserGuid: nullableString,
  }),
} as const

export const riskWriteSchemas = {
  /** 26C: op-frcprocesses-post.html */
  create_process: z
    .object({
      AssessmentFlag: z.boolean().optional(),
      AuditTestingFlag: z.boolean().optional(),
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      Name: z.string().min(1).max(150),
      Status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      Type: z.string().max(30).nullable().optional(),
      perspectives: z
        .array(
          z
            .object({
              PerspItemId: requestInteger,
              ProcessId: requestInteger.optional(),
            })
            .strict()
        )
        .max(100)
        .optional(),
    })
    .strict(),
  /** 26C: op-frcprocesses-processid-patch.html */
  update_process: z
    .object({
      AssessmentFlag: z.boolean().optional(),
      AuditTestingFlag: z.boolean().optional(),
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      Name: z.string().max(150).optional(),
      Status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      Type: z.string().max(30).nullable().optional(),
      perspectives: z
        .array(
          z
            .object({
              PerspItemId: requestInteger,
              ProcessId: requestInteger.optional(),
            })
            .strict()
        )
        .max(100)
        .optional(),
      actionItems: z
        .array(
          z
            .object({
              ActionId: requestInteger,
              CompletedDate: z
                .string()
                .max(MAX_INLINE_MATERIALIZATION_BYTES)
                .date()
                .nullable()
                .optional(),
              DetailedDescription: z
                .string()
                .max(MAX_INLINE_MATERIALIZATION_BYTES)
                .nullable()
                .optional(),
              DueDate: z
                .string()
                .max(MAX_INLINE_MATERIALIZATION_BYTES)
                .datetime({ offset: true })
                .optional(),
              EstimatedCompletionDate: z
                .string()
                .max(MAX_INLINE_MATERIALIZATION_BYTES)
                .datetime({ offset: true })
                .nullable()
                .optional(),
              Name: z.string().max(150).optional(),
              PriorityCode: z.string().max(30).optional(),
              ProcessId: requestInteger.optional(),
              ProgressCode: z.string().max(30).optional(),
            })
            .strict()
        )
        .max(100)
        .optional(),
    })
    .strict(),
  /** 26C: op-frcrisks-post.html */
  create_risk: z
    .object({
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      Name: z.string().min(1).max(150),
      RiskAnalysisModelId: requestInteger.nullable().optional(),
      RiskContextModelId: requestInteger.nullable().optional(),
      Status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      Type: z.string().max(30).nullable().optional(),
      perspectives: z
        .array(
          z
            .object({
              PerspItemId: requestInteger,
              RiskId: requestInteger.optional(),
            })
            .strict()
        )
        .max(100)
        .optional(),
      relatedControls: z
        .array(
          z
            .object({
              ChildId: requestInteger,
              ParentId: requestInteger.optional(),
            })
            .strict()
        )
        .max(100)
        .optional(),
      relatedProcesses: z
        .array(
          z
            .object({
              ProcessId: requestInteger,
              RiskId: requestInteger.optional(),
            })
            .strict()
        )
        .max(100)
        .optional(),
    })
    .strict(),
  /** 26C: op-frccontrols-post.html */
  create_control: z
    .object({
      AssessmentFlag: z.string().max(1).nullable().optional(),
      AuditTestingFlag: z.string().max(1).nullable().optional(),
      ControlCost: z.number().finite().nullable().optional(),
      ControlFrequency: z.string().max(30).nullable().optional(),
      ControlMethod: z.string().max(40).optional(),
      ControlType: z.string().max(30).nullable().optional(),
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      EnforcementType: z.string().max(50).nullable().optional(),
      Name: z.string().min(1).max(150),
      Status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      perspectives: z
        .array(
          z
            .object({
              ControlId: requestInteger.optional(),
              PerspItemId: requestInteger,
            })
            .strict()
        )
        .max(100)
        .optional(),
    })
    .strict(),
  /** 26C: op-frccontrols-controlid-patch.html */
  update_control: z
    .object({
      AssessmentFlag: z.string().max(1).nullable().optional(),
      AuditTestingFlag: z.string().max(1).nullable().optional(),
      ControlCost: z.number().finite().nullable().optional(),
      ControlFrequency: z.string().max(30).nullable().optional(),
      ControlMethod: z.string().max(40).optional(),
      ControlType: z.string().max(30).nullable().optional(),
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      EnforcementType: z.string().max(50).nullable().optional(),
      Name: z.string().max(150).optional(),
      Status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      perspectives: z
        .array(
          z
            .object({
              ControlId: requestInteger.optional(),
              PerspItemId: requestInteger,
            })
            .strict()
        )
        .max(100)
        .optional(),
    })
    .strict(),
  /** 26C: op-frcissues-issueid-patch.html */
  update_issue: z
    .object({
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      LikelihoodCode: z.enum(['HIGH', 'LOW', 'MEDIUM']).nullable().optional(),
      Name: z.string().max(150).optional(),
      ReasonCode: z.string().max(30).nullable().optional(),
      RemedDate: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).date().nullable().optional(),
      RemediationFlag: z.boolean().optional(),
      Severity: z
        .enum(['DEFICIENCY', 'DOCUMENTATION_ONLY', 'MINOR_GAP', 'SIGNIFICANT_DEFICIENCY'])
        .optional(),
      Type: z.string().max(30).nullable().optional(),
    })
    .strict(),
  /** 26C: op-frcprocesses-processid-child-comments-post.html */
  create_process_comment: z
    .object({
      UserComment: z.string().min(1).max(2000),
    })
    .strict(),
  /** 26C: op-frcrisks-riskid-child-comments-post.html */
  create_risk_comment: z
    .object({
      UserComment: z.string().min(1).max(2000),
    })
    .strict(),
  /** 26C: op-frccontrols-controlid-child-comments-post.html */
  create_control_comment: z
    .object({
      UserComment: z.string().min(1).max(2000),
    })
    .strict(),
  /** 26C: op-frcprocesses-processid-child-relatedrisks-post.html */
  create_process_risk: z
    .object({
      ProcessId: requestInteger.optional(),
      RiskId: requestInteger,
    })
    .strict(),
  /** 26C: op-frcprocessassessmentresults-resultid-patch.html */
  update_process_assessment_result: z
    .object({
      ObjectVersionNumber: z.number().int().min(0).max(2147483647).optional(),
      ResponseCode: z
        .enum([
          'COMPLETED',
          'AGREE',
          'AGREE_WITH_EXCEPTION',
          'DO_NOT_AGREE',
          'PASS_WITH_EXCEPTION',
          'FAIL',
          'NO_OPINION',
          'PASS',
          'NO_ACTION',
        ])
        .nullable()
        .optional(),
      ResultSummary: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
    })
    .strict(),
  /** 26C: op-frcriskassessmentresults-resultid-patch.html */
  update_risk_assessment_result: z
    .object({
      ObjectVersionNumber: z.number().int().min(0).max(2147483647).optional(),
      ResponseCode: z
        .enum([
          'REQ_EVALUATION',
          'REQ_ADDITIONAL_ANALYSIS',
          'REQ_DOCUMENTATION',
          'MEETS_GUIDANCE',
          'PASS_WITH_EXCEPTION',
          'FAIL',
          'NO_OPINION',
          'OUT_OF_TOLERANCE',
          'AGREE',
          'AGREE_WITH_EXCEPTION',
          'PASS',
          'DO_NOT_AGREE',
        ])
        .nullable()
        .optional(),
      ResultSummary: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
    })
    .strict(),
  /** 26C: op-frccontrolassessmentresults-resultid-patch.html */
  update_control_assessment_result: z
    .object({
      ObjectVersionNumber: z.number().int().min(0).max(2147483647).optional(),
      ResponseCode: z
        .enum(['PASS', 'PASS_WITH_EXCEPTION', 'FAIL', 'NO_OPINION'])
        .nullable()
        .optional(),
      ResultSummary: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
    })
    .strict(),
  /** 26C: op-frccontrols-controlid-child-assertions-post.html */
  create_control_assertion: z
    .object({
      AssertionCode: z.string().min(1).max(30),
    })
    .strict(),
  /** 26C: op-frccontrols-controlid-child-assertions-assertionsuniqid-patch.html */
  update_control_assertion: z
    .object({
      AssertionCode: z.string().min(1).max(30),
    })
    .strict(),
  /** 26C: op-frccontrols-controlid-child-testplans-testplanid-patch.html */
  update_control_test_plan: z
    .object({
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      Name: z.string().max(150).optional(),
      SampleSize: z.number().int().min(0).max(2147483647).nullable().optional(),
      TestPlanFrequency: z.string().max(30).nullable().optional(),
    })
    .strict(),
  /** 26C: op-frccontrols-controlid-child-testplans-testplanid-child-steps-post.html */
  create_test_plan_step: z
    .object({
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      StepOrder: z.number().int().min(0).max(2147483647),
      TestPlanId: requestInteger.optional(),
    })
    .strict(),
  /** 26C: op-frccontrols-controlid-child-testplans-testplanid-child-steps-stepid-patch.html */
  update_test_plan_step: z
    .object({
      DetailedDescription: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      StepOrder: z.number().int().min(0).max(2147483647).optional(),
    })
    .strict(),
  /** 26C: op-frccontrols-controlid-child-testplans-testplanid-child-planactivity-post.html */
  create_test_plan_activity: z
    .object({
      ActivityCode: z.string().min(1).max(30),
      ControlId: requestInteger.optional(),
      TestPlanId: requestInteger.optional(),
    })
    .strict(),
  /** 26C: op-advancedcontrols-id-patch.html */
  update_advanced_control: z
    .object({
      Description: z.string().max(2000).nullable().optional(),
      Name: z.string().max(256).optional(),
      Status: z.string().max(30).nullable().optional(),
    })
    .strict(),
  /** 26C: op-advancedcontrols-id-child-comments-post.html */
  create_advanced_control_comment: z
    .object({
      UserComment: z.string().min(1).max(2000),
    })
    .strict(),
  /** 26C: op-advancedcontrols-id-child-incidents-id4-patch.html */
  update_incident: z
    .object({
      ResultInvestigator: z.string().max(255).nullable().optional(),
      Status: z.enum(['Assigned', 'Accepted', 'Remediate', 'Resolved']).nullable().optional(),
    })
    .strict(),
  /** 26C: op-advancedcontrols-id-child-incidents-id4-child-comments-post.html */
  create_incident_comment: z
    .object({
      Delegated: z.string().max(MAX_INLINE_MATERIALIZATION_BYTES).nullable().optional(),
      UserComment: z.string().min(1).max(2000),
    })
    .strict(),
  /** 26C: op-userassignmentgroups-post.html */
  create_assignment_group: z
    .object({
      Name: z.string().min(1).max(200),
      RoleType: z.string().min(1).max(100),
      SecurableType: z.string().min(1).max(100),
    })
    .strict(),
  /** 26C: op-userassignmentgroups-groupid-patch.html */
  update_assignment_group: z
    .object({
      Name: z.string().max(200).optional(),
    })
    .strict(),
  /** 26C: op-userassignmentgroups-groupid-child-members-post.html */
  create_group_member: z
    .object({
      GroupId: z.string().max(100).optional(),
      UserId: z.string().min(1).max(100),
    })
    .strict(),
  /** 26C: op-userassignmentgroups-groupid-child-securityassignments-post.html */
  create_group_security_assignment: z
    .object({
      AccessorId: z.string().min(1).max(100),
      AccessorType: z.enum(['USER', 'GROUP']),
      IsEditor: z.number().int().min(0).max(2147483647).nullable().optional(),
      IsOwner: z.number().int().min(0).max(2147483647).nullable().optional(),
      IsViewer: z.number().int().min(0).max(2147483647).nullable().optional(),
      SecurableId: z.string().max(100).optional(),
    })
    .strict(),
  /** 26C: op-userassignmentgroups-groupid-child-securityassignments-id-patch.html */
  update_group_security_assignment: z
    .object({
      IsEditor: z.number().int().min(0).max(2147483647).nullable().optional(),
      IsOwner: z.number().int().min(0).max(2147483647).nullable().optional(),
      IsViewer: z.number().int().min(0).max(2147483647).nullable().optional(),
    })
    .strict(),
} as const

/** Bound serialized strings and plain objects before recursive mutation validation. */
export function parseRiskBody(value: unknown): Record<string, unknown> {
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_INLINE_MATERIALIZATION_BYTES) {
      throw new RiskInputError('Risk Management body exceeds the inline byte limit')
    }
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new RiskInputError('Risk Management body must be valid JSON')
    }
  }
  if (!isPlainRecord(parsed) || Object.keys(parsed).length === 0) {
    throw new RiskInputError('A non-empty JSON object is required')
  }
  try {
    serializeOracleFusionJsonBody(parsed)
  } catch {
    throw new RiskInputError('Risk Management body must be bounded plain JSON')
  }
  return parsed
}
