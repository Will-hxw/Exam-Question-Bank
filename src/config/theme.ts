
/**
 * 全站单一视觉令牌与动效定义（供 UnoCSS 引擎按需编译与 Preflight 注入）
 */

type ThemePair = { readonly cssVar: string; readonly light: string; readonly dark: string }

export const semanticColors = {
  canvas: { cssVar: '--bg-canvas', light: '#FFFFFF', dark: '#0B0C0F' },
  'canvas-header': { cssVar: '--bg-canvas-header', light: 'rgba(255, 255, 255, 0.88)', dark: 'rgba(11, 12, 15, 0.88)' },
  'canvas-footer': { cssVar: '--bg-canvas-footer', light: 'rgba(255, 255, 255, 0.92)', dark: 'rgba(11, 12, 15, 0.92)' },
  stage: { cssVar: '--bg-desktop-stage', light: '#F4F5F8', dark: '#050608' },
  surface: { cssVar: '--surface', light: '#F4F5F8', dark: '#17191F' },
  'surface-hover': { cssVar: '--surface-hover', light: '#ECEEF2', dark: '#1F222A' },
  'surface-badge': { cssVar: '--surface-badge', light: '#FFFFFF', dark: '#232732' },
  'ink-primary': { cssVar: '--ink-primary', light: '#111318', dark: '#F3F4F6' },
  'ink-body': { cssVar: '--ink-body', light: '#374151', dark: '#CBD5E1' },
  'ink-secondary': { cssVar: '--ink-secondary', light: '#646A73', dark: '#94A3B8' },
  'ink-muted': { cssVar: '--ink-muted', light: '#8C939E', dark: '#64748B' },
  cta: { cssVar: '--cta-bg', light: '#111318', dark: '#F3F4F6' },
  'cta-ink': { cssVar: '--cta-ink', light: '#FFFFFF', dark: '#0B0C0F' },
  'cta-disabled': { cssVar: '--cta-disabled-bg', light: '#ECEEF2', dark: '#17191F' },
  'cta-disabled-ink': { cssVar: '--cta-disabled-ink', light: '#9CA3AF', dark: '#475569' },
  'selected-fill': { cssVar: '--selected-fill', light: '#EFF4FF', dark: 'rgba(59, 130, 246, 0.16)' },
  'selected-ink': { cssVar: '--selected-ink', light: '#1D4ED8', dark: '#60A5FA' },
  'selected-badge': { cssVar: '--selected-badge', light: '#1D4ED8', dark: '#2563EB' },
  'correct-fill': { cssVar: '--correct-fill', light: '#ECFDF5', dark: 'rgba(16, 185, 129, 0.14)' },
  'correct-ink': { cssVar: '--correct-ink', light: '#047857', dark: '#34D399' },
  'correct-badge': { cssVar: '--correct-badge', light: '#059669', dark: '#059669' },
  'wrong-fill': { cssVar: '--wrong-fill', light: '#FEF2F2', dark: 'rgba(239, 68, 68, 0.15)' },
  'wrong-ink': { cssVar: '--wrong-ink', light: '#B91C1C', dark: '#F87171' },
  'wrong-badge': { cssVar: '--wrong-badge', light: '#DC2626', dark: '#DC2626' },
  'missed-fill': { cssVar: '--missed-fill', light: '#FFFBEB', dark: 'rgba(245, 158, 11, 0.14)' },
  'missed-ink': { cssVar: '--missed-ink', light: '#B45309', dark: '#FBBF24' },
  'missed-badge': { cssVar: '--missed-badge', light: '#D97706', dark: '#D97706' },
  'progress-track': { cssVar: '--progress-track', light: '#ECEEF2', dark: '#232732' },
  'progress-fill': { cssVar: '--progress-fill', light: '#111318', dark: '#F3F4F6' },
  scrim: { cssVar: '--scrim', light: 'rgba(17, 19, 24, 0.36)', dark: 'rgba(0, 0, 0, 0.68)' },
  handle: { cssVar: '--handle-bar', light: '#DDE1E8', dark: '#2C313D' },
} as const satisfies Record<string, ThemePair>

export function cssVarRef(name: keyof typeof semanticColors): string {
  return `var(${semanticColors[name].cssVar})`
}

export const unoThemeColors: Record<string, string> = Object.fromEntries(
  Object.entries(semanticColors).map(([name, token]) => [name, `var(${token.cssVar})`]),
)

export const layoutVars = {
  desktopShadowLight: '0 20px 60px rgba(17, 19, 24, 0.08), 0 4px 16px rgba(17, 19, 24, 0.04)',
  desktopShadowDark: '0 24px 72px rgba(0, 0, 0, 0.55)',
  navPillShadowLight: '0 1px 3px rgba(17, 19, 24, 0.06), 0 1px 2px rgba(17, 19, 24, 0.04)',
  navPillShadowDark: '0 1px 4px rgba(0, 0, 0, 0.35)',
  chatViewportOffsetMobile: '5.5rem',
  chatViewportOffsetDesktop: '12rem',
  chatShellMin: '26rem',
  studyMainMax: '660px',
  studyRailWidth: '320px',
} as const

export const motionVars = {
  easeSilk: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeSpring: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easeBounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  tactile: '240ms',
  popover: '260ms',
  msg: '340ms',
  option: '380ms',
  question: '420ms',
  collapse: '420ms',
  view: '460ms',
  feedback: '480ms',
  drawer: '440ms',
  scrim: '340ms',
  progress: '620ms',
  ring: '1100ms',
  pop: '420ms',
  shake: '400ms',
  check: '420ms',
  checkDelay: '60ms',
  ringDelay: '120ms',
  themeTransition: '320ms',
  iconSwap: '380ms',
  staggerStep: '42ms',
  checkStrokeLen: '28',
} as const

type AnimationSpec = {
  readonly keyframeName: string
  readonly keyframes: string
  readonly declaration: string
  readonly extra?: Record<string, string>
}

export const onDemandAnimations: Record<string, AnimationSpec> = {
  'view-enter': {
    keyframeName: 'view-enter',
    keyframes: 'from{opacity:0;transform:translate3d(0,12px,0)}to{opacity:1;transform:translate3d(0,0,0)}',
    declaration: 'view-enter var(--motion-view) var(--ease-silk) both',
  },
  'question-enter': {
    keyframeName: 'question-enter',
    keyframes: 'from{opacity:0;transform:translate3d(0,10px,0)}to{opacity:1;transform:translate3d(0,0,0)}',
    declaration: 'question-enter var(--motion-question) var(--ease-silk) both',
  },
  'slide-next': {
    keyframeName: 'slide-next',
    keyframes: 'from{opacity:0;transform:translate3d(16px,0,0)}to{opacity:1;transform:translate3d(0,0,0)}',
    declaration: 'slide-next var(--motion-question) var(--ease-silk) both',
  },
  'slide-prev': {
    keyframeName: 'slide-prev',
    keyframes: 'from{opacity:0;transform:translate3d(-16px,0,0)}to{opacity:1;transform:translate3d(0,0,0)}',
    declaration: 'slide-prev var(--motion-question) var(--ease-silk) both',
  },
  'option-in': {
    keyframeName: 'option-enter',
    keyframes: 'from{opacity:0;transform:translate3d(0,8px,0)}to{opacity:1;transform:translate3d(0,0,0)}',
    declaration: 'option-enter var(--motion-option) var(--ease-silk) both',
  },
  'feedback-bloom': {
    keyframeName: 'feedback-bloom',
    keyframes: 'from{opacity:0;transform:translate3d(0,10px,0) scale(0.992)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}',
    declaration: 'feedback-bloom var(--motion-feedback) var(--ease-silk) both',
  },
  'pop-correct': {
    keyframeName: 'pop-correct',
    keyframes: '0%{transform:scale(1)}40%{transform:scale(1.015)}100%{transform:scale(1)}',
    declaration: 'pop-correct var(--motion-pop) var(--ease-bounce)',
  },
  'shake-wrong': {
    keyframeName: 'shake-wrong',
    keyframes: '0%,100%{transform:translate3d(0,0,0)}18%{transform:translate3d(-5px,0,0)}42%{transform:translate3d(4px,0,0)}66%{transform:translate3d(-2.5px,0,0)}84%{transform:translate3d(1px,0,0)}',
    declaration: 'shake-wrong var(--motion-shake) var(--ease-spring)',
  },
  'badge-pop': {
    keyframeName: 'badge-pop',
    keyframes: '0%{opacity:0;transform:scale(0.82)}100%{opacity:1;transform:scale(1)}',
    declaration: 'badge-pop var(--motion-option) var(--ease-bounce) both',
  },
  'bookmark-pop': {
    keyframeName: 'bookmark-pop',
    keyframes: '0%{transform:scale(1)}42%{transform:scale(1.2) rotate(-6deg)}100%{transform:scale(1) rotate(0deg)}',
    declaration: 'bookmark-pop var(--motion-pop) var(--ease-bounce)',
  },
  'icon-swap': {
    keyframeName: 'icon-swap',
    keyframes: '0%{opacity:0;transform:rotate(-28deg) scale(0.78)}100%{opacity:1;transform:rotate(0deg) scale(1)}',
    declaration: 'icon-swap var(--motion-icon-swap) var(--ease-bounce) both',
  },
  'check-draw': {
    keyframeName: 'check-draw',
    keyframes: 'from{stroke-dashoffset:var(--check-stroke-len)}to{stroke-dashoffset:0}',
    declaration: 'check-draw var(--motion-check) var(--ease-silk) var(--motion-check-delay) forwards',
    extra: {
      'stroke-dasharray': 'var(--check-stroke-len)',
      'stroke-dashoffset': 'var(--check-stroke-len)',
    },
  },
  'popover-in': {
    keyframeName: 'popover-in',
    keyframes: 'from{opacity:0;transform:translate3d(0,-6px,0) scale(0.97)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}',
    declaration: 'popover-in var(--motion-popover) var(--ease-silk) both',
  },
  'popover-up': {
    keyframeName: 'popover-up',
    keyframes: 'from{opacity:0;transform:translate3d(0,6px,0) scale(0.96)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}',
    declaration: 'popover-up var(--motion-popover) var(--ease-silk) both',
  },
  'msg-in': {
    keyframeName: 'msg-in',
    keyframes: 'from{opacity:0;transform:translate3d(0,9px,0) scale(0.985)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}',
    declaration: 'msg-in var(--motion-msg) var(--ease-silk) both',
  },
  'ring-draw': {
    keyframeName: 'ring-draw',
    keyframes: 'from{stroke-dashoffset:var(--ring-circumference)}to{stroke-dashoffset:var(--ring-target)}',
    declaration: 'ring-draw var(--motion-ring) var(--ease-silk) var(--motion-ring-delay) both',
  },
}

export const typographyTheme = {
  fontSize: {
    'hero-title': ['24px', { 'line-height': '1.3' }],
    'stem-lg': ['23px', { 'line-height': '1.55', 'letter-spacing': '-0.01em' }],
    'page-title': ['22px', { 'line-height': '1.35' }],
    'stat-num': ['22px', { 'line-height': '1' }],
    stem: ['21px', { 'line-height': '1.55', 'letter-spacing': '-0.01em' }],
    'sub-title': ['20px', { 'line-height': '1.35' }],
    'stat-num-sm': ['20px', { 'line-height': '1' }],
    'drawer-title': ['18px', { 'line-height': '1.35' }],
    'item-stem': ['16.5px', { 'line-height': '1.58' }],
    'section-title': ['16px', { 'line-height': '1.4' }],
    option: ['15.5px', { 'line-height': '1.48' }],
    action: ['15px', { 'line-height': '1.2' }],
    explain: ['15px', { 'line-height': '1.8' }],
    body: ['14.5px', { 'line-height': '1.55' }],
    control: ['13.5px', { 'line-height': '1.35' }],
    meta: ['13px', { 'line-height': '1.3' }],
    label: ['12px', { 'line-height': '1.2' }],
    micro: ['11px', { 'line-height': '1.2' }],
    nano: ['10px', { 'line-height': '1.2' }],
  } as Record<string, [string, Record<string, string>]>,
  maxWidth: {
    topbar: '1240px',
    shell: '1120px',
    library: '840px',
    result: '780px',
    chat: '760px',
    history: '720px',
    exam: '680px',
    feedback: '560px',
    sponsor: '520px',
    auth: '380px',
    trigger: '270px',
    nickname: '140px',
    bubble: '78%',
  },
  borderRadius: {
    shell: '30px',
    sheet: '24px',
    option: '16px',
    control: '14px',
    compact: '12px',
    micro: '10px',
    tag: '8px',
  },
  fontFamily: {
    serif: 'var(--font-serif), "Noto Serif SC", "Songti SC", "STSong", serif',
    sans: 'var(--font-sans), "Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
}

export function buildThemePreflight(): string {
  const lightVars = Object.values(semanticColors)
    .map(({ cssVar, light }) => `${cssVar}:${light};`)
    .join('')
  const darkVars = Object.values(semanticColors)
    .map(({ cssVar, dark }) => `${cssVar}:${dark};`)
    .join('')

  return [
    `:root{color-scheme:light;${lightVars}--desktop-shadow:${layoutVars.desktopShadowLight};--nav-pill-shadow:${layoutVars.navPillShadowLight};--study-main-max:${layoutVars.studyMainMax};--study-rail-width:${layoutVars.studyRailWidth};--ease-silk:${motionVars.easeSilk};--ease-spring:${motionVars.easeSpring};--ease-bounce:${motionVars.easeBounce};--motion-tactile:${motionVars.tactile};--motion-popover:${motionVars.popover};--motion-msg:${motionVars.msg};--motion-option:${motionVars.option};--motion-question:${motionVars.question};--motion-collapse:${motionVars.collapse};--motion-view:${motionVars.view};--motion-feedback:${motionVars.feedback};--motion-drawer:${motionVars.drawer};--motion-scrim:${motionVars.scrim};--motion-progress:${motionVars.progress};--motion-ring:${motionVars.ring};--motion-pop:${motionVars.pop};--motion-shake:${motionVars.shake};--motion-check:${motionVars.check};--motion-check-delay:${motionVars.checkDelay};--motion-ring-delay:${motionVars.ringDelay};--motion-theme:${motionVars.themeTransition};--motion-icon-swap:${motionVars.iconSwap};--motion-stagger-step:${motionVars.staggerStep};--check-stroke-len:${motionVars.checkStrokeLen};--chat-viewport-offset:${layoutVars.chatViewportOffsetMobile};--chat-shell-min:${layoutVars.chatShellMin};}`,
    `@media (min-width:1024px){:root{--chat-viewport-offset:${layoutVars.chatViewportOffsetDesktop};}}`,
    `:root[data-theme="dark"]{color-scheme:dark;${darkVars}--desktop-shadow:${layoutVars.desktopShadowDark};--nav-pill-shadow:${layoutVars.navPillShadowDark};}`,
    '*,*::before,*::after{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}',
    'body{transition:background-color var(--motion-theme) var(--ease-silk),color var(--motion-theme) var(--ease-silk);}',
    'button,input,select,textarea{font:inherit;}',
    'button{cursor:pointer;}button:disabled{cursor:default;}',
    ':focus-visible{outline:2px solid var(--selected-badge);outline-offset:3px;}',
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms !important;animation-iteration-count:1 !important;transition-duration:0.01ms !important;}}',
  ].join('\n')
}
