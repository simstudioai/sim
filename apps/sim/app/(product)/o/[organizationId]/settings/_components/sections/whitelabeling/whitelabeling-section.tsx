'use client'

import { useId } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { FieldFrame, TextField } from '@sim/emcn/field'
import { FileField } from '@sim/emcn/field/file-field'
import { Input } from '@sim/emcn/field/inputs'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ActionRow,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/whitelabeling/whitelabeling-section.module.css'
import { useWhitelabelForm } from '@/platform/lib/data/whitelabeling'
import { useWhitelabelRead, type WhitelabelTextField } from '@/platform/shared/whitelabeling'

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/svg+xml,image/webp'

const COLOR_FIELDS: readonly { field: WhitelabelTextField; label: string; placeholder: string }[] =
  [
    { field: 'primaryColor', label: 'Primary color', placeholder: '#33c482' },
    { field: 'primaryHoverColor', label: 'Primary hover color', placeholder: '#2dac72' },
    { field: 'accentColor', label: 'Accent color', placeholder: '#33b4ff' },
    { field: 'accentHoverColor', label: 'Accent hover color', placeholder: '#29a0e8' },
  ]

interface ColorFieldProps {
  label: string
  placeholder: string
  value: string
  valid: boolean
  onChange: (value: string) => void
}

function ColorField({ label, placeholder, value, valid, onChange }: ColorFieldProps) {
  const id = useId()
  const error = valid ? undefined : 'Must be a valid hex color (e.g. #33c482)'
  return (
    <FieldFrame id={id} label={label} error={error}>
      <Input
        id={id}
        label={label}
        placeholder={placeholder}
        value={value}
        maxLength={7}
        spellCheck={false}
        invalid={!valid}
        describedBy={error ? `${id}-error` : undefined}
        pattern='#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?'
        onChange={onChange}
        trailing={
          value && valid ? (
            <svg
              className={styles.swatch}
              viewBox='0 0 16 16'
              role='img'
              aria-label={`${label} preview`}
            >
              <rect width='16' height='16' rx='3' fill={value} />
            </svg>
          ) : undefined
        }
      />
    </FieldFrame>
  )
}

interface ImageFieldProps {
  label: string
  disabled: boolean
  image: ReturnType<typeof useWhitelabelForm>['logo']
}

function ImageField({ label, disabled, image }: ImageFieldProps) {
  return (
    <FileField
      kind='image'
      label={label}
      accept={IMAGE_ACCEPT}
      optional
      disabled={disabled}
      onFileChange={image.upload}
      onClear={image.remove}
      selection={
        image.url
          ? { name: image.uploading ? 'Uploading…' : label, previewSrc: image.url }
          : undefined
      }
    />
  )
}

interface WhitelabelFormProps {
  organizationId: string
  settings: NonNullable<ReturnType<typeof useWhitelabelRead>['settings']>
  uploadWorkspaceId: string | undefined
}

function WhitelabelForm({ organizationId, settings, uploadWorkspaceId }: WhitelabelFormProps) {
  const form = useWhitelabelForm(organizationId, settings, uploadWorkspaceId)
  const { text } = form
  return (
    <form
      aria-label='White-labeling'
      onSubmit={(event) => {
        event.preventDefault()
        void form.save()
      }}
    >
      <SectionStack>
        <SettingsSection title='Brand identity'>
          <FieldStack>
            <TextField
              label='Brand name'
              placeholder='Your Company'
              maxLength={64}
              value={text.brandName}
              onChange={(value) => form.change('brandName', value)}
            />
            <div className={styles.pair}>
              <ImageField label='Logo (square)' disabled={form.saving} image={form.logo} />
              <ImageField label='Wordmark (wide)' disabled={form.saving} image={form.wordmark} />
            </div>
          </FieldStack>
        </SettingsSection>
        <SettingsSection title='Colors'>
          <FieldStack>
            <div className={styles.pair}>
              {COLOR_FIELDS.map(({ field, label, placeholder }) => (
                <ColorField
                  key={field}
                  label={label}
                  placeholder={placeholder}
                  value={text[field]}
                  valid={form.colorIsValid(text[field])}
                  onChange={(value) => form.changeColor(field, value)}
                />
              ))}
            </div>
          </FieldStack>
        </SettingsSection>
        <SettingsSection title='Links'>
          <FieldStack>
            <TextField
              type='email'
              label='Support email'
              placeholder='support@yourcompany.com'
              value={text.supportEmail}
              onChange={(value) => form.change('supportEmail', value)}
            />
            <TextField
              type='url'
              label='Documentation URL'
              placeholder='https://docs.yourcompany.com'
              value={text.documentationUrl}
              onChange={(value) => form.change('documentationUrl', value)}
            />
            <TextField
              type='url'
              label='Terms of service URL'
              placeholder='https://yourcompany.com/terms'
              value={text.termsUrl}
              onChange={(value) => form.change('termsUrl', value)}
            />
            <TextField
              type='url'
              label='Privacy policy URL'
              placeholder='https://yourcompany.com/privacy'
              value={text.privacyUrl}
              onChange={(value) => form.change('privacyUrl', value)}
            />
          </FieldStack>
        </SettingsSection>
        <ActionRow>
          <Button submit variant='primary' disabled={!form.dirty || form.saving}>
            {form.saving && !form.uploading ? 'Saving…' : 'Save'}
          </Button>
          {form.dirty && (
            <Button variant='quiet' disabled={form.saving} onClick={form.discard}>
              Discard
            </Button>
          )}
        </ActionRow>
      </SectionStack>
    </form>
  )
}

export default function WhitelabelingSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const read = useWhitelabelRead(organizationId)
  return (
    <>
      <SettingsPageHeader />
      {read.status === 'pending' ? (
        <SettingsSection title='Brand identity' />
      ) : read.status === 'error' || !read.settings ? (
        <FailureNotice message={read.error} onRetry={read.retry} />
      ) : !read.entitled ? (
        <EmptyState title='Whitelabeling requires an active Enterprise plan.' />
      ) : (
        <WhitelabelForm
          key={organizationId}
          organizationId={organizationId}
          settings={read.settings}
          uploadWorkspaceId={read.uploadWorkspaceId}
        />
      )}
    </>
  )
}
