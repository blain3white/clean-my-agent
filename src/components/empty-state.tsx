import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type EmptyStateTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const toneClasses: Record<EmptyStateTone, { icon: string; ring: string }> = {
  neutral: {
    icon: 'bg-white/7 text-white/72 ring-white/12',
    ring: 'border-white/9 bg-white/[0.03]',
  },
  info: {
    icon: 'bg-blue-400/12 text-blue-300 ring-blue-300/20',
    ring: 'border-blue-300/12 bg-blue-400/[0.045]',
  },
  success: {
    icon: 'bg-emerald-400/12 text-emerald-300 ring-emerald-300/20',
    ring: 'border-emerald-300/12 bg-emerald-400/[0.045]',
  },
  warning: {
    icon: 'bg-amber-400/13 text-amber-300 ring-amber-300/22',
    ring: 'border-amber-300/14 bg-amber-400/[0.055]',
  },
  danger: {
    icon: 'bg-rose-400/13 text-rose-300 ring-rose-300/22',
    ring: 'border-rose-300/14 bg-rose-400/[0.055]',
  },
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  actions,
  children,
  tone = 'neutral',
  compact = false,
  className,
}: {
  icon: LucideIcon
  title: string
  body: string
  actions?: ReactNode
  children?: ReactNode
  tone?: EmptyStateTone
  compact?: boolean
  className?: string
}) {
  const toneClass = toneClasses[tone]

  return (
    <div
      className={cn(
        'grid place-items-center rounded-lg border text-center shadow-[inset_0_1px_0_rgb(255_255_255_/_5%)]',
        toneClass.ring,
        compact ? 'min-h-40 p-5' : 'min-h-[360px] p-8',
        className,
      )}
    >
      <div className="mx-auto flex max-w-[520px] flex-col items-center">
        <div
          className={cn(
            'grid place-items-center rounded-lg ring-1',
            toneClass.icon,
            compact ? 'size-10' : 'size-12',
          )}
        >
          <Icon className={compact ? 'size-5' : 'size-6'} />
        </div>
        <div className={cn('font-semibold text-white', compact ? 'mt-3 text-sm' : 'mt-4 text-lg')}>
          {title}
        </div>
        <p className={cn('leading-5 text-white/50', compact ? 'mt-1.5 text-xs' : 'mt-2 text-sm')}>
          {body}
        </p>
        {children && <div className="mt-4 w-full">{children}</div>}
        {actions && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}
