import { RailwayIcon } from '@/components/icons'
import { RailwayBlockDisplay } from '@/blocks/blocks/railway.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { RailwayResponse } from '@/tools/railway/types'

export const RailwayBlock: BlockConfig<RailwayResponse> = {
  ...RailwayBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Projects', id: 'list_projects' },
        { label: 'Get Project', id: 'get_project' },
        { label: 'Create Project', id: 'create_project' },
        { label: 'Update Project', id: 'update_project' },
        { label: 'Delete Project', id: 'delete_project' },
        { label: 'Transfer Project', id: 'transfer_project' },
        { label: 'List Project Members', id: 'list_project_members' },
        { label: 'Create Environment', id: 'create_environment' },
        { label: 'Delete Environment', id: 'delete_environment' },
        { label: 'Create Service', id: 'create_service' },
        { label: 'Delete Service', id: 'delete_service' },
        { label: 'List Deployments', id: 'list_deployments' },
        { label: 'Get Deployment', id: 'get_deployment' },
        { label: 'Deploy Service', id: 'deploy_service' },
        { label: 'Restart Deployment', id: 'restart_deployment' },
        { label: 'Rollback Deployment', id: 'rollback_deployment' },
        { label: 'Get Deployment Logs', id: 'get_deployment_logs' },
        { label: 'List Variables', id: 'list_variables' },
        { label: 'Upsert Variable', id: 'upsert_variable' },
        { label: 'Delete Variable', id: 'delete_variable' },
      ],
      value: () => 'list_projects',
    },
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      placeholder: 'Enter Railway API token',
      password: true,
      required: true,
    },
    {
      id: 'tokenType',
      title: 'Token Type',
      type: 'dropdown',
      options: [
        { label: 'Account / Workspace / OAuth', id: 'account' },
        { label: 'Project', id: 'project' },
      ],
      value: () => 'account',
      mode: 'advanced',
    },
    {
      id: 'listProjectsWorkspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Workspace ID',
      condition: { field: 'operation', value: 'list_projects' },
      mode: 'advanced',
    },
    {
      id: 'first',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'list_projects' },
      mode: 'advanced',
    },
    {
      id: 'after',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous response',
      condition: { field: 'operation', value: 'list_projects' },
      mode: 'advanced',
    },
    {
      id: 'detailProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'get_project' },
      required: { field: 'operation', value: 'get_project' },
    },
    {
      id: 'createProjectName',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'my-app',
      condition: { field: 'operation', value: 'create_project' },
      required: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'createProjectDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Project description',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'createProjectWorkspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Workspace ID',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'createProjectIsPublic',
      title: 'Public Project',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'defaultEnvironmentName',
      title: 'Default Environment',
      type: 'short-input',
      placeholder: 'production',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'prDeploys',
      title: 'PR Deploys',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_project' },
      mode: 'advanced',
    },
    {
      id: 'updateProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'update_project' },
      required: { field: 'operation', value: 'update_project' },
    },
    {
      id: 'updateProjectName',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'Updated project name',
      condition: { field: 'operation', value: 'update_project' },
    },
    {
      id: 'updateProjectDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Updated project description',
      condition: { field: 'operation', value: 'update_project' },
    },
    {
      id: 'updateProjectIsPublic',
      title: 'Public Project',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_project' },
      mode: 'advanced',
    },
    {
      id: 'updateProjectPrDeploys',
      title: 'PR Deploys',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_project' },
      mode: 'advanced',
    },
    {
      id: 'deleteProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'delete_project' },
      required: { field: 'operation', value: 'delete_project' },
    },
    {
      id: 'transferProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'transfer_project' },
      required: { field: 'operation', value: 'transfer_project' },
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Destination workspace ID',
      condition: { field: 'operation', value: 'transfer_project' },
      required: { field: 'operation', value: 'transfer_project' },
    },
    {
      id: 'membersProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'list_project_members' },
      required: { field: 'operation', value: 'list_project_members' },
    },
    {
      id: 'createEnvironmentProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'create_environment' },
      required: { field: 'operation', value: 'create_environment' },
    },
    {
      id: 'environmentName',
      title: 'Environment Name',
      type: 'short-input',
      placeholder: 'staging',
      condition: { field: 'operation', value: 'create_environment' },
      required: { field: 'operation', value: 'create_environment' },
    },
    {
      id: 'sourceEnvironmentId',
      title: 'Source Environment ID',
      type: 'short-input',
      placeholder: 'Environment ID to clone from',
      condition: { field: 'operation', value: 'create_environment' },
      mode: 'advanced',
    },
    {
      id: 'ephemeral',
      title: 'Ephemeral',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_environment' },
      mode: 'advanced',
    },
    {
      id: 'skipInitialDeploys',
      title: 'Skip Initial Deploys',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_environment' },
      mode: 'advanced',
    },
    {
      id: 'stageInitialChanges',
      title: 'Stage Initial Changes',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_environment' },
      mode: 'advanced',
    },
    {
      id: 'deleteEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'delete_environment' },
      required: { field: 'operation', value: 'delete_environment' },
    },
    {
      id: 'deploymentProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'list_deployments' },
      required: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'deploymentServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Railway service ID',
      condition: { field: 'operation', value: 'list_deployments' },
      required: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'deploymentEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'list_deployments' },
      required: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'deploymentFirst',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'list_deployments' },
      mode: 'advanced',
    },
    {
      id: 'deploymentAfter',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous response',
      condition: { field: 'operation', value: 'list_deployments' },
      mode: 'advanced',
    },
    {
      id: 'deployServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Railway service ID',
      condition: { field: 'operation', value: 'deploy_service' },
      required: { field: 'operation', value: 'deploy_service' },
    },
    {
      id: 'deployEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'deploy_service' },
      required: { field: 'operation', value: 'deploy_service' },
    },
    {
      id: 'deployCommitSha',
      title: 'Commit SHA',
      type: 'short-input',
      placeholder: 'abc123...',
      condition: { field: 'operation', value: 'deploy_service' },
      mode: 'advanced',
    },
    {
      id: 'variablesProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'list_variables' },
      required: { field: 'operation', value: 'list_variables' },
    },
    {
      id: 'variablesEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'list_variables' },
      required: { field: 'operation', value: 'list_variables' },
    },
    {
      id: 'variablesServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Leave blank for shared variables',
      condition: { field: 'operation', value: 'list_variables' },
      mode: 'advanced',
    },
    {
      id: 'upsertProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'upsert_variable' },
      required: { field: 'operation', value: 'upsert_variable' },
    },
    {
      id: 'upsertEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'upsert_variable' },
      required: { field: 'operation', value: 'upsert_variable' },
    },
    {
      id: 'upsertServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Leave blank for shared variables',
      condition: { field: 'operation', value: 'upsert_variable' },
      mode: 'advanced',
    },
    {
      id: 'variableName',
      title: 'Variable Name',
      type: 'short-input',
      placeholder: 'DATABASE_URL',
      condition: { field: 'operation', value: 'upsert_variable' },
      required: { field: 'operation', value: 'upsert_variable' },
    },
    {
      id: 'variableValue',
      title: 'Variable Value',
      type: 'long-input',
      placeholder: 'Variable value',
      condition: { field: 'operation', value: 'upsert_variable' },
      required: { field: 'operation', value: 'upsert_variable' },
    },
    {
      id: 'skipDeploys',
      title: 'Skip Deploys',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'upsert_variable' },
      mode: 'advanced',
    },
    {
      id: 'createServiceProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'create_service' },
      required: { field: 'operation', value: 'create_service' },
    },
    {
      id: 'createServiceName',
      title: 'Service Name',
      type: 'short-input',
      placeholder: 'web',
      condition: { field: 'operation', value: 'create_service' },
      required: { field: 'operation', value: 'create_service' },
    },
    {
      id: 'createServiceRepo',
      title: 'GitHub Repo',
      type: 'short-input',
      placeholder: 'owner/repo',
      condition: { field: 'operation', value: 'create_service' },
    },
    {
      id: 'createServiceImage',
      title: 'Docker Image',
      type: 'short-input',
      placeholder: 'redis:7-alpine',
      condition: { field: 'operation', value: 'create_service' },
    },
    {
      id: 'createServiceBranch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'main',
      condition: { field: 'operation', value: 'create_service' },
      mode: 'advanced',
    },
    {
      id: 'deleteServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Railway service ID',
      condition: { field: 'operation', value: 'delete_service' },
      required: { field: 'operation', value: 'delete_service' },
    },
    {
      id: 'deploymentId',
      title: 'Deployment ID',
      type: 'short-input',
      placeholder: 'Railway deployment ID',
      condition: {
        field: 'operation',
        value: [
          'get_deployment',
          'restart_deployment',
          'rollback_deployment',
          'get_deployment_logs',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_deployment',
          'restart_deployment',
          'rollback_deployment',
          'get_deployment_logs',
        ],
      },
    },
    {
      id: 'logsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'get_deployment_logs' },
      mode: 'advanced',
    },
    {
      id: 'deleteVariableProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Railway project ID',
      condition: { field: 'operation', value: 'delete_variable' },
      required: { field: 'operation', value: 'delete_variable' },
    },
    {
      id: 'deleteVariableEnvironmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Railway environment ID',
      condition: { field: 'operation', value: 'delete_variable' },
      required: { field: 'operation', value: 'delete_variable' },
    },
    {
      id: 'deleteVariableName',
      title: 'Variable Name',
      type: 'short-input',
      placeholder: 'DATABASE_URL',
      condition: { field: 'operation', value: 'delete_variable' },
      required: { field: 'operation', value: 'delete_variable' },
    },
    {
      id: 'deleteVariableServiceId',
      title: 'Service ID',
      type: 'short-input',
      placeholder: 'Leave blank for shared variables',
      condition: { field: 'operation', value: 'delete_variable' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'railway_list_projects',
      'railway_get_project',
      'railway_create_project',
      'railway_update_project',
      'railway_delete_project',
      'railway_transfer_project',
      'railway_list_project_members',
      'railway_create_environment',
      'railway_delete_environment',
      'railway_create_service',
      'railway_delete_service',
      'railway_list_deployments',
      'railway_get_deployment',
      'railway_deploy_service',
      'railway_restart_deployment',
      'railway_rollback_deployment',
      'railway_get_deployment_logs',
      'railway_list_variables',
      'railway_upsert_variable',
      'railway_delete_variable',
    ],
    config: {
      tool: (params) => `railway_${params.operation}`,
      params: (params) => {
        const baseParams = {
          apiKey: params.apiKey,
          tokenType: params.tokenType,
        }

        switch (params.operation) {
          case 'list_projects':
            return {
              ...baseParams,
              workspaceId: params.listProjectsWorkspaceId,
              first: params.first ? Number(params.first) : undefined,
              after: params.after,
            }
          case 'create_project':
            return {
              ...baseParams,
              name: params.createProjectName,
              description: params.createProjectDescription,
              workspaceId: params.createProjectWorkspaceId,
              isPublic: params.createProjectIsPublic
                ? params.createProjectIsPublic === 'true'
                : undefined,
              defaultEnvironmentName: params.defaultEnvironmentName,
              prDeploys: params.prDeploys ? params.prDeploys === 'true' : undefined,
            }
          case 'update_project':
            return {
              ...baseParams,
              projectId: params.updateProjectId,
              name: params.updateProjectName,
              description: params.updateProjectDescription,
              isPublic: params.updateProjectIsPublic
                ? params.updateProjectIsPublic === 'true'
                : undefined,
              prDeploys: params.updateProjectPrDeploys
                ? params.updateProjectPrDeploys === 'true'
                : undefined,
            }
          case 'delete_project':
            return {
              ...baseParams,
              projectId: params.deleteProjectId,
            }
          case 'transfer_project':
            return {
              ...baseParams,
              projectId: params.transferProjectId,
              workspaceId: params.workspaceId,
            }
          case 'list_project_members':
            return {
              ...baseParams,
              projectId: params.membersProjectId,
            }
          case 'create_environment':
            return {
              ...baseParams,
              projectId: params.createEnvironmentProjectId,
              name: params.environmentName,
              sourceEnvironmentId: params.sourceEnvironmentId,
              ephemeral: params.ephemeral ? params.ephemeral === 'true' : undefined,
              skipInitialDeploys: params.skipInitialDeploys
                ? params.skipInitialDeploys === 'true'
                : undefined,
              stageInitialChanges: params.stageInitialChanges
                ? params.stageInitialChanges === 'true'
                : undefined,
            }
          case 'delete_environment':
            return {
              ...baseParams,
              environmentId: params.deleteEnvironmentId,
            }
          case 'get_project':
            return {
              ...baseParams,
              projectId: params.detailProjectId,
            }
          case 'list_deployments':
            return {
              ...baseParams,
              projectId: params.deploymentProjectId,
              serviceId: params.deploymentServiceId,
              environmentId: params.deploymentEnvironmentId,
              first: params.deploymentFirst ? Number(params.deploymentFirst) : undefined,
              after: params.deploymentAfter,
            }
          case 'deploy_service':
            return {
              ...baseParams,
              serviceId: params.deployServiceId,
              environmentId: params.deployEnvironmentId,
              commitSha: params.deployCommitSha,
            }
          case 'create_service':
            return {
              ...baseParams,
              projectId: params.createServiceProjectId,
              name: params.createServiceName,
              repo: params.createServiceRepo,
              image: params.createServiceImage,
              branch: params.createServiceBranch,
            }
          case 'delete_service':
            return {
              ...baseParams,
              serviceId: params.deleteServiceId,
            }
          case 'get_deployment':
            return {
              ...baseParams,
              deploymentId: params.deploymentId,
            }
          case 'restart_deployment':
            return {
              ...baseParams,
              deploymentId: params.deploymentId,
            }
          case 'rollback_deployment':
            return {
              ...baseParams,
              deploymentId: params.deploymentId,
            }
          case 'get_deployment_logs':
            return {
              ...baseParams,
              deploymentId: params.deploymentId,
              limit: params.logsLimit ? Number(params.logsLimit) : undefined,
            }
          case 'list_variables':
            return {
              ...baseParams,
              projectId: params.variablesProjectId,
              environmentId: params.variablesEnvironmentId,
              serviceId: params.variablesServiceId,
            }
          case 'upsert_variable':
            return {
              ...baseParams,
              projectId: params.upsertProjectId,
              environmentId: params.upsertEnvironmentId,
              serviceId: params.upsertServiceId,
              name: params.variableName,
              value: params.variableValue,
              skipDeploys: params.skipDeploys ? params.skipDeploys === 'true' : undefined,
            }
          case 'delete_variable':
            return {
              ...baseParams,
              projectId: params.deleteVariableProjectId,
              environmentId: params.deleteVariableEnvironmentId,
              serviceId: params.deleteVariableServiceId,
              name: params.deleteVariableName,
            }
          default:
            return baseParams
        }
      },
    },
  },

  inputs: {
    apiKey: { type: 'string', description: 'Railway API token' },
    tokenType: { type: 'string', description: 'Railway token type' },
    listProjectsWorkspaceId: { type: 'string', description: 'Workspace ID for project listing' },
    first: { type: 'number', description: 'List projects limit' },
    after: { type: 'string', description: 'List projects pagination cursor' },
    detailProjectId: { type: 'string', description: 'Project ID for project lookup' },
    createProjectName: { type: 'string', description: 'Project name to create' },
    createProjectDescription: { type: 'string', description: 'Project description to create' },
    createProjectWorkspaceId: { type: 'string', description: 'Workspace ID for created project' },
    createProjectIsPublic: { type: 'string', description: 'Whether the created project is public' },
    defaultEnvironmentName: { type: 'string', description: 'Default environment name' },
    prDeploys: { type: 'string', description: 'Whether to enable PR deploys' },
    updateProjectId: { type: 'string', description: 'Project ID to update' },
    updateProjectName: { type: 'string', description: 'Updated project name' },
    updateProjectDescription: { type: 'string', description: 'Updated project description' },
    updateProjectIsPublic: { type: 'string', description: 'Whether the project is public' },
    updateProjectPrDeploys: { type: 'string', description: 'Whether to enable PR deploys' },
    deleteProjectId: { type: 'string', description: 'Project ID to delete' },
    transferProjectId: { type: 'string', description: 'Project ID to transfer' },
    workspaceId: { type: 'string', description: 'Destination workspace ID' },
    membersProjectId: { type: 'string', description: 'Project ID for member listing' },
    createEnvironmentProjectId: { type: 'string', description: 'Project ID for new environment' },
    environmentName: { type: 'string', description: 'Environment name to create' },
    sourceEnvironmentId: { type: 'string', description: 'Environment ID to clone from' },
    ephemeral: { type: 'string', description: 'Whether the environment is ephemeral' },
    skipInitialDeploys: { type: 'string', description: 'Whether to skip initial deploys' },
    stageInitialChanges: { type: 'string', description: 'Whether to stage initial changes' },
    deleteEnvironmentId: { type: 'string', description: 'Environment ID to delete' },
    deploymentProjectId: { type: 'string', description: 'Project ID for deployments' },
    deploymentServiceId: { type: 'string', description: 'Service ID for deployments' },
    deploymentEnvironmentId: { type: 'string', description: 'Environment ID for deployments' },
    deploymentFirst: { type: 'number', description: 'List deployments limit' },
    deploymentAfter: { type: 'string', description: 'List deployments pagination cursor' },
    deployServiceId: { type: 'string', description: 'Service ID to deploy' },
    deployEnvironmentId: { type: 'string', description: 'Environment ID to deploy' },
    deployCommitSha: { type: 'string', description: 'Specific Git commit SHA to deploy' },
    variablesProjectId: { type: 'string', description: 'Project ID for variables' },
    variablesEnvironmentId: { type: 'string', description: 'Environment ID for variables' },
    variablesServiceId: { type: 'string', description: 'Optional service ID for variables' },
    upsertProjectId: { type: 'string', description: 'Project ID for variable upsert' },
    upsertEnvironmentId: { type: 'string', description: 'Environment ID for variable upsert' },
    upsertServiceId: { type: 'string', description: 'Optional service ID for variable upsert' },
    variableName: { type: 'string', description: 'Variable name' },
    variableValue: { type: 'string', description: 'Variable value' },
    skipDeploys: { type: 'string', description: 'Whether to skip deploys after variable upsert' },
    createServiceProjectId: { type: 'string', description: 'Project ID for new service' },
    createServiceName: { type: 'string', description: 'Service name to create' },
    createServiceRepo: { type: 'string', description: 'GitHub repo (owner/name) to deploy from' },
    createServiceImage: { type: 'string', description: 'Docker image to deploy' },
    createServiceBranch: { type: 'string', description: 'Git branch to deploy' },
    deleteServiceId: { type: 'string', description: 'Service ID to delete' },
    deploymentId: { type: 'string', description: 'Deployment ID to act on' },
    logsLimit: { type: 'number', description: 'Maximum number of log lines to return' },
    deleteVariableProjectId: { type: 'string', description: 'Project ID for variable deletion' },
    deleteVariableEnvironmentId: {
      type: 'string',
      description: 'Environment ID for variable deletion',
    },
    deleteVariableName: { type: 'string', description: 'Variable name to delete' },
    deleteVariableServiceId: {
      type: 'string',
      description: 'Optional service ID for variable deletion',
    },
  },

  outputs: {
    projects: {
      type: 'json',
      description: 'List of Railway projects [{id, name, description, createdAt, updatedAt}]',
    },
    project: {
      type: 'json',
      description:
        'Railway project (id, name, description, createdAt, updatedAt, services, environments)',
    },
    members: {
      type: 'json',
      description: 'Railway project members [{id, role, name, email, avatar}]',
    },
    environment: { type: 'json', description: 'Railway environment (id, name)' },
    service: { type: 'json', description: 'Railway service (id, name)' },
    deployment: {
      type: 'json',
      description:
        'Railway deployment (id, status, createdAt, url, staticUrl, canRollback, canRedeploy)',
    },
    logs: {
      type: 'json',
      description: 'Railway deployment log entries [{timestamp, message, severity}]',
    },
    deployments: {
      type: 'json',
      description:
        'List of Railway deployments [{id, status, createdAt, url, staticUrl, canRollback, canRedeploy}]',
    },
    variables: {
      type: 'json',
      description: 'Railway environment variables as a name-to-value map',
    },
    deploymentId: { type: 'string', description: 'Created deployment ID' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    count: { type: 'number', description: 'Number of items returned' },
    pageInfo: { type: 'json', description: 'Pagination information (hasNextPage, endCursor)' },
  },
}

export const RailwayBlockMeta = {
  tags: ['cloud', 'ci-cd'],
  url: 'https://railway.com',
  templates: [
    {
      icon: RailwayIcon,
      title: 'Railway deployment monitor',
      prompt:
        'Build a scheduled workflow that lists the latest Railway deployments across my services every few minutes, detects failed or crashed deployments, summarizes the failure with an agent, and posts an actionable Slack alert with a link to the service.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway deploy on merge',
      prompt:
        'Create a workflow that watches GitHub for merges to the main branch, triggers a Railway service deployment for the matching environment, and posts the deployment status back as a Slack notification.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['github', 'slack'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway environment variable auditor',
      prompt:
        'Build a scheduled weekly workflow that lists environment variables across every Railway project, compares them to a reference list in a table, flags drift and missing keys, and emails a remediation report to the platform team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'monitoring'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway project inventory',
      prompt:
        'Create a scheduled workflow that lists every Railway project, its services, and environments weekly, logs them into a tracking table, and Slacks a diff of any added or removed resources so infrastructure changes never go unnoticed.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway config sync',
      prompt:
        'Build a workflow that reads service configuration from a table and upserts the matching Railway environment variables for each service, then posts a Slack summary of every variable that was created or changed.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway preview environment provisioner',
      prompt:
        'Create a workflow that watches GitHub for new pull requests, creates a fresh Railway environment for the branch, upserts the required environment variables, deploys the service, and comments the live preview URL back on the PR.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway project onboarding kit',
      prompt:
        'Build a workflow that takes a new service name, creates a Railway project, sets up staging and production environments, seeds baseline environment variables from a table, and posts the project members and access summary to Slack for the team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'monitor-failed-deployments',
      description: 'List recent Railway deployments, detect failures, and alert with a summary.',
      content:
        '# Monitor Failed Deployments\n\nWatch Railway deployments and surface failures fast.\n\n## Steps\n1. Run list_deployments for the target project, service, and environment.\n2. Identify deployments with a failed or crashed status from the returned list.\n3. For each failure, run get_deployment_logs to pull the runtime logs and determine the likely cause.\n4. Summarize each failure: service, environment, status, and the diagnosed cause.\n5. Post an actionable alert (for example to Slack) with a link to the affected service.\n\n## Output\nReturn the count of failed deployments and a concise summary of each. If all healthy, report a clean status.',
    },
    {
      name: 'deploy-service',
      description: 'Trigger a Railway service deployment for a given environment and commit.',
      content:
        '# Deploy Service\n\nTrigger a deployment of a Railway service.\n\n## Steps\n1. Identify the service id and environment id to deploy (use get_project to look them up if needed).\n2. Run deploy_service, optionally pinning a specific commitSha.\n3. Capture the returned deploymentId.\n4. Optionally poll list_deployments to confirm the deployment reaches a success state.\n\n## Output\nReport the deploymentId, target environment, and final status.',
    },
    {
      name: 'sync-environment-variables',
      description:
        'Upsert Railway environment variables from a reference source and report changes.',
      content:
        '# Sync Environment Variables\n\nKeep Railway environment variables aligned with a reference list.\n\n## Steps\n1. Read the desired variable set (for example from a table) for each service.\n2. Run list_variables to capture the current state for the project, environment, and service.\n3. For each variable that is missing or differs, run upsert_variable. Use skipDeploys when batching multiple changes.\n4. Trigger a single deploy at the end if needed.\n\n## Output\nReturn a summary of every variable created or changed, grouped by service.',
    },
    {
      name: 'provision-preview-environment',
      description: 'Create an ephemeral Railway environment, seed variables, and deploy it.',
      content:
        '# Provision Preview Environment\n\nSpin up a fresh Railway environment for a branch or pull request.\n\n## Steps\n1. Run create_environment for the project, optionally cloning from a source environment and marking it ephemeral.\n2. Upsert the required environment variables for the new environment.\n3. Run deploy_service to bring the preview online.\n4. Capture the deployment status and the preview URL.\n\n## Output\nReturn the new environment id and the live preview URL so it can be shared on the PR.',
    },
    {
      name: 'audit-project-inventory',
      description: 'List every Railway project with services and environments for tracking.',
      content:
        '# Audit Project Inventory\n\nBuild a current inventory of Railway resources.\n\n## Steps\n1. Run list_projects, paginating with first and after until complete.\n2. For each project, run get_project to capture its services and environments.\n3. Optionally run list_project_members to record access.\n4. Compare against a prior snapshot to detect added or removed resources.\n\n## Output\nReturn the full inventory and a diff of any changes since the last run.',
    },
    {
      name: 'rollback-failed-deployment',
      description: 'Detect a bad Railway deployment and roll back or restart to recover.',
      content:
        '# Roll Back Failed Deployment\n\nRecover a Railway service automatically when a deployment goes bad.\n\n## Steps\n1. Run list_deployments for the service and environment to find the most recent deployment and its status.\n2. If the latest deployment failed or crashed, optionally run get_deployment_logs to confirm and capture the cause.\n3. To revert: pick the most recent healthy deployment with canRollback true (from list_deployments) and run rollback_deployment with its id.\n4. To recover a locked-up but otherwise healthy deployment instead, run restart_deployment with the deployment id.\n5. Run get_deployment on the resulting deployment to confirm it reaches a healthy status.\n\n## Output\nReport whether a rollback or restart was performed, the target deployment id, and the final status.',
    },
  ],
} as const satisfies BlockMeta
