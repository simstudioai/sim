import React, { useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfigField } from '../ui/config-field'
import { ConfigSection } from '../ui/config-section'
import { InstructionsSection } from '../ui/instructions-section'
import { TestResultDisplay as WebhookTestResult } from '../ui/test-result'

interface TelegramConfigProps {
  botToken: string
  setBotToken: (value: string) => void
  triggerPhrase: string
  setTriggerPhrase: (value: string) => void
  isLoadingToken: boolean
  testResult: any // Define a more specific type if possible
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook?: () => void // Optional test function
  webhookId?: string // Webhook ID to enable testing
  webhookUrl: string // Added webhook URL
}

export function TelegramConfig({
  botToken,
  setBotToken,
  triggerPhrase,
  setTriggerPhrase,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
  webhookId,
  webhookUrl,
}: TelegramConfigProps) {
  return (
    <div className="space-y-4">
      <ConfigSection title="Telegram Configuration">
        <ConfigField
          id="telegram-bot-token"
          label="Bot Token *"
          description="Your Telegram Bot Token from BotFather"
        >
          {isLoadingToken ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Input
              id="telegram-bot-token"
              value={botToken}
              onChange={(e) => {
                setBotToken(e.target.value);
              }}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              type="password"
              required
            />
          )}
        </ConfigField>

        <ConfigField
          id="telegram-trigger-phrase"
          label="Trigger Phrase *"
          description="The phrase that will trigger the workflow when sent to the bot"
        >
          {isLoadingToken ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Input
              id="telegram-trigger-phrase"
              value={triggerPhrase}
              onChange={(e) => {
                setTriggerPhrase(e.target.value);
              }}
              placeholder="/start_workflow"
              required
            />
          )}
        </ConfigField>
      </ConfigSection>

      {testResult && (
        <WebhookTestResult
          testResult={testResult}
          copied={copied}
          copyToClipboard={copyToClipboard}
        />
      )}

      <InstructionsSection>
        <ol className="list-decimal list-inside space-y-2">
          <li>
            Create a bot by messaging{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="link text-primary underline hover:text-primary/80 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                window.open('https://t.me/BotFather', '_blank', 'noopener,noreferrer')
                e.preventDefault()
              }}
            >
              @BotFather
            </a>{' '}
            on Telegram.
          </li>
          <li>
            Create your bot:
            <ol className="list-disc ml-5 mt-1">
              <li>Use the <code>/newbot</code> command</li>
              <li>Follow the prompts to set a name and username</li>
              <li>Copy the Bot Token that BotFather provides</li>
            </ol>
          </li>
          <li>
            After creating your bot, set the webhook manually using the following curl command:
            <pre className="bg-gray-100 p-2 rounded text-sm whitespace-pre-wrap">
              curl -X POST "https://api.telegram.org/bot&lt;your_bot_token&gt;/setWebhook" \
              -H "Content-Type: application/json" \
              -d {"{'"}url": "&lt;Webhook_URL&gt;", "allowed_updates": ["message"]{"}"}
            </pre>
          </li>
          <li>
            In SimStudio, enter your Bot Token and set a trigger phrase.
            <ol className="list-disc ml-5 mt-1">
              <li>The webhook URL will be automatically configured</li>
              <li>Note: Telegram webhooks require HTTPS. Your domain must have a valid SSL certificate.</li>
            </ol>
          </li>
          <li>
            Save your settings. Now, when someone sends the trigger phrase to your bot, your workflow will start automatically.
          </li>
        </ol>
      </InstructionsSection>
    </div>
  )
}
