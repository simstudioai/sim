import {
  mapProject,
  PROJECT_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneCreateProjectParams,
  type RocketlaneProjectResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneCreateProjectTool: ToolConfig<
  RocketlaneCreateProjectParams,
  RocketlaneProjectResponse
> = {
  id: 'rocketlane_create_project',
  name: 'Rocketlane Create Project',
  description:
    'Create a new Rocketlane project with a customer, owner, dates, team members, templates, financials, and custom fields',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    projectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the project',
    },
    customerCompanyName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Name of the customer company (case-sensitive exact match; cannot be changed after creation)',
    },
    ownerUserId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User ID of the project owner (either ownerUserId or ownerEmailId must be provided)',
    },
    ownerEmailId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Email of the project owner (either ownerUserId or ownerEmailId must be provided)',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Date on which the project begins (YYYY-MM-DD); required when sources are provided',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Date on which the project is planned to complete (YYYY-MM-DD, on or after startDate)',
    },
    visibility: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Who can see the project: EVERYONE or MEMBERS',
    },
    statusValue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Value (identifier) of the project status',
    },
    memberUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of team members from your organization to add to the project',
      items: { type: 'number', description: 'User ID of a team member' },
    },
    customerUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of customer stakeholders to add to the project',
      items: { type: 'number', description: 'User ID of a customer' },
    },
    customerChampionUserId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID of the customer champion',
    },
    fields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom field assignments, each with fieldId and fieldValue (string, number, or number array matching the field type)',
      items: {
        type: 'object',
        description: 'Custom field assignment',
        properties: {
          fieldId: { type: 'number', description: 'Unique identifier of the field' },
          fieldValue: {
            type: 'string',
            description: 'Value of the field (string, number, or number array)',
          },
        },
      },
    },
    sources: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Project templates to import at creation, each with templateId, startDate (YYYY-MM-DD), and optional prefix',
      items: {
        type: 'object',
        description: 'Template source',
        properties: {
          templateId: { type: 'number', description: 'Unique identifier of the template' },
          startDate: { type: 'string', description: 'Date the template takes effect (YYYY-MM-DD)' },
          prefix: { type: 'string', description: 'Prefix distinguishing this template' },
        },
      },
    },
    placeholders: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Placeholder-to-user mappings, each with placeholderId and user ({ userId } or { emailId }); ignored unless the project is built from sources',
      items: {
        type: 'object',
        description: 'Placeholder mapping',
        properties: {
          placeholderId: { type: 'number', description: 'Unique identifier of the placeholder' },
          user: { type: 'object', description: 'User to assign ({ userId } or { emailId })' },
        },
      },
    },
    assignProjectOwner: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Automatically assign unassigned tasks to the project owner (skipped when no sources are used)',
    },
    annualizedRecurringRevenue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recurring revenue of the customer subscriptions for a single calendar year',
    },
    projectFee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Total fee charged for the project',
    },
    autoAllocation: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether auto allocation is enabled for the project',
    },
    autoCreateCompany: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create the customer company if it does not already exist',
    },
    budgetedHours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Total hours allocated for project execution (decimal, up to two places)',
    },
    contractType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Contract type for the project financials: FIXED_FEE, TIME_AND_MATERIAL, NON_BILLABLE, or SUBSCRIPTION',
    },
    fixedFee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project fee for FIXED_FEE contract type projects',
    },
    projectBudget: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project budget for TIME_AND_MATERIAL contract type projects',
    },
    rateCardId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rate card ID for TIME_AND_MATERIAL contract type projects',
    },
    subscriptionFrequency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Subscription renewal interval for SUBSCRIPTION contracts: MONTHLY, QUARTERLY, HALF_YEARLY, or YEARLY',
    },
    subscriptionStartDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date when the subscription interval begins (YYYY-MM-DD)',
    },
    periodMinutes: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Budgeted minutes for each subscription period',
    },
    periodBudget: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fixed budget of every subscription period',
    },
    noOfPeriods: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of periods in the subscription',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Currency for the project financials (ISO code, e.g. USD); cannot be changed once set',
    },
    externalReferenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identifier linking the project to an external system',
    },
    includeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra fields to return in the response (e.g. budgetedHours,progressPercentage)',
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response body',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/projects`)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null)
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      return url.toString()
    },
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        projectName: params.projectName,
        customer: { companyName: params.customerCompanyName },
      }
      if (params.ownerUserId == null && !params.ownerEmailId) {
        throw new Error('Either an owner user ID or an owner email is required to create a project')
      }
      const owner: Record<string, unknown> = {}
      if (params.ownerUserId != null) owner.userId = params.ownerUserId
      if (params.ownerEmailId) owner.emailId = params.ownerEmailId
      body.owner = owner
      if (params.startDate) body.startDate = params.startDate
      if (params.dueDate) body.dueDate = params.dueDate
      if (params.visibility) body.visibility = params.visibility
      if (params.statusValue != null) body.status = { value: params.statusValue }
      const teamMembers: Record<string, unknown> = {}
      if (params.memberUserIds && params.memberUserIds.length > 0) {
        teamMembers.members = params.memberUserIds.map((userId) => ({ userId }))
      }
      if (params.customerUserIds && params.customerUserIds.length > 0) {
        teamMembers.customers = params.customerUserIds.map((userId) => ({ userId }))
      }
      if (params.customerChampionUserId != null) {
        teamMembers.customerChampion = { userId: params.customerChampionUserId }
      }
      if (Object.keys(teamMembers).length > 0) body.teamMembers = teamMembers
      if (params.fields && params.fields.length > 0) body.fields = params.fields
      if (params.sources && params.sources.length > 0) body.sources = params.sources
      if (params.placeholders && params.placeholders.length > 0)
        body.placeholders = params.placeholders
      if (params.assignProjectOwner != null) body.assignProjectOwner = params.assignProjectOwner
      if (params.annualizedRecurringRevenue != null)
        body.annualizedRecurringRevenue = params.annualizedRecurringRevenue
      if (params.projectFee != null) body.projectFee = params.projectFee
      if (params.autoAllocation != null) body.autoAllocation = params.autoAllocation
      if (params.autoCreateCompany != null) body.autoCreateCompany = params.autoCreateCompany
      if (params.budgetedHours != null) body.budgetedHours = params.budgetedHours
      if (params.contractType) {
        const financials: Record<string, unknown> = { contractType: params.contractType }
        if (params.fixedFee != null) financials.fixedFeeContract = { fixedFee: params.fixedFee }
        const timeAndMaterialContract: Record<string, unknown> = {}
        if (params.rateCardId != null)
          timeAndMaterialContract.rateCard = { rateCardId: params.rateCardId }
        if (params.projectBudget != null)
          timeAndMaterialContract.projectBudget = params.projectBudget
        if (Object.keys(timeAndMaterialContract).length > 0)
          financials.timeAndMaterialContract = timeAndMaterialContract
        const subscriptionContract: Record<string, unknown> = {}
        if (params.subscriptionFrequency)
          subscriptionContract.subscriptionFrequency = params.subscriptionFrequency
        if (params.subscriptionStartDate)
          subscriptionContract.subscriptionStartDate = params.subscriptionStartDate
        if (params.periodMinutes != null) subscriptionContract.periodMinutes = params.periodMinutes
        if (params.periodBudget != null) subscriptionContract.periodBudget = params.periodBudget
        if (params.noOfPeriods != null) subscriptionContract.noOfPeriods = params.noOfPeriods
        if (Object.keys(subscriptionContract).length > 0)
          financials.subscriptionContract = subscriptionContract
        body.financials = financials
      }
      if (params.currency) body.currency = params.currency
      if (params.externalReferenceId) body.externalReferenceId = params.externalReferenceId
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { project: mapProject(data) },
    }
  },

  outputs: {
    project: {
      type: 'object',
      description: 'The created project',
      properties: PROJECT_OUTPUT_PROPERTIES,
    },
  },
}
