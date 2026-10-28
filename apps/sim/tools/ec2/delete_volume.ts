import type { Ec2DeleteVolumeParams, Ec2DeleteVolumeResponse } from '@/tools/ec2/types'
import { ec2ConnectionInput, suppliedParams } from '@/tools/ec2/utils'
import type { InternalToolConfig } from '@/tools/types'

export const deleteVolumeTool: InternalToolConfig<Ec2DeleteVolumeParams, Ec2DeleteVolumeResponse> =
  {
    id: 'ec2_delete_volume',
    name: 'EC2 Delete Volume',
    description: 'Permanently delete an EBS volume that is not attached to an instance',
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
        description: 'ID of the EBS volume to delete (e.g., vol-0abc123)',
      },
    },

    operation: {
      input: (params) => ({
        ...ec2ConnectionInput(params),
        ...suppliedParams({
          volumeId: params.volumeId,
        }),
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to run EC2 Delete Volume')
      }

      return {
        success: true,
        output: {
          deleted: data.deleted ?? false,
          volumeId: data.volumeId ?? '',
        },
      }
    },

    outputs: {
      deleted: {
        type: 'boolean',
        description: 'Whether the volume deletion was accepted',
      },
      volumeId: {
        type: 'string',
        description: 'Volume ID that was deleted',
      },
    },
  }
