'use client'

import * as React from 'react'
import { ChipInput, type ChipInputProps } from '@sim/emcn'

/** Auth fields use the larger shared chip size while retaining native input props and refs. */
export const AuthInput = React.forwardRef<HTMLInputElement, Omit<ChipInputProps, 'size'>>(
  (props, ref) => <ChipInput {...props} ref={ref} size='lg' />
)

AuthInput.displayName = 'AuthInput'
