import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsListJournalsParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_retrieve_journals.html */
export const oracleEpmFccsListJournalsTool: InternalToolConfig<
  FccsListJournalsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_list_journals',
  name: 'Oracle EPM FCCS List Journals',
  description:
    'List one page of consolidation journal headers for a scenario, year, period, and status; journal lines are deferred.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    scenario: fccsParamFields.scenario,
    year: fccsParamFields.year,
    period: fccsParamFields.period,
    journalStatus: fccsParamFields.journalStatus,
    consolidation: { ...fccsParamFields.consolidation, required: false },
    group: { ...fccsParamFields.group, required: false },
    journalLabel: { ...fccsParamFields.journalLabel, required: false },
    description: { ...fccsParamFields.description, required: false },
    entity: { ...fccsParamFields.entity, required: false },
    offset: { ...fccsParamFields.offset, required: false },
    limit: { ...fccsParamFields.limit, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    totalResults: {
      type: 'number',
      description: 'Total matching journals',
    },
    hasMore: {
      type: 'boolean',
      description: 'More pages exist',
    },
    count: {
      type: 'number',
      description: 'Items in this page',
    },
    limit: {
      type: 'number',
      description: 'Page size',
    },
    offset: {
      type: 'number',
      description: 'Zero-based record offset',
    },
    items: {
      type: 'array',
      description: 'Journal headers (not journal line-item details)',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'label',
          },
          scenario: {
            type: 'string',
            description: 'scenario',
          },
          year: {
            type: 'string',
            description: 'year',
          },
          period: {
            type: 'string',
            description: 'period',
          },
          status: {
            type: 'string',
            description: 'status',
          },
          currency: {
            type: 'string',
            description: 'currency',
            optional: true,
            nullable: true,
          },
          createdOn: {
            type: 'string',
            description: 'createdOn',
            optional: true,
            nullable: true,
          },
          modifiedBy: {
            type: 'string',
            description: 'modifiedBy',
            optional: true,
            nullable: true,
          },
          journalType: {
            type: 'string',
            description: 'journalType',
            optional: true,
            nullable: true,
          },
          createdBy: {
            type: 'string',
            description: 'createdBy',
            optional: true,
            nullable: true,
          },
          balanceType: {
            type: 'string',
            description: 'balanceType',
            optional: true,
            nullable: true,
          },
          postedBy: {
            type: 'string',
            description: 'postedBy',
            optional: true,
            nullable: true,
          },
          description: {
            type: 'string',
            description: 'description',
            optional: true,
            nullable: true,
          },
          group: {
            type: 'string',
            description: 'group',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
