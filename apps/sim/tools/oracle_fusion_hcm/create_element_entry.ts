import { common, internalExecution, elementEntryValueItems } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_CREATE_ELEMENT_ENTRY_OUTPUTS,
  type OracleFusionHcmCreateElementEntryParams,
  type OracleFusionHcmCreateElementEntryResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmCreateElementEntryTool: InternalToolConfig<
  OracleFusionHcmCreateElementEntryParams,
  OracleFusionHcmCreateElementEntryResponse
> = {
  id: 'oracle_fusion_hcm_create_element_entry',
  name: 'Create Element Entry in Oracle Fusion HCM',
  description: 'Create Element Entry using documented Oracle fields. Requires administrative privileges and valid tenant configuration.',
  ...internalExecution,
  params: {
    ...common,
    personId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person ID, as a positive decimal string',
    },
    assignmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HR assignment ID (not payroll assignment ID), as a positive decimal string',
    },
    elementTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Element type ID, as a positive decimal string',
    },
    elementName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the element matching elementTypeId',
    },
    creatorType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Oracle element-entry creator code supported by the tenant',
    },
    entryType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Oracle element-entry type code supported by the tenant',
    },
    effectiveStartDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Effective start date in YYYY-MM-DD format',
    },
    effectiveEndDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Effective end date in YYYY-MM-DD format',
    },
    entryValues: {
      type: 'array',
      items: elementEntryValueItems,
      minItems: 1,
      maxItems: 100,
      required: true,
      visibility: 'user-or-llm',
      description: 'Up to 100 typed objects: inputValueId (positive decimal string) and screenEntryValue (string up to 60 characters or null). Input IDs serialize exactly as JSON integers',
    },
  },
  outputs: ORACLE_FUSION_HCM_CREATE_ELEMENT_ENTRY_OUTPUTS,
}
