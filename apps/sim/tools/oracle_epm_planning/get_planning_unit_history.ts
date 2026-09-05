import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningGetPlanningUnitHistoryParams,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_planning_unit_history_and_annotations.html */
export const oracleEpmPlanningGetPlanningUnitHistoryTool: InternalToolConfig<
  OracleEpmPlanningGetPlanningUnitHistoryParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_get_planning_unit_history',
  name: 'Oracle EPM Planning Get Planning Unit History',
  description: 'Read a bounded page of history and annotations for an owned planning unit. Any application user can read their own units; use sequence identifiers to request replies explicitly.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    puIdentifier: { ...oracleEpmPlanningParamFields.puIdentifier, required: true },
    annotSeq: { ...oracleEpmPlanningParamFields.annotSeq, required: false },
    logSeq: { ...oracleEpmPlanningParamFields.logSeq, required: false },
    offset: { ...oracleEpmPlanningParamFields.offset, required: false },
    limit: { ...oracleEpmPlanningParamFields.limit, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    planningUnitHistory: {
      type: 'array',
      description: 'One page of owned-unit history and annotations',
      items: {
        type: 'object',
        properties: {
          comment: {
            type: 'string',
            description: 'comment',
          },
          authorImagePath: {
            type: 'string',
            description: 'authorImagePath',
          },
          commentTitle: {
            type: 'string',
            description: 'commentTitle',
          },
          commentDate: {
            type: 'string',
            description: 'commentDate',
          },
          commentSubTitle: {
            type: 'string',
            description: 'commentSubTitle',
          },
          hasHistory: {
            type: 'boolean',
            description: 'hasHistory',
          },
          staticImage: {
            type: 'boolean',
            description: 'staticImage',
          },
          isChildNode: {
            type: 'boolean',
            description: 'isChildNode',
          },
          logSeq: {
            type: 'number',
            description: 'logSeq',
          },
          parentAnntSeq: {
            type: 'number',
            description: 'parentAnntSeq',
          },
          type: {
            type: 'string',
            description: 'Oracle history type',
            optional: true,
          },
        },
      },
    },
  },
}
