'use client'

import { BLOCK_ICONS } from '@/components/workflow-preview/block-icons'

interface OutputValue {
  key: string
  value: string
  /** Emphasize this row as the one being read by the tag below. */
  highlight?: boolean
}

interface OutputBundleProps {
  /** The block's name (unique within the workflow), e.g. "classify". */
  blockName: string
  blockType?: string
  blockColor?: string
  values: OutputValue[]
  /** A `blockName.key` reference to annotate beneath the card. */
  read?: string
}

/**
 * Teaches what a block's "output" is: a bundle of named values remembered under
 * the block's name for the run, read by key with a `<blockName.key>` tag.
 */
export function OutputBundle({
  blockName,
  blockType = 'agent',
  blockColor = '#6f3dfa',
  values,
  read,
}: OutputBundleProps) {
  const Icon = BLOCK_ICONS[blockType]
  const [tagBlock, tagKey] = read ? read.split('.') : []

  return (
    <div className='not-prose my-6 flex w-full max-w-[380px] flex-col gap-3'>
      <div className='overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#0f0f0f]'>
        <div className='flex items-center gap-2.5 border-[#2a2a2a] border-b px-3 py-2.5'>
          <div
            className='flex size-[22px] items-center justify-center rounded-[6px]'
            style={{ background: blockColor }}
          >
            {Icon && <Icon className='size-[14px] text-white' />}
          </div>
          <span className='font-medium text-[#e6e6e6] text-[15px]'>{blockName}</span>
          <span className='ml-auto text-[#7a7a7a] text-[12px]'>output · remembered this run</span>
        </div>
        <div className='flex flex-col'>
          {values.map((v) => (
            <div
              key={v.key}
              className='flex items-center justify-between gap-4 px-3 py-2 text-[13px]'
              style={v.highlight ? { background: '#13283a' } : undefined}
            >
              <span className='font-mono' style={{ color: v.highlight ? '#33b4ff' : '#9a9a9a' }}>
                {v.key}
              </span>
              <span className='truncate text-right text-[#cfcfcf]'>{v.value}</span>
            </div>
          ))}
        </div>
      </div>

      {read && tagBlock && tagKey && (
        <div className='rounded-lg border border-[#2a2a2a] bg-[#0f0f0f] px-3 py-2.5'>
          <div className='text-[#7a7a7a] text-[12px]'>Read one value by name:</div>
          <div className='mt-1 font-mono text-[15px]'>
            <span className='text-[#6a6a6a]'>&lt;</span>
            <span className='text-[#e6e6e6]'>{tagBlock}</span>
            <span className='text-[#6a6a6a]'>.</span>
            <span className='text-[#33b4ff]'>{tagKey}</span>
            <span className='text-[#6a6a6a]'>&gt;</span>
          </div>
          <div className='mt-1 flex gap-4 text-[11px]'>
            <span className='text-[#9a9a9a]'>↑ block name</span>
            <span className='text-[#33b4ff]'>↑ value to read</span>
          </div>
        </div>
      )}
    </div>
  )
}
