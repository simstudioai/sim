import { ArrowUp, AtSign, Paperclip } from 'lucide-react'

const HEADING = 'font-[550] font-season text-xl tracking-tight text-[#212121]'
const DESC =
  'mt-4 max-w-[300px] font-[550] font-season text-sm leading-[125%] tracking-wide text-[#1C1C1C]/60'

const MODEL_ROWS = [
  {
    stagger: '19%',
    models: [
      { name: 'Gemini 1.5 Pro', provider: 'Google' },
      { name: 'LLaMA 3', provider: 'Meta' },
      { name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
    ],
  },
  {
    stagger: '29%',
    models: [
      { name: 'GPT-4.1 / GPT-4o', provider: 'OpenAI' },
      { name: 'Mistral Large', provider: 'Mistral AI' },
      { name: 'Grok-2', provider: 'xAI' },
    ],
  },
  {
    stagger: '9%',
    models: [
      { name: 'Gemini 1.5 Pro', provider: 'Google' },
      { name: 'LLaMA 3', provider: 'Meta' },
      { name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
    ],
  },
] as const

const COPILOT_ACTIONS = [
  { color: '#00F701', title: 'Build & edit workflows', subtitle: 'Help me build a workflow' },
  { color: '#F891E8', title: 'Debug workflows', subtitle: 'Help me debug my workflow' },
  { color: '#F04E9B', title: 'Optimize workflows', subtitle: 'help me optimize my workflow' },
] as const

const WORKFLOW_LOGS = [
  {
    name: 'main-relativity',
    color: '#3367F5',
    dots: [1, 2, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
  },
  {
    name: 'readDocuments',
    color: '#7632F5',
    dots: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    name: 'Escalation Triage...',
    color: '#F218B9',
    dots: [1, 2, 2, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    name: 'acceptance/rejection',
    color: '#F34E25',
    dots: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
] as const

const DOT_COLORS = ['#E0E0E0', '#00F701', '#FF6464'] as const

function ModelPill({ name, provider }: { name: string; provider: string }) {
  return (
    <div className='flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[#D6D6D6] bg-white px-3 py-2 shadow-[0_1px_5px_rgba(0,0,0,0.05)]'>
      <svg className='h-4 w-4 shrink-0 text-black/60' viewBox='0 0 16 16' fill='none'>
        <path
          d='M2 3.5h12M2 8h12M2 12.5h12'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
        />
      </svg>
      <span className='font-[350] text-black/80 text-sm'>{name}</span>
      <span className='font-[350] text-black/40 text-sm'>{provider}</span>
    </div>
  )
}

function CopilotCell() {
  return (
    <div className='relative flex flex-[27] flex-col overflow-hidden'>
      <div className='pointer-events-none absolute inset-x-0 bottom-0 h-1/2 rounded-t-lg border border-[#E9E9E9] bg-[#F3F3F3]' />

      <div className='relative z-10 p-5'>
        <h3 className={HEADING}>Co-pilot</h3>
        <p className={DESC}>
          Sim Copilot helps design, debug, and optimize workflows. It understands your setup, so
          suggestions are relevant and actionable. From quick edits to deeper reasoning, Copilot
          works alongside you at every step.
        </p>
        <p className='mt-5 font-[550] font-season text-[#1C1C1C] text-sm tracking-tight'>
          Try it out →
        </p>
      </div>

      <div className='relative z-10 mt-auto px-4 pb-5' aria-hidden='true'>
        <div className='absolute inset-x-2 top-[-18px] bottom-0 rounded-lg border border-[#EAEAEA] bg-white/80' />

        <div className='relative flex flex-col gap-2.5'>
          <div className='w-[150%] rounded-md border border-black/10 bg-white shadow-[0_1px_2px_#EBEBEB]'>
            <div className='flex flex-col gap-3 p-2'>
              <div className='flex h-6 w-6 items-center justify-center rounded bg-[#FFCC02]'>
                <AtSign className='h-3.5 w-3.5 text-[#070707]' strokeWidth={2} />
              </div>
              <span className='font-[550] font-season text-base text-black/50 tracking-wide'>
                Plan, search build anything
              </span>
            </div>
            <div className='flex items-center justify-between p-2'>
              <div className='flex items-center gap-1'>
                <div className='flex h-6 items-center rounded bg-black/[0.04] px-1.5'>
                  <span className='font-[550] font-season text-black/60 text-sm'>Build</span>
                </div>
                <div className='flex h-6 items-center rounded bg-black/[0.04] px-1.5'>
                  <span className='font-[550] font-season text-black/60 text-sm'>claude..</span>
                </div>
              </div>
              <div className='flex items-center gap-2.5'>
                <Paperclip className='h-4 w-4 text-black/50' strokeWidth={1.5} />
                <div className='flex h-6 w-6 items-center justify-center rounded-full bg-black'>
                  <ArrowUp className='h-3.5 w-3.5 text-white' strokeWidth={2.25} />
                </div>
              </div>
            </div>
          </div>

          <div className='flex w-[150%] gap-2'>
            {COPILOT_ACTIONS.map(({ color, title, subtitle }) => (
              <div
                key={title}
                className='flex flex-1 flex-col gap-2 rounded-md border border-black/10 bg-white p-2 shadow-[0_1px_2px_#EBEBEB]'
              >
                <div className='h-5 w-5 rounded' style={{ backgroundColor: color }} />
                <div className='flex flex-col gap-1'>
                  <span className='font-[550] font-season text-black/80 text-sm'>{title}</span>
                  <span className='font-[550] font-season text-black/50 text-xs'>{subtitle}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ModelsCell() {
  return (
    <div className='relative flex-[70] overflow-hidden'>
      <div className='relative z-10 p-5'>
        <h3 className={HEADING}>Models</h3>
        <p className={`${DESC} max-w-[440px]`}>
          Sim Copilot helps design, debug, and optimize workflows. It understands your setup, so
          suggestions are relevant and actionable.
        </p>
      </div>

      <div className='relative z-10 mt-6' aria-hidden='true'>
        {MODEL_ROWS.map((row, i) => (
          <div key={i}>
            <div className='border-[#EEE] border-t' />
            <div className='flex items-center gap-8 py-2.5' style={{ paddingLeft: row.stagger }}>
              {row.models.map((model, j) => (
                <ModelPill key={j} name={model.name} provider={model.provider} />
              ))}
            </div>
            <div className='border-[#EEE] border-t' />
          </div>
        ))}
      </div>

      <div
        className='pointer-events-none absolute inset-y-0 left-0 z-20 w-1/4'
        style={{ background: 'linear-gradient(90deg, #F6F6F6, transparent)' }}
      />
      <div
        className='pointer-events-none absolute inset-y-0 right-0 z-20 w-1/4'
        style={{ background: 'linear-gradient(270deg, #F6F6F6, transparent)' }}
      />
    </div>
  )
}

function IntegrationsCell() {
  return (
    <div className='flex flex-[30] items-start overflow-hidden'>
      <div className='shrink-0 p-5'>
        <h3 className={HEADING}>Integrations</h3>
        <p className={`${DESC} max-w-[220px]`}>
          Sim works with the most popular tools &amp; applications with over 100+ integrations ready
          to connect to your workflows instantly.
        </p>
      </div>

      <div className='ml-auto flex flex-col gap-3 p-5' aria-hidden='true'>
        <div className='mx-auto h-9 w-9 rounded border border-[#D6D6D6] bg-white shadow-[0_0_0_2px_#EAEAEA]' />
        {[0, 1].map((row) => (
          <div key={row} className='flex gap-5'>
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className='h-9 w-9 rounded border border-[#D6D6D6] bg-white shadow-[0_0_0_2px_#EAEAEA]'
              />
            ))}
          </div>
        ))}
        <div className='flex gap-4 pl-6'>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className='h-12 w-11 rounded-sm border border-[#D5D5D5] border-dashed' />
          ))}
        </div>
      </div>
    </div>
  )
}

function DeployCell() {
  return (
    <div className='relative flex flex-1 flex-col overflow-hidden'>
      <div className='pointer-events-none absolute inset-0 m-3 rounded-lg border border-[#E9E9E9] bg-[#F3F3F3]' />

      <div className='relative z-10 p-5'>
        <h3 className={HEADING}>Deploy / version</h3>
        <p className={DESC}>
          Sim Copilot helps design, debug, and optimize workflows. It understands your setup
        </p>
      </div>

      <div className='relative z-10 mx-5 mt-auto mb-5' aria-hidden='true'>
        <div className='max-w-[274px] rounded border border-[#D7D7D7] bg-white'>
          <div className='flex items-center justify-between px-2.5 py-2'>
            <div className='flex items-center gap-1.5'>
              <div className='h-4 w-4 rounded bg-[#00F701]' />
              <span className='font-[650] font-season text-[#1C1C1C] text-[9px]'>VERSION 1.2</span>
            </div>
            <div className='rounded-sm bg-[#00F701] px-1 py-0.5'>
              <span className='font-[550] font-season text-[#1C1C1C] text-[9px]'>
                [ INITIATE WF-001 ]
              </span>
            </div>
          </div>
          <div className='border-[#D7D7D7] border-t' />
          <div className='flex flex-col gap-1 px-2.5 py-2'>
            <span className='font-[550] font-season text-[#1C1C1C]/60 text-[9px]'>
              Latest deployment: 12:0191:10198.00
            </span>
            <span className='font-[550] font-season text-[#1C1C1C]/30 text-[9px]'>
              Deploy 08: 12:0191:10198.00
            </span>
          </div>
          <div className='border-[#D7D7D7] border-t px-2.5 py-1.5'>
            <span className='font-martian-mono font-medium text-[#414141] text-[5px] uppercase'>
              TOTAL DEPLOYS: 09
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function LogsCell() {
  return (
    <div className='relative flex flex-1 flex-col overflow-hidden'>
      <div className='pointer-events-none absolute inset-0 m-3 rounded-lg border border-[#E9E9E9] bg-[#F3F3F3]' />

      <div className='relative z-10 p-5 pb-0'>
        <h3 className={HEADING}>Logs</h3>
        <p className={DESC}>
          Sim Copilot helps design, debug, and optimize workflows. It understands your setup
        </p>
      </div>

      <div className='relative z-10 mx-1.5 mt-auto mb-1.5' aria-hidden='true'>
        <div className='rounded border border-[#D7D7D7] bg-white'>
          <div className='flex items-center gap-1.5 px-3 py-2.5'>
            <div className='flex shrink-0 items-center justify-center rounded bg-[#FCB409] p-1'>
              <svg className='h-[9px] w-[9px]' viewBox='0 0 14 14' fill='none'>
                <circle cx='7' cy='4.5' r='2' stroke='#1C1C1C' strokeWidth='1.4' />
                <path d='M7 7.5V10' stroke='#1C1C1C' strokeWidth='1.4' strokeLinecap='round' />
                <circle cx='7' cy='12' r='1.5' stroke='#1C1C1C' strokeWidth='1.4' />
              </svg>
            </div>
            <span className='font-[650] font-season text-[#1C1C1C] text-[10px]'>Logs</span>
          </div>

          <div className='border-[#D7D7D7]/50 border-t' />

          <div className='flex flex-col gap-2 px-3 py-2.5'>
            {WORKFLOW_LOGS.map(({ name, color, dots }) => (
              <div key={name} className='flex items-center gap-2'>
                <div className='h-2 w-2 shrink-0 rounded-sm' style={{ backgroundColor: color }} />
                <span className='w-[72px] shrink-0 truncate font-[550] font-season text-[#777] text-[11px] tracking-tight'>
                  {name}
                </span>
                <div className='flex flex-1 gap-px'>
                  {dots.map((d, i) => (
                    <div
                      key={i}
                      className='h-3 flex-1 rounded-full'
                      style={{ backgroundColor: DOT_COLORS[d] }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Features() {
  return (
    <section
      id='features'
      aria-labelledby='features-heading'
      className='relative overflow-hidden bg-[#F6F6F6] pb-36'
    >
      {/* Dark transition from Templates section above */}
      <div
        aria-hidden='true'
        className='absolute top-9 right-0 h-[200px] w-[72%] rounded-b-[9px] border border-[#3E3E3E] bg-[#212121]'
      >
        <div className='flex h-5 gap-px overflow-hidden'>
          <div className='flex-[47] rounded bg-[#2ABBF8] opacity-80' />
          <div className='flex-[22] rounded bg-[#00F701] opacity-40' />
          <div className='flex-[24] rounded bg-[#00F701] opacity-80' />
          <div className='flex-[62] rounded bg-[#2ABBF8] opacity-80' />
        </div>
        <div className='mt-px flex h-5 gap-px'>
          <div className='flex-[27] rounded bg-[#010370]' />
          <div className='flex-[24] rounded bg-[#FA4EDF]' />
          <div className='flex-[13] rounded bg-[#0607EB]' />
          <div className='flex-[27] rounded bg-[#010370]' />
          <div className='flex-[24] rounded bg-[#FA4EDF]' />
        </div>
      </div>

      {/* Header */}
      <div className='relative z-10 px-20 pt-28'>
        <div className='flex flex-col gap-5'>
          <div className='inline-flex items-center gap-2 rounded bg-[#1C1C1C]/10 p-1'>
            <div className='h-2 w-2 rounded-sm bg-[#1C1C1C]' />
            <span className='font-martian-mono font-medium text-[#1C1C1C] text-xs uppercase tracking-[0.02em]'>
              how sim works
            </span>
          </div>
          <h2
            id='features-heading'
            className='font-[550] font-season text-[#1C1C1C] text-[40px] leading-none tracking-tight'
          >
            Product features
          </h2>
        </div>
      </div>

      {/* Feature Grid */}
      <div className='relative z-10 mx-20 mt-12'>
        <div className='flex overflow-hidden rounded-[9px] border-[#E9E9E9] border-[1.5px]'>
          <CopilotCell />
          <div className='w-7 shrink-0 border-[#E9E9E9] border-x bg-[#FDFDFD]' />

          <div className='flex flex-[43] flex-col overflow-hidden'>
            <ModelsCell />
            <div className='h-7 shrink-0 border-[#E9E9E9] border-y bg-[#FDFDFD]' />
            <IntegrationsCell />
          </div>

          <div className='w-7 shrink-0 border-[#E9E9E9] border-x bg-[#FDFDFD]' />

          <div className='flex flex-[27] flex-col overflow-hidden'>
            <DeployCell />
            <div className='h-7 shrink-0 border-[#E9E9E9] border-y bg-[#FDFDFD]' />
            <LogsCell />
          </div>
        </div>
      </div>
    </section>
  )
}
