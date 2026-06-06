import { afterEach, describe, expect, it, vi } from 'vitest'
import { playCleanupSystemSound } from './cleanup-system-sound'

describe('playCleanupSystemSound', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips sound feedback when volume is muted', async () => {
    const playSystemSound = vi.fn()
    vi.stubGlobal('window', { cleanMyAgent: { playSystemSound } })

    await playCleanupSystemSound(0)

    expect(playSystemSound).not.toHaveBeenCalled()
  })

  it('falls back to host system sound when Web Audio is unavailable', async () => {
    const playSystemSound = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { cleanMyAgent: { playSystemSound } })

    await playCleanupSystemSound(0.5)

    expect(playSystemSound).toHaveBeenCalledOnce()
  })

  it('uses Web Audio when available and clamps volume', async () => {
    const playSystemSound = vi.fn()
    const close = vi.fn()
    const oscillator = {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      addEventListener: vi.fn((_event: string, callback: () => void) => callback()),
    }
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }
    const context = {
      state: 'suspended',
      currentTime: 10,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
      close,
    }
    const AudioContextClass = vi.fn(function AudioContext() {
      return context
    })
    vi.stubGlobal('window', {
      AudioContext: AudioContextClass,
      cleanMyAgent: { playSystemSound },
    })

    await playCleanupSystemSound(2)

    expect(AudioContextClass).toHaveBeenCalledOnce()
    expect(context.resume).toHaveBeenCalledOnce()
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.34, 10.012)
    expect(oscillator.start).toHaveBeenCalledOnce()
    expect(oscillator.stop).toHaveBeenCalledWith(10.2)
    expect(close).toHaveBeenCalledOnce()
    expect(playSystemSound).not.toHaveBeenCalled()
  })

  it('falls back to host sound when Web Audio setup fails', async () => {
    const playSystemSound = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function AudioContext() {
        throw new Error('audio blocked')
      }),
      cleanMyAgent: { playSystemSound },
    })

    await playCleanupSystemSound(0.5)

    expect(playSystemSound).toHaveBeenCalledOnce()
  })

  it('ignores host system sound failures', async () => {
    vi.stubGlobal('window', {
      cleanMyAgent: {
        playSystemSound: vi.fn().mockRejectedValue(new Error('host sound failed')),
      },
    })

    await expect(playCleanupSystemSound()).resolves.toBeUndefined()
  })
})
