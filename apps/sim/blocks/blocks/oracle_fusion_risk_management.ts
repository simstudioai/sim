import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta, SubBlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'
import {
  RISK_OPERATIONS,
  type RiskOperationDefinition,
} from '@/tools/oracle_fusion_risk_management/types'

const operationEntries = Object.entries(RISK_OPERATIONS)
const listOperations = operationEntries
  .filter(([, operation]) => operation.kind === 'list')
  .map(([id]) => id)
const writeOperations = operationEntries
  .filter(([, operation]) => operation.kind === 'create' || operation.kind === 'update')
  .map(([id]) => id)
const inputOperations: Record<string, string[]> = {}
for (const [id, definition] of operationEntries) {
  for (const param of definition.params) (inputOperations[param] ??= []).push(id)
}

const identifierInputs: SubBlockConfig[] = [
  {
    id: 'actionItemId',
    title: 'Action Item Id',
    type: 'short-input',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.actionItemId },
  },
  {
    id: 'activityKey',
    title: 'Activity Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.activityKey },
  },
  {
    id: 'advancedControlIdSelector',
    title: 'Advanced Control',
    type: 'project-selector',
    canonicalParamId: 'advancedControlId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.advanced_control',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.advancedControlId },
  },
  {
    id: 'advancedControlIdManual',
    title: 'Advanced Control',
    type: 'short-input',
    canonicalParamId: 'advancedControlId',
    mode: 'advanced',
    required: true,
    placeholder: 'Oracle identifier as a string',
    condition: { field: 'operation', value: inputOperations.advancedControlId },
  },
  {
    id: 'assertionKey',
    title: 'Assertion Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.assertionKey },
  },
  {
    id: 'attributeKey',
    title: 'Attribute Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.attributeKey },
  },
  {
    id: 'commentId',
    title: 'Comment Id',
    type: 'short-input',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.commentId },
  },
  {
    id: 'commentKey',
    title: 'Comment Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.commentKey },
  },
  {
    id: 'controlAssessmentResultIdSelector',
    title: 'Control Assessment Result',
    type: 'project-selector',
    canonicalParamId: 'controlAssessmentResultId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.control_assessment_result',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.controlAssessmentResultId },
  },
  {
    id: 'controlAssessmentResultIdManual',
    title: 'Control Assessment Result',
    type: 'short-input',
    canonicalParamId: 'controlAssessmentResultId',
    mode: 'advanced',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.controlAssessmentResultId },
  },
  {
    id: 'controlIdSelector',
    title: 'Control',
    type: 'project-selector',
    canonicalParamId: 'controlId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.control',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.controlId },
  },
  {
    id: 'controlIdManual',
    title: 'Control',
    type: 'short-input',
    canonicalParamId: 'controlId',
    mode: 'advanced',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.controlId },
  },
  {
    id: 'groupKeySelector',
    title: 'Assignment Group',
    type: 'project-selector',
    canonicalParamId: 'groupKey',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.assignment_group',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.groupKey },
  },
  {
    id: 'groupKeyManual',
    title: 'Assignment Group',
    type: 'short-input',
    canonicalParamId: 'groupKey',
    mode: 'advanced',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.groupKey },
  },
  {
    id: 'incidentKey',
    title: 'Incident Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.incidentKey },
  },
  {
    id: 'issueIdSelector',
    title: 'Issue',
    type: 'project-selector',
    canonicalParamId: 'issueId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.issue',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.issueId },
  },
  {
    id: 'issueIdManual',
    title: 'Issue',
    type: 'short-input',
    canonicalParamId: 'issueId',
    mode: 'advanced',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.issueId },
  },
  {
    id: 'jobIdSelector',
    title: 'Advanced Control Job',
    type: 'project-selector',
    canonicalParamId: 'jobId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.advanced_control_job',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.jobId },
  },
  {
    id: 'jobIdManual',
    title: 'Advanced Control Job',
    type: 'short-input',
    canonicalParamId: 'jobId',
    mode: 'advanced',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.jobId },
  },
  {
    id: 'memberId',
    title: 'Member Id',
    type: 'short-input',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.memberId },
  },
  {
    id: 'openIncidentKeySelector',
    title: 'Open Incident',
    type: 'project-selector',
    canonicalParamId: 'openIncidentKey',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.open_incident',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.openIncidentKey },
  },
  {
    id: 'openIncidentKeyManual',
    title: 'Open Incident',
    type: 'short-input',
    canonicalParamId: 'openIncidentKey',
    mode: 'advanced',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.openIncidentKey },
  },
  {
    id: 'perspectiveKey',
    title: 'Perspective Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.perspectiveKey },
  },
  {
    id: 'processAssessmentResultIdSelector',
    title: 'Process Assessment Result',
    type: 'project-selector',
    canonicalParamId: 'processAssessmentResultId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.process_assessment_result',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.processAssessmentResultId },
  },
  {
    id: 'processAssessmentResultIdManual',
    title: 'Process Assessment Result',
    type: 'short-input',
    canonicalParamId: 'processAssessmentResultId',
    mode: 'advanced',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.processAssessmentResultId },
  },
  {
    id: 'processIdSelector',
    title: 'Process',
    type: 'project-selector',
    canonicalParamId: 'processId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.process',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.processId },
  },
  {
    id: 'processIdManual',
    title: 'Process',
    type: 'short-input',
    canonicalParamId: 'processId',
    mode: 'advanced',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.processId },
  },
  {
    id: 'relationshipKey',
    title: 'Relationship Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.relationshipKey },
  },
  {
    id: 'requestId',
    title: 'Request Id',
    type: 'short-input',
    required: true,
    placeholder:
      'Simulation request identifier returned by Run Access Simulation, preserved as a decimal string',
    condition: { field: 'operation', value: inputOperations.requestId },
  },
  {
    id: 'riskAssessmentResultIdSelector',
    title: 'Risk Assessment Result',
    type: 'project-selector',
    canonicalParamId: 'riskAssessmentResultId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.risk_assessment_result',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.riskAssessmentResultId },
  },
  {
    id: 'riskAssessmentResultIdManual',
    title: 'Risk Assessment Result',
    type: 'short-input',
    canonicalParamId: 'riskAssessmentResultId',
    mode: 'advanced',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.riskAssessmentResultId },
  },
  {
    id: 'riskIdSelector',
    title: 'Risk',
    type: 'project-selector',
    canonicalParamId: 'riskId',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.risk',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.riskId },
  },
  {
    id: 'riskIdManual',
    title: 'Risk',
    type: 'short-input',
    canonicalParamId: 'riskId',
    mode: 'advanced',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.riskId },
  },
  {
    id: 'roleTypeKey',
    title: 'Role Type Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.roleTypeKey },
  },
  {
    id: 'securableTypeKeySelector',
    title: 'Securable Type',
    type: 'project-selector',
    canonicalParamId: 'securableTypeKey',
    serviceId: 'oracle_fusion_risk_management',
    selectorKey: 'oracle_fusion_risk_management.securable_type',
    dependsOn: ['oauthCredential'],
    mode: 'basic',
    required: true,
    condition: { field: 'operation', value: inputOperations.securableTypeKey },
  },
  {
    id: 'securableTypeKeyManual',
    title: 'Securable Type',
    type: 'short-input',
    canonicalParamId: 'securableTypeKey',
    mode: 'advanced',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.securableTypeKey },
  },
  {
    id: 'securityAssignmentId',
    title: 'Security Assignment Id',
    type: 'short-input',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.securityAssignmentId },
  },
  {
    id: 'simulationResultKey',
    title: 'Simulation Result Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.simulationResultKey },
  },
  {
    id: 'stepId',
    title: 'Step Id',
    type: 'short-input',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.stepId },
  },
  {
    id: 'testPlanId',
    title: 'Test Plan Id',
    type: 'short-input',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.testPlanId },
  },
  {
    id: 'treeId',
    title: 'Tree Id',
    type: 'short-input',
    required: true,
    placeholder: 'Exact decimal identifier as a string',
    condition: { field: 'operation', value: inputOperations.treeId },
  },
  {
    id: 'userKey',
    title: 'User Key',
    type: 'short-input',
    required: true,
    placeholder:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    condition: { field: 'operation', value: inputOperations.userKey },
  },
]

export const OracleFusionRiskManagementBlock: BlockConfig = {
  type: 'oracle_fusion_risk_management',
  name: 'Oracle Fusion Risk Management',
  description: 'Manage compliance records, investigate incidents, and simulate access conflicts',
  longDescription:
    'Connect an Oracle Fusion integration-user credential to maintain Financial Reporting Compliance processes, risks, controls, issue remediation fields, assessment results, supporting relationships, and test procedures. Investigate Advanced Controls incidents, simulate proposed access, and administer Risk Management assignment groups. Each list returns one bounded page. Identifiers and resource numeric values are returned as decimal strings; pagination values remain numbers. Supply integer IDs as quoted decimal strings in mutation JSON. Group security assignments secure the group itself. Assessment updates do not certify or approve assessments, simulations do not grant access or create incidents, and changing control metadata does not execute controls. Requires licensed and enabled Oracle product features, REST privileges, and object-level access. No risk updates, issue creation, approval/provisioning workflows, control execution, test-plan creation, binary attachments, tenant-specific flexfield writes, or platform administration are included.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_risk_management',
  category: 'tools',
  integrationType: IntegrationType.Security,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Risk Management',
    sentences: {
      byOperation: Object.fromEntries(
        operationEntries.map(([id, definition]) => [id, [definition.label]])
      ),
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Oracle Fusion Account',
      type: 'oauth-input',
      serviceId: 'oracle_fusion_risk_management',
      credentialKind: 'service-account',
      requiredScopes: getScopesForService('oracle_fusion_risk_management'),
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle Fusion Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
      placeholder: 'Enter credential ID',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      required: true,
      options: [
        {
          id: 'oracle_fusion_risk_management_create_advanced_control_comment',
          label: 'Create Advanced Control Comment',
        },
        {
          id: 'oracle_fusion_risk_management_create_assignment_group',
          label: 'Create Assignment Group',
        },
        {
          id: 'oracle_fusion_risk_management_create_control',
          label: 'Create Control',
        },
        {
          id: 'oracle_fusion_risk_management_create_control_assertion',
          label: 'Create Control Assertion',
        },
        {
          id: 'oracle_fusion_risk_management_create_control_comment',
          label: 'Create Control Comment',
        },
        {
          id: 'oracle_fusion_risk_management_create_group_member',
          label: 'Create Group Member',
        },
        {
          id: 'oracle_fusion_risk_management_create_group_security_assignment',
          label: 'Create Group Security Assignment',
        },
        {
          id: 'oracle_fusion_risk_management_create_incident_comment',
          label: 'Create Incident Comment',
        },
        {
          id: 'oracle_fusion_risk_management_create_process',
          label: 'Create Process',
        },
        {
          id: 'oracle_fusion_risk_management_create_process_comment',
          label: 'Create Process Comment',
        },
        {
          id: 'oracle_fusion_risk_management_create_process_risk',
          label: 'Create Process Risk',
        },
        {
          id: 'oracle_fusion_risk_management_create_risk',
          label: 'Create Risk',
        },
        {
          id: 'oracle_fusion_risk_management_create_risk_comment',
          label: 'Create Risk Comment',
        },
        {
          id: 'oracle_fusion_risk_management_create_test_plan_activity',
          label: 'Create Test Plan Activity',
        },
        {
          id: 'oracle_fusion_risk_management_create_test_plan_step',
          label: 'Create Test Plan Step',
        },
        {
          id: 'oracle_fusion_risk_management_delete_assignment_group',
          label: 'Delete Assignment Group',
        },
        {
          id: 'oracle_fusion_risk_management_delete_control_assertion',
          label: 'Delete Control Assertion',
        },
        {
          id: 'oracle_fusion_risk_management_delete_control_test_plan',
          label: 'Delete Control Test Plan',
        },
        {
          id: 'oracle_fusion_risk_management_delete_group_member',
          label: 'Delete Group Member',
        },
        {
          id: 'oracle_fusion_risk_management_delete_group_security_assignment',
          label: 'Delete Group Security Assignment',
        },
        {
          id: 'oracle_fusion_risk_management_delete_process_risk',
          label: 'Delete Process Risk',
        },
        {
          id: 'oracle_fusion_risk_management_delete_test_plan_step',
          label: 'Delete Test Plan Step',
        },
        {
          id: 'oracle_fusion_risk_management_get_access_simulation_status',
          label: 'Get Access Simulation Status',
        },
        {
          id: 'oracle_fusion_risk_management_get_advanced_control',
          label: 'Get Advanced Control',
        },
        {
          id: 'oracle_fusion_risk_management_get_advanced_control_comment',
          label: 'Get Advanced Control Comment',
        },
        {
          id: 'oracle_fusion_risk_management_get_advanced_control_job',
          label: 'Get Advanced Control Job',
        },
        {
          id: 'oracle_fusion_risk_management_get_advanced_control_perspective',
          label: 'Get Advanced Control Perspective',
        },
        {
          id: 'oracle_fusion_risk_management_get_assignment_group',
          label: 'Get Assignment Group',
        },
        {
          id: 'oracle_fusion_risk_management_get_control',
          label: 'Get Control',
        },
        {
          id: 'oracle_fusion_risk_management_get_control_assertion',
          label: 'Get Control Assertion',
        },
        {
          id: 'oracle_fusion_risk_management_get_control_assessment_result',
          label: 'Get Control Assessment Result',
        },
        {
          id: 'oracle_fusion_risk_management_get_control_comment',
          label: 'Get Control Comment',
        },
        {
          id: 'oracle_fusion_risk_management_get_control_perspective',
          label: 'Get Control Perspective',
        },
        {
          id: 'oracle_fusion_risk_management_get_control_risk',
          label: 'Get Control Risk',
        },
        {
          id: 'oracle_fusion_risk_management_get_control_test_plan',
          label: 'Get Control Test Plan',
        },
        {
          id: 'oracle_fusion_risk_management_get_group_eligible_user',
          label: 'Get Group Eligible User',
        },
        {
          id: 'oracle_fusion_risk_management_get_group_member',
          label: 'Get Group Member',
        },
        {
          id: 'oracle_fusion_risk_management_get_group_security_assignment',
          label: 'Get Group Security Assignment',
        },
        {
          id: 'oracle_fusion_risk_management_get_incident',
          label: 'Get Incident',
        },
        {
          id: 'oracle_fusion_risk_management_get_incident_attribute',
          label: 'Get Incident Attribute',
        },
        {
          id: 'oracle_fusion_risk_management_get_incident_comment',
          label: 'Get Incident Comment',
        },
        {
          id: 'oracle_fusion_risk_management_get_incident_perspective',
          label: 'Get Incident Perspective',
        },
        {
          id: 'oracle_fusion_risk_management_get_issue',
          label: 'Get Issue',
        },
        {
          id: 'oracle_fusion_risk_management_get_open_incident',
          label: 'Get Open Incident',
        },
        {
          id: 'oracle_fusion_risk_management_get_process',
          label: 'Get Process',
        },
        {
          id: 'oracle_fusion_risk_management_get_process_action_item',
          label: 'Get Process Action Item',
        },
        {
          id: 'oracle_fusion_risk_management_get_process_assessment_result',
          label: 'Get Process Assessment Result',
        },
        {
          id: 'oracle_fusion_risk_management_get_process_comment',
          label: 'Get Process Comment',
        },
        {
          id: 'oracle_fusion_risk_management_get_process_perspective',
          label: 'Get Process Perspective',
        },
        {
          id: 'oracle_fusion_risk_management_get_process_risk',
          label: 'Get Process Risk',
        },
        {
          id: 'oracle_fusion_risk_management_get_risk',
          label: 'Get Risk',
        },
        {
          id: 'oracle_fusion_risk_management_get_risk_assessment_result',
          label: 'Get Risk Assessment Result',
        },
        {
          id: 'oracle_fusion_risk_management_get_risk_comment',
          label: 'Get Risk Comment',
        },
        {
          id: 'oracle_fusion_risk_management_get_risk_control',
          label: 'Get Risk Control',
        },
        {
          id: 'oracle_fusion_risk_management_get_risk_perspective',
          label: 'Get Risk Perspective',
        },
        {
          id: 'oracle_fusion_risk_management_get_risk_process',
          label: 'Get Risk Process',
        },
        {
          id: 'oracle_fusion_risk_management_get_securable_eligible_user',
          label: 'Get Securable Eligible User',
        },
        {
          id: 'oracle_fusion_risk_management_get_securable_role_type',
          label: 'Get Securable Role Type',
        },
        {
          id: 'oracle_fusion_risk_management_get_securable_type',
          label: 'Get Securable Type',
        },
        {
          id: 'oracle_fusion_risk_management_get_simulation_result',
          label: 'Get Simulation Result',
        },
        {
          id: 'oracle_fusion_risk_management_get_test_plan_activity',
          label: 'Get Test Plan Activity',
        },
        {
          id: 'oracle_fusion_risk_management_get_test_plan_step',
          label: 'Get Test Plan Step',
        },
        {
          id: 'oracle_fusion_risk_management_list_advanced_control_comments',
          label: 'List Advanced Control Comments',
        },
        {
          id: 'oracle_fusion_risk_management_list_advanced_control_jobs',
          label: 'List Advanced Control Jobs',
        },
        {
          id: 'oracle_fusion_risk_management_list_advanced_control_perspectives',
          label: 'List Advanced Control Perspectives',
        },
        {
          id: 'oracle_fusion_risk_management_list_advanced_controls',
          label: 'List Advanced Controls',
        },
        {
          id: 'oracle_fusion_risk_management_list_assignment_groups',
          label: 'List Assignment Groups',
        },
        {
          id: 'oracle_fusion_risk_management_list_control_assertions',
          label: 'List Control Assertions',
        },
        {
          id: 'oracle_fusion_risk_management_list_control_assessment_results',
          label: 'List Control Assessment Results',
        },
        {
          id: 'oracle_fusion_risk_management_list_control_comments',
          label: 'List Control Comments',
        },
        {
          id: 'oracle_fusion_risk_management_list_control_perspectives',
          label: 'List Control Perspectives',
        },
        {
          id: 'oracle_fusion_risk_management_list_control_risks',
          label: 'List Control Risks',
        },
        {
          id: 'oracle_fusion_risk_management_list_control_test_plans',
          label: 'List Control Test Plans',
        },
        {
          id: 'oracle_fusion_risk_management_list_controls',
          label: 'List Controls',
        },
        {
          id: 'oracle_fusion_risk_management_list_group_eligible_users',
          label: 'List Group Eligible Users',
        },
        {
          id: 'oracle_fusion_risk_management_list_group_members',
          label: 'List Group Members',
        },
        {
          id: 'oracle_fusion_risk_management_list_group_security_assignments',
          label: 'List Group Security Assignments',
        },
        {
          id: 'oracle_fusion_risk_management_list_incident_attributes',
          label: 'List Incident Attributes',
        },
        {
          id: 'oracle_fusion_risk_management_list_incident_comments',
          label: 'List Incident Comments',
        },
        {
          id: 'oracle_fusion_risk_management_list_incident_perspectives',
          label: 'List Incident Perspectives',
        },
        {
          id: 'oracle_fusion_risk_management_list_incidents',
          label: 'List Incidents',
        },
        {
          id: 'oracle_fusion_risk_management_list_issues',
          label: 'List Issues',
        },
        {
          id: 'oracle_fusion_risk_management_list_open_incidents',
          label: 'List Open Incidents',
        },
        {
          id: 'oracle_fusion_risk_management_list_process_action_items',
          label: 'List Process Action Items',
        },
        {
          id: 'oracle_fusion_risk_management_list_process_assessment_results',
          label: 'List Process Assessment Results',
        },
        {
          id: 'oracle_fusion_risk_management_list_process_comments',
          label: 'List Process Comments',
        },
        {
          id: 'oracle_fusion_risk_management_list_process_perspectives',
          label: 'List Process Perspectives',
        },
        {
          id: 'oracle_fusion_risk_management_list_process_risks',
          label: 'List Process Risks',
        },
        {
          id: 'oracle_fusion_risk_management_list_processes',
          label: 'List Processes',
        },
        {
          id: 'oracle_fusion_risk_management_list_risk_assessment_results',
          label: 'List Risk Assessment Results',
        },
        {
          id: 'oracle_fusion_risk_management_list_risk_comments',
          label: 'List Risk Comments',
        },
        {
          id: 'oracle_fusion_risk_management_list_risk_controls',
          label: 'List Risk Controls',
        },
        {
          id: 'oracle_fusion_risk_management_list_risk_perspectives',
          label: 'List Risk Perspectives',
        },
        {
          id: 'oracle_fusion_risk_management_list_risk_processes',
          label: 'List Risk Processes',
        },
        {
          id: 'oracle_fusion_risk_management_list_risks',
          label: 'List Risks',
        },
        {
          id: 'oracle_fusion_risk_management_list_securable_eligible_users',
          label: 'List Securable Eligible Users',
        },
        {
          id: 'oracle_fusion_risk_management_list_securable_role_types',
          label: 'List Securable Role Types',
        },
        {
          id: 'oracle_fusion_risk_management_list_securable_types',
          label: 'List Securable Types',
        },
        {
          id: 'oracle_fusion_risk_management_list_simulation_results',
          label: 'List Simulation Results',
        },
        {
          id: 'oracle_fusion_risk_management_list_test_plan_activities',
          label: 'List Test Plan Activities',
        },
        {
          id: 'oracle_fusion_risk_management_list_test_plan_steps',
          label: 'List Test Plan Steps',
        },
        {
          id: 'oracle_fusion_risk_management_run_access_simulation',
          label: 'Run Access Simulation',
        },
        {
          id: 'oracle_fusion_risk_management_update_advanced_control',
          label: 'Update Advanced Control',
        },
        {
          id: 'oracle_fusion_risk_management_update_assignment_group',
          label: 'Update Assignment Group',
        },
        {
          id: 'oracle_fusion_risk_management_update_control',
          label: 'Update Control',
        },
        {
          id: 'oracle_fusion_risk_management_update_control_assertion',
          label: 'Update Control Assertion',
        },
        {
          id: 'oracle_fusion_risk_management_update_control_assessment_result',
          label: 'Update Control Assessment Result',
        },
        {
          id: 'oracle_fusion_risk_management_update_control_test_plan',
          label: 'Update Control Test Plan',
        },
        {
          id: 'oracle_fusion_risk_management_update_group_security_assignment',
          label: 'Update Group Security Assignment',
        },
        {
          id: 'oracle_fusion_risk_management_update_incident',
          label: 'Update Incident',
        },
        {
          id: 'oracle_fusion_risk_management_update_issue',
          label: 'Update Issue',
        },
        {
          id: 'oracle_fusion_risk_management_update_process',
          label: 'Update Process',
        },
        {
          id: 'oracle_fusion_risk_management_update_process_assessment_result',
          label: 'Update Process Assessment Result',
        },
        {
          id: 'oracle_fusion_risk_management_update_risk_assessment_result',
          label: 'Update Risk Assessment Result',
        },
        {
          id: 'oracle_fusion_risk_management_update_test_plan_step',
          label: 'Update Test Plan Step',
        },
      ],
      value: () => 'oracle_fusion_risk_management_list_processes',
    },
    ...identifierInputs,
    {
      id: 'body',
      title: 'Fields (JSON)',
      type: 'long-input',
      required: true,
      placeholder: '{"Name":"Quarterly compliance review"}',
      condition: { field: 'operation', value: writeOperations },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object using only the documented writable fields of the selected Oracle Fusion Risk Management action. Quote integer identifiers as decimal strings. Return ONLY the JSON object.',
        placeholder: 'Describe the record fields to change',
        generationType: 'json-object',
      },
    },
    {
      id: 'userName',
      title: 'Oracle Username',
      type: 'short-input',
      required: true,
      condition: { field: 'operation', value: inputOperations.userName },
    },
    {
      id: 'provisioningInfo',
      title: 'Proposed Roles and Data Access (JSON)',
      type: 'long-input',
      required: true,
      placeholder: '{"ROLE_CODE":["BUSINESS_UNIT = Example"]}',
      condition: { field: 'operation', value: inputOperations.provisioningInfo },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle provisioning simulation object mapping role codes to arrays of Oracle data access scope strings. Supported scope kinds are BUSINESS_UNIT, LEDGER_SET, DATA_ACCESS_SET, ASSET_BOOK, REFERENCE_DATA_SET. Return ONLY the JSON object.',
        placeholder: 'Describe the proposed roles and data scopes',
        generationType: 'json-object',
      },
    },
    {
      id: 'q',
      title: 'Filter',
      type: 'long-input',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: listOperations.filter(
          (id) => id !== 'oracle_fusion_risk_management_list_simulation_results'
        ),
      },
      placeholder: 'Oracle q expression using queryable fields for this resource',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an Oracle q filter using documented queryable fields for the selected Risk Management resource, for example Name="Review" when Name is queryable. Return ONLY the filter expression.',
        placeholder: 'Describe which records to retrieve',
      },
    },
    {
      id: 'orderBy',
      title: 'Sort Order',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: listOperations },
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '100',
      condition: { field: 'operation', value: listOperations },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      mode: 'advanced',
      placeholder: '0',
      condition: { field: 'operation', value: listOperations },
    },
    {
      id: 'totalResults',
      title: 'Include Estimated Total',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: listOperations },
    },
  ],
  tools: {
    access: [
      'oracle_fusion_risk_management_create_advanced_control_comment',
      'oracle_fusion_risk_management_create_assignment_group',
      'oracle_fusion_risk_management_create_control',
      'oracle_fusion_risk_management_create_control_assertion',
      'oracle_fusion_risk_management_create_control_comment',
      'oracle_fusion_risk_management_create_group_member',
      'oracle_fusion_risk_management_create_group_security_assignment',
      'oracle_fusion_risk_management_create_incident_comment',
      'oracle_fusion_risk_management_create_process',
      'oracle_fusion_risk_management_create_process_comment',
      'oracle_fusion_risk_management_create_process_risk',
      'oracle_fusion_risk_management_create_risk',
      'oracle_fusion_risk_management_create_risk_comment',
      'oracle_fusion_risk_management_create_test_plan_activity',
      'oracle_fusion_risk_management_create_test_plan_step',
      'oracle_fusion_risk_management_delete_assignment_group',
      'oracle_fusion_risk_management_delete_control_assertion',
      'oracle_fusion_risk_management_delete_control_test_plan',
      'oracle_fusion_risk_management_delete_group_member',
      'oracle_fusion_risk_management_delete_group_security_assignment',
      'oracle_fusion_risk_management_delete_process_risk',
      'oracle_fusion_risk_management_delete_test_plan_step',
      'oracle_fusion_risk_management_get_access_simulation_status',
      'oracle_fusion_risk_management_get_advanced_control',
      'oracle_fusion_risk_management_get_advanced_control_comment',
      'oracle_fusion_risk_management_get_advanced_control_job',
      'oracle_fusion_risk_management_get_advanced_control_perspective',
      'oracle_fusion_risk_management_get_assignment_group',
      'oracle_fusion_risk_management_get_control',
      'oracle_fusion_risk_management_get_control_assertion',
      'oracle_fusion_risk_management_get_control_assessment_result',
      'oracle_fusion_risk_management_get_control_comment',
      'oracle_fusion_risk_management_get_control_perspective',
      'oracle_fusion_risk_management_get_control_risk',
      'oracle_fusion_risk_management_get_control_test_plan',
      'oracle_fusion_risk_management_get_group_eligible_user',
      'oracle_fusion_risk_management_get_group_member',
      'oracle_fusion_risk_management_get_group_security_assignment',
      'oracle_fusion_risk_management_get_incident',
      'oracle_fusion_risk_management_get_incident_attribute',
      'oracle_fusion_risk_management_get_incident_comment',
      'oracle_fusion_risk_management_get_incident_perspective',
      'oracle_fusion_risk_management_get_issue',
      'oracle_fusion_risk_management_get_open_incident',
      'oracle_fusion_risk_management_get_process',
      'oracle_fusion_risk_management_get_process_action_item',
      'oracle_fusion_risk_management_get_process_assessment_result',
      'oracle_fusion_risk_management_get_process_comment',
      'oracle_fusion_risk_management_get_process_perspective',
      'oracle_fusion_risk_management_get_process_risk',
      'oracle_fusion_risk_management_get_risk',
      'oracle_fusion_risk_management_get_risk_assessment_result',
      'oracle_fusion_risk_management_get_risk_comment',
      'oracle_fusion_risk_management_get_risk_control',
      'oracle_fusion_risk_management_get_risk_perspective',
      'oracle_fusion_risk_management_get_risk_process',
      'oracle_fusion_risk_management_get_securable_eligible_user',
      'oracle_fusion_risk_management_get_securable_role_type',
      'oracle_fusion_risk_management_get_securable_type',
      'oracle_fusion_risk_management_get_simulation_result',
      'oracle_fusion_risk_management_get_test_plan_activity',
      'oracle_fusion_risk_management_get_test_plan_step',
      'oracle_fusion_risk_management_list_advanced_control_comments',
      'oracle_fusion_risk_management_list_advanced_control_jobs',
      'oracle_fusion_risk_management_list_advanced_control_perspectives',
      'oracle_fusion_risk_management_list_advanced_controls',
      'oracle_fusion_risk_management_list_assignment_groups',
      'oracle_fusion_risk_management_list_control_assertions',
      'oracle_fusion_risk_management_list_control_assessment_results',
      'oracle_fusion_risk_management_list_control_comments',
      'oracle_fusion_risk_management_list_control_perspectives',
      'oracle_fusion_risk_management_list_control_risks',
      'oracle_fusion_risk_management_list_control_test_plans',
      'oracle_fusion_risk_management_list_controls',
      'oracle_fusion_risk_management_list_group_eligible_users',
      'oracle_fusion_risk_management_list_group_members',
      'oracle_fusion_risk_management_list_group_security_assignments',
      'oracle_fusion_risk_management_list_incident_attributes',
      'oracle_fusion_risk_management_list_incident_comments',
      'oracle_fusion_risk_management_list_incident_perspectives',
      'oracle_fusion_risk_management_list_incidents',
      'oracle_fusion_risk_management_list_issues',
      'oracle_fusion_risk_management_list_open_incidents',
      'oracle_fusion_risk_management_list_process_action_items',
      'oracle_fusion_risk_management_list_process_assessment_results',
      'oracle_fusion_risk_management_list_process_comments',
      'oracle_fusion_risk_management_list_process_perspectives',
      'oracle_fusion_risk_management_list_process_risks',
      'oracle_fusion_risk_management_list_processes',
      'oracle_fusion_risk_management_list_risk_assessment_results',
      'oracle_fusion_risk_management_list_risk_comments',
      'oracle_fusion_risk_management_list_risk_controls',
      'oracle_fusion_risk_management_list_risk_perspectives',
      'oracle_fusion_risk_management_list_risk_processes',
      'oracle_fusion_risk_management_list_risks',
      'oracle_fusion_risk_management_list_securable_eligible_users',
      'oracle_fusion_risk_management_list_securable_role_types',
      'oracle_fusion_risk_management_list_securable_types',
      'oracle_fusion_risk_management_list_simulation_results',
      'oracle_fusion_risk_management_list_test_plan_activities',
      'oracle_fusion_risk_management_list_test_plan_steps',
      'oracle_fusion_risk_management_run_access_simulation',
      'oracle_fusion_risk_management_update_advanced_control',
      'oracle_fusion_risk_management_update_assignment_group',
      'oracle_fusion_risk_management_update_control',
      'oracle_fusion_risk_management_update_control_assertion',
      'oracle_fusion_risk_management_update_control_assessment_result',
      'oracle_fusion_risk_management_update_control_test_plan',
      'oracle_fusion_risk_management_update_group_security_assignment',
      'oracle_fusion_risk_management_update_incident',
      'oracle_fusion_risk_management_update_issue',
      'oracle_fusion_risk_management_update_process',
      'oracle_fusion_risk_management_update_process_assessment_result',
      'oracle_fusion_risk_management_update_risk_assessment_result',
      'oracle_fusion_risk_management_update_test_plan_step',
    ],
    config: {
      tool: (params) => {
        const operation = params.operation
        if (typeof operation !== 'string' || !Object.hasOwn(RISK_OPERATIONS, operation)) {
          throw new Error('Select a Risk Management operation')
        }
        return operation
      },
      params: (params) => {
        if (
          typeof params.operation !== 'string' ||
          !Object.hasOwn(RISK_OPERATIONS, params.operation)
        ) {
          throw new Error('Select a Risk Management operation')
        }
        const definition: RiskOperationDefinition =
          RISK_OPERATIONS[params.operation as keyof typeof RISK_OPERATIONS]
        const result: Record<string, unknown> = {}
        for (const field of definition.params) {
          const value = params[field]
          if (value !== undefined && value !== '') result[field] = value
        }
        if (definition.bodyDescription) result.body = params.body
        if (definition.kind === 'list') {
          for (const field of ['q', 'orderBy']) {
            if (field === 'q' && definition.resource === 'simulation_result') continue
            const value = params[field]
            if (typeof value === 'string' && value.trim()) result[field] = value.trim()
          }
          const limit = parseOptionalNumberInput(params.limit, 'Page size', {
            integer: true,
            min: 1,
            max: 100,
          })
          const offset = parseOptionalNumberInput(params.offset, 'Offset', {
            integer: true,
            min: 0,
            max: 1_000_000,
          })
          const totalResults = parseOptionalBooleanInput(params.totalResults)
          if (limit !== undefined) result.limit = limit
          if (offset !== undefined) result.offset = offset
          if (totalResults !== undefined) result.totalResults = totalResults
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Selected Risk Management action' },
    oauthCredential: { type: 'string', description: 'Oracle Fusion service-account credential' },
    actionItemId: { type: 'string', description: 'Exact decimal identifier as a string' },
    activityKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    advancedControlId: { type: 'string', description: 'Oracle identifier as a string' },
    assertionKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    attributeKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    commentId: { type: 'string', description: 'Exact decimal identifier as a string' },
    commentKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    controlAssessmentResultId: {
      type: 'string',
      description: 'Exact decimal identifier as a string',
    },
    controlId: { type: 'string', description: 'Exact decimal identifier as a string' },
    groupKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    incidentKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    issueId: { type: 'string', description: 'Exact decimal identifier as a string' },
    jobId: { type: 'string', description: 'Exact decimal identifier as a string' },
    memberId: { type: 'string', description: 'Exact decimal identifier as a string' },
    openIncidentKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    perspectiveKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    processAssessmentResultId: {
      type: 'string',
      description: 'Exact decimal identifier as a string',
    },
    processId: { type: 'string', description: 'Exact decimal identifier as a string' },
    provisioningInfo: {
      type: 'json',
      description:
        'JSON object mapping role codes to arrays of data-access scope strings. Supported scope kinds: BUSINESS_UNIT, LEDGER_SET, DATA_ACCESS_SET, ASSET_BOOK, REFERENCE_DATA_SET. Maximum 100 roles and 100 scopes per role. This runs analysis only; it grants no access and creates no incidents.',
    },
    relationshipKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    requestId: {
      type: 'string',
      description:
        'Simulation request identifier returned by Run Access Simulation, preserved as a decimal string',
    },
    riskAssessmentResultId: {
      type: 'string',
      description: 'Exact decimal identifier as a string',
    },
    riskId: { type: 'string', description: 'Exact decimal identifier as a string' },
    roleTypeKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    securableTypeKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    securityAssignmentId: {
      type: 'string',
      description: 'Exact decimal identifier as a string',
    },
    simulationResultKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    stepId: { type: 'string', description: 'Exact decimal identifier as a string' },
    testPlanId: { type: 'string', description: 'Exact decimal identifier as a string' },
    treeId: { type: 'string', description: 'Exact decimal identifier as a string' },
    userKey: {
      type: 'string',
      description:
        'Opaque key returned by the corresponding list action; retain the same parent identifiers',
    },
    userName: {
      type: 'string',
      description:
        'Exact Oracle Security Console username whose existing and proposed access will be simulated',
    },
    body: {
      type: 'json',
      description:
        'Documented writable fields for the selected action; quote integer IDs and include required fields described by the tool',
    },
    q: { type: 'string', description: 'Oracle resource filter' },
    orderBy: { type: 'string', description: 'Oracle resource sort order' },
    limit: { type: 'number', description: 'One page of 1-100 records' },
    offset: { type: 'number', description: 'Zero-based page offset' },
    totalResults: {
      type: 'boolean',
      description: 'Request estimated total count',
    },
  },
  outputs: {
    record: {
      type: 'json',
      description:
        'Selected compliance record, relationship, assessment result, incident, or assignment. Fields depend on the action; identifiers and numeric resource attributes are strings.',
    },
    items: {
      type: 'json',
      description:
        'One bounded page of projected records with documented identifiers, names, status, and resource-specific fields',
    },
    count: { type: 'number', description: 'Records in the returned page' },
    hasMore: { type: 'boolean', description: 'Whether another page is available' },
    limit: { type: 'number', description: 'Oracle page limit' },
    offset: { type: 'number', description: 'Offset of this page' },
    nextOffset: {
      type: 'number',
      description: 'Offset for the next explicit request when another page exists',
    },
    totalResults: {
      type: 'number',
      description: 'Estimated total count when requested and returned',
    },
    deleted: { type: 'boolean', description: 'Deletion acknowledged by Oracle for delete actions' },
    requestId: {
      type: 'string',
      description: 'Submitted access-simulation tracking ID; analysis may still be pending',
    },
    status: {
      type: 'string',
      description: 'Simulation job status returned by Get Access Simulation Status',
    },
  },
}

export const OracleFusionRiskManagementBlockMeta = {
  tags: ['automation', 'data-analytics'],
  url: 'https://www.oracle.com/erp/risk-management/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Review compliance coverage',
      prompt:
        'Build a workflow that lists a bounded page of processes and reads their related risks, then inspects risk-control relationships. Report coverage using returned identifiers without inventing assessments or approving records.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Maintain compliance records',
      prompt:
        'Build a workflow that creates approved process, risk, or control definitions and updates documented process/control fields. Preserve exact IDs and keep risk updates and issue creation outside the workflow.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Track issue remediation',
      prompt:
        'Build a scheduled workflow that reads issues and summarizes severity, remediation requirements, and target dates. Update only explicitly requested remediation fields; do not approve or close issues.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review assessment results',
      prompt:
        'Build a workflow that reads process, risk, and control assessment results and records an assessor response and result summary when requested. Use the response codes for the selected assessment type; do not certify or approve assessments.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Maintain control test procedures',
      prompt:
        'Build a workflow that retrieves an existing control test plan, reviews its steps and activities, and updates the documented procedure fields. Create steps or activity associations when requested; do not create test plans or execute controls.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Investigate control incidents',
      prompt:
        'Build a workflow that lists advanced-control incidents and their dynamic transaction attributes, reviews comments, and records investigation notes. Update an investigator or documented incident status only when requested.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Simulate proposed access',
      prompt:
        'Build a workflow that submits proposed role codes and data access for a named Oracle user, stores the returned simulation request ID, and checks status in separate invocations. Retrieve paginated results after completion and report conflicts without granting access.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Maintain assignment groups',
      prompt:
        'Build a workflow that discovers securable types and eligible users, creates an assignment group, and maintains its members and group security assignments when requested. Clarify that group permissions do not automatically assign the group to compliance records.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['automation', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'review-compliance-coverage',
      description: 'Review compliance coverage',
      content:
        '# Review compliance coverage\n\n## Steps\n\nList processes, inspect related risks, and read the controls that mitigate each selected risk. Report gaps with record identifiers.\n\n## Output\n\nReturn the documented record fields and explicit pagination or simulation state. Consult the [Oracle Risk Management REST reference](https://docs.oracle.com/en/cloud/saas/risk-management-and-compliance/26c/farkm/index.html) for resource-specific prerequisites.',
    },
    {
      name: 'maintain-compliance-records',
      description: 'Maintain compliance records',
      content:
        '# Maintain compliance records\n\n## Steps\n\nSelect the record type, retrieve existing records when updating, and submit only the intended documented fields. Preserve exact identifiers and report the resulting record.\n\n## Output\n\nReturn the documented record fields and explicit pagination or simulation state. Consult the [Oracle Risk Management REST reference](https://docs.oracle.com/en/cloud/saas/risk-management-and-compliance/26c/farkm/index.html) for resource-specific prerequisites.',
    },
    {
      name: 'track-issue-remediation',
      description: 'Track issue remediation',
      content:
        '# Track issue remediation\n\n## Steps\n\nList issues, inspect severity and remediation fields, and update explicitly requested remediation details. Report current status without asserting a workflow approval.\n\n## Output\n\nReturn the documented record fields and explicit pagination or simulation state. Consult the [Oracle Risk Management REST reference](https://docs.oracle.com/en/cloud/saas/risk-management-and-compliance/26c/farkm/index.html) for resource-specific prerequisites.',
    },
    {
      name: 'review-assessment-results',
      description: 'Review assessment results',
      content:
        '# Review assessment results\n\n## Steps\n\nRetrieve the assessment result, inspect its version and response, and update documented assessor response fields when requested. Report the result without claiming certification.\n\n## Output\n\nReturn the documented record fields and explicit pagination or simulation state. Consult the [Oracle Risk Management REST reference](https://docs.oracle.com/en/cloud/saas/risk-management-and-compliance/26c/farkm/index.html) for resource-specific prerequisites.',
    },
    {
      name: 'maintain-control-test-procedures',
      description: 'Maintain control test procedures',
      content:
        '# Maintain control test procedures\n\n## Steps\n\nRetrieve an existing control test plan with its control ID, list steps and activities, and apply explicitly requested procedure edits. Return exact IDs and updated records.\n\n## Output\n\nReturn the documented record fields and explicit pagination or simulation state. Consult the [Oracle Risk Management REST reference](https://docs.oracle.com/en/cloud/saas/risk-management-and-compliance/26c/farkm/index.html) for resource-specific prerequisites.',
    },
    {
      name: 'investigate-control-incidents',
      description: 'Investigate control incidents',
      content:
        '# Investigate control incidents\n\n## Steps\n\nRetrieve the advanced control, list incidents, and inspect transaction attributes and comments for selected incidents. Record requested investigation notes and report current incident status.\n\n## Output\n\nReturn the documented record fields and explicit pagination or simulation state. Consult the [Oracle Risk Management REST reference](https://docs.oracle.com/en/cloud/saas/risk-management-and-compliance/26c/farkm/index.html) for resource-specific prerequisites.',
    },
    {
      name: 'simulate-proposed-access',
      description: 'Simulate proposed access',
      content:
        '# Simulate proposed access\n\n## Steps\n\nSubmit a provisioning simulation for the intended user. Preserve its request ID, query status separately, and read results after completion. Report conflicts without creating incidents or granting roles.\n\n## Output\n\nReturn the documented record fields and explicit pagination or simulation state. Consult the [Oracle Risk Management REST reference](https://docs.oracle.com/en/cloud/saas/risk-management-and-compliance/26c/farkm/index.html) for resource-specific prerequisites.',
    },
    {
      name: 'maintain-assignment-groups',
      description: 'Maintain assignment groups',
      content:
        '# Maintain assignment groups\n\n## Steps\n\nChoose a securable type and authorization, inspect eligible users, and apply explicitly requested group membership or group security changes. Report the group and assignments without implying ERP role grants.\n\n## Output\n\nReturn the documented record fields and explicit pagination or simulation state. Consult the [Oracle Risk Management REST reference](https://docs.oracle.com/en/cloud/saas/risk-management-and-compliance/26c/farkm/index.html) for resource-specific prerequisites.',
    },
  ],
} as const satisfies BlockMeta
