import * as Icons from '@/components/icons'
import { inter } from '@/app/fonts/inter'

// AI models and providers
const modelProviderIcons = [
  { icon: Icons.OpenAIIcon, label: 'OpenAI' },
  { icon: Icons.AnthropicIcon, label: 'Anthropic' },
  { icon: Icons.GeminiIcon, label: 'Gemini' },
  { icon: Icons.MistralIcon, label: 'Mistral' },
  { icon: Icons.PerplexityIcon, label: 'Perplexity' },
  { icon: Icons.xAIIcon, label: 'xAI' },
  { icon: Icons.GroqIcon, label: 'Groq' },
  { icon: Icons.HuggingFaceIcon, label: 'HuggingFace' },
  { icon: Icons.OllamaIcon, label: 'Ollama' },
  { icon: Icons.DeepseekIcon, label: 'Deepseek' },
  { icon: Icons.ElevenLabsIcon, label: 'ElevenLabs' },
]

// Communication and productivity tools
const communicationIcons = [
  { icon: Icons.SlackIcon, label: 'Slack' },
  { icon: Icons.GmailIcon, label: 'Gmail' },
  { icon: Icons.OutlookIcon, label: 'Outlook' },
  { icon: Icons.DiscordIcon, label: 'Discord', style: { color: '#5765F2' } },
  { icon: Icons.LinearIcon, label: 'Linear', style: { color: '#5E6AD2' } },
  { icon: Icons.NotionIcon, label: 'Notion' },
  { icon: Icons.JiraIcon, label: 'Jira' },
  { icon: Icons.ConfluenceIcon, label: 'Confluence' },
  { icon: Icons.TelegramIcon, label: 'Telegram' },
  { icon: Icons.GoogleCalendarIcon, label: 'Google Calendar' },
  { icon: Icons.GoogleDocsIcon, label: 'Google Docs' },
  { icon: Icons.BrowserUseIcon, label: 'BrowserUse' },
  { icon: Icons.TypeformIcon, label: 'Typeform' },
  { icon: Icons.GithubIcon, label: 'GitHub' },
  { icon: Icons.GoogleSheetsIcon, label: 'Google Sheets' },
  { icon: Icons.GoogleDriveIcon, label: 'Google Drive' },
  { icon: Icons.AirtableIcon, label: 'Airtable' },
]

// Data, storage and search services
const dataStorageIcons = [
  { icon: Icons.PineconeIcon, label: 'Pinecone' },
  { icon: Icons.SupabaseIcon, label: 'Supabase' },
  { icon: Icons.PostgresIcon, label: 'PostgreSQL' },
  { icon: Icons.MySQLIcon, label: 'MySQL' },
  { icon: Icons.QdrantIcon, label: 'Qdrant' },
  { icon: Icons.MicrosoftOneDriveIcon, label: 'OneDrive' },
  { icon: Icons.MicrosoftSharepointIcon, label: 'SharePoint' },
  { icon: Icons.SerperIcon, label: 'Serper' },
  { icon: Icons.FirecrawlIcon, label: 'Firecrawl' },
  { icon: Icons.StripeIcon, label: 'Stripe' },
]

interface IntegrationBoxProps {
  icon?: React.ComponentType<{ className?: string }>
  style?: React.CSSProperties
  isVisible: boolean
}

function IntegrationBox({ icon: Icon, style, isVisible }: IntegrationBoxProps) {
  return (
    <div
      className='flex h-[72px] w-[72px] items-center justify-center transition-all duration-300'
      style={{
        borderRadius: '12px',
        border: '1px solid var(--base-border, #E5E5E5)',
        background: 'var(--base-card, #FEFEFE)',
        opacity: isVisible ? 1 : 0.75,
        boxShadow: isVisible ? '0 2px 4px 0 rgba(0, 0, 0, 0.08)' : 'none',
      }}
    >
      {Icon && isVisible && (
        <div style={style}>
          <Icon className='h-8 w-8' />
        </div>
      )}
    </div>
  )
}

interface TickerRowProps {
  direction: 'left' | 'right'
  offset: number
  showOdd: boolean
  icons: Array<{
    icon: React.ComponentType<{ className?: string }>
    label: string
    style?: React.CSSProperties
  }>
}

function TickerRow({ direction, offset, showOdd, icons }: TickerRowProps) {
  // Create multiple copies of the icons array for seamless looping
  const extendedIcons = [...icons, ...icons, ...icons, ...icons]

  return (
    <div className='relative h-[88px] w-full overflow-hidden'>
      <div
        className={`absolute flex items-center gap-[16px] ${
          direction === 'left' ? 'animate-slide-left' : 'animate-slide-right'
        }`}
        style={{
          animationDelay: `${offset}s`,
        }}
      >
        {extendedIcons.map((service, index) => {
          const isOdd = index % 2 === 1
          const shouldShow = showOdd ? isOdd : !isOdd
          return (
            <IntegrationBox
              key={`${service.label}-${index}`}
              icon={service.icon}
              style={service.style}
              isVisible={shouldShow}
            />
          )
        })}
      </div>
    </div>
  )
}

export default function Integrations() {
  return (
    <section
      id='integrations'
      className={`${inter.className} flex flex-col pt-[40px] pb-[27px] sm:pt-[24px]`}
      aria-labelledby='integrations-heading'
    >
      <h2
        id='integrations-heading'
        className='mb-[4px] px-4 font-medium text-[28px] text-foreground tracking-tight sm:pl-[50px]'
      >
        Integrations
      </h2>
      <p className='mb-[24px] px-4 text-[#515151] text-[18px] sm:pl-[50px]'>
        Immediately connect to 100+ models and apps
      </p>

      {/* Sliding tickers */}
      <div className='flex w-full flex-col sm:px-[12px]'>
        <TickerRow direction='left' offset={0} showOdd={false} icons={modelProviderIcons} />
        <TickerRow direction='right' offset={0.5} showOdd={true} icons={communicationIcons} />
        <TickerRow direction='left' offset={1} showOdd={false} icons={dataStorageIcons} />
      </div>
    </section>
  )
}
