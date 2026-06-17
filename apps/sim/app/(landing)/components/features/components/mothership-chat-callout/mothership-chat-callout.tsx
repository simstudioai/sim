import { ArrowUp, Mic, Paperclip, Slash } from '@/components/emcn'
import { MothershipChatPreview } from '@/app/(landing)/components/feature-callouts/components/mothership-chat-preview/mothership-chat-preview'
import { LandingPreviewChatTitleBar } from '@/app/(landing)/components/landing-preview/components/landing-preview-chat/chat-title-bar'

/**
 * The Mothership beat's callout — a real piece of Sim UI, not a marketing card
 * (Linear's Slack-thread pattern). A self-contained Mothership chat panel: the
 * real title bar, a live grounded exchange that dissolves at its foot, and the
 * canonical composer. Decorative; the surrounding copy carries the crawlable
 * content.
 */
export function MothershipChatCallout() {
  return (
    <div className='flex w-[420px] flex-col overflow-hidden rounded-xl border border-[#e6e6e6] bg-[#ffffff] shadow-[0_24px_60px_-24px_rgba(18,18,18,0.28)]'>
      <LandingPreviewChatTitleBar chatName='New chat' showClose />
      <div className='relative h-[296px] overflow-hidden pt-4 [-webkit-mask-image:linear-gradient(to_bottom,#000_72%,transparent)] [mask-image:linear-gradient(to_bottom,#000_72%,transparent)]'>
        <MothershipChatPreview />
      </div>
      <div className='border-[#e6e6e6] border-t p-3'>
        <div className='rounded-[14px] border border-[#e6e6e6] bg-[#ffffff] px-2.5 py-2'>
          <p className='px-1 py-1 font-[380] text-[#5f5f5f] text-[14px] leading-[20px]'>
            Message Mothership
          </p>
          <div className='mt-1 flex items-center justify-between'>
            <div className='flex items-center gap-1'>
              <span className='flex size-[28px] items-center justify-center rounded-full'>
                <Paperclip className='size-[16px] text-[#5f5f5f]' />
              </span>
              <span className='flex size-[28px] items-center justify-center rounded-full'>
                <Slash className='size-[16px] text-[#5f5f5f]' />
              </span>
            </div>
            <div className='flex items-center gap-1.5'>
              <span className='flex size-[28px] items-center justify-center rounded-full'>
                <Mic className='size-[16px] text-[#5f5f5f]' />
              </span>
              <span className='flex size-[28px] items-center justify-center rounded-full bg-[#808080]'>
                <ArrowUp className='size-[16px] text-white' />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
