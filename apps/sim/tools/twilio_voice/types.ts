import type { ToolResponse } from '@/tools/types'

// Voice Call Types
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

export interface TwilioSendTwimlParams {
  callSid: string
  url?: string
  twiml?: string
  method?: 'GET' | 'POST'
  accountSid: string
  authToken: string
}

export interface TwilioTwimlOutput extends ToolResponse {
  output: {
    success: boolean
    callSid?: string
    status?: string
    error?: string
  }
}

export interface TwilioHangupCallParams {
  callSid: string
  accountSid: string
  authToken: string
}

export interface TwilioHangupOutput extends ToolResponse {
  output: {
    success: boolean
    callSid?: string
    status?: string
    error?: string
  }
}

export interface TwilioRecordCallParams {
  callSid: string
  accountSid: string
  authToken: string
  recordingStatusCallback?: string
  recordingStatusCallbackMethod?: 'GET' | 'POST'
  recordingChannels?: 'mono' | 'dual'
  trim?: 'trim-silence' | 'do-not-trim'
}

export interface TwilioRecordingOutput extends ToolResponse {
  output: {
    success: boolean
    callSid?: string
    recordingSid?: string
    status?: string
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
    error?: string
  }
}

