import { defineConfig, presetWind3 } from 'unocss'
import {
  buildThemePreflight,
  onDemandAnimations,
  typographyTheme,
  unoThemeColors,
} from './src/config/theme.ts'

/**
 * UnoCSS 高性能按需编译引擎配置（零 globals.css、单源令牌、从容优雅的弹簧动效体系）
 */
export default defineConfig({
  content: {
    filesystem: ['src/app/**/*.tsx', 'src/features/**/*.tsx', 'src/components/**/*.tsx'],
  },
  presets: [
    presetWind3({
      preflight: 'on-demand',
      dark: {
        dark: '[data-theme="dark"]',
        light: '[data-theme="light"]',
      },
    }),
  ],
  preflights: [
    {
      layer: 'preflights',
      getCSS: buildThemePreflight,
    },
  ],
  theme: {
    colors: unoThemeColors,
    ...typographyTheme,
  },
  shortcuts: {
    tactile:
      'transition-all duration-tactile ease-spring active:scale-97 cursor-pointer select-none border-0 outline-none',
    'btn-surface':
      'tactile bg-surface text-ink-primary hover:bg-surface-hover disabled:opacity-35 disabled:cursor-default',
    'btn-cta':
      'tactile bg-cta text-cta-ink disabled:bg-cta-disabled disabled:text-cta-disabled-ink disabled:cursor-default',
    'floating-header': 'bg-transparent sticky top-0 z-20 pointer-events-none',
    'glass-footer':
      'bg-canvas-footer backdrop-blur-xl fixed bottom-0 inset-x-0 z-20 px-5 py-3 flex items-center gap-2.5',
    'badge-tag':
      'px-2.5 py-1 rounded-tag text-label font-medium bg-surface text-ink-secondary inline-flex items-center gap-1.5',
    'icon-btn': 'btn-surface w-9.5 h-9.5 rounded-compact flex items-center justify-center shrink-0',
    'option-row':
      'tactile w-full px-4 py-3.75 min-h-14 rounded-option flex items-center justify-between gap-3 text-left hover:-translate-y-0.25 active:translate-y-0 active:scale-985',
    'option-badge':
      'w-7.5 h-7.5 rounded-micro text-meta font-semibold tabular-nums flex items-center justify-center shrink-0 transition-all duration-tactile ease-spring group-hover:scale-106 group-active:scale-95',
    'stat-tile': 'p-3.5 rounded-control bg-surface',
    'sheet-cell':
      'tactile h-11 rounded-compact text-control font-semibold tabular-nums flex items-center justify-center',
    'input-flat':
      'w-full h-12 px-4 rounded-control bg-surface text-ink-primary text-body border-0 outline-none transition-colors duration-tactile ease-silk focus:bg-surface-hover',
    'textarea-flat':
      'w-full min-h-28 p-4 rounded-option bg-surface text-ink-primary text-body leading-relaxed border-0 outline-none resize-y transition-colors duration-tactile ease-silk focus:bg-surface-hover',
    'drawer-overlay':
      'fixed inset-0 z-40 flex flex-col justify-end bg-scrim backdrop-blur-sm transition-opacity duration-scrim ease-silk',
    'drawer-panel':
      'bg-canvas rounded-t-sheet max-h-5/6 flex flex-col transition-transform duration-drawer ease-silk',
    'study-two-col':
      'lg:grid lg:study-grid-cols lg:justify-between lg:gap-10 lg:items-start',
    'study-rail': 'hidden lg:flex lg:flex-col lg:gap-5 lg:sticky lg:top-22',
    'dropdown-panel':
      'animate-popover-in origin-top absolute top-full mt-1.5 min-w-full w-max max-w-80 bg-canvas rounded-option shadow-desktop p-1.5 z-30 max-h-72 overflow-y-auto no-scrollbar flex flex-col gap-0.5',
    'chat-shell': 'max-w-chat w-full mx-auto flex flex-col gap-4 h-chat min-h-chat',
    'chat-log-viewport': 'flex-1 min-h-0 overflow-y-auto no-scrollbar py-2 flex flex-col gap-3',
    'chat-composer-form':
      'shrink-0 sticky bottom-3 lg:bottom-0 z-10 p-3 rounded-option bg-surface flex flex-col gap-2.5',
    'chat-composer-input':
      'w-full min-h-15 p-1 bg-transparent text-ink-primary text-body border-0 outline-none resize-none',
    'emoji-popover':
      'animate-popover-up origin-bottom-left absolute bottom-full mb-2 left-0 p-2 rounded-option bg-canvas shadow-desktop grid grid-cols-8 gap-1 z-30',
    'otp-input': 'input-flat tabular-nums tracking-widest text-center text-base font-semibold',
    'progress-pill': 'w-11 h-1.25 rounded-full overflow-hidden bg-progress-track',
    'progress-fill-bar': 'h-full rounded-full bg-progress-fill transition-all duration-progress ease-silk',
    'nav-indicator':
      'nav-pill-glide pointer-events-none absolute top-1 bottom-1 left-0 rounded-micro bg-canvas shadow-nav-pill',
    'status-pill-correct':
      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-micro text-meta font-semibold bg-correct-fill text-correct-ink',
    'status-pill-wrong':
      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-micro text-meta font-semibold bg-wrong-fill text-wrong-ink',
    'missed-tag':
      'px-2 py-0.5 rounded-tag text-micro font-semibold bg-missed-badge/15 text-missed-ink shrink-0',
    'confirm-dialog':
      'rounded-sheet bg-canvas text-ink-primary p-6 max-w-sm w-11/12 shadow-desktop border-0 backdrop:bg-scrim',
    'collapse-grid':
      'grid grid-rows-collapsed transition-rows duration-collapse ease-silk motion-reduce:transition-none',
    'collapse-inner': 'overflow-hidden',
    'colophon-link':
      'tactile inline-flex items-baseline gap-1.5 text-ink-muted hover:text-ink-primary no-underline',
    'colophon-title': 'font-editorial italic text-colophon font-normal',
    'colophon-email':
      'font-editorial text-colophon font-normal tracking-wide text-ink-secondary group-hover:text-ink-primary group-hover:underline underline-offset-4 transition-colors',
  },
  rules: [
    ['shadow-desktop', { 'box-shadow': 'var(--desktop-shadow)' }],
    ['shadow-nav-pill', { 'box-shadow': 'var(--nav-pill-shadow)' }],
    ['study-grid-cols', { 'grid-template-columns': 'minmax(0, var(--study-main-max)) var(--study-rail-width)' }],
    ['h-chat', { height: 'calc(100dvh - var(--chat-viewport-offset))' }],
    ['min-h-chat', { 'min-height': 'var(--chat-shell-min)' }],
    ['ease-silk', { 'transition-timing-function': 'var(--ease-silk)' }],
    ['ease-spring', { 'transition-timing-function': 'var(--ease-spring)' }],
    ['ease-bounce', { 'transition-timing-function': 'var(--ease-bounce)' }],
    ['duration-tactile', { 'transition-duration': 'var(--motion-tactile)' }],
    ['duration-collapse', { 'transition-duration': 'var(--motion-collapse)' }],
    ['duration-drawer', { 'transition-duration': 'var(--motion-drawer)' }],
    ['duration-scrim', { 'transition-duration': 'var(--motion-scrim)' }],
    ['duration-progress', { 'transition-duration': 'var(--motion-progress)' }],
    [
      'nav-pill-glide',
      {
        transition:
          'transform var(--motion-option) var(--ease-silk), width var(--motion-option) var(--ease-silk), opacity var(--motion-tactile) var(--ease-silk)',
      },
    ],
    ['grid-rows-collapsed', { 'grid-template-rows': '0fr' }],
    ['collapse-open', { 'grid-template-rows': '1fr' }],
    ['transition-rows', { 'transition-property': 'grid-template-rows' }],
    [
      /^no-scrollbar$/,
      function* (_, { symbols }) {
        yield { '-ms-overflow-style': 'none', 'scrollbar-width': 'none' }
        yield { [symbols.selector]: (selector) => `${selector}::-webkit-scrollbar`, display: 'none' }
      },
    ],
    [
      /^animate-([a-z-]+)$/,
      function* ([, name], { symbols }) {
        const spec = onDemandAnimations[name]
        if (!spec) return
        yield { ...(spec.extra ?? {}), animation: spec.declaration }
        yield {
          [symbols.selector]: () => `@keyframes ${spec.keyframeName}`,
          [symbols.body]: spec.keyframes,
        }
      },
    ],
    [/^stagger-(\d+)$/, ([, n]) => ({ 'animation-delay': `calc(var(--motion-stagger-step) * ${Number(n)})` })],
  ],
})
