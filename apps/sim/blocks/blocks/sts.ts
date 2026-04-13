import { STSIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { STSBaseResponse } from '@/tools/sts/types'

export const STSBlock: BlockConfig<STSBaseResponse> = {
  type: 'sts',
  name: 'AWS STS',
  description: 'Connect to AWS Security Token Service',
  longDescription:
    'Integrate AWS STS into the workflow. Assume roles, get temporary credentials, verify caller identity, and look up access key information.',
  docsLink: 'https://docs.sim.ai/tools/sts',
  category: 'tools',
  integrationType: IntegrationType.Security,
  tags: ['cloud'],
  authMode: AuthMode.ApiKey,
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: STSIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Assume Role', id: 'assume_role' },
        { label: 'Get Caller Identity', id: 'get_caller_identity' },
        { label: 'Get Session Token', id: 'get_session_token' },
        { label: 'Get Access Key Info', id: 'get_access_key_info' },
      ],
      value: () => 'assume_role',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'roleArn',
      title: 'Role ARN',
      type: 'short-input',
      placeholder: 'arn:aws:iam::123456789012:role/MyRole',
      condition: { field: 'operation', value: 'assume_role' },
      required: { field: 'operation', value: 'assume_role' },
    },
    {
      id: 'roleSessionName',
      title: 'Session Name',
      type: 'short-input',
      placeholder: 'my-session',
      condition: { field: 'operation', value: 'assume_role' },
      required: { field: 'operation', value: 'assume_role' },
    },
    {
      id: 'durationSeconds',
      title: 'Duration (Seconds)',
      type: 'short-input',
      placeholder: '3600',
      condition: { field: 'operation', value: ['assume_role', 'get_session_token'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External ID for cross-account access',
      condition: { field: 'operation', value: 'assume_role' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'serialNumber',
      title: 'MFA Serial Number',
      type: 'short-input',
      placeholder: 'arn:aws:iam::123456789012:mfa/user',
      condition: { field: 'operation', value: ['assume_role', 'get_session_token'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'tokenCode',
      title: 'MFA Token Code',
      type: 'short-input',
      placeholder: '123456',
      condition: { field: 'operation', value: ['assume_role', 'get_session_token'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'targetAccessKeyId',
      title: 'Target Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      condition: { field: 'operation', value: 'get_access_key_info' },
      required: { field: 'operation', value: 'get_access_key_info' },
    },
  ],
  tools: {
    access: [
      'sts_assume_role',
      'sts_get_caller_identity',
      'sts_get_session_token',
      'sts_get_access_key_info',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'assume_role':
            return 'sts_assume_role'
          case 'get_caller_identity':
            return 'sts_get_caller_identity'
          case 'get_session_token':
            return 'sts_get_session_token'
          case 'get_access_key_info':
            return 'sts_get_access_key_info'
          default:
            throw new Error(`Invalid STS operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, durationSeconds, ...rest } = params

        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        const result: Record<string, unknown> = { ...connectionConfig }

        switch (operation) {
          case 'assume_role':
            result.roleArn = rest.roleArn
            result.roleSessionName = rest.roleSessionName
            if (durationSeconds) {
              const parsed = Number.parseInt(String(durationSeconds), 10)
              if (!Number.isNaN(parsed)) result.durationSeconds = parsed
            }
            if (rest.externalId) result.externalId = rest.externalId
            if (rest.serialNumber) result.serialNumber = rest.serialNumber
            if (rest.tokenCode) result.tokenCode = rest.tokenCode
            break
          case 'get_caller_identity':
            break
          case 'get_session_token':
            if (durationSeconds) {
              const parsed = Number.parseInt(String(durationSeconds), 10)
              if (!Number.isNaN(parsed)) result.durationSeconds = parsed
            }
            if (rest.serialNumber) result.serialNumber = rest.serialNumber
            if (rest.tokenCode) result.tokenCode = rest.tokenCode
            break
          case 'get_access_key_info':
            result.targetAccessKeyId = rest.targetAccessKeyId
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'STS operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    roleArn: { type: 'string', description: 'ARN of the role to assume' },
    roleSessionName: { type: 'string', description: 'Session name for the assumed role' },
    durationSeconds: { type: 'number', description: 'Session duration in seconds' },
    externalId: { type: 'string', description: 'External ID for cross-account access' },
    serialNumber: { type: 'string', description: 'MFA device serial number' },
    tokenCode: { type: 'string', description: 'MFA token code' },
    targetAccessKeyId: { type: 'string', description: 'Access key ID to look up' },
  },
  outputs: {
    accessKeyId: {
      type: 'string',
      description: 'Temporary access key ID',
    },
    secretAccessKey: {
      type: 'string',
      description: 'Temporary secret access key',
    },
    sessionToken: {
      type: 'string',
      description: 'Temporary session token',
    },
    expiration: {
      type: 'string',
      description: 'Credential expiration timestamp',
    },
    assumedRoleArn: {
      type: 'string',
      description: 'ARN of the assumed role',
    },
    assumedRoleId: {
      type: 'string',
      description: 'Assumed role ID with session name',
    },
    account: {
      type: 'string',
      description: 'AWS account ID',
    },
    arn: {
      type: 'string',
      description: 'ARN of the calling entity',
    },
    userId: {
      type: 'string',
      description: 'Unique identifier of the calling entity',
    },
    packedPolicySize: {
      type: 'number',
      description: 'Percentage of allowed policy size used',
    },
  },
}
