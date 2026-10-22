import {
  EC2_TAGS_OUTPUT,
  type Ec2CreateSnapshotParams,
  type Ec2CreateSnapshotResponse,
} from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const createSnapshotTool: InternalToolConfig<
  Ec2CreateSnapshotParams,
  Ec2CreateSnapshotResponse
> = {
  id: 'ec2_create_snapshot',
  name: 'EC2 Create Snapshot',
  description: 'Create a point-in-time snapshot of an EBS volume',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    volumeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the EBS volume to snapshot (e.g., vol-0abc123)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the snapshot',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags to apply as a JSON object, e.g. {"Name":"nightly-backup"}',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        volumeId: params.volumeId,
        description: params.description,
        tags: params.tags,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Create Snapshot')
    }

    return {
      success: true,
      output: {
        snapshotId: data.snapshotId ?? '',
        volumeId: data.volumeId ?? '',
        volumeSize: data.volumeSize ?? null,
        state: data.state ?? null,
        startTime: data.startTime ?? null,
        description: data.description ?? null,
        encrypted: data.encrypted ?? false,
        ownerId: data.ownerId ?? null,
        tags: data.tags ?? {},
      },
    }
  },

  outputs: {
    snapshotId: {
      type: 'string',
      description: 'ID of the new snapshot',
    },
    volumeId: {
      type: 'string',
      description: 'Source volume ID',
    },
    volumeSize: {
      type: 'number',
      description: 'Source volume size in GiB',
      nullable: true,
    },
    state: {
      type: 'string',
      description: 'Snapshot state (pending until complete)',
      nullable: true,
    },
    startTime: {
      type: 'string',
      description: 'Start time (ISO 8601)',
      nullable: true,
    },
    description: {
      type: 'string',
      description: 'Description',
      nullable: true,
    },
    encrypted: {
      type: 'boolean',
      description: 'Whether the snapshot is encrypted',
    },
    ownerId: {
      type: 'string',
      description: 'Owning AWS account ID',
      nullable: true,
    },
    tags: EC2_TAGS_OUTPUT,
  },
}
