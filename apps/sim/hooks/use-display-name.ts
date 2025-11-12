import { useCallback, useEffect, useState } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { useDisplayNamesStore } from '@/stores/display-names/store'
import { useKnowledgeStore } from '@/stores/knowledge/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Generic hook to get display name for any selector value
 * Automatically fetches if not cached
 */
export function useDisplayName(
  subBlock: SubBlockConfig | undefined,
  value: unknown,
  context?: {
    workspaceId?: string
    credentialId?: string
    provider?: string
    knowledgeBaseId?: string
    domain?: string
    teamId?: string
    projectId?: string
    planId?: string
  }
): string | null {
  const getCachedKnowledgeBase = useKnowledgeStore((state) => state.getCachedKnowledgeBase)
  const getKnowledgeBase = useKnowledgeStore((state) => state.getKnowledgeBase)
  const getDocuments = useKnowledgeStore((state) => state.getDocuments)
  const [isFetching, setIsFetching] = useState(false)

  const cachedDisplayName = useDisplayNamesStore(
    useCallback(
      (state) => {
        if (!subBlock || !value || typeof value !== 'string') return null

        // Channels
        if (subBlock.type === 'channel-selector' && context?.credentialId) {
          return state.cache.channels[context.credentialId]?.[value] || null
        }

        // Workflows
        if (subBlock.id === 'workflowId') {
          return state.cache.workflows.global?.[value] || null
        }

        // Files
        if (subBlock.type === 'file-selector' && context?.credentialId) {
          return state.cache.files[context.credentialId]?.[value] || null
        }

        // Folders
        if (subBlock.type === 'folder-selector' && context?.credentialId) {
          return state.cache.folders[context.credentialId]?.[value] || null
        }

        // Projects
        if (subBlock.type === 'project-selector' && context?.provider && context?.credentialId) {
          const projectContext = `${context.provider}-${context.credentialId}`
          return state.cache.projects[projectContext]?.[value] || null
        }

        // Documents
        if (subBlock.type === 'document-selector' && context?.knowledgeBaseId) {
          return state.cache.documents[context.knowledgeBaseId]?.[value] || null
        }

        return null
      },
      [subBlock, value, context?.credentialId, context?.provider, context?.knowledgeBaseId]
    )
  )

  // Auto-fetch knowledge bases if needed
  useEffect(() => {
    if (
      subBlock?.type === 'knowledge-base-selector' &&
      typeof value === 'string' &&
      value &&
      !isFetching
    ) {
      const kb = getCachedKnowledgeBase(value)
      if (!kb) {
        setIsFetching(true)
        getKnowledgeBase(value)
          .catch(() => {
            // Silently fail
          })
          .finally(() => {
            setIsFetching(false)
          })
      }
    }
  }, [subBlock?.type, value, isFetching, getCachedKnowledgeBase, getKnowledgeBase])

  // Auto-fetch documents if needed
  useEffect(() => {
    if (
      subBlock?.type === 'document-selector' &&
      context?.knowledgeBaseId &&
      typeof value === 'string' &&
      value &&
      !cachedDisplayName &&
      !isFetching
    ) {
      setIsFetching(true)
      getDocuments(context.knowledgeBaseId)
        .then((docs) => {
          if (docs.length > 0) {
            const documentMap = docs.reduce<Record<string, string>>((acc, doc) => {
              acc[doc.id] = doc.filename
              return acc
            }, {})
            useDisplayNamesStore
              .getState()
              .setDisplayNames('documents', context.knowledgeBaseId!, documentMap)
          }
        })
        .catch(() => {
          // Silently fail
        })
        .finally(() => {
          setIsFetching(false)
        })
    }
  }, [subBlock?.type, value, context?.knowledgeBaseId, cachedDisplayName, isFetching, getDocuments])

  // Auto-fetch workflows if needed
  useEffect(() => {
    if (subBlock?.id !== 'workflowId' || typeof value !== 'string' || !value) return
    if (cachedDisplayName || isFetching) return

    const workflows = useWorkflowRegistry.getState().workflows
    if (!workflows[value]) return

    const workflowMap = Object.entries(workflows).reduce<Record<string, string>>(
      (acc, [id, workflow]) => {
        acc[id] = workflow.name || `Workflow ${id.slice(0, 8)}`
        return acc
      },
      {}
    )

    useDisplayNamesStore.getState().setDisplayNames('workflows', 'global', workflowMap)
  }, [subBlock?.id, value, cachedDisplayName, isFetching])

  // Auto-fetch channels if needed
  useEffect(() => {
    if (subBlock?.type !== 'channel-selector' || !context?.credentialId || !value) return
    if (cachedDisplayName || isFetching) return

    setIsFetching(true)
    fetch('/api/tools/slack/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: context.credentialId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.channels) {
          const channelMap = data.channels.reduce(
            (acc: Record<string, string>, ch: { id: string; name: string }) => {
              acc[ch.id] = ch.name
              return acc
            },
            {}
          )
          useDisplayNamesStore
            .getState()
            .setDisplayNames('channels', context.credentialId!, channelMap)
        }
      })
      .catch(() => {
        // Silently fail
      })
      .finally(() => {
        setIsFetching(false)
      })
  }, [subBlock?.type, value, context?.credentialId, cachedDisplayName, isFetching])

  // Auto-fetch folders if needed (Gmail/Outlook)
  useEffect(() => {
    if (subBlock?.type !== 'folder-selector' || !context?.credentialId || !value) return
    if (cachedDisplayName || isFetching) return

    setIsFetching(true)
    const provider = subBlock.provider || 'gmail'
    const apiEndpoint =
      provider === 'outlook'
        ? `/api/tools/outlook/folders?credentialId=${context.credentialId}`
        : `/api/tools/gmail/labels?credentialId=${context.credentialId}`

    fetch(apiEndpoint)
      .then((res) => res.json())
      .then((data) => {
        const folderList = provider === 'outlook' ? data.folders : data.labels
        if (folderList) {
          const folderMap = folderList.reduce(
            (acc: Record<string, string>, folder: { id: string; name: string }) => {
              acc[folder.id] = folder.name
              return acc
            },
            {}
          )
          useDisplayNamesStore
            .getState()
            .setDisplayNames('folders', context.credentialId!, folderMap)
        }
      })
      .catch(() => {
        // Silently fail
      })
      .finally(() => {
        setIsFetching(false)
      })
  }, [
    subBlock?.type,
    subBlock?.provider,
    value,
    context?.credentialId,
    cachedDisplayName,
    isFetching,
  ])

  // Auto-fetch projects if needed (Jira, Linear)
  useEffect(() => {
    if (
      subBlock?.type !== 'project-selector' ||
      !context?.credentialId ||
      !context?.provider ||
      !value
    )
      return
    if (cachedDisplayName || isFetching) return

    const projectContext = `${context.provider}-${context.credentialId}`
    setIsFetching(true)

    if (context.provider === 'jira' && context.domain && context.credentialId) {
      // Fetch access token then get project info
      fetch('/api/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: context.credentialId }),
      })
        .then((res) => res.json())
        .then((tokenData) => {
          if (!tokenData.accessToken) throw new Error('No access token')
          return fetch('/api/tools/jira/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              domain: context.domain,
              accessToken: tokenData.accessToken,
              projectId: value,
            }),
          })
        })
        .then((res) => res.json())
        .then((data) => {
          if (data.project) {
            useDisplayNamesStore
              .getState()
              .setDisplayNames('projects', projectContext, { [value as string]: data.project.name })
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    } else if (context.provider === 'linear' && context.teamId) {
      fetch('/api/tools/linear/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: context.credentialId, teamId: context.teamId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.projects) {
            const projectMap = data.projects.reduce(
              (acc: Record<string, string>, proj: { id: string; name: string }) => {
                acc[proj.id] = proj.name
                return acc
              },
              {}
            )
            useDisplayNamesStore.getState().setDisplayNames('projects', projectContext, projectMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    } else {
      setIsFetching(false)
    }
  }, [
    subBlock?.type,
    value,
    context?.credentialId,
    context?.provider,
    context?.domain,
    context?.teamId,
  ])

  // Auto-fetch files if needed (provider-specific)
  useEffect(() => {
    if (subBlock?.type !== 'file-selector' || !context?.credentialId || !value) return
    if (cachedDisplayName || isFetching) return

    setIsFetching(true)
    const provider = subBlock.provider || context.provider
    const serviceId = subBlock.serviceId

    // Google Calendar
    if (provider === 'google-calendar') {
      fetch(`/api/tools/google_calendar/calendars?credentialId=${context.credentialId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.calendars) {
            const calendarMap = data.calendars.reduce(
              (acc: Record<string, string>, cal: { id: string; summary: string }) => {
                acc[cal.id] = cal.summary
                return acc
              },
              {}
            )
            useDisplayNamesStore
              .getState()
              .setDisplayNames('files', context.credentialId!, calendarMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // Jira issues
    else if (provider === 'jira' && context.domain && context.projectId && context.credentialId) {
      // Fetch access token then get issue info
      fetch('/api/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: context.credentialId }),
      })
        .then((res) => res.json())
        .then((tokenData) => {
          if (!tokenData.accessToken) throw new Error('No access token')
          return fetch('/api/tools/jira/issues', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              domain: context.domain,
              accessToken: tokenData.accessToken,
              issueKeys: [value],
            }),
          })
        })
        .then((res) => res.json())
        .then((data) => {
          if (data.issues?.[0]) {
            useDisplayNamesStore.getState().setDisplayNames('files', context.credentialId!, {
              [value as string]: data.issues[0].name,
            })
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // Confluence pages
    else if (provider === 'confluence' && context.domain && context.credentialId) {
      // Fetch access token then get page info
      fetch('/api/auth/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: context.credentialId }),
      })
        .then((res) => res.json())
        .then((tokenData) => {
          if (!tokenData.accessToken) throw new Error('No access token')
          return fetch('/api/tools/confluence/page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              domain: context.domain,
              accessToken: tokenData.accessToken,
              pageId: value,
            }),
          })
        })
        .then((res) => res.json())
        .then((data) => {
          if (data.id && data.title) {
            useDisplayNamesStore.getState().setDisplayNames('files', context.credentialId!, {
              [data.id]: data.title,
            })
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // Microsoft Teams
    else if (provider === 'microsoft-teams' && context.credentialId) {
      fetch('/api/tools/microsoft-teams/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: context.credentialId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.teams) {
            const teamMap = data.teams.reduce(
              (acc: Record<string, string>, team: { id: string; displayName: string }) => {
                acc[team.id] = team.displayName
                return acc
              },
              {}
            )
            useDisplayNamesStore.getState().setDisplayNames('files', context.credentialId!, teamMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // Wealthbox
    else if (provider === 'wealthbox' && context.credentialId) {
      fetch(`/api/tools/wealthbox/items?credentialId=${context.credentialId}&type=contact`)
        .then((res) => res.json())
        .then((data) => {
          if (data.items) {
            const contactMap = data.items.reduce(
              (acc: Record<string, string>, item: { id: string; name: string }) => {
                acc[item.id] = item.name
                return acc
              },
              {}
            )
            useDisplayNamesStore
              .getState()
              .setDisplayNames('files', context.credentialId!, contactMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // OneDrive files
    else if (serviceId === 'onedrive' && subBlock.mimeType === 'file') {
      fetch(`/api/tools/onedrive/files?credentialId=${context.credentialId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.files) {
            const fileMap = data.files.reduce(
              (acc: Record<string, string>, file: { id: string; name: string }) => {
                acc[file.id] = file.name
                return acc
              },
              {}
            )
            useDisplayNamesStore.getState().setDisplayNames('files', context.credentialId!, fileMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // OneDrive folders
    else if (serviceId === 'onedrive' && subBlock.mimeType !== 'file') {
      fetch(`/api/tools/onedrive/folders?credentialId=${context.credentialId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.files) {
            const fileMap = data.files.reduce(
              (acc: Record<string, string>, file: { id: string; name: string }) => {
                acc[file.id] = file.name
                return acc
              },
              {}
            )
            useDisplayNamesStore.getState().setDisplayNames('files', context.credentialId!, fileMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // SharePoint sites
    else if (serviceId === 'sharepoint') {
      fetch(`/api/tools/sharepoint/sites?credentialId=${context.credentialId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.files) {
            const fileMap = data.files.reduce(
              (acc: Record<string, string>, file: { id: string; name: string }) => {
                acc[file.id] = file.name
                return acc
              },
              {}
            )
            useDisplayNamesStore.getState().setDisplayNames('files', context.credentialId!, fileMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // Microsoft Excel/Word
    else if (provider === 'microsoft-excel' || provider === 'microsoft-word') {
      fetch(`/api/auth/oauth/microsoft/files?credentialId=${context.credentialId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.files) {
            const fileMap = data.files.reduce(
              (acc: Record<string, string>, file: { id: string; name: string }) => {
                acc[file.id] = file.name
                return acc
              },
              {}
            )
            useDisplayNamesStore.getState().setDisplayNames('files', context.credentialId!, fileMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // Microsoft Planner tasks
    else if (provider === 'microsoft-planner' && context.planId) {
      fetch(
        `/api/tools/microsoft_planner/tasks?credentialId=${context.credentialId}&planId=${context.planId}`
      )
        .then((res) => res.json())
        .then((data) => {
          if (data.tasks) {
            const taskMap = data.tasks.reduce(
              (acc: Record<string, string>, task: { id: string; title: string }) => {
                acc[task.id] = task.title
                return acc
              },
              {}
            )
            useDisplayNamesStore.getState().setDisplayNames('files', context.credentialId!, taskMap)
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    }
    // Google Drive files/folders (fetch by ID since no list endpoint via Picker API)
    else if (
      (provider === 'google-drive' || subBlock.serviceId === 'google-drive') &&
      typeof value === 'string' &&
      value
    ) {
      const queryParams = new URLSearchParams({
        credentialId: context.credentialId,
        fileId: value,
      })
      fetch(`/api/tools/drive/file?${queryParams.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.file?.id && data.file.name) {
            useDisplayNamesStore
              .getState()
              .setDisplayNames('files', context.credentialId!, { [data.file.id]: data.file.name })
          }
        })
        .catch(() => {})
        .finally(() => setIsFetching(false))
    } else {
      setIsFetching(false)
    }
  }, [
    subBlock?.type,
    subBlock?.provider,
    subBlock?.serviceId,
    subBlock?.mimeType,
    value,
    context?.credentialId,
    context?.provider,
    context?.domain,
    context?.projectId,
    context?.teamId,
    context?.planId,
  ])

  if (!subBlock || !value || typeof value !== 'string') {
    return null
  }

  // Credentials - handled separately by useCredentialDisplay
  if (subBlock.type === 'oauth-input') {
    return null
  }

  // Knowledge Bases - use existing knowledge store
  if (subBlock.type === 'knowledge-base-selector') {
    const kb = getCachedKnowledgeBase(value)
    return kb?.name || null
  }

  // Return the cached display name (which triggers re-render when populated)
  return cachedDisplayName
}
