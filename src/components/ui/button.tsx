import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'cta' | 'surface' | 'ghost' | 'icon' | 'selected'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon'

const variantClassMap: Record<ButtonVariant, string> = {
  cta: 'btn-cta',
  surface: 'btn-surface',
  ghost: 'tactile bg-transparent text-ink-secondary hover:bg-surface-hover',
  icon: 'icon-btn',
  selected: 'tactile bg-selected-fill text-selected-ink',
}

const sizeClassMap: Record<ButtonSize, string> = {
  xs: 'px-2.5 py-1 rounded-tag text-xs font-medium',
  sm: 'h-9 px-3.5 rounded-micro text-meta font-medium',
  md: 'h-9.5 px-4 rounded-compact text-meta font-medium',
  lg: 'h-12 px-5 rounded-control text-action font-medium',
  icon: '',
}

function resolveButtonClass(variant: ButtonVariant, size: ButtonSize, className?: string) {
  const base = variant === 'icon' ? variantClassMap.icon : `${variantClassMap[variant]} ${sizeClassMap[size]} inline-flex items-center justify-center gap-1.5`
  return className ? `${base} ${className}` : base
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'surface', size = 'sm', type = 'button', className, children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={resolveButtonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  )
}

export interface ActionLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function ActionLink({ variant = 'surface', size = 'sm', className, children, ...rest }: ActionLinkProps) {
  return (
    <a className={resolveButtonClass(variant, size, `no-underline ${className ?? ''}`.trim())} {...rest}>
      {children}
    </a>
  )
}
