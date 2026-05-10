import type { ToolResponse } from '@/tools/types'

export const MEET_API_BASE = 'https://meet.googleapis.com/v2'

interface BaseGoogleMeetParams {
  accessToken: string
}

export interface GoogleMeetCreateSpaceParams extends BaseGoogleMeetParams {
  accessType?: 'OPEN' | 'TRUSTED' | 'RESTRICTED'
  entryPointAccess?: 'ALL' | 'CREATOR_APP_ONLY'
}

export interface GoogleMeetGetSpaceParams extends BaseGoogleMeetParams {
  spaceName: string
}

export interface GoogleMeetEndConferenceParams extends BaseGoogleMeetParams {
  spaceName: string
}

export interface GoogleMeetListConferenceRecordsParams extends BaseGoogleMeetParams {
  filter?: string
  pageSize?: number
  pageToken?: string
}

export interface GoogleMeetGetConferenceRecordParams extends BaseGoogleMeetParams {
  conferenceName: string
}

export interface GoogleMeetListParticipantsParams extends BaseGoogleMeetParams {
  conferenceName: string
  filter?: string
  pageSize?: number
  pageToken?: string
}

export type GoogleMeetToolParams =
  | GoogleMeetCreateSpaceParams
  | GoogleMeetGetSpaceParams
  | GoogleMeetEndConferenceParams
  | GoogleMeetListConferenceRecordsParams
  | GoogleMeetGetConferenceRecordParams
  | GoogleMeetListParticipantsParams

export interface GoogleMeetApiSpaceResponse {
  name: string
  meetingUri: string
  meetingCode: string
  config?: {
    accessType?: string
    entryPointAccess?: string
  }
  activeConference?: {
    conferenceRecord: string
  }
}

export interface GoogleMeetApiConferenceRecordResponse {
  name: string
  startTime: string
  endTime?: string
  expireTime: string
  space: string
}

export interface GoogleMeetApiConferenceRecordListResponse {
  conferenceRecords: GoogleMeetApiConferenceRecordResponse[]
  nextPageToken?: string
}

export interface GoogleMeetApiParticipantResponse {
  name: string
  earliestStartTime: string
  latestEndTime?: string
  signedinUser?: {
    user: string
    displayName: string
  }
  anonymousUser?: {
    displayName: string
  }
  phoneUser?: {
    displayName: string
  }
}

export interface GoogleMeetApiParticipantListResponse {
  participants: GoogleMeetApiParticipantResponse[]
  nextPageToken?: string
  totalSize?: number
}

export interface GoogleMeetCreateSpaceResponse extends ToolResponse {
  output: {
    name: string
    meetingUri: string
    meetingCode: string
    accessType: string | null
    entryPointAccess: string | null
  }
}

export interface GoogleMeetGetSpaceResponse extends ToolResponse {
  output: {
    name: string
    meetingUri: string
    meetingCode: string
    accessType: string | null
    entryPointAccess: string | null
    activeConference: string | null
  }
}

export interface GoogleMeetEndConferenceResponse extends ToolResponse {
  output: {
    ended: boolean
  }
}

export interface GoogleMeetListConferenceRecordsResponse extends ToolResponse {
  output: {
    conferenceRecords: Array<{
      name: string
      startTime: string
      endTime: string | null
      expireTime: string
      space: string
    }>
    nextPageToken: string | null
  }
}

export interface GoogleMeetGetConferenceRecordResponse extends ToolResponse {
  output: {
    name: string
    startTime: string
    endTime: string | null
    expireTime: string
    space: string
  }
}

export interface GoogleMeetListParticipantsResponse extends ToolResponse {
  output: {
    participants: Array<{
      name: string
      earliestStartTime: string
      latestEndTime: string | null
      displayName: string | null
      userType: string
    }>
    nextPageToken: string | null
    totalSize: number | null
  }
}

export type GoogleMeetResponse =
  | GoogleMeetCreateSpaceResponse
  | GoogleMeetGetSpaceResponse
  | GoogleMeetEndConferenceResponse
  | GoogleMeetListConferenceRecordsResponse
  | GoogleMeetGetConferenceRecordResponse
  | GoogleMeetListParticipantsResponse
