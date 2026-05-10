import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListStackResourcesSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
})

const ListStackResourcesResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    resources: z.array(
      z.object({
        logicalResourceId: z.string(),
        physicalResourceId: z.string().optional(),
        resourceType: z.string(),
        resourceStatus: z.string(),
        resourceStatusReason: z.string().optional(),
        lastUpdatedTimestamp: z.number().optional(),
        driftInformation: z
          .object({
            stackResourceDriftStatus: z.string().optional(),
            lastCheckTimestamp: z.number().optional(),
          })
          .nullable(),
      })
    ),
  }),
})

export const awsCloudformationListStackResourcesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudformation/list-stack-resources',
  body: ListStackResourcesSchema,
  response: { mode: 'json', schema: ListStackResourcesResponseSchema },
})
export type AwsCloudformationListStackResourcesRequest = ContractBodyInput<
  typeof awsCloudformationListStackResourcesContract
>
export type AwsCloudformationListStackResourcesBody = ContractBody<
  typeof awsCloudformationListStackResourcesContract
>
export type AwsCloudformationListStackResourcesResponse = ContractJsonResponse<
  typeof awsCloudformationListStackResourcesContract
>
