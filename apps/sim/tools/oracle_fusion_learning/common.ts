import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { OAuthConfig, ToolConfig } from '@/tools/types'

export const credentials = {
  oauthCredential: { type: 'string', required: true, visibility: 'user-only', description: 'Oracle Fusion integration-user credential' },
  accessToken: { type: 'string', required: false, visibility: 'hidden', description: 'Opaque Basic credential injected by the executor' },
  instanceUrl: { type: 'string', required: false, visibility: 'hidden', description: 'Authoritative Oracle Fusion origin injected by the executor' },
} satisfies ToolConfig['params']

export const oauth: OAuthConfig = {
  required: true,
  provider: 'oracle_fusion_learning',
  requiredScopes: [],
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
}
export const internalExecution = {
  version: '1.0.0',
  oauth,
  operation: { input: createInternalToolOperationInput },
  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) throw new Error('Oracle Fusion Learning request failed')
    return data
  },
}

export const limit = {
  limit: { type: 'number', required: false, visibility: 'user-or-llm' as const, description: "Page size (default 20, maximum 100)" },
}

export const offset = {
  offset: { type: 'number', required: false, visibility: 'user-or-llm' as const, description: "Zero-based page offset" },
}

export const search = {
  search: { type: 'string', required: false, visibility: 'user-or-llm' as const, description: "Literal search text (maximum 200 characters)" },
}

export const effectiveDate = {
  effectiveDate: { type: 'string', required: false, visibility: 'user-or-llm' as const, description: "Read as of YYYY-MM-DD; sent only to resources supporting effectiveDate" },
}

export const learningItemId = {
  learningItemId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Learning Item Id as a positive decimal string" },
}

export const body = {
  body: { type: 'json', required: true, visibility: 'user-or-llm' as const, description: "Documented writable fields as a JSON object. IDs must be decimal strings. Omit unchanged fields; explicit null clears only nullable fields." },
}

export const eventId = {
  eventId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Event Id as a positive decimal string" },
}

export const activityId = {
  activityId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Activity Id as a positive decimal string" },
}

export const personId = {
  personId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Person Id as a positive decimal string" },
}

export const assignmentStatus = {
  assignmentStatus: { type: 'string', required: false, visibility: 'user-or-llm' as const, description: "Exact Oracle assignment status code" },
}

export const recordId = {
  recordId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Record Id as a positive decimal string" },
}

export const offeringRecordId = {
  offeringRecordId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Offering Record Id as a positive decimal string" },
}

export const completionDetailId = {
  completionDetailId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Completion Detail Id as a positive decimal string" },
}

export const profileId = {
  profileId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Profile Id as a positive decimal string" },
}

export const criterionId = {
  criterionId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Criterion Id as a positive decimal string" },
}

export const audienceId = {
  audienceId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Audience Id as a positive decimal string" },
}

export const contentId = {
  contentId: { type: 'string', required: true, visibility: 'user-or-llm' as const, description: "Content Id as a positive decimal string" },
}
