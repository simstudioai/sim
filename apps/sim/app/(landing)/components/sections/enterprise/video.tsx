import React from 'react'

function Video() {
  return (
    <div className='relative flex w-full flex-col overflow-hidden border-border border-b py-10 will-change-[opacity,transform] sm:py-12 md:py-16 gap-16 px-8 sm:px-8 md:px-12 lg:px-40'>
      <div className='bg-[url("/static/video-bg.png")] bg-cover bg-center w-full h-full shadow-xs flex items-center justify-center rounded-[10px] p-4 sm:p-8 md:p-12 lg:p-24 xl:p-32'>
        <div className='flex aspect-video w-full h-full bg-white/50 border-border shadow-sm rounded-[10px] p-1'>
          <div className='bg-background rounded-[6px] w-full h-full'>

          </div>
        </div>
      </div>
    </div>
  )
}

export default Video
