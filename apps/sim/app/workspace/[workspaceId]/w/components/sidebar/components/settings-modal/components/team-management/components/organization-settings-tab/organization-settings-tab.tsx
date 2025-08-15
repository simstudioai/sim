import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Organization, OrganizationFormData } from '@/stores/organization'

interface OrganizationSettingsTabProps {
  organization: Organization
  isAdminOrOwner: boolean
  userRole: string
  orgFormData: OrganizationFormData
  onOrgInputChange: (field: string, value: string) => void
  onSaveOrgSettings: () => Promise<void>
  isSavingOrgSettings: boolean
  orgSettingsError: string | null
  orgSettingsSuccess: string | null
}

export function OrganizationSettingsTab({
  organization,
  isAdminOrOwner,
  userRole,
  orgFormData,
  onOrgInputChange,
  onSaveOrgSettings,
  isSavingOrgSettings,
  orgSettingsError,
  orgSettingsSuccess,
}: OrganizationSettingsTabProps) {
  return (
    <div className='mt-4 space-y-6'>
      {orgSettingsError && (
        <Alert variant='destructive'>
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{orgSettingsError}</AlertDescription>
        </Alert>
      )}

      {orgSettingsSuccess && (
        <Alert>
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{orgSettingsSuccess}</AlertDescription>
        </Alert>
      )}

      {!isAdminOrOwner && (
        <Alert>
          <AlertTitle>Read Only</AlertTitle>
          <AlertDescription>
            You need owner or admin permissions to modify team settings.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Basic Information</CardTitle>
          <CardDescription>Update your team's basic information and branding</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='team-name'>Team Name</Label>
            <Input
              id='team-name'
              value={orgFormData.name}
              onChange={(e) => onOrgInputChange('name', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isAdminOrOwner && !isSavingOrgSettings) {
                  onSaveOrgSettings()
                }
              }}
              placeholder='Enter team name'
              disabled={!isAdminOrOwner || isSavingOrgSettings}
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='team-slug'>Team Slug</Label>
            <Input
              id='team-slug'
              value={orgFormData.slug}
              onChange={(e) => onOrgInputChange('slug', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isAdminOrOwner && !isSavingOrgSettings) {
                  onSaveOrgSettings()
                }
              }}
              placeholder='team-slug'
              disabled={!isAdminOrOwner || isSavingOrgSettings}
            />
            <p className='text-muted-foreground text-sm'>
              Used in URLs and API references. Can only contain lowercase letters, numbers, hyphens,
              and underscores.
            </p>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='team-logo'>Logo URL (Optional)</Label>
            <Input
              id='team-logo'
              value={orgFormData.logo}
              onChange={(e) => onOrgInputChange('logo', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isAdminOrOwner && !isSavingOrgSettings) {
                  onSaveOrgSettings()
                }
              }}
              placeholder='https://example.com/logo.png'
              disabled={!isAdminOrOwner || isSavingOrgSettings}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Team Information</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Team ID:</span>
            <span className='font-mono'>{organization.id}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Created:</span>
            <span>{new Date(organization.createdAt).toLocaleDateString()}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Your Role:</span>
            <span className='font-medium capitalize'>{userRole}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
