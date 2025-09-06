import {
  AirtableIcon,
  AnthropicIcon,
  BrowserUseIcon,
  ConfluenceIcon,
  DeepseekIcon,
  DiscordIcon,
  ElevenLabsIcon,
  FirecrawlIcon,
  GeminiIcon,
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleSheetsIcon,
  GroqIcon,
  HuggingFaceIcon,
  JiraIcon,
  LinearIcon,
  MicrosoftOneDriveIcon,
  MicrosoftSharepointIcon,
  MistralIcon,
  MySQLIcon,
  NotionIcon,
  OllamaIcon,
  OpenAIIcon,
  OutlookIcon,
  PerplexityIcon,
  PineconeIcon,
  PostgresIcon,
  QdrantIcon,
  SerperIcon,
  SlackIcon,
  StripeIcon,
  SupabaseIcon,
  TelegramIcon,
  TypeformIcon,
  xAIIcon,
} from '@/components/icons'
import { inter } from '@/app/fonts/inter'

// AI models and providers
const modelProviderIcons = [
  { icon: OpenAIIcon, label: 'OpenAI' },
  { icon: AnthropicIcon, label: 'Anthropic' },
  { icon: GeminiIcon, label: 'Gemini' },
  { icon: MistralIcon, label: 'Mistral' },
  { icon: PerplexityIcon, label: 'Perplexity' },
  { icon: xAIIcon, label: 'xAI' },
  { icon: GroqIcon, label: 'Groq' },
  { icon: HuggingFaceIcon, label: 'HuggingFace' },
  { icon: OllamaIcon, label: 'Ollama' },
  { icon: DeepseekIcon, label: 'Deepseek' },
  { icon: ElevenLabsIcon, label: 'ElevenLabs' },
]

// Communication and productivity tools
const communicationIcons = [
  { icon: SlackIcon, label: 'Slack' },
  { icon: GmailIcon, label: 'Gmail' },
  { icon: OutlookIcon, label: 'Outlook' },
  { icon: DiscordIcon, label: 'Discord' },
  { icon: LinearIcon, label: 'Linear', style: { color: '#5E6AD2' } },
  { icon: NotionIcon, label: 'Notion' },
  { icon: JiraIcon, label: 'Jira' },
  { icon: ConfluenceIcon, label: 'Confluence' },
  { icon: TelegramIcon, label: 'Telegram' },
  { icon: GoogleCalendarIcon, label: 'Google Calendar' },
  { icon: GoogleDocsIcon, label: 'Google Docs' },
  { icon: BrowserUseIcon, label: 'BrowserUse' },
  { icon: TypeformIcon, label: 'Typeform' },
  { icon: GithubIcon, label: 'GitHub' },
  { icon: GoogleSheetsIcon, label: 'Google Sheets' },
  { icon: GoogleDriveIcon, label: 'Google Drive' },
  { icon: AirtableIcon, label: 'Airtable' },
]

// Data, storage and search services
const dataStorageIcons = [
  { icon: PineconeIcon, label: 'Pinecone' },
  { icon: SupabaseIcon, label: 'Supabase' },
  { icon: PostgresIcon, label: 'PostgreSQL' },
  { icon: MySQLIcon, label: 'MySQL' },
  { icon: QdrantIcon, label: 'Qdrant' },
  { icon: MicrosoftOneDriveIcon, label: 'OneDrive' },
  { icon: MicrosoftSharepointIcon, label: 'SharePoint' },
  { icon: SerperIcon, label: 'Serper' },
  { icon: FirecrawlIcon, label: 'Firecrawl' },
  { icon: StripeIcon, label: 'Stripe' },
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
    <div className={`${inter.className} flex flex-col pt-[32px] pb-[20px]`}>
      <h3 className='mb-[4px] pl-[50px] font-medium text-[28px] text-foreground tracking-tight'>
        Integrations
      </h3>
      <p className='mb-[24px] pl-[50px] text-[#515151] text-[18px]'>
        Immediately connect to 100+ models and apps
      </p>

      {/* Sliding tickers */}
      <div className='flex w-full flex-col px-[12px]'>
        <TickerRow direction='left' offset={0} showOdd={false} icons={modelProviderIcons} />
        <TickerRow direction='right' offset={0.5} showOdd={true} icons={communicationIcons} />
        <TickerRow direction='left' offset={1} showOdd={false} icons={dataStorageIcons} />
      </div>
    </div>
  )
}
