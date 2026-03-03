---
paths:
  - "apps/sim/**/*.tsx"
  - "apps/sim/**/*.ts"
  - "apps/sim/**/*.json"
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
## Rules
1. No duplicate keys in translation files
2. Don't translate logger info or error messages that are not user-facing.
3. Do not translate error messages or similars as keys to be rendered as translations later. For example, if there is an error message like "Invalid email address", do not create a key like "errors.invalid_email" with the value "Invalid email address". If possible, just create a new hook that calls useTranslation inside it and returns the same object or function with translated texts and keep the code in the same file.
4. Detect Component Type (Client vs Server) and use the appropriate next-intl functions (useTranslations for Client, getTranslations for Server).
5. No namespaces in keys
6. You MUST replace every user-visible or accessibility string.
7. If a component is rendering rich text like <strong> or <em>, you must use the rich text formatting capabilities of next-intl. 
eg. 
```
{
  "message": "Please refer to <guidelines>the guidelines</guidelines>."
}
// Returns `<>Please refer to <a href="/guidelines">the guidelines</a>.</>`
t.rich('message', {
  guidelines: (chunks) => <a href="/guidelines">{chunks}</a>
});
```
8. All the translations must be applied in en.json, es.json and pt.json in the translations folder. Find the right place to change the translations file to reuse existing translations and avoid duplicates. If there is no right place, create a new key following the Key Naming Rules.

## What Must NOT Be Translated

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

## Key Naming Rules

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

