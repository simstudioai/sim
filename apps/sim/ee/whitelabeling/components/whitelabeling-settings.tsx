'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Loader2, X } from 'lucide-react'
import Image from 'next/image'
import { Button, Input, Label, Switch } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { HEX_COLOR_REGEX } from '@/lib/branding'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { cn } from '@/lib/core/utils/cn'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/settings/hooks/use-profile-picture-upload'
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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragging(false)
      onDrop(e)
    },
    [onDrop]
  )

  return (
    <div
      className={cn('relative', className)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className='pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-[1.5px] border-[var(--brand)] border-dashed bg-[color-mix(in_srgb,var(--brand)_8%,transparent)]'>
          <span className='font-medium text-[12px] text-[var(--brand)]'>Drop image</span>
        </div>
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

  return (
    <div className='flex flex-col gap-1.5'>
      <Label className='text-[13px] text-[var(--text-primary)]'>{label}</Label>
      <div className='flex items-center gap-2'>
        <div className='relative flex h-[36px] w-[36px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)]'>
          {value && isValidHex ? (
            <div className='h-full w-full rounded-md' style={{ backgroundColor: value }} />
          ) : (
            <div className='h-full w-full rounded-md bg-[var(--surface-3)]' />
          )}
        </div>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'h-[36px] font-mono text-[13px]',
            !isValidHex && 'border-red-500 focus-visible:ring-red-500'
          )}
          maxLength={7}
        />
      </div>
      {!isValidHex && (
        <p className='text-[12px] text-red-500'>Must be a valid hex color (e.g. #701ffc)</p>
      )}
    </div>
  )
}

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <Label className='text-[13px] text-[var(--text-primary)]'>{label}</Label>
      {description && <p className='text-[12px] text-[var(--text-muted)]'>{description}</p>}
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className='mb-4 font-medium text-[15px] text-[var(--text-primary)]'>{children}</h3>
}

export function WhitelabelingSettings() {
  const { data: session } = useSession()
  const { data: orgsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData()

  const activeOrganization = orgsData?.activeOrganization
  const orgId = activeOrganization?.id

  const { data: savedSettings, isLoading } = useWhitelabelSettings(orgId)
  const updateSettings = useUpdateWhitelabelSettings()

  const userEmail = session?.user?.email
  const userRole = getUserRole(activeOrganization, userEmail)
  const canManage = userRole === 'owner' || userRole === 'admin'
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
  const [hidePoweredBySim, setHidePoweredBySim] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [wordmarkUrl, setWordmarkUrl] = useState<string | null>(null)
  const [formInitialized, setFormInitialized] = useState(false)

  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  if (savedSettings && !formInitialized) {
    setBrandName(savedSettings.brandName ?? '')
    setPrimaryColor(savedSettings.primaryColor ?? '')
    setPrimaryHoverColor(savedSettings.primaryHoverColor ?? '')
    setAccentColor(savedSettings.accentColor ?? '')
    setAccentHoverColor(savedSettings.accentHoverColor ?? '')
    setSupportEmail(savedSettings.supportEmail ?? '')
    setDocumentationUrl(savedSettings.documentationUrl ?? '')
    setTermsUrl(savedSettings.termsUrl ?? '')
    setPrivacyUrl(savedSettings.privacyUrl ?? '')
    setHidePoweredBySim(savedSettings.hidePoweredBySim ?? false)
    setLogoUrl(savedSettings.logoUrl ?? null)
    setWordmarkUrl(savedSettings.wordmarkUrl ?? null)
    setFormInitialized(true)
  }

  const logoUpload = useProfilePictureUpload({
    currentImage: logoUrl,
    onUpload: (url) => setLogoUrl(url),
    onError: (error) => setSaveError(error),
  })

  const wordmarkUpload = useProfilePictureUpload({
    currentImage: wordmarkUrl,
    onUpload: (url) => setWordmarkUrl(url),
    onError: (error) => setSaveError(error),
  })

  const handleSave = useCallback(async () => {
    if (!orgId) return

    setSaveError(null)
    setSaveSuccess(false)

    const colorFields: Array<[string, string]> = [
      ['Primary color', primaryColor],
      ['Primary hover color', primaryHoverColor],
      ['Accent color', accentColor],
      ['Accent hover color', accentHoverColor],
    ]

    for (const [fieldName, value] of colorFields) {
      if (value && !HEX_COLOR_REGEX.test(value)) {
        setSaveError(`${fieldName} must be a valid hex color (e.g. #701ffc)`)
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
      hidePoweredBySim,
    }

    try {
      await updateSettings.mutateAsync({ orgId, settings })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (error) {
      logger.error('Failed to save whitelabel settings', { error })
      setSaveError(error instanceof Error ? error.message : 'Failed to save settings')
    }
  }, [
    orgId,
    brandName,
    logoUpload.previewUrl,
    wordmarkUpload.previewUrl,
    primaryColor,
    primaryHoverColor,
    accentColor,
    accentHoverColor,
    supportEmail,
    documentationUrl,
    termsUrl,
    privacyUrl,
    hidePoweredBySim,
  ])

  if (isBillingEnabled) {
    if (!activeOrganization) {
      return (
        <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
          You must be part of an organization to configure whitelabeling.
        </div>
      )
    }

    if (!hasEnterprisePlan) {
      return (
        <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
          Whitelabeling is available on Enterprise plans only.
        </div>
      )
    }

    if (!canManage) {
      return (
        <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
          Only organization owners and admins can configure whitelabeling settings.
        </div>
      )
    }
  }

  if (isLoading) {
    return (
      <div className='flex flex-col gap-8'>
        {[...Array(3)].map((_, i) => (
          <div key={i} className='flex flex-col gap-3'>
            <div className='h-4 w-32 animate-pulse rounded bg-[var(--surface-3)]' />
            <div className='h-9 w-full animate-pulse rounded-lg bg-[var(--surface-3)]' />
          </div>
        ))}
      </div>
    )
  }

  const isUploading = logoUpload.isUploading || wordmarkUpload.isUploading

  return (
    <div className='flex flex-col gap-8'>
      <section>
        <SectionTitle>Brand Identity</SectionTitle>
        <div className='flex flex-col gap-5'>
          <div className='grid grid-cols-2 gap-4'>
            <SettingRow
              label='Logo'
              description='Shown in the collapsed sidebar. Square image recommended (PNG or JPEG, max 5MB).'
            >
              <DropZone onDrop={logoUpload.handleFileDrop} className='flex items-center gap-4'>
                <button
                  type='button'
                  onClick={logoUpload.handleThumbnailClick}
                  disabled={logoUpload.isUploading}
                  className='group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50'
                >
                  {logoUpload.isUploading ? (
                    <Loader2 className='h-5 w-5 animate-spin text-[var(--text-muted)]' />
                  ) : logoUpload.previewUrl ? (
                    <Image
                      src={logoUpload.previewUrl}
                      alt='Logo'
                      fill
                      className='object-contain p-1'
                      unoptimized
                    />
                  ) : (
                    <span className='text-[11px] text-[var(--text-muted)]'>Logo</span>
                  )}
                </button>
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
                      <X className='h-3.5 w-3.5' />
                    </Button>
                  )}
                </div>
                <input
                  ref={logoUpload.fileInputRef}
                  type='file'
                  accept='image/png,image/jpeg,image/jpg'
                  onChange={logoUpload.handleFileChange}
                  className='hidden'
                />
              </DropZone>
            </SettingRow>

            <SettingRow
              label='Wordmark'
              description='Shown in the expanded sidebar. Wide image recommended (PNG or JPEG, max 5MB).'
            >
              <DropZone onDrop={wordmarkUpload.handleFileDrop} className='flex items-center gap-4'>
                <button
                  type='button'
                  onClick={wordmarkUpload.handleThumbnailClick}
                  disabled={wordmarkUpload.isUploading}
                  className='group relative flex h-16 w-40 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] transition-colors hover:bg-[var(--surface-3)] disabled:opacity-50'
                >
                  {wordmarkUpload.isUploading ? (
                    <Loader2 className='h-5 w-5 animate-spin text-[var(--text-muted)]' />
                  ) : wordmarkUpload.previewUrl ? (
                    <Image
                      src={wordmarkUpload.previewUrl}
                      alt='Wordmark'
                      fill
                      className='object-contain p-2'
                      unoptimized
                    />
                  ) : (
                    <span className='text-[11px] text-[var(--text-muted)]'>Wordmark</span>
                  )}
                </button>
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
                      <X className='h-3.5 w-3.5' />
                    </Button>
                  )}
                </div>
                <input
                  ref={wordmarkUpload.fileInputRef}
                  type='file'
                  accept='image/png,image/jpeg,image/jpg'
                  onChange={wordmarkUpload.handleFileChange}
                  className='hidden'
                />
              </DropZone>
            </SettingRow>
          </div>

          <SettingRow
            label='Brand name'
            description='Replaces "Sim" in the sidebar and select UI elements.'
          >
            <Input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder='Your Company'
              className='h-[36px] max-w-[320px] text-[13px]'
              maxLength={64}
            />
          </SettingRow>
        </div>
      </section>

      <section>
        <SectionTitle>Colors</SectionTitle>
        <div className='grid grid-cols-2 gap-4'>
          <ColorInput
            label='Primary color'
            value={primaryColor}
            onChange={setPrimaryColor}
            placeholder='#701ffc'
          />
          <ColorInput
            label='Primary hover color'
            value={primaryHoverColor}
            onChange={setPrimaryHoverColor}
            placeholder='#802fff'
          />
          <ColorInput
            label='Accent color'
            value={accentColor}
            onChange={setAccentColor}
            placeholder='#9d54ff'
          />
          <ColorInput
            label='Accent hover color'
            value={accentHoverColor}
            onChange={setAccentHoverColor}
            placeholder='#a66fff'
          />
        </div>
      </section>

      <section>
        <SectionTitle>Links</SectionTitle>
        <div className='flex flex-col gap-4'>
          <SettingRow label='Support email'>
            <Input
              type='email'
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder='support@yourcompany.com'
              className='h-[36px] text-[13px]'
            />
          </SettingRow>
          <SettingRow label='Documentation URL'>
            <Input
              type='url'
              value={documentationUrl}
              onChange={(e) => setDocumentationUrl(e.target.value)}
              placeholder='https://docs.yourcompany.com'
              className='h-[36px] text-[13px]'
            />
          </SettingRow>
          <SettingRow label='Terms of service URL'>
            <Input
              type='url'
              value={termsUrl}
              onChange={(e) => setTermsUrl(e.target.value)}
              placeholder='https://yourcompany.com/terms'
              className='h-[36px] text-[13px]'
            />
          </SettingRow>
          <SettingRow label='Privacy policy URL'>
            <Input
              type='url'
              value={privacyUrl}
              onChange={(e) => setPrivacyUrl(e.target.value)}
              placeholder='https://yourcompany.com/privacy'
              className='h-[36px] text-[13px]'
            />
          </SettingRow>
        </div>
      </section>

      <section>
        <SectionTitle>Advanced</SectionTitle>
        <div className='flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3'>
          <div className='flex flex-col gap-0.5'>
            <span className='text-[13px] text-[var(--text-primary)]'>
              Hide "Powered by Sim" branding
            </span>
            <span className='text-[12px] text-[var(--text-muted)]'>
              Removes the Sim logo from deployed chats and forms.
            </span>
          </div>
          <Switch checked={hidePoweredBySim} onCheckedChange={setHidePoweredBySim} />
        </div>
      </section>

      <div className='flex items-center gap-3'>
        <Button
          onClick={handleSave}
          disabled={updateSettings.isPending || isUploading}
          className='text-[13px]'
        >
          {updateSettings.isPending ? (
            <>
              <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
              Saving…
            </>
          ) : (
            'Save changes'
          )}
        </Button>
        {saveSuccess && (
          <span className='text-[13px] text-green-500'>Settings saved successfully.</span>
        )}
        {saveError && <span className='text-[13px] text-red-500'>{saveError}</span>}
      </div>
    </div>
  )
}
