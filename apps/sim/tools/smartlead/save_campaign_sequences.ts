import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SmartleadCampaignIdParams,
  SmartleadSaveSequencesResponse,
} from '@/tools/smartlead/types'
import {
  isOk,
  mapSavedSequence,
  pathSegment,
  saveSequencesOutputs,
  smartleadBaseParamFields,
  smartleadCampaignIdParamField,
  smartleadHeaders,
  smartleadRecord,
  smartleadUrl,
} from '@/tools/smartlead/utils'
import type { ToolConfig } from '@/tools/types'

interface SaveCampaignSequencesParams extends SmartleadCampaignIdParams {
  sequences: unknown[]
}

/**
 * Smartlead expects the delay nested as `seq_delay_details.delay_in_days`, but the
 * value is far easier for a model to supply flat. This accepts either form.
 */
function toSequencePayload(value: unknown, index: number): Record<string, unknown> {
  const record = isRecordLike(value) ? value : {}
  const existingDelay = isRecordLike(record.seq_delay_details) ? record.seq_delay_details : null
  const delayInDays =
    existingDelay?.delay_in_days ??
    existingDelay?.delayInDays ??
    record.delay_in_days ??
    record.delayInDays ??
    1

  const payload: Record<string, unknown> = {
    seq_number: record.seq_number ?? index + 1,
    seq_delay_details: { delay_in_days: Number(delayInDays) || 1 },
    subject: typeof record.subject === 'string' ? record.subject : '',
    email_body: typeof record.email_body === 'string' ? record.email_body : '',
  }

  if (record.id !== undefined) payload.id = record.id
  if (record.variant_label !== undefined) payload.variant_label = record.variant_label
  if (record.sequence_variants !== undefined) {
    payload.sequence_variants = record.sequence_variants
  }
  if (record.variant_distribution_type !== undefined) {
    payload.variant_distribution_type = record.variant_distribution_type
  }

  return payload
}

export const saveCampaignSequencesTool: ToolConfig<
  SaveCampaignSequencesParams,
  SmartleadSaveSequencesResponse
> = {
  id: 'smartlead_save_campaign_sequences',
  name: 'Smartlead Save Campaign Sequences',
  description:
    'Replaces the email sequence for a Smartlead campaign. Send every step in one call — steps omitted from the request are removed. An empty subject makes a step reply in the previous thread.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SMARTLEAD_ERRORS,
  params: {
    ...smartleadBaseParamFields,
    ...smartleadCampaignIdParamField,
    sequences: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Ordered sequence steps. Each entry accepts seq_number, delay_in_days, subject, and email_body (HTML). Personalize with {{first_name}} or {{company_name}}.',
      items: { type: 'object' },
    },
  },
  request: {
    url: (params) =>
      smartleadUrl(`/campaigns/${pathSegment(params.campaignId)}/sequences`, params.apiKey),
    method: 'POST',
    headers: smartleadHeaders,
    body: (params) => ({
      sequences: (Array.isArray(params.sequences) ? params.sequences : []).map(toSequencePayload),
    }),
  },
  transformResponse: async (response) => {
    const record = await smartleadRecord(response, 'sequence save')
    const data = isRecordLike(record.data) ? record.data : {}
    const saved = Array.isArray(data.sequences) ? data.sequences : []
    const sequences = saved.map(mapSavedSequence)

    return {
      success: true,
      output: {
        success: isOk(record),
        sequences,
        count: sequences.length,
      },
    }
  },
  outputs: saveSequencesOutputs,
}
