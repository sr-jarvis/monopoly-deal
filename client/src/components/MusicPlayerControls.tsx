import React, { useState, useEffect } from 'react'
import { musicEngine, type TrackStyle, type MusicEngineState } from '../utils/musicEngine'

interface MusicPlayerControlsProps {
  compact?: boolean
  className?: string
}

export const MusicPlayerControls: React.FC<MusicPlayerControlsProps> = ({
  compact = false,
  className = '',
}) => {
  const [state, setState] = useState<MusicEngineState>(() => musicEngine.getState())
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    // Sync UI with audio engine state
    const syncState = () => {
      setState(musicEngine.getState())
    }

    syncState()
    const interval = setInterval(syncState, 500)
    return () => clearInterval(interval)
  }, [])

  const handleToggle = async () => {
    await musicEngine.toggle()
    setState(musicEngine.getState())
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value)
    musicEngine.setVolume(vol)
    setState(musicEngine.getState())
  }

  const handleStyleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStyle = e.target.value as TrackStyle
    musicEngine.setStyle(newStyle)
    setState(musicEngine.getState())
  }

  return (
    <div
      role="toolbar"
      aria-label="Background Music Controls"
      className={`relative inline-flex items-center gap-2 rounded-xl border border-white/20 bg-slate-900/80 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-md transition-all ${className}`}
    >
      {/* Play / Pause Toggle Button */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label={state.isPlaying ? 'Mute Background Music' : 'Play Background Music'}
        aria-pressed={state.isPlaying}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold transition-all ${
          state.isPlaying
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
            : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700/80 hover:text-white'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${state.isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
        <span>{state.isPlaying ? '🎵 Music On' : '🔇 Music Off'}</span>
      </button>

      {/* Expand / Collapse Settings Toggle in Compact Mode */}
      {compact ? (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-label="Toggle Audio Settings"
          className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          ⚙️
        </button>
      ) : null}

      {/* Track Selector & Volume Controls */}
      {(!compact || isExpanded) && (
        <div className="flex items-center gap-3 border-l border-slate-700/80 pl-3">
          {/* Track Style Dropdown */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Style:</span>
            <select
              value={state.style}
              onChange={handleStyleChange}
              aria-label="Select Track Style"
              className="rounded-md border border-slate-700 bg-slate-800/90 px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
            >
              <option value="chill">Smooth Chill</option>
              <option value="jazz">Casino Jazz</option>
              <option value="ambient">Cyber Ambient</option>
            </select>
          </div>

          {/* Volume Slider */}
          <div className="flex items-center gap-1.5 min-w-[100px]">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Vol:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={state.volume}
              onChange={handleVolumeChange}
              aria-label="Music Volume"
              className="h-1.5 w-16 accent-emerald-400 bg-slate-700 rounded-lg cursor-pointer"
            />
            <span className="w-7 text-[10px] font-mono text-slate-300">
              {Math.round(state.volume * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
