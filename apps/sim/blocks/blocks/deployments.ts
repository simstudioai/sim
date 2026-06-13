import { SimDeploymentsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const DeploymentsBlock: BlockConfig = {
  type: 'deployments',
  name: 'Deployments',
  description: 'Manage workflow deployments',
  longDescription:
    'Deploy, undeploy, and roll back workflows in the current workspace. Promote a previous deployment version to live, list every version, or fetch the deployed workflow state for a specific version.',
  bestPractices: `
  - The block operates on workflows in the current workspace; pick one with the selector or pass an ID.
  - Deploy publishes the workflow's current draft as a new live version. Undeploy takes it offline.
  - 'Promote Version to Live' re-activates an existing version without creating a new one — use it to roll back to a known-good version. It also works on an undeployed workflow, re-deploying it live at that version.
  - Use 'List Versions' to discover version numbers, then feed one into 'Promote Version to Live' or 'Get Version Details'.
  - Deploy, undeploy, and promote require admin permission on the workspace; the read operations require workspace access.
  `,
  bgColor: '#0C0C0C',
  iconColor: '#33C482',
  icon: SimDeploymentsIcon,
  category: 'blocks',
  docsLink: 'https://docs.sim.ai/workflows/deployment',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Deploy', id: 'deployments_deploy' },
        { label: 'Undeploy', id: 'deployments_undeploy' },
        { label: 'Promote Version to Live', id: 'deployments_promote' },
        { label: 'List Versions', id: 'deployments_list_versions' },
        { label: 'Get Version Details', id: 'deployments_get_version' },
      ],
      value: () => 'deployments_deploy',
    },
    {
      id: 'workflowSelector',
      title: 'Workflow',
      type: 'workflow-selector',
      selectorKey: 'sim.workflows',
      placeholder: 'Select workflow',
      mode: 'basic',
      canonicalParamId: 'workflowId',
      required: true,
    },
    {
      id: 'manualWorkflowId',
      title: 'Workflow ID',
      type: 'short-input',
      placeholder: 'Workflow ID',
      mode: 'advanced',
      canonicalParamId: 'workflowId',
      required: true,
    },
    {
      id: 'versionName',
      title: 'Version Name',
      type: 'short-input',
      placeholder: 'Optional label, e.g. "Release 4"',
      condition: { field: 'operation', value: 'deployments_deploy' },
    },
    {
      id: 'versionDescription',
      title: 'Version Description',
      type: 'long-input',
      placeholder: 'Optional summary of what changed in this version',
      condition: { field: 'operation', value: 'deployments_deploy' },
    },
    {
      id: 'version',
      title: 'Version',
      type: 'short-input',
      placeholder: 'Deployment version number, e.g. 3',
      condition: {
        field: 'operation',
        value: ['deployments_promote', 'deployments_get_version'],
      },
      required: {
        field: 'operation',
        value: ['deployments_promote', 'deployments_get_version'],
      },
    },
  ],
  tools: {
    access: [
      'deployments_deploy',
      'deployments_undeploy',
      'deployments_promote',
      'deployments_list_versions',
      'deployments_get_version',
    ],
    config: {
      tool: (params: Record<string, any>) => params.operation || 'deployments_deploy',
      params: (params: Record<string, any>) => {
        const operation = params.operation || 'deployments_deploy'
        const workflowId = typeof params.workflowId === 'string' ? params.workflowId.trim() : ''
        if (!workflowId) {
          throw new Error('Deployments Block Error: Workflow is required')
        }

        if (operation === 'deployments_deploy') {
          return {
            workflowId,
            name: params.versionName?.trim() || undefined,
            description: params.versionDescription?.trim() || undefined,
          }
        }

        if (operation === 'deployments_promote' || operation === 'deployments_get_version') {
          const version = Number(params.version)
          if (!Number.isInteger(version) || version < 1) {
            throw new Error('Deployments Block Error: Version must be a positive integer')
          }
          return { workflowId, version }
        }

        return { workflowId }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    workflowId: { type: 'string', description: 'Target workflow (canonical param)' },
    versionName: { type: 'string', description: 'Optional version label (Deploy operation)' },
    versionDescription: {
      type: 'string',
      description: 'Optional version description (Deploy operation)',
    },
    version: {
      type: 'number',
      description: 'Deployment version number (Promote and Get Version Details operations)',
    },
  },
  outputs: {
    workflowId: { type: 'string', description: 'ID of the target workflow' },
    isDeployed: {
      type: 'boolean',
      description: 'Whether the workflow is deployed after the operation',
      condition: {
        field: 'operation',
        value: ['deployments_deploy', 'deployments_undeploy', 'deployments_promote'],
      },
    },
    deployedAt: {
      type: 'string',
      description: 'ISO 8601 timestamp of the active deployment; null after an undeploy',
      condition: {
        field: 'operation',
        value: ['deployments_deploy', 'deployments_undeploy', 'deployments_promote'],
      },
    },
    version: {
      type: 'number',
      description: 'The deployment version number',
      condition: {
        field: 'operation',
        value: ['deployments_deploy', 'deployments_promote', 'deployments_get_version'],
      },
    },
    warnings: {
      type: 'array',
      description: 'Non-fatal warnings (e.g. trigger or schedule sync still in progress)',
      condition: {
        field: 'operation',
        value: ['deployments_deploy', 'deployments_undeploy', 'deployments_promote'],
      },
    },
    versions: {
      type: 'json',
      description:
        'Deployment versions, newest first (id, version, name, description, isActive, createdAt, createdBy, deployedByName)',
      condition: { field: 'operation', value: 'deployments_list_versions' },
    },
    name: {
      type: 'string',
      description: 'Version label',
      condition: { field: 'operation', value: 'deployments_get_version' },
    },
    description: {
      type: 'string',
      description: 'Version description',
      condition: { field: 'operation', value: 'deployments_get_version' },
    },
    isActive: {
      type: 'boolean',
      description: 'Whether this version is currently live',
      condition: { field: 'operation', value: 'deployments_get_version' },
    },
    createdAt: {
      type: 'string',
      description: 'When this version was deployed (ISO 8601)',
      condition: { field: 'operation', value: 'deployments_get_version' },
    },
    deployedState: {
      type: 'json',
      description: 'The full workflow state snapshot (blocks, edges, loops, parallels, variables)',
      condition: { field: 'operation', value: 'deployments_get_version' },
    },
  },
}
