import type { ToolResponse } from '@/tools/types'

/** Base parameters shared by all Gong tools */
export interface GongBaseParams {
  accessKey: string
  accessKeySecret: string
}

/** List Calls */
export interface GongListCallsParams extends GongBaseParams {
  fromDateTime: string
  toDateTime?: string
  cursor?: string
  workspaceId?: string
}

export interface GongCallBasic {
  id: string
  title: string | null
  scheduled: string | null
  started: string
  duration: number
  direction: string | null
  system: string | null
  scope: string | null
  media: string | null
  language: string | null
  url: string | null
  primaryUserId: string | null
  workspaceId: string | null
  sdrDisposition: string | null
  clientUniqueId: string | null
  customData: string | null
  purpose: string | null
  meetingUrl: string | null
  isPrivate: boolean
  calendarEventId: string | null
}

export interface GongParty {
  id: string | null
  name: string | null
  emailAddress: string | null
  phoneNumber: string | null
  title: string | null
  speakerId: string | null
  userId: string | null
  affiliation: string | null
  methods: string[]
  context: { system: string; objects: Record<string, unknown>[] }[]
}

export interface GongListCallsResponse extends ToolResponse {
  output: {
    calls: GongCallBasic[]
    cursor: string | null
    totalRecords: number
  }
}

/** Get Call */
export interface GongGetCallParams extends GongBaseParams {
  callId: string
}

export interface GongGetCallResponse extends ToolResponse {
  output: GongCallBasic
}

/** Get Call Transcript */
export interface GongGetCallTranscriptParams extends GongBaseParams {
  callIds?: string
  fromDateTime?: string
  toDateTime?: string
  workspaceId?: string
  cursor?: string
}

export interface GongTranscriptSentence {
  start: number
  end: number
  text: string
}

export interface GongTranscriptEntry {
  speakerId: string | null
  topic: string | null
  sentences: GongTranscriptSentence[]
}

export interface GongCallTranscript {
  callId: string
  transcript: GongTranscriptEntry[]
}

export interface GongGetCallTranscriptResponse extends ToolResponse {
  output: {
    callTranscripts: GongCallTranscript[]
    cursor: string | null
  }
}

/** Get Extensive Calls */
export interface GongGetExtensiveCallsParams extends GongBaseParams {
  callIds?: string
  fromDateTime?: string
  toDateTime?: string
  workspaceId?: string
  primaryUserIds?: string
  cursor?: string
}

export interface GongExtensiveCall {
  metaData: Record<string, unknown>
  parties: GongParty[]
  content: Record<string, unknown>
  interaction: Record<string, unknown>
  collaboration: Record<string, unknown>
  media: Record<string, unknown>
}

export interface GongGetExtensiveCallsResponse extends ToolResponse {
  output: {
    calls: GongExtensiveCall[]
    cursor: string | null
  }
}

/** List Users */
export interface GongListUsersParams extends GongBaseParams {
  cursor?: string
  includeAvatars?: string
}

export interface GongUserSettings {
  webConferencesRecorded: boolean
  preventWebConferenceRecording: boolean
  telephonyCallsImported: boolean
  emailsImported: boolean
  preventEmailImport: boolean
  nonRecordedMeetingsImported: boolean
  gongConnectEnabled: boolean
}

export interface GongSpokenLanguage {
  language: string
  primary: boolean
}

export interface GongUser {
  id: string
  emailAddress: string | null
  created: string | null
  active: boolean
  emailAliases: string[]
  trustedEmailAddress: string | null
  firstName: string | null
  lastName: string | null
  title: string | null
  phoneNumber: string | null
  extension: string | null
  personalMeetingUrls: string[]
  settings: GongUserSettings | null
  managerId: string | null
  meetingConsentPageUrl: string | null
  spokenLanguages: GongSpokenLanguage[]
}

export interface GongListUsersResponse extends ToolResponse {
  output: {
    users: GongUser[]
    cursor: string | null
    totalRecords: number | null
    currentPageSize: number | null
    currentPageNumber: number | null
  }
}

/** Get User */
export interface GongGetUserParams extends GongBaseParams {
  userId: string
}

export interface GongGetUserResponse extends ToolResponse {
  output: {
    id: string
    emailAddress: string | null
    created: string | null
    active: boolean
    emailAliases: string[]
    trustedEmailAddress: string | null
    firstName: string | null
    lastName: string | null
    title: string | null
    phoneNumber: string | null
    extension: string | null
    personalMeetingUrls: string[]
    settings: GongUserSettings | null
    managerId: string | null
    meetingConsentPageUrl: string | null
    spokenLanguages: GongSpokenLanguage[]
  }
}

/** Aggregate Activity */
export interface GongAggregateActivityParams extends GongBaseParams {
  userIds?: string
  fromDate: string
  toDate: string
  cursor?: string
}

export interface GongUserActivity {
  userId: string
  userEmailAddress: string | null
  callsAsHost: number | null
  callsAttended: number | null
  callsGaveFeedback: number | null
  callsReceivedFeedback: number | null
  callsRequestedFeedback: number | null
  callsScorecardsFilled: number | null
  callsScorecardsReceived: number | null
  ownCallsListenedTo: number | null
  othersCallsListenedTo: number | null
  callsSharedInternally: number | null
  callsSharedExternally: number | null
  callsCommentsGiven: number | null
  callsCommentsReceived: number | null
  callsMarkedAsFeedbackGiven: number | null
  callsMarkedAsFeedbackReceived: number | null
}

export interface GongAggregateActivityResponse extends ToolResponse {
  output: {
    usersActivity: GongUserActivity[]
    timeZone: string | null
    fromDateTime: string | null
    toDateTime: string | null
    cursor: string | null
  }
}

/** Interaction Stats */
export interface GongInteractionStatEntry {
  name: string
  value: number | null
}

export interface GongUserInteractionStats {
  userId: string
  userEmailAddress: string | null
  personInteractionStats: GongInteractionStatEntry[]
}

export interface GongInteractionStatsParams extends GongBaseParams {
  userIds?: string
  fromDate: string
  toDate: string
  cursor?: string
}

export interface GongInteractionStatsResponse extends ToolResponse {
  output: {
    peopleInteractionStats: GongUserInteractionStats[]
    timeZone: string | null
    fromDateTime: string | null
    toDateTime: string | null
    cursor: string | null
  }
}

/** Answered Scorecards */
export interface GongAnsweredScorecardsParams extends GongBaseParams {
  callFromDate?: string
  callToDate?: string
  reviewFromDate?: string
  reviewToDate?: string
  scorecardIds?: string
  reviewedUserIds?: string
  cursor?: string
}

export interface GongScorecardAnswer {
  questionId: number | null
  questionRevisionId: number | null
  isOverall: boolean | null
  score: number | null
  answerText: string | null
  notApplicable: boolean | null
}

export interface GongAnsweredScorecard {
  answeredScorecardId: number
  scorecardId: number | null
  scorecardName: string | null
  callId: number | null
  callStartTime: string | null
  reviewedUserId: number | null
  reviewerUserId: number | null
  reviewTime: string | null
  visibilityType: string | null
  answers: GongScorecardAnswer[]
}

export interface GongAnsweredScorecardsResponse extends ToolResponse {
  output: {
    answeredScorecards: GongAnsweredScorecard[]
    cursor: string | null
  }
}

/** List Library Folders */
export interface GongListLibraryFoldersParams extends GongBaseParams {
  workspaceId?: string
}

export interface GongLibraryFolder {
  id: string
  name: string
  parentFolderId: string | null
  createdBy: string | null
  updated: string | null
}

export interface GongListLibraryFoldersResponse extends ToolResponse {
  output: {
    folders: GongLibraryFolder[]
  }
}

/** Get Folder Content */
export interface GongGetFolderContentParams extends GongBaseParams {
  folderId: string
}

export interface GongFolderCallSnippet {
  fromSec: number | null
  toSec: number | null
}

export interface GongFolderCall {
  id: string
  title: string | null
  note: string | null
  addedBy: string | null
  created: string | null
  url: string | null
  snippet: GongFolderCallSnippet | null
}

export interface GongGetFolderContentResponse extends ToolResponse {
  output: {
    folderId: string | null
    folderName: string | null
    createdBy: string | null
    updated: string | null
    calls: GongFolderCall[]
  }
}

/** List Scorecards */
export interface GongListScorecardsParams extends GongBaseParams {}

export interface GongScorecardQuestion {
  questionId: string
  questionText: string
  questionRevisionId: string | null
  isOverall: boolean
  created: string | null
  updated: string | null
  updaterUserId: string | null
}

export interface GongScorecard {
  scorecardId: string
  scorecardName: string
  workspaceId: string | null
  enabled: boolean
  updaterUserId: string | null
  created: string | null
  updated: string | null
  questions: GongScorecardQuestion[]
}

export interface GongListScorecardsResponse extends ToolResponse {
  output: {
    scorecards: GongScorecard[]
  }
}

/** List Trackers */
export interface GongListTrackersParams extends GongBaseParams {
  workspaceId?: string
}

export interface GongTrackerLanguageKeyword {
  language: string | null
  keywords: string[]
  includeRelatedForms: boolean
}

export interface GongTracker {
  trackerId: string
  trackerName: string
  workspaceId: string | null
  languageKeywords: GongTrackerLanguageKeyword[]
  affiliation: string | null
  partOfQuestion: boolean | null
  saidAt: string | null
  saidAtInterval: number | null
  saidAtUnit: string | null
  saidInTopics: string[]
  saidInCallParts: string[]
  filterQuery: string | null
  created: string | null
  creatorUserId: string | null
  updated: string | null
  updaterUserId: string | null
}

export interface GongListTrackersResponse extends ToolResponse {
  output: {
    trackers: GongTracker[]
  }
}

/** List Workspaces */
export interface GongListWorkspacesParams extends GongBaseParams {}

export interface GongWorkspace {
  id: string
  name: string | null
  description: string | null
}

export interface GongListWorkspacesResponse extends ToolResponse {
  output: {
    workspaces: GongWorkspace[]
  }
}

/** List Flows */
export interface GongListFlowsParams extends GongBaseParams {
  flowOwnerEmail: string
  workspaceId?: string
  cursor?: string
}

export interface GongFlow {
  id: string
  name: string | null
  folderId: string | null
  folderName: string | null
  visibility: string | null
  creationDate: string | null
  exclusive: boolean | null
}

export interface GongListFlowsResponse extends ToolResponse {
  output: {
    requestId: string | null
    flows: GongFlow[]
    totalRecords: number | null
    currentPageSize: number | null
    currentPageNumber: number | null
    cursor: string | null
  }
}

/** Get Coaching */
export interface GongGetCoachingParams extends GongBaseParams {
  managerId: string
  workspaceId: string
  fromDate: string
  toDate: string
}

export interface GongCoachingUser {
  id: string | null
  emailAddress: string | null
  firstName: string | null
  lastName: string | null
  title: string | null
}

export interface GongCoachingRepData {
  report: GongCoachingUser | null
  metrics: Record<string, string[]> | null
}

export interface GongCoachingMetricsData {
  manager: GongCoachingUser | null
  directReportsMetrics: GongCoachingRepData[]
}

export interface GongGetCoachingResponse extends ToolResponse {
  output: {
    requestId: string | null
    coachingData: GongCoachingMetricsData[]
  }
}

/** Shared data-privacy sub-types */
export interface GongCallReference {
  id: string
  status: string
  externalSystems: {
    system: string
    objects: {
      objectType: string
      externalId: string
    }[]
  }[]
}

export interface GongEmailMessage {
  id: string
  from: string
  sentTime: string
  mailbox: string
  messageHash: string
}

export interface GongMeeting {
  id: string
}

export interface GongCustomerDataObject {
  id: string
  objectType: string
  externalId: string
  mirrorId: string
  fields: { name: string; value: unknown }[]
}

export interface GongCustomerData {
  system: string
  objects: GongCustomerDataObject[]
}

export interface GongCustomerEngagement {
  eventType: string
  eventName: string
  timestamp: string
  contentId: string
  contentUrl: string
  reportingSystem: string
  sourceEventId: string
}

/** Lookup Email */
export interface GongLookupEmailParams extends GongBaseParams {
  emailAddress: string
}

export interface GongLookupEmailResponse extends ToolResponse {
  output: {
    requestId: string
    calls: GongCallReference[]
    emails: GongEmailMessage[]
    meetings: GongMeeting[]
    customerData: GongCustomerData[]
    customerEngagement: GongCustomerEngagement[]
  }
}

/** Lookup Phone */
export interface GongLookupPhoneParams extends GongBaseParams {
  phoneNumber: string
}

export interface GongLookupPhoneResponse extends ToolResponse {
  output: {
    requestId: string
    suppliedPhoneNumber: string
    matchingPhoneNumbers: string[]
    emailAddresses: string[]
    calls: GongCallReference[]
    emails: GongEmailMessage[]
    meetings: GongMeeting[]
    customerData: GongCustomerData[]
  }
}

/** Union type for all Gong responses */
export type GongResponse =
  | GongListCallsResponse
  | GongGetCallResponse
  | GongGetCallTranscriptResponse
  | GongGetExtensiveCallsResponse
  | GongListUsersResponse
  | GongGetUserResponse
  | GongAggregateActivityResponse
  | GongInteractionStatsResponse
  | GongAnsweredScorecardsResponse
  | GongListLibraryFoldersResponse
  | GongGetFolderContentResponse
  | GongListScorecardsResponse
  | GongListTrackersResponse
  | GongListWorkspacesResponse
  | GongListFlowsResponse
  | GongGetCoachingResponse
  | GongLookupEmailResponse
  | GongLookupPhoneResponse
