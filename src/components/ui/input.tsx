import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from 'react'

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'otp'
  ref?: Ref<HTMLInputElement>
}

export function TextInput({ variant = 'default', className, ref, ...rest }: TextInputProps) {
  const base = variant === 'otp' ? 'otp-input' : 'input-flat'
  return <input ref={ref} className={className ? `${base} ${className}` : base} {...rest} />
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>
}

export function TextArea({ className, ref, ...rest }: TextAreaProps) {
  return <textarea ref={ref} className={className ? `textarea-flat ${className}` : 'textarea-flat'} {...rest} />
}
