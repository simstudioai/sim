import type { ToolOutputProperty } from '@/tools/types'

export const resourceOutputs = {
  id: {
    type: 'string',
    description: 'Id',
    optional: true,
  },
  projectId: {
    type: 'string',
    description: 'Project id',
    optional: true,
  },
  compartmentId: {
    type: 'string',
    description: 'Compartment id',
    optional: true,
  },
  buildPipelineId: {
    type: 'string',
    description: 'Build pipeline id',
    optional: true,
  },
  buildPipelineStageId: {
    type: 'string',
    description: 'Build pipeline stage id',
    optional: true,
  },
  deployPipelineId: {
    type: 'string',
    description: 'Deploy pipeline id',
    optional: true,
  },
  deployStageId: {
    type: 'string',
    description: 'Deploy stage id',
    optional: true,
  },
  repositoryId: {
    type: 'string',
    description: 'Repository id',
    optional: true,
  },
  name: {
    type: 'string',
    description: 'Name',
    optional: true,
  },
  displayName: {
    type: 'string',
    description: 'Display name',
    optional: true,
  },
  description: {
    type: 'string',
    description: 'Description',
    optional: true,
  },
  lifecycleState: {
    type: 'string',
    description: 'Lifecycle state',
    optional: true,
  },
  timeCreated: {
    type: 'string',
    description: 'Time created',
    optional: true,
  },
  timeUpdated: {
    type: 'string',
    description: 'Time updated',
    optional: true,
  },
  timeStarted: {
    type: 'string',
    description: 'Time started',
    optional: true,
  },
  timeFinished: {
    type: 'string',
    description: 'Time finished',
    optional: true,
  },
  timeAccepted: {
    type: 'string',
    description: 'Time accepted',
    optional: true,
  },
  buildPipelineStageType: {
    type: 'string',
    description: 'Build pipeline stage type',
    optional: true,
  },
  deployStageType: {
    type: 'string',
    description: 'Deploy stage type',
    optional: true,
  },
  deployEnvironmentType: {
    type: 'string',
    description: 'Deploy environment type',
    optional: true,
  },
  deployArtifactType: {
    type: 'string',
    description: 'Deploy artifact type',
    optional: true,
  },
  connectionType: {
    type: 'string',
    description: 'Connection type',
    optional: true,
  },
  triggerSource: {
    type: 'string',
    description: 'Trigger source',
    optional: true,
  },
  deploymentType: {
    type: 'string',
    description: 'Deployment type',
    optional: true,
  },
  repositoryType: {
    type: 'string',
    description: 'Repository type',
    optional: true,
  },
  defaultBranch: {
    type: 'string',
    description: 'Default branch',
    optional: true,
  },
  refName: {
    type: 'string',
    description: 'Ref name',
    optional: true,
  },
  fullRefName: {
    type: 'string',
    description: 'Full ref name',
    optional: true,
  },
  refType: {
    type: 'string',
    description: 'Ref type',
    optional: true,
  },
  commitId: {
    type: 'string',
    description: 'Commit id',
    optional: true,
  },
  commitMessage: {
    type: 'string',
    description: 'Commit message',
    optional: true,
  },
  authorName: {
    type: 'string',
    description: 'Author name',
    optional: true,
  },
  treeId: {
    type: 'string',
    description: 'Tree id',
    optional: true,
  },
  operationType: {
    type: 'string',
    description: 'Operation type',
    optional: true,
  },
  status: {
    type: 'string',
    description: 'Status',
    optional: true,
  },
  code: {
    type: 'string',
    description: 'Code',
    optional: true,
  },
  timestamp: {
    type: 'string',
    description: 'Timestamp',
    optional: true,
  },
  functionId: {
    type: 'string',
    description: 'Function id',
    optional: true,
  },
  clusterId: {
    type: 'string',
    description: 'Cluster id',
    optional: true,
  },
  namespace: {
    type: 'string',
    description: 'Namespace',
    optional: true,
  },
  releaseName: {
    type: 'string',
    description: 'Release name',
    optional: true,
  },
  functionDeployEnvironmentId: {
    type: 'string',
    description: 'Function deploy environment id',
    optional: true,
  },
  dockerImageDeployArtifactId: {
    type: 'string',
    description: 'Docker image deploy artifact id',
    optional: true,
  },
  okeClusterDeployEnvironmentId: {
    type: 'string',
    description: 'Oke cluster deploy environment id',
    optional: true,
  },
  helmChartDeployArtifactId: {
    type: 'string',
    description: 'Helm chart deploy artifact id',
    optional: true,
  },
  computeInstanceGroupDeployEnvironmentId: {
    type: 'string',
    description: 'Compute instance group deploy environment id',
    optional: true,
  },
  deploymentSpecDeployArtifactId: {
    type: 'string',
    description: 'Deployment spec deploy artifact id',
    optional: true,
  },
  commandSpecDeployArtifactId: {
    type: 'string',
    description: 'Command spec deploy artifact id',
    optional: true,
  },
  deployEnvironmentIdA: {
    type: 'string',
    description: 'Deploy environment id a',
    optional: true,
  },
  deployEnvironmentIdB: {
    type: 'string',
    description: 'Deploy environment id b',
    optional: true,
  },
  argumentSubstitutionMode: {
    type: 'string',
    description: 'Argument substitution mode',
    optional: true,
  },
  deployArtifactId: {
    type: 'string',
    description: 'Deploy artifact id',
    optional: true,
  },
  previousDeploymentId: {
    type: 'string',
    description: 'Previous deployment id',
    optional: true,
  },
  path: {
    type: 'string',
    description: 'Path',
    optional: true,
  },
  percentComplete: {
    type: 'number',
    description: 'Work request completion percentage',
    optional: true,
  },
  terminal: {
    type: 'boolean',
    description: 'Whether this execution reached a known terminal state',
  },
  succeeded: {
    type: 'boolean',
    description: 'Execution outcome; null while pending or unknown',
    optional: true,
  },
  type: {
    type: 'string',
    description: 'File or directory type',
    optional: true,
  },
  sha: {
    type: 'string',
    description: 'Blob or tree SHA',
    optional: true,
  },
  objectId: {
    type: 'string',
    description: 'Object SHA referenced by a repository tag',
    optional: true,
  },
  branchCount: { type: 'number', description: 'Requested repository branch count', optional: true },
  commitCount: { type: 'number', description: 'Requested repository commit count', optional: true },
  sizeInBytes: {
    type: 'number',
    description: 'File or directory size',
    optional: true,
  },
  buildPipelineStagePredecessorCollection: {
    type: 'object',
    description: 'Stage predecessor references',
    properties: {
      items: {
        type: 'array',
        description: 'Predecessors',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Predecessor OCID',
              optional: true,
            },
          },
        },
        optional: true,
      },
    },
    optional: true,
  },
  deployStagePredecessorCollection: {
    type: 'object',
    description: 'Stage predecessor references',
    properties: {
      items: {
        type: 'array',
        description: 'Predecessors',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Predecessor OCID',
              optional: true,
            },
          },
        },
        optional: true,
      },
    },
    optional: true,
  },
  buildPipelineParameters: {
    type: 'object',
    description: 'Parameter names; values omitted',
    properties: {
      items: {
        type: 'array',
        description: 'Parameters',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Parameter name',
              optional: true,
            },
            description: {
              type: 'string',
              description: 'Parameter description',
              optional: true,
            },
          },
        },
        optional: true,
      },
    },
    optional: true,
  },
  deployPipelineParameters: {
    type: 'object',
    description: 'Parameter names; values omitted',
    properties: {
      items: {
        type: 'array',
        description: 'Parameters',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Parameter name',
              optional: true,
            },
            description: {
              type: 'string',
              description: 'Parameter description',
              optional: true,
            },
          },
        },
        optional: true,
      },
    },
    optional: true,
  },
  lastConnectionValidationResult: {
    type: 'object',
    description: 'Connection credential validation status; message omitted',
    properties: {
      result: {
        type: 'string',
        description: 'PASS or FAIL',
        optional: true,
      },
      timeValidated: {
        type: 'string',
        description: 'Validation time',
        optional: true,
      },
    },
    optional: true,
  },
  buildRunProgress: {
    type: 'object',
    description: 'Bounded stage execution status; logs and argument values omitted',
    properties: {
      buildPipelineStageRunProgress: {
        type: 'object',
        description:
          'At most 100 stage OCIDs mapped to stage IDs, types, names, status, timestamps, and predecessor references',
        optional: true,
      },
      timeStarted: {
        type: 'string',
        description: 'Execution start time',
        optional: true,
      },
      timeFinished: {
        type: 'string',
        description: 'Execution finish time',
        optional: true,
      },
    },
    optional: true,
  },
  deploymentExecutionProgress: {
    type: 'object',
    description: 'Bounded stage execution status; logs and argument values omitted',
    properties: {
      deployStageExecutionProgress: {
        type: 'object',
        description:
          'At most 100 stage OCIDs mapped to stage IDs, types, names, status, timestamps, and predecessor references',
        optional: true,
      },
      timeStarted: {
        type: 'string',
        description: 'Execution start time',
        optional: true,
      },
      timeFinished: {
        type: 'string',
        description: 'Execution finish time',
        optional: true,
      },
    },
    optional: true,
  },
  deployArtifactSource: {
    type: 'object',
    description: 'Artifact reference metadata; inline bodies and URLs omitted',
    properties: {
      deployArtifactSourceType: {
        type: 'string',
        description: 'deployArtifactSourceType',
        optional: true,
      },
      repositoryId: {
        type: 'string',
        description: 'repositoryId',
        optional: true,
      },
      deployArtifactPath: {
        type: 'string',
        description: 'deployArtifactPath',
        optional: true,
      },
      deployArtifactVersion: {
        type: 'string',
        description: 'deployArtifactVersion',
        optional: true,
      },
    },
    optional: true,
  },
  parentCommitIds: {
    type: 'array',
    description: 'Parent commit IDs',
    items: {
      type: 'string',
    },
    optional: true,
  },
  resources: {
    type: 'array',
    description: 'Resources affected by a configuration work request',
    items: {
      type: 'object',
      properties: {
        actionType: {
          type: 'string',
          description: 'actionType',
          optional: true,
        },
        entityType: {
          type: 'string',
          description: 'entityType',
          optional: true,
        },
        identifier: {
          type: 'string',
          description: 'identifier',
          optional: true,
        },
      },
    },
    optional: true,
  },
} satisfies Record<string, ToolOutputProperty>

export const ociDevopsOutputs = {
  resource: {
    type: 'json',
    description:
      'Resource identity, configuration references, and lifecycle status; sensitive values are omitted',
    properties: resourceOutputs,
    optional: true,
  },
  items: {
    type: 'array',
    description: 'One page of resource summaries',
    items: { type: 'object', properties: resourceOutputs },
    optional: true,
  },
  nextPage: { type: 'string', description: 'Opaque token for the next page', optional: true },
  etag: {
    type: 'string',
    description: 'ETag for a subsequent conditional mutation',
    optional: true,
  },
  requestId: { type: 'string', description: 'OCI request identifier', optional: true },
  workRequestId: {
    type: 'string',
    description: 'Asynchronous configuration work request ID',
    optional: true,
  },
  accepted: {
    type: 'boolean',
    description: 'OCI accepted the mutation; this does not imply execution success',
  },
  retryAfterSeconds: {
    type: 'number',
    description: 'Bounded suggested delay before another status read',
    optional: true,
  },
} satisfies Record<string, ToolOutputProperty>
