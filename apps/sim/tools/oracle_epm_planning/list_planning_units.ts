import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningListPlanningUnitsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_all_planning_units.html */
export const oracleEpmPlanningListPlanningUnitsTool: InternalToolConfig<
  OracleEpmPlanningListPlanningUnitsParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_list_planning_units',
  name: 'Oracle EPM Planning List Planning Units',
  description:
    'Read one page of planning units owned by the requesting Service Administrator for a scenario and version. This is not discovery of every user’s units; no completion flag is documented.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    scenario: { ...oracleEpmPlanningParamFields.scenario, required: true },
    planningVersion: { ...oracleEpmPlanningParamFields.planningVersion, required: true },
    offset: { ...oracleEpmPlanningParamFields.offset, required: false },
    limit: { ...oracleEpmPlanningParamFields.limit, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    planningUnits: {
      type: 'array',
      description: 'One page of owned planning units; numeric puId is not a compound identifier',
      items: {
        type: 'object',
        properties: {
          owner: {
            type: 'string',
            description: 'owner',
          },
          version: {
            type: 'string',
            description: 'version',
          },
          entity: {
            type: 'string',
            description: 'entity',
          },
          status: {
            type: 'string',
            description: 'status',
          },
          scenario: {
            type: 'string',
            description: 'scenario',
          },
          formattedValue: {
            type: 'string',
            description: 'formattedValue',
          },
          puName: {
            type: 'string',
            description: 'puName',
          },
          subStatus: {
            type: 'string',
            description: 'subStatus',
          },
          puAlias: {
            type: 'string',
            description: 'puAlias',
          },
          name: {
            type: 'string',
            description: 'name',
            nullable: true,
          },
          secMember: {
            type: 'string',
            description: 'secMember',
            nullable: true,
          },
          scenarioAlias: {
            type: 'string',
            description: 'scenarioAlias',
            nullable: true,
          },
          versionAlias: {
            type: 'string',
            description: 'versionAlias',
            nullable: true,
          },
          value: {
            type: 'number',
            description: 'Planning unit value',
          },
          puId: {
            type: 'number',
            description: 'Numeric unit ID, not the compound REST path identifier',
          },
        },
      },
    },
  },
}
