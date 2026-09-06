import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  parseOptionalBooleanInput,
  parseOptionalJsonInput,
  parseOptionalNumberInput,
} from '@/blocks/utils'
import type { OciDevopsResponse } from '@/tools/oci_devops/types'

export const OciDevopsBlock: BlockConfig<OciDevopsResponse> = {
  type: 'oci_devops',
  name: 'OCI DevOps',
  description: 'Manage OCI builds, deployments, and delivery configuration',
  longDescription:
    'Manage OCI DevOps projects, repositories, build and deployment pipelines, stages, target references, artifact descriptors, connections, and native repository triggers. Submit executions with stable retry tokens and inspect bounded status pages. Configuration acceptance is not execution success. Credentials use the existing OCI API-key service account. Connection inputs contain Vault secret OCIDs, never plaintext tokens. External webhook creation, Git transport, and unrestricted logs are excluded.',
  docsLink: 'https://docs.sim.ai/integrations/oci_devops',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  authMode: AuthMode.ApiKey,
  bgColor: '#C74634',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI DevOps',
    sentences: {
      byOperation: {
        approve_deployment: ['Approve deployment'],
        cancel_build_run: ['Cancel build run'],
        cancel_deployment: ['Cancel deployment'],
        create_build_pipeline: ['Create build pipeline'],
        create_build_pipeline_stage: ['Create build pipeline stage'],
        create_build_run: ['Create build run'],
        create_connection: ['Create connection'],
        create_deploy_artifact: ['Create deploy artifact'],
        create_deploy_environment: ['Create deploy environment'],
        create_deploy_pipeline: ['Create deploy pipeline'],
        create_deploy_stage: ['Create deploy stage'],
        create_deployment: ['Create deployment'],
        create_project: ['Create project'],
        create_repository: ['Create repository'],
        create_trigger: ['Create trigger'],
        delete_build_pipeline: ['Delete build pipeline'],
        delete_build_pipeline_stage: ['Delete build pipeline stage'],
        delete_connection: ['Delete connection'],
        delete_deploy_artifact: ['Delete deploy artifact'],
        delete_deploy_environment: ['Delete deploy environment'],
        delete_deploy_pipeline: ['Delete deploy pipeline'],
        delete_deploy_stage: ['Delete deploy stage'],
        delete_project: ['Delete project'],
        delete_repository: ['Delete repository'],
        delete_trigger: ['Delete trigger'],
        get_build_pipeline: ['Get build pipeline'],
        get_build_pipeline_stage: ['Get build pipeline stage'],
        get_build_run: ['Get build run'],
        get_commit: ['Get commit'],
        get_connection: ['Get connection'],
        get_deploy_artifact: ['Get deploy artifact'],
        get_deploy_environment: ['Get deploy environment'],
        get_deploy_pipeline: ['Get deploy pipeline'],
        get_deploy_stage: ['Get deploy stage'],
        get_deployment: ['Get deployment'],
        get_project: ['Get project'],
        get_repository: ['Get repository'],
        get_trigger: ['Get trigger'],
        get_work_request: ['Get work request'],
        list_build_pipeline_stages: ['List build pipeline stages'],
        list_build_pipelines: ['List build pipelines'],
        list_build_runs: ['List build runs'],
        list_commits: ['List commits'],
        list_connections: ['List connections'],
        list_deploy_artifacts: ['List deploy artifacts'],
        list_deploy_environments: ['List deploy environments'],
        list_deploy_pipelines: ['List deploy pipelines'],
        list_deploy_stages: ['List deploy stages'],
        list_deployments: ['List deployments'],
        list_paths: ['List paths'],
        list_projects: ['List projects'],
        list_refs: ['List refs'],
        list_repositories: ['List repositories'],
        list_triggers: ['List triggers'],
        list_work_request_errors: ['List work request errors'],
        list_work_requests: ['List work requests'],
        update_build_pipeline: ['Update build pipeline'],
        update_build_pipeline_stage: ['Update build pipeline stage'],
        update_build_run: ['Update build run'],
        update_connection: ['Update connection'],
        update_deploy_artifact: ['Update deploy artifact'],
        update_deploy_environment: ['Update deploy environment'],
        update_deploy_pipeline: ['Update deploy pipeline'],
        update_deploy_stage: ['Update deploy stage'],
        update_deployment: ['Update deployment'],
        update_project: ['Update project'],
        update_repository: ['Update repository'],
        update_trigger: ['Update trigger'],
        validate_connection: ['Validate connection'],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      requiredScopes: getScopesForService('oci'),
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
      options: [
        {
          label: 'Approve Deployment',
          id: 'approve_deployment',
        },
        {
          label: 'Cancel Build Run',
          id: 'cancel_build_run',
        },
        {
          label: 'Cancel Deployment',
          id: 'cancel_deployment',
        },
        {
          label: 'Create Build Pipeline',
          id: 'create_build_pipeline',
        },
        {
          label: 'Create Build Pipeline Stage',
          id: 'create_build_pipeline_stage',
        },
        {
          label: 'Create Build Run',
          id: 'create_build_run',
        },
        {
          label: 'Create Connection',
          id: 'create_connection',
        },
        {
          label: 'Create Deploy Artifact',
          id: 'create_deploy_artifact',
        },
        {
          label: 'Create Deploy Environment',
          id: 'create_deploy_environment',
        },
        {
          label: 'Create Deploy Pipeline',
          id: 'create_deploy_pipeline',
        },
        {
          label: 'Create Deploy Stage',
          id: 'create_deploy_stage',
        },
        {
          label: 'Create Deployment',
          id: 'create_deployment',
        },
        {
          label: 'Create Project',
          id: 'create_project',
        },
        {
          label: 'Create Repository',
          id: 'create_repository',
        },
        {
          label: 'Create Trigger',
          id: 'create_trigger',
        },
        {
          label: 'Delete Build Pipeline',
          id: 'delete_build_pipeline',
        },
        {
          label: 'Delete Build Pipeline Stage',
          id: 'delete_build_pipeline_stage',
        },
        {
          label: 'Delete Connection',
          id: 'delete_connection',
        },
        {
          label: 'Delete Deploy Artifact',
          id: 'delete_deploy_artifact',
        },
        {
          label: 'Delete Deploy Environment',
          id: 'delete_deploy_environment',
        },
        {
          label: 'Delete Deploy Pipeline',
          id: 'delete_deploy_pipeline',
        },
        {
          label: 'Delete Deploy Stage',
          id: 'delete_deploy_stage',
        },
        {
          label: 'Delete Project',
          id: 'delete_project',
        },
        {
          label: 'Delete Repository',
          id: 'delete_repository',
        },
        {
          label: 'Delete Trigger',
          id: 'delete_trigger',
        },
        {
          label: 'Get Build Pipeline',
          id: 'get_build_pipeline',
        },
        {
          label: 'Get Build Pipeline Stage',
          id: 'get_build_pipeline_stage',
        },
        {
          label: 'Get Build Run',
          id: 'get_build_run',
        },
        {
          label: 'Get Commit',
          id: 'get_commit',
        },
        {
          label: 'Get Connection',
          id: 'get_connection',
        },
        {
          label: 'Get Deploy Artifact',
          id: 'get_deploy_artifact',
        },
        {
          label: 'Get Deploy Environment',
          id: 'get_deploy_environment',
        },
        {
          label: 'Get Deploy Pipeline',
          id: 'get_deploy_pipeline',
        },
        {
          label: 'Get Deploy Stage',
          id: 'get_deploy_stage',
        },
        {
          label: 'Get Deployment',
          id: 'get_deployment',
        },
        {
          label: 'Get Project',
          id: 'get_project',
        },
        {
          label: 'Get Repository',
          id: 'get_repository',
        },
        {
          label: 'Get Trigger',
          id: 'get_trigger',
        },
        {
          label: 'Get Work Request',
          id: 'get_work_request',
        },
        {
          label: 'List Build Pipeline Stages',
          id: 'list_build_pipeline_stages',
        },
        {
          label: 'List Build Pipelines',
          id: 'list_build_pipelines',
        },
        {
          label: 'List Build Runs',
          id: 'list_build_runs',
        },
        {
          label: 'List Commits',
          id: 'list_commits',
        },
        {
          label: 'List Connections',
          id: 'list_connections',
        },
        {
          label: 'List Deploy Artifacts',
          id: 'list_deploy_artifacts',
        },
        {
          label: 'List Deploy Environments',
          id: 'list_deploy_environments',
        },
        {
          label: 'List Deploy Pipelines',
          id: 'list_deploy_pipelines',
        },
        {
          label: 'List Deploy Stages',
          id: 'list_deploy_stages',
        },
        {
          label: 'List Deployments',
          id: 'list_deployments',
        },
        {
          label: 'List Paths',
          id: 'list_paths',
        },
        {
          label: 'List Projects',
          id: 'list_projects',
        },
        {
          label: 'List Refs',
          id: 'list_refs',
        },
        {
          label: 'List Repositories',
          id: 'list_repositories',
        },
        {
          label: 'List Triggers',
          id: 'list_triggers',
        },
        {
          label: 'List Work Request Errors',
          id: 'list_work_request_errors',
        },
        {
          label: 'List Work Requests',
          id: 'list_work_requests',
        },
        {
          label: 'Update Build Pipeline',
          id: 'update_build_pipeline',
        },
        {
          label: 'Update Build Pipeline Stage',
          id: 'update_build_pipeline_stage',
        },
        {
          label: 'Update Build Run',
          id: 'update_build_run',
        },
        {
          label: 'Update Connection',
          id: 'update_connection',
        },
        {
          label: 'Update Deploy Artifact',
          id: 'update_deploy_artifact',
        },
        {
          label: 'Update Deploy Environment',
          id: 'update_deploy_environment',
        },
        {
          label: 'Update Deploy Pipeline',
          id: 'update_deploy_pipeline',
        },
        {
          label: 'Update Deploy Stage',
          id: 'update_deploy_stage',
        },
        {
          label: 'Update Deployment',
          id: 'update_deployment',
        },
        {
          label: 'Update Project',
          id: 'update_project',
        },
        {
          label: 'Update Repository',
          id: 'update_repository',
        },
        {
          label: 'Update Trigger',
          id: 'update_trigger',
        },
        {
          label: 'Validate Connection',
          id: 'validate_connection',
        },
      ],
      required: true,
      value: () => 'list_projects',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'Defaults to the credential region',
      required: false,
    },
    {
      id: 'deploymentIdSelector',
      type: 'project-selector',
      canonicalParamId: 'deploymentId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.deployments',
      dependsOn: ['credential', 'region', 'deployPipelineId'],
      mode: 'basic',
      title: 'Deployment Id',
      condition: {
        field: 'operation',
        value: ['approve_deployment', 'cancel_deployment', 'get_deployment', 'update_deployment'],
      },
      required: {
        field: 'operation',
        value: ['approve_deployment', 'cancel_deployment', 'get_deployment', 'update_deployment'],
      },
    },
    {
      id: 'deploymentIdManual',
      type: 'short-input',
      canonicalParamId: 'deploymentId',
      mode: 'advanced',
      title: 'Deployment Id',
      condition: {
        field: 'operation',
        value: ['approve_deployment', 'cancel_deployment', 'get_deployment', 'update_deployment'],
      },
      required: {
        field: 'operation',
        value: ['approve_deployment', 'cancel_deployment', 'get_deployment', 'update_deployment'],
      },
    },
    {
      id: 'action',
      type: 'dropdown',
      title: 'Action',
      condition: {
        field: 'operation',
        value: ['approve_deployment'],
      },
      required: {
        field: 'operation',
        value: ['approve_deployment'],
      },
      options: (params) => {
        const choices: Record<string, string[]> = {
          approve_deployment: ['APPROVE', 'REJECT'],
        }
        return (choices[String(params?.values.operation)] ?? []).map((id) => ({ label: id, id }))
      },
    },
    {
      id: 'deployStageIdSelector',
      type: 'project-selector',
      canonicalParamId: 'deployStageId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.deployStages',
      dependsOn: ['credential', 'region', 'deployPipelineId'],
      mode: 'basic',
      title: 'Deploy Stage Id',
      condition: {
        field: 'operation',
        value: [
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
        ],
      },
    },
    {
      id: 'deployStageIdManual',
      type: 'short-input',
      canonicalParamId: 'deployStageId',
      mode: 'advanced',
      title: 'Deploy Stage Id',
      condition: {
        field: 'operation',
        value: [
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
        ],
      },
    },
    {
      id: 'reason',
      type: 'short-input',
      title: 'Reason',
      condition: {
        field: 'operation',
        value: ['approve_deployment', 'cancel_build_run', 'cancel_deployment'],
      },
      required: {
        field: 'operation',
        value: ['cancel_build_run', 'cancel_deployment'],
      },
      placeholder: 'The reason for approving or rejecting the deployment.',
    },
    {
      id: 'retryToken',
      type: 'short-input',
      title: 'Retry Token',
      condition: {
        field: 'operation',
        value: [
          'approve_deployment',
          'cancel_build_run',
          'cancel_deployment',
          'create_build_pipeline',
          'create_build_pipeline_stage',
          'create_build_run',
          'create_connection',
          'create_deploy_artifact',
          'create_deploy_environment',
          'create_deploy_pipeline',
          'create_deploy_stage',
          'create_deployment',
          'create_project',
          'create_repository',
          'create_trigger',
          'validate_connection',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'approve_deployment',
          'cancel_build_run',
          'cancel_deployment',
          'create_build_pipeline',
          'create_build_pipeline_stage',
          'create_build_run',
          'create_connection',
          'create_deploy_artifact',
          'create_deploy_environment',
          'create_deploy_pipeline',
          'create_deploy_stage',
          'create_deployment',
          'create_project',
          'create_repository',
          'create_trigger',
          'validate_connection',
        ],
      },
      placeholder:
        'Stable idempotency token (1–64 ASCII characters). Reuse for retries of this action; use a new token for a new action.',
    },
    {
      id: 'ifMatch',
      type: 'short-input',
      title: 'If Match',
      condition: {
        field: 'operation',
        value: [
          'approve_deployment',
          'cancel_build_run',
          'cancel_deployment',
          'create_build_run',
          'delete_build_pipeline',
          'delete_build_pipeline_stage',
          'delete_connection',
          'delete_deploy_artifact',
          'delete_deploy_environment',
          'delete_deploy_pipeline',
          'delete_deploy_stage',
          'delete_project',
          'delete_repository',
          'delete_trigger',
          'update_build_pipeline',
          'update_build_pipeline_stage',
          'update_build_run',
          'update_connection',
          'update_deploy_artifact',
          'update_deploy_environment',
          'update_deploy_pipeline',
          'update_deploy_stage',
          'update_deployment',
          'update_project',
          'update_repository',
          'update_trigger',
          'validate_connection',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'approve_deployment',
          'cancel_build_run',
          'cancel_deployment',
          'delete_build_pipeline',
          'delete_build_pipeline_stage',
          'delete_connection',
          'delete_deploy_artifact',
          'delete_deploy_environment',
          'delete_deploy_pipeline',
          'delete_deploy_stage',
          'delete_project',
          'delete_repository',
          'delete_trigger',
          'update_build_pipeline',
          'update_build_pipeline_stage',
          'update_build_run',
          'update_connection',
          'update_deploy_artifact',
          'update_deploy_environment',
          'update_deploy_pipeline',
          'update_deploy_stage',
          'update_deployment',
          'update_project',
          'update_repository',
          'update_trigger',
          'validate_connection',
        ],
      },
      placeholder:
        'ETag from a preceding read. Mismatches fail without overwriting concurrent changes.',
    },
    {
      id: 'buildRunIdSelector',
      type: 'project-selector',
      canonicalParamId: 'buildRunId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.buildRuns',
      dependsOn: ['credential', 'region', 'buildPipelineId'],
      mode: 'basic',
      title: 'Build Run Id',
      condition: {
        field: 'operation',
        value: ['cancel_build_run', 'get_build_run', 'update_build_run'],
      },
      required: {
        field: 'operation',
        value: ['cancel_build_run', 'get_build_run', 'update_build_run'],
      },
    },
    {
      id: 'buildRunIdManual',
      type: 'short-input',
      canonicalParamId: 'buildRunId',
      mode: 'advanced',
      title: 'Build Run Id',
      condition: {
        field: 'operation',
        value: ['cancel_build_run', 'get_build_run', 'update_build_run'],
      },
      required: {
        field: 'operation',
        value: ['cancel_build_run', 'get_build_run', 'update_build_run'],
      },
    },
    {
      id: 'buildPipelineParameters',
      type: 'long-input',
      title: 'Build Pipeline Parameters',
      condition: {
        field: 'operation',
        value: ['create_build_pipeline', 'update_build_pipeline'],
      },
      required: false,
      mode: 'advanced',
      placeholder: '{"items":[]}',
      wandConfig: {
        enabled: true,
        prompt:
          'buildPipelineParameters Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'definedTags',
      type: 'long-input',
      title: 'Defined Tags',
      condition: {
        field: 'operation',
        value: [
          'create_build_pipeline',
          'create_build_run',
          'create_deploy_pipeline',
          'create_project',
          'create_repository',
          'update_build_pipeline',
          'update_build_run',
          'update_deploy_pipeline',
          'update_project',
          'update_repository',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        prompt:
          'Defined tags for this resource. Each key is predefined and scoped to a namespace. See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"foo-namespace": {"bar-key": "value"}}` Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'description',
      type: 'short-input',
      title: 'Description',
      condition: {
        field: 'operation',
        value: [
          'create_build_pipeline',
          'create_deploy_pipeline',
          'create_project',
          'create_repository',
          'update_build_pipeline',
          'update_deploy_pipeline',
          'update_project',
          'update_repository',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Optional description about the build pipeline.',
    },
    {
      id: 'displayName',
      type: 'short-input',
      title: 'Display Name',
      condition: {
        field: 'operation',
        value: [
          'create_build_pipeline',
          'create_build_run',
          'create_deploy_pipeline',
          'list_build_pipeline_stages',
          'list_build_pipelines',
          'list_build_runs',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deploy_stages',
          'list_deployments',
          'list_paths',
          'list_triggers',
          'update_build_pipeline',
          'update_build_run',
          'update_deploy_pipeline',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Build pipeline display name. Avoid entering confidential information.',
    },
    {
      id: 'freeformTags',
      type: 'long-input',
      title: 'Freeform Tags',
      condition: {
        field: 'operation',
        value: [
          'create_build_pipeline',
          'create_build_run',
          'create_deploy_pipeline',
          'create_project',
          'create_repository',
          'update_build_pipeline',
          'update_build_run',
          'update_deploy_pipeline',
          'update_project',
          'update_repository',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        prompt:
          'Simple key-value pair that is applied without any predefined name, type or scope. Exists for cross-compatibility only.  See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"bar-key": "value"}` Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'projectIdSelector',
      type: 'project-selector',
      canonicalParamId: 'projectId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.projects',
      dependsOn: ['credential', 'region', 'compartmentId'],
      mode: 'basic',
      title: 'Project Id',
      condition: {
        field: 'operation',
        value: [
          'create_build_pipeline',
          'create_connection',
          'create_deploy_artifact',
          'create_deploy_environment',
          'create_deploy_pipeline',
          'create_repository',
          'create_trigger',
          'delete_project',
          'get_project',
          'list_build_pipelines',
          'list_build_runs',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deployments',
          'list_repositories',
          'list_triggers',
          'update_project',
          'delete_repository',
          'get_commit',
          'get_repository',
          'list_commits',
          'list_paths',
          'list_refs',
          'update_repository',
          'create_build_pipeline_stage',
          'create_build_run',
          'delete_build_pipeline',
          'get_build_pipeline',
          'list_build_pipeline_stages',
          'update_build_pipeline',
          'create_deploy_stage',
          'create_deployment',
          'delete_deploy_pipeline',
          'get_deploy_pipeline',
          'list_deploy_stages',
          'update_deploy_pipeline',
          'delete_deploy_environment',
          'get_deploy_environment',
          'update_deploy_environment',
          'delete_deploy_artifact',
          'get_deploy_artifact',
          'update_deploy_artifact',
          'delete_connection',
          'get_connection',
          'update_connection',
          'validate_connection',
          'delete_trigger',
          'get_trigger',
          'update_trigger',
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
          'cancel_build_run',
          'get_build_run',
          'update_build_run',
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
          'cancel_deployment',
          'get_deployment',
          'update_deployment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_build_pipeline',
          'create_connection',
          'create_deploy_artifact',
          'create_deploy_environment',
          'create_deploy_pipeline',
          'create_repository',
          'create_trigger',
          'delete_project',
          'get_project',
          'list_build_pipelines',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_repositories',
          'list_triggers',
          'update_project',
        ],
      },
    },
    {
      id: 'projectIdManual',
      type: 'short-input',
      canonicalParamId: 'projectId',
      mode: 'advanced',
      title: 'Project Id',
      condition: {
        field: 'operation',
        value: [
          'create_build_pipeline',
          'create_connection',
          'create_deploy_artifact',
          'create_deploy_environment',
          'create_deploy_pipeline',
          'create_repository',
          'create_trigger',
          'delete_project',
          'get_project',
          'list_build_pipelines',
          'list_build_runs',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deployments',
          'list_repositories',
          'list_triggers',
          'update_project',
          'delete_repository',
          'get_commit',
          'get_repository',
          'list_commits',
          'list_paths',
          'list_refs',
          'update_repository',
          'create_build_pipeline_stage',
          'create_build_run',
          'delete_build_pipeline',
          'get_build_pipeline',
          'list_build_pipeline_stages',
          'update_build_pipeline',
          'create_deploy_stage',
          'create_deployment',
          'delete_deploy_pipeline',
          'get_deploy_pipeline',
          'list_deploy_stages',
          'update_deploy_pipeline',
          'delete_deploy_environment',
          'get_deploy_environment',
          'update_deploy_environment',
          'delete_deploy_artifact',
          'get_deploy_artifact',
          'update_deploy_artifact',
          'delete_connection',
          'get_connection',
          'update_connection',
          'validate_connection',
          'delete_trigger',
          'get_trigger',
          'update_trigger',
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
          'cancel_build_run',
          'get_build_run',
          'update_build_run',
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
          'cancel_deployment',
          'get_deployment',
          'update_deployment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_build_pipeline',
          'create_connection',
          'create_deploy_artifact',
          'create_deploy_environment',
          'create_deploy_pipeline',
          'create_repository',
          'create_trigger',
          'delete_project',
          'get_project',
          'list_build_pipelines',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_repositories',
          'list_triggers',
          'update_project',
        ],
      },
    },
    {
      id: 'buildPipelineIdSelector',
      type: 'project-selector',
      canonicalParamId: 'buildPipelineId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.buildPipelines',
      dependsOn: ['credential', 'region', 'projectId'],
      mode: 'basic',
      title: 'Build Pipeline Id',
      condition: {
        field: 'operation',
        value: [
          'create_build_pipeline_stage',
          'create_build_run',
          'delete_build_pipeline',
          'get_build_pipeline',
          'list_build_pipeline_stages',
          'list_build_runs',
          'update_build_pipeline',
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
          'cancel_build_run',
          'get_build_run',
          'update_build_run',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_build_pipeline_stage',
          'create_build_run',
          'delete_build_pipeline',
          'get_build_pipeline',
          'list_build_pipeline_stages',
          'list_build_runs',
          'update_build_pipeline',
        ],
      },
    },
    {
      id: 'buildPipelineIdManual',
      type: 'short-input',
      canonicalParamId: 'buildPipelineId',
      mode: 'advanced',
      title: 'Build Pipeline Id',
      condition: {
        field: 'operation',
        value: [
          'create_build_pipeline_stage',
          'create_build_run',
          'delete_build_pipeline',
          'get_build_pipeline',
          'list_build_pipeline_stages',
          'list_build_runs',
          'update_build_pipeline',
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
          'cancel_build_run',
          'get_build_run',
          'update_build_run',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_build_pipeline_stage',
          'create_build_run',
          'delete_build_pipeline',
          'get_build_pipeline',
          'list_build_pipeline_stages',
          'list_build_runs',
          'update_build_pipeline',
        ],
      },
    },
    {
      id: 'buildStage',
      type: 'long-input',
      title: 'Stage',
      condition: {
        field: 'operation',
        value: ['create_build_pipeline_stage', 'update_build_pipeline_stage'],
      },
      required: true,
      placeholder:
        '{"buildPipelineStageType":"WAIT","buildPipelineStagePredecessorCollection":{"items":[{"id":"ocid1.devopsbuildpipeline.oc1..example"}]},"waitCriteria":{"waitType":"ABSOLUTE_WAIT","waitDuration":"PT30S"}}',
      wandConfig: {
        enabled: true,
        prompt:
          'Return a typed OCI build stage JSON object. Discriminate using buildPipelineStageType. Allowed values: BUILD, DELIVER_ARTIFACT, TRIGGER_DEPLOYMENT_PIPELINE, WAIT. Use the create or update schema appropriate to the selected operation. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'deployStage',
      type: 'long-input',
      title: 'Stage',
      condition: {
        field: 'operation',
        value: ['create_deploy_stage', 'update_deploy_stage'],
      },
      required: true,
      placeholder:
        '{"deployStageType":"WAIT","deployStagePredecessorCollection":{"items":[{"id":"ocid1.devopsdeploypipeline.oc1..example"}]},"waitCriteria":{"waitType":"ABSOLUTE_WAIT","waitDuration":"PT30S"}}',
      wandConfig: {
        enabled: true,
        prompt:
          'Return a typed OCI deploy stage JSON object. Discriminate using deployStageType. Allowed values: COMPUTE_INSTANCE_GROUP_BLUE_GREEN_DEPLOYMENT, COMPUTE_INSTANCE_GROUP_BLUE_GREEN_TRAFFIC_SHIFT, COMPUTE_INSTANCE_GROUP_CANARY_APPROVAL, COMPUTE_INSTANCE_GROUP_CANARY_DEPLOYMENT, COMPUTE_INSTANCE_GROUP_CANARY_TRAFFIC_SHIFT, COMPUTE_INSTANCE_GROUP_ROLLING_DEPLOYMENT, DEPLOY_FUNCTION, INVOKE_FUNCTION, LOAD_BALANCER_TRAFFIC_SHIFT, MANUAL_APPROVAL, OKE_BLUE_GREEN_DEPLOYMENT, OKE_BLUE_GREEN_TRAFFIC_SHIFT, OKE_CANARY_APPROVAL, OKE_CANARY_DEPLOYMENT, OKE_CANARY_TRAFFIC_SHIFT, OKE_DEPLOYMENT, OKE_HELM_CHART_DEPLOYMENT, SHELL, WAIT. Use the create or update schema appropriate to the selected operation. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'buildRunArguments',
      type: 'long-input',
      title: 'Build Run Arguments',
      condition: {
        field: 'operation',
        value: ['create_build_run'],
      },
      required: false,
      mode: 'advanced',
      placeholder: '{"items":[]}',
      wandConfig: {
        enabled: true,
        prompt:
          'buildRunArguments Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'commitInfo',
      type: 'long-input',
      title: 'Commit Info',
      condition: {
        field: 'operation',
        value: ['create_build_run'],
      },
      required: false,
      mode: 'advanced',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        prompt:
          'commitInfo Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'connection',
      type: 'long-input',
      title: 'Connection',
      condition: {
        field: 'operation',
        value: ['create_connection', 'update_connection'],
      },
      required: {
        field: 'operation',
        value: ['create_connection', 'update_connection'],
      },
      placeholder:
        '{"connectionType":"BITBUCKET_SERVER_ACCESS_TOKEN","secretId":"ocid1.vaultsecret.oc1..example","baseUrl":"https://example.com/repository"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Typed Connection configuration discriminated by connectionType. Supports only documented fields; see the configuration example. Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'artifact',
      type: 'long-input',
      title: 'Artifact',
      condition: {
        field: 'operation',
        value: ['create_deploy_artifact', 'update_deploy_artifact'],
      },
      required: {
        field: 'operation',
        value: ['create_deploy_artifact', 'update_deploy_artifact'],
      },
      placeholder:
        '{"argumentSubstitutionMode":"NONE","deployArtifactSource":{"deployArtifactSourceType":"GENERIC_ARTIFACT","deployArtifactPath":"example","deployArtifactVersion":"example","repositoryId":"ocid1.resource.oc1..example"},"deployArtifactType":"DEPLOYMENT_SPEC"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Typed DeployArtifact configuration. Supports only documented fields; see the configuration example. Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'environment',
      type: 'long-input',
      title: 'Environment',
      condition: {
        field: 'operation',
        value: ['create_deploy_environment', 'update_deploy_environment'],
      },
      required: {
        field: 'operation',
        value: ['create_deploy_environment', 'update_deploy_environment'],
      },
      placeholder:
        '{"deployEnvironmentType":"COMPUTE_INSTANCE_GROUP","computeInstanceGroupSelectors":{"items":[{"selectorType":"INSTANCE_IDS","computeInstanceIds":["example"]}]}}',
      wandConfig: {
        enabled: true,
        prompt:
          'Typed DeployEnvironment configuration discriminated by deployEnvironmentType. Supports only documented fields; see the configuration example. Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'deployPipelineParameters',
      type: 'long-input',
      title: 'Deploy Pipeline Parameters',
      condition: {
        field: 'operation',
        value: ['create_deploy_pipeline', 'update_deploy_pipeline'],
      },
      required: false,
      mode: 'advanced',
      placeholder: '{"items":[]}',
      wandConfig: {
        enabled: true,
        prompt:
          'deployPipelineParameters Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'deployPipelineIdSelector',
      type: 'project-selector',
      canonicalParamId: 'deployPipelineId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.deployPipelines',
      dependsOn: ['credential', 'region', 'projectId'],
      mode: 'basic',
      title: 'Deploy Pipeline Id',
      condition: {
        field: 'operation',
        value: [
          'create_deploy_stage',
          'create_deployment',
          'delete_deploy_pipeline',
          'get_deploy_pipeline',
          'list_deploy_stages',
          'list_deployments',
          'update_deploy_pipeline',
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
          'cancel_deployment',
          'get_deployment',
          'update_deployment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_deploy_stage',
          'create_deployment',
          'delete_deploy_pipeline',
          'get_deploy_pipeline',
          'list_deploy_stages',
          'list_deployments',
          'update_deploy_pipeline',
        ],
      },
    },
    {
      id: 'deployPipelineIdManual',
      type: 'short-input',
      canonicalParamId: 'deployPipelineId',
      mode: 'advanced',
      title: 'Deploy Pipeline Id',
      condition: {
        field: 'operation',
        value: [
          'create_deploy_stage',
          'create_deployment',
          'delete_deploy_pipeline',
          'get_deploy_pipeline',
          'list_deploy_stages',
          'list_deployments',
          'update_deploy_pipeline',
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
          'cancel_deployment',
          'get_deployment',
          'update_deployment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_deploy_stage',
          'create_deployment',
          'delete_deploy_pipeline',
          'get_deploy_pipeline',
          'list_deploy_stages',
          'list_deployments',
          'update_deploy_pipeline',
        ],
      },
    },
    {
      id: 'deployment',
      type: 'long-input',
      title: 'Deployment',
      condition: {
        field: 'operation',
        value: ['create_deployment', 'update_deployment'],
      },
      required: {
        field: 'operation',
        value: ['create_deployment', 'update_deployment'],
      },
      placeholder: '{"deploymentType":"PIPELINE_DEPLOYMENT"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Typed Deployment configuration discriminated by deploymentType. Supports only documented fields; see the configuration example. Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'compartmentId',
      type: 'short-input',
      title: 'Compartment Id',
      condition: {
        field: 'operation',
        value: [
          'create_project',
          'list_build_pipeline_stages',
          'list_build_pipelines',
          'list_build_runs',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deploy_stages',
          'list_deployments',
          'list_projects',
          'list_repositories',
          'list_triggers',
          'list_work_requests',
          'create_build_pipeline',
          'create_connection',
          'create_deploy_artifact',
          'create_deploy_environment',
          'create_deploy_pipeline',
          'create_repository',
          'create_trigger',
          'delete_project',
          'get_project',
          'update_project',
          'delete_repository',
          'get_commit',
          'get_repository',
          'list_commits',
          'list_paths',
          'list_refs',
          'update_repository',
          'create_build_pipeline_stage',
          'create_build_run',
          'delete_build_pipeline',
          'get_build_pipeline',
          'update_build_pipeline',
          'create_deploy_stage',
          'create_deployment',
          'delete_deploy_pipeline',
          'get_deploy_pipeline',
          'update_deploy_pipeline',
          'delete_deploy_environment',
          'get_deploy_environment',
          'update_deploy_environment',
          'delete_deploy_artifact',
          'get_deploy_artifact',
          'update_deploy_artifact',
          'delete_connection',
          'get_connection',
          'update_connection',
          'validate_connection',
          'delete_trigger',
          'get_trigger',
          'update_trigger',
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
          'cancel_build_run',
          'get_build_run',
          'update_build_run',
          'approve_deployment',
          'delete_deploy_stage',
          'get_deploy_stage',
          'update_deploy_stage',
          'cancel_deployment',
          'get_deployment',
          'update_deployment',
        ],
      },
      required: {
        field: 'operation',
        value: ['create_project', 'list_projects', 'list_work_requests'],
      },
      placeholder: 'The OCID of the compartment where the project is created.',
    },
    {
      id: 'name',
      type: 'short-input',
      title: 'Name',
      condition: {
        field: 'operation',
        value: [
          'create_project',
          'create_repository',
          'list_projects',
          'list_repositories',
          'update_repository',
        ],
      },
      required: {
        field: 'operation',
        value: ['create_project', 'create_repository'],
      },
      placeholder: 'Project name (case-sensitive).',
    },
    {
      id: 'notificationConfig',
      type: 'long-input',
      title: 'Notification Config',
      condition: {
        field: 'operation',
        value: ['create_project', 'update_project'],
      },
      required: {
        field: 'operation',
        value: ['create_project'],
      },
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        prompt:
          'notificationConfig Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'defaultBranch',
      type: 'short-input',
      title: 'Default Branch',
      condition: {
        field: 'operation',
        value: ['create_repository', 'update_repository'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'The default branch of the repository.',
    },
    {
      id: 'mirrorRepositoryConfig',
      type: 'long-input',
      title: 'Mirror Repository Config',
      condition: {
        field: 'operation',
        value: ['create_repository', 'update_repository'],
      },
      required: false,
      mode: 'advanced',
      placeholder: '{}',
      wandConfig: {
        enabled: true,
        prompt:
          'mirrorRepositoryConfig Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'parentRepositoryId',
      type: 'short-input',
      title: 'Parent Repository Id',
      condition: {
        field: 'operation',
        value: ['create_repository'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'The OCID of the parent repository.',
    },
    {
      id: 'repositoryType',
      type: 'dropdown',
      title: 'Repository Type',
      condition: {
        field: 'operation',
        value: ['create_repository', 'update_repository'],
      },
      required: {
        field: 'operation',
        value: ['create_repository'],
      },
      options: (params) => {
        const choices: Record<string, string[]> = {
          create_repository: ['MIRRORED', 'HOSTED', 'FORKED'],
          update_repository: ['MIRRORED', 'HOSTED', 'FORKED'],
        }
        return (choices[String(params?.values.operation)] ?? []).map((id) => ({ label: id, id }))
      },
    },
    {
      id: 'trigger',
      type: 'long-input',
      title: 'Trigger',
      condition: {
        field: 'operation',
        value: ['create_trigger', 'update_trigger'],
      },
      required: {
        field: 'operation',
        value: ['create_trigger', 'update_trigger'],
      },
      placeholder:
        '{"actions":[{"type":"TRIGGER_BUILD_PIPELINE","buildPipelineId":"ocid1.resource.oc1..example"}],"triggerSource":"DEVOPS_CODE_REPOSITORY"}',
      wandConfig: {
        enabled: true,
        prompt:
          'Typed Trigger configuration discriminated by triggerSource. Supports only documented fields; see the configuration example. Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'buildPipelineStageIdSelector',
      type: 'project-selector',
      canonicalParamId: 'buildPipelineStageId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.buildPipelineStages',
      dependsOn: ['credential', 'region', 'buildPipelineId'],
      mode: 'basic',
      title: 'Build Pipeline Stage Id',
      condition: {
        field: 'operation',
        value: [
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
        ],
      },
    },
    {
      id: 'buildPipelineStageIdManual',
      type: 'short-input',
      canonicalParamId: 'buildPipelineStageId',
      mode: 'advanced',
      title: 'Build Pipeline Stage Id',
      condition: {
        field: 'operation',
        value: [
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'delete_build_pipeline_stage',
          'get_build_pipeline_stage',
          'update_build_pipeline_stage',
        ],
      },
    },
    {
      id: 'connectionIdSelector',
      type: 'project-selector',
      canonicalParamId: 'connectionId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.connections',
      dependsOn: ['credential', 'region', 'projectId'],
      mode: 'basic',
      title: 'Connection Id',
      condition: {
        field: 'operation',
        value: ['delete_connection', 'get_connection', 'update_connection', 'validate_connection'],
      },
      required: {
        field: 'operation',
        value: ['delete_connection', 'get_connection', 'update_connection', 'validate_connection'],
      },
    },
    {
      id: 'connectionIdManual',
      type: 'short-input',
      canonicalParamId: 'connectionId',
      mode: 'advanced',
      title: 'Connection Id',
      condition: {
        field: 'operation',
        value: ['delete_connection', 'get_connection', 'update_connection', 'validate_connection'],
      },
      required: {
        field: 'operation',
        value: ['delete_connection', 'get_connection', 'update_connection', 'validate_connection'],
      },
    },
    {
      id: 'deployArtifactIdSelector',
      type: 'project-selector',
      canonicalParamId: 'deployArtifactId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.artifacts',
      dependsOn: ['credential', 'region', 'projectId'],
      mode: 'basic',
      title: 'Deploy Artifact Id',
      condition: {
        field: 'operation',
        value: ['delete_deploy_artifact', 'get_deploy_artifact', 'update_deploy_artifact'],
      },
      required: {
        field: 'operation',
        value: ['delete_deploy_artifact', 'get_deploy_artifact', 'update_deploy_artifact'],
      },
    },
    {
      id: 'deployArtifactIdManual',
      type: 'short-input',
      canonicalParamId: 'deployArtifactId',
      mode: 'advanced',
      title: 'Deploy Artifact Id',
      condition: {
        field: 'operation',
        value: ['delete_deploy_artifact', 'get_deploy_artifact', 'update_deploy_artifact'],
      },
      required: {
        field: 'operation',
        value: ['delete_deploy_artifact', 'get_deploy_artifact', 'update_deploy_artifact'],
      },
    },
    {
      id: 'deployEnvironmentIdSelector',
      type: 'project-selector',
      canonicalParamId: 'deployEnvironmentId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.environments',
      dependsOn: ['credential', 'region', 'projectId'],
      mode: 'basic',
      title: 'Deploy Environment Id',
      condition: {
        field: 'operation',
        value: ['delete_deploy_environment', 'get_deploy_environment', 'update_deploy_environment'],
      },
      required: {
        field: 'operation',
        value: ['delete_deploy_environment', 'get_deploy_environment', 'update_deploy_environment'],
      },
    },
    {
      id: 'deployEnvironmentIdManual',
      type: 'short-input',
      canonicalParamId: 'deployEnvironmentId',
      mode: 'advanced',
      title: 'Deploy Environment Id',
      condition: {
        field: 'operation',
        value: ['delete_deploy_environment', 'get_deploy_environment', 'update_deploy_environment'],
      },
      required: {
        field: 'operation',
        value: ['delete_deploy_environment', 'get_deploy_environment', 'update_deploy_environment'],
      },
    },
    {
      id: 'repositoryIdSelector',
      type: 'project-selector',
      canonicalParamId: 'repositoryId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.repositories',
      dependsOn: ['credential', 'region', 'projectId'],
      mode: 'basic',
      title: 'Repository Id',
      condition: {
        field: 'operation',
        value: [
          'delete_repository',
          'get_commit',
          'get_repository',
          'list_commits',
          'list_paths',
          'list_refs',
          'list_repositories',
          'update_repository',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'delete_repository',
          'get_commit',
          'get_repository',
          'list_commits',
          'list_paths',
          'list_refs',
          'update_repository',
        ],
      },
    },
    {
      id: 'repositoryIdManual',
      type: 'short-input',
      canonicalParamId: 'repositoryId',
      mode: 'advanced',
      title: 'Repository Id',
      condition: {
        field: 'operation',
        value: [
          'delete_repository',
          'get_commit',
          'get_repository',
          'list_commits',
          'list_paths',
          'list_refs',
          'list_repositories',
          'update_repository',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'delete_repository',
          'get_commit',
          'get_repository',
          'list_commits',
          'list_paths',
          'list_refs',
          'update_repository',
        ],
      },
    },
    {
      id: 'triggerIdSelector',
      type: 'project-selector',
      canonicalParamId: 'triggerId',
      serviceId: 'oci',
      selectorKey: 'oci_devops.triggers',
      dependsOn: ['credential', 'region', 'projectId'],
      mode: 'basic',
      title: 'Trigger Id',
      condition: {
        field: 'operation',
        value: ['delete_trigger', 'get_trigger', 'update_trigger'],
      },
      required: {
        field: 'operation',
        value: ['delete_trigger', 'get_trigger', 'update_trigger'],
      },
    },
    {
      id: 'triggerIdManual',
      type: 'short-input',
      canonicalParamId: 'triggerId',
      mode: 'advanced',
      title: 'Trigger Id',
      condition: {
        field: 'operation',
        value: ['delete_trigger', 'get_trigger', 'update_trigger'],
      },
      required: {
        field: 'operation',
        value: ['delete_trigger', 'get_trigger', 'update_trigger'],
      },
    },
    {
      id: 'commitId',
      type: 'short-input',
      title: 'Commit Id',
      condition: {
        field: 'operation',
        value: ['get_commit', 'list_refs'],
      },
      required: {
        field: 'operation',
        value: ['get_commit'],
      },
      placeholder: 'A filter to return only resources that match the given commit ID.',
    },
    {
      id: 'fields',
      type: 'long-input',
      title: 'Fields',
      condition: {
        field: 'operation',
        value: ['get_repository'],
      },
      required: false,
      mode: 'advanced',
      placeholder: '[]',
      wandConfig: {
        enabled: true,
        prompt:
          'Fields parameter can contain multiple flags useful in deciding the API functionality. Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'workRequestId',
      type: 'short-input',
      title: 'Work Request Id',
      condition: {
        field: 'operation',
        value: ['get_work_request', 'list_work_request_errors', 'list_work_requests'],
      },
      required: {
        field: 'operation',
        value: ['get_work_request', 'list_work_request_errors'],
      },
      placeholder: 'The ID of the asynchronous work request.',
    },
    {
      id: 'id',
      type: 'short-input',
      title: 'Id',
      condition: {
        field: 'operation',
        value: [
          'list_build_pipeline_stages',
          'list_build_pipelines',
          'list_build_runs',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deploy_stages',
          'list_deployments',
          'list_projects',
          'list_triggers',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Unique identifier or OCID for listing a single resource by ID.',
    },
    {
      id: 'lifecycleState',
      type: 'dropdown',
      title: 'Lifecycle State',
      condition: {
        field: 'operation',
        value: [
          'list_build_pipeline_stages',
          'list_build_pipelines',
          'list_build_runs',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deploy_stages',
          'list_deployments',
          'list_projects',
          'list_repositories',
          'list_triggers',
        ],
      },
      required: false,
      mode: 'advanced',
      options: (params) => {
        const choices: Record<string, string[]> = {
          list_build_pipeline_stages: [
            'CREATING',
            'UPDATING',
            'ACTIVE',
            'DELETING',
            'DELETED',
            'FAILED',
          ],
          list_build_pipelines: [
            'CREATING',
            'UPDATING',
            'ACTIVE',
            'INACTIVE',
            'DELETING',
            'DELETED',
            'FAILED',
          ],
          list_build_runs: [
            'ACCEPTED',
            'IN_PROGRESS',
            'FAILED',
            'SUCCEEDED',
            'CANCELING',
            'CANCELED',
            'DELETING',
          ],
          list_connections: ['ACTIVE', 'DELETING'],
          list_deploy_artifacts: [
            'CREATING',
            'UPDATING',
            'ACTIVE',
            'DELETING',
            'DELETED',
            'FAILED',
          ],
          list_deploy_environments: [
            'CREATING',
            'UPDATING',
            'ACTIVE',
            'DELETING',
            'DELETED',
            'FAILED',
            'NEEDS_ATTENTION',
          ],
          list_deploy_pipelines: [
            'CREATING',
            'UPDATING',
            'ACTIVE',
            'INACTIVE',
            'DELETING',
            'DELETED',
            'FAILED',
          ],
          list_deploy_stages: ['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED'],
          list_deployments: [
            'ACCEPTED',
            'IN_PROGRESS',
            'FAILED',
            'SUCCEEDED',
            'CANCELING',
            'CANCELED',
          ],
          list_projects: [
            'CREATING',
            'UPDATING',
            'ACTIVE',
            'DELETING',
            'DELETED',
            'FAILED',
            'NEEDS_ATTENTION',
          ],
          list_repositories: ['ACTIVE', 'CREATING', 'DELETED', 'FAILED', 'DELETING'],
          list_triggers: ['ACTIVE', 'DELETING'],
        }
        return (choices[String(params?.values.operation)] ?? []).map((id) => ({ label: id, id }))
      },
    },
    {
      id: 'limit',
      type: 'short-input',
      title: 'Limit',
      condition: {
        field: 'operation',
        value: [
          'list_build_pipeline_stages',
          'list_build_pipelines',
          'list_build_runs',
          'list_commits',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deploy_stages',
          'list_deployments',
          'list_paths',
          'list_projects',
          'list_refs',
          'list_repositories',
          'list_triggers',
          'list_work_request_errors',
          'list_work_requests',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'The maximum number of items to return.',
    },
    {
      id: 'page',
      type: 'short-input',
      title: 'Page',
      condition: {
        field: 'operation',
        value: [
          'list_build_pipeline_stages',
          'list_build_pipelines',
          'list_build_runs',
          'list_commits',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deploy_stages',
          'list_deployments',
          'list_paths',
          'list_projects',
          'list_refs',
          'list_repositories',
          'list_triggers',
          'list_work_request_errors',
          'list_work_requests',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'The page token representing the page at which to start retrieving results. This is usually retrieved from a previous list call.',
    },
    {
      id: 'sortOrder',
      type: 'dropdown',
      title: 'Sort Order',
      condition: {
        field: 'operation',
        value: [
          'list_build_pipeline_stages',
          'list_build_pipelines',
          'list_build_runs',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deploy_stages',
          'list_deployments',
          'list_paths',
          'list_projects',
          'list_refs',
          'list_repositories',
          'list_triggers',
          'list_work_request_errors',
          'list_work_requests',
        ],
      },
      required: false,
      mode: 'advanced',
      options: (params) => {
        const choices: Record<string, string[]> = {
          list_build_pipeline_stages: ['ASC', 'DESC'],
          list_build_pipelines: ['ASC', 'DESC'],
          list_build_runs: ['ASC', 'DESC'],
          list_connections: ['ASC', 'DESC'],
          list_deploy_artifacts: ['ASC', 'DESC'],
          list_deploy_environments: ['ASC', 'DESC'],
          list_deploy_pipelines: ['ASC', 'DESC'],
          list_deploy_stages: ['ASC', 'DESC'],
          list_deployments: ['ASC', 'DESC'],
          list_paths: ['ASC', 'DESC'],
          list_projects: ['ASC', 'DESC'],
          list_refs: ['ASC', 'DESC'],
          list_repositories: ['ASC', 'DESC'],
          list_triggers: ['ASC', 'DESC'],
          list_work_request_errors: ['ASC', 'DESC'],
          list_work_requests: ['ASC', 'DESC'],
        }
        return (choices[String(params?.values.operation)] ?? []).map((id) => ({ label: id, id }))
      },
    },
    {
      id: 'sortBy',
      type: 'dropdown',
      title: 'Sort By',
      condition: {
        field: 'operation',
        value: [
          'list_build_pipeline_stages',
          'list_build_pipelines',
          'list_build_runs',
          'list_connections',
          'list_deploy_artifacts',
          'list_deploy_environments',
          'list_deploy_pipelines',
          'list_deploy_stages',
          'list_deployments',
          'list_paths',
          'list_projects',
          'list_refs',
          'list_repositories',
          'list_triggers',
          'list_work_request_errors',
          'list_work_requests',
        ],
      },
      required: false,
      mode: 'advanced',
      options: (params) => {
        const choices: Record<string, string[]> = {
          list_build_pipeline_stages: ['timeCreated', 'displayName'],
          list_build_pipelines: ['timeCreated', 'displayName'],
          list_build_runs: ['timeCreated', 'displayName'],
          list_connections: ['timeCreated', 'displayName'],
          list_deploy_artifacts: ['timeCreated', 'displayName'],
          list_deploy_environments: ['timeCreated', 'displayName'],
          list_deploy_pipelines: ['timeCreated', 'displayName'],
          list_deploy_stages: ['timeCreated', 'displayName'],
          list_deployments: ['timeCreated', 'displayName'],
          list_paths: ['type', 'sizeInBytes', 'name'],
          list_projects: ['timeCreated', 'displayName'],
          list_refs: ['refType', 'refName'],
          list_repositories: ['timeCreated', 'name'],
          list_triggers: ['timeCreated', 'displayName'],
          list_work_request_errors: ['timeAccepted'],
          list_work_requests: ['timeAccepted'],
        }
        return (choices[String(params?.values.operation)] ?? []).map((id) => ({ label: id, id }))
      },
    },
    {
      id: 'refNameSelector',
      type: 'project-selector',
      canonicalParamId: 'refName',
      serviceId: 'oci',
      selectorKey: 'oci_devops.refs',
      dependsOn: ['credential', 'region', 'repositoryId'],
      mode: 'basic',
      title: 'Ref Name',
      condition: {
        field: 'operation',
        value: ['list_commits', 'list_refs'],
      },
      required: false,
    },
    {
      id: 'refNameManual',
      type: 'short-input',
      canonicalParamId: 'refName',
      mode: 'advanced',
      title: 'Ref Name',
      condition: {
        field: 'operation',
        value: ['list_commits', 'list_refs'],
      },
      required: false,
    },
    {
      id: 'excludeRefName',
      type: 'short-input',
      title: 'Exclude Ref Name',
      condition: {
        field: 'operation',
        value: ['list_commits'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'A filter to exclude commits that match the given reference name.',
    },
    {
      id: 'filePath',
      type: 'short-input',
      title: 'File Path',
      condition: {
        field: 'operation',
        value: ['list_commits'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'A filter to return only commits that affect any of the specified paths.',
    },
    {
      id: 'timestampGreaterThanOrEqualTo',
      type: 'short-input',
      title: 'Timestamp Greater Than Or Equal To',
      condition: {
        field: 'operation',
        value: ['list_commits'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'A filter to return commits only created after the specified timestamp value.',
    },
    {
      id: 'timestampLessThanOrEqualTo',
      type: 'short-input',
      title: 'Timestamp Less Than Or Equal To',
      condition: {
        field: 'operation',
        value: ['list_commits'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'A filter to return commits only created before the specified timestamp value.',
    },
    {
      id: 'commitMessage',
      type: 'short-input',
      title: 'Commit Message',
      condition: {
        field: 'operation',
        value: ['list_commits'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'A filter to return any commits that contains the given message.',
    },
    {
      id: 'authorName',
      type: 'short-input',
      title: 'Author Name',
      condition: {
        field: 'operation',
        value: ['list_commits'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'A filter to return any commits that are pushed by the requested author.',
    },
    {
      id: 'connectionType',
      type: 'dropdown',
      title: 'Connection Type',
      condition: {
        field: 'operation',
        value: ['list_connections'],
      },
      required: false,
      mode: 'advanced',
      options: (params) => {
        const choices: Record<string, string[]> = {
          list_connections: [
            'GITHUB_ACCESS_TOKEN',
            'GITLAB_ACCESS_TOKEN',
            'GITLAB_SERVER_ACCESS_TOKEN',
            'BITBUCKET_SERVER_ACCESS_TOKEN',
            'BITBUCKET_CLOUD_APP_PASSWORD',
            'VBS_ACCESS_TOKEN',
          ],
        }
        return (choices[String(params?.values.operation)] ?? []).map((id) => ({ label: id, id }))
      },
    },
    {
      id: 'timeCreatedLessThan',
      type: 'short-input',
      title: 'Time Created Less Than',
      condition: {
        field: 'operation',
        value: ['list_deployments'],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'Search for DevOps resources that were created before a specific date. Specifying this parameter corresponding to `timeCreatedLessThan` parameter will retrieve all assessments created before the specif',
    },
    {
      id: 'timeCreatedGreaterThanOrEqualTo',
      type: 'short-input',
      title: 'Time Created Greater Than Or Equal To',
      condition: {
        field: 'operation',
        value: ['list_deployments'],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'Search for DevOps resources that were created after a specific date. Specifying this parameter corresponding to `timeCreatedGreaterThanOrEqualTo` parameter will retrieve all security assessments creat',
    },
    {
      id: 'ref',
      type: 'short-input',
      title: 'Ref',
      condition: {
        field: 'operation',
        value: ['list_paths'],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'The name of branch/tag or commit hash it points to. If names conflict, order of preference is commit > branch > tag.',
    },
    {
      id: 'pathsInSubtree',
      type: 'switch',
      title: 'Paths In Subtree',
      condition: {
        field: 'operation',
        value: ['list_paths'],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'Flag to determine if files must be retrived recursively. Flag is False by default.',
    },
    {
      id: 'folderPath',
      type: 'short-input',
      title: 'Folder Path',
      condition: {
        field: 'operation',
        value: ['list_paths'],
      },
      required: false,
      mode: 'advanced',
      placeholder:
        'The fully qualified path to the folder whose contents are returned, including the folder name. For example, /examples is a fully-qualified path to a folder named examples that was created off of the r',
    },
    {
      id: 'refType',
      type: 'dropdown',
      title: 'Ref Type',
      condition: {
        field: 'operation',
        value: ['list_refs'],
      },
      required: false,
      mode: 'advanced',
      options: (params) => {
        const choices: Record<string, string[]> = {
          list_refs: ['BRANCH', 'TAG'],
        }
        return (choices[String(params?.values.operation)] ?? []).map((id) => ({ label: id, id }))
      },
    },
    {
      id: 'status',
      type: 'dropdown',
      title: 'Status',
      condition: {
        field: 'operation',
        value: ['list_work_requests'],
      },
      required: false,
      mode: 'advanced',
      options: (params) => {
        const choices: Record<string, string[]> = {
          list_work_requests: [
            'ACCEPTED',
            'IN_PROGRESS',
            'FAILED',
            'SUCCEEDED',
            'CANCELING',
            'CANCELED',
            'WAITING',
            'NEEDS_ATTENTION',
          ],
        }
        return (choices[String(params?.values.operation)] ?? []).map((id) => ({ label: id, id }))
      },
    },
    {
      id: 'resourceId',
      type: 'short-input',
      title: 'Resource Id',
      condition: {
        field: 'operation',
        value: ['list_work_requests'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'The ID of the resource affected by the work request.',
    },
    {
      id: 'operationTypeMultiValueQuery',
      type: 'long-input',
      title: 'Operation Type Multi Value Query',
      condition: {
        field: 'operation',
        value: ['list_work_requests'],
      },
      required: false,
      mode: 'advanced',
      placeholder: '[]',
      wandConfig: {
        enabled: true,
        prompt:
          'A filter to return only resources where their Operation Types matches the parameter operation types Use the operation-specific OCI DevOps 20210630 schema. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
  ],
  tools: {
    access: [
      'oci_devops_approve_deployment',
      'oci_devops_cancel_build_run',
      'oci_devops_cancel_deployment',
      'oci_devops_create_build_pipeline',
      'oci_devops_create_build_pipeline_stage',
      'oci_devops_create_build_run',
      'oci_devops_create_connection',
      'oci_devops_create_deploy_artifact',
      'oci_devops_create_deploy_environment',
      'oci_devops_create_deploy_pipeline',
      'oci_devops_create_deploy_stage',
      'oci_devops_create_deployment',
      'oci_devops_create_project',
      'oci_devops_create_repository',
      'oci_devops_create_trigger',
      'oci_devops_delete_build_pipeline',
      'oci_devops_delete_build_pipeline_stage',
      'oci_devops_delete_connection',
      'oci_devops_delete_deploy_artifact',
      'oci_devops_delete_deploy_environment',
      'oci_devops_delete_deploy_pipeline',
      'oci_devops_delete_deploy_stage',
      'oci_devops_delete_project',
      'oci_devops_delete_repository',
      'oci_devops_delete_trigger',
      'oci_devops_get_build_pipeline',
      'oci_devops_get_build_pipeline_stage',
      'oci_devops_get_build_run',
      'oci_devops_get_commit',
      'oci_devops_get_connection',
      'oci_devops_get_deploy_artifact',
      'oci_devops_get_deploy_environment',
      'oci_devops_get_deploy_pipeline',
      'oci_devops_get_deploy_stage',
      'oci_devops_get_deployment',
      'oci_devops_get_project',
      'oci_devops_get_repository',
      'oci_devops_get_trigger',
      'oci_devops_get_work_request',
      'oci_devops_list_build_pipeline_stages',
      'oci_devops_list_build_pipelines',
      'oci_devops_list_build_runs',
      'oci_devops_list_commits',
      'oci_devops_list_connections',
      'oci_devops_list_deploy_artifacts',
      'oci_devops_list_deploy_environments',
      'oci_devops_list_deploy_pipelines',
      'oci_devops_list_deploy_stages',
      'oci_devops_list_deployments',
      'oci_devops_list_paths',
      'oci_devops_list_projects',
      'oci_devops_list_refs',
      'oci_devops_list_repositories',
      'oci_devops_list_triggers',
      'oci_devops_list_work_request_errors',
      'oci_devops_list_work_requests',
      'oci_devops_update_build_pipeline',
      'oci_devops_update_build_pipeline_stage',
      'oci_devops_update_build_run',
      'oci_devops_update_connection',
      'oci_devops_update_deploy_artifact',
      'oci_devops_update_deploy_environment',
      'oci_devops_update_deploy_pipeline',
      'oci_devops_update_deploy_stage',
      'oci_devops_update_deployment',
      'oci_devops_update_project',
      'oci_devops_update_repository',
      'oci_devops_update_trigger',
      'oci_devops_validate_connection',
    ],
    config: {
      tool: (params) => `oci_devops_${params.operation || 'list_projects'}`,
      params: (params) => {
        const common = {
          oauthCredential: params.oauthCredential,
          region: params.region || undefined,
        }
        switch (params.operation || 'list_projects') {
          case 'approve_deployment':
            return {
              ...common,
              deploymentId: params.deploymentId,
              action: params.action,
              deployStageId: params.deployStageId,
              reason: params.reason || undefined,
              retryToken: params.retryToken,
              ifMatch: params.ifMatch,
            }
          case 'cancel_build_run':
            return {
              ...common,
              buildRunId: params.buildRunId,
              reason: params.reason,
              retryToken: params.retryToken,
              ifMatch: params.ifMatch,
            }
          case 'cancel_deployment':
            return {
              ...common,
              deploymentId: params.deploymentId,
              reason: params.reason,
              retryToken: params.retryToken,
              ifMatch: params.ifMatch,
            }
          case 'create_build_pipeline':
            return {
              ...common,
              buildPipelineParameters: parseOptionalJsonInput(
                params.buildPipelineParameters,
                'buildPipelineParameters'
              ),
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              description: params.description || undefined,
              displayName: params.displayName || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              projectId: params.projectId,
              retryToken: params.retryToken,
            }
          case 'create_build_pipeline_stage':
            return {
              ...common,
              buildPipelineId: params.buildPipelineId,
              stage: parseOptionalJsonInput(params.buildStage, 'stage'),
              retryToken: params.retryToken,
            }
          case 'create_build_run':
            return {
              ...common,
              buildPipelineId: params.buildPipelineId,
              buildRunArguments: parseOptionalJsonInput(
                params.buildRunArguments,
                'buildRunArguments'
              ),
              commitInfo: parseOptionalJsonInput(params.commitInfo, 'commitInfo'),
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              displayName: params.displayName || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              retryToken: params.retryToken,
              ifMatch: params.ifMatch || undefined,
            }
          case 'create_connection':
            return {
              ...common,
              projectId: params.projectId,
              connection: parseOptionalJsonInput(params.connection, 'connection'),
              retryToken: params.retryToken,
            }
          case 'create_deploy_artifact':
            return {
              ...common,
              projectId: params.projectId,
              artifact: parseOptionalJsonInput(params.artifact, 'artifact'),
              retryToken: params.retryToken,
            }
          case 'create_deploy_environment':
            return {
              ...common,
              projectId: params.projectId,
              environment: parseOptionalJsonInput(params.environment, 'environment'),
              retryToken: params.retryToken,
            }
          case 'create_deploy_pipeline':
            return {
              ...common,
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              deployPipelineParameters: parseOptionalJsonInput(
                params.deployPipelineParameters,
                'deployPipelineParameters'
              ),
              description: params.description || undefined,
              displayName: params.displayName || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              projectId: params.projectId,
              retryToken: params.retryToken,
            }
          case 'create_deploy_stage':
            return {
              ...common,
              deployPipelineId: params.deployPipelineId,
              stage: parseOptionalJsonInput(params.deployStage, 'stage'),
              retryToken: params.retryToken,
            }
          case 'create_deployment':
            return {
              ...common,
              deployPipelineId: params.deployPipelineId,
              deployment: parseOptionalJsonInput(params.deployment, 'deployment'),
              retryToken: params.retryToken,
            }
          case 'create_project':
            return {
              ...common,
              compartmentId: params.compartmentId,
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              description: params.description || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              name: params.name,
              notificationConfig: parseOptionalJsonInput(
                params.notificationConfig,
                'notificationConfig'
              ),
              retryToken: params.retryToken,
            }
          case 'create_repository':
            return {
              ...common,
              defaultBranch: params.defaultBranch || undefined,
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              description: params.description || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              mirrorRepositoryConfig: parseOptionalJsonInput(
                params.mirrorRepositoryConfig,
                'mirrorRepositoryConfig'
              ),
              name: params.name,
              parentRepositoryId: params.parentRepositoryId || undefined,
              projectId: params.projectId,
              repositoryType: params.repositoryType,
              retryToken: params.retryToken,
            }
          case 'create_trigger':
            return {
              ...common,
              projectId: params.projectId,
              trigger: parseOptionalJsonInput(params.trigger, 'trigger'),
              retryToken: params.retryToken,
            }
          case 'delete_build_pipeline':
            return {
              ...common,
              buildPipelineId: params.buildPipelineId,
              ifMatch: params.ifMatch,
            }
          case 'delete_build_pipeline_stage':
            return {
              ...common,
              buildPipelineStageId: params.buildPipelineStageId,
              ifMatch: params.ifMatch,
            }
          case 'delete_connection':
            return {
              ...common,
              connectionId: params.connectionId,
              ifMatch: params.ifMatch,
            }
          case 'delete_deploy_artifact':
            return {
              ...common,
              deployArtifactId: params.deployArtifactId,
              ifMatch: params.ifMatch,
            }
          case 'delete_deploy_environment':
            return {
              ...common,
              deployEnvironmentId: params.deployEnvironmentId,
              ifMatch: params.ifMatch,
            }
          case 'delete_deploy_pipeline':
            return {
              ...common,
              deployPipelineId: params.deployPipelineId,
              ifMatch: params.ifMatch,
            }
          case 'delete_deploy_stage':
            return {
              ...common,
              deployStageId: params.deployStageId,
              ifMatch: params.ifMatch,
            }
          case 'delete_project':
            return {
              ...common,
              projectId: params.projectId,
              ifMatch: params.ifMatch,
            }
          case 'delete_repository':
            return {
              ...common,
              repositoryId: params.repositoryId,
              ifMatch: params.ifMatch,
            }
          case 'delete_trigger':
            return {
              ...common,
              triggerId: params.triggerId,
              ifMatch: params.ifMatch,
            }
          case 'get_build_pipeline':
            return {
              ...common,
              buildPipelineId: params.buildPipelineId,
            }
          case 'get_build_pipeline_stage':
            return {
              ...common,
              buildPipelineStageId: params.buildPipelineStageId,
            }
          case 'get_build_run':
            return {
              ...common,
              buildRunId: params.buildRunId,
            }
          case 'get_commit':
            return {
              ...common,
              repositoryId: params.repositoryId,
              commitId: params.commitId,
            }
          case 'get_connection':
            return {
              ...common,
              connectionId: params.connectionId,
            }
          case 'get_deploy_artifact':
            return {
              ...common,
              deployArtifactId: params.deployArtifactId,
            }
          case 'get_deploy_environment':
            return {
              ...common,
              deployEnvironmentId: params.deployEnvironmentId,
            }
          case 'get_deploy_pipeline':
            return {
              ...common,
              deployPipelineId: params.deployPipelineId,
            }
          case 'get_deploy_stage':
            return {
              ...common,
              deployStageId: params.deployStageId,
            }
          case 'get_deployment':
            return {
              ...common,
              deploymentId: params.deploymentId,
            }
          case 'get_project':
            return {
              ...common,
              projectId: params.projectId,
            }
          case 'get_repository':
            return {
              ...common,
              repositoryId: params.repositoryId,
              fields: parseOptionalJsonInput(params.fields, 'fields'),
            }
          case 'get_trigger':
            return {
              ...common,
              triggerId: params.triggerId,
            }
          case 'get_work_request':
            return {
              ...common,
              workRequestId: params.workRequestId,
            }
          case 'list_build_pipeline_stages':
            return {
              ...common,
              id: params.id || undefined,
              buildPipelineId: params.buildPipelineId,
              compartmentId: params.compartmentId || undefined,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_build_pipelines':
            return {
              ...common,
              id: params.id || undefined,
              projectId: params.projectId,
              compartmentId: params.compartmentId || undefined,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_build_runs':
            return {
              ...common,
              id: params.id || undefined,
              buildPipelineId: params.buildPipelineId,
              projectId: params.projectId || undefined,
              compartmentId: params.compartmentId || undefined,
              displayName: params.displayName || undefined,
              lifecycleState: params.lifecycleState || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_commits':
            return {
              ...common,
              repositoryId: params.repositoryId,
              refName: params.refName || undefined,
              excludeRefName: params.excludeRefName || undefined,
              filePath: params.filePath || undefined,
              timestampGreaterThanOrEqualTo: params.timestampGreaterThanOrEqualTo || undefined,
              timestampLessThanOrEqualTo: params.timestampLessThanOrEqualTo || undefined,
              commitMessage: params.commitMessage || undefined,
              authorName: params.authorName || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
            }
          case 'list_connections':
            return {
              ...common,
              id: params.id || undefined,
              projectId: params.projectId,
              compartmentId: params.compartmentId || undefined,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              connectionType: params.connectionType || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_deploy_artifacts':
            return {
              ...common,
              id: params.id || undefined,
              projectId: params.projectId,
              compartmentId: params.compartmentId || undefined,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_deploy_environments':
            return {
              ...common,
              projectId: params.projectId,
              compartmentId: params.compartmentId || undefined,
              id: params.id || undefined,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_deploy_pipelines':
            return {
              ...common,
              id: params.id || undefined,
              projectId: params.projectId,
              compartmentId: params.compartmentId || undefined,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_deploy_stages':
            return {
              ...common,
              id: params.id || undefined,
              deployPipelineId: params.deployPipelineId,
              compartmentId: params.compartmentId || undefined,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_deployments':
            return {
              ...common,
              deployPipelineId: params.deployPipelineId,
              id: params.id || undefined,
              compartmentId: params.compartmentId || undefined,
              projectId: params.projectId || undefined,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
              timeCreatedLessThan: params.timeCreatedLessThan || undefined,
              timeCreatedGreaterThanOrEqualTo: params.timeCreatedGreaterThanOrEqualTo || undefined,
            }
          case 'list_paths':
            return {
              ...common,
              repositoryId: params.repositoryId,
              ref: params.ref || undefined,
              pathsInSubtree: parseOptionalBooleanInput(params.pathsInSubtree),
              folderPath: params.folderPath || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              displayName: params.displayName || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_projects':
            return {
              ...common,
              id: params.id || undefined,
              compartmentId: params.compartmentId,
              lifecycleState: params.lifecycleState || undefined,
              name: params.name || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_refs':
            return {
              ...common,
              repositoryId: params.repositoryId,
              refType: params.refType || undefined,
              commitId: params.commitId || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              refName: params.refName || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_repositories':
            return {
              ...common,
              compartmentId: params.compartmentId || undefined,
              projectId: params.projectId,
              repositoryId: params.repositoryId || undefined,
              lifecycleState: params.lifecycleState || undefined,
              name: params.name || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_triggers':
            return {
              ...common,
              compartmentId: params.compartmentId || undefined,
              projectId: params.projectId,
              lifecycleState: params.lifecycleState || undefined,
              displayName: params.displayName || undefined,
              id: params.id || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              page: params.page || undefined,
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_work_request_errors':
            return {
              ...common,
              workRequestId: params.workRequestId,
              page: params.page || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
            }
          case 'list_work_requests':
            return {
              ...common,
              compartmentId: params.compartmentId,
              workRequestId: params.workRequestId || undefined,
              status: params.status || undefined,
              resourceId: params.resourceId || undefined,
              page: params.page || undefined,
              limit: parseOptionalNumberInput(params.limit, 'limit'),
              sortOrder: params.sortOrder || undefined,
              sortBy: params.sortBy || undefined,
              operationTypeMultiValueQuery: parseOptionalJsonInput(
                params.operationTypeMultiValueQuery,
                'operationTypeMultiValueQuery'
              ),
            }
          case 'update_build_pipeline':
            return {
              ...common,
              buildPipelineId: params.buildPipelineId,
              buildPipelineParameters: parseOptionalJsonInput(
                params.buildPipelineParameters,
                'buildPipelineParameters'
              ),
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              description: params.description || undefined,
              displayName: params.displayName || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              ifMatch: params.ifMatch,
            }
          case 'update_build_pipeline_stage':
            return {
              ...common,
              buildPipelineStageId: params.buildPipelineStageId,
              stage: parseOptionalJsonInput(params.buildStage, 'stage'),
              ifMatch: params.ifMatch,
            }
          case 'update_build_run':
            return {
              ...common,
              buildRunId: params.buildRunId,
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              displayName: params.displayName || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              ifMatch: params.ifMatch,
            }
          case 'update_connection':
            return {
              ...common,
              connectionId: params.connectionId,
              connection: parseOptionalJsonInput(params.connection, 'connection'),
              ifMatch: params.ifMatch,
            }
          case 'update_deploy_artifact':
            return {
              ...common,
              deployArtifactId: params.deployArtifactId,
              artifact: parseOptionalJsonInput(params.artifact, 'artifact'),
              ifMatch: params.ifMatch,
            }
          case 'update_deploy_environment':
            return {
              ...common,
              deployEnvironmentId: params.deployEnvironmentId,
              environment: parseOptionalJsonInput(params.environment, 'environment'),
              ifMatch: params.ifMatch,
            }
          case 'update_deploy_pipeline':
            return {
              ...common,
              deployPipelineId: params.deployPipelineId,
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              deployPipelineParameters: parseOptionalJsonInput(
                params.deployPipelineParameters,
                'deployPipelineParameters'
              ),
              description: params.description || undefined,
              displayName: params.displayName || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              ifMatch: params.ifMatch,
            }
          case 'update_deploy_stage':
            return {
              ...common,
              deployStageId: params.deployStageId,
              stage: parseOptionalJsonInput(params.deployStage, 'stage'),
              ifMatch: params.ifMatch,
            }
          case 'update_deployment':
            return {
              ...common,
              deploymentId: params.deploymentId,
              deployment: parseOptionalJsonInput(params.deployment, 'deployment'),
              ifMatch: params.ifMatch,
            }
          case 'update_project':
            return {
              ...common,
              projectId: params.projectId,
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              description: params.description || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              notificationConfig: parseOptionalJsonInput(
                params.notificationConfig,
                'notificationConfig'
              ),
              ifMatch: params.ifMatch,
            }
          case 'update_repository':
            return {
              ...common,
              repositoryId: params.repositoryId,
              defaultBranch: params.defaultBranch || undefined,
              definedTags: parseOptionalJsonInput(params.definedTags, 'definedTags'),
              description: params.description || undefined,
              freeformTags: parseOptionalJsonInput(params.freeformTags, 'freeformTags'),
              mirrorRepositoryConfig: parseOptionalJsonInput(
                params.mirrorRepositoryConfig,
                'mirrorRepositoryConfig'
              ),
              name: params.name || undefined,
              repositoryType: params.repositoryType || undefined,
              ifMatch: params.ifMatch,
            }
          case 'update_trigger':
            return {
              ...common,
              triggerId: params.triggerId,
              trigger: parseOptionalJsonInput(params.trigger, 'trigger'),
              ifMatch: params.ifMatch,
            }
          case 'validate_connection':
            return {
              ...common,
              connectionId: params.connectionId,
              retryToken: params.retryToken,
              ifMatch: params.ifMatch,
            }
          default:
            throw new Error('Unsupported OCI DevOps operation')
        }
      },
    },
  },
  inputs: {
    oauthCredential: { type: 'string', description: 'OCI service-account credential ID' },
    region: { type: 'string', description: 'OCI region override' },
    operation: { type: 'string', description: 'OCI DevOps operation' },
    deploymentId: {
      type: 'string',
      description: 'Unique deployment identifier.',
    },
    action: {
      type: 'string',
      description: 'The action of Approve or Reject.',
    },
    deployStageId: {
      type: 'string',
      description:
        'The [OCID](/Content/General/Concepts/identifiers.htm) of the stage which is marked for approval.',
    },
    reason: {
      type: 'string',
      description: 'The reason for approving or rejecting the deployment.',
    },
    retryToken: {
      type: 'string',
      description:
        'Stable idempotency token (1–64 ASCII characters). Reuse for retries of this action; use a new token for a new action.',
    },
    ifMatch: {
      type: 'string',
      description:
        'ETag from a preceding read. Mismatches fail without overwriting concurrent changes.',
    },
    buildRunId: {
      type: 'string',
      description: 'Unique build run identifier.',
    },
    buildPipelineParameters: {
      type: 'json',
      description: 'buildPipelineParameters',
    },
    definedTags: {
      type: 'json',
      description:
        'Defined tags for this resource. Each key is predefined and scoped to a namespace. See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"foo-namespace": {"bar-key": "value"}}`',
    },
    description: {
      type: 'string',
      description: 'Optional description about the build pipeline.',
    },
    displayName: {
      type: 'string',
      description: 'Build pipeline display name. Avoid entering confidential information.',
    },
    freeformTags: {
      type: 'json',
      description:
        'Simple key-value pair that is applied without any predefined name, type or scope. Exists for cross-compatibility only.  See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"bar-key": "value"}`',
    },
    projectId: {
      type: 'string',
      description: 'The OCID of the DevOps project.',
    },
    buildPipelineId: {
      type: 'string',
      description: 'The OCID of the build pipeline.',
    },
    buildRunArguments: {
      type: 'json',
      description: 'buildRunArguments',
    },
    commitInfo: {
      type: 'json',
      description: 'commitInfo',
    },
    connection: {
      type: 'json',
      description:
        'Typed Connection configuration discriminated by connectionType. Supports only documented fields; see the configuration example.',
    },
    artifact: {
      type: 'json',
      description:
        'Typed DeployArtifact configuration. Supports only documented fields; see the configuration example.',
    },
    environment: {
      type: 'json',
      description:
        'Typed DeployEnvironment configuration discriminated by deployEnvironmentType. Supports only documented fields; see the configuration example.',
    },
    deployPipelineParameters: {
      type: 'json',
      description: 'deployPipelineParameters',
    },
    deployPipelineId: {
      type: 'string',
      description: 'The OCID of a pipeline.',
    },
    deployment: {
      type: 'json',
      description:
        'Typed Deployment configuration discriminated by deploymentType. Supports only documented fields; see the configuration example.',
    },
    compartmentId: {
      type: 'string',
      description: 'The OCID of the compartment where the project is created.',
    },
    name: {
      type: 'string',
      description: 'Project name (case-sensitive).',
    },
    notificationConfig: {
      type: 'json',
      description: 'notificationConfig',
    },
    defaultBranch: {
      type: 'string',
      description: 'The default branch of the repository.',
    },
    mirrorRepositoryConfig: {
      type: 'json',
      description: 'mirrorRepositoryConfig',
    },
    parentRepositoryId: {
      type: 'string',
      description: 'The OCID of the parent repository.',
    },
    repositoryType: {
      type: 'string',
      description: 'Type of repository. Allowed values: ',
    },
    trigger: {
      type: 'json',
      description:
        'Typed Trigger configuration discriminated by triggerSource. Supports only documented fields; see the configuration example.',
    },
    buildPipelineStageId: {
      type: 'string',
      description: 'Unique stage identifier.',
    },
    connectionId: {
      type: 'string',
      description: 'Unique connection identifier.',
    },
    deployArtifactId: {
      type: 'string',
      description: 'Unique artifact identifier.',
    },
    deployEnvironmentId: {
      type: 'string',
      description: 'Unique environment identifier.',
    },
    repositoryId: {
      type: 'string',
      description: 'Unique repository identifier.',
    },
    triggerId: {
      type: 'string',
      description: 'Unique trigger identifier.',
    },
    commitId: {
      type: 'string',
      description: 'A filter to return only resources that match the given commit ID.',
    },
    fields: {
      type: 'json',
      description:
        'Fields parameter can contain multiple flags useful in deciding the API functionality.',
    },
    workRequestId: {
      type: 'string',
      description: 'The ID of the asynchronous work request.',
    },
    id: {
      type: 'string',
      description: 'Unique identifier or OCID for listing a single resource by ID.',
    },
    lifecycleState: {
      type: 'string',
      description: 'A filter to return the stages that matches the given lifecycle state.',
    },
    limit: {
      type: 'number',
      description: 'The maximum number of items to return.',
    },
    page: {
      type: 'string',
      description:
        'The page token representing the page at which to start retrieving results. This is usually retrieved from a previous list call.',
    },
    sortOrder: {
      type: 'string',
      description: 'The sort order to use. Use either ascending or descending.',
    },
    sortBy: {
      type: 'string',
      description:
        'The field to sort by. Only one sort order may be provided. Default order for time created is descending. Default order for display name is ascending. If no value is specified, then the default time created value is considered.',
    },
    refName: {
      type: 'string',
      description: 'A filter to return only resources that match the given reference name.',
    },
    excludeRefName: {
      type: 'string',
      description: 'A filter to exclude commits that match the given reference name.',
    },
    filePath: {
      type: 'string',
      description: 'A filter to return only commits that affect any of the specified paths.',
    },
    timestampGreaterThanOrEqualTo: {
      type: 'string',
      description: 'A filter to return commits only created after the specified timestamp value.',
    },
    timestampLessThanOrEqualTo: {
      type: 'string',
      description: 'A filter to return commits only created before the specified timestamp value.',
    },
    commitMessage: {
      type: 'string',
      description: 'A filter to return any commits that contains the given message.',
    },
    authorName: {
      type: 'string',
      description: 'A filter to return any commits that are pushed by the requested author.',
    },
    connectionType: {
      type: 'string',
      description: 'A filter to return only resources that match the given connection type.',
    },
    timeCreatedLessThan: {
      type: 'string',
      description:
        'Search for DevOps resources that were created before a specific date. Specifying this parameter corresponding to `timeCreatedLessThan` parameter will retrieve all assessments created before the specified created date, in "YYYY-MM-ddThh:mmZ" format with a Z offset, as defined by [RFC3339](https://datatracker.ietf.org/doc/html/rfc3339).',
    },
    timeCreatedGreaterThanOrEqualTo: {
      type: 'string',
      description:
        'Search for DevOps resources that were created after a specific date. Specifying this parameter corresponding to `timeCreatedGreaterThanOrEqualTo` parameter will retrieve all security assessments created after the specified created date, in "YYYY-MM-ddThh:mmZ" format with a Z offset, as defined by [RFC3339](https://datatracker.ietf.org/doc/html/rfc3339).',
    },
    ref: {
      type: 'string',
      description:
        'The name of branch/tag or commit hash it points to. If names conflict, order of preference is commit > branch > tag.',
    },
    pathsInSubtree: {
      type: 'boolean',
      description:
        'Flag to determine if files must be retrived recursively. Flag is False by default.',
    },
    folderPath: {
      type: 'string',
      description:
        'The fully qualified path to the folder whose contents are returned, including the folder name. For example, /examples is a fully-qualified path to a folder named examples that was created off of the root directory (/) of a repository.',
    },
    refType: {
      type: 'string',
      description:
        'Reference type to distinguish between branch and tag. If it is not specified, all references are returned.',
    },
    status: {
      type: 'string',
      description:
        'A filter to return only resources where the lifecycle state matches the given operation status.',
    },
    resourceId: {
      type: 'string',
      description: 'The ID of the resource affected by the work request.',
    },
    operationTypeMultiValueQuery: {
      type: 'json',
      description:
        'A filter to return only resources where their Operation Types matches the parameter operation types',
    },
    buildStage: {
      type: 'json',
      description:
        'Typed BuildPipelineStage configuration discriminated by buildPipelineStageType. Supports only documented fields; see the configuration example.',
    },
    deployStage: {
      type: 'json',
      description:
        'Typed DeployStage configuration discriminated by deployStageType. Supports only documented fields.',
    },
  },
  outputs: {
    resource: {
      type: 'json',
      description:
        'Resource identity, parent references, configuration references, and lifecycle status',
    },
    items: { type: 'json', description: 'One page of resource summaries' },
    nextPage: { type: 'string', description: 'Opaque next page token' },
    etag: { type: 'string', description: 'ETag for conditional changes' },
    requestId: { type: 'string', description: 'OCI request ID' },
    workRequestId: { type: 'string', description: 'Configuration work request ID' },
    accepted: {
      type: 'boolean',
      description: 'Mutation accepted; does not imply execution success',
    },
    retryAfterSeconds: { type: 'number', description: 'Bounded suggested polling delay' },
  },
}

export const OciDevopsBlockMeta: BlockMeta = {
  tags: ['cloud', 'ci-cd'],
  url: 'https://www.oracle.com/devops/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Build a release',
      prompt:
        'Start an OCI build run with explicit arguments and a stable per-action retry token, then inspect the run ID and status.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect a failed delivery',
      prompt:
        'List recent OCI deployments and inspect a failed deployment and its stage status, without reading unrestricted logs.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Approve a deployment',
      prompt:
        'Read an OCI deployment and submit an explicit approve or reject decision for its manual approval stage using its ETag and a stable retry token.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Redeploy a release',
      prompt:
        'Create an OCI pipeline redeployment from an explicit previous deployment ID and inspect its new execution status.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Audit source revisions',
      prompt:
        'List OCI repository refs and commits and inspect a selected commit before starting a release.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Configure a repository trigger',
      prompt:
        'Create a native OCI repository trigger with a typed branch filter and build-pipeline action; do not create an inbound Sim trigger.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Track configuration changes',
      prompt:
        'Read an OCI configuration work request and its bounded error codes. Use a bounded workflow loop with a deadline if repeated status reads are needed.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd'],
    },
  ],
  skills: [
    {
      name: 'build-a-release',
      description:
        'Start an OCI build run with explicit arguments and a stable per-action retry token, then inspect the run ID and status.',
      content:
        '# Build a release\n\n## Steps\n1. Select the OCI credential, region, and relevant project or pipeline.\n2. Start an OCI build run with explicit arguments and a stable per-action retry token, then inspect the run ID and status.\n3. Keep one retry token for each logical submission and use the latest explicitly read ETag for conditional changes.\n\n## Output\nReturn resource IDs and documented state. Distinguish acceptance from completed execution.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/devops/using/devops_overview.htm',
    },
    {
      name: 'inspect-a-failed-delivery',
      description:
        'List recent OCI deployments and inspect a failed deployment and its stage status, without reading unrestricted logs.',
      content:
        '# Inspect a failed delivery\n\n## Steps\n1. Select the OCI credential, region, and relevant project or pipeline.\n2. List recent OCI deployments and inspect a failed deployment and its stage status, without reading unrestricted logs.\n3. Keep one retry token for each logical submission and use the latest explicitly read ETag for conditional changes.\n\n## Output\nReturn resource IDs and documented state. Distinguish acceptance from completed execution.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/devops/using/devops_overview.htm',
    },
    {
      name: 'approve-a-deployment',
      description:
        'Read an OCI deployment and submit an explicit approve or reject decision for its manual approval stage using its ETag and a stable retry token.',
      content:
        '# Approve a deployment\n\n## Steps\n1. Select the OCI credential, region, and relevant project or pipeline.\n2. Read an OCI deployment and submit an explicit approve or reject decision for its manual approval stage using its ETag and a stable retry token.\n3. Keep one retry token for each logical submission and use the latest explicitly read ETag for conditional changes.\n\n## Output\nReturn resource IDs and documented state. Distinguish acceptance from completed execution.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/devops/using/devops_overview.htm',
    },
    {
      name: 'redeploy-a-release',
      description:
        'Create an OCI pipeline redeployment from an explicit previous deployment ID and inspect its new execution status.',
      content:
        '# Redeploy a release\n\n## Steps\n1. Select the OCI credential, region, and relevant project or pipeline.\n2. Create an OCI pipeline redeployment from an explicit previous deployment ID and inspect its new execution status.\n3. Keep one retry token for each logical submission and use the latest explicitly read ETag for conditional changes.\n\n## Output\nReturn resource IDs and documented state. Distinguish acceptance from completed execution.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/devops/using/devops_overview.htm',
    },
    {
      name: 'audit-source-revisions',
      description:
        'List OCI repository refs and commits and inspect a selected commit before starting a release.',
      content:
        '# Audit source revisions\n\n## Steps\n1. Select the OCI credential, region, and relevant project or pipeline.\n2. List OCI repository refs and commits and inspect a selected commit before starting a release.\n3. Keep one retry token for each logical submission and use the latest explicitly read ETag for conditional changes.\n\n## Output\nReturn resource IDs and documented state. Distinguish acceptance from completed execution.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/devops/using/devops_overview.htm',
    },
    {
      name: 'configure-a-repository-trigger',
      description:
        'Create a native OCI repository trigger with a typed branch filter and build-pipeline action; do not create an inbound Sim trigger.',
      content:
        '# Configure a repository trigger\n\n## Steps\n1. Select the OCI credential, region, and relevant project or pipeline.\n2. Create a native OCI repository trigger with a typed branch filter and build-pipeline action; do not create an inbound Sim trigger.\n3. Keep one retry token for each logical submission and use the latest explicitly read ETag for conditional changes.\n\n## Output\nReturn resource IDs and documented state. Distinguish acceptance from completed execution.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/devops/using/trigger_build.htm',
    },
  ],
}
