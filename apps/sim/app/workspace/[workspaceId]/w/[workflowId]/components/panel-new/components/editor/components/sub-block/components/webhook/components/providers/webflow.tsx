import { Input, Skeleton } from '@/components/ui'
import {
  ConfigField,
  ConfigSection,
  InstructionsSection,
  TestResultDisplay as WebhookTestResult,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/webhook/components'

interface WebflowConfigProps {
  siteId: string
  setSiteId: (value: string) => void
  collectionId?: string
  setCollectionId?: (value: string) => void
  formId?: string
  setFormId?: (value: string) => void
  isLoadingToken: boolean
  testResult: any
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook?: () => void
  webhookId?: string
  triggerType?: string // The selected trigger type to show relevant fields
}

export function WebflowConfig({
  siteId,
  setSiteId,
  collectionId,
  setCollectionId,
  formId,
  setFormId,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
  webhookId,
  triggerType,
}: WebflowConfigProps) {
  const isCollectionTrigger = triggerType?.includes('collection_item') || !triggerType
  const isFormTrigger = triggerType?.includes('form_submission')

  return (
    <div className='space-y-4'>
      <ConfigSection title='Webflow Configuration'>
        <ConfigField
          id='webflow-site-id'
          label='Site ID *'
          description='The ID of the Webflow site to monitor (found in site settings or URL)'
        >
          {isLoadingToken ? (
            <Skeleton className='h-10 w-full' />
          ) : (
            <Input
              id='webflow-site-id'
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              placeholder='6c3592'
              required
            />
          )}
        </ConfigField>

        {isCollectionTrigger && setCollectionId && (
          <ConfigField
            id='webflow-collection-id'
            label='Collection ID'
            description='The ID of the collection to monitor (optional - leave empty to monitor all collections)'
          >
            {isLoadingToken ? (
              <Skeleton className='h-10 w-full' />
            ) : (
              <Input
                id='webflow-collection-id'
                value={collectionId || ''}
                onChange={(e) => setCollectionId(e.target.value)}
                placeholder='68f9666257aa8abaa9b0b6d6'
              />
            )}
          </ConfigField>
        )}

        {isFormTrigger && setFormId && (
          <ConfigField
            id='webflow-form-id'
            label='Form ID'
            description='The ID of the specific form to monitor (optional - leave empty to monitor all forms)'
          >
            {isLoadingToken ? (
              <Skeleton className='h-10 w-full' />
            ) : (
              <Input
                id='webflow-form-id'
                value={formId || ''}
                onChange={(e) => setFormId(e.target.value)}
                placeholder='form-contact'
              />
            )}
          </ConfigField>
        )}
      </ConfigSection>

      {testResult && (
        <WebhookTestResult
          testResult={testResult}
          copied={copied}
          copyToClipboard={copyToClipboard}
        />
      )}

      <InstructionsSection tip='Webflow webhooks monitor changes in your CMS and trigger your workflow automatically.'>
        <ol className='list-inside list-decimal space-y-1'>
          <li>Connect your Webflow account using the credential selector above.</li>
          <li>Enter your Webflow Site ID (found in the site URL or site settings).</li>
          {isCollectionTrigger && (
            <>
              <li>
                Optionally enter a Collection ID to monitor only specific collections (leave empty
                to monitor all).
              </li>
              <li>
                The webhook will trigger when items are created, changed, or deleted in the
                specified collection(s).
              </li>
            </>
          )}
          {isFormTrigger && (
            <>
              <li>
                Optionally enter a Form ID to monitor only a specific form (leave empty to monitor
                all forms).
              </li>
              <li>The webhook will trigger whenever a form is submitted on your site.</li>
            </>
          )}
          <li>
            Sim will automatically register the webhook with Webflow when you save this
            configuration.
          </li>
          <li>Make sure your Webflow account has appropriate permissions for the site.</li>
        </ol>
      </InstructionsSection>
    </div>
  )
}
