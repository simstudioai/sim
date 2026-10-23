import type { Ec2DeleteSnapshotParams, Ec2DeleteSnapshotResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const deleteSnapshotTool: InternalToolConfig<
  Ec2DeleteSnapshotParams,
  Ec2DeleteSnapshotResponse
> = {
  id: 'ec2_delete_snapshot',
  name: 'EC2 Delete Snapshot',
  description: 'Permanently delete an EBS snapshot',
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
    snapshotId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the EBS snapshot to delete (e.g., snap-0abc123)',
    },
  },

  operation: {
    input: (params) => ({
      ...ec2ConnectionInput(params),
      ...suppliedParams({
        snapshotId: params.snapshotId,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to run EC2 Delete Snapshot')
    }

    return {
      success: true,
      output: {
        deleted: data.deleted ?? false,
        snapshotId: data.snapshotId ?? '',
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the snapshot was deleted',
    },
    snapshotId: {
      type: 'string',
      description: 'Snapshot ID that was deleted',
    },
  },
}
