import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  FccsGenerateIntercompanyReportParams,
  FccsResponse,
} from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_generate_ic_report.html */
export const oracleEpmFccsGenerateIntercompanyReportTool: InternalToolConfig<
  FccsGenerateIntercompanyReportParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_generate_intercompany_report',
  name: 'Oracle EPM FCCS Generate Intercompany Report',
  description:
    'Submit an existing intercompany matching report with optional point-of-view and output overrides.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobName: fccsParamFields.jobName,
    scenario: { ...fccsParamFields.scenario, required: false },
    year: { ...fccsParamFields.year, required: false },
    period: { ...fccsParamFields.period, required: false },
    reportFormat: { ...fccsParamFields.reportFormat, required: false },
    fileName: { ...fccsParamFields.fileName, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
