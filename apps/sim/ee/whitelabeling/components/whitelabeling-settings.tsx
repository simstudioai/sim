'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Loader2, X } from 'lucide-react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { Button, Input, Label, Skeleton, toast } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client/utils'
import { HEX_COLOR_REGEX } from '@/lib/branding'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { cn } from '@/lib/core/utils/cn'
import { getUserRole } from '@/lib/workspaces/organization/utils'
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
        <div className='pointer-events-none absolute inset-0 z-10 rounded-lg border-[1.5px] border-[var(--brand)] border-dashed bg-[color-mix(in_srgb,var(--brand)_8%,transparent)]' />
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
          className={cn(
            'h-[36px] font-mono text-[13px]',
            !isValidHex && 'border-[var(--text-error)] focus-visible:ring-[var(--text-error)]'
          )}
          maxLength={7}
        />
      </div>
      {!isValidHex && (
        <p className='text-[12px] text-[var(--text-error)]'>
          Must be a valid hex color (e.g. #701ffc)
        </p>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className='mb-4 font-medium text-[15px] text-[var(--text-primary)]'>{children}</h3>
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
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [wordmarkUrl, setWordmarkUrl] = useState<string | null>(null)
  const [formInitialized, setFormInitialized] = useState(false)
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
    if (!savedSettings || formInitialized) return
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
    setFormInitialized(true)
  }, [savedSettings, formInitialized])

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
    formInitialized &&
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
        toast.error(`${fieldName} must be a valid hex color (e.g. #701ffc)`)
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
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className='flex flex-col gap-3'>
            <Skeleton className='h-[16px] w-[128px]' />
            <Skeleton className='h-[36px] w-full rounded-lg' />
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
              description='Shown in the collapsed sidebar. Square image recommended (PNG, JPEG, or SVG, max 5MB).'
            >
              <div className='flex items-center gap-4'>
                <DropZone onDrop={logoUpload.handleFileDrop}>
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
                      <X className='h-3.5 w-3.5' />
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
              description='Shown in the expanded sidebar. Wide image recommended (PNG, JPEG, or SVG, max 5MB).'
            >
              <div className='flex items-center gap-4'>
                <DropZone onDrop={wordmarkUpload.handleFileDrop}>
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
                      <X className='h-3.5 w-3.5' />
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

      <div className='flex items-center justify-end'>
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={updateSettings.isPending || isUploading || !hasChanges}
        >
          {updateSettings.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
