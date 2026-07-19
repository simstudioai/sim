import { useCallback, useState } from 'react'
import { generateShortId } from '@sim/utils/id'
import type {
  ShareAuthType,
  ShareRecord,
  ShareResourceType,
} from '@/lib/api/contracts/public-shares'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { buildShareUrl } from '@/lib/public-shares/urls'

/** Not shared at all, or one of the four public share auth modes. */
export type ShareAccessMode = 'private' | ShareAuthType

/** ButtonGroup labels for {@link ShareAccessMode}. Shared so every share modal reads identically. */
export const SHARE_ACCESS_LABELS: Record<ShareAccessMode, string> = {
  private: 'Private',
  public: 'Public',
  password: 'Password',
  email: 'Email',
  sso: 'SSO',
}

/** The upsert payload a share modal sends, minus the resource identifiers. */
export interface ShareSavePayload {
  isActive: boolean
  authType?: ShareAuthType
  password?: string
  allowedEmails?: string[]
  token?: string
}

export interface UseShareModalStateArgs {
  resourceType: ShareResourceType
  /** Authoritative server state; `null` while loading or when no share exists. */
  saved: ShareRecord | null
  /** True once the share query has settled — gates the pre-reserved-token link. */
  isFetched: boolean
  /** Org policy read from `usePermissionConfig`. `null` allowedAuthTypes = all allowed. */
  policy: { disablePublicSharing: boolean; allowedAuthTypes: ShareAuthType[] | null }
}

export interface UseShareModalStateResult {
  mode: ShareAccessMode
  setMode: (mode: ShareAccessMode) => void
  /** Modes to render in the ButtonGroup — filtered by policy, plus the saved mode. */
  availableModes: ShareAccessMode[]
  password: string
  setPassword: (value: string) => void
  emails: string[]
  addEmail: (value: string) => boolean
  removeEmail: (value: string, index: number) => void
  /** `null` until a link can honestly be shown (existing share, or a settled empty fetch). */
  shareUrl: string | null
  isDirty: boolean
  passwordMissing: boolean
  emailsMissing: boolean
  modeDisallowed: boolean
  enableBlockedByPolicy: boolean
  canSave: boolean
  buildSavePayload: () => ShareSavePayload
  reset: () => void
}

/** Auth modes always offered; `sso` is appended only when the deployment enables it. */
const BASE_AUTH_TYPES = ['public', 'password', 'email'] as const

function toSavedMode(share: ShareRecord | null): ShareAccessMode {
  if (!share?.isActive) return 'private'
  return share.authType
}

/** True when an entry is a valid email or an `@domain` pattern. */
function isValidEmailEntry(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('@') || quickValidateEmail(normalized).isValid
}

/**
 * The share dialog's state machine, without any chrome.
 *
 * Every share modal (files, interfaces) renders from this so the pre-reserved
 * token, the null-until-touched drafts, the org-policy gates, and the save
 * payload cannot drift between resources. Drafts stay `null` until the user
 * touches a control, so each control keeps reflecting the authoritative saved
 * state even when the share query resolves after mount.
 *
 * Callers mount the modal fresh on each open (a derived mount from a URL param),
 * which is what reserves exactly one token per open.
 */
export function useShareModalState({
  resourceType,
  saved,
  isFetched,
  policy,
}: UseShareModalStateArgs): UseShareModalStateResult {
  /**
   * Reserved on mount so the link can be shown and copied before the first
   * save; persisted on save. Only surfaced once we've confirmed no share row
   * exists yet, so a copied link always matches what gets stored.
   */
  const [pendingToken] = useState(() => generateShortId())

  const [draftMode, setDraftMode] = useState<ShareAccessMode | null>(null)
  const [password, setPassword] = useState('')
  const [draftEmails, setDraftEmails] = useState<string[] | null>(null)

  const savedAccessMode = toSavedMode(saved)
  const mode = draftMode ?? savedAccessMode
  const isActive = mode !== 'private'
  const emails = draftEmails ?? saved?.allowedEmails ?? []

  const shareUrl = saved?.url ?? (isFetched ? buildShareUrl(resourceType, pendingToken) : null)

  /**
   * Org access-control may restrict which auth modes are allowed (`null` = all).
   * The route is the source of truth; this just hides disallowed options.
   */
  const isAuthTypeAllowed = (candidate: ShareAuthType) =>
    policy.allowedAuthTypes === null || policy.allowedAuthTypes.includes(candidate)

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED')) || savedAccessMode === 'sso'
  const candidateAuthTypes: ShareAuthType[] = [
    ...BASE_AUTH_TYPES,
    ...(ssoEnabled ? (['sso'] as const) : []),
  ]
  /** Keep the saved mode visible even if newly disallowed, so the current state shows. */
  const availableModes: ShareAccessMode[] = [
    'private',
    ...candidateAuthTypes.filter(
      (candidate) => isAuthTypeAllowed(candidate) || candidate === savedAccessMode
    ),
  ]

  /**
   * The selected mode is blocked when org policy disables public sharing
   * entirely (enabling a new share) or when the chosen auth mode isn't allowed.
   */
  const modeDisallowed = mode !== 'private' && !isAuthTypeAllowed(mode)
  const enableBlockedByPolicy = (policy.disablePublicSharing && !saved?.isActive) || modeDisallowed

  /** A password share needs a secret: either one already stored or a freshly typed one. */
  const passwordMissing = mode === 'password' && !saved?.hasPassword && password.trim().length === 0
  /** Email/SSO shares need at least one allowed email/domain. */
  const emailsMissing = (mode === 'email' || mode === 'sso') && emails.length === 0

  const emailsDirty =
    draftEmails !== null &&
    JSON.stringify(draftEmails) !== JSON.stringify(saved?.allowedEmails ?? [])
  const isDirty =
    (draftMode !== null && draftMode !== savedAccessMode) ||
    (mode === 'password' && password.length > 0) ||
    ((mode === 'email' || mode === 'sso') && emailsDirty)

  const canSave =
    isDirty && !passwordMissing && !emailsMissing && !(isActive && enableBlockedByPolicy)

  const addEmail = useCallback(
    (value: string): boolean => {
      const normalized = value.trim().toLowerCase()
      if (!normalized || emails.includes(normalized) || !isValidEmailEntry(normalized)) {
        return false
      }
      setDraftEmails([...emails, normalized])
      return true
    },
    [emails]
  )

  const removeEmail = useCallback(
    (_value: string, index: number) => {
      setDraftEmails(emails.filter((_, i) => i !== index))
    },
    [emails]
  )

  const buildSavePayload = useCallback((): ShareSavePayload => {
    /**
     * Persist the reserved token only when creating the row; existing shares
     * keep their own token (the server ignores this on conflict).
     */
    const token = saved ? undefined : pendingToken
    if (mode === 'private') return { isActive: false, token }
    if (mode === 'password') {
      return {
        isActive: true,
        authType: 'password',
        password: password.trim() || undefined,
        token,
      }
    }
    if (mode === 'email' || mode === 'sso') {
      return { isActive: true, authType: mode, allowedEmails: emails, token }
    }
    return { isActive: true, authType: 'public', token }
  }, [mode, password, emails, saved, pendingToken])

  const reset = useCallback(() => {
    setDraftMode(null)
    setPassword('')
    setDraftEmails(null)
  }, [])

  return {
    mode,
    setMode: setDraftMode,
    availableModes,
    password,
    setPassword,
    emails,
    addEmail,
    removeEmail,
    shareUrl,
    isDirty,
    passwordMissing,
    emailsMissing,
    modeDisallowed,
    enableBlockedByPolicy,
    canSave,
    buildSavePayload,
    reset,
  }
}
