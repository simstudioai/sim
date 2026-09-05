import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface OracleFusionRiskManagementParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  [key: string]: unknown
}

export interface RiskOperationDefinition {
  resource: RiskResource
  kind: 'list' | 'get' | 'create' | 'update' | 'delete' | 'action'
  params: readonly string[]
  label: string
  bodyDescription?: string
}

/** Browser-safe action metadata; provider execution and validation remain server-only. */
export const RISK_OPERATIONS = {
  oracle_fusion_risk_management_create_advanced_control_comment: {
    resource: 'advanced_control_comment',
    kind: 'create',
    label: 'Create Advanced Control Comment',
    params: ['advancedControlId'],
    bodyDescription:
      'JSON object with UserComment: string (required) (maximum 2000 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_assignment_group: {
    resource: 'assignment_group',
    kind: 'create',
    label: 'Create Assignment Group',
    params: [],
    bodyDescription:
      'JSON object with Name: string (required) (maximum 200 characters); RoleType: string (required) (maximum 100 characters); SecurableType: string (required) (maximum 100 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_control: {
    resource: 'control',
    kind: 'create',
    label: 'Create Control',
    params: [],
    bodyDescription:
      'JSON object with AssessmentFlag: string or null (maximum 1 characters); AuditTestingFlag: string or null (maximum 1 characters); ControlCost: number or null; ControlFrequency: string or null (maximum 30 characters); ControlMethod: string (maximum 40 characters); ControlType: string or null (maximum 30 characters); DetailedDescription: string or null (byte); EnforcementType: string or null (maximum 50 characters); Name: string (required) (maximum 150 characters); Status: string [ACTIVE, INACTIVE] (maximum 30 characters); perspectives: array [{ControlId, PerspItemId}] (maximum 100 entries). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_control_assertion: {
    resource: 'control_assertion',
    kind: 'create',
    label: 'Create Control Assertion',
    params: ['controlId'],
    bodyDescription:
      'JSON object with AssertionCode: string (required) (maximum 30 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_control_comment: {
    resource: 'control_comment',
    kind: 'create',
    label: 'Create Control Comment',
    params: ['controlId'],
    bodyDescription:
      'JSON object with UserComment: string (required) (maximum 2000 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_group_member: {
    resource: 'group_member',
    kind: 'create',
    label: 'Create Group Member',
    params: ['groupKey'],
    bodyDescription:
      'JSON object with UserId: string (required) (maximum 100 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged. Parent business identifiers are resolved from the selected resource and bound automatically.',
  },
  oracle_fusion_risk_management_create_group_security_assignment: {
    resource: 'group_security_assignment',
    kind: 'create',
    label: 'Create Group Security Assignment',
    params: ['groupKey'],
    bodyDescription:
      'JSON object with AccessorId: string (required) (maximum 100 characters); AccessorType: string (required) [USER, GROUP] (maximum 20 characters); IsEditor: integer or null; IsOwner: integer or null; IsViewer: integer or null. Unsupported fields are rejected. Omitted optional fields remain unchanged. Parent business identifiers are resolved from the selected resource and bound automatically.',
  },
  oracle_fusion_risk_management_create_incident_comment: {
    resource: 'incident_comment',
    kind: 'create',
    label: 'Create Incident Comment',
    params: ['advancedControlId', 'incidentKey'],
    bodyDescription:
      'JSON object with Delegated: string or null; UserComment: string (required) (maximum 2000 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_process: {
    resource: 'process',
    kind: 'create',
    label: 'Create Process',
    params: [],
    bodyDescription:
      'JSON object with AssessmentFlag: boolean; AuditTestingFlag: boolean; DetailedDescription: string or null (byte); Name: string (required) (maximum 150 characters); Status: string [ACTIVE, INACTIVE] (maximum 30 characters); Type: string or null (maximum 30 characters); perspectives: array [{PerspItemId, ProcessId}] (maximum 100 entries). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_process_comment: {
    resource: 'process_comment',
    kind: 'create',
    label: 'Create Process Comment',
    params: ['processId'],
    bodyDescription:
      'JSON object with UserComment: string (required) (maximum 2000 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_process_risk: {
    resource: 'process_risk',
    kind: 'create',
    label: 'Create Process Risk',
    params: ['processId'],
    bodyDescription:
      'JSON object with RiskId: decimal ID string (required). Unsupported fields are rejected. Omitted optional fields remain unchanged. Parent business identifiers are resolved from the selected resource and bound automatically.',
  },
  oracle_fusion_risk_management_create_risk: {
    resource: 'risk',
    kind: 'create',
    label: 'Create Risk',
    params: [],
    bodyDescription:
      'JSON object with DetailedDescription: string or null (byte); Name: string (required) (maximum 150 characters); RiskAnalysisModelId: decimal ID string or null; RiskContextModelId: decimal ID string or null; Status: string [ACTIVE, INACTIVE] (maximum 30 characters); Type: string or null (maximum 30 characters); perspectives: array [{PerspItemId, RiskId}] (maximum 100 entries); relatedControls: array [{ChildId, ParentId}] (maximum 100 entries); relatedProcesses: array [{ProcessId, RiskId}] (maximum 100 entries). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_risk_comment: {
    resource: 'risk_comment',
    kind: 'create',
    label: 'Create Risk Comment',
    params: ['riskId'],
    bodyDescription:
      'JSON object with UserComment: string (required) (maximum 2000 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_create_test_plan_activity: {
    resource: 'test_plan_activity',
    kind: 'create',
    label: 'Create Test Plan Activity',
    params: ['controlId', 'testPlanId'],
    bodyDescription:
      'JSON object with ActivityCode: string (required) (maximum 30 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged. Parent business identifiers are resolved from the selected resource and bound automatically.',
  },
  oracle_fusion_risk_management_create_test_plan_step: {
    resource: 'test_plan_step',
    kind: 'create',
    label: 'Create Test Plan Step',
    params: ['controlId', 'testPlanId'],
    bodyDescription:
      'JSON object with DetailedDescription: string or null (byte); StepOrder: integer (required). Unsupported fields are rejected. Omitted optional fields remain unchanged. Parent business identifiers are resolved from the selected resource and bound automatically.',
  },
  oracle_fusion_risk_management_delete_assignment_group: {
    resource: 'assignment_group',
    kind: 'delete',
    label: 'Delete Assignment Group',
    params: ['groupKey'],
  },
  oracle_fusion_risk_management_delete_control_assertion: {
    resource: 'control_assertion',
    kind: 'delete',
    label: 'Delete Control Assertion',
    params: ['controlId', 'assertionKey'],
  },
  oracle_fusion_risk_management_delete_control_test_plan: {
    resource: 'control_test_plan',
    kind: 'delete',
    label: 'Delete Control Test Plan',
    params: ['controlId', 'testPlanId'],
  },
  oracle_fusion_risk_management_delete_group_member: {
    resource: 'group_member',
    kind: 'delete',
    label: 'Delete Group Member',
    params: ['groupKey', 'memberId'],
  },
  oracle_fusion_risk_management_delete_group_security_assignment: {
    resource: 'group_security_assignment',
    kind: 'delete',
    label: 'Delete Group Security Assignment',
    params: ['groupKey', 'securityAssignmentId'],
  },
  oracle_fusion_risk_management_delete_process_risk: {
    resource: 'process_risk',
    kind: 'delete',
    label: 'Delete Process Risk',
    params: ['processId', 'relationshipKey'],
  },
  oracle_fusion_risk_management_delete_test_plan_step: {
    resource: 'test_plan_step',
    kind: 'delete',
    label: 'Delete Test Plan Step',
    params: ['controlId', 'testPlanId', 'stepId'],
  },
  oracle_fusion_risk_management_get_access_simulation_status: {
    resource: 'simulation_result',
    kind: 'action',
    label: 'Get Access Simulation Status',
    params: ['requestId'],
  },
  oracle_fusion_risk_management_get_advanced_control: {
    resource: 'advanced_control',
    kind: 'get',
    label: 'Get Advanced Control',
    params: ['advancedControlId'],
  },
  oracle_fusion_risk_management_get_advanced_control_comment: {
    resource: 'advanced_control_comment',
    kind: 'get',
    label: 'Get Advanced Control Comment',
    params: ['advancedControlId', 'commentKey'],
  },
  oracle_fusion_risk_management_get_advanced_control_job: {
    resource: 'advanced_control_job',
    kind: 'get',
    label: 'Get Advanced Control Job',
    params: ['jobId'],
  },
  oracle_fusion_risk_management_get_advanced_control_perspective: {
    resource: 'advanced_control_perspective',
    kind: 'get',
    label: 'Get Advanced Control Perspective',
    params: ['advancedControlId', 'perspectiveKey'],
  },
  oracle_fusion_risk_management_get_assignment_group: {
    resource: 'assignment_group',
    kind: 'get',
    label: 'Get Assignment Group',
    params: ['groupKey'],
  },
  oracle_fusion_risk_management_get_control: {
    resource: 'control',
    kind: 'get',
    label: 'Get Control',
    params: ['controlId'],
  },
  oracle_fusion_risk_management_get_control_assertion: {
    resource: 'control_assertion',
    kind: 'get',
    label: 'Get Control Assertion',
    params: ['controlId', 'assertionKey'],
  },
  oracle_fusion_risk_management_get_control_assessment_result: {
    resource: 'control_assessment_result',
    kind: 'get',
    label: 'Get Control Assessment Result',
    params: ['controlAssessmentResultId'],
  },
  oracle_fusion_risk_management_get_control_comment: {
    resource: 'control_comment',
    kind: 'get',
    label: 'Get Control Comment',
    params: ['controlId', 'commentId'],
  },
  oracle_fusion_risk_management_get_control_perspective: {
    resource: 'control_perspective',
    kind: 'get',
    label: 'Get Control Perspective',
    params: ['controlId', 'perspectiveKey'],
  },
  oracle_fusion_risk_management_get_control_risk: {
    resource: 'control_risk',
    kind: 'get',
    label: 'Get Control Risk',
    params: ['controlId', 'relationshipKey'],
  },
  oracle_fusion_risk_management_get_control_test_plan: {
    resource: 'control_test_plan',
    kind: 'get',
    label: 'Get Control Test Plan',
    params: ['controlId', 'testPlanId'],
  },
  oracle_fusion_risk_management_get_group_eligible_user: {
    resource: 'group_eligible_user',
    kind: 'get',
    label: 'Get Group Eligible User',
    params: ['groupKey', 'userKey'],
  },
  oracle_fusion_risk_management_get_group_member: {
    resource: 'group_member',
    kind: 'get',
    label: 'Get Group Member',
    params: ['groupKey', 'memberId'],
  },
  oracle_fusion_risk_management_get_group_security_assignment: {
    resource: 'group_security_assignment',
    kind: 'get',
    label: 'Get Group Security Assignment',
    params: ['groupKey', 'securityAssignmentId'],
  },
  oracle_fusion_risk_management_get_incident: {
    resource: 'incident',
    kind: 'get',
    label: 'Get Incident',
    params: ['advancedControlId', 'incidentKey'],
  },
  oracle_fusion_risk_management_get_incident_attribute: {
    resource: 'incident_attribute',
    kind: 'get',
    label: 'Get Incident Attribute',
    params: ['advancedControlId', 'incidentKey', 'attributeKey'],
  },
  oracle_fusion_risk_management_get_incident_comment: {
    resource: 'incident_comment',
    kind: 'get',
    label: 'Get Incident Comment',
    params: ['advancedControlId', 'incidentKey', 'commentKey'],
  },
  oracle_fusion_risk_management_get_incident_perspective: {
    resource: 'incident_perspective',
    kind: 'get',
    label: 'Get Incident Perspective',
    params: ['advancedControlId', 'incidentKey', 'treeId'],
  },
  oracle_fusion_risk_management_get_issue: {
    resource: 'issue',
    kind: 'get',
    label: 'Get Issue',
    params: ['issueId'],
  },
  oracle_fusion_risk_management_get_open_incident: {
    resource: 'open_incident',
    kind: 'get',
    label: 'Get Open Incident',
    params: ['openIncidentKey'],
  },
  oracle_fusion_risk_management_get_process: {
    resource: 'process',
    kind: 'get',
    label: 'Get Process',
    params: ['processId'],
  },
  oracle_fusion_risk_management_get_process_action_item: {
    resource: 'process_action_item',
    kind: 'get',
    label: 'Get Process Action Item',
    params: ['processId', 'actionItemId'],
  },
  oracle_fusion_risk_management_get_process_assessment_result: {
    resource: 'process_assessment_result',
    kind: 'get',
    label: 'Get Process Assessment Result',
    params: ['processAssessmentResultId'],
  },
  oracle_fusion_risk_management_get_process_comment: {
    resource: 'process_comment',
    kind: 'get',
    label: 'Get Process Comment',
    params: ['processId', 'commentId'],
  },
  oracle_fusion_risk_management_get_process_perspective: {
    resource: 'process_perspective',
    kind: 'get',
    label: 'Get Process Perspective',
    params: ['processId', 'perspectiveKey'],
  },
  oracle_fusion_risk_management_get_process_risk: {
    resource: 'process_risk',
    kind: 'get',
    label: 'Get Process Risk',
    params: ['processId', 'relationshipKey'],
  },
  oracle_fusion_risk_management_get_risk: {
    resource: 'risk',
    kind: 'get',
    label: 'Get Risk',
    params: ['riskId'],
  },
  oracle_fusion_risk_management_get_risk_assessment_result: {
    resource: 'risk_assessment_result',
    kind: 'get',
    label: 'Get Risk Assessment Result',
    params: ['riskAssessmentResultId'],
  },
  oracle_fusion_risk_management_get_risk_comment: {
    resource: 'risk_comment',
    kind: 'get',
    label: 'Get Risk Comment',
    params: ['riskId', 'commentId'],
  },
  oracle_fusion_risk_management_get_risk_control: {
    resource: 'risk_control',
    kind: 'get',
    label: 'Get Risk Control',
    params: ['riskId', 'relationshipKey'],
  },
  oracle_fusion_risk_management_get_risk_perspective: {
    resource: 'risk_perspective',
    kind: 'get',
    label: 'Get Risk Perspective',
    params: ['riskId', 'perspectiveKey'],
  },
  oracle_fusion_risk_management_get_risk_process: {
    resource: 'risk_process',
    kind: 'get',
    label: 'Get Risk Process',
    params: ['riskId', 'relationshipKey'],
  },
  oracle_fusion_risk_management_get_securable_eligible_user: {
    resource: 'securable_eligible_user',
    kind: 'get',
    label: 'Get Securable Eligible User',
    params: ['securableTypeKey', 'userKey'],
  },
  oracle_fusion_risk_management_get_securable_role_type: {
    resource: 'securable_role_type',
    kind: 'get',
    label: 'Get Securable Role Type',
    params: ['securableTypeKey', 'roleTypeKey'],
  },
  oracle_fusion_risk_management_get_securable_type: {
    resource: 'securable_type',
    kind: 'get',
    label: 'Get Securable Type',
    params: ['securableTypeKey'],
  },
  oracle_fusion_risk_management_get_simulation_result: {
    resource: 'simulation_result',
    kind: 'get',
    label: 'Get Simulation Result',
    params: ['simulationResultKey'],
  },
  oracle_fusion_risk_management_get_test_plan_activity: {
    resource: 'test_plan_activity',
    kind: 'get',
    label: 'Get Test Plan Activity',
    params: ['controlId', 'testPlanId', 'activityKey'],
  },
  oracle_fusion_risk_management_get_test_plan_step: {
    resource: 'test_plan_step',
    kind: 'get',
    label: 'Get Test Plan Step',
    params: ['controlId', 'testPlanId', 'stepId'],
  },
  oracle_fusion_risk_management_list_advanced_control_comments: {
    resource: 'advanced_control_comment',
    kind: 'list',
    label: 'List Advanced Control Comments',
    params: ['advancedControlId'],
  },
  oracle_fusion_risk_management_list_advanced_control_jobs: {
    resource: 'advanced_control_job',
    kind: 'list',
    label: 'List Advanced Control Jobs',
    params: [],
  },
  oracle_fusion_risk_management_list_advanced_control_perspectives: {
    resource: 'advanced_control_perspective',
    kind: 'list',
    label: 'List Advanced Control Perspectives',
    params: ['advancedControlId'],
  },
  oracle_fusion_risk_management_list_advanced_controls: {
    resource: 'advanced_control',
    kind: 'list',
    label: 'List Advanced Controls',
    params: [],
  },
  oracle_fusion_risk_management_list_assignment_groups: {
    resource: 'assignment_group',
    kind: 'list',
    label: 'List Assignment Groups',
    params: [],
  },
  oracle_fusion_risk_management_list_control_assertions: {
    resource: 'control_assertion',
    kind: 'list',
    label: 'List Control Assertions',
    params: ['controlId'],
  },
  oracle_fusion_risk_management_list_control_assessment_results: {
    resource: 'control_assessment_result',
    kind: 'list',
    label: 'List Control Assessment Results',
    params: [],
  },
  oracle_fusion_risk_management_list_control_comments: {
    resource: 'control_comment',
    kind: 'list',
    label: 'List Control Comments',
    params: ['controlId'],
  },
  oracle_fusion_risk_management_list_control_perspectives: {
    resource: 'control_perspective',
    kind: 'list',
    label: 'List Control Perspectives',
    params: ['controlId'],
  },
  oracle_fusion_risk_management_list_control_risks: {
    resource: 'control_risk',
    kind: 'list',
    label: 'List Control Risks',
    params: ['controlId'],
  },
  oracle_fusion_risk_management_list_control_test_plans: {
    resource: 'control_test_plan',
    kind: 'list',
    label: 'List Control Test Plans',
    params: ['controlId'],
  },
  oracle_fusion_risk_management_list_controls: {
    resource: 'control',
    kind: 'list',
    label: 'List Controls',
    params: [],
  },
  oracle_fusion_risk_management_list_group_eligible_users: {
    resource: 'group_eligible_user',
    kind: 'list',
    label: 'List Group Eligible Users',
    params: ['groupKey'],
  },
  oracle_fusion_risk_management_list_group_members: {
    resource: 'group_member',
    kind: 'list',
    label: 'List Group Members',
    params: ['groupKey'],
  },
  oracle_fusion_risk_management_list_group_security_assignments: {
    resource: 'group_security_assignment',
    kind: 'list',
    label: 'List Group Security Assignments',
    params: ['groupKey'],
  },
  oracle_fusion_risk_management_list_incident_attributes: {
    resource: 'incident_attribute',
    kind: 'list',
    label: 'List Incident Attributes',
    params: ['advancedControlId', 'incidentKey'],
  },
  oracle_fusion_risk_management_list_incident_comments: {
    resource: 'incident_comment',
    kind: 'list',
    label: 'List Incident Comments',
    params: ['advancedControlId', 'incidentKey'],
  },
  oracle_fusion_risk_management_list_incident_perspectives: {
    resource: 'incident_perspective',
    kind: 'list',
    label: 'List Incident Perspectives',
    params: ['advancedControlId', 'incidentKey'],
  },
  oracle_fusion_risk_management_list_incidents: {
    resource: 'incident',
    kind: 'list',
    label: 'List Incidents',
    params: ['advancedControlId'],
  },
  oracle_fusion_risk_management_list_issues: {
    resource: 'issue',
    kind: 'list',
    label: 'List Issues',
    params: [],
  },
  oracle_fusion_risk_management_list_open_incidents: {
    resource: 'open_incident',
    kind: 'list',
    label: 'List Open Incidents',
    params: [],
  },
  oracle_fusion_risk_management_list_process_action_items: {
    resource: 'process_action_item',
    kind: 'list',
    label: 'List Process Action Items',
    params: ['processId'],
  },
  oracle_fusion_risk_management_list_process_assessment_results: {
    resource: 'process_assessment_result',
    kind: 'list',
    label: 'List Process Assessment Results',
    params: [],
  },
  oracle_fusion_risk_management_list_process_comments: {
    resource: 'process_comment',
    kind: 'list',
    label: 'List Process Comments',
    params: ['processId'],
  },
  oracle_fusion_risk_management_list_process_perspectives: {
    resource: 'process_perspective',
    kind: 'list',
    label: 'List Process Perspectives',
    params: ['processId'],
  },
  oracle_fusion_risk_management_list_process_risks: {
    resource: 'process_risk',
    kind: 'list',
    label: 'List Process Risks',
    params: ['processId'],
  },
  oracle_fusion_risk_management_list_processes: {
    resource: 'process',
    kind: 'list',
    label: 'List Processes',
    params: [],
  },
  oracle_fusion_risk_management_list_risk_assessment_results: {
    resource: 'risk_assessment_result',
    kind: 'list',
    label: 'List Risk Assessment Results',
    params: [],
  },
  oracle_fusion_risk_management_list_risk_comments: {
    resource: 'risk_comment',
    kind: 'list',
    label: 'List Risk Comments',
    params: ['riskId'],
  },
  oracle_fusion_risk_management_list_risk_controls: {
    resource: 'risk_control',
    kind: 'list',
    label: 'List Risk Controls',
    params: ['riskId'],
  },
  oracle_fusion_risk_management_list_risk_perspectives: {
    resource: 'risk_perspective',
    kind: 'list',
    label: 'List Risk Perspectives',
    params: ['riskId'],
  },
  oracle_fusion_risk_management_list_risk_processes: {
    resource: 'risk_process',
    kind: 'list',
    label: 'List Risk Processes',
    params: ['riskId'],
  },
  oracle_fusion_risk_management_list_risks: {
    resource: 'risk',
    kind: 'list',
    label: 'List Risks',
    params: [],
  },
  oracle_fusion_risk_management_list_securable_eligible_users: {
    resource: 'securable_eligible_user',
    kind: 'list',
    label: 'List Securable Eligible Users',
    params: ['securableTypeKey'],
  },
  oracle_fusion_risk_management_list_securable_role_types: {
    resource: 'securable_role_type',
    kind: 'list',
    label: 'List Securable Role Types',
    params: ['securableTypeKey'],
  },
  oracle_fusion_risk_management_list_securable_types: {
    resource: 'securable_type',
    kind: 'list',
    label: 'List Securable Types',
    params: [],
  },
  oracle_fusion_risk_management_list_simulation_results: {
    resource: 'simulation_result',
    kind: 'list',
    label: 'List Simulation Results',
    params: ['requestId'],
  },
  oracle_fusion_risk_management_list_test_plan_activities: {
    resource: 'test_plan_activity',
    kind: 'list',
    label: 'List Test Plan Activities',
    params: ['controlId', 'testPlanId'],
  },
  oracle_fusion_risk_management_list_test_plan_steps: {
    resource: 'test_plan_step',
    kind: 'list',
    label: 'List Test Plan Steps',
    params: ['controlId', 'testPlanId'],
  },
  oracle_fusion_risk_management_run_access_simulation: {
    resource: 'simulation_result',
    kind: 'action',
    label: 'Run Access Simulation',
    params: ['userName', 'provisioningInfo'],
  },
  oracle_fusion_risk_management_update_advanced_control: {
    resource: 'advanced_control',
    kind: 'update',
    label: 'Update Advanced Control',
    params: ['advancedControlId'],
    bodyDescription:
      'JSON object with Description: string or null (maximum 2000 characters); Name: string (maximum 256 characters); Status: string or null (maximum 30 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_assignment_group: {
    resource: 'assignment_group',
    kind: 'update',
    label: 'Update Assignment Group',
    params: ['groupKey'],
    bodyDescription:
      'JSON object with Name: string (maximum 200 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_control: {
    resource: 'control',
    kind: 'update',
    label: 'Update Control',
    params: ['controlId'],
    bodyDescription:
      'JSON object with AssessmentFlag: string or null (maximum 1 characters); AuditTestingFlag: string or null (maximum 1 characters); ControlCost: number or null; ControlFrequency: string or null (maximum 30 characters); ControlMethod: string (maximum 40 characters); ControlType: string or null (maximum 30 characters); DetailedDescription: string or null (byte); EnforcementType: string or null (maximum 50 characters); Name: string (maximum 150 characters); Status: string [ACTIVE, INACTIVE] (maximum 30 characters); perspectives: array [{ControlId, PerspItemId}] (maximum 100 entries). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_control_assertion: {
    resource: 'control_assertion',
    kind: 'update',
    label: 'Update Control Assertion',
    params: ['controlId', 'assertionKey'],
    bodyDescription:
      'JSON object with AssertionCode: string (required) (maximum 30 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_control_assessment_result: {
    resource: 'control_assessment_result',
    kind: 'update',
    label: 'Update Control Assessment Result',
    params: ['controlAssessmentResultId'],
    bodyDescription:
      'JSON object with ObjectVersionNumber: integer; ResponseCode: string or null [PASS, PASS_WITH_EXCEPTION, FAIL, NO_OPINION] (maximum 30 characters); ResultSummary: string or null (byte). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_control_test_plan: {
    resource: 'control_test_plan',
    kind: 'update',
    label: 'Update Control Test Plan',
    params: ['controlId', 'testPlanId'],
    bodyDescription:
      'JSON object with DetailedDescription: string or null (byte); Name: string (maximum 150 characters); SampleSize: integer or null; TestPlanFrequency: string or null (maximum 30 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_group_security_assignment: {
    resource: 'group_security_assignment',
    kind: 'update',
    label: 'Update Group Security Assignment',
    params: ['groupKey', 'securityAssignmentId'],
    bodyDescription:
      'JSON object with IsEditor: integer or null; IsOwner: integer or null; IsViewer: integer or null. Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_incident: {
    resource: 'incident',
    kind: 'update',
    label: 'Update Incident',
    params: ['advancedControlId', 'incidentKey'],
    bodyDescription:
      'JSON object with ResultInvestigator: string or null (maximum 255 characters); Status: string or null [Assigned, Accepted, Remediate, Resolved] (maximum 30 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_issue: {
    resource: 'issue',
    kind: 'update',
    label: 'Update Issue',
    params: ['issueId'],
    bodyDescription:
      'JSON object with DetailedDescription: string or null (byte); LikelihoodCode: string or null [HIGH, LOW, MEDIUM] (maximum 30 characters); Name: string (maximum 150 characters); ReasonCode: string or null (maximum 30 characters); RemedDate: string or null (date); RemediationFlag: boolean; Severity: string [DEFICIENCY, DOCUMENTATION_ONLY, MINOR_GAP, SIGNIFICANT_DEFICIENCY] (maximum 30 characters); Type: string or null (maximum 30 characters). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_process: {
    resource: 'process',
    kind: 'update',
    label: 'Update Process',
    params: ['processId'],
    bodyDescription:
      'JSON object with AssessmentFlag: boolean; AuditTestingFlag: boolean; DetailedDescription: string or null (byte); Name: string (maximum 150 characters); Status: string [ACTIVE, INACTIVE] (maximum 30 characters); Type: string or null (maximum 30 characters); perspectives: array [{PerspItemId, ProcessId}] (maximum 100 entries); actionItems: array [{ActionId, CompletedDate, DetailedDescription, DueDate, EstimatedCompletionDate, Name, PriorityCode, ProcessId, ProgressCode}] (maximum 100 entries). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_process_assessment_result: {
    resource: 'process_assessment_result',
    kind: 'update',
    label: 'Update Process Assessment Result',
    params: ['processAssessmentResultId'],
    bodyDescription:
      'JSON object with ObjectVersionNumber: integer; ResponseCode: string or null [COMPLETED, AGREE, AGREE_WITH_EXCEPTION, DO_NOT_AGREE,  PASS_WITH_EXCEPTION, FAIL, NO_OPINION, PASS, NO_ACTION] (maximum 30 characters); ResultSummary: string or null (byte). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_risk_assessment_result: {
    resource: 'risk_assessment_result',
    kind: 'update',
    label: 'Update Risk Assessment Result',
    params: ['riskAssessmentResultId'],
    bodyDescription:
      'JSON object with ObjectVersionNumber: integer; ResponseCode: string or null [REQ_EVALUATION, REQ_ADDITIONAL_ANALYSIS, REQ_DOCUMENTATION, MEETS_GUIDANCE, PASS_WITH_EXCEPTION, FAIL, NO_OPINION, OUT_OF_TOLERANCE, AGREE, AGREE_WITH_EXCEPTION, PASS, DO_NOT_AGREE] (maximum 30 characters); ResultSummary: string or null (byte). Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
  oracle_fusion_risk_management_update_test_plan_step: {
    resource: 'test_plan_step',
    kind: 'update',
    label: 'Update Test Plan Step',
    params: ['controlId', 'testPlanId', 'stepId'],
    bodyDescription:
      'JSON object with DetailedDescription: string or null (byte); StepOrder: integer. Unsupported fields are rejected. Omitted optional fields remain unchanged.',
  },
} as const satisfies Record<string, RiskOperationDefinition>

export type RiskOperation = keyof typeof RISK_OPERATIONS
export type RiskResource =
  | 'process'
  | 'risk'
  | 'control'
  | 'issue'
  | 'process_comment'
  | 'process_perspective'
  | 'risk_comment'
  | 'risk_perspective'
  | 'control_comment'
  | 'control_perspective'
  | 'process_risk'
  | 'risk_process'
  | 'risk_control'
  | 'control_risk'
  | 'process_action_item'
  | 'process_assessment_result'
  | 'risk_assessment_result'
  | 'control_assessment_result'
  | 'control_assertion'
  | 'control_test_plan'
  | 'test_plan_step'
  | 'test_plan_activity'
  | 'advanced_control'
  | 'advanced_control_comment'
  | 'advanced_control_perspective'
  | 'incident'
  | 'incident_comment'
  | 'incident_attribute'
  | 'incident_perspective'
  | 'open_incident'
  | 'advanced_control_job'
  | 'simulation_result'
  | 'assignment_group'
  | 'group_member'
  | 'group_security_assignment'
  | 'group_eligible_user'
  | 'securable_type'
  | 'securable_role_type'
  | 'securable_eligible_user'

export const PROCESS_OUTPUT_PROPERTIES = {
  ApprovedBy: {
    type: 'string',
    description: 'The user who approved the process.',
    optional: true,
  },
  ApprovedDate: {
    type: 'string',
    description: 'The date and time the process was approved.',
    optional: true,
  },
  AssessmentFlag: {
    type: 'boolean',
    description: 'Identifies if the process is in scope for an assessment.',
    optional: true,
  },
  AuditTestingFlag: {
    type: 'boolean',
    description: 'Identifies if the process is in scope for audit testing.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the process.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the process was created.',
    optional: true,
  },
  DetailedDescription: {
    type: 'string',
    description: 'The description of the process. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the process was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who most recently updated the process.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the process.',
    optional: true,
  },
  ProcessId: {
    type: 'string',
    description: 'The unique identifier of the process. Returned as a decimal string.',
  },
  ReviewStartDate: {
    type: 'string',
    description: 'The date and time when the process review was started.',
    optional: true,
  },
  ReviewedBy: {
    type: 'string',
    description: 'The user who reviewed the process.',
    optional: true,
  },
  ReviewedDate: {
    type: 'string',
    description: 'The date and time the process was reviewed.',
    optional: true,
  },
  RevisionDate: {
    type: 'string',
    description: 'The date when the process was revised.',
    optional: true,
  },
  RevisionNumber: {
    type: 'string',
    description: 'The revision of the process. Returned as a decimal string.',
    optional: true,
  },
  StateCode: {
    type: 'string',
    description: 'The state of the process.',
    optional: true,
  },
  Status: {
    type: 'string',
    description: 'The status of the process: ACTIVE or INACTIVE.',
    optional: true,
  },
  TotalRevisions: {
    type: 'string',
    description: 'The total number of revisions for the process. Returned as a decimal string.',
    optional: true,
  },
  Type: {
    type: 'string',
    description: 'One in a set of user-defined values that may be selected for the process.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const RISK_OUTPUT_PROPERTIES = {
  ApprovedBy: {
    type: 'string',
    description: 'The user who approved the risk.',
    optional: true,
  },
  ApprovedDate: {
    type: 'string',
    description: 'The date and time the risk was approved.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the risk.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the risk was created.',
    optional: true,
  },
  DetailedDescription: {
    type: 'string',
    description:
      'The description of the risk. This is a CLOB attribute. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the risk was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who last updated the risk.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the risk.',
    optional: true,
  },
  ReviewStartDate: {
    type: 'string',
    description: 'The date and time when the risk review was started.',
    optional: true,
  },
  ReviewedBy: {
    type: 'string',
    description: 'The user who reviewed the risk.',
    optional: true,
  },
  ReviewedDate: {
    type: 'string',
    description: 'The date and time when the risk was reviewed.',
    optional: true,
  },
  RevisionDate: {
    type: 'string',
    description: 'The date and time when the risk was revised.',
    optional: true,
  },
  RiskAnalysisModelId: {
    type: 'string',
    description:
      'The unique identifier of the analysis model for the risk. Returned as a decimal string.',
    optional: true,
  },
  RiskContextModelId: {
    type: 'string',
    description:
      'The unique identifier of the context model for the risk. Returned as a decimal string.',
    optional: true,
  },
  RiskId: {
    type: 'string',
    description: 'The unique identifier of the risk. Returned as a decimal string.',
  },
  StateCode: {
    type: 'string',
    description: 'The state of the risk.',
    optional: true,
  },
  Status: {
    type: 'string',
    description: 'The status of the risk: ACTIVE or INACTIVE.',
    optional: true,
  },
  TotalRevisions: {
    type: 'string',
    description:
      'The number of revisions that have been performed on the risk. Returned as a decimal string.',
    optional: true,
  },
  Type: {
    type: 'string',
    description: 'One in a set of user-defined values that may be selected for the risk.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CONTROL_OUTPUT_PROPERTIES = {
  ApprovedBy: {
    type: 'string',
    description: 'The user who approved the control.',
    optional: true,
  },
  ApprovedDate: {
    type: 'string',
    description: 'The date and time when the control was approved.',
    optional: true,
  },
  AssessmentFlag: {
    type: 'string',
    description: 'Whether the control is to be assessed.',
    optional: true,
  },
  AuditTestingFlag: {
    type: 'string',
    description: 'Whether the control is to be included in audit testing.',
    optional: true,
  },
  ControlCost: {
    type: 'string',
    description: 'The estimated cost of implementing the control. Returned as a decimal string.',
    optional: true,
  },
  ControlFrequency: {
    type: 'string',
    description: 'How often the control is to be run.',
    optional: true,
  },
  ControlId: {
    type: 'string',
    description: 'The unique identifier of a control. Returned as a decimal string.',
  },
  ControlMethod: {
    type: 'string',
    description: 'Whether the control is automated or manually enforced.',
    optional: true,
  },
  ControlType: {
    type: 'string',
    description: 'One in a set of user-defined values that may be selected for the control.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the control was created.',
    optional: true,
  },
  DetailedDescription: {
    type: 'string',
    description:
      'The detailed description of the control. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  EnforcementType: {
    type: 'string',
    description: 'Whether the control detects a risk, corrects it, or prevents if from occurring.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time of the last update of the control.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who most recently updated the control.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the control.',
    optional: true,
  },
  ReviewStartDate: {
    type: 'string',
    description: 'The date and time when the control review was started.',
    optional: true,
  },
  ReviewedBy: {
    type: 'string',
    description: 'The user who reviewed the control.',
    optional: true,
  },
  ReviewedDate: {
    type: 'string',
    description: 'The date and time when the control was reviewed.',
    optional: true,
  },
  RevisionDate: {
    type: 'string',
    description: 'The date and time when the control was most recently revised.',
    optional: true,
  },
  StartDate: {
    type: 'string',
    description: 'The effective start date of the control.',
    optional: true,
  },
  StateCode: {
    type: 'string',
    description: 'The state code of the control.',
    optional: true,
  },
  Status: {
    type: 'string',
    description: 'The status of the control. ACTIVE or INACTIVE',
    optional: true,
  },
  TotalRevisions: {
    type: 'string',
    description: 'The number of control revisions. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ISSUE_OUTPUT_PROPERTIES = {
  Action: {
    type: 'string',
    description: 'The action for an issue.',
    optional: true,
  },
  ApprovedBy: {
    type: 'string',
    description: 'The user who approved the issue, if any.',
    optional: true,
  },
  ApprovedDate: {
    type: 'string',
    description: 'The date and time the issue was approved.',
    optional: true,
  },
  ClosedDate: {
    type: 'string',
    description: 'The date and time the issue was closed.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the issue.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the issue was created.',
    optional: true,
  },
  DetailedDescription: {
    type: 'string',
    description:
      'The detailed description of the issue. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  HoldDate: {
    type: 'string',
    description: 'The hold date for the issue.',
    optional: true,
  },
  IssueId: {
    type: 'string',
    description: 'The unique identifier for the issue. Returned as a decimal string.',
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time when the issue was updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who most recently updated the issue.',
    optional: true,
  },
  LikelihoodCode: {
    type: 'string',
    description:
      'The code indicating the likelihood of the issue recurring: HIGH, LOW, or MEDIUM.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the issue.',
    optional: true,
  },
  OpenDate: {
    type: 'string',
    description: 'The date when the issue was opened.',
    optional: true,
  },
  OriginObjectId: {
    type: 'string',
    description:
      'The Financial Reporting Compliance record on which the issue was based. Returned as a decimal string.',
    optional: true,
  },
  OriginObjectTypeCode: {
    type: 'string',
    description:
      'The type of Financial Reporting Compliance record on which the issue was based. This could be a process, risk, or control, or an assessment of any of these objects.',
    optional: true,
  },
  ReasonCode: {
    type: 'string',
    description: 'The reason for closing the issue.',
    optional: true,
  },
  RemedDate: {
    type: 'string',
    description: 'The date when issue was remediated.',
    optional: true,
  },
  RemediationFlag: {
    type: 'boolean',
    description: 'The flag to identify if remediation of the issue is required.',
    optional: true,
  },
  ReviewedBy: {
    type: 'string',
    description: 'The user who reviewed the issue.',
    optional: true,
  },
  ReviewedDate: {
    type: 'string',
    description: 'The date and time the issue was reviewed.',
    optional: true,
  },
  RevisionNumber: {
    type: 'string',
    description: 'The revision number of the issue. Returned as a decimal string.',
    optional: true,
  },
  Severity: {
    type: 'string',
    description:
      'One in a set of values indicating the impact of the defect recorded by the issue: DEFICIENCY, DOCUMENTATION_ONLY, MINOR_GAP, or SIGNIFICANT_DEFICIENCY.',
    optional: true,
  },
  StartDate: {
    type: 'string',
    description: 'The start date of the issue.',
    optional: true,
  },
  StateCode: {
    type: 'string',
    description: 'The state code of the issue.',
    optional: true,
  },
  StateDate: {
    type: 'string',
    description: 'The date and time when the state of issue was updated.',
    optional: true,
  },
  Status: {
    type: 'string',
    description: 'Whether the issue is open, in remediation, or on hold.',
    optional: true,
  },
  Type: {
    type: 'string',
    description: 'One in a set of user-defined values that may be selected for the issue.',
    optional: true,
  },
  ValidDate: {
    type: 'string',
    description: 'The date the issue was identified as valid.',
    optional: true,
  },
  ValidatedBy: {
    type: 'string',
    description: 'The user who validated the issue.',
    optional: true,
  },
  ValidatedDate: {
    type: 'string',
    description: 'The date and time when the issue was validated.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROCESS_COMMENT_OUTPUT_PROPERTIES = {
  CreatedBy: {
    type: 'string',
    description: 'The user who created the comment.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the comment was created.',
    optional: true,
  },
  Id: {
    type: 'string',
    description:
      'The unique identifier of the comment on the process. Returned as a decimal string.',
  },
  UserComment: {
    type: 'string',
    description: 'The comment made on the process.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROCESS_PERSPECTIVE_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  Name: {
    type: 'string',
    description: 'The name of the perspective item assigned to the process.',
    optional: true,
  },
  PerspItemId: {
    type: 'string',
    description:
      'The unique identifier of the perspective value assigned to the process. Returned as a decimal string.',
    optional: true,
  },
  ProcessId: {
    type: 'string',
    description: 'The unique identifier of the process. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const RISK_COMMENT_OUTPUT_PROPERTIES = {
  CreatedBy: {
    type: 'string',
    description: 'The user who created the comment on the risk.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the comment was created.',
    optional: true,
  },
  Id: {
    type: 'string',
    description: 'The unique identifier of the comment on the risk. Returned as a decimal string.',
  },
  UserComment: {
    type: 'string',
    description: 'The comment made on the risk.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const RISK_PERSPECTIVE_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  Name: {
    type: 'string',
    description: 'The name of a perspective item assigned to the risk.',
    optional: true,
  },
  PerspItemId: {
    type: 'string',
    description:
      'The unique identifier of the perspective value assigned to the risk. Returned as a decimal string.',
    optional: true,
  },
  RiskId: {
    type: 'string',
    description: 'The unique identifier of the risk. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CONTROL_COMMENT_OUTPUT_PROPERTIES = {
  CreatedBy: {
    type: 'string',
    description: 'The user who created the comment.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the comment was created.',
    optional: true,
  },
  Id: {
    type: 'string',
    description:
      'The unique identifier of the comment on the control. Returned as a decimal string.',
  },
  UserComment: {
    type: 'string',
    description: 'The comment made on the control.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CONTROL_PERSPECTIVE_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  ControlId: {
    type: 'string',
    description:
      'The unique identifier of the control to which a perspective is assigned. Returned as a decimal string.',
    optional: true,
  },
  PerspItemId: {
    type: 'string',
    description:
      'The identifier for a perspective value assigned to the control. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROCESS_RISK_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  ProcessId: {
    type: 'string',
    description:
      'The unique identifier of the process the risk is related to. Returned as a decimal string.',
    optional: true,
  },
  RiskId: {
    type: 'string',
    description: 'The unique identifier of the risk. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const RISK_PROCESS_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  ProcessId: {
    type: 'string',
    description:
      'The unique identifier of the process associated to the risk. Returned as a decimal string.',
    optional: true,
  },
  RiskId: {
    type: 'string',
    description:
      'The unique identifier of the risk associated to the process. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const RISK_CONTROL_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  ChildId: {
    type: 'string',
    description:
      'The unique identifier of the control associated to the risk. Returned as a decimal string.',
    optional: true,
  },
  ParentId: {
    type: 'string',
    description:
      'The unique identifier of the risk associated to the control. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CONTROL_RISK_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  ChildId: {
    type: 'string',
    description: 'The identifier of the control related to a risk. Returned as a decimal string.',
    optional: true,
  },
  ParentId: {
    type: 'string',
    description: 'The identifier of the risk related to a control. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROCESS_ACTION_ITEM_OUTPUT_PROPERTIES = {
  ActionId: {
    type: 'string',
    description: 'The unique identifier of the action item. Returned as a decimal string.',
  },
  CompletedDate: {
    type: 'string',
    description: 'The date and time the action item was marked as complete.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the action item.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the action item was created.',
    optional: true,
  },
  DetailedDescription: {
    type: 'string',
    description:
      'The description of the action item. This is a CLOB attribute. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  DueDate: {
    type: 'string',
    description: 'The date when the action item is due.',
    optional: true,
  },
  EstimatedCompletionDate: {
    type: 'string',
    description: 'The target completion date of the action item.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the action item was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who most recently updated the action item.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the action item.',
    optional: true,
  },
  PriorityCode: {
    type: 'string',
    description: 'The priority of the action item.',
    optional: true,
  },
  ProcessId: {
    type: 'string',
    description:
      'The unique identifier of the process the action item is related to. Returned as a decimal string.',
    optional: true,
  },
  ProgressCode: {
    type: 'string',
    description:
      'A value indicating progress toward completion of the action item: Assigned, Blocked, Delayed, or On Target.',
    optional: true,
  },
  StartDate: {
    type: 'string',
    description: 'The date when the action item started.',
    optional: true,
  },
  StateCode: {
    type: 'string',
    description: 'The state of the action item.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PROCESS_ASSESSMENT_RESULT_OUTPUT_PROPERTIES = {
  ActivityCode: {
    type: 'string',
    description:
      'A code that identifies the assessment type, which specifies an activity the assessor is to complete.',
    optional: true,
  },
  ApprovedBy: {
    type: 'string',
    description: 'The user who approved the process assessment.',
    optional: true,
  },
  ApprovedDate: {
    type: 'string',
    description: 'The date and time the process assessment was approved.',
    optional: true,
  },
  AssessedBy: {
    type: 'string',
    description: 'The user who performed the process assessment.',
    optional: true,
  },
  AssessedDate: {
    type: 'string',
    description: 'The date and time the process assessment was performed.',
    optional: true,
  },
  AssessmentId: {
    type: 'string',
    description: 'The unique identifier of the process assessment. Returned as a decimal string.',
    optional: true,
  },
  CompletionDate: {
    type: 'string',
    description: 'The date and time when the process assessment was completed.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the process assessment.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the process assessment was created.',
    optional: true,
  },
  DueDate: {
    type: 'string',
    description: 'The date the process assessment is due.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the process assessment was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who most recently updated the process assessment.',
    optional: true,
  },
  ObjectVersionNumber: {
    type: 'string',
    description: 'The version of the process being assessed. Returned as a decimal string.',
    optional: true,
  },
  ProcessId: {
    type: 'string',
    description: 'The unique identifier of the process. Returned as a decimal string.',
    optional: true,
  },
  ResponseCode: {
    type: 'string',
    description:
      'One in a set of values indicating what the assessor has determined about a process, typically whether it has passed or failed its assessment: COMPLETED, AGREE, AGREE_WITH_EXCEPTION, DO_NOT_AGREE,  PASS_WITH_EXCEPTION, FAIL, NO_OPINION, PASS, NO_ACTION.',
    optional: true,
  },
  ResultId: {
    type: 'string',
    description:
      'The unique identifier of the result for the process assessment. Returned as a decimal string.',
  },
  ResultSummary: {
    type: 'string',
    description:
      'The detailed explanation for the assessment response. This is a CLOB attribute. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  ReviewedBy: {
    type: 'string',
    description: 'The user who reviewed the process assessment.',
    optional: true,
  },
  ReviewedDate: {
    type: 'string',
    description: 'The date and time the process assessment was reviewed.',
    optional: true,
  },
  StateCode: {
    type: 'string',
    description: 'The state of the process assessment.',
    optional: true,
  },
  SurveyId: {
    type: 'string',
    description:
      'The unique identifier of the survey related to the process assessment. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const RISK_ASSESSMENT_RESULT_OUTPUT_PROPERTIES = {
  ActivityCode: {
    type: 'string',
    description:
      'A code that identifies the assessment type, which specifies an activity the assessor is to complete.',
    optional: true,
  },
  ApprovedBy: {
    type: 'string',
    description: 'The user who approved the risk assessment.',
    optional: true,
  },
  ApprovedDate: {
    type: 'string',
    description: 'The date and time the risk assessment was approved.',
    optional: true,
  },
  AssessedBy: {
    type: 'string',
    description: 'The user who performed the risk assessment.',
    optional: true,
  },
  AssessedDate: {
    type: 'string',
    description: 'The date and time the risk assessment was performed.',
    optional: true,
  },
  AssessmentId: {
    type: 'string',
    description: 'The unique identifier of the risk assessment. Returned as a decimal string.',
    optional: true,
  },
  CompletionDate: {
    type: 'string',
    description: 'The date and time the risk assessment was completed.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the risk assessment.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the risk assessment was created.',
    optional: true,
  },
  DueDate: {
    type: 'string',
    description: 'The date when the risk assessment is due.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the risk assessment was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who most recently updated the risk assessment.',
    optional: true,
  },
  ObjectVersionNumber: {
    type: 'string',
    description: 'The version of the risk being assessed. Returned as a decimal string.',
    optional: true,
  },
  ResponseCode: {
    type: 'string',
    description:
      'One in a set of values indicating what the assessor has determined about a risk, typically whether it has passed or failed its assessment: REQ_EVALUATION, REQ_ADDITIONAL_ANALYSIS, REQ_DOCUMENTATION, MEETS_GUIDANCE, PASS_WITH_EXCEPTION, FAIL, NO_OPINION, OUT_OF_TOLERANCE, AGREE, AGREE_WITH_EXCEPTION, PASS, DO_NOT_AGREE.',
    optional: true,
  },
  ResultId: {
    type: 'string',
    description:
      'The unique identifier of the result for the risk assessment. Returned as a decimal string.',
  },
  ResultSummary: {
    type: 'string',
    description:
      'The detailed explanation for the assessment response. This is a CLOB attribute. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  ReviewedBy: {
    type: 'string',
    description: 'The user who reviewed the risk assessment.',
    optional: true,
  },
  ReviewedDate: {
    type: 'string',
    description: 'The date and time the risk assessment was reviewed.',
    optional: true,
  },
  RiskId: {
    type: 'string',
    description: 'The unique identifier for the risk. Returned as a decimal string.',
    optional: true,
  },
  StateCode: {
    type: 'string',
    description: 'The state of the risk assessment.',
    optional: true,
  },
  SurveyId: {
    type: 'string',
    description:
      'The unique identifier of the survey related to the risk assessment. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CONTROL_ASSESSMENT_RESULT_OUTPUT_PROPERTIES = {
  ActivityCode: {
    type: 'string',
    description:
      'A code that identifies the assessment type, which specifies an activity the assessor is to complete.',
    optional: true,
  },
  ApprovedBy: {
    type: 'string',
    description: 'The user who approved the assessment, if any.',
    optional: true,
  },
  ApprovedDate: {
    type: 'string',
    description: 'The date and time the assessment was approved.',
    optional: true,
  },
  AssessedBy: {
    type: 'string',
    description: 'The user who performed the assessment.',
    optional: true,
  },
  AssessedDate: {
    type: 'string',
    description: 'The date and time the control assessment was performed.',
    optional: true,
  },
  AssessmentId: {
    type: 'string',
    description: 'The unique identifier of the control assessment. Returned as a decimal string.',
    optional: true,
  },
  CompletionDate: {
    type: 'string',
    description: 'The date and time when the control assessment was completed.',
    optional: true,
  },
  ControlId: {
    type: 'string',
    description:
      'The unique identifier of the control associated to the assessment. Returned as a decimal string.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the control assessment.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the control assessment was created.',
    optional: true,
  },
  DueDate: {
    type: 'string',
    description: 'The date when the control assessment is due.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the control assessment was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who most recently updated the control assessment.',
    optional: true,
  },
  ObjectVersionNumber: {
    type: 'string',
    description:
      'The version number of the control when the assessment was created. Returned as a decimal string.',
    optional: true,
  },
  ResponseCode: {
    type: 'string',
    description:
      'One in a set of values indicating what the assessor has determined about a control, typically whether it has passed or failed its assessment: PASS, PASS_WITH_EXCEPTION, FAIL,NO_OPINION.',
    optional: true,
  },
  ResultId: {
    type: 'string',
    description:
      'The unique identifier of the result for the control assessment. Returned as a decimal string.',
  },
  ResultSummary: {
    type: 'string',
    description:
      'The detailed explanation for the assessment response. This is a CLOB attribute. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  ReviewedBy: {
    type: 'string',
    description: 'The user who reviewed the control assessment, if any.',
    optional: true,
  },
  ReviewedDate: {
    type: 'string',
    description: 'The date and time when the control assessment was reviewed.',
    optional: true,
  },
  StateCode: {
    type: 'string',
    description: 'The state of the control assessment.',
    optional: true,
  },
  SurveyId: {
    type: 'string',
    description:
      'The unique identifier of the survey related to the control assessment. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CONTROL_ASSERTION_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  AssertionCode: {
    type: 'string',
    description: 'The code for a control assertion.',
    optional: true,
  },
  ControlId: {
    type: 'string',
    description:
      'The unique identifier of the control an assertion is related to. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const CONTROL_TEST_PLAN_OUTPUT_PROPERTIES = {
  ControlId: {
    type: 'string',
    description:
      'The unique identifier for the control the plan is created to test. Returned as a decimal string.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the test plan.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'the date and time the test plan was created.',
    optional: true,
  },
  DetailedDescription: {
    type: 'string',
    description:
      'The detailed description of the test plan. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the test plan was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The last user who updated the test plan.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the test plan.',
    optional: true,
  },
  RevisionDate: {
    type: 'string',
    description: 'The date when the test plan was most recently revised.',
    optional: true,
  },
  SampleSize: {
    type: 'string',
    description:
      'The number of control-enforcement instances to be examined for the plan to be completed. Returned as a decimal string.',
    optional: true,
  },
  TestPlanFrequency: {
    type: 'string',
    description: 'Whether the test plan is to be run daily, weekly, monthly, or annually.',
    optional: true,
  },
  TestPlanId: {
    type: 'string',
    description: 'Unique identifier of the test plan. Returned as a decimal string.',
  },
} as const satisfies Record<string, OutputProperty>

export const TEST_PLAN_STEP_OUTPUT_PROPERTIES = {
  CreatedBy: {
    type: 'string',
    description: 'The user who created the test step.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the test step was created.',
    optional: true,
  },
  DetailedDescription: {
    type: 'string',
    description:
      'The detailed description of the test step. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time when the test step was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who updated the test step most recently.',
    optional: true,
  },
  StepId: {
    type: 'string',
    description: 'The unique identifier for the test step. Returned as a decimal string.',
  },
  StepOrder: {
    type: 'string',
    description: 'The logical order of the test step. Returned as a decimal string.',
    optional: true,
  },
  TestPlanId: {
    type: 'string',
    description:
      'The unique identifier for the test plan the step is a part of. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const TEST_PLAN_ACTIVITY_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  ActivityCode: {
    type: 'string',
    description:
      'A code for the assessment activity in support of which the test plan is carried out.',
    optional: true,
  },
  ControlId: {
    type: 'string',
    description:
      'The unique identifier of the control to which this test plan activity is related. Returned as a decimal string.',
    optional: true,
  },
  TestPlanId: {
    type: 'string',
    description: 'The unique identifier of the test plan. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ADVANCED_CONTROL_OUTPUT_PROPERTIES = {
  CreatedBy: {
    type: 'string',
    description: 'The user who created the advanced control.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the advanced control was created.',
    optional: true,
  },
  Description: {
    type: 'string',
    description: 'The description of the advanced control.',
    optional: true,
  },
  EnforcementType: {
    type: 'string',
    description:
      'Whether a control identifies role assignments or transaction risk that should be monitored, approved, or prevented. Returned as a decimal string.',
    optional: true,
  },
  Id: {
    type: 'string',
    description: 'The unique identifier of the advanced control. Returned as a decimal string.',
  },
  LastRunDate: {
    type: 'string',
    description: 'The date and time when the advanced control was most recently run.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time when the advanced control was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who updated the advanced control most recently.',
    optional: true,
  },
  LatestJobId: {
    type: 'string',
    description:
      'The job identifier generated when the advanced control was most recently run. Returned as a decimal string.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the advanced control.',
    optional: true,
  },
  ScheduledBy: {
    type: 'string',
    description: 'The user who scheduled the advanced control to run.',
    optional: true,
  },
  StateCode: {
    type: 'string',
    description: 'The state of the advanced control.',
    optional: true,
  },
  Status: {
    type: 'string',
    description: 'Whether the advanced control status is Active or Inactive.',
    optional: true,
  },
  StatusId: {
    type: 'string',
    description:
      'The identifier for the status of the advanced control. Returned as a decimal string.',
    optional: true,
  },
  Type: {
    type: 'string',
    description:
      'The type of risk the advanced control analyzes, access or transaction. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ADVANCED_CONTROL_COMMENT_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the advanced-control comment.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the advanced-control comment was created.',
    optional: true,
  },
  Id: {
    type: 'string',
    description:
      'The unique identifier of the advanced-control comment. Returned as a decimal string.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the advanced-control comment was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who updated the advanced-control comment most recently.',
    optional: true,
  },
  UserComment: {
    type: 'string',
    description: 'The text of the advanced-control comment.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ADVANCED_CONTROL_PERSPECTIVE_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  ControlId: {
    type: 'string',
    description:
      'The unique identifier of the advanced control the perspective value is assigned to. Returned as a decimal string.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the perspective value assigned to the advanced control.',
    optional: true,
  },
  TreeId: {
    type: 'string',
    description:
      'The unique identifier of the perspective hierarchy. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INCIDENT_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  AccessPointName: {
    type: 'string',
    description:
      'The terminal access point in the path that is the focus of an access incident. This does not apply to incidents returned by transaction controls.',
    optional: true,
  },
  AccessPointType: {
    type: 'string',
    description:
      'Whether the focal access point of an access incident is a privilege or a role. This does not apply to transaction incidents.',
    optional: true,
  },
  ClosedBy: {
    type: 'string',
    description: 'The user who closed the advanced-control incident.',
    optional: true,
  },
  ClosedDate: {
    type: 'string',
    description: 'The date and time when the advanced-control incident was closed.',
    optional: true,
  },
  ConflictingAccPointName: {
    type: 'string',
    description:
      'The name of an access point that is in conflict with the access point identified by the AccessPointName attribute.',
    optional: true,
  },
  ConflictingRoles: {
    type: 'string',
    description:
      'For an access incident, access paths that conflict with the access path that is the focus of the incident. This does not apply to transaction incidents.',
    optional: true,
  },
  ControlId: {
    type: 'string',
    description:
      'The unique identifier of the advanced control that generated the incident. Returned as a decimal string.',
    optional: true,
  },
  ControlName: {
    type: 'string',
    description: 'The name of the advanced control that generated the incident.',
    optional: true,
  },
  ControlType: {
    type: 'string',
    description:
      'The type of advanced control that generated the incident, access or transaction. Returned as a decimal string.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the advanced-control incident.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the advanced-control incident was created.',
    optional: true,
  },
  DataSource: {
    type: 'string',
    description: 'The data source in which the incident occurred.',
    optional: true,
  },
  Entitlement: {
    type: 'string',
    description:
      'The entitlement, if any, to which the focal access point of an access incident belongs. This does not apply to transaction incidents.',
    optional: true,
  },
  GlobalUserId: {
    type: 'string',
    description: 'The unique identifier of the global user. Returned as a decimal string.',
    optional: true,
  },
  GlobalUserName: {
    type: 'string',
    description: 'The unique global user name.',
    optional: true,
  },
  GroupingValue: {
    type: 'string',
    description:
      'For a transaction incident, Grouping Value reports the value that grouped result records have in common. For an access incident, Grouping Value is not used.',
    optional: true,
  },
  Id: {
    type: 'string',
    description: 'The unique identifier of the advanced-control incident.',
    optional: true,
  },
  IncidentInformation: {
    type: 'string',
    description:
      'For a transaction incident, Incident Information is the value returned for the first attribute selected as a result attribute for the control. For an access incident, Incident Information is the path by which a user reaches an access point that is the focus of the incident.',
    optional: true,
  },
  IncidentInformationCodes: {
    type: 'string',
    description:
      'The unique codes that correlate to the incident information path value. These codes represent the job, duty, and privilege codes.',
    optional: true,
  },
  IncidentVersion: {
    type: 'string',
    description: 'The version of the incident. Returned as a decimal string.',
    optional: true,
  },
  IsIntraRoleViol: {
    type: 'string',
    description:
      'Whether the incident is an "intra-role" conflict, which is defined as involving access points available within a single role.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time when the advanced-control incident was updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who updated the advanced-control incident most recently.',
    optional: true,
  },
  Priority: {
    type: 'string',
    description: 'The priority of the advanced-control incident. Returned as a decimal string.',
    optional: true,
  },
  ResultGroup: {
    type: 'string',
    description:
      'For a transaction incident, Group is a descriptor that indicates what grouped return values have in common. For example, a filter that uses the Equals condition groups records in which values are equal, and Group reports the business object and attribute whose values are equal. For an access incident, Group is one or more access paths that conflict with the Incident Information path.',
    optional: true,
  },
  ResultInvestigator: {
    type: 'string',
    description: 'The investigator assigned to the advanced-control incident.',
    optional: true,
  },
  RevisionDate: {
    type: 'string',
    description: 'The date and time the advanced-control incident was revised.',
    optional: true,
  },
  Role: {
    type: 'string',
    description:
      'The parent role in the path that is the focus of an access incident. This does not apply to incidents returned by transaction controls.',
    optional: true,
  },
  State: {
    type: 'string',
    description:
      'The state of the advanced-control incident. Values include In Investigation, Approved, and Closed.',
    optional: true,
  },
  Status: {
    type: 'string',
    description:
      'The status of the advanced-control incident. Values include Assigned, Accepted, Remediate, and Resolved.',
    optional: true,
  },
  UserFirstName: {
    type: 'string',
    description: 'The first name of the user involved in the incident result.',
    optional: true,
  },
  UserLastName: {
    type: 'string',
    description: 'The last name of the user involved in the incident result.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INCIDENT_COMMENT_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the advanced-control comment.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time the advanced-control comment was created.',
    optional: true,
  },
  Delegated: {
    type: 'string',
    description: 'The flag indicating that the advanced-control comment was delegated.',
    optional: true,
  },
  Id: {
    type: 'string',
    description:
      'The unique identifier of the advanced-control comment. Returned as a decimal string.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time the advanced-control comment was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who updated the advanced-control comment most recently.',
    optional: true,
  },
  UserComment: {
    type: 'string',
    description: 'The text of the advanced-control comment.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INCIDENT_ATTRIBUTE_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  AttributeName: {
    type: 'string',
    description: 'The name for the dynamic attribute of the advanced control incident.',
    optional: true,
  },
  AttributeValue: {
    type: 'string',
    description: 'The value for the dynamic attribute of the advanced control incident.',
    optional: true,
  },
  Id: {
    type: 'string',
    description:
      'The unique identifier of the advanced control incident the dynamic attribute belongs to.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INCIDENT_PERSPECTIVE_OUTPUT_PROPERTIES = {
  IncidentId: {
    type: 'string',
    description:
      'The unique identifier of the advanced control incident the perspective value is assigned to.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the perspective value assigned to the advanced control.',
    optional: true,
  },
  TreeId: {
    type: 'string',
    description:
      'The unique identifier of the perspective hierarchy. Returned as a decimal string.',
  },
} as const satisfies Record<string, OutputProperty>

export const OPEN_INCIDENT_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  ConflictingRoles: {
    type: 'string',
    description: 'The conflicting role of the open incident.',
    optional: true,
  },
  ControlId: {
    type: 'string',
    description:
      'The advanced control identifier of the open incident. Returned as a decimal string.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the open incident.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the open incident was created.',
    optional: true,
  },
  DatasourceName: {
    type: 'string',
    description: 'The data source of the open incident.',
    optional: true,
  },
  GlobalUserEmail: {
    type: 'string',
    description: 'The global user email of the open incident.',
    optional: true,
  },
  GlobalUserId: {
    type: 'string',
    description: 'The global user identifier of the open incident.',
    optional: true,
  },
  GlobalUserName: {
    type: 'string',
    description: 'The global user name of the open incident.',
    optional: true,
  },
  IncidentInformation: {
    type: 'string',
    description: 'The incident information of the open incident.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time when the open incident was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who updated the open incident most recently.',
    optional: true,
  },
  ResultId: {
    type: 'string',
    description: 'The identifier of the open incident.',
    optional: true,
  },
  Role: {
    type: 'string',
    description: 'The role of the open incident.',
    optional: true,
  },
  Status: {
    type: 'string',
    description: 'The status of the open incident.',
    optional: true,
  },
  Type: {
    type: 'string',
    description: 'The type of the open incident. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ADVANCED_CONTROL_JOB_OUTPUT_PROPERTIES = {
  CreatedBy: {
    type: 'string',
    description: 'The user who created the job.',
    optional: true,
  },
  EndDate: {
    type: 'string',
    description: 'The date and time when the job ended.',
    optional: true,
  },
  FailedItems: {
    type: 'string',
    description: 'The number of items in a job that failed. Returned as a decimal string.',
    optional: true,
  },
  Id: {
    type: 'string',
    description: 'The unique identifier of the job. Returned as a decimal string.',
  },
  JobType: {
    type: 'string',
    description:
      'A label indicating what the job is to accomplish, such as Business Object Import or Security Synchronization.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who last updated the job.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The name of the job.',
    optional: true,
  },
  Result: {
    type: 'string',
    description: 'The result of the job. Preserves the Oracle byte-formatted string.',
    optional: true,
  },
  ScheduledBy: {
    type: 'string',
    description: 'The user who scheduled the job.',
    optional: true,
  },
  StartDate: {
    type: 'string',
    description: 'The date and time when the job started.',
    optional: true,
  },
  StatusId: {
    type: 'string',
    description: 'The unique identifier of the job status. Returned as a decimal string.',
    optional: true,
  },
  StatusMessage: {
    type: 'string',
    description: 'The message generated by the job.',
    optional: true,
  },
  SuccessfullyProcessedItems: {
    type: 'string',
    description:
      'The number of items that the job processed successfully. Returned as a decimal string.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SIMULATION_RESULT_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  conflictingRole: {
    type: 'string',
    description:
      'The roles conflicting with the role to be assigned to the user, delimited by a pipe character.',
    optional: true,
  },
  controlId: {
    type: 'string',
    description: 'The ID of an access control. Returned as a decimal string.',
    optional: true,
  },
  controlName: {
    type: 'string',
    description: 'The name of the access control.',
    optional: true,
  },
  incidentPath: {
    type: 'string',
    description:
      'The result path, represented as role display names leading to the privilege found to be in conflict with the requested role.',
    optional: true,
  },
  incidentPathCode: {
    type: 'string',
    description:
      'The result path, represented as role codes leading to the privilege found to be in conflict with the requested role.',
    optional: true,
  },
  inputRoleCode: {
    type: 'string',
    description: 'The code of the role to be assigned to the user.',
    optional: true,
  },
  inputRoleName: {
    type: 'string',
    description: 'The name of the role to be assigned to the user.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ASSIGNMENT_GROUP_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the user assignment group.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the user assignment group was created.',
    optional: true,
  },
  GroupId: {
    type: 'string',
    description: 'The ID of the user assignment group.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time when the user assignment group was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who updated the user assignment group most recently.',
    optional: true,
  },
  MemberCount: {
    type: 'string',
    description:
      'The number of members of the user assignment group. Returned as a decimal string.',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'The group name.',
    optional: true,
  },
  OrphanCount: {
    type: 'string',
    description:
      'The number of orphan (inactive) members of the user assignment group. Returned as a decimal string.',
    optional: true,
  },
  PrivilegeCode: {
    type: 'string',
    description: 'The privilege code associated to the user assignment group.',
    optional: true,
  },
  RoleType: {
    type: 'string',
    description: 'The group authorization.',
    optional: true,
  },
  SecurableType: {
    type: 'string',
    description: 'The object type to be secured by the group.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const GROUP_MEMBER_OUTPUT_PROPERTIES = {

  Displayname: {
    type: 'string',
    description: 'The member display name.',
    optional: true,
  },
  GroupId: {
    type: 'string',
    description: 'The member group ID.',
    optional: true,
  },
  Id: {
    type: 'string',
    description: 'The member ID. Returned as a decimal string.',
  },
  IsOrphan: {
    type: 'string',
    description: 'Either the member is valid or invalid. Returned as a decimal string.',
    optional: true,
  },
  PersonId: {
    type: 'string',
    description: 'The member person ID. Returned as a decimal string.',
    optional: true,
  },
  UserId: {
    type: 'string',
    description: 'The member GUID.',
    optional: true,
  },
  Username: {
    type: 'string',
    description: 'The member user name.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const GROUP_SECURITY_ASSIGNMENT_OUTPUT_PROPERTIES = {

  AccessorDisplayName: {
    type: 'string',
    description:
      'The display name of a user, or the name of a group, granted a security assignment for a user assignment group.',
    optional: true,
  },
  AccessorId: {
    type: 'string',
    description:
      'The GUID of a user, or the ID of a group, granted a security assignment for the group.',
    optional: true,
  },
  AccessorType: {
    type: 'string',
    description:
      'A type value, USER or GROUP, identifying whether the actor granted a security assignment is a user or a group.',
    optional: true,
  },
  CreatedBy: {
    type: 'string',
    description: 'The user who created the security assignment.',
    optional: true,
  },
  CreationDate: {
    type: 'string',
    description: 'The date and time when the security assignment was created.',
    optional: true,
  },
  Id: {
    type: 'string',
    description: 'The unique identifier of the security assignment. Returned as a decimal string.',
  },
  IsEditor: {
    type: 'string',
    description: 'Indicates the user is assigned as an editor. Returned as a decimal string.',
    optional: true,
  },
  IsOwner: {
    type: 'string',
    description: 'Indicates the user is assigned as an owner. Returned as a decimal string.',
    optional: true,
  },
  IsViewer: {
    type: 'string',
    description: 'Indicates the user is assigned as a viewer. Returned as a decimal string.',
    optional: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'The date and time when the security assignment was most recently updated.',
    optional: true,
  },
  LastUpdatedBy: {
    type: 'string',
    description: 'The user who most recently updated the security assignment.',
    optional: true,
  },
  SecurableId: {
    type: 'string',
    description: 'ID of the group that is being secured.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const GROUP_ELIGIBLE_USER_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  DisplayName: {
    type: 'string',
    description: 'The eligible user display name.',
    optional: true,
  },
  PersonId: {
    type: 'string',
    description: 'The eligible user person ID. Returned as a decimal string.',
    optional: true,
  },
  RoleType: {
    type: 'string',
    description:
      'Authorization that qualifies this user to be eligible as an owner, editor, or viewer.',
    optional: true,
  },
  SecurableType: {
    type: 'string',
    description: 'Object for which this user qualifies to be eligible.',
    optional: true,
  },
  UserGuid: {
    type: 'string',
    description: 'The eligible user GUID.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SECURABLE_TYPE_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  Meaning: {
    type: 'string',
    description: 'The localized translation of the object name.',
    optional: true,
  },
  SecurableType: {
    type: 'string',
    description: 'The unique identifier of a localized translation of the object name.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SECURABLE_ROLE_TYPE_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  Meaning: {
    type: 'string',
    description: 'The localized translation of the authorization.',
    optional: true,
  },
  PrivilegeCode: {
    type: 'string',
    description: 'The security privilege to access the risk-management object.',
    optional: true,
  },
  RoleType: {
    type: 'string',
    description: 'The unique identifier of a localized translation of the authorization.',
    optional: true,
  },
  SecurableType: {
    type: 'string',
    description: 'The association of an authorization with an object.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const SECURABLE_ELIGIBLE_USER_OUTPUT_PROPERTIES = {
  key: {
    type: 'string',
    description: 'Opaque key from the validated Oracle self link; use with the same parent resource',
  },
  DisplayName: {
    type: 'string',
    description: 'The eligible user display name.',
    optional: true,
  },
  PersonId: {
    type: 'string',
    description: 'The eligible user person ID. Returned as a decimal string.',
    optional: true,
  },
  RoleType: {
    type: 'string',
    description:
      'Authorization that qualifies this user to be eligible as an owner, editor, or viewer.',
    optional: true,
  },
  SecurableType: {
    type: 'string',
    description: 'Object for which this user qualifies to be eligible.',
    optional: true,
  },
  UserGuid: {
    type: 'string',
    description: 'The eligible user GUID.',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const RISK_PAGINATION_OUTPUTS = {
  count: { type: 'number', description: 'Records in this page' },
  hasMore: { type: 'boolean', description: 'Whether another page is available' },
  limit: { type: 'number', description: 'Oracle page limit' },
  offset: { type: 'number', description: 'Offset of this page' },
  nextOffset: { type: 'number', description: 'Offset for the next explicit request', optional: true },
  totalResults: { type: 'number', description: 'Estimated total when requested and returned', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface OracleFusionRiskManagementResponse extends ToolResponse {
  output: {
    record?: Record<string, string | boolean | null>
    items?: Record<string, string | boolean | null>[]
    count?: number
    hasMore?: boolean
    limit?: number
    offset?: number
    nextOffset?: number
    totalResults?: number
    deleted?: boolean
    requestId?: string
    status?: string
  }
}
