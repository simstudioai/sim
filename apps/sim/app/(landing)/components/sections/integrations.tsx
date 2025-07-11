'use client'

import { motion } from 'framer-motion'
import { GitBranch, RefreshCcw } from 'lucide-react'
import ReactFlow, { ConnectionLineType, Position, ReactFlowProvider } from 'reactflow'
import { OrbitingCircles } from '@/app/(landing)/components/magicui/orbiting-circles'
import { DotPattern } from '../dot-pattern'
import { HeroBlock } from '../hero-block'

function Integrations() {
  return (
    <section className='flex w-full flex-col gap-10 px-8 py-12 md:px-16 lg:px-28 xl:px-32'>
      <div className='flex flex-col gap-5'>
        <motion.p
          className='font-medium text-[42px] text-white leading-none tracking-normal md:text-5xl md:leading-tight'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.05, ease: 'easeOut' }}
        >
          Everything you need,
          <br />
          connected
        </motion.p>
        <motion.p
          className='max-w-md font-light text-white/60 text-xl tracking-normal'
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
        >
          Seamlessly connect your agents with the tools you already use—no extra setup required.
        </motion.p>
      </div>

      {/* Desktop view */}
      <div className='relative z-10 hidden min-h-[36rem] w-full items-center justify-center overflow-hidden rounded-3xl border border-[#606060]/30 bg-[#0f0f0f] md:flex'>
        <DotPattern className='rounded-3xl opacity-10' x={-5} y={-5} />
        <div className='-translate-x-1/2 absolute bottom-0 left-1/2'>
          <svg
            width='800'
            height='450'
            viewBox='0 0 1076 623'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <g filter='url(#filter0_f_113_56)'>
              <path
                d='M278.98 498.157L657.323 493.454L573.161 1204.36L499.788 1191.21L278.98 498.157Z'
                fill='url(#paint0_linear_113_56)'
              />
            </g>
            <g filter='url(#filter1_f_113_56)'>
              <path
                d='M396.125 258.957L774.468 254.254L690.306 965.155L616.933 952.012L396.125 258.957Z'
                fill='url(#paint1_linear_113_56)'
              />
            </g>
            <g filter='url(#filter2_f_113_56)'>
              <path
                d='M357.731 305.714L604.127 503.599L628.26 978.086L578.913 929.443L357.731 305.714Z'
                fill='url(#paint2_linear_113_56)'
              />
            </g>
            <g filter='url(#filter3_f_113_56)'>
              <path
                d='M534.274 220.998L736.222 455.766L755.909 905.149L715.466 849.688L534.274 220.998Z'
                fill='url(#paint3_linear_113_56)'
              />
            </g>
            <defs>
              <filter
                id='filter0_f_113_56'
                x='-21.02'
                y='193.454'
                width='978.342'
                height='1310.9'
                filterUnits='userSpaceOnUse'
                colorInterpolationFilters='sRGB'
              >
                <feFlood floodOpacity={0} result='BackgroundImageFix' />
                <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
                <feGaussianBlur stdDeviation='150' result='effect1_foregroundBlur_113_56' />
              </filter>
              <filter
                id='filter1_f_113_56'
                x='96.125'
                y='-45.7463'
                width='978.342'
                height='1310.9'
                filterUnits='userSpaceOnUse'
                colorInterpolationFilters='sRGB'
              >
                <feFlood floodOpacity='0' result='BackgroundImageFix' />
                <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
                <feGaussianBlur stdDeviation='150' result='effect1_foregroundBlur_113_56' />
              </filter>
              <filter
                id='filter2_f_113_56'
                x='257.731'
                y='205.714'
                width='470.529'
                height='872.372'
                filterUnits='userSpaceOnUse'
                colorInterpolationFilters='sRGB'
              >
                <feFlood floodOpacity='0' result='BackgroundImageFix' />
                <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
                <feGaussianBlur stdDeviation='50' result='effect1_foregroundBlur_113_56' />
              </filter>
              <filter
                id='filter3_f_113_56'
                x='434.274'
                y='120.998'
                width='421.636'
                height='884.151'
                filterUnits='userSpaceOnUse'
                colorInterpolationFilters='sRGB'
              >
                <feFlood floodOpacity='0' result='BackgroundImageFix' />
                <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
                <feGaussianBlur stdDeviation='50' result='effect1_foregroundBlur_113_56' />
              </filter>
              <linearGradient
                id='paint0_linear_113_56'
                x1='451.681'
                y1='1151.32'
                x2='661.061'
                y2='557.954'
                gradientUnits='userSpaceOnUse'
              >
                <stop stopColor='#9C75D7' />
                <stop offset='1' stopColor='#9C75D7' stopOpacity='0' />
              </linearGradient>
              <linearGradient
                id='paint1_linear_113_56'
                x1='568.826'
                y1='912.119'
                x2='778.206'
                y2='318.753'
                gradientUnits='userSpaceOnUse'
              >
                <stop stopColor='#9C75D7' />
                <stop offset='1' stopColor='#9C75D7' stopOpacity='0' />
              </linearGradient>
              <linearGradient
                id='paint2_linear_113_56'
                x1='543.08'
                y1='874.705'
                x2='742.662'
                y2='699.882'
                gradientUnits='userSpaceOnUse'
              >
                <stop stopColor='#9C75D7' />
                <stop offset='1' stopColor='#9C75D7' stopOpacity='0' />
              </linearGradient>
              <linearGradient
                id='paint3_linear_113_56'
                x1='686.102'
                y1='791.225'
                x2='858.04'
                y2='680.269'
                gradientUnits='userSpaceOnUse'
              >
                <stop stopColor='#9C75D7' />
                <stop offset='1' stopColor='#9C75D7' stopOpacity='0' />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <OrbitingCircles radius={160}>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.pinecone />
          </div>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.qdrant />
          </div>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.slack />
          </div>
        </OrbitingCircles>
        <OrbitingCircles iconSize={40} radius={320} reverse>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-2 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.gitHub />
          </div>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.supabase />
          </div>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.perplexity />
          </div>
        </OrbitingCircles>
        <OrbitingCircles iconSize={40} radius={480}>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-2 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.youtube />
          </div>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.reddit />
          </div>
          <div className='flex aspect-square h-16 w-16 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.notion />
          </div>
        </OrbitingCircles>
      </div>

      {/* Mobile view */}
      <div className='relative z-10 flex min-h-[28rem] w-full items-center justify-center overflow-hidden rounded-3xl border border-[#606060]/30 bg-[#0f0f0f] md:hidden'>
        <DotPattern className='rounded-3xl opacity-10' x={-5} y={-5} />
        <div className='absolute inset-0 z-0 flex items-center justify-center'>
          <div className='-translate-x-1/2 absolute bottom-[-80px] left-[45%] w-[130%]'>
            <svg
              width='100%'
              height='350'
              viewBox='0 0 600 450'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
              preserveAspectRatio='xMidYMid meet'
            >
              <path
                d='M180 150L380 150L350 380L220 365L180 150Z'
                fill='url(#mobile_paint0)'
                filter='url(#mobile_filter0)'
              />
              <path
                d='M220 70L420 70L390 300L260 285L220 70Z'
                fill='url(#mobile_paint1)'
                filter='url(#mobile_filter1)'
              />
              <defs>
                <filter
                  id='mobile_filter0'
                  x='100'
                  y='70'
                  width='360'
                  height='390'
                  filterUnits='userSpaceOnUse'
                  colorInterpolationFilters='sRGB'
                >
                  <feFlood floodOpacity='0' result='BackgroundImageFix' />
                  <feBlend
                    mode='normal'
                    in='SourceGraphic'
                    in2='BackgroundImageFix'
                    result='shape'
                  />
                  <feGaussianBlur stdDeviation='35' result='effect1_foregroundBlur' />
                </filter>
                <filter
                  id='mobile_filter1'
                  x='140'
                  y='-10'
                  width='360'
                  height='390'
                  filterUnits='userSpaceOnUse'
                  colorInterpolationFilters='sRGB'
                >
                  <feFlood floodOpacity='0' result='BackgroundImageFix' />
                  <feBlend
                    mode='normal'
                    in='SourceGraphic'
                    in2='BackgroundImageFix'
                    result='shape'
                  />
                  <feGaussianBlur stdDeviation='35' result='effect1_foregroundBlur' />
                </filter>
                <linearGradient
                  id='mobile_paint0'
                  x1='280'
                  y1='360'
                  x2='370'
                  y2='160'
                  gradientUnits='userSpaceOnUse'
                >
                  <stop stopColor='#9C75D7' stopOpacity='0.4' />
                  <stop offset='1' stopColor='#9C75D7' stopOpacity='0' />
                </linearGradient>
                <linearGradient
                  id='mobile_paint1'
                  x1='320'
                  y1='280'
                  x2='410'
                  y2='80'
                  gradientUnits='userSpaceOnUse'
                >
                  <stop stopColor='#9C75D7' stopOpacity='0.9' />
                  <stop offset='1' stopColor='#9C75D7' stopOpacity='0' />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
        <OrbitingCircles radius={100}>
          <div className='flex aspect-square h-12 w-12 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.pinecone />
          </div>
          <div className='flex aspect-square h-12 w-12 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.qdrant />
          </div>
          <div className='flex aspect-square h-12 w-12 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.slack />
          </div>
        </OrbitingCircles>
        <OrbitingCircles iconSize={32} radius={180} reverse>
          <div className='flex aspect-square h-12 w-12 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.gitHub />
          </div>
          <div className='flex aspect-square h-12 w-12 items-center justify-center rounded-xl border border-[#353535] bg-[#242424] p-1 shadow-[0px_2px_6px_0px_rgba(126,_48,_252,_0.1)]'>
            <Icons.notion />
          </div>
        </OrbitingCircles>
      </div>

      <div className='relative flex w-full flex-col gap-20 text-white lg:flex-row'>
        <div className='flex w-full flex-col gap-8'>
          <div className='flex flex-col gap-6'>
            <motion.div
              className='flex items-center gap-6'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
            >
              <RefreshCcw size={24} />
              <span className='text-2xl'>Sync Knowledge in Seconds</span>
            </motion.div>
            <motion.p
              className='max-w-lg font-light text-lg text-white/60'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.18, ease: 'easeOut' }}
            >
              Import data from your favorite tools to power your AI agents&apos; knowledge bases—no
              manual uploads needed.
            </motion.p>
          </div>
          <div className='relative z-10 flex h-80 w-full items-center justify-center overflow-hidden rounded-3xl border border-[#606060]/30 bg-[#0f0f0f]'>
            <DotPattern className='z-0 rounded-3xl opacity-10' x={-5} y={-5} />
            <motion.div
              className='z-10 flex h-full w-full justify-end'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
            >
              <ReactFlowProvider>
                <ReactFlow
                  nodes={[
                    {
                      id: 'agent1',
                      type: 'heroBlock',
                      position: { x: 50, y: 100 },
                      data: { type: 'agent' },
                      sourcePosition: Position.Right,
                      targetPosition: Position.Left,
                    },
                    {
                      id: 'slack1',
                      type: 'heroBlock',
                      position: { x: 450, y: -30 },
                      data: { type: 'slack' },
                      sourcePosition: Position.Left,
                      targetPosition: Position.Right,
                    },
                  ]}
                  edges={[
                    {
                      id: 'agent1-slack1',
                      source: 'agent1',
                      target: 'slack1',
                      type: 'smoothstep',
                      style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' },
                      animated: true,
                    },
                  ]}
                  nodeTypes={{ heroBlock: HeroBlock }}
                  connectionLineType={ConnectionLineType.SmoothStep}
                  connectionLineStyle={{
                    stroke: '#404040',
                    strokeWidth: 1.5,
                    strokeDasharray: '4 4',
                  }}
                  defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  panOnScroll={false}
                  zoomOnScroll={false}
                  zoomOnPinch={false}
                  zoomOnDoubleClick={false}
                  panOnDrag={false}
                  selectionOnDrag={false}
                  preventScrolling={true}
                  proOptions={{ hideAttribution: true }}
                  className='pointer-events-none h-full w-full'
                  style={{ width: '100%', height: '100%' }}
                />
              </ReactFlowProvider>
            </motion.div>
          </div>
        </div>
        <div className='flex w-full flex-col gap-8'>
          <div className='flex flex-col gap-6'>
            <motion.div
              className='flex items-center gap-6'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
            >
              <GitBranch size={24} />
              <span className='text-2xl'>Automate Workflows with Ease</span>
            </motion.div>
            <motion.p
              className='max-w-lg font-light text-lg text-white/60'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.28, ease: 'easeOut' }}
            >
              Trigger actions and automate tasks across your apps with pre-built integrations.
            </motion.p>
          </div>
          <div className='relative z-10 flex h-80 w-full items-center justify-center overflow-hidden rounded-3xl border border-[#606060]/30 bg-[#0f0f0f]'>
            <DotPattern className='z-0 rounded-3xl opacity-10' x={-5} y={-5} />

            <motion.div
              className='z-10 flex h-full w-full justify-end'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.4, ease: 'easeOut' }}
            >
              <ReactFlowProvider>
                <ReactFlow
                  nodes={[
                    {
                      id: 'start',
                      type: 'heroBlock',
                      position: { x: 50, y: 120 },
                      data: { type: 'start' },
                      sourcePosition: Position.Right,
                      targetPosition: Position.Left,
                    },
                    {
                      id: 'function1',
                      type: 'heroBlock',
                      position: { x: 450, y: 80 },
                      data: { type: 'function', isHeroSection: false },
                      sourcePosition: Position.Right,
                      targetPosition: Position.Left,
                    },
                  ]}
                  edges={[
                    {
                      id: 'start-func1',
                      source: 'start',
                      target: 'function1',
                      type: 'smoothstep',
                      style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' },
                      animated: true,
                    },
                  ]}
                  nodeTypes={{ heroBlock: HeroBlock }}
                  connectionLineType={ConnectionLineType.SmoothStep}
                  connectionLineStyle={{
                    stroke: '#404040',
                    strokeWidth: 1.5,
                    strokeDasharray: '4 4',
                  }}
                  defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  panOnScroll={false}
                  zoomOnScroll={false}
                  zoomOnPinch={false}
                  zoomOnDoubleClick={false}
                  panOnDrag={false}
                  selectionOnDrag={false}
                  preventScrolling={true}
                  proOptions={{ hideAttribution: true }}
                  className='pointer-events-none h-full w-full'
                  style={{ width: '100%', height: '100%' }}
                />
              </ReactFlowProvider>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  )
}

const Icons = {
  gitHub: () => (
    <svg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <g clipPath='url(#clip0_82_6269)'>
        <path
          d='M24.0492 0C10.7213 0 0 11 0 24.6C0 35.5 6.88525 44.7 16.4262 47.95C17.6066 48.2 18.0492 47.4 18.0492 46.75C18.0492 46.2 18 44.2 18 42.2C11.3115 43.65 9.93443 39.25 9.93443 39.25C8.85246 36.4 7.27869 35.65 7.27869 35.65C5.11475 34.15 7.42623 34.15 7.42623 34.15C9.83607 34.3 11.1148 36.7 11.1148 36.7C13.2787 40.45 16.7213 39.4 18.0984 38.75C18.2951 37.15 18.9344 36.05 19.623 35.45C14.3115 34.9 8.70492 32.75 8.70492 23.3C8.70492 20.6 9.63935 18.4 11.1639 16.7C10.918 16.1 10.082 13.55 11.4098 10.2C11.4098 10.2 13.4262 9.55 18 12.75C19.918 12.2 21.9836 11.95 24 11.95C26.0164 11.95 28.082 12.25 30 12.75C34.5738 9.55 36.5902 10.2 36.5902 10.2C37.918 13.6 37.082 16.1 36.8361 16.7C38.4098 18.4 39.2951 20.6 39.2951 23.3C39.2951 32.75 33.6885 34.85 28.3279 35.45C29.2131 36.2 29.9508 37.7 29.9508 40C29.9508 43.3 29.9016 45.95 29.9016 46.75C29.9016 47.4 30.3443 48.2 31.5246 47.95C41.1148 44.7 48 35.5 48 24.6C48.0492 11 37.2787 0 24.0492 0Z'
          fill='white'
        />
      </g>
      <defs>
        <clipPath id='clip0_82_6269'>
          <rect width='48' height='48' fill='white' />
        </clipPath>
      </defs>
    </svg>
  ),
  pinecone: () => (
    <svg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M30.3124 0.546056C29.7865 -0.0256784 28.9098 -0.162895 28.2085 0.203015L27.5573 0.523187L20.469 4.20515L22.1221 6.858L26.7307 4.45672L25.6036 10.0826L28.8848 10.6314L30.0369 4.98271L33.4433 8.68755L35.9981 6.72079L30.8384 1.09492H30.8134L30.3124 0.546056ZM20.3688 48C22.072 48 23.4496 46.7651 23.4496 45.2557C23.4496 43.7463 22.072 42.5113 20.3688 42.5113C18.6656 42.5113 17.2881 43.7463 17.2881 45.2557C17.263 46.7651 18.6656 48 20.3688 48ZM24.5016 32.9291L23.3995 38.5778L20.0933 38.029L21.1954 32.4031L16.5867 34.8272L14.9086 32.1744L21.9468 28.4924L22.598 28.1494C23.2993 27.7835 24.176 27.9207 24.7019 28.4924L25.2029 29.0413L30.4377 34.6443L27.8829 36.6339L24.5016 32.9291ZM27.1816 19.4362L26.0795 25.0849L22.7733 24.536L23.8754 18.933L19.2918 21.3343L17.6387 18.6815L24.6518 15.0224V14.9766H24.7019L25.3532 14.6336C26.0545 14.2677 26.9311 14.4049 27.4571 14.9766L27.958 15.5026L33.1678 21.1285L30.613 23.1181L27.1816 19.4362ZM5.56612 41.7567H5.54107L4.8648 41.5737C4.13844 41.3908 3.66255 40.7504 3.71265 40.0643L4.31377 32.426L7.49473 32.6318L7.11902 37.2743L12.0533 34.2098L13.8316 36.6111L8.99754 39.6069L13.9318 40.9105L13.0551 43.7006L5.56612 41.7567ZM38.3024 44.9126L38.077 45.5758C37.8516 46.2162 37.2003 46.6507 36.4489 46.605L35.7476 46.5592L35.6975 46.5821L35.6725 46.5592L27.9079 46.079L28.1083 43.1746L33.268 43.4947L29.8866 39.1724L32.4665 37.4801L35.9229 41.9167L37.4258 37.4343L40.4564 38.2805L38.3024 44.9126ZM47.4195 29.1785L47.7952 29.796C48.1709 30.4135 48.0206 31.191 47.4195 31.6484L46.8684 32.0829V32.1058H46.8434L40.8071 36.7711L38.7032 34.5071L42.6606 31.4426L36.7244 30.4821L37.3005 27.5548L43.2867 28.5153L40.782 24.3988L43.6123 22.958L47.4195 29.1785ZM41.283 16.4174L35.9229 19.0474L34.37 16.4403L39.6549 13.856L34.8209 12.0493L36.0482 9.30503L43.412 12.0265L43.437 12.0036L43.4621 12.0493L44.1383 12.3009C44.8647 12.5753 45.2654 13.2614 45.1402 13.9475L45.015 14.6336L43.6374 21.6087L40.4314 21.0828L41.283 16.4174ZM5.31565 22.5464L11.2768 23.4612L10.7258 26.3884L4.71452 25.4508L7.26931 29.5673L4.43901 31.0309L0.581787 24.8333L0.206084 24.2387C-0.16962 23.6213 -0.0193384 22.8437 0.55674 22.3863L1.10777 21.9518V21.9289H1.13282L7.09398 17.2407L9.22296 19.5048L5.31565 22.5464ZM14.3075 9.87676L18.2649 13.9018L15.8353 15.8914L11.7777 11.7749L10.851 16.4631L7.64501 15.9371L9.04764 8.98485L9.19792 8.2759C9.32315 7.58982 9.97437 7.0867 10.7258 7.06383L11.4271 7.04096L11.4521 7.01809L11.4772 7.04096L19.4421 6.74366L19.5673 9.71667L14.3075 9.87676Z'
        fill='white'
      />
    </svg>
  ),
  qdrant: () => (
    <svg width='48' height='48' fill='none' viewBox='0 0 49 56' xmlns='http://www.w3.org/2000/svg'>
      <g clipPath='url(#b)'>
        <path
          d='m38.489 51.477-1.1167-30.787-2.0223-8.1167 13.498 1.429v37.242l-8.2456 4.7589-2.1138-4.5259z'
          clip-rule='evenodd'
          fill='#24386C'
          fill-rule='evenodd'
        />
        <path
          d='m48.847 14-8.2457 4.7622-17.016-3.7326-19.917 8.1094-3.3183-9.139 12.122-7 12.126-7 12.123 7 12.126 7z'
          clip-rule='evenodd'
          fill='#7589BE'
          fill-rule='evenodd'
        />
        <path
          d='m0.34961 13.999 8.2457 4.7622 4.7798 14.215 16.139 12.913-4.9158 10.109-12.126-7.0004-12.123-7v-28z'
          clip-rule='evenodd'
          fill='#B2BFE8'
          fill-rule='evenodd'
        />
        <path
          d='m30.066 38.421-5.4666 8.059v9.5207l7.757-4.4756 3.9968-5.9681'
          clip-rule='evenodd'
          fill='#24386C'
          fill-rule='evenodd'
        />
        <path
          d='m24.602 36.962-7.7603-13.436 1.6715-4.4531 6.3544-3.0809 7.488 7.5343-7.7536 13.436z'
          clip-rule='evenodd'
          fill='#7589BE'
          fill-rule='evenodd'
        />
        <path
          d='m16.843 23.525 7.7569 4.4756v8.9585l-7.1741 0.3087-4.3397-5.5412 3.7569-8.2016z'
          clip-rule='evenodd'
          fill='#B2BFE8'
          fill-rule='evenodd'
        />
        <path
          d='m24.6 28 7.757-4.4752 5.2792 8.7903-6.3886 5.2784-6.6476-0.6346v-8.9589z'
          clip-rule='evenodd'
          fill='#24386C'
          fill-rule='evenodd'
        />
        <path
          d='m32.355 51.524 8.2457 4.476v-37.238l-8.0032-4.6189-7.9995-4.6189-8.0031 4.6189-7.9995 4.6189v18.479l7.9995 4.6189 8.0031 4.6193 7.757-4.4797v9.5244zm0-19.045-7.757 4.4793-7.7569-4.4793v-8.9549l7.7569-4.4792 7.757 4.4792v8.9549z'
          clip-rule='evenodd'
          fill='#DC244C'
          fill-rule='evenodd'
        />
        <path d='m24.603 46.483v-9.5222l-7.7166-4.4411v9.5064l7.7166 4.4569z' fill='url(#a)' />
      </g>
      <defs>
        <linearGradient
          id='a'
          x1='23.18'
          x2='15.491'
          y1='38.781'
          y2='38.781'
          gradientUnits='userSpaceOnUse'
        >
          <stop stop-color='#FF3364' offset='0' />
          <stop stop-color='#C91540' stop-opacity='0' offset='1' />
        </linearGradient>
        <clipPath id='b'>
          <rect transform='translate(.34961)' width='48.3' height='56' fill='#fff' />
        </clipPath>
      </defs>
    </svg>
  ),
  slack: () => (
    <svg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <g clipPath='url(#clip0_82_6239)'>
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M17.599 0C14.9456 0.00195719 12.7982 2.15095 12.8001 4.79902C12.7982 7.44709 14.9475 9.59609 17.6009 9.59804H22.4017V4.80098C22.4037 2.15291 20.2543 0.00391437 17.599 0C17.6009 0 17.6009 0 17.599 0ZM17.599 12.8H4.80079C2.14741 12.802 -0.00195575 14.9509 5.35946e-06 17.599C-0.00391685 20.2471 2.14545 22.3961 4.79883 22.4H17.599C20.2523 22.398 22.4017 20.2491 22.3997 17.601C22.4017 14.9509 20.2523 12.802 17.599 12.8Z'
          fill='#36C5F0'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M47.9998 17.599C48.0018 14.9509 45.8524 12.802 43.1991 12.8C40.5457 12.802 38.3963 14.9509 38.3983 17.599V22.4H43.1991C45.8524 22.398 48.0018 20.2491 47.9998 17.599ZM35.1997 17.599V4.79902C35.2017 2.15291 33.0543 0.00391437 30.4009 0C27.7475 0.00195719 25.5981 2.15095 25.6001 4.79902V17.599C25.5962 20.2471 27.7456 22.3961 30.3989 22.4C33.0523 22.398 35.2017 20.2491 35.1997 17.599Z'
          fill='#2EB67D'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M30.3989 48.0001C33.0523 47.9981 35.2017 45.8492 35.1997 43.2011C35.2017 40.553 33.0523 38.404 30.3989 38.4021H25.5981V43.2011C25.5962 45.8472 27.7456 47.9962 30.3989 48.0001ZM30.3989 35.1981H43.1991C45.8524 35.1962 48.0018 33.0472 47.9998 30.3991C48.0038 27.751 45.8544 25.6021 43.201 25.5981H30.4009C27.7475 25.6001 25.5981 27.7491 25.6001 30.3972C25.5981 33.0472 27.7456 35.1962 30.3989 35.1981Z'
          fill='#ECB22E'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M1.34093e-06 30.3991C-0.00195976 33.0472 2.14741 35.1962 4.80079 35.1981C7.45416 35.1962 9.60353 33.0472 9.60157 30.3991V25.6001H4.80079C2.14741 25.6021 -0.00195976 27.751 1.34093e-06 30.3991ZM12.8001 30.3991V43.1991C12.7962 45.8472 14.9456 47.9962 17.599 48.0001C20.2523 47.9981 22.4017 45.8491 22.3997 43.2011V30.403C22.4037 27.755 20.2543 25.606 17.6009 25.6021C14.9456 25.6021 12.7982 27.751 12.8001 30.3991Z'
          fill='#E01E5A'
        />
      </g>
      <defs>
        <clipPath id='clip0_82_6239'>
          <rect width='48' height='48' fill='white' />
        </clipPath>
      </defs>
    </svg>
  ),
  perplexity: () => (
    <svg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M24 4.5V43.5M13.73 16.573V6.583L24 16.573M24 16.573L13.73 27.01V41.417L24 31.073M24 16.573L34.27 6.583V16.573'
        stroke='#20808D'
        strokeWidth='1.66667'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M13.7299 31.396H9.43994V16.573H38.5599V31.396H34.2699'
        stroke='#20808D'
        strokeWidth='1.66667'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M24 16.573L34.27 27.01V41.417L24 31.073'
        stroke='#20808D'
        strokeWidth='1.66667'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  ),
  supabase: () => (
    <svg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <g clipPath='url(#clip0_82_6260)'>
        <path
          d='M28.0545 46.8463C26.7953 48.376 24.2421 47.5379 24.2117 45.5847L23.7681 17.0178H43.6813C47.2882 17.0178 49.2997 21.0363 47.057 23.7611L28.0545 46.8463Z'
          fill='url(#paint0_linear_82_6260)'
        />
        <path
          d='M28.0545 46.8463C26.7953 48.376 24.2421 47.5379 24.2117 45.5847L23.7681 17.0178H43.6813C47.2882 17.0178 49.2997 21.0363 47.057 23.7611L28.0545 46.8463Z'
          fill='url(#paint1_linear_82_6260)'
          fillOpacity='0.2'
        />
        <path
          d='M19.956 0.879624C21.2152 -0.650174 23.7685 0.188045 23.7988 2.1412L23.9932 30.7081H4.32919C0.722252 30.7081 -1.2894 26.6896 0.953498 23.9648L19.956 0.879624Z'
          fill='#3ECF8E'
        />
      </g>
      <defs>
        <linearGradient
          id='paint0_linear_82_6260'
          x1='23.7681'
          y1='23.3518'
          x2='41.2706'
          y2='30.9617'
          gradientUnits='userSpaceOnUse'
        >
          <stop stopColor='#249361' />
          <stop offset='1' stopColor='#3ECF8E' />
        </linearGradient>
        <linearGradient
          id='paint1_linear_82_6260'
          x1='15.9216'
          y1='12.9889'
          x2='23.5483'
          y2='27.8727'
          gradientUnits='userSpaceOnUse'
        >
          <stop />
          <stop offset='1' stopOpacity='0' />
        </linearGradient>
        <clipPath id='clip0_82_6260'>
          <rect width='48' height='48' fill='white' />
        </clipPath>
      </defs>
    </svg>
  ),
  notion: () => (
    <svg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <g clipPath='url(#clip0_82_6265)'>
        <path
          d='M3.01725 2.0665L30.7669 0.108884C34.1754 -0.170519 35.0513 0.0178987 37.1944 1.50608L46.0524 7.46703C47.5136 8.49205 48 8.77163 48 9.88781V42.5792C48 44.628 47.2209 45.8398 44.4945 46.0252L12.27 47.8886C10.2238 47.9812 9.24938 47.7018 8.17781 46.3972L1.65488 38.295C0.484875 36.8036 0 35.6873 0 34.3827V5.32405C0 3.64906 0.779062 2.25187 3.01725 2.0665Z'
          fill='white'
        />
        <path
          d='M30.7669 0.108884L3.01725 2.0665C0.779062 2.25187 0 3.64906 0 5.32405V34.3829C0 35.6875 0.484688 36.8036 1.65488 38.295L8.17781 46.3972C9.24938 47.7018 10.2238 47.9812 12.27 47.8886L44.4945 46.0252C47.2192 45.8398 48 44.628 48 42.5792V9.88781C48 8.82912 47.562 8.52411 46.2731 7.62035L46.0509 7.46703L37.1944 1.50608C35.0513 0.0178987 34.1756 -0.170519 30.7669 0.108884ZM12.9988 9.35282C10.3676 9.52208 9.77081 9.56041 8.27644 8.39945L4.47675 5.51247C4.0905 5.13885 4.28437 4.67247 5.25731 4.57987L31.9337 2.71808C34.1738 2.53127 35.3406 3.27688 36.2166 3.92847L40.7917 7.09503C40.9873 7.18906 41.4739 7.74644 40.8887 7.74644L13.3399 9.33044L12.9988 9.35282ZM9.93131 42.2998V14.5472C9.93131 13.3352 10.3207 12.7764 11.4876 12.6822L43.1287 10.9128C44.202 10.8202 44.6869 11.4716 44.6869 12.6822V40.2494C44.6869 41.4614 44.4911 42.4864 42.7393 42.5792L12.4605 44.2558C10.7087 44.3484 9.93131 43.7912 9.93131 42.2998ZM39.8207 16.0352C40.0146 16.8736 39.8207 17.712 38.943 17.8078L37.4837 18.084V38.5743C36.2166 39.2257 35.0498 39.5978 34.0749 39.5978C32.5172 39.5978 32.1276 39.1315 30.9607 37.7359L21.4174 23.3934V37.2697L24.4361 37.9227C24.4361 37.9227 24.4361 39.5995 22.0007 39.5995L15.2856 39.9715C15.09 39.5978 15.2856 38.6669 15.9662 38.4817L17.7195 38.0169V19.6698L15.2858 19.4814C15.09 18.6432 15.5764 17.4326 16.9406 17.3384L24.1455 16.8754L34.0751 31.4031V18.5506L31.5442 18.2726C31.3487 17.2458 32.1276 16.5002 33.1005 16.4092L39.8205 16.0354L39.8207 16.0352Z'
          fill='black'
        />
      </g>
      <defs>
        <clipPath id='clip0_82_6265'>
          <rect width='48' height='48' fill='white' />
        </clipPath>
      </defs>
    </svg>
  ),
  reddit: () => (
    <svg width='48' height='48' viewBox='0 0 48 48' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <g clipPath='url(#clip0_82_6246)'>
        <path
          d='M24 0C10.7444 0 0 10.7444 0 24C0 30.6267 2.68667 36.6267 7.02889 40.9711L2.45778 45.5422C1.55111 46.4489 2.19333 48 3.47556 48H24C37.2556 48 48 37.2556 48 24C48 10.7444 37.2556 0 24 0Z'
          fill='#FF4500'
        />
        <path
          d='M37.6044 29.3778C40.6997 29.3778 43.2089 26.8686 43.2089 23.7734C43.2089 20.6781 40.6997 18.1689 37.6044 18.1689C34.5092 18.1689 32 20.6781 32 23.7734C32 26.8686 34.5092 29.3778 37.6044 29.3778Z'
          fill='url(#paint0_radial_82_6246)'
        />
        <path
          d='M10.3955 29.3778C13.4907 29.3778 15.9999 26.8686 15.9999 23.7734C15.9999 20.6781 13.4907 18.1689 10.3955 18.1689C7.30021 18.1689 4.79102 20.6781 4.79102 23.7734C4.79102 26.8686 7.30021 29.3778 10.3955 29.3778Z'
          fill='url(#paint1_radial_82_6246)'
        />
        <path
          d='M24.0132 40.5867C32.8497 40.5867 40.0132 35.2141 40.0132 28.5867C40.0132 21.9593 32.8497 16.5867 24.0132 16.5867C15.1766 16.5867 8.01318 21.9593 8.01318 28.5867C8.01318 35.2141 15.1766 40.5867 24.0132 40.5867Z'
          fill='url(#paint2_radial_82_6246)'
        />
        <path
          d='M19.2843 27.44C19.191 29.4578 17.8421 30.1911 16.271 30.1911C14.6999 30.1911 13.5021 29.0955 13.5954 27.0778C13.6888 25.06 15.0377 23.74 16.6088 23.74C18.1799 23.74 19.3777 25.4244 19.2843 27.4422V27.44Z'
          fill='url(#paint3_radial_82_6246)'
        />
        <path
          d='M28.7444 27.44C28.8377 29.4578 30.1866 30.1911 31.7577 30.1911C33.3288 30.1911 34.5266 29.0955 34.4332 27.0778C34.3399 25.06 32.991 23.74 31.4199 23.74C29.8488 23.74 28.651 25.4244 28.7444 27.4422V27.44Z'
          fill='url(#paint4_radial_82_6246)'
        />
        <path
          d='M17.6955 26.5377C18.0391 26.5377 18.3177 26.2342 18.3177 25.8599C18.3177 25.4856 18.0391 25.1821 17.6955 25.1821C17.3518 25.1821 17.0732 25.4856 17.0732 25.8599C17.0732 26.2342 17.3518 26.5377 17.6955 26.5377Z'
          fill='#FFC49C'
        />
        <path
          d='M32.4909 26.5377C32.8345 26.5377 33.1131 26.2342 33.1131 25.8599C33.1131 25.4856 32.8345 25.1821 32.4909 25.1821C32.1472 25.1821 31.8687 25.4856 31.8687 25.8599C31.8687 26.2342 32.1472 26.5377 32.4909 26.5377Z'
          fill='#FFC49C'
        />
        <path
          d='M24.0133 31.76C22.0666 31.76 20.2 31.8556 18.4755 32.0311C18.18 32.06 17.9933 32.3667 18.1088 32.64C19.0755 34.9489 21.3555 36.5711 24.0133 36.5711C26.6711 36.5711 28.9533 34.9489 29.9177 32.64C30.0333 32.3667 29.8444 32.06 29.5511 32.0311C27.8244 31.8556 25.96 31.76 24.0133 31.76Z'
          fill='url(#paint5_radial_82_6246)'
        />
        <path
          d='M32.7758 14.9557C34.969 14.9557 36.7469 13.1777 36.7469 10.9845C36.7469 8.79135 34.969 7.01343 32.7758 7.01343C30.5826 7.01343 28.8047 8.79135 28.8047 10.9845C28.8047 13.1777 30.5826 14.9557 32.7758 14.9557Z'
          fill='url(#paint6_radial_82_6246)'
        />
        <path
          d='M23.9557 17.0933C23.4801 17.0933 23.0957 16.8955 23.0957 16.5888C23.0957 13.0311 25.9913 10.1355 29.549 10.1355C30.0246 10.1355 30.409 10.5199 30.409 10.9955C30.409 11.4711 30.0246 11.8555 29.549 11.8555C26.9401 11.8555 24.8179 13.9777 24.8179 16.5866C24.8179 16.8933 24.4335 17.0911 23.9579 17.0911L23.9557 17.0933Z'
          fill='url(#paint7_radial_82_6246)'
        />
        <path
          d='M13.9599 27.2555C14.0465 25.3533 15.311 24.1089 16.7799 24.1089C18.171 24.1089 19.2465 25.5289 19.2865 27.2933C19.3243 25.32 18.1465 23.74 16.6088 23.74C15.071 23.74 13.6888 25.0844 13.5954 27.1178C13.5021 29.1511 14.6999 30.1911 16.271 30.1911H16.3865C14.9554 30.1555 13.8754 29.1267 13.9621 27.2578L13.9599 27.2555ZM34.0665 27.2555C33.9799 25.3533 32.7154 24.1089 31.2465 24.1089C29.8554 24.1089 28.7799 25.5289 28.7399 27.2933C28.7021 25.32 29.8799 23.74 31.4177 23.74C32.9888 23.74 34.3377 25.0844 34.431 27.1178C34.5243 29.1511 33.3265 30.1911 31.7554 30.1911H31.6399C33.071 30.1555 34.151 29.1267 34.0643 27.2578L34.0665 27.2555Z'
          fill='#842123'
        />
      </g>
      <defs>
        <radialGradient
          id='paint0_radial_82_6246'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(37.7222 20.4101) scale(11.3289 9.85613)'
        >
          <stop stopColor='#FEFFFF' />
          <stop offset='0.4' stopColor='#FEFFFF' />
          <stop offset='0.51' stopColor='#F9FCFC' />
          <stop offset='0.62' stopColor='#EDF3F5' />
          <stop offset='0.7' stopColor='#DEE9EC' />
          <stop offset='0.72' stopColor='#D8E4E8' />
          <stop offset='0.76' stopColor='#CCD8DF' />
          <stop offset='0.8' stopColor='#C8D5DD' />
          <stop offset='0.83' stopColor='#CCD6DE' />
          <stop offset='0.85' stopColor='#D8DBE2' />
          <stop offset='0.88' stopColor='#EDE3E9' />
          <stop offset='0.9' stopColor='#FFEBEF' />
        </radialGradient>
        <radialGradient
          id='paint1_radial_82_6246'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(10.5132 2.68339) scale(11.3289 9.85613)'
        >
          <stop stopColor='#FEFFFF' />
          <stop offset='0.4' stopColor='#FEFFFF' />
          <stop offset='0.51' stopColor='#F9FCFC' />
          <stop offset='0.62' stopColor='#EDF3F5' />
          <stop offset='0.7' stopColor='#DEE9EC' />
          <stop offset='0.72' stopColor='#D8E4E8' />
          <stop offset='0.76' stopColor='#CCD8DF' />
          <stop offset='0.8' stopColor='#C8D5DD' />
          <stop offset='0.83' stopColor='#CCD6DE' />
          <stop offset='0.85' stopColor='#D8DBE2' />
          <stop offset='0.88' stopColor='#EDE3E9' />
          <stop offset='0.9' stopColor='#FFEBEF' />
        </radialGradient>
        <radialGradient
          id='paint2_radial_82_6246'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(24.3576 18.994) scale(34.1733 23.9213)'
        >
          <stop stopColor='#FEFFFF' />
          <stop offset='0.4' stopColor='#FEFFFF' />
          <stop offset='0.51' stopColor='#F9FCFC' />
          <stop offset='0.62' stopColor='#EDF3F5' />
          <stop offset='0.7' stopColor='#DEE9EC' />
          <stop offset='0.72' stopColor='#D8E4E8' />
          <stop offset='0.76' stopColor='#CCD8DF' />
          <stop offset='0.8' stopColor='#C8D5DD' />
          <stop offset='0.83' stopColor='#CCD6DE' />
          <stop offset='0.85' stopColor='#D8DBE2' />
          <stop offset='0.88' stopColor='#EDE3E9' />
          <stop offset='0.9' stopColor='#FFEBEF' />
        </radialGradient>
        <radialGradient
          id='paint3_radial_82_6246'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(16.5886 28.3364) scale(3.05544 4.42611)'
        >
          <stop stopColor='#FF6600' />
          <stop offset='0.5' stopColor='#FF4500' />
          <stop offset='0.7' stopColor='#FC4301' />
          <stop offset='0.82' stopColor='#F43F07' />
          <stop offset='0.92' stopColor='#E53812' />
          <stop offset='1' stopColor='#D4301F' />
        </radialGradient>
        <radialGradient
          id='paint4_radial_82_6246'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(31.4596 28.3364) rotate(180) scale(3.05544 4.42611)'
        >
          <stop stopColor='#FF6600' />
          <stop offset='0.5' stopColor='#FF4500' />
          <stop offset='0.7' stopColor='#FC4301' />
          <stop offset='0.82' stopColor='#F43F07' />
          <stop offset='0.92' stopColor='#E53812' />
          <stop offset='1' stopColor='#D4301F' />
        </radialGradient>
        <radialGradient
          id='paint5_radial_82_6246'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(23.9844 37.243) scale(10.0667 6.644)'
        >
          <stop stopColor='#172E35' />
          <stop offset='0.29' stopColor='#0E1C21' />
          <stop offset='0.73' stopColor='#030708' />
          <stop offset='1' />
        </radialGradient>
        <radialGradient
          id='paint6_radial_82_6246'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(32.8625 7.29369) scale(8.83778 8.66102)'
        >
          <stop stopColor='#FEFFFF' />
          <stop offset='0.4' stopColor='#FEFFFF' />
          <stop offset='0.51' stopColor='#F9FCFC' />
          <stop offset='0.62' stopColor='#EDF3F5' />
          <stop offset='0.7' stopColor='#DEE9EC' />
          <stop offset='0.72' stopColor='#D8E4E8' />
          <stop offset='0.76' stopColor='#CCD8DF' />
          <stop offset='0.8' stopColor='#C8D5DD' />
          <stop offset='0.83' stopColor='#CCD6DE' />
          <stop offset='0.85' stopColor='#D8DBE2' />
          <stop offset='0.88' stopColor='#EDE3E9' />
          <stop offset='0.9' stopColor='#FFEBEF' />
        </radialGradient>
        <radialGradient
          id='paint7_radial_82_6246'
          cx='0'
          cy='0'
          r='1'
          gradientUnits='userSpaceOnUse'
          gradientTransform='translate(29.1801 16.2399) scale(7.24444)'
        >
          <stop offset='0.48' stopColor='#7A9299' />
          <stop offset='0.67' stopColor='#172E35' />
          <stop offset='0.75' />
          <stop offset='0.82' stopColor='#172E35' />
        </radialGradient>
        <clipPath id='clip0_82_6246'>
          <rect width='48' height='48' fill='white' />
        </clipPath>
      </defs>
    </svg>
  ),
  youtube: () => (
    <svg width='48' height='34' viewBox='0 0 48 34' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <g clipPath='url(#clip0_82_6277)'>
        <path
          d='M46.9399 5.38906C46.6646 4.3716 46.1275 3.44402 45.3822 2.69868C44.6369 1.95333 43.7094 1.41624 42.6919 1.14087C38.967 0.125 23.9757 0.125 23.9757 0.125C23.9757 0.125 8.98354 0.15575 5.25866 1.17162C4.24119 1.44701 3.31362 1.98413 2.56831 2.72951C1.82299 3.47488 1.28595 4.40251 1.01066 5.42C-0.116026 12.0384 -0.553089 22.1232 1.0416 28.4769C1.31692 29.4943 1.85397 30.4219 2.59928 31.1673C3.34459 31.9126 4.27215 32.4497 5.2896 32.7251C9.01447 33.7409 24.0062 33.7409 24.0062 33.7409C24.0062 33.7409 38.9978 33.7409 42.7225 32.7251C43.74 32.4497 44.6676 31.9126 45.4129 31.1673C46.1582 30.422 46.6953 29.4944 46.9707 28.4769C48.159 21.8491 48.5252 11.7704 46.9399 5.38906Z'
          fill='#FF0000'
        />
        <path d='M19.2041 24.1362L31.6406 16.9329L19.2041 9.72949V24.1362Z' fill='white' />
      </g>
      <defs>
        <clipPath id='clip0_82_6277'>
          <rect width='48' height='33.75' fill='white' transform='translate(0 0.125)' />
        </clipPath>
      </defs>
    </svg>
  ),
}

export default Integrations
