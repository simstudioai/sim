import type { ToolResponse } from '@/tools/types'

export interface OracleFusionServiceParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  srNumber?: string
  partyNumber?: string
  queueId?: string
  businessUnitId?: string
  memberId?: string
  messageId?: string
  referenceId?: string
  accountPartyId?: string
  contactPartyId?: string
  resourcePartyId?: string
  title?: string
  problemDescription?: string
  statusCode?: string
  severityCode?: string
  channelTypeCode?: string
  resolveDescription?: string
  resolveOutcomeCode?: string
  resolutionCode?: string
  accessLevelCode?: string
  relationTypeCode?: string
  primaryContact?: boolean
  owner?: boolean
  overrideQueue?: boolean
  ifMatch?: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionServiceRequest {
  SrId?: string | null
  SrNumber: string
  Title?: string | null
  ProblemDescription?: string | null
  StatusCd?: string | null
  StatusCdMeaning?: string | null
  StatusTypeCd?: string | null
  SeverityCd?: string | null
  SeverityCdMeaning?: string | null
  AccountPartyId?: string | null
  AccountPartyName?: string | null
  PrimaryContactPartyId?: string | null
  PrimaryContactPartyName?: string | null
  AssigneeResourceId?: string | null
  AssigneePartyId?: string | null
  AssigneePersonName?: string | null
  QueueId?: string | null
  QueueName?: string | null
  BUOrgId?: string | null
  BusinessUnitName?: string | null
  CategoryId?: string | null
  CategoryName?: string | null
  ChannelTypeCd?: string | null
  ResolveDescription?: string | null
  ResolveOutcomeCd?: string | null
  ResolutionCd?: string | null
  OpenDate?: string | null
  LastResolvedDate?: string | null
  ClosedDate?: string | null
  CreationDate?: string | null
  LastUpdateDate?: string | null
}

export interface OracleFusionServiceAccounts {
  PartyId?: string | null
  PartyNumber: string
  OrganizationName?: string | null
  PartyUniqueName?: string | null
  PartyStatus?: string | null
  Type?: string | null
  EmailAddress?: string | null
  FormattedPhoneNumber?: string | null
  PrimaryContactPartyId?: string | null
  PrimaryContactName?: string | null
}

export interface OracleFusionServiceContacts {
  PartyId?: string | null
  PartyNumber: string
  ContactName?: string | null
  ContactUniqueName?: string | null
  FirstName?: string | null
  LastName?: string | null
  EmailAddress?: string | null
  OverallPrimaryFormattedPhoneNumber?: string | null
  AccountPartyId?: string | null
  AccountName?: string | null
  PartyStatus?: string | null
}

export interface OracleFusionServiceQueues {
  QueueId: string
  QueueNumber?: string | null
  QueueName?: string | null
  QueueDescription?: string | null
  EnabledFlag?: boolean | null
  AutoRoutingFlag?: boolean | null
  StripeCd?: string | null
  OwnerResourceId?: string | null
  ResourceCount?: number | null
  OpenSrCount?: number | null
}

export interface OracleFusionServiceResources {
  PartyId?: string | null
  PartyNumber: string
  PartyName?: string | null
  Username?: string | null
  EmailAddress?: string | null
  FormattedPhoneNumber?: string | null
  ResourceProfileId?: string | null
  ResourceType?: string | null
  StartDateActive?: string | null
  EndDateActive?: string | null
}

export interface OracleFusionServiceBusinessUnits {
  BUOrgId: string
  BusinessUnitName?: string | null
  BusinessUnitId?: string | null
  Name?: string | null
}

export interface OracleFusionServiceStatuses {
  LookupCode: string
  Meaning?: string | null
  Description?: string | null
  ParentLookupCode?: string | null
  EnabledFlag?: boolean | null
  StartDateActive?: string | null
  EndDateActive?: string | null
}

export interface OracleFusionServiceRequestContacts {
  MemberId: string
  SrId?: string | null
  SrNumber?: string | null
  PartyId?: string | null
  ContactPartyNumber?: string | null
  ContactUniqueName?: string | null
  ContactEmailAddress?: string | null
  ContactFormattedPhoneNumber?: string | null
  PrimaryContactFlag?: boolean | null
  RelationTypeCd?: string | null
  AccessLevelCd?: string | null
}

export interface OracleFusionServiceRequestResources {
  MemberId: string
  SrId?: string | null
  SrNumber?: string | null
  ObjectId?: string | null
  ObjectTypeCd?: string | null
  ResourceName?: string | null
  ResourcePartyNumber?: string | null
  ResourceEmailAddress?: string | null
  OwnerFlag?: boolean | null
  Username?: string | null
}

export interface OracleFusionServiceMessages {
  MessageId: string
  SrId?: string | null
  SrNumber?: string | null
  MessageNumber?: string | null
  MessageTypeCd?: string | null
  MessageSubTypeCd?: string | null
  Subject?: string | null
  StatusCd?: string | null
  VisibilityCd?: string | null
  PartyName?: string | null
  PostedByPartyId?: string | null
  ParentMessageId?: string | null
  ChannelTypeCd?: string | null
  CreationDate?: string | null
  LastUpdateDate?: string | null
  SentDate?: string | null
  MessageContent?: string | null
}

export interface OracleFusionServiceInteractions {
  ReferenceId: string
  InteractionId?: string | null
  Description?: string | null
  ChannelTypeCd?: string | null
  DirectionCd?: string | null
  StatusCd?: string | null
  StartTime?: string | null
  EndTime?: string | null
  ContactPartyId?: string | null
  ContactPartyUniqueName?: string | null
  AccountPartyId?: string | null
  AccountPartyUniqueName?: string | null
  OwnerResourceId?: string | null
  OwnerResourcePartyUniqueName?: string | null
  QueueId?: string | null
  QueueName?: string | null
  CreationDate?: string | null
}

export type OracleFusionServiceRecord =
  | OracleFusionServiceRequest
  | OracleFusionServiceAccounts
  | OracleFusionServiceContacts
  | OracleFusionServiceQueues
  | OracleFusionServiceResources
  | OracleFusionServiceBusinessUnits
  | OracleFusionServiceStatuses
  | OracleFusionServiceRequestContacts
  | OracleFusionServiceRequestResources
  | OracleFusionServiceMessages
  | OracleFusionServiceInteractions

export interface OracleFusionServiceResponse extends ToolResponse {
  output: {
    item?: OracleFusionServiceRecord
    items?: OracleFusionServiceRecord[]
    count?: number
    hasMore?: boolean
    limit?: number
    offset?: number
    totalResults?: number
    nextOffset?: number
    result?: string
    deleted?: boolean
  }
}
