import { ArrowRight, File, ThinkingLoader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

/**
 * MothershipChatPreview — a static recreation of the real Mothership chat,
 * used as the example content for {@link PlatformPlacement}. It plays the
 * exchange you'd get from "Create a comprehensive sales CRM workflow and table":
 * Mothership reads the workspace first, finds the CRM already exists, and offers
 * next steps instead of duplicating it — the grounding behaviour the Memory card
 * is about.
 *
 * It mirrors the real chat chrome part-for-part: a right-aligned user bubble on
 * `#f0f0f0`; the live cycle loader ({@link ThinkingLoader}) standing in for the
 * responder header, morphing through its shapes with rotating world-aligned
 * phrases (`phase`); the working tool-call list (`File` glyph + "Attempted to
 * read…" / "Read…") that shows what the agent is doing; a grounded reply with
 * underlined resource references; and the numbered "Suggested follow-ups" rows
 * with trailing arrows (same markup as the in-message follow-ups tag).
 *
 * It flows from the top so the prompt and the loader stay crisp, while the reply
 * and its follow-ups dissolve through the placement's bottom-edge fade — reading
 * as a response still coming in.
 */
const FOLLOW_UPS = [
  'Wire workflow to table',
  'Rebuild fresh',
  'Extend what exists',
  'Review current setup',
] as const

export function MothershipChatPreview() {
  return (
    <div className='flex flex-col gap-3.5 px-4'>
      <div className='max-w-[82%] self-end rounded-2xl bg-[#f0f0f0] px-3.5 py-2 text-[#121212] text-[13.5px] leading-[1.45]'>
        Create a comprehensive sales CRM workflow and table.
      </div>

      <div className='flex flex-col gap-2.5 self-start'>
        <ThinkingLoader phase startVariant='corners' size={20} />

        <div className='flex flex-col gap-1.5'>
          <div className='flex items-center gap-2 pl-6'>
            <File className='size-[15px] flex-shrink-0 text-[#8c8c8c]' />
            <span className='text-[#5f5f5f] text-[13px]'>Attempted to read Sales_CRM</span>
          </div>
          <div className='flex items-center gap-2 pl-6'>
            <File className='size-[15px] flex-shrink-0 text-[#8c8c8c]' />
            <span className='text-[#5f5f5f] text-[13px]'>
              Read Sales CRM Enrichment &amp; Scoring
            </span>
          </div>
        </div>

        <p className='text-[#121212] text-[13.5px] leading-[1.5]'>
          You already have a live{' '}
          <span className='underline decoration-[#c3c3c3] underline-offset-2'>Sales_CRM</span> here
          — both the table and its enrichment workflow are running. Pick a direction:
        </p>

        <div className='mt-0.5'>
          <span className='text-[#5f5f5f] text-sm'>Suggested follow-ups</span>
          <div className='mt-1.5 flex flex-col'>
            {FOLLOW_UPS.map((title, i) => (
              <div
                key={title}
                className={cn(
                  'flex items-center gap-2 border-[#e6e6e6] px-2 py-1.5',
                  i > 0 && 'border-t'
                )}
              >
                <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
                  <span className='text-[#5f5f5f] text-sm'>{i + 1}</span>
                </div>
                <span className='flex-1 text-[#2c2c2c] text-sm'>{title}</span>
                <ArrowRight className='size-[16px] shrink-0 text-[#5f5f5f]' />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
