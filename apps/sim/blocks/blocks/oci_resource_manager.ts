import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { OciResourceManagerResponse } from '@/tools/oci_resource_manager/types'
import { OCI_RESOURCE_MANAGER_OPERATION_PARAMS } from '@/tools/oci_resource_manager/utils'

type Operation = keyof typeof OCI_RESOURCE_MANAGER_OPERATION_PARAMS
function operation(value: unknown): Operation {
  if (typeof value !== 'string' || !Object.hasOwn(OCI_RESOURCE_MANAGER_OPERATION_PARAMS, value))
    throw new Error('Invalid OCI Resource Manager operation')
  return value as Operation
}
function parseJson(value: unknown): unknown {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Provide valid JSON')
  }
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Provide true or false')
}

export const OciResourceManagerBlock: BlockConfig<OciResourceManagerResponse> = {
  type: 'oci_resource_manager',
  name: 'OCI Resource Manager',
  description: 'Manage Oracle-hosted Terraform stacks and jobs',
  longDescription:
    'Manage OCI Resource Manager stacks, configuration sources, variables, plan/apply/destroy and rollback jobs, logs, outputs, state files, and drift work requests using an OCI API-key service account. Jobs return IDs and status for later inspection. Applying, destroying, importing state, and deleting stacks require explicit confirmation. Files and optional value projections may contain sensitive material. Disable workflow block retries for mutations: a lost response does not prove Oracle rejected the request.',
  docsLink: 'https://docs.sim.ai/integrations/oci_resource_manager',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#C74634',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Resource Manager',
    sentences: {
      byOperation: {
        list_stacks: [{ text: 'List stacks', field: 'compartmentId', core: true }],
        get_stack: [{ text: 'Get stack', field: ['stackSelector', 'stackManual'], core: true }],
        create_stack: [{ text: 'Create stack', field: 'compartmentId', core: true }],
        update_stack: [
          { text: 'Update stack', field: ['stackSelector', 'stackManual'], core: true },
        ],
        delete_stack: [
          { text: 'Delete stack', field: ['stackSelector', 'stackManual'], core: true },
        ],
        change_stack_compartment: [
          { text: 'Change stack compartment', field: ['stackSelector', 'stackManual'], core: true },
        ],
        list_jobs: [{ text: 'List jobs', field: ['stackSelector', 'stackManual'], core: true }],
        get_job: [{ text: 'Get job', field: ['jobSelector', 'jobManual'], core: true }],
        update_job: [{ text: 'Update job', field: ['jobSelector', 'jobManual'], core: true }],
        plan: [{ text: 'Plan', field: ['stackSelector', 'stackManual'], core: true }],
        apply: [{ text: 'Apply', field: ['stackSelector', 'stackManual'], core: true }],
        destroy: [{ text: 'Destroy', field: ['stackSelector', 'stackManual'], core: true }],
        import_state: [
          { text: 'Import state', field: ['stackSelector', 'stackManual'], core: true },
        ],
        plan_rollback: [
          { text: 'Plan rollback', field: ['stackSelector', 'stackManual'], core: true },
        ],
        apply_rollback: [
          { text: 'Apply rollback', field: ['stackSelector', 'stackManual'], core: true },
        ],
        cancel_job: [{ text: 'Cancel job', field: ['jobSelector', 'jobManual'], core: true }],
        get_job_logs: [{ text: 'Get job logs', field: ['jobSelector', 'jobManual'], core: true }],
        download_job_logs: [
          { text: 'Download job logs', field: ['jobSelector', 'jobManual'], core: true },
        ],
        download_configuration: ['Download configuration'],
        download_state: ['Download state'],
        download_plan: [{ text: 'Download plan', field: ['jobSelector', 'jobManual'], core: true }],
        list_job_outputs: [
          { text: 'List job outputs', field: ['jobSelector', 'jobManual'], core: true },
        ],
        list_associated_resources: ['List associated resources'],
        detect_drift: [
          { text: 'Detect drift', field: ['stackSelector', 'stackManual'], core: true },
        ],
        list_drift_details: [
          { text: 'List drift details', field: ['stackSelector', 'stackManual'], core: true },
        ],
        list_work_requests: [{ text: 'List work requests', field: 'compartmentId', core: true }],
        get_work_request: [{ text: 'Get work request', field: 'workRequestId', core: true }],
        list_work_request_errors: [
          { text: 'List work request errors', field: 'workRequestId', core: true },
        ],
        get_work_request_logs: [
          { text: 'Get work request logs', field: 'workRequestId', core: true },
        ],
        list_terraform_versions: ['List terraform versions'],
        list_configuration_source_providers: [
          { text: 'List configuration source providers', field: 'compartmentId', core: true },
        ],
        list_templates: ['List templates'],
        list_resource_discovery_services: ['List resource discovery services'],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci-resource-manager',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      required: true,
      value: () => 'list_stacks',
      options: [
        { id: 'list_stacks', label: 'List Stacks' },
        { id: 'get_stack', label: 'Get Stack' },
        { id: 'create_stack', label: 'Create Stack' },
        { id: 'update_stack', label: 'Update Stack' },
        { id: 'delete_stack', label: 'Delete Stack' },
        { id: 'change_stack_compartment', label: 'Change Stack Compartment' },
        { id: 'list_jobs', label: 'List Jobs' },
        { id: 'get_job', label: 'Get Job' },
        { id: 'update_job', label: 'Update Job' },
        { id: 'plan', label: 'Plan' },
        { id: 'apply', label: 'Apply' },
        { id: 'destroy', label: 'Destroy' },
        { id: 'import_state', label: 'Import State' },
        { id: 'plan_rollback', label: 'Plan Rollback' },
        { id: 'apply_rollback', label: 'Apply Rollback' },
        { id: 'cancel_job', label: 'Cancel Job' },
        { id: 'get_job_logs', label: 'Get Job Logs' },
        { id: 'download_job_logs', label: 'Download Job Logs' },
        { id: 'download_configuration', label: 'Download Configuration' },
        { id: 'download_state', label: 'Download State' },
        { id: 'download_plan', label: 'Download Plan' },
        { id: 'list_job_outputs', label: 'List Job Outputs' },
        { id: 'list_associated_resources', label: 'List Associated Resources' },
        { id: 'detect_drift', label: 'Detect Drift' },
        { id: 'list_drift_details', label: 'List Drift Details' },
        { id: 'list_work_requests', label: 'List Work Requests' },
        { id: 'get_work_request', label: 'Get Work Request' },
        { id: 'list_work_request_errors', label: 'List Work Request Errors' },
        { id: 'get_work_request_logs', label: 'Get Work Request Logs' },
        { id: 'list_terraform_versions', label: 'List Terraform Versions' },
        { id: 'list_configuration_source_providers', label: 'List Configuration Source Providers' },
        { id: 'list_templates', label: 'List Templates' },
        { id: 'list_resource_discovery_services', label: 'List Resource Discovery Services' },
      ],
    },
    {
      id: 'ociRegion',
      title: 'Region',
      type: 'short-input',
      value: () => 'credential',
      description: 'credential uses the account region; otherwise enter an OCI region identifier.',
    },
    {
      id: 'selectorCompartmentId',
      title: 'Discovery Compartment',
      type: 'short-input',
      mode: 'basic',
      description:
        'Compartment used only by selectors. Separate from a move destination or a configuration source compartment.',
    },
    {
      id: 'compartmentId',
      title: 'Compartment Id',
      type: 'short-input',
      required: {
        field: 'operation',
        value: [
          'list_stacks',
          'create_stack',
          'change_stack_compartment',
          'list_work_requests',
          'list_configuration_source_providers',
        ],
      },
      condition: (values) => ({
        field: 'operation',
        value: [
          ...[
            'list_stacks',
            'create_stack',
            'change_stack_compartment',
            'list_jobs',
            'list_job_outputs',
            'list_associated_resources',
            'list_work_requests',
            'list_work_request_errors',
            'list_terraform_versions',
            'list_configuration_source_providers',
            'list_templates',
            'list_resource_discovery_services',
          ],
          ...(values?.workLogKind !== 'terraform' ? ['get_work_request_logs'] : []),
        ],
      }),
      description: 'Compartment OCID; destination compartment when moving a stack',
    },
    {
      id: 'stackSelector',
      title: 'Stack Id',
      type: 'project-selector',
      canonicalParamId: 'stackId',
      mode: 'basic',
      required: {
        field: 'operation',
        value: [
          'get_stack',
          'update_stack',
          'delete_stack',
          'change_stack_compartment',
          'list_jobs',
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
          'detect_drift',
          'list_drift_details',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_stack',
          'update_stack',
          'delete_stack',
          'change_stack_compartment',
          'list_jobs',
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
          'download_configuration',
          'download_state',
          'list_associated_resources',
          'detect_drift',
          'list_drift_details',
          'get_job',
          'update_job',
          'cancel_job',
          'get_job_logs',
          'download_job_logs',
          'download_plan',
          'list_job_outputs',
        ],
      },
      selectorKey: 'oci-resource-manager.stacks',
      serviceId: 'oci-resource-manager',
      dependsOn: ['credential', 'ociRegion', 'selectorCompartmentId'],
      description: 'Stack OCID',
    },
    {
      id: 'stackManual',
      title: 'Stack Id',
      type: 'short-input',
      canonicalParamId: 'stackId',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: [
          'get_stack',
          'update_stack',
          'delete_stack',
          'change_stack_compartment',
          'list_jobs',
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
          'detect_drift',
          'list_drift_details',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_stack',
          'update_stack',
          'delete_stack',
          'change_stack_compartment',
          'list_jobs',
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
          'download_configuration',
          'download_state',
          'list_associated_resources',
          'detect_drift',
          'list_drift_details',
          'get_job',
          'update_job',
          'cancel_job',
          'get_job_logs',
          'download_job_logs',
          'download_plan',
          'list_job_outputs',
        ],
      },
      description: 'Stack OCID',
    },
    {
      id: 'jobSelector',
      title: 'Job Id',
      type: 'project-selector',
      canonicalParamId: 'jobId',
      mode: 'basic',
      required: {
        field: 'operation',
        value: [
          'get_job',
          'update_job',
          'cancel_job',
          'get_job_logs',
          'download_job_logs',
          'download_plan',
          'list_job_outputs',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_job',
          'update_job',
          'cancel_job',
          'get_job_logs',
          'download_job_logs',
          'download_configuration',
          'download_state',
          'download_plan',
          'list_job_outputs',
          'list_associated_resources',
        ],
      },
      selectorKey: 'oci-resource-manager.jobs',
      serviceId: 'oci-resource-manager',
      dependsOn: ['credential', 'ociRegion', 'stackSelector', 'stackManual'],
      description: 'Job OCID',
    },
    {
      id: 'jobManual',
      title: 'Job Id',
      type: 'short-input',
      canonicalParamId: 'jobId',
      mode: 'advanced',
      required: {
        field: 'operation',
        value: [
          'get_job',
          'update_job',
          'cancel_job',
          'get_job_logs',
          'download_job_logs',
          'download_plan',
          'list_job_outputs',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'get_job',
          'update_job',
          'cancel_job',
          'get_job_logs',
          'download_job_logs',
          'download_configuration',
          'download_state',
          'download_plan',
          'list_job_outputs',
          'list_associated_resources',
        ],
      },
      description: 'Job OCID',
    },
    {
      id: 'workRequestId',
      title: 'Work Request Id',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['get_work_request', 'list_work_request_errors', 'get_work_request_logs'],
      },
      condition: {
        field: 'operation',
        value: [
          'list_drift_details',
          'get_work_request',
          'list_work_request_errors',
          'get_work_request_logs',
        ],
      },
      description: 'Work-request OCID',
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'list_stacks',
          'create_stack',
          'update_stack',
          'list_jobs',
          'update_job',
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
          'list_configuration_source_providers',
          'list_templates',
        ],
      },
      description: 'Display name; exact match for list operations',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      required: false,
      condition: { field: 'operation', value: ['create_stack', 'update_stack'] },
      description: 'Stack description, at most 400 characters',
      mode: 'advanced',
    },
    {
      id: 'id',
      title: 'Id',
      type: 'short-input',
      required: false,
      condition: { field: 'operation', value: ['list_stacks', 'list_jobs'] },
      description: 'Exact resource OCID filter',
      mode: 'advanced',
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'short-input',
      required: false,
      condition: { field: 'operation', value: ['list_stacks', 'list_jobs'] },
      description: 'Documented stack or job lifecycle state filter',
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      required: false,
      condition: (values) => ({
        field: 'operation',
        value: [
          ...[
            'list_stacks',
            'list_jobs',
            'get_job_logs',
            'list_job_outputs',
            'list_associated_resources',
            'list_drift_details',
            'list_work_requests',
            'list_work_request_errors',
            'list_configuration_source_providers',
            'list_templates',
          ],
          ...(values?.workLogKind !== 'terraform' || values?.outputMode !== 'file'
            ? ['get_work_request_logs']
            : []),
        ],
      }),
      description: 'Page size, 1–1000; default 50. Returns one page only',
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      required: false,
      condition: (values) => ({
        field: 'operation',
        value: [
          ...[
            'list_stacks',
            'list_jobs',
            'get_job_logs',
            'list_job_outputs',
            'list_associated_resources',
            'list_drift_details',
            'list_work_requests',
            'list_work_request_errors',
            'list_configuration_source_providers',
            'list_templates',
          ],
          ...(values?.workLogKind !== 'terraform' || values?.outputMode !== 'file'
            ? ['get_work_request_logs']
            : []),
        ],
      }),
      description: 'Opaque nextPage token, at most 512 characters',
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'list_stacks',
          'list_jobs',
          'list_configuration_source_providers',
          'list_templates',
        ],
      },
      description: 'TIMECREATED or DISPLAYNAME',
      mode: 'advanced',
      options: [
        { id: 'TIMECREATED', label: 'TIMECREATED' },
        { id: 'DISPLAYNAME', label: 'DISPLAYNAME' },
      ],
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      required: false,
      condition: (values) => ({
        field: 'operation',
        value: [
          ...[
            'list_stacks',
            'list_jobs',
            'get_job_logs',
            'list_work_request_errors',
            'list_configuration_source_providers',
            'list_templates',
          ],
          ...(values?.workLogKind !== 'terraform' || values?.outputMode !== 'file'
            ? ['get_work_request_logs']
            : []),
        ],
      }),
      description: 'ASC or DESC',
      mode: 'advanced',
      options: [
        { id: 'ASC', label: 'ASC' },
        { id: 'DESC', label: 'DESC' },
      ],
    },
    {
      id: 'configSource',
      title: 'Config Source',
      type: 'code',
      required: { field: 'operation', value: ['create_stack'] },
      condition: { field: 'operation', value: ['create_stack', 'update_stack'] },
      description:
        'Configuration source object: configSourceType plus workingDirectory and variant fields. ZIP_UPLOAD takes the separate file input; GIT_CONFIG_SOURCE takes configurationSourceProviderId, repositoryUrl, branchName; BITBUCKET_CLOUD_CONFIG_SOURCE also takes Bitbucket workspaceId; BITBUCKET_SERVER_CONFIG_SOURCE supports projectId/repositoryId; DEVOPS_CONFIG_SOURCE takes projectId/repositoryId; OBJECT_STORAGE_CONFIG_SOURCE takes region/namespace/bucketName; TEMPLATE_CONFIG_SOURCE takes templateId; COMPARTMENT_CONFIG_SOURCE takes compartmentId/region/servicesToDiscover. Template and compartment sources are create-only.',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Configuration source object: configSourceType plus workingDirectory and variant fields. ZIP_UPLOAD takes the separate file input; GIT_CONFIG_SOURCE takes configurationSourceProviderId, repositoryUrl, branchName; BITBUCKET_CLOUD_CONFIG_SOURCE also takes Bitbucket workspaceId; BITBUCKET_SERVER_CONFIG_SOURCE supports projectId/repositoryId; DEVOPS_CONFIG_SOURCE takes projectId/repositoryId; OBJECT_STORAGE_CONFIG_SOURCE takes region/namespace/bucketName; TEMPLATE_CONFIG_SOURCE takes templateId; COMPARTMENT_CONFIG_SOURCE takes compartmentId/region/servicesToDiscover. Template and compartment sources are create-only. Return ONLY the JSON value.',
      },
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      mode: 'basic',
      required: { field: 'operation', value: ['import_state'] },
      condition: { field: 'operation', value: ['create_stack', 'update_stack', 'import_state'] },
      description:
        'One authorized uploaded ZIP configuration or Terraform state file; no inline base64 or arbitrary URL',
      multiple: false,
      maxSize: 100,
    },
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      mode: 'advanced',
      required: { field: 'operation', value: ['import_state'] },
      condition: { field: 'operation', value: ['create_stack', 'update_stack', 'import_state'] },
      description:
        'One authorized uploaded ZIP configuration or Terraform state file; no inline base64 or arbitrary URL',
    },
    {
      id: 'variables',
      title: 'Variables',
      type: 'code',
      required: false,
      condition: { field: 'operation', value: ['create_stack', 'update_stack'] },
      description:
        'Terraform variable string map; up to 250 entries and 8192 UTF-8 bytes per name plus value. Omit to leave variables unchanged; removal/merge semantics are not promised',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Terraform variable string map; up to 250 entries and 8192 UTF-8 bytes per name plus value. Omit to leave variables unchanged; removal/merge semantics are not promised Return ONLY the JSON value.',
      },
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'code',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'create_stack',
          'update_stack',
          'update_job',
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
        ],
      },
      description: 'Free-form tag string map',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt: 'Free-form tag string map Return ONLY the JSON value.',
      },
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'code',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'create_stack',
          'update_stack',
          'update_job',
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
        ],
      },
      description: 'Defined tags: namespace to string-valued tag map',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt: 'Defined tags: namespace to string-valued tag map Return ONLY the JSON value.',
      },
    },
    {
      id: 'terraformVersionSelector',
      title: 'Terraform Version',
      type: 'project-selector',
      canonicalParamId: 'terraformVersion',
      mode: 'basic',
      required: false,
      condition: { field: 'operation', value: ['create_stack', 'update_stack'] },
      selectorKey: 'oci-resource-manager.terraform-versions',
      serviceId: 'oci-resource-manager',
      dependsOn: ['credential', 'ociRegion', 'selectorCompartmentId'],
      description: 'Supported Terraform version returned by List Terraform Versions',
    },
    {
      id: 'terraformVersionManual',
      title: 'Terraform Version',
      type: 'short-input',
      canonicalParamId: 'terraformVersion',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['create_stack', 'update_stack'] },
      description: 'Supported Terraform version returned by List Terraform Versions',
    },
    {
      id: 'customTerraformProvider',
      title: 'Custom Terraform Provider',
      type: 'code',
      required: false,
      condition: { field: 'operation', value: ['create_stack', 'update_stack'] },
      description: 'Custom provider bucket coordinates: region, namespace, bucketName',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Custom provider bucket coordinates: region, namespace, bucketName Return ONLY the JSON value.',
      },
    },
    {
      id: 'isThirdPartyProviderExperienceEnabled',
      title: 'Is Third Party Provider Experience Enabled',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['update_stack'] },
      description:
        'Set true to migrate an older stack to Terraform Registry sourcing; cannot be reverted',
      mode: 'advanced',
    },
    {
      id: 'ifMatch',
      title: 'If Match',
      type: 'short-input',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'update_stack',
          'delete_stack',
          'change_stack_compartment',
          'update_job',
          'cancel_job',
          'detect_drift',
        ],
      },
      description: 'Resource ETag for a conditional mutation',
      mode: 'advanced',
    },
    {
      id: 'retryToken',
      title: 'Retry Token',
      type: 'short-input',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'create_stack',
          'change_stack_compartment',
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
          'detect_drift',
        ],
      },
      description:
        'Optional stable token enabling at most two transport attempts. Reuse only for the identical logical request; Oracle tokens expire after 24 hours or earlier invalidation. Not a block-retry guarantee',
      mode: 'advanced',
    },
    {
      id: 'confirmDelete',
      title: 'Confirm Delete',
      type: 'switch',
      required: { field: 'operation', value: ['delete_stack'] },
      condition: { field: 'operation', value: ['delete_stack'] },
      description: 'Must be true: delete the stack and its state file; deployed resources persist',
    },
    {
      id: 'confirmApply',
      title: 'Confirm Apply',
      type: 'switch',
      required: { field: 'operation', value: ['apply', 'apply_rollback'] },
      condition: { field: 'operation', value: ['apply', 'apply_rollback'] },
      description: 'Must be true to explicitly authorize applying infrastructure changes',
    },
    {
      id: 'confirmDestroy',
      title: 'Confirm Destroy',
      type: 'switch',
      required: { field: 'operation', value: ['destroy'] },
      condition: { field: 'operation', value: ['destroy'] },
      description:
        'Must be true to destroy the stack resources; Oracle does not support a reviewed destroy-plan strategy',
    },
    {
      id: 'confirmStateReplacement',
      title: 'Confirm State Replacement',
      type: 'switch',
      required: { field: 'operation', value: ['import_state'] },
      condition: { field: 'operation', value: ['import_state'] },
      description: 'Must be true to explicitly authorize importing replacement Terraform state',
    },
    {
      id: 'confirmForce',
      title: 'Confirm Force',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['cancel_job'] },
      description:
        'Must be true with forced cancellation; interruption can leave inconsistent state',
    },
    {
      id: 'isForced',
      title: 'Is Forced',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['cancel_job'] },
      description: 'Request forced cancellation; default false. Requires confirmForce',
    },
    {
      id: 'isProviderUpgradeRequired',
      title: 'Is Provider Upgrade Required',
      type: 'switch',
      required: false,
      condition: {
        field: 'operation',
        value: [
          'plan',
          'apply',
          'destroy',
          'import_state',
          'plan_rollback',
          'apply_rollback',
          'detect_drift',
        ],
      },
      description: 'Upgrade providers within configured version constraints; default false',
      mode: 'advanced',
    },
    {
      id: 'terraformAdvancedOptions',
      title: 'Terraform Advanced Options',
      type: 'code',
      required: false,
      condition: {
        field: 'operation',
        value: ['plan', 'apply', 'destroy', 'plan_rollback', 'apply_rollback'],
      },
      description:
        'Optional Terraform settings: isRefreshRequired, parallelism (1–1000), detailedLogLevel (ERROR/WARN/INFO/DEBUG/TRACE). Debug logs can contain sensitive material',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Optional Terraform settings: isRefreshRequired, parallelism (1–1000), detailedLogLevel (ERROR/WARN/INFO/DEBUG/TRACE). Debug logs can contain sensitive material Return ONLY the JSON value.',
      },
    },
    {
      id: 'executionPlanStrategy',
      title: 'Execution Plan Strategy',
      type: 'dropdown',
      required: { field: 'operation', value: ['apply'] },
      condition: { field: 'operation', value: ['apply'] },
      description: 'FROM_PLAN_JOB_ID for a reviewed plan, or explicitly selected AUTO_APPROVED',
      options: [
        { id: 'FROM_PLAN_JOB_ID', label: 'FROM_PLAN_JOB_ID' },
        { id: 'AUTO_APPROVED', label: 'AUTO_APPROVED' },
      ],
      value: () => 'FROM_PLAN_JOB_ID',
    },
    {
      id: 'executionPlanJobIdSelector',
      title: 'Execution Plan Job Id',
      type: 'project-selector',
      canonicalParamId: 'executionPlanJobId',
      mode: 'basic',
      required: true,
      condition: {
        field: 'operation',
        value: 'apply',
        and: { field: 'executionPlanStrategy', value: 'FROM_PLAN_JOB_ID' },
      },
      selectorKey: 'oci-resource-manager.plan-jobs',
      serviceId: 'oci-resource-manager',
      dependsOn: ['credential', 'ociRegion', 'stackSelector', 'stackManual'],
      description: 'Successful PLAN job OCID from the same stack; required for FROM_PLAN_JOB_ID',
    },
    {
      id: 'executionPlanJobIdManual',
      title: 'Execution Plan Job Id',
      type: 'short-input',
      canonicalParamId: 'executionPlanJobId',
      mode: 'advanced',
      required: true,
      condition: {
        field: 'operation',
        value: 'apply',
        and: { field: 'executionPlanStrategy', value: 'FROM_PLAN_JOB_ID' },
      },
      description: 'Successful PLAN job OCID from the same stack; required for FROM_PLAN_JOB_ID',
    },
    {
      id: 'targetRollbackJobIdSelector',
      title: 'Target Rollback Job Id',
      type: 'project-selector',
      canonicalParamId: 'targetRollbackJobId',
      mode: 'basic',
      required: { field: 'operation', value: ['plan_rollback'] },
      condition: { field: 'operation', value: ['plan_rollback'] },
      selectorKey: 'oci-resource-manager.successful-apply-jobs',
      serviceId: 'oci-resource-manager',
      dependsOn: ['credential', 'ociRegion', 'stackSelector', 'stackManual'],
      description: 'Successful APPLY job OCID from the same stack to plan rollback toward',
    },
    {
      id: 'targetRollbackJobIdManual',
      title: 'Target Rollback Job Id',
      type: 'short-input',
      canonicalParamId: 'targetRollbackJobId',
      mode: 'advanced',
      required: { field: 'operation', value: ['plan_rollback'] },
      condition: { field: 'operation', value: ['plan_rollback'] },
      description: 'Successful APPLY job OCID from the same stack to plan rollback toward',
    },
    {
      id: 'executionPlanRollbackJobIdSelector',
      title: 'Execution Plan Rollback Job Id',
      type: 'project-selector',
      canonicalParamId: 'executionPlanRollbackJobId',
      mode: 'basic',
      required: { field: 'operation', value: ['apply_rollback'] },
      condition: { field: 'operation', value: ['apply_rollback'] },
      selectorKey: 'oci-resource-manager.rollback-plan-jobs',
      serviceId: 'oci-resource-manager',
      dependsOn: ['credential', 'ociRegion', 'stackSelector', 'stackManual'],
      description: 'Successful PLAN_ROLLBACK job OCID from the same stack',
    },
    {
      id: 'executionPlanRollbackJobIdManual',
      title: 'Execution Plan Rollback Job Id',
      type: 'short-input',
      canonicalParamId: 'executionPlanRollbackJobId',
      mode: 'advanced',
      required: { field: 'operation', value: ['apply_rollback'] },
      condition: { field: 'operation', value: ['apply_rollback'] },
      description: 'Successful PLAN_ROLLBACK job OCID from the same stack',
    },
    {
      id: 'includeVariables',
      title: 'Include Variables',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['get_stack', 'get_job'] },
      description: 'Explicitly reveal only selected variableNames; values can contain secrets',
    },
    {
      id: 'variableNames',
      title: 'Variable Names',
      type: 'code',
      required: false,
      condition: { field: 'operation', value: ['get_stack', 'get_job'] },
      description: 'Array of variable names to reveal; required when includeVariables is true',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Array of variable names to reveal; required when includeVariables is true Return ONLY the JSON value.',
      },
    },
    {
      id: 'includeSource',
      title: 'Include Source',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['get_stack', 'get_job'] },
      description: 'Include documented source metadata; excludes configuration file contents',
      mode: 'advanced',
    },
    {
      id: 'includeValues',
      title: 'Include Values',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['list_job_outputs'] },
      description: 'Explicitly reveal selected outputNames; default metadata only',
    },
    {
      id: 'outputNames',
      title: 'Output Names',
      type: 'code',
      required: false,
      condition: { field: 'operation', value: ['list_job_outputs'] },
      description: 'Array of output names to reveal',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt: 'Array of output names to reveal Return ONLY the JSON value.',
      },
    },
    {
      id: 'includeSensitive',
      title: 'Include Sensitive',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['list_job_outputs'] },
      description:
        'Also reveal selected outputs marked sensitive or with unknown sensitivity. False is not a guarantee that other values contain no secrets',
      mode: 'advanced',
    },
    {
      id: 'includeMessages',
      title: 'Include Messages',
      type: 'switch',
      required: false,
      condition: (values) => ({
        field: 'operation',
        value: [
          ...['get_job_logs', 'list_work_request_errors'],
          ...(values?.workLogKind !== 'terraform' || values?.outputMode !== 'file'
            ? ['get_work_request_logs']
            : []),
        ],
      }),
      description: 'Include bounded log/error messages; can contain secrets. Default metadata only',
    },
    {
      id: 'includeAttributes',
      title: 'Include Attributes',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['list_associated_resources'] },
      description: 'Include resource attributes; can contain secrets',
      mode: 'advanced',
    },
    {
      id: 'includeProperties',
      title: 'Include Properties',
      type: 'switch',
      required: false,
      condition: { field: 'operation', value: ['list_drift_details'] },
      description: 'Include actual/expected drift property maps; can contain secrets',
      mode: 'advanced',
    },
    {
      id: 'scope',
      title: 'Scope',
      type: 'dropdown',
      required: {
        field: 'operation',
        value: ['download_configuration', 'download_state', 'list_associated_resources'],
      },
      condition: {
        field: 'operation',
        value: ['download_configuration', 'download_state', 'list_associated_resources'],
      },
      description: 'stack or job; supply only its matching ID',
      options: [
        { id: 'stack', label: 'stack' },
        { id: 'job', label: 'job' },
      ],
      value: () => 'stack',
    },
    {
      id: 'jobLogKind',
      title: 'Log Kind',
      type: 'dropdown',
      required: true,
      condition: { field: 'operation', value: 'download_job_logs' },
      value: () => 'console',
      options: [
        { id: 'console', label: 'Console' },
        { id: 'detailed', label: 'Detailed' },
      ],
    },
    {
      id: 'workLogKind',
      title: 'Log Kind',
      type: 'dropdown',
      required: true,
      condition: { field: 'operation', value: 'get_work_request_logs' },
      value: () => 'service',
      options: [
        { id: 'service', label: 'Service' },
        { id: 'terraform', label: 'Terraform' },
      ],
    },
    {
      id: 'outputMode',
      title: 'Output Mode',
      type: 'dropdown',
      required: false,
      condition: {
        field: 'operation',
        value: 'get_work_request_logs',
        and: { field: 'workLogKind', value: 'terraform' },
      },
      description:
        'entries (default) or file; file is supported only for Terraform work-request logs',
      mode: 'advanced',
      options: [
        { id: 'entries', label: 'entries' },
        { id: 'file', label: 'file' },
      ],
    },
    {
      id: 'tfPlanFormat',
      title: 'Tf Plan Format',
      type: 'dropdown',
      required: false,
      condition: { field: 'operation', value: ['download_plan'] },
      description: 'BINARY (default) or JSON; both returned as a stored file',
      mode: 'advanced',
      options: [
        { id: 'BINARY', label: 'BINARY' },
        { id: 'JSON', label: 'JSON' },
      ],
    },
    {
      id: 'type',
      title: 'Type',
      type: 'code',
      required: false,
      condition: (values) => ({
        field: 'operation',
        value: [
          ...['get_job_logs'],
          ...(values?.workLogKind === 'terraform' && values?.outputMode !== 'file'
            ? ['get_work_request_logs']
            : []),
        ],
      }),
      description: 'Array containing TERRAFORM_CONSOLE to filter log type',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt: 'Array containing TERRAFORM_CONSOLE to filter log type Return ONLY the JSON value.',
      },
    },
    {
      id: 'levelGreaterThanOrEqualTo',
      title: 'Level Greater Than Or Equal To',
      type: 'dropdown',
      required: false,
      condition: (values) => ({
        field: 'operation',
        value: [
          ...['get_job_logs'],
          ...(values?.workLogKind === 'terraform' && values?.outputMode !== 'file'
            ? ['get_work_request_logs']
            : []),
        ],
      }),
      description: 'Minimum log severity: TRACE, DEBUG, INFO, WARN, ERROR, FATAL',
      mode: 'advanced',
      options: [
        { id: 'TRACE', label: 'TRACE' },
        { id: 'DEBUG', label: 'DEBUG' },
        { id: 'INFO', label: 'INFO' },
        { id: 'WARN', label: 'WARN' },
        { id: 'ERROR', label: 'ERROR' },
        { id: 'FATAL', label: 'FATAL' },
      ],
    },
    {
      id: 'timestampGreaterThanOrEqualTo',
      title: 'Timestamp Greater Than Or Equal To',
      type: 'short-input',
      required: false,
      condition: (values) => ({
        field: 'operation',
        value: [
          ...['get_job_logs'],
          ...(values?.workLogKind === 'terraform' && values?.outputMode !== 'file'
            ? ['get_work_request_logs']
            : []),
        ],
      }),
      description: 'Inclusive RFC 3339 start timestamp',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Return ONLY the RFC 3339 timestamp.',
      },
    },
    {
      id: 'timestampLessThanOrEqualTo',
      title: 'Timestamp Less Than Or Equal To',
      type: 'short-input',
      required: false,
      condition: (values) => ({
        field: 'operation',
        value: [
          ...['get_job_logs'],
          ...(values?.workLogKind === 'terraform' && values?.outputMode !== 'file'
            ? ['get_work_request_logs']
            : []),
        ],
      }),
      description: 'Inclusive RFC 3339 end timestamp',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Return ONLY the RFC 3339 timestamp.',
      },
    },
    {
      id: 'resourceAddresses',
      title: 'Resource Addresses',
      type: 'code',
      required: false,
      condition: { field: 'operation', value: ['detect_drift'] },
      description: 'Optional array of Terraform resource addresses to check for drift',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Optional array of Terraform resource addresses to check for drift Return ONLY the JSON value.',
      },
    },
    {
      id: 'resourceDriftStatus',
      title: 'Resource Drift Status',
      type: 'code',
      required: false,
      condition: { field: 'operation', value: ['list_drift_details'] },
      description: 'Array of NOT_CHECKED, IN_SYNC, MODIFIED, or DELETED filters',
      mode: 'advanced',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Array of NOT_CHECKED, IN_SYNC, MODIFIED, or DELETED filters Return ONLY the JSON value.',
      },
    },
    {
      id: 'resourceId',
      title: 'Resource Id',
      type: 'short-input',
      required: false,
      condition: { field: 'operation', value: ['list_work_requests'] },
      description: 'Resource OCID filter',
      mode: 'advanced',
    },
    {
      id: 'terraformResourceType',
      title: 'Terraform Resource Type',
      type: 'short-input',
      required: false,
      condition: { field: 'operation', value: ['list_associated_resources'] },
      description: 'Terraform resource type filter',
      mode: 'advanced',
    },
    {
      id: 'configurationSourceProviderIdSelector',
      title: 'Configuration Source Provider Id',
      type: 'project-selector',
      canonicalParamId: 'configurationSourceProviderId',
      mode: 'basic',
      required: false,
      condition: { field: 'operation', value: ['list_configuration_source_providers'] },
      selectorKey: 'oci-resource-manager.configuration-source-providers',
      serviceId: 'oci-resource-manager',
      dependsOn: ['credential', 'ociRegion', 'selectorCompartmentId'],
      description: 'Existing configuration-source-provider OCID filter',
    },
    {
      id: 'configurationSourceProviderIdManual',
      title: 'Configuration Source Provider Id',
      type: 'short-input',
      canonicalParamId: 'configurationSourceProviderId',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['list_configuration_source_providers'] },
      description: 'Existing configuration-source-provider OCID filter',
    },
    {
      id: 'configSourceProviderType',
      title: 'Config Source Provider Type',
      type: 'dropdown',
      required: false,
      condition: { field: 'operation', value: ['list_configuration_source_providers'] },
      description:
        'GITHUB_ACCESS_TOKEN, GITLAB_ACCESS_TOKEN, BITBUCKET_CLOUD_ACCESS_TOKEN, or BITBUCKET_SERVER_ACCESS_TOKEN',
      mode: 'advanced',
      options: [
        { id: 'GITHUB_ACCESS_TOKEN', label: 'GITHUB_ACCESS_TOKEN' },
        { id: 'GITLAB_ACCESS_TOKEN', label: 'GITLAB_ACCESS_TOKEN' },
        { id: 'BITBUCKET_CLOUD_ACCESS_TOKEN', label: 'BITBUCKET_CLOUD_ACCESS_TOKEN' },
        { id: 'BITBUCKET_SERVER_ACCESS_TOKEN', label: 'BITBUCKET_SERVER_ACCESS_TOKEN' },
      ],
    },
    {
      id: 'templateIdSelector',
      title: 'Template Id',
      type: 'project-selector',
      canonicalParamId: 'templateId',
      mode: 'basic',
      required: false,
      condition: { field: 'operation', value: ['list_templates'] },
      selectorKey: 'oci-resource-manager.templates',
      serviceId: 'oci-resource-manager',
      dependsOn: ['credential', 'ociRegion', 'selectorCompartmentId'],
      description: 'Existing template OCID filter',
    },
    {
      id: 'templateIdManual',
      title: 'Template Id',
      type: 'short-input',
      canonicalParamId: 'templateId',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: ['list_templates'] },
      description: 'Existing template OCID filter',
    },
    {
      id: 'templateCategoryId',
      title: 'Template Category Id',
      type: 'short-input',
      required: false,
      condition: { field: 'operation', value: ['list_templates'] },
      description: 'Template category identifier filter',
      mode: 'advanced',
    },
    {
      id: 'sourceDiscoveryServices',
      title: 'Discovered Services',
      type: 'project-selector',
      multiSelect: true,
      mode: 'basic',
      condition: { field: 'operation', value: 'create_stack' },
      serviceId: 'oci-resource-manager',
      selectorKey: 'oci-resource-manager.resource-discovery-services',
      dependsOn: ['credential', 'ociRegion', 'selectorCompartmentId'],
      description:
        'Optional service selection for COMPARTMENT_CONFIG_SOURCE only; supplies servicesToDiscover in configuration source.',
    },
  ],
  tools: {
    access: [
      'oci_resource_manager_list_stacks',
      'oci_resource_manager_get_stack',
      'oci_resource_manager_create_stack',
      'oci_resource_manager_update_stack',
      'oci_resource_manager_delete_stack',
      'oci_resource_manager_change_stack_compartment',
      'oci_resource_manager_list_jobs',
      'oci_resource_manager_get_job',
      'oci_resource_manager_update_job',
      'oci_resource_manager_plan',
      'oci_resource_manager_apply',
      'oci_resource_manager_destroy',
      'oci_resource_manager_import_state',
      'oci_resource_manager_plan_rollback',
      'oci_resource_manager_apply_rollback',
      'oci_resource_manager_cancel_job',
      'oci_resource_manager_get_job_logs',
      'oci_resource_manager_download_job_logs',
      'oci_resource_manager_download_configuration',
      'oci_resource_manager_download_state',
      'oci_resource_manager_download_plan',
      'oci_resource_manager_list_job_outputs',
      'oci_resource_manager_list_associated_resources',
      'oci_resource_manager_detect_drift',
      'oci_resource_manager_list_drift_details',
      'oci_resource_manager_list_work_requests',
      'oci_resource_manager_get_work_request',
      'oci_resource_manager_list_work_request_errors',
      'oci_resource_manager_get_work_request_logs',
      'oci_resource_manager_list_terraform_versions',
      'oci_resource_manager_list_configuration_source_providers',
      'oci_resource_manager_list_templates',
      'oci_resource_manager_list_resource_discovery_services',
    ],
    config: {
      tool: (params) => `oci_resource_manager_${operation(params.operation)}`,
      params: (params) => {
        const action = operation(params.operation)
        const result: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
          region:
            params.ociRegion === 'credential' || !params.ociRegion ? undefined : params.ociRegion,
        }
        const terraformLogFilters = [
          'type',
          'levelGreaterThanOrEqualTo',
          'timestampGreaterThanOrEqualTo',
          'timestampLessThanOrEqualTo',
        ]
        for (const key of OCI_RESOURCE_MANAGER_OPERATION_PARAMS[action]) {
          if (action === 'get_work_request_logs') {
            if (
              params.workLogKind !== 'terraform' &&
              [...terraformLogFilters, 'outputMode'].includes(key)
            )
              continue
            if (params.workLogKind === 'terraform' && key === 'compartmentId') continue
            if (
              params.workLogKind === 'terraform' &&
              params.outputMode === 'file' &&
              [...terraformLogFilters, 'limit', 'page', 'sortOrder', 'includeMessages'].includes(
                key
              )
            )
              continue
          }
          const value =
            key === 'kind'
              ? action === 'download_job_logs'
                ? params.jobLogKind
                : params.workLogKind
              : params[key]
          if (value === undefined || value === '') continue
          if (
            [
              'configSource',
              'variables',
              'freeformTags',
              'definedTags',
              'customTerraformProvider',
              'terraformAdvancedOptions',
              'variableNames',
              'outputNames',
              'type',
              'resourceAddresses',
              'resourceDriftStatus',
            ].includes(key)
          )
            result[key] = parseJson(value)
          else if (
            [
              'isThirdPartyProviderExperienceEnabled',
              'confirmDelete',
              'confirmApply',
              'confirmDestroy',
              'confirmStateReplacement',
              'confirmForce',
              'isForced',
              'isProviderUpgradeRequired',
              'includeVariables',
              'includeSource',
              'includeValues',
              'includeSensitive',
              'includeMessages',
              'includeAttributes',
              'includeProperties',
            ].includes(key)
          )
            result[key] = optionalBoolean(value)
          else if (key === 'limit') result[key] = parseOptionalNumberInput(value, 'Limit')
          else if (key === 'file') result[key] = normalizeFileInput(value, { single: true })
          else result[key] = value
        }
        if (result.isThirdPartyProviderExperienceEnabled === false)
          result.isThirdPartyProviderExperienceEnabled = undefined
        if (result.confirmForce === false) result.confirmForce = undefined
        if (result.executionPlanStrategy === 'AUTO_APPROVED') result.executionPlanJobId = undefined
        if (result.scope === 'stack') result.jobId = undefined
        if (result.scope === 'job') result.stackId = undefined
        if (
          action === 'create_stack' &&
          params.sourceDiscoveryServices &&
          (!Array.isArray(params.sourceDiscoveryServices) ||
            params.sourceDiscoveryServices.length > 0)
        ) {
          const config = result.configSource
          if (
            !config ||
            typeof config !== 'object' ||
            Array.isArray(config) ||
            !('configSourceType' in config) ||
            config.configSourceType !== 'COMPARTMENT_CONFIG_SOURCE'
          )
            throw new Error('Discovered services require COMPARTMENT_CONFIG_SOURCE')
          const services = params.sourceDiscoveryServices
          result.configSource = {
            ...config,
            servicesToDiscover: Array.isArray(services) ? services : [services],
          }
        }
        return result
      },
    },
  },
  inputs: {
    oauthCredential: { type: 'string', description: 'OCI credential ID' },
    ociRegion: { type: 'string', description: 'OCI region or credential' },
    selectorCompartmentId: { type: 'string', description: 'Selector discovery compartment' },
    sourceDiscoveryServices: { type: 'array', description: 'Compartment discovery services' },
    compartmentId: {
      type: 'string',
      description: 'Compartment OCID; destination compartment when moving a stack',
    },
    stackId: { type: 'string', description: 'Stack OCID' },
    jobId: { type: 'string', description: 'Job OCID' },
    workRequestId: { type: 'string', description: 'Work-request OCID' },
    displayName: { type: 'string', description: 'Display name; exact match for list operations' },
    description: { type: 'string', description: 'Stack description, at most 400 characters' },
    id: { type: 'string', description: 'Exact resource OCID filter' },
    lifecycleState: {
      type: 'string',
      description: 'Documented stack or job lifecycle state filter',
    },
    limit: { type: 'number', description: 'Page size, 1–1000; default 50. Returns one page only' },
    page: { type: 'string', description: 'Opaque nextPage token, at most 512 characters' },
    sortBy: { type: 'string', description: 'TIMECREATED or DISPLAYNAME' },
    sortOrder: { type: 'string', description: 'ASC or DESC' },
    configSource: {
      type: 'json',
      description:
        'Configuration source object: configSourceType plus workingDirectory and variant fields. ZIP_UPLOAD takes the separate file input; GIT_CONFIG_SOURCE takes configurationSourceProviderId, repositoryUrl, branchName; BITBUCKET_CLOUD_CONFIG_SOURCE also takes Bitbucket workspaceId; BITBUCKET_SERVER_CONFIG_SOURCE supports projectId/repositoryId; DEVOPS_CONFIG_SOURCE takes projectId/repositoryId; OBJECT_STORAGE_CONFIG_SOURCE takes region/namespace/bucketName; TEMPLATE_CONFIG_SOURCE takes templateId; COMPARTMENT_CONFIG_SOURCE takes compartmentId/region/servicesToDiscover. Template and compartment sources are create-only.',
    },
    file: {
      type: 'json',
      description:
        'One authorized uploaded ZIP configuration or Terraform state file; no inline base64 or arbitrary URL',
    },
    variables: {
      type: 'json',
      description:
        'Terraform variable string map; up to 250 entries and 8192 UTF-8 bytes per name plus value. Omit to leave variables unchanged; removal/merge semantics are not promised',
    },
    freeformTags: { type: 'json', description: 'Free-form tag string map' },
    definedTags: { type: 'json', description: 'Defined tags: namespace to string-valued tag map' },
    terraformVersion: {
      type: 'string',
      description: 'Supported Terraform version returned by List Terraform Versions',
    },
    customTerraformProvider: {
      type: 'json',
      description: 'Custom provider bucket coordinates: region, namespace, bucketName',
    },
    isThirdPartyProviderExperienceEnabled: {
      type: 'boolean',
      description:
        'Set true to migrate an older stack to Terraform Registry sourcing; cannot be reverted',
    },
    ifMatch: { type: 'string', description: 'Resource ETag for a conditional mutation' },
    retryToken: {
      type: 'string',
      description:
        'Optional stable token enabling at most two transport attempts. Reuse only for the identical logical request; Oracle tokens expire after 24 hours or earlier invalidation. Not a block-retry guarantee',
    },
    confirmDelete: {
      type: 'boolean',
      description: 'Must be true: delete the stack and its state file; deployed resources persist',
    },
    confirmApply: {
      type: 'boolean',
      description: 'Must be true to explicitly authorize applying infrastructure changes',
    },
    confirmDestroy: {
      type: 'boolean',
      description:
        'Must be true to destroy the stack resources; Oracle does not support a reviewed destroy-plan strategy',
    },
    confirmStateReplacement: {
      type: 'boolean',
      description: 'Must be true to explicitly authorize importing replacement Terraform state',
    },
    confirmForce: {
      type: 'boolean',
      description:
        'Must be true with forced cancellation; interruption can leave inconsistent state',
    },
    isForced: {
      type: 'boolean',
      description: 'Request forced cancellation; default false. Requires confirmForce',
    },
    isProviderUpgradeRequired: {
      type: 'boolean',
      description: 'Upgrade providers within configured version constraints; default false',
    },
    terraformAdvancedOptions: {
      type: 'json',
      description:
        'Optional Terraform settings: isRefreshRequired, parallelism (1–1000), detailedLogLevel (ERROR/WARN/INFO/DEBUG/TRACE). Debug logs can contain sensitive material',
    },
    executionPlanStrategy: {
      type: 'string',
      description: 'FROM_PLAN_JOB_ID for a reviewed plan, or explicitly selected AUTO_APPROVED',
    },
    executionPlanJobId: {
      type: 'string',
      description: 'Successful PLAN job OCID from the same stack; required for FROM_PLAN_JOB_ID',
    },
    targetRollbackJobId: {
      type: 'string',
      description: 'Successful APPLY job OCID from the same stack to plan rollback toward',
    },
    executionPlanRollbackJobId: {
      type: 'string',
      description: 'Successful PLAN_ROLLBACK job OCID from the same stack',
    },
    includeVariables: {
      type: 'boolean',
      description: 'Explicitly reveal only selected variableNames; values can contain secrets',
    },
    variableNames: {
      type: 'json',
      description: 'Array of variable names to reveal; required when includeVariables is true',
    },
    includeSource: {
      type: 'boolean',
      description: 'Include documented source metadata; excludes configuration file contents',
    },
    includeValues: {
      type: 'boolean',
      description: 'Explicitly reveal selected outputNames; default metadata only',
    },
    outputNames: { type: 'json', description: 'Array of output names to reveal' },
    includeSensitive: {
      type: 'boolean',
      description:
        'Also reveal selected outputs marked sensitive or with unknown sensitivity. False is not a guarantee that other values contain no secrets',
    },
    includeMessages: {
      type: 'boolean',
      description: 'Include bounded log/error messages; can contain secrets. Default metadata only',
    },
    includeAttributes: {
      type: 'boolean',
      description: 'Include resource attributes; can contain secrets',
    },
    includeProperties: {
      type: 'boolean',
      description: 'Include actual/expected drift property maps; can contain secrets',
    },
    scope: { type: 'string', description: 'stack or job; supply only its matching ID' },
    jobLogKind: {
      type: 'string',
      description:
        'Log kind: console/detailed for job downloads, service/terraform for work-request logs',
    },
    workLogKind: { type: 'string', description: 'Work-request log kind: service or terraform' },
    outputMode: {
      type: 'string',
      description:
        'entries (default) or file; file is supported only for Terraform work-request logs',
    },
    tfPlanFormat: {
      type: 'string',
      description: 'BINARY (default) or JSON; both returned as a stored file',
    },
    type: { type: 'json', description: 'Array containing TERRAFORM_CONSOLE to filter log type' },
    levelGreaterThanOrEqualTo: {
      type: 'string',
      description: 'Minimum log severity: TRACE, DEBUG, INFO, WARN, ERROR, FATAL',
    },
    timestampGreaterThanOrEqualTo: {
      type: 'string',
      description: 'Inclusive RFC 3339 start timestamp',
    },
    timestampLessThanOrEqualTo: { type: 'string', description: 'Inclusive RFC 3339 end timestamp' },
    resourceAddresses: {
      type: 'json',
      description: 'Optional array of Terraform resource addresses to check for drift',
    },
    resourceDriftStatus: {
      type: 'json',
      description: 'Array of NOT_CHECKED, IN_SYNC, MODIFIED, or DELETED filters',
    },
    resourceId: { type: 'string', description: 'Resource OCID filter' },
    terraformResourceType: { type: 'string', description: 'Terraform resource type filter' },
    configurationSourceProviderId: {
      type: 'string',
      description: 'Existing configuration-source-provider OCID filter',
    },
    configSourceProviderType: {
      type: 'string',
      description:
        'GITHUB_ACCESS_TOKEN, GITLAB_ACCESS_TOKEN, BITBUCKET_CLOUD_ACCESS_TOKEN, or BITBUCKET_SERVER_ACCESS_TOKEN',
    },
    templateId: { type: 'string', description: 'Existing template OCID filter' },
    templateCategoryId: { type: 'string', description: 'Template category identifier filter' },
  },
  outputs: {
    status: { type: 'number', description: 'Oracle HTTP status' },
    opcRequestId: { type: 'string', description: 'Oracle request ID' },
    etag: { type: 'string', description: 'Resource ETag' },
    nextPage: { type: 'string', description: 'Next page token' },
    workRequestId: { type: 'string', description: 'Asynchronous work request ID' },
    stackId: { type: 'string', description: 'Affected stack ID' },
    jobId: { type: 'string', description: 'Affected job ID' },
    accepted: { type: 'boolean', description: 'Request accepted, not completed' },
    stack: {
      type: 'json',
      description:
        'Stack ID, name, lifecycle, version, drift and explicitly selected variables/source',
    },
    job: {
      type: 'json',
      description:
        'Job ID, stack, operation, lifecycle, plan references and explicitly selected variables/source',
    },
    workRequest: {
      type: 'json',
      description: 'Work request ID, status, progress, timestamps and affected resources',
    },
    file: { type: 'file', description: 'Stored file; content may contain secrets' },
    stacks: { type: 'array', description: 'One page of stack metadata' },
    jobs: { type: 'array', description: 'One page of job metadata' },
    logs: {
      type: 'array',
      description: 'One page of timestamps, severity and explicitly requested messages',
    },
    errors: {
      type: 'array',
      description: 'One page of work-request error codes and explicitly requested messages',
    },
    outputs: {
      type: 'array',
      description: 'Output names, types, sensitivity and explicitly selected values',
    },
    resources: { type: 'array', description: 'Resource identities and optionally attributes' },
    driftDetails: {
      type: 'array',
      description: 'Drift identities/status and optionally actual/expected properties',
    },
    workRequests: { type: 'array', description: 'One page of work-request status and progress' },
    versions: { type: 'array', description: 'Supported Terraform versions and default status' },
    providers: { type: 'array', description: 'Configuration source provider identities and types' },
    templates: { type: 'array', description: 'Available template identities' },
    services: { type: 'array', description: 'Resource discovery service names and scopes' },
  },
}

export const OciResourceManagerBlockMeta = {
  tags: ['cloud', 'automation'],
  url: 'https://www.oracle.com/devops/resource-manager/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Review infrastructure changes',
      prompt:
        'Create a stack from an uploaded configuration or select an existing stack, submit a plan, record its job ID, and inspect status and logs before a separately confirmed apply.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Apply a reviewed plan',
      prompt:
        'Select a successful plan job from the intended stack, explicitly confirm apply, submit once, and record the job ID for later inspection.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect deployment status',
      prompt:
        'Read a submitted job by ID and report its lifecycle and failure code without including variables or log contents.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Investigate drift',
      prompt:
        'Start drift detection for a stack, inspect the returned work request, and list drift results for that completed request. Keep property values omitted unless explicitly requested.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Export a state snapshot',
      prompt:
        'Explicitly download the selected stack state to a stored file reference for an authorized downstream consumer. Do not include its contents in the summary.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Prepare a rollback',
      prompt:
        'Select a successful apply job from the stack, submit a rollback plan, inspect the completed plan, and only then explicitly confirm rollback apply.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Discover existing resources',
      prompt:
        'List supported discovery services and create a stack with COMPARTMENT_CONFIG_SOURCE. Inspect its work-request progress before planning changes.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['cloud'],
    },
  ],
  skills: [
    {
      name: 'review-infrastructure-changes',
      description: 'Review infrastructure changes using OCI Resource Manager.',
      content:
        '# Review infrastructure changes\n\n## Steps\n\nCreate a stack from an uploaded configuration or select an existing stack, submit a plan, record its job ID, and inspect status and logs before a separately confirmed apply.\n\n## Output\n\nReturn resource identifiers and current status. Do not automatically repeat a mutation after an uncertain response.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/create-job-plan.htm',
    },
    {
      name: 'apply-a-reviewed-plan',
      description: 'Apply a reviewed plan using OCI Resource Manager.',
      content:
        '# Apply a reviewed plan\n\n## Steps\n\nSelect a successful plan job from the intended stack, explicitly confirm apply, submit once, and record the job ID for later inspection.\n\n## Output\n\nReturn resource identifiers and current status. Do not automatically repeat a mutation after an uncertain response.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/create-job-apply.htm',
    },
    {
      name: 'inspect-deployment-status',
      description: 'Inspect deployment status using OCI Resource Manager.',
      content:
        '# Inspect deployment status\n\n## Steps\n\nRead a submitted job by ID and report its lifecycle and failure code without including variables or log contents.\n\n## Output\n\nReturn resource identifiers and current status. Do not automatically repeat a mutation after an uncertain response.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/get-job.htm',
    },
    {
      name: 'investigate-drift',
      description: 'Investigate drift using OCI Resource Manager.',
      content:
        '# Investigate drift\n\n## Steps\n\nStart drift detection for a stack, inspect the returned work request, and list drift results for that completed request. Keep property values omitted unless explicitly requested.\n\n## Output\n\nReturn resource identifiers and current status. Do not automatically repeat a mutation after an uncertain response.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/detect-drift.htm',
    },
    {
      name: 'export-a-state-snapshot',
      description: 'Export a state snapshot using OCI Resource Manager.',
      content:
        '# Export a state snapshot\n\n## Steps\n\nExplicitly download the selected stack state to a stored file reference for an authorized downstream consumer. Do not include its contents in the summary.\n\n## Output\n\nReturn resource identifiers and current status. Do not automatically repeat a mutation after an uncertain response.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/get-stack-tf-state.htm',
    },
    {
      name: 'prepare-a-rollback',
      description: 'Prepare a rollback using OCI Resource Manager.',
      content:
        '# Prepare a rollback\n\n## Steps\n\nSelect a successful apply job from the stack, submit a rollback plan, inspect the completed plan, and only then explicitly confirm rollback apply.\n\n## Output\n\nReturn resource identifiers and current status. Do not automatically repeat a mutation after an uncertain response.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/create-job-plan-rollback.htm',
    },
    {
      name: 'discover-existing-resources',
      description: 'Discover existing resources using OCI Resource Manager.',
      content:
        '# Discover existing resources\n\n## Steps\n\nList supported discovery services and create a stack with COMPARTMENT_CONFIG_SOURCE. Inspect its work-request progress before planning changes.\n\n## Output\n\nReturn resource identifiers and current status. Do not automatically repeat a mutation after an uncertain response.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Tasks/create-stack-compartment.htm',
    },
  ],
} as const satisfies BlockMeta
