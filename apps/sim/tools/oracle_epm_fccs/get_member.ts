import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsGetMemberParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_member.html */
export const oracleEpmFccsGetMemberTool: InternalToolConfig<FccsGetMemberParams, FccsResponse> = {
  id: 'oracle_epm_fccs_get_member',
  name: 'Oracle EPM FCCS Get Member',
  description:
    'Read documented properties of one dimension member; does not invent the undocumented children structure.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    dimension: fccsParamFields.dimension,
    member: fccsParamFields.member,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    name: {
      type: 'string',
      description: 'Member name',
    },
    description: {
      type: 'string',
      description: 'description',
      optional: true,
      nullable: true,
    },
    parentName: {
      type: 'string',
      description: 'parentName',
      optional: true,
      nullable: true,
    },
    dataType: {
      type: 'string',
      description: 'dataType',
      optional: true,
      nullable: true,
    },
    dataStorage: {
      type: 'string',
      description: 'dataStorage',
      optional: true,
      nullable: true,
    },
    dimName: {
      type: 'string',
      description: 'dimName',
      optional: true,
      nullable: true,
    },
    objectType: {
      type: 'number',
      description: 'Oracle object type code',
      optional: true,
    },
    twoPass: {
      type: 'boolean',
      description: 'Two-pass calculation attribute',
      optional: true,
    },
  },
}
