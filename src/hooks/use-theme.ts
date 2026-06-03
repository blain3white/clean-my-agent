import { useEffect, useMemo, useState } from 'react'
import type { ThemePreference } from '@/shared/types'

const storageKey = 'clean-my-agent.theme'

function getStoredTheme(): ThemePreference {
  const value = window.localStorage.getItem(storageKey)
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return 'system'
}

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(getStoredTheme)
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme)

  useEffect(() => {
    window.localStorage.setItem(storageKey, preference)
  }, [preference])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(getSystemTheme())
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme = preference === 'system' ? systemTheme : preference

  return useMemo(
    () => ({
      preference,
      resolvedTheme,
      setPreference,
    }),
    [preference, resolvedTheme],
  )
}
