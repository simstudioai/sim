import type { ToolResponse } from '@/tools/types'

/** Base parameters shared by all Gong tools */
interface GongBaseParams {
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

/** Create Call */
export interface GongCreateCallParams extends GongBaseParams {
  clientUniqueId: string
  actualStart: string
  primaryUser: string
  parties: unknown
  direction: string
  downloadMediaUrl?: string
  title?: string
  workspaceId?: string
  disposition?: string
  purpose?: string
  context?: unknown
  callProviderCode?: string
}

export interface GongCreateCallResponse extends ToolResponse {
  output: {
    callId: string
    requestId: string
  }
}

interface GongCallBasic {
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

interface GongParty {
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
    requestId: string | null
    calls: GongCallBasic[]
    cursor: string | null
    totalRecords: number | null
    currentPageSize: number | null
    currentPageNumber: number | null
  }
}

/** Get Call */
export interface GongGetCallParams extends GongBaseParams {
  callId: string
}

export interface GongGetCallResponse extends ToolResponse {
  output: GongCallBasic & { requestId: string | null }
}

/** Get Call Transcript */
export interface GongGetCallTranscriptParams extends GongBaseParams {
  callIds?: string
  fromDateTime?: string
  toDateTime?: string
  workspaceId?: string
  cursor?: string
}

interface GongTranscriptSentence {
  start: number
  end: number
  text: string
}

interface GongTranscriptEntry {
  speakerId: string | null
  topic: string | null
  sentences: GongTranscriptSentence[]
}

interface GongCallTranscript {
  callId: string
  transcript: GongTranscriptEntry[]
}

export interface GongGetCallTranscriptResponse extends ToolResponse {
  output: {
    requestId: string | null
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

interface GongExtensiveCall {
  metaData: Record<string, unknown>
  parties: GongParty[]
  content: Record<string, unknown>
  interaction: Record<string, unknown>
  collaboration: Record<string, unknown>
  media: Record<string, unknown>
}

export interface GongGetExtensiveCallsResponse extends ToolResponse {
  output: {
    requestId: string | null
    calls: GongExtensiveCall[]
    cursor: string | null
  }
}

/** List Users */
export interface GongListUsersParams extends GongBaseParams {
  cursor?: string
  includeAvatars?: string
}

interface GongUserSettings {
  webConferencesRecorded: boolean
  preventWebConferenceRecording: boolean
  telephonyCallsImported: boolean
  emailsImported: boolean
  preventEmailImport: boolean
  nonRecordedMeetingsImported: boolean
  gongConnectEnabled: boolean
}

interface GongSpokenLanguage {
  language: string
  primary: boolean
}

interface GongUser {
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
    requestId: string | null
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
    requestId: string | null
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

interface GongUserActivity {
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
    requestId: string | null
    usersActivity: GongUserActivity[]
    timeZone: string | null
    fromDateTime: string | null
    toDateTime: string | null
    cursor: string | null
  }
}

/** Interaction Stats */
interface GongInteractionStatEntry {
  name: string
  value: number | null
}

interface GongUserInteractionStats {
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
    requestId: string | null
    peopleInteractionStats: GongUserInteractionStats[]
    timeZone: string | null
    fromDateTime: string | null
    toDateTime: string | null
    cursor: string | null
  }
}

/** Day-by-Day Activity */
export interface GongDayByDayActivityParams extends GongBaseParams {
  userIds?: string
  fromDate: string
  toDate: string
  cursor?: string
}

interface GongDailyActivity {
  fromDate: string | null
  toDate: string | null
  callsAsHost: string[]
  callsAttended: string[]
  callsGaveFeedback: string[]
  callsReceivedFeedback: string[]
  callsRequestedFeedback: string[]
  callsScorecardsFilled: string[]
  callsScorecardsReceived: string[]
  ownCallsListenedTo: string[]
  othersCallsListenedTo: string[]
  callsSharedInternally: string[]
  callsSharedExternally: string[]
  callsCommentsGiven: string[]
  callsCommentsReceived: string[]
  callsMarkedAsFeedbackGiven: string[]
  callsMarkedAsFeedbackReceived: string[]
}

interface GongUserDayByDayActivity {
  userId: string
  userEmailAddress: string | null
  userDailyActivityStats: GongDailyActivity[]
}

export interface GongDayByDayActivityResponse extends ToolResponse {
  output: {
    requestId: string | null
    usersDetailedActivities: GongUserDayByDayActivity[]
    cursor: string | null
  }
}

/** Aggregate by Period */
export interface GongAggregateByPeriodParams extends GongBaseParams {
  aggregationPeriod: string
  userIds?: string
  fromDate: string
  toDate: string
  cursor?: string
}

interface GongPeriodActivity {
  fromDate: string | null
  toDate: string | null
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

interface GongUserAggregateByPeriod {
  userId: string
  userEmailAddress: string | null
  userAggregateActivity: GongPeriodActivity[]
}

export interface GongAggregateByPeriodResponse extends ToolResponse {
  output: {
    requestId: string | null
    usersAggregateActivity: GongUserAggregateByPeriod[]
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

interface GongScorecardAnswer {
  questionId: number | null
  questionRevisionId: number | null
  isOverall: boolean | null
  score: number | null
  answerText: string | null
  notApplicable: boolean | null
  selectedOptions: string[] | null
}

interface GongAnsweredScorecard {
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
    requestId: string | null
    answeredScorecards: GongAnsweredScorecard[]
    cursor: string | null
  }
}

/** List Library Folders */
export interface GongListLibraryFoldersParams extends GongBaseParams {
  workspaceId?: string
}

interface GongLibraryFolder {
  id: string
  name: string
  parentFolderId: string | null
  createdBy: string | null
  updated: string | null
}

export interface GongListLibraryFoldersResponse extends ToolResponse {
  output: {
    requestId: string | null
    folders: GongLibraryFolder[]
  }
}

/** Get Folder Content */
export interface GongGetFolderContentParams extends GongBaseParams {
  folderId?: string
}

interface GongFolderCallSnippet {
  fromSec: number | null
  toSec: number | null
}

interface GongFolderCall {
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
    requestId: string | null
    folderId: string | null
    folderName: string | null
    createdBy: string | null
    updated: string | null
    calls: GongFolderCall[]
  }
}

/** List Scorecards */
export interface GongListScorecardsParams extends GongBaseParams {}

interface GongScorecardQuestionOption {
  id: number
  text: string
}

interface GongScorecardQuestion {
  questionId: number | null
  questionRevisionId: number | null
  questionText: string
  isOverall: boolean
  questionType: string | null
  answerGuide: string | null
  minRange: number | null
  maxRange: number | null
  answerOptions: GongScorecardQuestionOption[]
}

interface GongScorecard {
  scorecardId: number | null
  scorecardName: string
  workspaceId: number | null
  enabled: boolean
  updaterUserId: number | null
  created: string | null
  updated: string | null
  reviewMethod: string | null
  questions: GongScorecardQuestion[]
}

export interface GongListScorecardsResponse extends ToolResponse {
  output: {
    requestId: string | null
    scorecards: GongScorecard[]
  }
}

/** List Trackers */
export interface GongListTrackersParams extends GongBaseParams {
  workspaceId?: string
}

interface GongTrackerLanguageKeyword {
  language: string | null
  keywords: string[]
  includeRelatedForms: boolean
}

interface GongTracker {
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
  filterQuery: string | null
  created: string | null
  creatorUserId: string | null
  updated: string | null
  updaterUserId: string | null
}

export interface GongListTrackersResponse extends ToolResponse {
  output: {
    requestId: string | null
    trackers: GongTracker[]
  }
}

/** List Workspaces */
export interface GongListWorkspacesParams extends GongBaseParams {}

interface GongWorkspace {
  id: string
  name: string | null
  description: string | null
}

export interface GongListWorkspacesResponse extends ToolResponse {
  output: {
    requestId: string | null
    workspaces: GongWorkspace[]
  }
}

/** List Flows */
export interface GongListFlowsParams extends GongBaseParams {
  flowOwnerEmail: string
  workspaceId?: string
  cursor?: string
}

interface GongFlow {
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
interface GongCallReference {
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

interface GongEmailMessage {
  id: string
  from: string
  sentTime: string
  mailbox: string
  messageHash: string
}

interface GongMeeting {
  id: string
}

interface GongCustomerDataObject {
  id: string
  objectType: string
  externalId: string
  mirrorId: string
  fields: { name: string; value: unknown }[]
}

interface GongCustomerData {
  system: string
  objects: GongCustomerDataObject[]
}

interface GongCustomerEngagement {
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

/** Purge Email Address */
export interface GongPurgeEmailAddressParams extends GongBaseParams {
  emailAddress: string
}

export interface GongPurgeEmailAddressResponse extends ToolResponse {
  output: {
    requestId: string | null
  }
}

/** Purge Phone Number */
export interface GongPurgePhoneNumberParams extends GongBaseParams {
  phoneNumber: string
}

export interface GongPurgePhoneNumberResponse extends ToolResponse {
  output: {
    requestId: string | null
  }
}

/** Shared Engage Flow prospect assignment sub-types */
interface GongAssignedFlow {
  flowId: string
  flowName: string
  crmProspectId: string
  flowInstanceId: string
  flowInstanceOwnerEmail: string
  flowInstanceOwnerFullName: string
  flowInstanceCreateDate: string
  flowInstanceStatus: string
  workspaceId: string
  exclusive: boolean
}

interface GongAssignedFlowFailure {
  flowId: string
  crmProspectId: string
  errorCode: string
  errorMessage: string
}

/** Assign Flow Prospects */
export interface GongAssignFlowProspectsParams extends GongBaseParams {
  flowId: string
  crmProspectsIds: string
  flowInstanceOwnerEmail: string
}

export interface GongAssignFlowProspectsResponse extends ToolResponse {
  output: {
    requestId: string | null
    prospectsAssigned: GongAssignedFlow[]
    prospectsNotAssigned: GongAssignedFlowFailure[]
  }
}

/** Get Prospect Flows */
export interface GongGetProspectFlowsParams extends GongBaseParams {
  crmProspectsIds: string
}

export interface GongGetProspectFlowsResponse extends ToolResponse {
  output: {
    requestId: string | null
    prospectsAssigned: GongAssignedFlow[]
  }
}

/** Ask Anything */
export interface GongAskAnythingParams extends GongBaseParams {
  workspaceId: string
  crmEntityType: string
  crmEntityId: string
  question: string
  timePeriod: string
  fromDateTime?: string
  toDateTime?: string
}

interface GongAnswerSection {
  answerItems: string[]
  callFindings: Record<string, unknown>[]
  emailFindings: Record<string, unknown>[]
}

export interface GongAskAnythingResponse extends ToolResponse {
  output: {
    requestId: string | null
    numOfCallsSearched: number | null
    numOfEmailsSearched: number | null
    answer: GongAnswerSection[]
  }
}

/** Get Brief */
export interface GongGetBriefParams extends GongBaseParams {
  workspaceId: string
  briefName: string
  crmEntityType: string
  crmEntityId: string
  timePeriod: string
  fromDateTime?: string
  toDateTime?: string
}

export interface GongGetBriefResponse extends ToolResponse {
  output: {
    requestId: string | null
    numOfCallsSearched: number | null
    numOfEmailsSearched: number | null
    briefSections: Record<string, unknown>[]
  }
}

/** Unassign Flow Prospects */
export interface GongUnassignFlowProspectsParams extends GongBaseParams {
  crmProspectId: string
  flowId?: string
  unassignedByUserEmail?: string
}

export interface GongUnassignFlowProspectsResponse extends ToolResponse {
  output: {
    requestId: string | null
    unassignedFlowInstanceIds: string[]
  }
}

/** Get Logs */
export interface GongGetLogsParams extends GongBaseParams {
  logType: string
  fromDateTime: string
  toDateTime?: string
  cursor?: string
}

interface GongLogEntry {
  userId: string | null
  userEmailAddress: string | null
  userFullName: string | null
  impersonatorUserId: string | null
  impersonatorEmailAddress: string | null
  impersonatorFullName: string | null
  impersonatorCompanyId: string | null
  eventTime: string | null
  logRecord: Record<string, unknown> | null
}

export interface GongGetLogsResponse extends ToolResponse {
  output: {
    requestId: string | null
    logEntries: GongLogEntry[]
    cursor: string | null
    totalRecords: number | null
    currentPageSize: number | null
    currentPageNumber: number | null
  }
}

/** Union type for all Gong responses */
export type GongResponse =
  | GongListCallsResponse
  | GongCreateCallResponse
  | GongGetCallResponse
  | GongGetCallTranscriptResponse
  | GongGetExtensiveCallsResponse
  | GongListUsersResponse
  | GongGetUserResponse
  | GongAggregateActivityResponse
  | GongDayByDayActivityResponse
  | GongAggregateByPeriodResponse
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
  | GongPurgeEmailAddressResponse
  | GongPurgePhoneNumberResponse
  | GongAssignFlowProspectsResponse
  | GongGetProspectFlowsResponse
  | GongAskAnythingResponse
  | GongGetBriefResponse
  | GongUnassignFlowProspectsResponse
  | GongGetLogsResponse
