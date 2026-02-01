import type { ToolResponse } from '@/tools/types'

/**
 * Base params for all Enrich tools
 */
interface EnrichBaseParams {
  apiKey: string
}

export interface EnrichCheckCreditsParams extends EnrichBaseParams {}

export interface EnrichCheckCreditsResponse extends ToolResponse {
  output: {
    totalCredits: number
    creditsUsed: number
    creditsRemaining: number
  }
}

export interface EnrichEmailToProfileParams extends EnrichBaseParams {
  email: string
  inRealtime?: boolean
}

export interface EnrichEmailToProfileResponse extends ToolResponse {
  output: {
    displayName: string | null
    firstName: string | null
    lastName: string | null
    headline: string | null
    occupation: string | null
    summary: string | null
    location: string | null
    country: string | null
    linkedInUrl: string | null
    photoUrl: string | null
    connectionCount: number | null
    isConnectionCountObfuscated: boolean | null
    positionHistory: Array<{
      title: string
      company: string
      startDate: string | null
      endDate: string | null
      location: string | null
    }>
    education: Array<{
      school: string
      degree: string | null
      fieldOfStudy: string | null
      startDate: string | null
      endDate: string | null
    }>
    certifications: Array<{
      name: string
      authority: string | null
      url: string | null
    }>
    skills: string[]
    languages: string[]
    locale: string | null
    version: number | null
  }
}

export interface EnrichEmailToPersonLiteParams extends EnrichBaseParams {
  email: string
}

export interface EnrichEmailToPersonLiteResponse extends ToolResponse {
  output: {
    name: string | null
    firstName: string | null
    lastName: string | null
    email: string | null
    title: string | null
    location: string | null
    company: string | null
    companyLocation: string | null
    companyLinkedIn: string | null
    profileId: string | null
    schoolName: string | null
    schoolUrl: string | null
    linkedInUrl: string | null
    photoUrl: string | null
    followerCount: number | null
    connectionCount: number | null
    languages: string[]
    projects: string[]
    certifications: string[]
    volunteerExperience: string[]
  }
}

export interface EnrichLinkedInProfileParams extends EnrichBaseParams {
  url: string
}

export interface EnrichLinkedInProfileResponse extends ToolResponse {
  output: {
    profileId: string | null
    firstName: string | null
    lastName: string | null
    subTitle: string | null
    profilePicture: string | null
    backgroundImage: string | null
    industry: string | null
    location: string | null
    followersCount: number | null
    connectionsCount: number | null
    premium: boolean
    influencer: boolean
    positions: Array<{
      title: string
      company: string
      companyLogo: string | null
      startDate: string | null
      endDate: string | null
      location: string | null
    }>
    education: Array<{
      school: string
      degree: string | null
      fieldOfStudy: string | null
      startDate: string | null
      endDate: string | null
    }>
    websites: string[]
  }
}

export interface EnrichFindEmailParams extends EnrichBaseParams {
  fullName: string
  companyDomain: string
}

export interface EnrichFindEmailResponse extends ToolResponse {
  output: {
    email: string | null
    firstName: string | null
    lastName: string | null
    domain: string | null
    found: boolean
    acceptAll: boolean | null
  }
}

export interface EnrichLinkedInToWorkEmailParams extends EnrichBaseParams {
  linkedinProfile: string
}

export interface EnrichLinkedInToWorkEmailResponse extends ToolResponse {
  output: {
    email: string | null
    found: boolean
    status: string | null
  }
}

export interface EnrichLinkedInToPersonalEmailParams extends EnrichBaseParams {
  linkedinProfile: string
}

export interface EnrichLinkedInToPersonalEmailResponse extends ToolResponse {
  output: {
    email: string | null
    found: boolean
    status: string | null
  }
}

export interface EnrichPhoneFinderParams extends EnrichBaseParams {
  linkedinProfile: string
}

export interface EnrichPhoneFinderResponse extends ToolResponse {
  output: {
    profileUrl: string | null
    mobileNumber: string | null
    found: boolean
    status: string | null
  }
}

export interface EnrichEmailToPhoneParams extends EnrichBaseParams {
  email: string
}

export interface EnrichEmailToPhoneResponse extends ToolResponse {
  output: {
    email: string | null
    mobileNumber: string | null
    found: boolean
    status: string | null
  }
}

export interface EnrichVerifyEmailParams extends EnrichBaseParams {
  email: string
}

export interface EnrichVerifyEmailResponse extends ToolResponse {
  output: {
    email: string
    status: string
    result: string
    confidenceScore: number
    smtpProvider: string | null
    mailDisposable: boolean
    mailAcceptAll: boolean
    free: boolean
  }
}

export interface EnrichDisposableEmailCheckParams extends EnrichBaseParams {
  email: string
}

export interface EnrichDisposableEmailCheckResponse extends ToolResponse {
  output: {
    email: string
    score: number
    testsPassed: string
    passed: boolean
    reason: string | null
    mailServerIp: string | null
    mxRecords: Array<{ host: string; pref: number }>
  }
}

export interface EnrichEmailToIpParams extends EnrichBaseParams {
  email: string
}

export interface EnrichEmailToIpResponse extends ToolResponse {
  output: {
    email: string
    ip: string | null
    found: boolean
  }
}

export interface EnrichIpToCompanyParams extends EnrichBaseParams {
  ip: string
}

export interface EnrichIpToCompanyResponse extends ToolResponse {
  output: {
    name: string | null
    legalName: string | null
    domain: string | null
    domainAliases: string[]
    sector: string | null
    industry: string | null
    phone: string | null
    employees: number | null
    revenue: string | null
    location: {
      city: string | null
      state: string | null
      country: string | null
      timezone: string | null
    }
    linkedInUrl: string | null
    twitterUrl: string | null
    facebookUrl: string | null
  }
}

export interface EnrichCompanyLookupParams extends EnrichBaseParams {
  name?: string
  domain?: string
}

export interface EnrichCompanyLookupResponse extends ToolResponse {
  output: {
    name: string | null
    universalName: string | null
    companyId: string | null
    description: string | null
    phone: string | null
    linkedInUrl: string | null
    websiteUrl: string | null
    followers: number | null
    staffCount: number | null
    foundedDate: string | null
    type: string | null
    industries: string[]
    specialties: string[]
    headquarters: {
      city: string | null
      country: string | null
      postalCode: string | null
      line1: string | null
    }
    logo: string | null
    coverImage: string | null
    fundingRounds: Array<{
      roundType: string
      amount: number | null
      currency: string | null
      investors: string[]
    }>
  }
}

export interface EnrichCompanyFundingParams extends EnrichBaseParams {
  domain: string
}

export interface EnrichCompanyFundingResponse extends ToolResponse {
  output: {
    legalName: string | null
    employeeCount: number | null
    headquarters: string | null
    industry: string | null
    totalFundingRaised: number | null
    fundingRounds: Array<{
      roundType: string
      amount: number | null
      date: string | null
      investors: string[]
    }>
    monthlyVisits: number | null
    trafficChange: number | null
    itSpending: number | null
    executives: Array<{
      name: string
      title: string
    }>
  }
}

export interface EnrichCompanyRevenueParams extends EnrichBaseParams {
  domain: string
}

export interface EnrichCompanyRevenueResponse extends ToolResponse {
  output: {
    companyName: string | null
    shortDescription: string | null
    fullSummary: string | null
    revenue: string | null
    revenueMin: number | null
    revenueMax: number | null
    employeeCount: number | null
    founded: string | null
    ownership: string | null
    status: string | null
    website: string | null
    ceo: {
      name: string | null
      designation: string | null
      rating: number | null
    }
    socialLinks: {
      linkedIn: string | null
      twitter: string | null
      facebook: string | null
    }
    totalFunding: string | null
    fundingRounds: number | null
    competitors: Array<{
      name: string
      revenue: string | null
      employeeCount: number | null
      headquarters: string | null
    }>
  }
}

export interface EnrichSearchPeopleParams extends EnrichBaseParams {
  firstName?: string
  lastName?: string
  summary?: string
  subTitle?: string
  locationCountry?: string
  locationCity?: string
  locationState?: string
  influencer?: boolean
  premium?: boolean
  language?: string
  industry?: string
  certifications?: string[]
  degreeNames?: string[]
  studyFields?: string[]
  schoolNames?: string[]
  currentCompanies?: number[]
  pastCompanies?: number[]
  currentJobTitles?: string[]
  pastJobTitles?: string[]
  skills?: string[]
  currentPage?: number
  pageSize?: number
}

export interface EnrichSearchPeopleResponse extends ToolResponse {
  output: {
    currentPage: number
    totalPage: number
    pageSize: number
    profiles: Array<{
      profileIdentifier: string
      givenName: string | null
      familyName: string | null
      currentPosition: string | null
      profileImage: string | null
      externalProfileUrl: string | null
      city: string | null
      country: string | null
      expertSkills: string[]
    }>
  }
}

export interface EnrichSearchCompanyParams extends EnrichBaseParams {
  name?: string
  website?: string
  tagline?: string
  type?: string
  postalCode?: string
  description?: string
  industries?: string[]
  locationCountry?: string
  locationCountryList?: string[]
  locationCity?: string
  locationCityList?: string[]
  specialities?: string[]
  followers?: number
  staffCount?: number
  staffCountMin?: number
  staffCountMax?: number
  pageSize?: number
  currentPage?: number
}

export interface EnrichSearchCompanyResponse extends ToolResponse {
  output: {
    currentPage: number
    totalPage: number
    pageSize: number
    companies: Array<{
      companyName: string
      tagline: string | null
      webAddress: string | null
      industries: string[]
      teamSize: number | null
      linkedInProfile: string | null
    }>
  }
}

export interface EnrichSearchCompanyEmployeesParams extends EnrichBaseParams {
  companyIds?: number[]
  country?: string
  city?: string
  state?: string
  jobTitles?: string[]
  page?: number
  pageSize?: number
}

export interface EnrichSearchCompanyEmployeesResponse extends ToolResponse {
  output: {
    currentPage: number
    totalPage: number
    pageSize: number
    profiles: Array<{
      profileIdentifier: string
      givenName: string | null
      familyName: string | null
      currentPosition: string | null
      profileImage: string | null
      externalProfileUrl: string | null
      city: string | null
      country: string | null
      expertSkills: string[]
    }>
  }
}

export interface EnrichSearchSimilarCompaniesParams extends EnrichBaseParams {
  url: string
  accountLocation?: string[]
  employeeSizeType?: string
  employeeSizeRange?: Array<{ start: number; end: number }>
  page?: number
  num?: number
}

export interface EnrichSearchSimilarCompaniesResponse extends ToolResponse {
  output: {
    companies: Array<{
      url: string | null
      name: string | null
      universalName: string | null
      type: string | null
      description: string | null
      phone: string | null
      website: string | null
      logo: string | null
      foundedYear: number | null
      staffTotal: number | null
      industries: string[]
      relevancyScore: number | null
      relevancyValue: string | null
    }>
  }
}

export interface EnrichSalesPointerPeopleParams extends EnrichBaseParams {
  page: number
  filters: Array<{
    type: string
    values: Array<{
      id: string
      text: string
      selectionType: 'INCLUDED' | 'EXCLUDED'
    }>
    selectedSubFilter?: number
  }>
}

export interface EnrichSalesPointerPeopleResponse extends ToolResponse {
  output: {
    data: Array<{
      name: string | null
      summary: string | null
      location: string | null
      profilePicture: string | null
      linkedInUrn: string | null
      positions: Array<{
        title: string
        company: string
      }>
      education: Array<{
        school: string
        degree: string | null
      }>
    }>
    pagination: {
      totalCount: number
      returnedCount: number
      start: number
      limit: number
    }
  }
}

export interface EnrichSearchPostsParams extends EnrichBaseParams {
  keywords: string
  datePosted?: string
  page?: number
}

export interface EnrichSearchPostsResponse extends ToolResponse {
  output: {
    count: number
    posts: Array<{
      url: string | null
      postId: string | null
      author: {
        name: string | null
        headline: string | null
        linkedInUrl: string | null
        profileImage: string | null
      }
      timestamp: string | null
      textContent: string | null
      hashtags: string[]
      mediaUrls: string[]
      reactions: number
      commentsCount: number
    }>
  }
}

export interface EnrichGetPostDetailsParams extends EnrichBaseParams {
  url: string
}

export interface EnrichGetPostDetailsResponse extends ToolResponse {
  output: {
    postId: string | null
    author: {
      name: string | null
      headline: string | null
      linkedInUrl: string | null
      profileImage: string | null
    }
    timestamp: string | null
    textContent: string | null
    hashtags: string[]
    mediaUrls: string[]
    reactions: number
    commentsCount: number
  }
}

export interface EnrichSearchPostReactionsParams extends EnrichBaseParams {
  postUrn: string
  reactionType: 'all' | 'like' | 'love' | 'celebrate' | 'insightful' | 'funny'
  page: number
}

export interface EnrichSearchPostReactionsResponse extends ToolResponse {
  output: {
    page: number
    totalPage: number
    count: number
    reactions: Array<{
      reactionType: string
      reactor: {
        name: string | null
        subTitle: string | null
        profileId: string | null
        profilePicture: string | null
        linkedInUrl: string | null
      }
    }>
  }
}

export interface EnrichSearchPostCommentsParams extends EnrichBaseParams {
  postUrn: string
  page?: number
}

export interface EnrichSearchPostCommentsResponse extends ToolResponse {
  output: {
    page: number
    totalPage: number
    count: number
    comments: Array<{
      activityId: string | null
      commentary: string | null
      linkedInUrl: string | null
      commenter: {
        profileId: string | null
        firstName: string | null
        lastName: string | null
        subTitle: string | null
        profilePicture: string | null
        backgroundImage: string | null
        entityUrn: string | null
        objectUrn: string | null
        profileType: string | null
      }
      reactionBreakdown: {
        likes: number
        empathy: number
        other: number
      }
    }>
  }
}

export interface EnrichSearchPeopleActivitiesParams extends EnrichBaseParams {
  profileId: string
  activityType: 'posts' | 'comments' | 'articles'
  paginationToken?: string
}

export interface EnrichSearchPeopleActivitiesResponse extends ToolResponse {
  output: {
    paginationToken: string | null
    activityType: string
    activities: Array<{
      activityId: string | null
      commentary: string | null
      linkedInUrl: string | null
      timeElapsed: string | null
      numReactions: number | null
      author: {
        name: string | null
        profileId: string | null
        profilePicture: string | null
      } | null
      reactionBreakdown: {
        likes: number
        empathy: number
        other: number
      }
      attachments: string[]
    }>
  }
}

export interface EnrichSearchCompanyActivitiesParams extends EnrichBaseParams {
  companyId: string
  activityType: 'posts' | 'comments' | 'articles'
  paginationToken?: string
  offset?: number
}

export interface EnrichSearchCompanyActivitiesResponse extends ToolResponse {
  output: {
    paginationToken: string | null
    activityType: string
    activities: Array<{
      activityId: string | null
      commentary: string | null
      linkedInUrl: string | null
      timeElapsed: string | null
      numReactions: number | null
      author: {
        name: string | null
        profileId: string | null
        profilePicture: string | null
      } | null
      reactionBreakdown: {
        likes: number
        empathy: number
        other: number
      }
      attachments: string[]
    }>
  }
}

export interface EnrichReverseHashLookupParams extends EnrichBaseParams {
  hash: string
}

export interface EnrichReverseHashLookupResponse extends ToolResponse {
  output: {
    hash: string
    email: string | null
    displayName: string | null
    found: boolean
  }
}

export interface EnrichSearchLogoParams extends EnrichBaseParams {
  url: string
}

export interface EnrichSearchLogoResponse extends ToolResponse {
  output: {
    logoUrl: string | null
    domain: string
  }
}
