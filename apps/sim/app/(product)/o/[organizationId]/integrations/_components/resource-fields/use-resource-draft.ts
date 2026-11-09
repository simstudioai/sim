'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'

type LibraryResource = Exclude<IntegrationResource, { kind: 'credential' }>

export interface SkillDefaults {
  name: string
  description: string
  instructions: string
  source: { providerId: string; name: string }
}

interface ResourceDraftOptions {
  kind: LibraryResource['kind']
  data: IntegrationCenterData
  resource?: LibraryResource
  skillDefaults?: SkillDefaults
}

export function useResourceDraft({ kind, data, resource, skillDefaults }: ResourceDraftOptions) {
  const saved = {
    name: resource?.name ?? skillDefaults?.name ?? '',
    description: resource?.description ?? skillDefaults?.description ?? '',
    instructions:
      resource?.kind === 'skill' ? resource.instructions : (skillDefaults?.instructions ?? ''),
    url: resource?.kind === 'mcp' ? resource.url : '',
    auth: resource?.kind === 'mcp' ? resource.auth : ('none' as const),
    scope: resource?.scope ?? ('personal' as const),
    people:
      resource?.people
        .filter((person) => person.id !== resource.owner.id)
        .map((person) => person.id) ?? [],
  }
  const [draft, setDraft] = useState(saved)
  const [token, setToken] = useState('')
  const tokenRequired =
    kind === 'mcp' &&
    draft.auth === 'bearer' &&
    (resource?.kind !== 'mcp' || resource.auth !== 'bearer')
  const editable = resource?.canEdit !== false
  const dirty =
    editable &&
    (Boolean(token) ||
      draft.name !== saved.name ||
      draft.description !== saved.description ||
      draft.instructions !== saved.instructions ||
      draft.url !== saved.url ||
      draft.auth !== saved.auth ||
      draft.scope !== saved.scope ||
      draft.people.length !== saved.people.length ||
      draft.people.some((person) => !saved.people.includes(person)))

  function value(): LibraryResource {
    if (!editable) throw new Error('You do not have permission to edit this resource.')
    const name = draft.name.trim()
    if (!name) throw new Error('Enter a name.')
    if (draft.scope === 'shared' && !draft.people.length)
      throw new Error('Choose at least one person to share with.')
    const owner = resource?.owner ?? data.viewer
    const identity = {
      id: resource?.id ?? generateId(),
      name,
      description: draft.description.trim(),
      scope: draft.scope,
      owner,
      people:
        draft.scope === 'shared'
          ? data.people.filter(
              (person) => draft.people.includes(person.id) || person.id === owner.id
            )
          : [owner],
      canEdit: editable,
    }
    if (kind === 'skill') {
      const instructions = draft.instructions.trim()
      if (!instructions) throw new Error('Add instructions for this skill.')
      return {
        ...identity,
        kind,
        instructions,
        source: resource?.kind === 'skill' ? resource.source : skillDefaults?.source,
      }
    }
    let url: URL
    try {
      url = new URL(draft.url.trim())
    } catch {
      throw new Error('Enter an HTTP or HTTPS server URL without credentials.')
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Enter an HTTP or HTTPS server URL without credentials.')
    if (tokenRequired && !token.trim()) throw new Error('Enter a bearer token.')
    return { ...identity, kind, url: url.toString(), auth: draft.auth }
  }

  return {
    draft,
    setDraft,
    token,
    setToken,
    tokenRequired,
    editable,
    dirty,
    reset: () => {
      setDraft(saved)
      setToken('')
    },
    value,
  }
}
