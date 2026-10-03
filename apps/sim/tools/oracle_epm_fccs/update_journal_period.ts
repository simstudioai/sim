import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsResponse, FccsUpdateJournalPeriodParams } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_perform_journal_update.html */
export const oracleEpmFccsUpdateJournalPeriodTool: InternalToolConfig<
  FccsUpdateJournalPeriodParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_update_journal_period',
  name: 'Oracle EPM FCCS Update Journal Period',
  description:
    'Open or close a consolidation journal period, accepting the two documented response alternatives.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    scenario: fccsParamFields.scenario,
    year: fccsParamFields.year,
    period: fccsParamFields.period,
    periodAction: fccsParamFields.periodAction,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    scenario: {
      type: 'string',
      description: 'Requested scenario',
    },
    year: {
      type: 'string',
      description: 'Requested year',
    },
    period: {
      type: 'string',
      description: 'Requested period',
    },
    action: {
      type: 'string',
      description: 'Requested action',
    },
    actionStatus: {
      type: 'number',
      description: 'Oracle action status, only in the documented status response variant',
      optional: true,
    },
    actionDetail: {
      type: 'string',
      description: 'Oracle action detail, when present',
      optional: true,
    },
  },
}
