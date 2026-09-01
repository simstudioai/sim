import { type ComponentType, type CSSProperties, createElement, type ReactNode } from 'react'
import { Body, Head, Html, Link, Markdown, Section, Text } from 'react-email'
import { colors, fontWeight, typography } from '@/components/emails/_styles'
import { getBrandConfig } from '@/ee/whitelabeling'

const CODE_FONT_FAMILY = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"

const BODY_TEXT = {
  fontSize: typography.fontSize.base,
  lineHeight: '25px',
  color: colors.textPrimary,
  fontFamily: typography.systemFontFamily,
  fontWeight: fontWeight.normal,
}

const HEADING = {
  fontWeight: fontWeight.semibold,
  color: colors.textPrimary,
  margin: '24px 0 12px 0',
  fontFamily: typography.systemFontFamily,
}

const CODE_SURFACE = {
  backgroundColor: colors.surfaceSubtle,
  fontFamily: CODE_FONT_FAMILY,
  fontSize: typography.fontSize.small,
  color: colors.textPrimary,
}

const emailStyles = {
  body: BODY_TEXT,
  content: { margin: 0 },
  markdownContainer: { margin: 0 },
  signature: { color: colors.textSecondary, marginTop: '32px', fontSize: typography.fontSize.sm },
  signatureText: {
    color: colors.textSecondary,
    margin: '0 0 16px 0',
    fontSize: typography.fontSize.sm,
    lineHeight: '25px',
    fontFamily: typography.systemFontFamily,
  },
  signatureLink: {
    color: colors.textPrimary,
    textDecoration: 'underline',
    textDecorationStyle: 'dashed',
    textUnderlineOffset: '2px',
  },
} satisfies Record<string, CSSProperties>

const markdownStyles = {
  p: { ...BODY_TEXT, margin: '0 0 16px 0' },
  h1: { ...HEADING, fontSize: typography.fontSize.display, lineHeight: '32px' },
  h2: { ...HEADING, fontSize: '20px', lineHeight: '28px' },
  h3: { ...HEADING, fontSize: typography.fontSize.md, lineHeight: '24px' },
  h4: { ...HEADING, fontSize: typography.fontSize.base, lineHeight: '25px' },
  /**
   * `bold`, not `strong` — that is the key `@react-email/markdown` looks up. A
   * `strong` key silently falls through to its default of 700, off the
   * platform's 400/500/600 scale.
   */
  bold: { fontWeight: fontWeight.semibold, color: colors.textPrimary },
  codeInline: { ...CODE_SURFACE, padding: '2px 6px', borderRadius: '4px' },
  codeBlock: {
    ...CODE_SURFACE,
    padding: '16px',
    borderRadius: '8px',
    border: `1px solid ${colors.border}`,
    overflowX: 'auto',
    margin: '24px 0',
    lineHeight: '21px',
  },
  table: { borderCollapse: 'collapse', margin: '16px 0' },
  th: {
    border: `1px solid ${colors.border}`,
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: typography.fontSize.sm,
    backgroundColor: colors.surfaceSubtle,
    fontWeight: fontWeight.semibold,
  },
  td: {
    border: `1px solid ${colors.border}`,
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: typography.fontSize.sm,
  },
  blockQuote: {
    borderLeft: `4px solid ${colors.border}`,
    margin: '16px 0',
    padding: '4px 16px',
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  a: {
    color: colors.textPrimary,
    textDecoration: 'underline',
    textDecorationStyle: 'dashed',
    textUnderlineOffset: '2px',
  },
  ul: { margin: '16px 0', paddingLeft: '24px' },
  ol: { margin: '16px 0', paddingLeft: '24px' },
  li: { margin: '4px 0' },
  hr: { border: 'none', borderTop: `1px solid ${colors.border}`, margin: '24px 0' },
} satisfies Record<string, CSSProperties>

interface EmailMarkdownProps {
  children?: string
  markdownContainerStyles?: CSSProperties
  markdownCustomStyles?: Record<string, CSSProperties>
}

const EmailMarkdown = Markdown as ComponentType<EmailMarkdownProps>

/**
 * Shell for the agent's reply. Deliberately not {@link EmailLayout}: this lands
 * inside an existing mail thread, where a logo header and unsubscribe footer
 * would be wrong — the same carve-out as `plainEmailStyles`.
 */
function InboxShell({
  children,
  chatUrl,
  linkLabel,
}: {
  children?: ReactNode
  chatUrl: string
  linkLabel: string
}) {
  return createElement(
    Html,
    { lang: 'en', dir: 'ltr' },
    createElement(Head),
    createElement(
      Body,
      { style: emailStyles.body },
      createElement(Section, { style: emailStyles.content }, children),
      createElement(
        Section,
        { style: emailStyles.signature },
        createElement(
          Text,
          { style: emailStyles.signatureText },
          createElement(Link, { href: chatUrl, style: emailStyles.signatureLink }, linkLabel)
        ),
        createElement(
          Text,
          { style: emailStyles.signatureText },
          'Best,',
          createElement('br'),
          getBrandConfig().name
        )
      )
    )
  )
}

/** The agent's reply carrying its markdown answer. */
export function InboxResponseEmail({ markdown, chatUrl }: { markdown: string; chatUrl: string }) {
  return createElement(
    InboxShell,
    { chatUrl, linkLabel: 'View full conversation' },
    createElement(
      EmailMarkdown,
      {
        markdownContainerStyles: emailStyles.markdownContainer,
        markdownCustomStyles: markdownStyles,
      },
      markdown
    )
  )
}

/** The agent's reply when it could not complete the task. */
export function InboxErrorEmail({ error, chatUrl }: { error: string; chatUrl: string }) {
  return createElement(
    InboxShell,
    { chatUrl, linkLabel: 'View details' },
    createElement(Text, { style: markdownStyles.p }, "I wasn't able to complete this task."),
    createElement(
      Text,
      { style: { ...markdownStyles.p, color: colors.textSecondary } },
      `Error: ${error}`
    )
  )
}
