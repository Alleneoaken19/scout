import { useState, useEffect, useCallback, useMemo, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, X, Check, Loader2, MapPin, Globe, Sparkles } from 'lucide-react'
import { fetchPreferences, savePreferences, fetchLocationPresets, dismissByLocation } from '../api'

const EXPERIENCE_LEVELS = ['junior', 'mid', 'senior', 'staff', 'lead']
const REMOTE_OPTIONS = [
  { value: 'remote_first', label: 'Remote First' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'on_site', label: 'On-site' },
  { value: 'any', label: 'Any' },
]

interface PrefsState {
  job_titles: string[]
  locations: string[]
  experience_levels: string[]
  salary_min: number
  remote_preference: string
  employment_type: string[]
  industries: string[]
  company_blacklist: string[]
  excluded_locations: string[]
  keywords_required: string[]
  keywords_excluded: string[]
  min_match_score: number
  max_applications_per_day: number
  apply_automatically: boolean
}

const DEFAULT_PREFS: PrefsState = {
  job_titles: [],
  locations: [],
  experience_levels: [],
  salary_min: 0,
  remote_preference: 'any',
  employment_type: [],
  industries: [],
  company_blacklist: [],
  excluded_locations: [],
  keywords_required: [],
  keywords_excluded: [],
  min_match_score: 0.5,
  max_applications_per_day: 10,
  apply_automatically: false,
}

export default function Preferences() {
  const queryClient = useQueryClient()
  const [prefs, setPrefs] = useState<PrefsState>(DEFAULT_PREFS)
  const [toast, setToast] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['preferences'],
    queryFn: fetchPreferences,
  })

  useEffect(() => {
    if (data) {
      setPrefs({ ...DEFAULT_PREFS, ...data })
    }
  }, [data])

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const saveMutation = useMutation({
    mutationFn: (p: PrefsState) => savePreferences(p),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
      setToast('Preferences saved successfully')
    },
    onError: () => {
      setToast('Failed to save preferences')
    },
  })

  const updateField = useCallback(<K extends keyof PrefsState>(key: K, value: PrefsState[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }))
  }, [])

  const addChip = useCallback((key: keyof PrefsState, value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setPrefs((prev) => {
      const arr = prev[key] as string[]
      if (arr.includes(trimmed)) return prev
      return { ...prev, [key]: [...arr, trimmed] }
    })
  }, [])

  const removeChip = useCallback((key: keyof PrefsState, value: string) => {
    setPrefs((prev) => ({
      ...prev,
      [key]: (prev[key] as string[]).filter((v) => v !== value),
    }))
  }, [])

  const toggleLevel = useCallback((level: string) => {
    setPrefs((prev) => {
      const levels = prev.experience_levels
      return {
        ...prev,
        experience_levels: levels.includes(level)
          ? levels.filter((l) => l !== level)
          : [...levels, level],
      }
    })
  }, [])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Preferences</h1>
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-xl"
              style={{ background: 'var(--bg-card)' }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium shadow-lg transition-all"
          style={{
            background: toast.includes('Failed') ? 'var(--danger)' : 'var(--success)',
            color: '#fff',
          }}
        >
          <Check className="w-4 h-4" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Preferences
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Configure your job search criteria
          </p>
        </div>
        <button
          onClick={() => saveMutation.mutate(prefs)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            opacity: saveMutation.isPending ? 0.7 : 1,
          }}
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Settings className="w-4 h-4" />
          )}
          {saveMutation.isPending ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>

      {/* Form sections */}
      <div className="space-y-5">
        {/* Job titles */}
        <FormCard title="Job Titles" description="Target job titles to search for">
          <ChipInput
            chips={prefs.job_titles}
            onAdd={(v) => addChip('job_titles', v)}
            onRemove={(v) => removeChip('job_titles', v)}
            placeholder="e.g. Software Engineer"
          />
        </FormCard>

        {/* Locations */}
        <FormCard title="Locations" description="Preferred job locations">
          <ChipInput
            chips={prefs.locations}
            onAdd={(v) => addChip('locations', v)}
            onRemove={(v) => removeChip('locations', v)}
            placeholder="e.g. San Francisco, CA"
          />
        </FormCard>

        {/* Experience levels */}
        <FormCard title="Experience Levels" description="Select all that apply">
          <div className="flex flex-wrap gap-2">
            {EXPERIENCE_LEVELS.map((level) => {
              const active = prefs.experience_levels.includes(level)
              return (
                <button
                  key={level}
                  onClick={() => toggleLevel(level)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-all"
                  style={{
                    background: active ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: active ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {level}
                </button>
              )
            })}
          </div>
        </FormCard>

        {/* Salary + Remote row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <FormCard title="Minimum Salary" description="Annual salary floor (USD)">
            <input
              type="number"
              value={prefs.salary_min}
              onChange={(e) => updateField('salary_min', Number(e.target.value))}
              className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none transition-colors"
              style={{
                background: 'var(--bg-secondary)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
              placeholder="e.g. 100000"
              min={0}
              step={5000}
            />
          </FormCard>

          <FormCard title="Remote Preference" description="Your work location preference">
            <select
              value={prefs.remote_preference}
              onChange={(e) => updateField('remote_preference', e.target.value)}
              className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none appearance-none transition-colors"
              style={{
                background: 'var(--bg-secondary)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              {REMOTE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FormCard>
        </div>

        {/* Employment type */}
        <FormCard title="Employment Type" description="Full-time, part-time, contract, etc.">
          <ChipInput
            chips={prefs.employment_type}
            onAdd={(v) => addChip('employment_type', v)}
            onRemove={(v) => removeChip('employment_type', v)}
            placeholder="e.g. full-time"
          />
        </FormCard>

        {/* Industries */}
        <FormCard title="Industries" description="Preferred industries to target">
          <ChipInput
            chips={prefs.industries}
            onAdd={(v) => addChip('industries', v)}
            onRemove={(v) => removeChip('industries', v)}
            placeholder="e.g. FinTech"
          />
        </FormCard>

        {/* Company blacklist */}
        <FormCard title="Company Blacklist" description="Companies to exclude from results">
          <ChipInput
            chips={prefs.company_blacklist}
            onAdd={(v) => addChip('company_blacklist', v)}
            onRemove={(v) => removeChip('company_blacklist', v)}
            placeholder="e.g. Acme Corp"
          />
        </FormCard>

        {/* Excluded locations */}
        <ExcludedLocationsCard
          excluded={prefs.excluded_locations}
          onAdd={(v) => addChip('excluded_locations', v)}
          onRemove={(v) => removeChip('excluded_locations', v)}
          onAddMany={(values) => {
            setPrefs((prev) => {
              const set = new Set(prev.excluded_locations.map((s) => s.toLowerCase()))
              const additions = values.filter((v) => !set.has(v.toLowerCase()))
              return additions.length === 0
                ? prev
                : { ...prev, excluded_locations: [...prev.excluded_locations, ...additions] }
            })
          }}
          onRemoveMany={(values) => {
            const drop = new Set(values.map((s) => s.toLowerCase()))
            setPrefs((prev) => ({
              ...prev,
              excluded_locations: prev.excluded_locations.filter((s) => !drop.has(s.toLowerCase())),
            }))
          }}
        />

        {/* Keywords required */}
        <FormCard title="Required Keywords" description="Jobs must contain these keywords">
          <ChipInput
            chips={prefs.keywords_required}
            onAdd={(v) => addChip('keywords_required', v)}
            onRemove={(v) => removeChip('keywords_required', v)}
            placeholder="e.g. React"
          />
        </FormCard>

        {/* Keywords excluded */}
        <FormCard title="Excluded Keywords" description="Hide jobs containing these keywords">
          <ChipInput
            chips={prefs.keywords_excluded}
            onAdd={(v) => addChip('keywords_excluded', v)}
            onRemove={(v) => removeChip('keywords_excluded', v)}
            placeholder="e.g. Clearance"
          />
        </FormCard>

        {/* Min match score slider */}
        <FormCard
          title="Minimum Match Score"
          description={`Only show jobs scoring at or above this threshold: ${prefs.min_match_score.toFixed(2)}`}
        >
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>0.0</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={prefs.min_match_score}
              onChange={(e) => updateField('min_match_score', Number(e.target.value))}
              className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${prefs.min_match_score * 100}%, var(--bg-secondary) ${prefs.min_match_score * 100}%, var(--bg-secondary) 100%)`,
              }}
            />
            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>1.0</span>
            <span
              className="text-sm font-bold tabular-nums min-w-[3ch] text-right"
              style={{ color: 'var(--accent)' }}
            >
              {prefs.min_match_score.toFixed(2)}
            </span>
          </div>
        </FormCard>

        {/* Max applications per day */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <FormCard title="Max Applications / Day" description="Daily application limit">
            <input
              type="number"
              value={prefs.max_applications_per_day}
              onChange={(e) => updateField('max_applications_per_day', Number(e.target.value))}
              className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none transition-colors"
              style={{
                background: 'var(--bg-secondary)',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
              min={1}
              max={100}
            />
          </FormCard>

          {/* Auto-apply toggle */}
          <FormCard title="Auto-Apply" description="Automatically submit applications">
            <button
              onClick={() => updateField('apply_automatically', !prefs.apply_automatically)}
              className="relative inline-flex items-center h-7 w-12 rounded-full transition-colors duration-200"
              style={{
                background: prefs.apply_automatically ? 'var(--accent)' : 'var(--border)',
              }}
            >
              <span
                className="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                style={{
                  transform: prefs.apply_automatically ? 'translateX(22px)' : 'translateX(4px)',
                }}
              />
            </button>
            <span
              className="ml-3 text-sm"
              style={{ color: prefs.apply_automatically ? 'var(--success)' : 'var(--text-secondary)' }}
            >
              {prefs.apply_automatically ? 'Enabled' : 'Disabled'}
            </span>
          </FormCard>
        </div>
      </div>

      {/* Bottom save */}
      <div
        className="flex justify-end pt-4 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={() => saveMutation.mutate(prefs)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            opacity: saveMutation.isPending ? 0.7 : 1,
          }}
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          {saveMutation.isPending ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  )
}

/* ---------- Sub-components ---------- */

function FormCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        {title}
      </label>
      {description && (
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </p>
      )}
      {children}
    </div>
  )
}

function ChipInput({
  chips,
  onAdd,
  onRemove,
  placeholder,
}: {
  chips: string[]
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      onAdd(input)
      setInput('')
    } else if (e.key === 'Backspace' && input === '' && chips.length > 0) {
      onRemove(chips[chips.length - 1])
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border min-h-[42px] cursor-text"
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
      }}
      onClick={(e) => {
        const inputEl = (e.currentTarget as HTMLElement).querySelector('input')
        inputEl?.focus()
      }}
    >
      {chips.map((chip) => (
        <span
          key={chip}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium"
          style={{
            background: 'rgba(99, 102, 241, 0.15)',
            color: 'var(--accent)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
          }}
        >
          {chip}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove(chip)
            }}
            className="ml-0.5 hover:opacity-70 transition-opacity"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={chips.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
        style={{ color: 'var(--text-primary)' }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExcludedLocationsCard — country quick-toggle + free-text patterns + cleanup
// ---------------------------------------------------------------------------

function ExcludedLocationsCard({
  excluded,
  onAdd,
  onRemove,
  onAddMany,
  onRemoveMany,
}: {
  excluded: string[]
  onAdd: (v: string) => void
  onRemove: (v: string) => void
  onAddMany: (values: string[]) => void
  onRemoveMany: (values: string[]) => void
}) {
  const { data: presets } = useQuery<Record<string, string[]>>({
    queryKey: ['locationPresets'],
    queryFn: fetchLocationPresets,
    staleTime: 60 * 60 * 1000,
  })

  // A country is "active" if its country name (lowercased) is in excluded
  const activeCountries = useMemo(() => {
    const set = new Set(excluded.map((s) => s.toLowerCase()))
    return new Set(Object.keys(presets ?? {}).filter((c) => set.has(c.toLowerCase())))
  }, [presets, excluded])

  const toggleCountry = (country: string, patterns: string[]) => {
    if (activeCountries.has(country)) {
      // Remove the country name AND all of its city/state patterns
      onRemoveMany([country, ...patterns])
    } else {
      // Add the country name first (display anchor) + all patterns
      onAddMany([country, ...patterns])
    }
  }

  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewResult, setPreviewResult] = useState<{ matched_count: number; samples: any[] } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [success, setSuccess] = useState<number | null>(null)

  const runPreview = async () => {
    setPreviewLoading(true)
    setSuccess(null)
    try {
      const result = await dismissByLocation(excluded, true)
      setPreviewResult(result)
      if (result.matched_count > 0) setConfirming(true)
    } finally {
      setPreviewLoading(false)
    }
  }

  const runDismiss = async () => {
    setExecuting(true)
    try {
      const result = await dismissByLocation(excluded, false)
      setSuccess(result.matched_count)
      setPreviewResult(null)
      setConfirming(false)
    } finally {
      setExecuting(false)
    }
  }

  return (
    <FormCard
      title="Excluded Locations"
      description="Hide jobs whose location matches any of these patterns. Use the country buttons to bulk-add cities + states, or type custom patterns. Saved patterns also apply to future scrapes."
    >
      {/* Country quick-toggles */}
      {presets && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
            Quick exclude by country
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(presets).map(([country, patterns]) => {
              const active = activeCountries.has(country)
              return (
                <button
                  key={country}
                  onClick={() => toggleCountry(country, patterns)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all hover:opacity-80"
                  style={
                    active
                      ? {
                          background: 'rgba(239,68,68,0.12)',
                          color: 'var(--danger)',
                          borderColor: 'rgba(239,68,68,0.3)',
                        }
                      : {
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-secondary)',
                          borderColor: 'var(--border)',
                        }
                  }
                >
                  <Globe className="w-3 h-3" />
                  {country}
                  {active && <X className="w-3 h-3" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Custom patterns chip input */}
      <p className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
        Active patterns ({excluded.length})
      </p>
      <ChipInput
        chips={excluded}
        onAdd={onAdd}
        onRemove={onRemove}
        placeholder="e.g. Lagos, Nigeria, Bangalore"
      />

      {/* Cleanup section */}
      {excluded.length > 0 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <MapPin className="w-3.5 h-3.5" />
              <span>Apply to existing jobs in your DB</span>
            </div>
            {!confirming && success == null && (
              <button
                onClick={runPreview}
                disabled={previewLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80 disabled:opacity-50"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                  background: 'var(--bg-secondary)',
                }}
              >
                {previewLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Preview matches
              </button>
            )}
            {confirming && previewResult && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                  <strong>{previewResult.matched_count}</strong> match{previewResult.matched_count !== 1 ? 'es' : ''}
                </span>
                <button
                  onClick={() => { setConfirming(false); setPreviewResult(null) }}
                  disabled={executing}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={runDismiss}
                  disabled={executing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ background: 'var(--danger)', color: '#fff' }}
                >
                  {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Dismiss {previewResult.matched_count}
                </button>
              </div>
            )}
            {success != null && (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--success)' }}
              >
                <Check className="w-3.5 h-3.5" />
                Dismissed {success} job{success !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Sample preview */}
          {confirming && previewResult && previewResult.samples?.length > 0 && (
            <div
              className="mt-3 rounded-lg p-3 max-h-48 overflow-y-auto"
              style={{ background: 'var(--bg-secondary)' }}
            >
              {previewResult.samples.slice(0, 8).map((s: any, i: number) => (
                <div key={i} className="text-xs flex items-center justify-between gap-2 py-1" style={{ color: 'var(--text-secondary)' }}>
                  <span className="truncate" style={{ color: 'var(--text-primary)' }}>
                    {s.company} — {s.title}
                  </span>
                  <span className="opacity-70 whitespace-nowrap">{s.location}</span>
                </div>
              ))}
              {previewResult.matched_count > 8 && (
                <p className="text-xs text-center pt-1" style={{ color: 'var(--text-secondary)' }}>
                  …and {previewResult.matched_count - 8} more
                </p>
              )}
            </div>
          )}

          {previewResult && previewResult.matched_count === 0 && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              No existing jobs match these patterns.
            </p>
          )}
        </div>
      )}
    </FormCard>
  )
}
