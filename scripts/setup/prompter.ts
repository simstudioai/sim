import * as clack from '@clack/prompts'
import { exitWith } from './terminal.ts'
import { isRich, theme } from './theme.ts'

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒']

function guardCancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel('Setup cancelled.')
    exitWith(130)
  }
  return value as T
}

export interface SelectOption<T extends string> {
  value: T
  label: string
  hint?: string
}

export async function select<T extends string>(params: {
  message: string
  options: SelectOption<T>[]
  initialValue?: T
}): Promise<T> {
  return guardCancel(
    await clack.select({
      message: isRich() ? theme.accent(params.message) : params.message,
      options: params.options.map((o) => ({
        ...o,
        hint: o.hint && isRich() ? theme.muted(o.hint) : o.hint,
      })),
      initialValue: params.initialValue,
    })
  )
}

export async function multiselect<T extends string>(params: {
  message: string
  options: SelectOption<T>[]
  initialValues?: T[]
}): Promise<T[]> {
  return guardCancel(
    await clack.multiselect({
      message: isRich() ? theme.accent(params.message) : params.message,
      options: params.options,
      initialValues: params.initialValues,
      required: false,
    })
  )
}

export async function text(params: {
  message: string
  placeholder?: string
  initialValue?: string
  defaultValue?: string
  validate?: (value: string) => string | undefined
}): Promise<string> {
  return guardCancel(
    await clack.text({
      message: isRich() ? theme.accent(params.message) : params.message,
      placeholder: params.placeholder,
      initialValue: params.initialValue,
      defaultValue: params.defaultValue,
      validate: params.validate,
    })
  )
}

export async function password(params: {
  message: string
  validate?: (value: string) => string | undefined
}): Promise<string> {
  return guardCancel(
    await clack.password({
      message: isRich() ? theme.accent(params.message) : params.message,
      validate: params.validate,
    })
  )
}

export async function confirm(params: {
  message: string
  initialValue?: boolean
}): Promise<boolean> {
  return guardCancel(
    await clack.confirm({
      message: isRich() ? theme.accent(params.message) : params.message,
      initialValue: params.initialValue,
    })
  )
}

export function spinner() {
  if (!isRich() || !process.stdout.isTTY) return clack.spinner()
  return clack.spinner({
    frames: SPINNER_FRAMES,
    delay: 90,
  })
}

export function note(message: string, title?: string): void {
  clack.note(message, title && isRich() ? theme.heading(title) : title)
}

export const outro = clack.outro
export const log = clack.log
