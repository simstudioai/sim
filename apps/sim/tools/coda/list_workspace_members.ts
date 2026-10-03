import type {
  CodaListWorkspaceMembersParams,
  CodaListWorkspaceMembersResponse,
  CodaWorkspaceMember,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  codaPath,
  joinListParam,
  NEXT_PAGE_TOKEN_OUTPUT,
  optionalTrimmed,
  PAGE_TOKEN_PARAM,
  WORKSPACE_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

type RawWorkspaceMember = Partial<CodaWorkspaceMember> & {
  email: string
  name: string
  role: string
  registeredAt: string
}

export const codaListWorkspaceMembersTool: ToolConfig<
  CodaListWorkspaceMembersParams,
  CodaListWorkspaceMembersResponse
> = {
  id: 'coda_list_workspace_members',
  name: 'Coda List Workspace Members',
  description:
    'List the members of a Coda workspace with their roles and doc activity, requesting user first. The workspace must belong to an organization.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    workspaceId: WORKSPACE_ID_PARAM,
    includedRoles: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return members with these roles, as an array or comma-separated list of "Admin", "DocMaker", "Editor"',
    },
    pageToken: PAGE_TOKEN_PARAM,
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaPath('workspaces', [params.workspaceId, 'workspaceId'], 'users'), {
        includedRoles: joinListParam(params.includedRoles, 'includedRoles'),
        pageToken: optionalTrimmed(params.pageToken),
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      items?: RawWorkspaceMember[]
      nextPageToken?: string
    }
    return {
      success: true,
      output: {
        members: (data.items ?? []).map((member) => ({
          email: member.email,
          name: member.name,
          role: member.role,
          pictureUrl: member.pictureUrl ?? null,
          registeredAt: member.registeredAt,
          roleChangedAt: member.roleChangedAt ?? null,
          lastActiveAt: member.lastActiveAt ?? null,
          ownedDocs: member.ownedDocs ?? null,
          docsLastActiveAt: member.docsLastActiveAt ?? null,
          docCollaboratorCount: member.docCollaboratorCount ?? null,
          totalDocs: member.totalDocs ?? null,
          totalDocsLastActiveAt: member.totalDocsLastActiveAt ?? null,
          totalDocCollaboratorsLast90Days: member.totalDocCollaboratorsLast90Days ?? null,
        })),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    members: {
      type: 'array',
      description: 'Workspace members',
      items: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address' },
          name: { type: 'string', description: 'Name' },
          role: { type: 'string', description: 'Workspace role (Admin, DocMaker, Editor)' },
          pictureUrl: { type: 'string', description: 'Avatar link', nullable: true },
          registeredAt: { type: 'string', description: 'When the user joined the workspace' },
          roleChangedAt: {
            type: 'string',
            description: 'When the role last changed',
            nullable: true,
          },
          lastActiveAt: {
            type: 'string',
            description: 'Date the user last acted in any workspace',
            nullable: true,
          },
          ownedDocs: {
            type: 'number',
            description: 'Docs the user owns in this workspace',
            nullable: true,
          },
          docsLastActiveAt: {
            type: 'string',
            description: 'Date anyone last accessed a doc the user owns',
            nullable: true,
          },
          docCollaboratorCount: {
            type: 'number',
            description: 'Collaborators on docs the user owns in the last 90 days',
            nullable: true,
          },
          totalDocs: {
            type: 'number',
            description: 'Docs the user owns, manages, or added pages to in the last 90 days',
            nullable: true,
          },
          totalDocsLastActiveAt: {
            type: 'string',
            description: 'Date anyone last accessed a doc the user owns or contributed to',
            nullable: true,
          },
          totalDocCollaboratorsLast90Days: {
            type: 'number',
            description: 'Unique viewers of docs the user owns, manages, or added pages to',
            nullable: true,
          },
        },
      },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
