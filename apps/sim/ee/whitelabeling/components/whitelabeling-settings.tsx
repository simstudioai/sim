'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { toError } from '@sim/utils/errors'
import { Image as ImageIcon, X } from 'lucide-react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { Button, ChipInput, Label, Loader, toast } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { HEX_COLOR_REGEX } from '@/lib/branding'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { cn } from '@/lib/core/utils/cn'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import {
  CHIP_FIELD_INPUT,
  CHIP_FIELD_SHELL,
} from '@/app/workspace/[workspaceId]/components/credential-detail'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/settings/hooks/use-profile-picture-upload'
import { SettingRow } from '@/ee/components/setting-row'
import {
  useUpdateWhitelabelSettings,
  useWhitelabelSettings,
  type WhitelabelSettingsPayload,
} from '@/ee/whitelabeling/hooks/whitelabel'
import { useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'

const logger = createLogger('WhitelabelingSettings')

interface DropZoneProps {
  onDrop: (e: React.DragEvent) => void
  children: React.ReactNode
  className?: string
}

function DropZone({ onDrop, children, className }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  return (
    <div
      className={cn('relative', className)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setIsDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false)
        }
      }}
      onDrop={(e) => {
        setIsDragging(false)
        onDrop(e)
      }}
    >
      {children}
      {isDragging && (
        <div className='pointer-events-none absolute inset-0 z-10 rounded-lg border-[1.5px] border-[var(--brand-accent)] border-dashed bg-[color-mix(in_srgb,var(--brand-accent)_8%,transparent)]' />
      )}
    </div>
  )
}

interface ColorInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function ColorInput({ label, value, onChange, placeholder = '#000000' }: ColorInputProps) {
  const isValidHex = !value || HEX_COLOR_REGEX.test(value)
  const showColor = Boolean(value) && isValidHex

  return (
    <div className='flex flex-col gap-1.5'>
      <Label className='text-[13px] text-[var(--text-primary)]'>{label}</Label>
      <div className={cn(CHIP_FIELD_SHELL, !isValidHex && 'border-[var(--text-error)]')}>
        <div
          className={cn(
            'size-[16px] flex-shrink-0 rounded-sm border border-[var(--border-1)]',
            !showColor && 'bg-[var(--surface-3)]'
          )}
          style={showColor ? { backgroundColor: value } : undefined}
        />
        <input
          value={value}
          onChange={(e) => {
            let v = e.target.value.trim()
            if (v && !v.startsWith('#')) {
              v = `#${v}`
            }
            v = v.slice(0, 1) + v.slice(1).replace(/[^0-9a-fA-F]/g, '')
            onChange(v.slice(0, 7))
          }}
          onFocus={(e) => e.target.select()}
          placeholder={placeholder}
          maxLength={7}
          className={cn(CHIP_FIELD_INPUT, 'font-mono')}
        />
      </div>
      {!isValidHex && (
        <p className='text-[12px] text-[var(--text-error)]'>
          Must be a valid hex color (e.g. #33c482)
        </p>
      )}
    </div>
  )
}

export function WhitelabelingSettings() {
  const params = useParams<{ workspaceId: string }>()
  const { data: session } = useSession()
  const { data: orgsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData()

  const activeOrganization = orgsData?.activeOrganization
  const orgId = activeOrganization?.id

  const { data: savedSettings, isLoading } = useWhitelabelSettings(orgId)
  const updateSettings = useUpdateWhitelabelSettings()

  const userEmail = session?.user?.email
  const userRole = getUserRole(activeOrganization, userEmail)
  const canManage = isOrgAdminRole(userRole)
  const subscriptionAccess = getSubscriptionAccessState(subscriptionData?.data)
  const hasEnterprisePlan = subscriptionAccess.hasUsableEnterpriseAccess

  const [brandName, setBrandName] = useState('')
  const [primaryColor, setPrimaryColor] = useState('')
  const [primaryHoverColor, setPrimaryHoverColor] = useState('')
  const [accentColor, setAccentColor] = useState('')
  const [accentHoverColor, setAccentHoverColor] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  const [documentationUrl, setDocumentationUrl] = useState('')
  const [termsUrl, setTermsUrl] = useState('')
  const [privacyUrl, setPrivacyUrl] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [wordmarkUrl, setWordmarkUrl] = useState<string | null>(null)
  const formInitializedRef = useRef(false)
  const [savedBrandName, setSavedBrandName] = useState('')
  const [savedPrimaryColor, setSavedPrimaryColor] = useState('')
  const [savedPrimaryHoverColor, setSavedPrimaryHoverColor] = useState('')
  const [savedAccentColor, setSavedAccentColor] = useState('')
  const [savedAccentHoverColor, setSavedAccentHoverColor] = useState('')
  const [savedSupportEmail, setSavedSupportEmail] = useState('')
  const [savedDocumentationUrl, setSavedDocumentationUrl] = useState('')
  const [savedTermsUrl, setSavedTermsUrl] = useState('')
  const [savedPrivacyUrl, setSavedPrivacyUrl] = useState('')
  const [savedLogoUrl, setSavedLogoUrl] = useState<string | null>(null)
  const [savedWordmarkUrl, setSavedWordmarkUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!savedSettings || formInitializedRef.current) return
    const brand = savedSettings.brandName ?? ''
    const primary = savedSettings.primaryColor ?? ''
    const primaryHover = savedSettings.primaryHoverColor ?? ''
    const accent = savedSettings.accentColor ?? ''
    const accentHover = savedSettings.accentHoverColor ?? ''
    const support = savedSettings.supportEmail ?? ''
    const docs = savedSettings.documentationUrl ?? ''
    const terms = savedSettings.termsUrl ?? ''
    const privacy = savedSettings.privacyUrl ?? ''
    const logo = savedSettings.logoUrl ?? null
    const wordmark = savedSettings.wordmarkUrl ?? null
    setBrandName(brand)
    setPrimaryColor(primary)
    setPrimaryHoverColor(primaryHover)
    setAccentColor(accent)
    setAccentHoverColor(accentHover)
    setSupportEmail(support)
    setDocumentationUrl(docs)
    setTermsUrl(terms)
    setPrivacyUrl(privacy)
    setLogoUrl(logo)
    setWordmarkUrl(wordmark)
    setSavedBrandName(brand)
    setSavedPrimaryColor(primary)
    setSavedPrimaryHoverColor(primaryHover)
    setSavedAccentColor(accent)
    setSavedAccentHoverColor(accentHover)
    setSavedSupportEmail(support)
    setSavedDocumentationUrl(docs)
    setSavedTermsUrl(terms)
    setSavedPrivacyUrl(privacy)
    setSavedLogoUrl(logo)
    setSavedWordmarkUrl(wordmark)
    formInitializedRef.current = true
  }, [savedSettings])

  const logoUpload = useProfilePictureUpload({
    currentImage: logoUrl,
    onUpload: (url) => setLogoUrl(url),
    onError: (error) => toast.error(error),
    context: 'workspace-logos',
    workspaceId: params.workspaceId,
  })

  const wordmarkUpload = useProfilePictureUpload({
    currentImage: wordmarkUrl,
    onUpload: (url) => setWordmarkUrl(url),
    onError: (error) => toast.error(error),
    context: 'workspace-logos',
    workspaceId: params.workspaceId,
  })

  const hasChanges =
    formInitializedRef.current &&
    (brandName !== savedBrandName ||
      primaryColor !== savedPrimaryColor ||
      primaryHoverColor !== savedPrimaryHoverColor ||
      accentColor !== savedAccentColor ||
      accentHoverColor !== savedAccentHoverColor ||
      supportEmail !== savedSupportEmail ||
      documentationUrl !== savedDocumentationUrl ||
      termsUrl !== savedTermsUrl ||
      privacyUrl !== savedPrivacyUrl ||
      (logoUpload.previewUrl || null) !== savedLogoUrl ||
      (wordmarkUpload.previewUrl || null) !== savedWordmarkUrl)

  async function handleSave() {
    if (!orgId) return

    const colorFields: Array<[string, string]> = [
      ['Primary color', primaryColor],
      ['Primary hover color', primaryHoverColor],
      ['Accent color', accentColor],
      ['Accent hover color', accentHoverColor],
    ]

    for (const [fieldName, value] of colorFields) {
      if (value && !HEX_COLOR_REGEX.test(value)) {
        toast.error(`${fieldName} must be a valid hex color (e.g. #33c482)`)
        return
      }
    }

    const settings: WhitelabelSettingsPayload = {
      brandName: brandName || null,
      logoUrl: logoUpload.previewUrl || null,
      wordmarkUrl: wordmarkUpload.previewUrl || null,
      primaryColor: primaryColor || null,
      primaryHoverColor: primaryHoverColor || null,
      accentColor: accentColor || null,
      accentHoverColor: accentHoverColor || null,
      supportEmail: supportEmail || null,
      documentationUrl: documentationUrl || null,
      termsUrl: termsUrl || null,
      privacyUrl: privacyUrl || null,
    }

    try {
      await updateSettings.mutateAsync({ orgId, settings })
      setSavedBrandName(brandName)
      setSavedPrimaryColor(primaryColor)
      setSavedPrimaryHoverColor(primaryHoverColor)
      setSavedAccentColor(accentColor)
      setSavedAccentHoverColor(accentHoverColor)
      setSavedSupportEmail(supportEmail)
      setSavedDocumentationUrl(documentationUrl)
      setSavedTermsUrl(termsUrl)
      setSavedPrivacyUrl(privacyUrl)
      setSavedLogoUrl(logoUpload.previewUrl || null)
      setSavedWordmarkUrl(wordmarkUpload.previewUrl || null)
      toast.success('Whitelabeling settings saved.')
    } catch (error) {
      logger.error('Failed to save whitelabel settings', { error })
      toast.error(toError(error).message)
    }
  }

  if (isBillingEnabled) {
    if (!activeOrganization) {
      return (
        <SettingsEmptyState>
          You must be part of an organization to configure whitelabeling.
        </SettingsEmptyState>
      )
    }

    if (!hasEnterprisePlan) {
      return (
        <SettingsEmptyState>
          Whitelabeling is available on Enterprise plans only.
        </SettingsEmptyState>
      )
    }

    if (!canManage) {
      return (
        <SettingsEmptyState>
          Only organization owners and admins can configure whitelabeling settings.
        </SettingsEmptyState>
      )
    }
  }

  if (isLoading) {
    return null
  }

  const isUploading = logoUpload.isUploading || wordmarkUpload.isUploading

  return (
    <SettingsPanel
      actions={
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={updateSettings.isPending || isUploading || !hasChanges}
        >
          {updateSettings.isPending ? 'Saving...' : 'Save'}
        </Button>
      }
    >
      <SettingsSection label='Brand Identity'>
        <div className='flex flex-col gap-5'>
          <SettingRow
            label='Brand name'
            description='Replaces "Sim" in the sidebar and select UI elements.'
          >
            <ChipInput
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder='Your Company'
              className='max-w-[320px]'
              maxLength={64}
            />
          </SettingRow>
          <div className='grid grid-cols-2 gap-4'>
            <SettingRow
              label='Logo'
              labelTooltip='Shown in the collapsed sidebar. Square image — PNG, JPEG, or SVG, max 5MB.'
            >
              <div className='flex items-center gap-4'>
                <DropZone onDrop={logoUpload.handleFileDrop}>
                  <button
                    type='button'
                    onClick={logoUpload.handleThumbnailClick}
                    disabled={logoUpload.isUploading}
                    className='group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50'
                  >
                    {logoUpload.isUploading ? (
                      <Loader className='size-5 text-[var(--text-muted)]' animate />
                    ) : logoUpload.previewUrl ? (
                      <Image
                        src={logoUpload.previewUrl}
                        alt='Logo'
                        fill
                        className='object-contain p-1'
                        unoptimized
                      />
                    ) : (
                      <ImageIcon className='size-5 text-[var(--text-muted)]' />
                    )}
                  </button>
                </DropZone>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={logoUpload.handleThumbnailClick}
                    disabled={logoUpload.isUploading}
                    className='text-[13px]'
                  >
                    {logoUpload.previewUrl ? 'Change' : 'Upload'}
                  </Button>
                  {logoUpload.previewUrl && (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={logoUpload.handleRemove}
                      className='text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    >
                      <X className='size-[14px]' />
                    </Button>
                  )}
                </div>
                <input
                  ref={logoUpload.fileInputRef}
                  type='file'
                  accept='image/png,image/jpeg,image/jpg,image/svg+xml,image/webp'
                  onChange={logoUpload.handleFileChange}
                  className='hidden'
                />
              </div>
            </SettingRow>

            <SettingRow
              label='Wordmark'
              labelTooltip='Shown in the expanded sidebar. Wide image — PNG, JPEG, or SVG, max 5MB.'
            >
              <div className='flex items-center gap-4'>
                <DropZone onDrop={wordmarkUpload.handleFileDrop} className='min-w-0 flex-1'>
                  <button
                    type='button'
                    onClick={wordmarkUpload.handleThumbnailClick}
                    disabled={wordmarkUpload.isUploading}
                    className='group relative flex h-16 w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50'
                  >
                    {wordmarkUpload.isUploading ? (
                      <Loader className='size-5 text-[var(--text-muted)]' animate />
                    ) : wordmarkUpload.previewUrl ? (
                      <Image
                        src={wordmarkUpload.previewUrl}
                        alt='Wordmark'
                        fill
                        className='object-contain p-2'
                        unoptimized
                      />
                    ) : (
                      <ImageIcon className='size-5 text-[var(--text-muted)]' />
                    )}
                  </button>
                </DropZone>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={wordmarkUpload.handleThumbnailClick}
                    disabled={wordmarkUpload.isUploading}
                    className='text-[13px]'
                  >
                    {wordmarkUpload.previewUrl ? 'Change' : 'Upload'}
                  </Button>
                  {wordmarkUpload.previewUrl && (
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={wordmarkUpload.handleRemove}
                      className='text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    >
                      <X className='size-[14px]' />
                    </Button>
                  )}
                </div>
                <input
                  ref={wordmarkUpload.fileInputRef}
                  type='file'
                  accept='image/png,image/jpeg,image/jpg,image/svg+xml,image/webp'
                  onChange={wordmarkUpload.handleFileChange}
                  className='hidden'
                />
              </div>
            </SettingRow>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection label='Colors'>
        <div className='grid grid-cols-2 gap-4'>
          <ColorInput
            label='Primary color'
            value={primaryColor}
            onChange={setPrimaryColor}
            placeholder='#33c482'
          />
          <ColorInput
            label='Primary hover color'
            value={primaryHoverColor}
            onChange={setPrimaryHoverColor}
            placeholder='#2dac72'
          />
          <ColorInput
            label='Accent color'
            value={accentColor}
            onChange={setAccentColor}
            placeholder='#33b4ff'
          />
          <ColorInput
            label='Accent hover color'
            value={accentHoverColor}
            onChange={setAccentHoverColor}
            placeholder='#29a0e8'
          />
        </div>
      </SettingsSection>

      <SettingsSection label='Links'>
        <div className='flex flex-col gap-4'>
          <SettingRow label='Support email'>
            <ChipInput
              type='email'
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder='support@yourcompany.com'
            />
          </SettingRow>
          <SettingRow label='Documentation URL'>
            <ChipInput
              type='url'
              value={documentationUrl}
              onChange={(e) => setDocumentationUrl(e.target.value)}
              placeholder='https://docs.yourcompany.com'
            />
          </SettingRow>
          <SettingRow label='Terms of service URL'>
            <ChipInput
              type='url'
              value={termsUrl}
              onChange={(e) => setTermsUrl(e.target.value)}
              placeholder='https://yourcompany.com/terms'
            />
          </SettingRow>
          <SettingRow label='Privacy policy URL'>
            <ChipInput
              type='url'
              value={privacyUrl}
              onChange={(e) => setPrivacyUrl(e.target.value)}
              placeholder='https://yourcompany.com/privacy'
            />
          </SettingRow>
        </div>
      </SettingsSection>
    </SettingsPanel>
  )
}
