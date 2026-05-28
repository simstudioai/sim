'use client'

import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  InfoCard,
  InfoCardItem,
  InfoCardList,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { writeOAuthReturnContext } from '@/lib/credentials/client-state'
import { getScopeDescription } from '@/lib/oauth/utils'
import { useCreateCredentialDraft, useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useConnectOAuthService } from '@/hooks/queries/oauth/oauth-connections'

const logger = createLogger('ConnectOAuthModal')

/** Server-enforced max for `WorkspaceCredential.displayName` — see `lib/api/contracts/credentials.ts`. */
const DISPLAY_NAME_MAX_LENGTH = 255

/**
 * Reserved tail budget when truncating the username so the auto-numbering
 * disambiguator (e.g. `" 9999"`) always fits within {@link DISPLAY_NAME_MAX_LENGTH}.
 */
const COLLISION_SUFFIX_RESERVATION = 5

/** Upper bound for the auto-numbering search — pathological if ever reached. */
const MAX_COLLISION_INDEX = 10000

/** Scopes hidden from the permissions list — always present on Google flows. */
function isHiddenScope(scope: string): boolean {
  return scope.includes('userinfo.email') || scope.includes('userinfo.profile')
}

/**
 * Default credential display name. Produces `"{Name}'s {Service}"` when the
 * user's name is known, falling back to `"My {Service}"` otherwise. The
 * username is truncated so the full string (including any auto-numbering
 * disambiguator) stays within {@link DISPLAY_NAME_MAX_LENGTH}.
 *
 * When the base name collides with an existing credential in `takenNames`,
 * `" 2"`, `" 3"`, ... are appended until an unused name is found. Comparison
 * is case-insensitive to match the duplicate-detection used elsewhere in the
 * modal.
 */
function defaultDisplayName(
  userName: string | null | undefined,
  serviceName: string,
  takenNames: ReadonlySet<string>
): string {
  const trimmed = userName?.trim()
  let base: string
  if (trimmed) {
    const suffix = `'s ${serviceName}`
    const nameBudget = Math.max(
      0,
      DISPLAY_NAME_MAX_LENGTH - suffix.length - COLLISION_SUFFIX_RESERVATION
    )
    const safeName = trimmed.length > nameBudget ? trimmed.slice(0, nameBudget) : trimmed
    base = `${safeName}${suffix}`
  } else {
    base = `My ${serviceName}`
  }

  if (!takenNames.has(base.toLowerCase())) return base
  for (let n = 2; n < MAX_COLLISION_INDEX; n++) {
    const candidate = `${base} ${n}`
    if (!takenNames.has(candidate.toLowerCase())) return candidate
  }
  return base
}

interface ConnectOAuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  providerId: string
  requiredScopes: readonly string[]
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
}

/**
 * Connect-OAuth modal mounted by any page that initiates an OAuth credential.
 * Self-contained: takes the resolved provider + scopes from the caller, writes
 * the integrations-origin return context, and hands off to Better Auth via
 * `useConnectOAuthService`. After the redirect lands back on `window.location.href`,
 * the host page's `useOAuthReturnRouter` consumes the return context.
 */
export function ConnectOAuthModal({
  open,
  onOpenChange,
  workspaceId,
  providerId,
  requiredScopes,
  serviceName,
  serviceIcon,
}: ConnectOAuthModalProps) {
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: session } = useSession()
  const userName = session?.user?.name

  const { data: credentials = [], isPending: credentialsLoading } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId) && open,
  })
  const createDraft = useCreateCredentialDraft()
  const connectOAuthService = useConnectOAuthService()

  /**
   * Lowercased set of OAuth credential names already in the workspace. Drives
   * both the prefill's auto-numbering and the inline duplicate-name error.
   */
  const takenNames = useMemo(
    () =>
      new Set(
        credentials
          .filter((credential) => credential.type === 'oauth')
          .map((credential) => credential.displayName.toLowerCase())
      ),
    [credentials]
  )

  /**
   * Initialize the form once per open session, after credentials have loaded
   * so auto-numbering can see them. The `prefilled` ref ensures session
   * refetches or other prop churn while the modal is open won't overwrite
   * the user's typed value.
   */
  const prefilled = useRef(false)
  useEffect(() => {
    if (!open) {
      prefilled.current = false
      return
    }
    if (prefilled.current || credentialsLoading) return
    prefilled.current = true
    setDisplayName(defaultDisplayName(userName, serviceName, takenNames))
    setDescription('')
    setValidationError(null)
    setSubmitError(null)
  }, [open, credentialsLoading, userName, serviceName, takenNames])

  const displayScopes = useMemo(
    () => requiredScopes.filter((scope) => !isHiddenScope(scope)),
    [requiredScopes]
  )

  const existingCredential = useMemo(() => {
    const name = displayName.trim().toLowerCase()
    if (!name || !takenNames.has(name)) return null
    return (
      credentials.find((row) => row.type === 'oauth' && row.displayName.toLowerCase() === name) ??
      null
    )
  }, [credentials, displayName, takenNames])

  const handleConnect = async () => {
    const trimmed = displayName.trim()
    if (!trimmed) {
      setValidationError('Display name is required.')
      return
    }
    setValidationError(null)
    setSubmitError(null)
    try {
      await createDraft.mutateAsync({
        workspaceId,
        providerId,
        displayName: trimmed,
        description: description.trim() || undefined,
      })

      const preCount = credentials.filter(
        (c) => c.type === 'oauth' && c.providerId === providerId
      ).length

      writeOAuthReturnContext({
        origin: 'integrations',
        displayName: trimmed,
        providerId,
        preCount,
        workspaceId,
        requestedAt: Date.now(),
      })

      await connectOAuthService.mutateAsync({
        providerId,
        callbackURL: window.location.href,
      })
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to start OAuth connection')
      setSubmitError(message)
      logger.error('Failed to connect OAuth service', err)
    }
  }

  const isPending = connectOAuthService.isPending
  const isDisabled = !displayName.trim() || isPending || Boolean(existingCredential)

  const displayNameError =
    validationError ??
    (existingCredential
      ? `An integration named "${existingCredential.displayName}" already exists.`
      : undefined)

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={`Connect ${serviceName}`}>
      <ChipModalHeader icon={serviceIcon} onClose={() => onOpenChange(false)}>
        Connect {serviceName}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={(value) => {
            setDisplayName(value)
            if (validationError) setValidationError(null)
          }}
          placeholder='Integration name'
          autoComplete='off'
          required
          error={displayNameError}
        />

        <ChipModalField
          type='textarea'
          title='Description'
          value={description}
          onChange={setDescription}
          placeholder='Optional description'
          maxLength={500}
          minHeight={80}
        />

        {displayScopes.length > 0 && (
          <ChipModalField type='custom' title='Permissions requested'>
            <InfoCard>
              <InfoCardList>
                {displayScopes.map((scope) => (
                  <InfoCardItem key={scope}>{getScopeDescription(scope)}</InfoCardItem>
                ))}
              </InfoCardList>
            </InfoCard>
          </ChipModalField>
        )}

        <ChipModalError>{submitError}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter>
        <Chip variant='ghost' onClick={() => onOpenChange(false)}>
          Cancel
        </Chip>
        <Chip variant='primary' onClick={handleConnect} disabled={isDisabled}>
          {isPending ? 'Connecting...' : 'Connect'}
        </Chip>
      </ChipModalFooter>
    </ChipModal>
  )
}
