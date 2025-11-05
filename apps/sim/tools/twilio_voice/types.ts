import type { ToolResponse } from '@/tools/types'

export interface TwilioMakeCallParams {
  to: string
  from: string
  url?: string
  twiml?: string
  statusCallback?: string
  statusCallbackMethod?: 'GET' | 'POST'
  statusCallbackEvent?: string[]
  accountSid: string
  authToken: string
  record?: boolean
  recordingStatusCallback?: string
  recordingStatusCallbackMethod?: 'GET' | 'POST'
  timeout?: number
  machineDetection?: 'Enable' | 'DetectMessageEnd'
  asyncAmd?: boolean
  asyncAmdStatusCallback?: string
}

export interface TwilioCallOutput extends ToolResponse {
  output: {
    success: boolean
    callSid?: string
    status?: string
    direction?: string
    from?: string
    to?: string
    duration?: number
    price?: string
    priceUnit?: string
    error?: string
  }
}

export interface TwilioGetRecordingParams {
  recordingSid: string
  accountSid: string
  authToken: string
}

export interface TwilioGetRecordingOutput extends ToolResponse {
  output: {
    success: boolean
    recordingSid?: string
    callSid?: string
    duration?: number
    status?: string
    channels?: number
    source?: string
    mediaUrl?: string
    price?: string
    priceUnit?: string
    uri?: string
    transcriptionText?: string
    transcriptionStatus?: string
    transcriptionPrice?: string
    transcriptionPriceUnit?: string
    error?: string
  }
}

export interface TwilioListCallsParams {
  accountSid: string
  authToken: string
  to?: string
  from?: string
  status?: string
  startTimeAfter?: string
  startTimeBefore?: string
  pageSize?: number
}

export interface TwilioListCallsOutput extends ToolResponse {
  output: {
    success: boolean
    calls?: Array<{
      callSid: string
      from: string
      to: string
      status: string
      direction: string
      duration: number | null
      price: string | null
      priceUnit: string
      startTime: string
      endTime: string | null
      dateCreated: string
      recordingSids: string[]
    }>
    total?: number
    page?: number
    pageSize?: number
    error?: string
  }
}
