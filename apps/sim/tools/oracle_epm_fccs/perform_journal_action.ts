import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsPerformJournalActionParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_perform_journal_actions.html */
export const oracleEpmFccsPerformJournalActionTool: InternalToolConfig<
  FccsPerformJournalActionParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_perform_journal_action',
  name: 'Oracle EPM FCCS Perform Journal Action',
  description:
    'Submit, approve, post, unpost, or reject an existing consolidation journal within the selected point of view.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    journalLabel: fccsParamFields.journalLabel,
    scenario: fccsParamFields.scenario,
    year: fccsParamFields.year,
    period: fccsParamFields.period,
    journalAction: fccsParamFields.journalAction,
    consolidation: { ...fccsParamFields.consolidation, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    actionStatus: {
      type: 'number',
      description: 'Oracle action status; 0 means success',
    },
    actionDetail: {
      type: 'string',
      description: 'Oracle action detail',
    },
  },
}
