'use client'

import { ChatHeader } from '../header/header'

interface ChatErrorStateProps {
  error: string
  starCount: string
}

export function ChatErrorState({ error, starCount }: ChatErrorStateProps) {
  return (
    <div className='flex min-h-screen items-center justify-center bg-gray-50'>
      <div className='mx-auto max-w-md rounded-xl bg-white p-6 shadow-md'>
        <div className='mb-2 flex items-center justify-between'>
          <a href='https://simstudio.ai' target='_blank' rel='noopener noreferrer'>
            <svg
              width='32'
              height='32'
              viewBox='0 0 50 50'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
              className='rounded-[6px]'
            >
              <rect width='50' height='50' fill='#701FFC' />
              <path
                d='M34.1455 20.0728H16.0364C12.7026 20.0728 10 22.7753 10 26.1091V35.1637C10 38.4975 12.7026 41.2 16.0364 41.2H34.1455C37.4792 41.2 40.1818 38.4975 40.1818 35.1637V26.1091C40.1818 22.7753 37.4792 20.0728 34.1455 20.0728Z'
                fill='#701FFC'
                stroke='white'
                strokeWidth='3.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <path
                d='M25.0919 14.0364C26.7588 14.0364 28.1101 12.6851 28.1101 11.0182C28.1101 9.35129 26.7588 8 25.0919 8C23.425 8 22.0737 9.35129 22.0737 11.0182C22.0737 12.6851 23.425 14.0364 25.0919 14.0364Z'
                fill='#701FFC'
                stroke='white'
                strokeWidth='4'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <path
                d='M25.0915 14.856V19.0277V14.856ZM20.5645 32.1398V29.1216V32.1398ZM29.619 29.1216V32.1398V29.1216Z'
                fill='#701FFC'
              />
              <path
                d='M25.0915 14.856V19.0277M20.5645 32.1398V29.1216M29.619 29.1216V32.1398'
                stroke='white'
                strokeWidth='4'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <circle cx='25' cy='11' r='2' fill='#701FFC' />
            </svg>
          </a>
          <ChatHeader chatConfig={null} starCount={starCount} />
        </div>
        <h2 className='mb-2 font-bold text-red-500 text-xl'>Error</h2>
        <p className='text-gray-700'>{error}</p>
      </div>
    </div>
  )
}
