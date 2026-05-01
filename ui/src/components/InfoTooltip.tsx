import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'

/**
 * Small inline info icon that reveals an explanation on hover or focus.
 * Use to clarify the meaning of a score, label, or jargon term without
 * cluttering the UI with verbose subtitles.
 */
export default function InfoTooltip({
  text,
  size = 12,
  className = '',
}: {
  text: string
  size?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<'top' | 'bottom'>('top')
  const wrapperRef = useRef<HTMLSpanElement>(null)

  // Flip the tooltip below if there isn't enough room above
  useEffect(() => {
    if (!open || !wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    setPosition(rect.top < 80 ? 'bottom' : 'top')
  }, [open])

  return (
    <span
      ref={wrapperRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="More info"
        tabIndex={0}
        className="inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-100 cursor-help"
        style={{
          color: 'var(--text-secondary)',
          opacity: 0.55,
          background: 'transparent',
          border: 'none',
          padding: 0,
          width: size + 2,
          height: size + 2,
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <Info style={{ width: size, height: size }} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg text-xs leading-snug whitespace-normal w-60 pointer-events-none"
          style={{
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            ...(position === 'top'
              ? { bottom: '100%', marginBottom: 8 }
              : { top: '100%', marginTop: 8 }),
          }}
        >
          {text}
        </span>
      )}
    </span>
  )
}
