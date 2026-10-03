import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsAddMemberParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/add_member.html */
export const oracleEpmFccsAddMemberTool: InternalToolConfig<FccsAddMemberParams, FccsResponse> = {
  id: 'oracle_epm_fccs_add_member',
  name: 'Oracle EPM FCCS Add Member',
  description: 'Create a member beneath a parent enabled for dynamic children.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    dimension: fccsParamFields.dimension,
    member: fccsParamFields.member,
    parentName: fccsParamFields.parentName,
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
