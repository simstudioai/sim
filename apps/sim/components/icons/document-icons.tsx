import type { SVGProps } from 'react'
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
} from '@/lib/uploads/utils/validation'

export function PdfIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='4' y='2' width='16' height='20' rx='2' stroke='currentColor' strokeWidth='1.5' />
      <text
        x='12'
        y='12'
        textAnchor='middle'
        dominantBaseline='central'
        fontSize='5.5'
        fontWeight='bold'
        fontFamily='Arial, sans-serif'
        letterSpacing='0.5'
        fill='currentColor'
      >
        PDF
      </text>
    </svg>
  )
}

export function DocxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
      <path d='M16 9H8' />
      <path d='M16 13H8' />
      <path d='M16 17H8' />
    </svg>
  )
}

export function XlsxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='3' y='3' width='18' height='18' rx='2' stroke='currentColor' strokeWidth='1.5' />
      <line x1='3' y1='9' x2='21' y2='9' stroke='currentColor' strokeWidth='1.5' />
      <line x1='3' y1='15' x2='21' y2='15' stroke='currentColor' strokeWidth='1.5' />
      <line x1='9' y1='3' x2='9' y2='21' stroke='currentColor' strokeWidth='1.5' />
      <line x1='15' y1='3' x2='15' y2='21' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  )
}

export function CsvIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='3' y='1' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='13' y='1' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='3' y='9' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='13' y='9' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='3' y='17' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <rect x='13' y='17' width='8' height='6' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  )
}

export function TxtIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
      <path d='M16 13H8' />
      <path d='M12 17H8' />
    </svg>
  )
}

export function PptxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <rect x='2' y='4' width='20' height='16' rx='2' />
      <line x1='6' y1='9' x2='18' y2='9' />
      <line x1='8' y1='14' x2='16' y2='14' />
    </svg>
  )
}

export function AudioIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <line x1='4' y1='14' x2='4' y2='10' />
      <line x1='8' y1='17' x2='8' y2='7' />
      <line x1='12' y1='15' x2='12' y2='9' />
      <line x1='16' y1='18' x2='16' y2='6' />
      <line x1='20' y1='14' x2='20' y2='10' />
    </svg>
  )
}

export function VideoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='2' y='4' width='20' height='16' rx='2' stroke='currentColor' strokeWidth='1.5' />
      <path d='M10 9l5 3-5 3V9Z' fill='currentColor' />
    </svg>
  )
}

export function HtmlIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M8 8l-4 4 4 4' />
      <path d='M16 8l4 4-4 4' />
      <line x1='14' y1='4' x2='10' y2='20' />
    </svg>
  )
}

export function JsonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M8 3H7a2 2 0 0 0-2 2v4c0 1.1-.9 2-2 2 1.1 0 2 .9 2 2v4a2 2 0 0 0 2 2h1' />
      <path d='M16 3h1a2 2 0 0 1 2 2v4c0 1.1.9 2 2 2-1.1 0-2 .9-2 2v4a2 2 0 0 1-2 2h-1' />
    </svg>
  )
}

export function MarkdownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
      <rect x='2' y='4' width='20' height='16' rx='3' stroke='currentColor' strokeWidth='1.5' />
      <path
        d='M6 15V9l3 3.5L12 9v6'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M17 9v6m-2-2l2 2 2-2'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function DefaultFileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
    </svg>
  )
}

export function getDocumentIcon(
  mimeType: string,
  filename: string
): (props: SVGProps<SVGSVGElement>) => React.JSX.Element {
  const extension = filename.split('.').pop()?.toLowerCase()

  if (
    mimeType.startsWith('audio/') ||
    (extension &&
      SUPPORTED_AUDIO_EXTENSIONS.includes(extension as (typeof SUPPORTED_AUDIO_EXTENSIONS)[number]))
  ) {
    return AudioIcon
  }

  if (
    mimeType.startsWith('video/') ||
    (extension &&
      SUPPORTED_VIDEO_EXTENSIONS.includes(extension as (typeof SUPPORTED_VIDEO_EXTENSIONS)[number]))
  ) {
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

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    extension === 'pptx' ||
    extension === 'ppt'
  ) {
    return PptxIcon
  }

  if (mimeType === 'text/html' || extension === 'html' || extension === 'htm') {
    return HtmlIcon
  }

  if (mimeType === 'application/json' || extension === 'json') {
    return JsonIcon
  }

  if (mimeType === 'text/markdown' || extension === 'md' || extension === 'mdx') {
    return MarkdownIcon
  }

  return DefaultFileIcon
}
