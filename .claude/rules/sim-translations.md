---
name: next-intl-auto-i18n
description: Automatically refactor React/Next.js components to use next-intl without namespaces
---

# Next-Intl Auto I18n Refactoring

## Overview

You will receive a React or Next.js component.

Your job is to:

1. Convert the component to use next-intl
2. Replace all user-visible and accessibility text with t() calls
3. Use no namespaces

Do not include explanations.

---
## translation files cant have duplicate keys

## 0. Don't translate logger info or error messages that are not user-facing.

## 0.1 Do not translate error messages or similars as keys to be rendered as translations later. For example, if there is an error message like "Invalid email address", do not create a key like "errors.invalid_email" with the value "Invalid email address". If possible, just create a new hook that calls useTranslation inside it and returns the same object or function with translated texts and keep the code in the same file.


## 1. Detect Component Type

### Client Component

If the file contains:

'use client'

Use:

import { useTranslations } from 'next-intl'
const t = useTranslations()

---

### Server Component

If the file does NOT contain 'use client'

Use:

import { getTranslations } from 'next-intl/server'
const t = await getTranslations()

Never import both.

---

## 2. No Namespaces

Do NOT pass a namespace to:

useTranslations
getTranslations

Forbidden:

useTranslations('signup')
getTranslations('signup')

Always:

const t = useTranslations()

Keys must NOT be prefixed with file names or component names.

---

## 3. What Must Be Translated

You MUST replace every user-visible or accessibility string.

### Visible text

- headings
- paragraphs
- button text
- link text
- labels
- helper text
- validation messages
- loading text
- divider text
- empty states

### Attributes

- aria-label
- title
- alt
- placeholder
- loadingText
- any prop that renders text

### JSX logic

- ternaries returning text
- template strings that render text

### Text inside

- <span>
- <p>
- <h1>–<h6>
- <button>
- <Link>
- custom components with text props

---

## 4. What Must NOT Be Translated

Do NOT translate:

- className
- variable names
- function names
- API field names
- route paths (/login, /workspace)
- console logs (unless rendered in UI)
- error codes
- environment variable names
- regex patterns
- non-user-facing constants

---

## 5. Key Naming Rules

All keys must be:

- snake_case
- descriptive
- stable

Keys must be grouped semantically:

- title
- subtitle
- description
- labels.*
- placeholders.*
- buttons.*
- links.*
- aria.*
- errors.*
- helper_text.*
- loading.*

Examples:

t('title')
t('labels.email')
t('placeholders.password')
t('buttons.create_account')
t('buttons.loading')
t('aria.show_password')
t('errors.invalid_email')

---

## 6. Replacement Rules

Every hardcoded rendered string must become t().

### Basic

Before:

<button>Create account</button>

After:

<button>{t('buttons.create_account')}</button>

---

### Conditional

Before:

{isLoading ? 'Saving...' : 'Save'}

After:

{isLoading ? t('buttons.saving') : t('buttons.save')}

---

### Attributes

Before:

<input placeholder="Enter your email" aria-label="Email address" />

After:

<input
  placeholder={t('placeholders.email')}
  aria-label={t('aria.email_address')}
/>

---

## 7. Validation and Errors

Inline validation or error messages must be moved to:

errors.*

Only keep validation logic in code.

Example:

Before:

{error && <p>Invalid email address</p>}

After:

{error && <p>{t('errors.invalid_email')}</p>}

---

## 8. Output Format (STRICT)

You must:
- translate associated files
- output the refactored component
- if needed, modify translation files (en, es, pt) maintaining the same keys but with translated values
- include every key referenced in the component
- use snake_case
- preserve the same semantic grouping used in the keys

Do NOT include explanations.
Do NOT include comments.
Do NOT include markdown.
