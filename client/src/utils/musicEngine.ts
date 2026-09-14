/**
 * Monopoly Deal - WebAudio Ambient Music Synthesizer Engine
 * Zero-dependency procedural background music synthesis for Lo-Fi Chill, Casino Jazz, and Cyber Ambient.
 */

export type TrackStyle = 'chill' | 'jazz' | 'ambient'

export interface MusicEngineState {
  isPlaying: boolean
  volume: number // 0.0 to 1.0
  style: TrackStyle
}

const STORAGE_KEYS = {
  ENABLED: 'monopoly_deal_music_enabled',
  VOLUME: 'monopoly_deal_music_volume',
  STYLE: 'monopoly_deal_music_style',
} as const

// Chord Frequencies (Hz) for procedural progressions
const CHORD_PROGRESSIONS: Record<TrackStyle, number[][]> = {
  // Lo-Fi Chill: Cmaj7 -> Am7 -> Fmaj7 -> G7
  chill: [
    [261.63, 329.63, 392.00, 493.88], // Cmaj7
    [220.00, 261.63, 329.63, 392.00], // Am7
    [174.61, 220.00, 261.63, 329.63], // Fmaj7
    [196.00, 246.94, 293.66, 349.23], // G7
  ],
  // Casino Jazz: Dm9 -> G13 -> Cmaj9 -> A7alt
  jazz: [
    [293.66, 349.23, 440.00, 523.25], // Dm9
    [196.00, 246.94, 349.23, 440.00], // G13
    [261.63, 329.63, 392.00, 493.88], // Cmaj9
    [220.00, 277.18, 329.63, 392.00], // A7
  ],
  // Cyber Ambient: Ebmaj9 -> Cm9 -> Fm9 -> Bb7sus4
  ambient: [
    [155.56, 196.00, 233.08, 293.66], // Ebmaj9
    [130.81, 155.56, 196.00, 233.08], // Cm9
    [174.61, 207.65, 261.63, 311.13], // Fm9
    [116.54, 174.61, 233.08, 261.63], // Bb7sus4
  ],
}

// Bass frequencies corresponding to progressions
const BASS_FREQUENCIES: Record<TrackStyle, number[]> = {
  chill: [130.81, 110.00, 87.31, 98.00],   // C3, A2, F2, G2
  jazz: [146.83, 98.00, 130.81, 110.00],   // D3, G2, C3, A2
  ambient: [77.78, 65.41, 87.31, 58.27],   // Eb2, C2, F2, Bb1
}

class WebAudioMusicEngine {
  private audioCtx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private filterNode: BiquadFilterNode | null = null
  private lfoOsc: OscillatorNode | null = null
  private lfoGain: GainNode | null = null

  private activeOscillators: OscillatorNode[] = []
  private activeGains: GainNode[] = []
  private bassOsc: OscillatorNode | null = null
  private bassGain: GainNode | null = null

  private chordTimer: number | null = null
  private rhythmTimer: number | null = null

  private currentChordIndex = 0
  private isPlaying = false
  private volume = 0.3
  private style: TrackStyle = 'chill'

  constructor() {
    this.loadSettings()
  }

  private loadSettings(): void {
    if (typeof window === 'undefined') return

    try {
      const savedEnabled = localStorage.getItem(STORAGE_KEYS.ENABLED)
      if (savedEnabled !== null) {
        this.isPlaying = savedEnabled === 'true'
      }

      const savedVol = localStorage.getItem(STORAGE_KEYS.VOLUME)
      if (savedVol !== null) {
        const parsedVol = parseFloat(savedVol)
        if (!isNaN(parsedVol) && parsedVol >= 0 && parsedVol <= 1) {
          this.volume = parsedVol
        }
      }

      const savedStyle = localStorage.getItem(STORAGE_KEYS.STYLE) as TrackStyle
      if (savedStyle && ['chill', 'jazz', 'ambient'].includes(savedStyle)) {
        this.style = savedStyle
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  private saveSettings(): void {
    if (typeof window === 'undefined') return

    try {
      localStorage.setItem(STORAGE_KEYS.ENABLED, String(this.isPlaying))
      localStorage.setItem(STORAGE_KEYS.VOLUME, String(this.volume))
      localStorage.setItem(STORAGE_KEYS.STYLE, this.style)
    } catch {
      // Ignore localStorage errors
    }
  }

  private initAudioContext(): void {
    if (this.audioCtx) return

    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtxClass) return

    this.audioCtx = new AudioCtxClass()

    // Dynamics compressor for clean master output
    this.compressor = this.audioCtx.createDynamicsCompressor()
    this.compressor.threshold.setValueAtTime(-24, this.audioCtx.currentTime)
    this.compressor.knee.setValueAtTime(30, this.audioCtx.currentTime)
    this.compressor.ratio.setValueAtTime(12, this.audioCtx.currentTime)
    this.compressor.attack.setValueAtTime(0.003, this.audioCtx.currentTime)
    this.compressor.release.setValueAtTime(0.25, this.audioCtx.currentTime)

    // Master volume gain node
    this.masterGain = this.audioCtx.createGain()
    this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime)

    // Filter node for warmth/lo-fi character
    this.filterNode = this.audioCtx.createBiquadFilter()
    this.filterNode.type = 'lowpass'
    this.filterNode.frequency.setValueAtTime(1200, this.audioCtx.currentTime)
    this.filterNode.Q.setValueAtTime(2.0, this.audioCtx.currentTime)

    // Low Frequency Oscillator for subtle filter sweeps
    this.lfoOsc = this.audioCtx.createOscillator()
    this.lfoOsc.type = 'sine'
    this.lfoOsc.frequency.setValueAtTime(0.1, this.audioCtx.currentTime) // 0.1 Hz slow sweep

    this.lfoGain = this.audioCtx.createGain()
    this.lfoGain.gain.setValueAtTime(300, this.audioCtx.currentTime)

    this.lfoOsc.connect(this.lfoGain)
    this.lfoGain.connect(this.filterNode.frequency)
    this.lfoOsc.start()

    // Connect graph: Synth Voice -> Filter -> Master Gain -> Compressor -> Destination
    this.filterNode.connect(this.masterGain)
    this.masterGain.connect(this.compressor)
    this.compressor.connect(this.audioCtx.destination)
  }

  public async start(): Promise<void> {
    if (typeof window === 'undefined') return

    this.initAudioContext()

    if (!this.audioCtx) return

    if (this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume()
      } catch {
        // User gesture required
      }
    }

    this.isPlaying = true
    this.saveSettings()

    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.linearRampToValueAtTime(this.volume, this.audioCtx.currentTime + 0.5)
    }

    this.playNextChord()
    this.startChordScheduler()
    this.startRhythmScheduler()
  }

  public stop(): void {
    if (!this.isPlaying) return

    this.isPlaying = false
    this.saveSettings()

    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.linearRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.5)
    }

    if (this.chordTimer !== null) {
      clearInterval(this.chordTimer)
      this.chordTimer = null
    }

    if (this.rhythmTimer !== null) {
      clearInterval(this.rhythmTimer)
      this.rhythmTimer = null
    }

    setTimeout(() => {
      this.clearActiveNodes()
    }, 600)
  }

  public toggle(): Promise<void> {
    if (this.isPlaying) {
      this.stop()
      return Promise.resolve()
    } else {
      return this.start()
    }
  }

  public setVolume(vol: number): void {
    const clampedVol = Math.max(0, Math.min(1, vol))
    this.volume = clampedVol
    this.saveSettings()

    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setValueAtTime(clampedVol, this.audioCtx.currentTime)
    }
  }

  public setStyle(newStyle: TrackStyle): void {
    if (this.style === newStyle) return
    this.style = newStyle
    this.currentChordIndex = 0
    this.saveSettings()

    if (this.isPlaying) {
      this.playNextChord()
    }
  }

  public getState(): MusicEngineState {
    return {
      isPlaying: this.isPlaying,
      volume: this.volume,
      style: this.style,
    }
  }

  private clearActiveNodes(): void {
    this.activeOscillators.forEach((osc) => {
      try { osc.stop(); osc.disconnect() } catch { /* Ignore */ }
    })
    this.activeGains.forEach((gain) => {
      try { gain.disconnect() } catch { /* Ignore */ }
    })
    this.activeOscillators = []
    this.activeGains = []

    if (this.bassOsc) {
      try { this.bassOsc.stop(); this.bassOsc.disconnect() } catch { /* Ignore */ }
      this.bassOsc = null
    }
    if (this.bassGain) {
      try { this.bassGain.disconnect() } catch { /* Ignore */ }
      this.bassGain = null
    }
  }

  private playNextChord(): void {
    if (!this.audioCtx || !this.filterNode || !this.isPlaying) return

    this.clearActiveNodes()

    const chords = CHORD_PROGRESSIONS[this.style]
    const basses = BASS_FREQUENCIES[this.style]

    const chord = chords[this.currentChordIndex % chords.length]
    const bassFreq = basses[this.currentChordIndex % basses.length]

    const now = this.audioCtx.currentTime
    const fadeTime = 0.8

    // Synthesize Pad Oscillators for Chord Notes
    chord.forEach((freq) => {
      if (!this.audioCtx || !this.filterNode) return

      const osc = this.audioCtx.createOscillator()
      const gain = this.audioCtx.createGain()

      // Waveform character per style
      osc.type = this.style === 'ambient' ? 'sine' : 'triangle'
      osc.frequency.setValueAtTime(freq, now)

      // Slight micro-detune for chorus richness
      const detuneAmount = (Math.random() - 0.5) * 8
      osc.detune.setValueAtTime(detuneAmount, now)

      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.linearRampToValueAtTime(0.05, now + fadeTime)

      osc.connect(gain)
      gain.connect(this.filterNode)
      osc.start(now)

      this.activeOscillators.push(osc)
      this.activeGains.push(gain)
    })

    // Synthesize Sub-Bass Oscillator
    this.bassOsc = this.audioCtx.createOscillator()
    this.bassGain = this.audioCtx.createGain()

    this.bassOsc.type = 'triangle'
    this.bassOsc.frequency.setValueAtTime(bassFreq, now)

    this.bassGain.gain.setValueAtTime(0.0001, now)
    this.bassGain.gain.linearRampToValueAtTime(0.08, now + fadeTime)

    this.bassOsc.connect(this.bassGain)
    this.bassGain.connect(this.filterNode)
    this.bassOsc.start(now)

    this.currentChordIndex++
  }

  private startChordScheduler(): void {
    if (this.chordTimer !== null) clearInterval(this.chordTimer)

    // Advance chord every 4.5 seconds
    this.chordTimer = window.setInterval(() => {
      if (this.isPlaying) {
        this.playNextChord()
      }
    }, 4500)
  }

  private startRhythmScheduler(): void {
    if (this.rhythmTimer !== null) clearInterval(this.rhythmTimer)

    // Soft hi-hat tick every 750ms for lo-fi pulse
    this.rhythmTimer = window.setInterval(() => {
      if (!this.isPlaying || !this.audioCtx || !this.filterNode || this.style === 'ambient') return

      try {
        const now = this.audioCtx.currentTime
        const noiseOsc = this.audioCtx.createOscillator()
        const noiseGain = this.audioCtx.createGain()

        noiseOsc.type = 'sine'
        noiseOsc.frequency.setValueAtTime(8000, now)

        noiseGain.gain.setValueAtTime(0.008, now)
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)

        noiseOsc.connect(noiseGain)
        noiseGain.connect(this.filterNode)

        noiseOsc.start(now)
        noiseOsc.stop(now + 0.06)
      } catch {
        // Ignore audio pulse errors
      }
    }, 750)
  }
}

export const musicEngine = new WebAudioMusicEngine()
