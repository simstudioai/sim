import type React from 'react'

interface IconProps {
  className?: string
}

export const PdfIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={className}>
    <path
      d='M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z'
      fill='#E53935'
    />
    <path d='M14 2V8H20' fill='#EF5350' />
    <path
      d='M14 2L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2H14Z'
      stroke='#C62828'
      strokeWidth='0.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <text
      x='12'
      y='16'
      textAnchor='middle'
      fontSize='7'
      fontWeight='bold'
      fill='white'
      fontFamily='Arial, sans-serif'
    >
      PDF
    </text>
  </svg>
)

export const DocxIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={className}>
    <path
      d='M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z'
      fill='#2196F3'
    />
    <path d='M14 2V8H20' fill='#64B5F6' />
    <path
      d='M14 2L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2H14Z'
      stroke='#1565C0'
      strokeWidth='0.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <text
      x='12'
      y='16'
      textAnchor='middle'
      fontSize='8'
      fontWeight='bold'
      fill='white'
      fontFamily='Arial, sans-serif'
    >
      W
    </text>
  </svg>
)

export const XlsxIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={className}>
    <path
      d='M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z'
      fill='#4CAF50'
    />
    <path d='M14 2V8H20' fill='#81C784' />
    <path
      d='M14 2L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2H14Z'
      stroke='#2E7D32'
      strokeWidth='0.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <text
      x='12'
      y='16'
      textAnchor='middle'
      fontSize='8'
      fontWeight='bold'
      fill='white'
      fontFamily='Arial, sans-serif'
    >
      X
    </text>
  </svg>
)

export const CsvIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={className}>
    <path
      d='M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z'
      fill='#4CAF50'
    />
    <path d='M14 2V8H20' fill='#81C784' />
    <path
      d='M14 2L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2H14Z'
      stroke='#2E7D32'
      strokeWidth='0.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <text
      x='12'
      y='16'
      textAnchor='middle'
      fontSize='6.5'
      fontWeight='bold'
      fill='white'
      fontFamily='Arial, sans-serif'
    >
      CSV
    </text>
  </svg>
)

export const TxtIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={className}>
    <path
      d='M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z'
      fill='#757575'
    />
    <path d='M14 2V8H20' fill='#9E9E9E' />
    <path
      d='M14 2L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2H14Z'
      stroke='#424242'
      strokeWidth='0.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <text
      x='12'
      y='16'
      textAnchor='middle'
      fontSize='6'
      fontWeight='bold'
      fill='white'
      fontFamily='Arial, sans-serif'
    >
      TXT
    </text>
  </svg>
)

export const AudioIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={className}>
    <path
      d='M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z'
      fill='#0288D1'
    />
    <path d='M14 2V8H20' fill='#29B6F6' />
    <path
      d='M14 2L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2H14Z'
      stroke='#01579B'
      strokeWidth='0.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* Speaker icon */}
    <path d='M8.5 10.5v3c0 .28.22.5.5.5h1.5l2 2V8l-2 2H9c-.28 0-.5.22-.5.5z' fill='white' />
    {/* Sound waves */}
    <path
      d='M14 10.5c.6.6.6 1.4 0 2M15.5 9c1.2 1.2 1.2 3.8 0 5'
      stroke='white'
      strokeWidth='0.8'
      strokeLinecap='round'
    />
  </svg>
)

export const VideoIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={className}>
    <path
      d='M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z'
      fill='#D32F2F'
    />
    <path d='M14 2V8H20' fill='#EF5350' />
    <path
      d='M14 2L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2H14Z'
      stroke='#B71C1C'
      strokeWidth='0.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* Video screen */}
    <rect
      x='7.5'
      y='9.5'
      width='9'
      height='6'
      rx='0.5'
      stroke='white'
      strokeWidth='0.8'
      fill='none'
    />
    {/* Play button */}
    <path d='M10.5 11.5l3 2-3 2v-4z' fill='white' />
  </svg>
)

export const DefaultFileIcon: React.FC<IconProps> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' className={className}>
    <path
      d='M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z'
      fill='#607D8B'
    />
    <path d='M14 2V8H20' fill='#90A4AE' />
    <path
      d='M14 2L20 8V20C20 21.1 19.1 22 18 22H6C4.9 22 4 21.1 4 20V4C4 2.9 4.9 2 6 2H14Z'
      stroke='#37474F'
      strokeWidth='0.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <rect x='8' y='13' width='8' height='1' fill='white' rx='0.5' />
    <rect x='8' y='15' width='8' height='1' fill='white' rx='0.5' />
    <rect x='8' y='17' width='5' height='1' fill='white' rx='0.5' />
  </svg>
)

export function getDocumentIcon(mimeType: string, filename: string): React.FC<IconProps> {
  const extension = filename.split('.').pop()?.toLowerCase()

  const audioExtensions = ['mp3', 'm4a', 'wav', 'webm', 'ogg', 'flac', 'aac', 'opus']
  if (mimeType.startsWith('audio/') || (extension && audioExtensions.includes(extension))) {
    return AudioIcon
  }

  const videoExtensions = ['mp4', 'mov', 'avi', 'mkv']
  if (mimeType.startsWith('video/') || (extension && videoExtensions.includes(extension))) {
    return VideoIcon
  }

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return PdfIcon
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    extension === 'docx' ||
    extension === 'doc'
  ) {
    return DocxIcon
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    extension === 'xlsx' ||
    extension === 'xls'
  ) {
    return XlsxIcon
  }

  if (mimeType === 'text/csv' || extension === 'csv') {
    return CsvIcon
  }

  if (mimeType === 'text/plain' || extension === 'txt') {
    return TxtIcon
  }

  return DefaultFileIcon
}
