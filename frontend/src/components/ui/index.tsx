import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
export { useToast, ToastProvider } from './Toast'

export function cn(...inputs: any[]) {
  return twMerge(clsx(inputs))
}

export function Badge({ children, className, variant = 'default' }: {
  children: React.ReactNode; className?: string; variant?: 'default' | 'green' | 'yellow' | 'red' | 'blue' | 'purple'
}) {
  const variants = {
    default: 'bg-white/10 text-white/70',
    green: 'bg-green-500/20 text-green-400',
    yellow: 'bg-yellow-500/20 text-yellow-400',
    red: 'bg-red-500/20 text-red-400',
    blue: 'bg-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/20 text-purple-400',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  )
}

export function Button({ children, onClick, disabled, variant = 'primary', size = 'md', className, type = 'button' }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  type?: 'button' | 'submit'
}) {
  const variants = {
    primary: 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40',
    secondary: 'bg-white/10 hover:bg-white/15 text-white disabled:opacity-40',
    ghost: 'hover:bg-white/5 text-white/70 hover:text-white',
    danger: 'bg-red-600 hover:bg-red-500 text-white disabled:opacity-40',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all',
        variants[variant], sizes[size], disabled && 'cursor-not-allowed', className
      )}
    >
      {children}
    </button>
  )
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white/5 border border-white/10 rounded-xl p-4', className)}>
      {children}
    </div>
  )
}

export function Spinner({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }
  return (
    <div className={cn('animate-spin rounded-full border-2 border-white/20 border-t-indigo-500', sizes[size])} />
  )
}

export function Input({ label, value, onChange, type = 'text', placeholder, className, min, max, step }: {
  label?: string; value: string | number; onChange: (v: string) => void
  type?: string; placeholder?: string; className?: string; min?: string; max?: string; step?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && <label className="text-sm text-white/60">{label}</label>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min} max={max} step={step}
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-500 transition-colors"
      />
    </div>
  )
}
