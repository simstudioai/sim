import type {
  AshbyApplication,
  AshbyCandidate,
  AshbyContactInfo,
  AshbyCustomField,
  AshbyFileHandle,
  AshbyHiringTeamMember,
  AshbyJob,
  AshbyOffer,
  AshbyOfferVersion,
  AshbyOpening,
  AshbyOpeningLatestVersion,
  AshbySourceSummary,
  AshbyUserSummary,
} from '@/tools/ashby/types'
import type { OutputProperty } from '@/tools/types'

type Unknown = Record<string, unknown>

function mapContact(raw: unknown): AshbyContactInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Unknown
  return {
    value: (c.value as string) ?? '',
    type: (c.type as string) ?? 'Other',
    isPrimary: (c.isPrimary as boolean) ?? true,
  }
}

function mapContactArray(raw: unknown): AshbyContactInfo[] {
  if (!Array.isArray(raw)) return []
  return raw.map((c) => mapContact(c)).filter((c): c is AshbyContactInfo => c !== null)
}

function mapCustomFields(raw: unknown): AshbyCustomField[] {
  if (!Array.isArray(raw)) return []
  return raw.map((f) => {
    const cf = f as Unknown
    return {
      id: (cf.id as string) ?? null,
      title: (cf.title as string) ?? '',
      isPrivate: (cf.isPrivate as boolean) ?? false,
      valueLabel: (cf.valueLabel as string) ?? null,
      value: cf.value ?? null,
    }
  })
}

function mapFileHandle(raw: unknown): AshbyFileHandle | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Unknown
  return {
    id: (f.id as string) ?? '',
    name: (f.name as string) ?? '',
    handle: (f.handle as string) ?? '',
  }
}

function mapFileHandles(raw: unknown): AshbyFileHandle[] {
  if (!Array.isArray(raw)) return []
  return raw.map((f) => mapFileHandle(f)).filter((f): f is AshbyFileHandle => f !== null)
}

export function mapUserSummary(raw: unknown): AshbyUserSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Unknown
  return {
    id: (u.id as string) ?? '',
    firstName: (u.firstName as string) ?? null,
    lastName: (u.lastName as string) ?? null,
    email: (u.email as string) ?? null,
    globalRole: (u.globalRole as string) ?? null,
    isEnabled: (u.isEnabled as boolean) ?? false,
    updatedAt: (u.updatedAt as string) ?? null,
    managerId: (u.managerId as string) ?? null,
  }
}

function mapSource(raw: unknown): AshbySourceSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Unknown
  const sourceType = s.sourceType as Unknown | undefined
  return {
    id: (s.id as string) ?? '',
    title: (s.title as string) ?? '',
    isArchived: (s.isArchived as boolean) ?? false,
    sourceType: sourceType
      ? {
          id: (sourceType.id as string) ?? '',
          title: (sourceType.title as string) ?? '',
          isArchived: (sourceType.isArchived as boolean) ?? false,
        }
      : null,
  }
}

export function mapCandidate(raw: unknown): AshbyCandidate {
  const c = (raw ?? {}) as Unknown
  const socialLinks = Array.isArray(c.socialLinks)
    ? (c.socialLinks as Array<{ type?: string; url?: string }>)
    : []
  const location = c.location as Unknown | undefined
  const locationComponents = Array.isArray(location?.locationComponents)
    ? (location?.locationComponents as Array<{ type?: string; name?: string }>)
    : []
  return {
    id: (c.id as string) ?? '',
    name: (c.name as string) ?? '',
    primaryEmailAddress: mapContact(c.primaryEmailAddress),
    primaryPhoneNumber: mapContact(c.primaryPhoneNumber),
    emailAddresses: mapContactArray(c.emailAddresses),
    phoneNumbers: mapContactArray(c.phoneNumbers),
    socialLinks: socialLinks.map((l) => ({
      type: l.type ?? '',
      url: l.url ?? '',
    })),
    linkedInUrl: socialLinks.find((l) => l.type === 'LinkedIn')?.url ?? null,
    githubUrl: socialLinks.find((l) => l.type === 'GitHub')?.url ?? null,
    profileUrl: (c.profileUrl as string) ?? null,
    position: (c.position as string) ?? null,
    company: (c.company as string) ?? null,
    school: (c.school as string) ?? null,
    timezone: (c.timezone as string) ?? null,
    location: location
      ? {
          id: (location.id as string) ?? null,
          locationSummary: (location.locationSummary as string) ?? null,
          locationComponents: locationComponents.map((lc) => ({
            type: lc.type ?? '',
            name: lc.name ?? '',
          })),
        }
      : null,
    tags: Array.isArray(c.tags)
      ? (c.tags as Array<{ id?: string; title?: string; isArchived?: boolean }>).map((t) => ({
          id: t.id ?? '',
          title: t.title ?? '',
          isArchived: t.isArchived ?? false,
        }))
      : [],
    applicationIds: Array.isArray(c.applicationIds) ? (c.applicationIds as string[]) : [],
    customFields: mapCustomFields(c.customFields),
    resumeFileHandle: mapFileHandle(c.resumeFileHandle),
    fileHandles: mapFileHandles(c.fileHandles),
    source: mapSource(c.source),
    creditedToUser: mapUserSummary(c.creditedToUser),
    fraudStatus: (c.fraudStatus as string) ?? null,
    createdAt: (c.createdAt as string) ?? null,
    updatedAt: (c.updatedAt as string) ?? null,
  }
}

function mapHiringTeam(raw: unknown): AshbyHiringTeamMember[] {
  if (!Array.isArray(raw)) return []
  return raw.map((m) => {
    const mem = m as Unknown
    return {
      email: (mem.email as string) ?? null,
      firstName: (mem.firstName as string) ?? null,
      lastName: (mem.lastName as string) ?? null,
      role: (mem.role as string) ?? null,
      userId: (mem.userId as string) ?? null,
    }
  })
}

function mapOpeningLatestVersion(raw: unknown): AshbyOpeningLatestVersion | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Unknown
  return {
    id: (v.id as string) ?? null,
    identifier: (v.identifier as string) ?? null,
    description: (v.description as string) ?? null,
    authorId: (v.authorId as string) ?? null,
    createdAt: (v.createdAt as string) ?? null,
    teamId: (v.teamId as string) ?? null,
    jobIds: Array.isArray(v.jobIds) ? (v.jobIds as string[]) : [],
    targetHireDate: (v.targetHireDate as string) ?? null,
    targetStartDate: (v.targetStartDate as string) ?? null,
    isBackfill: (v.isBackfill as boolean) ?? false,
    employmentType: (v.employmentType as string) ?? null,
    locationIds: Array.isArray(v.locationIds) ? (v.locationIds as string[]) : [],
    hiringTeam: mapHiringTeam(v.hiringTeam),
    customFields: mapCustomFields(v.customFields),
  }
}

export function mapOpenings(raw: unknown): AshbyOpening[] {
  if (!Array.isArray(raw)) return []
  return raw.map((o) => {
    const op = o as Unknown
    return {
      id: (op.id as string) ?? '',
      openedAt: (op.openedAt as string) ?? null,
      closedAt: (op.closedAt as string) ?? null,
      isArchived: (op.isArchived as boolean) ?? false,
      archivedAt: (op.archivedAt as string) ?? null,
      closeReasonId: (op.closeReasonId as string) ?? null,
      openingState: (op.openingState as string) ?? null,
      latestVersion: mapOpeningLatestVersion(op.latestVersion),
    }
  })
}

export function mapJob(raw: unknown): AshbyJob {
  const j = (raw ?? {}) as Unknown
  const location = j.location as Unknown | undefined
  const address = location?.address as Unknown | undefined
  const postalAddress = address?.postalAddress as Unknown | undefined
  const compensation = j.compensation as Unknown | undefined
  return {
    id: (j.id as string) ?? '',
    title: (j.title as string) ?? '',
    confidential: (j.confidential as boolean) ?? false,
    status: (j.status as string) ?? null,
    employmentType: (j.employmentType as string) ?? null,
    locationId: (j.locationId as string) ?? null,
    departmentId: (j.departmentId as string) ?? null,
    defaultInterviewPlanId: (j.defaultInterviewPlanId as string) ?? null,
    interviewPlanIds: Array.isArray(j.interviewPlanIds) ? (j.interviewPlanIds as string[]) : [],
    customFields: mapCustomFields(j.customFields),
    jobPostingIds: Array.isArray(j.jobPostingIds) ? (j.jobPostingIds as string[]) : [],
    customRequisitionId: (j.customRequisitionId as string) ?? null,
    brandId: (j.brandId as string) ?? null,
    hiringTeam: mapHiringTeam(j.hiringTeam),
    author: mapUserSummary(j.author),
    createdAt: (j.createdAt as string) ?? null,
    updatedAt: (j.updatedAt as string) ?? null,
    openedAt: (j.openedAt as string) ?? null,
    closedAt: (j.closedAt as string) ?? null,
    location: location
      ? {
          id: (location.id as string) ?? null,
          name: (location.name as string) ?? null,
          externalName: (location.externalName as string) ?? null,
          isArchived: (location.isArchived as boolean) ?? false,
          isRemote: (location.isRemote as boolean) ?? false,
          workplaceType: (location.workplaceType as string) ?? null,
          parentLocationId: (location.parentLocationId as string) ?? null,
          type: (location.type as string) ?? null,
          address: postalAddress
            ? {
                addressCountry: (postalAddress.addressCountry as string) ?? null,
                addressRegion: (postalAddress.addressRegion as string) ?? null,
                addressLocality: (postalAddress.addressLocality as string) ?? null,
                postalCode: (postalAddress.postalCode as string) ?? null,
                streetAddress: (postalAddress.streetAddress as string) ?? null,
              }
            : null,
        }
      : null,
    openings: mapOpenings(j.openings),
    compensation: compensation
      ? {
          compensationTiers: Array.isArray(compensation.compensationTiers)
            ? (
                compensation.compensationTiers as Array<{
                  id?: string
                  title?: string
                  additionalInformation?: string
                  tierSummary?: string
                }>
              ).map((t) => ({
                id: t.id ?? null,
                title: t.title ?? null,
                additionalInformation: t.additionalInformation ?? null,
                tierSummary: t.tierSummary ?? null,
              }))
            : [],
        }
      : null,
  }
}

export function mapApplication(raw: unknown): AshbyApplication {
  const a = (raw ?? {}) as Unknown
  const candidate = a.candidate as Unknown | undefined
  const job = a.job as Unknown | undefined
  const stage = a.currentInterviewStage as Unknown | undefined
  const archiveReason = a.archiveReason as Unknown | undefined
  return {
    id: (a.id as string) ?? '',
    createdAt: (a.createdAt as string) ?? null,
    updatedAt: (a.updatedAt as string) ?? null,
    status: (a.status as string) ?? '',
    customFields: mapCustomFields(a.customFields),
    candidate: {
      id: (candidate?.id as string) ?? '',
      name: (candidate?.name as string) ?? null,
      primaryEmailAddress: mapContact(candidate?.primaryEmailAddress),
      primaryPhoneNumber: mapContact(candidate?.primaryPhoneNumber),
    },
    currentInterviewStage: stage
      ? {
          id: (stage.id as string) ?? '',
          title: (stage.title as string) ?? null,
          type: (stage.type as string) ?? null,
          orderInInterviewPlan: (stage.orderInInterviewPlan as number) ?? null,
          interviewStageGroupId: (stage.interviewStageGroupId as string) ?? null,
          interviewPlanId: (stage.interviewPlanId as string) ?? null,
        }
      : null,
    source: mapSource(a.source),
    archiveReason: archiveReason
      ? {
          id: (archiveReason.id as string) ?? '',
          text: (archiveReason.text as string) ?? null,
          reasonType: (archiveReason.reasonType as string) ?? null,
          isArchived: (archiveReason.isArchived as boolean) ?? false,
          customFields: mapCustomFields(archiveReason.customFields),
        }
      : null,
    archivedAt: (a.archivedAt as string) ?? null,
    job: {
      id: (job?.id as string) ?? '',
      title: (job?.title as string) ?? null,
      locationId: (job?.locationId as string) ?? null,
      departmentId: (job?.departmentId as string) ?? null,
    },
    creditedToUser: mapUserSummary(a.creditedToUser),
    hiringTeam: mapHiringTeam(a.hiringTeam),
    appliedViaJobPostingId: (a.appliedViaJobPostingId as string) ?? null,
    submitterClientIp: (a.submitterClientIp as string) ?? null,
    submitterUserAgent: (a.submitterUserAgent as string) ?? null,
  }
}

export const CONTACT_INFO_OUTPUT = {
  type: 'object',
  description: 'Contact info',
  optional: true,
  properties: {
    value: { type: 'string', description: 'Value (email or phone number)' },
    type: { type: 'string', description: 'Contact type (Personal, Work, Other)' },
    isPrimary: { type: 'boolean', description: 'Whether this is the primary contact' },
  },
} as const satisfies OutputProperty

export const CUSTOM_FIELDS_OUTPUT = {
  type: 'array',
  description: 'Custom field values',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Custom field UUID' },
      title: { type: 'string', description: 'Field title' },
      isPrivate: { type: 'boolean', description: 'Whether the field is private' },
      valueLabel: { type: 'string', description: 'Human-readable value label', optional: true },
      value: { type: 'string', description: 'Raw field value (type depends on fieldType)' },
    },
  },
} as const satisfies OutputProperty

export const FILE_HANDLE_OUTPUT = {
  type: 'object',
  description: 'File reference',
  optional: true,
  properties: {
    id: { type: 'string', description: 'File UUID' },
    name: { type: 'string', description: 'File name' },
    handle: { type: 'string', description: 'File handle used with file.info' },
  },
} as const satisfies OutputProperty

export const FILE_HANDLES_OUTPUT = {
  type: 'array',
  description: 'File references',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'File UUID' },
      name: { type: 'string', description: 'File name' },
      handle: { type: 'string', description: 'File handle used with file.info' },
    },
  },
} as const satisfies OutputProperty

export const USER_SUMMARY_OUTPUT = {
  type: 'object',
  description: 'User summary',
  optional: true,
  properties: {
    id: { type: 'string', description: 'User UUID' },
    firstName: { type: 'string', description: 'First name', optional: true },
    lastName: { type: 'string', description: 'Last name', optional: true },
    email: { type: 'string', description: 'Email', optional: true },
    globalRole: { type: 'string', description: 'Role', optional: true },
    isEnabled: { type: 'boolean', description: 'Whether enabled' },
    updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
    managerId: { type: 'string', description: 'Manager user UUID', optional: true },
  },
} as const satisfies OutputProperty

export const SOURCE_SUMMARY_OUTPUT = {
  type: 'object',
  description: 'Attribution source',
  optional: true,
  properties: {
    id: { type: 'string', description: 'Source UUID' },
    title: { type: 'string', description: 'Source title' },
    isArchived: { type: 'boolean', description: 'Whether archived' },
    sourceType: {
      type: 'object',
      description: 'Source type grouping',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Source type UUID' },
        title: { type: 'string', description: 'Source type title' },
        isArchived: { type: 'boolean', description: 'Whether archived' },
      },
    },
  },
} as const satisfies OutputProperty

export const HIRING_TEAM_OUTPUT = {
  type: 'array',
  description: 'Hiring team members',
  items: {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'User UUID' },
      firstName: { type: 'string', description: 'First name' },
      lastName: { type: 'string', description: 'Last name' },
      email: { type: 'string', description: 'Email' },
      role: { type: 'string', description: 'Hiring team role' },
    },
  },
} as const satisfies OutputProperty

export const CANDIDATE_OUTPUTS = {
  id: { type: 'string', description: 'Candidate UUID' },
  name: { type: 'string', description: 'Full name' },
  primaryEmailAddress: { ...CONTACT_INFO_OUTPUT, description: 'Primary email contact info' },
  primaryPhoneNumber: { ...CONTACT_INFO_OUTPUT, description: 'Primary phone contact info' },
  emailAddresses: {
    type: 'array',
    description: 'All email addresses',
    items: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Email address' },
        type: { type: 'string', description: 'Contact type' },
        isPrimary: { type: 'boolean', description: 'Whether primary' },
      },
    },
  },
  phoneNumbers: {
    type: 'array',
    description: 'All phone numbers',
    items: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Phone number' },
        type: { type: 'string', description: 'Contact type' },
        isPrimary: { type: 'boolean', description: 'Whether primary' },
      },
    },
  },
  socialLinks: {
    type: 'array',
    description: 'Social network links',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Link type (LinkedIn, GitHub, Twitter, etc.)' },
        url: { type: 'string', description: 'Profile URL' },
      },
    },
  },
  linkedInUrl: { type: 'string', description: 'LinkedIn profile URL', optional: true },
  githubUrl: { type: 'string', description: 'GitHub profile URL', optional: true },
  profileUrl: { type: 'string', description: 'URL to the candidate Ashby profile', optional: true },
  position: { type: 'string', description: 'Current position or title', optional: true },
  company: { type: 'string', description: 'Current company', optional: true },
  school: { type: 'string', description: 'Most recent school', optional: true },
  timezone: { type: 'string', description: 'Candidate timezone', optional: true },
  location: {
    type: 'object',
    description: 'Candidate location',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Location UUID', optional: true },
      locationSummary: { type: 'string', description: 'Human-readable location summary' },
      locationComponents: {
        type: 'array',
        description: 'Structured location parts (city, region, country, etc.)',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Component type' },
            name: { type: 'string', description: 'Component value' },
          },
        },
      },
    },
  },
  tags: {
    type: 'array',
    description: 'Tags applied to the candidate',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Tag UUID' },
        title: { type: 'string', description: 'Tag title' },
        isArchived: { type: 'boolean', description: 'Whether archived' },
      },
    },
  },
  applicationIds: {
    type: 'array',
    description: 'IDs of associated applications',
    items: { type: 'string', description: 'Application UUID' },
  },
  customFields: CUSTOM_FIELDS_OUTPUT,
  resumeFileHandle: { ...FILE_HANDLE_OUTPUT, description: 'Resume file reference' },
  fileHandles: { ...FILE_HANDLES_OUTPUT, description: 'All uploaded file references' },
  source: SOURCE_SUMMARY_OUTPUT,
  creditedToUser: { ...USER_SUMMARY_OUTPUT, description: 'User credited with sourcing' },
  fraudStatus: { type: 'string', description: 'Fraud detection status', optional: true },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
  updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp' },
} as const satisfies Record<string, OutputProperty>

export const APPLICATION_OUTPUTS = {
  id: { type: 'string', description: 'Application UUID' },
  status: { type: 'string', description: 'Status (Active, Hired, Archived, Lead)' },
  customFields: CUSTOM_FIELDS_OUTPUT,
  candidate: {
    type: 'object',
    description: 'Associated candidate summary',
    properties: {
      id: { type: 'string', description: 'Candidate UUID' },
      name: { type: 'string', description: 'Candidate name' },
      primaryEmailAddress: { ...CONTACT_INFO_OUTPUT, description: 'Primary email' },
      primaryPhoneNumber: { ...CONTACT_INFO_OUTPUT, description: 'Primary phone' },
    },
  },
  currentInterviewStage: {
    type: 'object',
    description: 'Current interview stage',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Stage UUID' },
      title: { type: 'string', description: 'Stage title' },
      type: { type: 'string', description: 'Stage type' },
      orderInInterviewPlan: {
        type: 'number',
        description: 'Position in plan',
        optional: true,
      },
      interviewStageGroupId: { type: 'string', description: 'Stage group UUID', optional: true },
      interviewPlanId: { type: 'string', description: 'Interview plan UUID', optional: true },
    },
  },
  source: SOURCE_SUMMARY_OUTPUT,
  archiveReason: {
    type: 'object',
    description: 'Reason for archival (when archived)',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Reason UUID' },
      text: { type: 'string', description: 'Reason text' },
      reasonType: { type: 'string', description: 'Reason category' },
      isArchived: { type: 'boolean', description: 'Whether the reason is archived' },
      customFields: CUSTOM_FIELDS_OUTPUT,
    },
  },
  archivedAt: { type: 'string', description: 'ISO 8601 archive timestamp', optional: true },
  job: {
    type: 'object',
    description: 'Associated job summary',
    properties: {
      id: { type: 'string', description: 'Job UUID' },
      title: { type: 'string', description: 'Job title' },
      locationId: { type: 'string', description: 'Location UUID', optional: true },
      departmentId: { type: 'string', description: 'Department UUID', optional: true },
    },
  },
  creditedToUser: { ...USER_SUMMARY_OUTPUT, description: 'User credited with the application' },
  hiringTeam: HIRING_TEAM_OUTPUT,
  appliedViaJobPostingId: {
    type: 'string',
    description: 'Job posting UUID the candidate applied through',
    optional: true,
  },
  submitterClientIp: { type: 'string', description: 'Submitter IP address', optional: true },
  submitterUserAgent: {
    type: 'string',
    description: 'Submitter browser user agent',
    optional: true,
  },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
  updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp' },
} as const satisfies Record<string, OutputProperty>

export const OPENINGS_OUTPUT = {
  type: 'array',
  description: 'Headcount openings associated with the job',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Opening UUID' },
      openedAt: { type: 'string', description: 'Opening open timestamp', optional: true },
      closedAt: { type: 'string', description: 'Opening close timestamp', optional: true },
      isArchived: { type: 'boolean', description: 'Whether archived' },
      archivedAt: { type: 'string', description: 'Archive timestamp', optional: true },
      closeReasonId: { type: 'string', description: 'Close reason UUID', optional: true },
      openingState: {
        type: 'string',
        description: 'Opening state (Approved, Open, Filled, Closed, Draft)',
        optional: true,
      },
      latestVersion: {
        type: 'object',
        description: 'Latest opening version',
        optional: true,
        properties: {
          id: { type: 'string', description: 'Version UUID', optional: true },
          identifier: { type: 'string', description: 'Human-readable identifier' },
          description: { type: 'string', description: 'Opening description' },
          authorId: { type: 'string', description: 'Author user UUID', optional: true },
          createdAt: { type: 'string', description: 'Version creation timestamp', optional: true },
          teamId: { type: 'string', description: 'Team UUID', optional: true },
          jobIds: {
            type: 'array',
            description: 'Associated job UUIDs',
            items: { type: 'string', description: 'Job UUID' },
          },
          targetHireDate: { type: 'string', description: 'Target hire date', optional: true },
          targetStartDate: { type: 'string', description: 'Target start date', optional: true },
          isBackfill: { type: 'boolean', description: 'Whether this is a backfill opening' },
          employmentType: { type: 'string', description: 'Employment type', optional: true },
          locationIds: {
            type: 'array',
            description: 'Location UUIDs',
            items: { type: 'string', description: 'Location UUID' },
          },
          hiringTeam: HIRING_TEAM_OUTPUT,
          customFields: CUSTOM_FIELDS_OUTPUT,
        },
      },
    },
  },
} as const satisfies OutputProperty

function mapOfferVersion(raw: unknown): AshbyOfferVersion | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Unknown
  const salary = v.salary as Unknown | undefined
  return {
    id: (v.id as string) ?? null,
    startDate: (v.startDate as string) ?? null,
    salary: salary
      ? {
          currencyCode: (salary.currencyCode as string) ?? null,
          value: (salary.value as number) ?? null,
        }
      : null,
    createdAt: (v.createdAt as string) ?? null,
    openingId: (v.openingId as string) ?? null,
    customFields: mapCustomFields(v.customFields),
    fileHandles: mapFileHandles(v.fileHandles),
    author: mapUserSummary(v.author),
    approvalStatus: (v.approvalStatus as string) ?? null,
  }
}

export function mapOffer(raw: unknown): AshbyOffer {
  const r = (raw ?? {}) as Unknown
  return {
    id: (r.id as string) ?? '',
    decidedAt: (r.decidedAt as string) ?? null,
    applicationId: (r.applicationId as string) ?? null,
    acceptanceStatus: (r.acceptanceStatus as string) ?? null,
    offerStatus: (r.offerStatus as string) ?? null,
    latestVersion: mapOfferVersion(r.latestVersion),
  }
}

export const OFFER_OUTPUTS = {
  id: { type: 'string', description: 'Offer UUID' },
  decidedAt: {
    type: 'string',
    description: 'Timestamp the offer was decided',
    optional: true,
  },
  applicationId: {
    type: 'string',
    description: 'Associated application UUID',
    optional: true,
  },
  acceptanceStatus: {
    type: 'string',
    description: 'Acceptance status (Accepted, Declined, Pending, etc.)',
    optional: true,
  },
  offerStatus: {
    type: 'string',
    description: 'Offer status (e.g. WaitingOnCandidateResponse, CandidateAccepted)',
    optional: true,
  },
  latestVersion: {
    type: 'object',
    description: 'Most recent version of the offer with pricing and metadata',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Version UUID', optional: true },
      startDate: { type: 'string', description: 'Offer start date', optional: true },
      salary: {
        type: 'object',
        description: 'Salary details',
        optional: true,
        properties: {
          currencyCode: {
            type: 'string',
            description: 'ISO 4217 currency code',
            optional: true,
          },
          value: { type: 'number', description: 'Salary amount', optional: true },
        },
      },
      createdAt: {
        type: 'string',
        description: 'Version creation timestamp',
        optional: true,
      },
      openingId: {
        type: 'string',
        description: 'Associated opening UUID',
        optional: true,
      },
      customFields: CUSTOM_FIELDS_OUTPUT,
      fileHandles: {
        ...FILE_HANDLES_OUTPUT,
        description:
          'Offer letter file handles (unsigned .pdf, .docx, and signed .pdf when generated)',
      },
      author: { ...USER_SUMMARY_OUTPUT, description: 'User who authored the version' },
      approvalStatus: {
        type: 'string',
        description: 'Approval workflow status',
        optional: true,
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const JOB_OUTPUTS = {
  id: { type: 'string', description: 'Job UUID' },
  title: { type: 'string', description: 'Job title' },
  confidential: { type: 'boolean', description: 'Whether the job is confidential' },
  status: { type: 'string', description: 'Status (Open, Closed, Draft, Archived)', optional: true },
  employmentType: {
    type: 'string',
    description: 'Employment type (FullTime, PartTime, Intern, Contract, Temporary)',
    optional: true,
  },
  locationId: { type: 'string', description: 'Primary location UUID', optional: true },
  departmentId: { type: 'string', description: 'Department UUID', optional: true },
  defaultInterviewPlanId: {
    type: 'string',
    description: 'Default interview plan UUID',
    optional: true,
  },
  interviewPlanIds: {
    type: 'array',
    description: 'All interview plan UUIDs',
    items: { type: 'string', description: 'Interview plan UUID' },
  },
  customFields: CUSTOM_FIELDS_OUTPUT,
  jobPostingIds: {
    type: 'array',
    description: 'Associated job posting UUIDs',
    items: { type: 'string', description: 'Job posting UUID' },
  },
  customRequisitionId: {
    type: 'string',
    description: 'Custom requisition identifier',
    optional: true,
  },
  brandId: { type: 'string', description: 'Brand UUID', optional: true },
  hiringTeam: HIRING_TEAM_OUTPUT,
  author: { ...USER_SUMMARY_OUTPUT, description: 'Job author (creator)' },
  createdAt: { type: 'string', description: 'ISO 8601 creation timestamp', optional: true },
  updatedAt: { type: 'string', description: 'ISO 8601 last update timestamp', optional: true },
  openedAt: { type: 'string', description: 'ISO 8601 opened timestamp', optional: true },
  closedAt: { type: 'string', description: 'ISO 8601 closed timestamp', optional: true },
  location: {
    type: 'object',
    description: 'Primary location details',
    optional: true,
    properties: {
      id: { type: 'string', description: 'Location UUID', optional: true },
      name: { type: 'string', description: 'Location name', optional: true },
      externalName: { type: 'string', description: 'External display name', optional: true },
      isArchived: { type: 'boolean', description: 'Whether archived' },
      isRemote: { type: 'boolean', description: 'Whether remote' },
      workplaceType: {
        type: 'string',
        description: 'Workplace type (OnSite, Remote, Hybrid)',
        optional: true,
      },
      parentLocationId: {
        type: 'string',
        description: 'Parent location UUID',
        optional: true,
      },
      type: { type: 'string', description: 'Location type', optional: true },
      address: {
        type: 'object',
        description: 'Postal address',
        optional: true,
        properties: {
          addressCountry: { type: 'string', description: 'Country', optional: true },
          addressRegion: { type: 'string', description: 'State or region', optional: true },
          addressLocality: { type: 'string', description: 'City or locality', optional: true },
          postalCode: { type: 'string', description: 'Postal code', optional: true },
          streetAddress: { type: 'string', description: 'Street address', optional: true },
        },
      },
    },
  },
  openings: OPENINGS_OUTPUT,
  compensation: {
    type: 'object',
    description: 'Job compensation structure',
    optional: true,
    properties: {
      compensationTiers: {
        type: 'array',
        description: 'Compensation tiers',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Tier UUID', optional: true },
            title: { type: 'string', description: 'Tier title', optional: true },
            additionalInformation: {
              type: 'string',
              description: 'Additional info',
              optional: true,
            },
            tierSummary: { type: 'string', description: 'Tier summary', optional: true },
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>
