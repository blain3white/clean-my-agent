async function playFallbackTone(volume = 0.35): Promise<boolean> {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return false

  try {
    const clampedVolume = Math.min(1, Math.max(0, volume))
    const context = new AudioContextClass()
    if (context.state === 'suspended') await context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = 660
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, clampedVolume * 0.34),
      context.currentTime + 0.012,
    )
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.2)
    oscillator.addEventListener('ended', () => void context.close(), { once: true })
    return true
  } catch {
    return false
  }
}

export async function playCleanupSystemSound(volume = 0.35) {
  if (volume <= 0) return
  if (await playFallbackTone(volume)) return

  try {
    if (window.cleanMyAgent) {
      await window.cleanMyAgent.playSystemSound()
    }
  } catch {
    // Ignore host sound failures; this is a non-critical feedback cue.
  }
}
