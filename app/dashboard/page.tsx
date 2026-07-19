'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Camera, Zap, Clock, Coins, Plus, Check, AlertCircle, Loader2, Square, Wifi, WifiOff, Monitor, Cloud, Settings, Sparkles, Maximize2, Minimize2, Eye, EyeOff } from 'lucide-react'
import { useLucy21 } from '@/hooks/use-lucy-21'
import { useLocalServer } from '@/hooks/use-local-server'
import { SwapConsent, GenerateNotice } from '@/components/dashboard/swap-consent'
import { detectHardwareCapabilities, determineProcessingMode, loadProcessingPreferences, saveProcessingPreferences, type HardwareCapabilities, type UserProcessingPreferences } from '@/lib/hardware-detection'

const SUPABASE_URL = 'https://ojmzqokffbptmcktnwdy.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbXpxb2tmZmJwdG1ja3Rud2R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTAzNTYsImV4cCI6MjA5NDg4NjM1Nn0.e9sk4b_15ge2LIIQwFpXC3n_q48ctu9IJ6oJxV85kgw'

const POINTS_PER_SECOND = 2

type EngineMode = 'avatar_complet' | 'echange_visage'

const AVATAR_ENGINE_KEY = 'mirargecam_avatar_engines'

function getAvatarEngine(avatarId: string): EngineMode {
  try {
    const stored = JSON.parse(localStorage.getItem(AVATAR_ENGINE_KEY) || '{}')
    return stored[avatarId] || 'avatar_complet'
  } catch { return 'avatar_complet' }
}

function setAvatarEngine(avatarId: string, mode: EngineMode) {
  try {
    const stored = JSON.parse(localStorage.getItem(AVATAR_ENGINE_KEY) || '{}')
    stored[avatarId] = mode
    localStorage.setItem(AVATAR_ENGINE_KEY, JSON.stringify(stored))
  } catch {}
}

interface Avatar {
  id: string
  name: string
  url: string
  is_active: boolean
}

export default function DashboardPage() {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null)
  const [userPoints, setUserPoints] = useState(0)
  const [maxPoints, setMaxPoints] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [pointsUsed, setPointsUsed] = useState(0)
  const [isSyncingPoints, setIsSyncingPoints] = useState(false)

  // Nouveau: Detection hardware et mode de traitement
  const [hardware, setHardware] = useState<HardwareCapabilities | null>(null)
  const [preferences, setPreferences] = useState<UserProcessingPreferences>(loadProcessingPreferences())
  const [processingMode, setProcessingMode] = useState<'local' | 'cloud'>('cloud')
  const [networkQuality, setNetworkQuality] = useState<'good' | 'medium' | 'poor'>('good')
  const [showModeSettings, setShowModeSettings] = useState(false)
  const [stats, setStats] = useState({ fps: 0, latency: 0, resolution: '720p' })

  const [localServerAvailable, setLocalServerAvailable] = useState<boolean | null>(null)
  const [engineMode, setEngineMode] = useState<EngineMode>('avatar_complet')

  // Preference "Logo MirageCam" (watermark). true = sans logo.
  // Persistee en localStorage, appliquee a la prochaine connexion du swap.
  const [noWatermark, setNoWatermark] = useState(false)
  // Certification d'usage responsable, requise avant le demarrage du swap.
  const [swapConsent, setSwapConsent] = useState(false)

  // Charger les preferences uniquement apres montage (evite tout mismatch
  // d'hydratation avec le rendu serveur).
  useEffect(() => {
    try {
      setNoWatermark(localStorage.getItem('mirargecam_no_watermark') === '1')
      setSwapConsent(localStorage.getItem('mirargecam_swap_consent') === '1')
    } catch {}
  }, [])

  const toggleNoWatermark = useCallback(() => {
    setNoWatermark(prev => {
      const next = !prev
      try { localStorage.setItem('mirargecam_no_watermark', next ? '1' : '0') } catch {}
      return next
    })
  }, [])

  const handleConsentChange = useCallback((value: boolean) => {
    setSwapConsent(value)
    try { localStorage.setItem('mirargecam_swap_consent', value ? '1' : '0') } catch {}
  }, [])

  // Plein ecran natif sur la sortie MirageCam (pour capture OBS)
  const mirageCamRef = useRef<HTMLDivElement | null>(null)
  const [isCamFullscreen, setIsCamFullscreen] = useState(false)

  const toggleCamFullscreen = useCallback(() => {
    const el = mirageCamRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setIsCamFullscreen(document.fullscreenElement === mirageCamRef.current)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const lucy = useLucy21() as any
  const local = useLocalServer()

  // Choisir le bon hook selon le mode
  const isLocal = processingMode === 'local' && localServerAvailable === true
  const isConnected = isLocal ? local.isProcessing : lucy.isConnected
  const isConnecting = isLocal ? local.status === 'connecting' : lucy.isConnecting
  const error = isLocal ? local.error : lucy.error
  const localVideoRef = isLocal ? local.localVideoRef : lucy.localVideoRef
  const remoteVideoRef = lucy.remoteVideoRef
  const remoteCanvasRef = isLocal ? local.remoteCanvasRef : lucy.remoteCanvasRef

  const filteredAvatars = avatars.filter(a => getAvatarEngine(a.id) === engineMode)

  const connect = async (avatarUrl: string) => {
    const localEngine = engineMode === 'echange_visage' ? 'insightface' : 'liveportrait'
    if (isLocal) {
      await local.connect(avatarUrl, localEngine)
    } else {
      await lucy.connect(avatarUrl, { noWatermark })
    }
  }
  const disconnect = () => {
    local.disconnect()
    lucy.disconnect()
  }
  const updateAvatar = lucy.updateAvatar

  const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  // Detecter si le serveur local est disponible
  useEffect(() => {
    local.checkServerAvailable().then(available => {
      setLocalServerAvailable(available)
    })
  }, [])

  // Detecter le hardware au montage
  useEffect(() => {
    async function detectHardware() {
      const caps = await detectHardwareCapabilities()
      setHardware(caps)
      
      // Si PC gamer detecte, forcer le mode local obligatoirement
      if (caps.isGamingPC) {
        setProcessingMode('local')
        const forcedPrefs = { ...preferences, mode: 'local' as const }
        setPreferences(forcedPrefs)
        saveProcessingPreferences(forcedPrefs)
        setStats(prev => ({ ...prev, resolution: caps.gpuTier === 'high' ? '1080p' : '720p', fps: caps.gpuTier === 'high' ? 30 : 25 }))
      } else {
        // PC classique: determiner le mode optimal (cloud par defaut)
        const mode = determineProcessingMode(caps, preferences, networkQuality)
        setProcessingMode(mode.mode)
        setStats(prev => ({ ...prev, resolution: mode.resolution, fps: mode.fps }))
      }
    }
    detectHardware()
  }, [networkQuality])

  // Surveiller la qualite reseau
  useEffect(() => {
    if ('connection' in navigator) {
      const connection = (navigator as Navigator & { connection?: { effectiveType: string; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } }).connection
      if (connection) {
        const updateNetworkQuality = () => {
          const type = connection.effectiveType
          if (type === '4g') setNetworkQuality('good')
          else if (type === '3g') setNetworkQuality('medium')
          else setNetworkQuality('poor')
        }
        updateNetworkQuality()
        connection.addEventListener?.('change', updateNetworkQuality)
        return () => connection.removeEventListener?.('change', updateNetworkQuality)
      }
    }
  }, [])

  // Load user data
  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      setUserId(user.id)

      // MODE TEST — points illimités, API désactivée
      setUserPoints(999999)
      setMaxPoints(999999)

      const { data: avatarsData } = await supabase
        .from('user_avatars')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (avatarsData && avatarsData.length > 0) {
        setAvatars(avatarsData)
        const activeAvatar = avatarsData.find(a => a.is_active)
        if (activeAvatar) setSelectedAvatar(activeAvatar)
      }
    }

    loadData()
  }, [])

  // Track points usage en temps reel (localement)
  useEffect(() => {
    if (!isConnected) return
    const interval = setInterval(() => {
      setDuration(prev => prev + 1)
      setPointsUsed(prev => prev + POINTS_PER_SECOND)
      setUserPoints(prev => {
        const newPoints = Math.max(0, prev - POINTS_PER_SECOND)
        if (newPoints === 0) {
          // Plus de points - arreter le swap et sauvegarder
          handleStopSwapAndSave()
        }
        return newPoints
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [isConnected])

  // Fonction pour arreter le swap et sauvegarder les points
  const handleStopSwapAndSave = async () => {
    disconnect()
    
    // Sauvegarder les points utilises dans Supabase
    if (pointsUsed > 0 && !isSyncingPoints) {
      setIsSyncingPoints(true)
      try {
        const res = await fetch('/api/points', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            pointsToDeduct: pointsUsed,
            sessionDuration: duration 
          })
        })
        const data = await res.json()
        if (data.success) {
          setUserPoints(data.currentPoints)
          setMaxPoints(data.maxPoints)
        }
      } catch (err) {
        console.error('Erreur sauvegarde points:', err)
      } finally {
        setIsSyncingPoints(false)
      }
    }
    
    // Reset les compteurs
    setPointsUsed(0)
    setDuration(0)
  }

  // === TRACKING UTILISATEURS ACTIFS ===
  useEffect(() => {
    const trackActivity = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase
        .from('user_activity')
        .upsert({
          user_id: user.id,
          last_active: new Date().toISOString(),
          current_page: window.location.pathname,
        }, { 
          onConflict: 'user_id' 
        })
    }

    trackActivity()
    const interval = setInterval(trackActivity, 30000)

    return () => clearInterval(interval)
  }, [])

  const handleStartSwap = async () => {
    if (!selectedAvatar || userPoints < POINTS_PER_SECOND || !swapConsent) return
    // ÉCHANGE DE VISAGE nécessite le serveur local (InsightFace)
    if (engineMode === 'echange_visage' && !localServerAvailable) {
      alert('ÉCHANGE DE VISAGE nécessite le serveur local.\nLance start.bat sur ton PC puis reconnecte-toi.')
      return
    }
    setDuration(0)
    setPointsUsed(0)
    await connect(selectedAvatar.url)
  }

  const handleStopSwap = () => handleStopSwapAndSave()

  const handleSelectAvatar = async (avatar: Avatar) => {
    setSelectedAvatar(avatar)

    if (userId) {
      await supabase.from('user_avatars').update({ is_active: false }).eq('user_id', userId)
      await supabase.from('user_avatars').update({ is_active: true }).eq('id', avatar.id)
      setAvatars(prev => prev.map(a => ({ ...a, is_active: a.id === avatar.id })))
    }

    if (isConnected) {
      try {
        await updateAvatar(avatar.url)
      } catch (err) {
        console.error(err)
      }
    }
  }

  const handleModeChange = useCallback((mode: 'auto' | 'local' | 'cloud') => {
    // Si PC gamer, ignorer tout changement et rester en local
    if (hardware?.isGamingPC) {
      return
    }
    
    const newPrefs = { ...preferences, mode }
    setPreferences(newPrefs)
    saveProcessingPreferences(newPrefs)
    
    if (hardware) {
      const result = determineProcessingMode(hardware, newPrefs, networkQuality)
      setProcessingMode(result.mode)
    }
    setShowModeSettings(false)
  }, [hardware, networkQuality, preferences])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Zap className="w-6 h-6 text-[#00ff88]" />
            LIVE SWAP
          </h1>
          <p className="text-emerald-400 text-sm font-medium">
            Change d&apos;apparence en live avec MirageCam
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Mode Indicator */}
          <div className={`px-3 py-2 rounded-lg flex items-center gap-2 ${
            processingMode === 'local' 
              ? 'bg-green-500/10 border border-green-500/30' 
              : 'bg-blue-500/10 border border-blue-500/30'
          }`}>
            {processingMode === 'local' ? (
              <Monitor className="w-4 h-4 text-green-400" />
            ) : (
              <Cloud className="w-4 h-4 text-blue-400" />
            )}
            <span className={`text-xs font-medium ${
              processingMode === 'local' ? 'text-green-400' : 'text-blue-400'
            }`}>
              {processingMode === 'local' ? 'LOCAL' : 'CLOUD'}
            </span>
          </div>

          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-2 flex items-center gap-2">
            <Coins className="w-4 h-4 text-yellow-500" />
            <span className="text-white font-bold">{userPoints.toLocaleString()}</span>
            <span className="text-gray-400 text-sm">points</span>
          </div>
        </div>
      </div>

      {/* Engine Mode Selector */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => { setEngineMode('avatar_complet'); if (isConnected) handleStopSwap() }}
          className={`relative p-4 rounded-xl border-2 text-left transition-all ${
            engineMode === 'avatar_complet'
              ? 'border-[#00ff88] bg-[#00ff88]/10'
              : 'border-[#333] bg-[#111] hover:border-[#555]'
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`p-2 rounded-lg ${engineMode === 'avatar_complet' ? 'bg-[#00ff88]/20' : 'bg-white/5'}`}>
              <Sparkles className={`w-5 h-5 ${engineMode === 'avatar_complet' ? 'text-[#00ff88]' : 'text-white/40'}`} />
            </div>
            <div>
              <p className={`font-bold text-sm ${engineMode === 'avatar_complet' ? 'text-[#00ff88]' : 'text-white'}`}>
                AVATAR COMPLET
              </p>
              <p className="text-xs text-white/40">Corps + visage animé</p>
            </div>
            {engineMode === 'avatar_complet' && (
              <div className="ml-auto w-5 h-5 rounded-full bg-[#00ff88] flex items-center justify-center">
                <Check className="w-3 h-3 text-black" />
              </div>
            )}
          </div>
          <p className="text-xs text-white/50">
            {isLocal ? 'LivePortrait (GPU local)' : 'Decart AI (cloud)'}
          </p>
        </button>

        <button
          onClick={() => { setEngineMode('echange_visage'); if (isConnected) handleStopSwap() }}
          className={`relative p-4 rounded-xl border-2 text-left transition-all ${
            engineMode === 'echange_visage'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-[#333] bg-[#111] hover:border-[#555]'
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className={`p-2 rounded-lg ${engineMode === 'echange_visage' ? 'bg-blue-500/20' : 'bg-white/5'}`}>
              <Camera className={`w-5 h-5 ${engineMode === 'echange_visage' ? 'text-blue-400' : 'text-white/40'}`} />
            </div>
            <div>
              <p className={`font-bold text-sm ${engineMode === 'echange_visage' ? 'text-blue-400' : 'text-white'}`}>
                ÉCHANGE DE VISAGE
              </p>
              <p className="text-xs text-white/40">Visage seul remplacé</p>
            </div>
            {engineMode === 'echange_visage' && (
              <div className="ml-auto w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </div>
            )}
          </div>
          {localServerAvailable ? (
            <p className="text-xs text-white/50">InsightFace (GPU local)</p>
          ) : (
            <p className="text-xs text-orange-400/70">⚠ Nécessite le serveur local</p>
          )}
        </button>
      </div>

      {/* Hardware Detection Banner */}
      {hardware?.isGamingPC && (
        <div className="bg-gradient-to-r from-green-500/10 to-transparent border border-green-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <Monitor className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-400">PC Gaming detecte - Traitement local disponible</p>
              <p className="text-xs text-white/60">{hardware.gpuName} | {hardware.vramEstimate}GB VRAM | Mode {processingMode}</p>
            </div>
          </div>
          <div className="relative">
            <button 
              onClick={() => setShowModeSettings(!showModeSettings)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            >
              <Settings className="w-5 h-5 text-white/60" />
            </button>
            
            {showModeSettings && (
              <div className="absolute top-full right-0 mt-2 w-64 p-4 rounded-xl bg-[#111] border border-[#333] z-50">
                <h4 className="text-sm font-medium text-white mb-3">Mode de traitement</h4>
                
                {/* PC Gamer: Afficher uniquement le mode local force */}
                {hardware?.isGamingPC ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-green-500/20 border border-green-500/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Monitor className="w-4 h-4 text-green-400" />
                        <p className="text-sm font-medium text-green-400">Mode Local Active</p>
                      </div>
                      <p className="text-xs text-white/60">
                        PC Gaming detecte. Le traitement s&apos;effectue directement sur votre GPU pour des performances optimales.
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/5">
                      <p className="text-xs text-white/70 font-medium">{hardware.gpuName}</p>
                      <p className="text-xs text-white/40">{hardware.vramEstimate}GB VRAM</p>
                    </div>
                  </div>
                ) : (
                  /* PC classique: Afficher Auto et Cloud uniquement */
                  <div className="space-y-2">
                    {[
                      { id: 'auto', label: 'Automatique', desc: 'Choisit le meilleur mode' },
                      { id: 'cloud', label: 'Cloud', desc: 'Serveurs haute performance' }
                    ].map(option => (
                      <button
                        key={option.id}
                        onClick={() => handleModeChange(option.id as 'auto' | 'local' | 'cloud')}
                        className={`w-full p-3 rounded-lg text-left transition-all ${
                          preferences.mode === option.id 
                            ? 'bg-[#00ff88]/20 border border-[#00ff88]/50' 
                            : 'bg-white/5 border border-transparent hover:bg-white/10'
                        }`}
                      >
                        <p className="text-sm font-medium text-white">{option.label}</p>
                        <p className="text-xs text-white/50">{option.desc}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {localServerAvailable === true && (
        <div className="bg-gradient-to-r from-purple-500/10 to-transparent border border-purple-500/30 rounded-xl p-3 flex items-center gap-3">
          <Monitor className="w-4 h-4 text-purple-400" />
          <p className="text-sm text-purple-300">Serveur local détecté — traitement sur ton PC, zéro filigrane</p>
          {!isLocal && (
            <button
              onClick={() => { setProcessingMode('local'); setLocalServerAvailable(true) }}
              className="ml-auto text-xs bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-300 px-3 py-1 rounded-lg transition-colors"
            >
              Utiliser le mode local
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      {/* Main layout : contenu + panneau de reglages */}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">

      {/* Video Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-[#111] border border-[#222] rounded-xl overflow-hidden">
          <div className="bg-[#0a0a0a] px-4 py-2 flex items-center gap-2 border-b border-[#222]">
            <Camera className="w-4 h-4 text-blue-500" />
            <span className="text-white font-medium">CAMERA REELLE</span>
            {isConnected && <span className="ml-auto text-blue-500 text-xs">● LIVE</span>}
          </div>
          <div className="aspect-video bg-[#0a0a0a] relative">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            {!isConnected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                <Camera className="w-12 h-12 mb-2 opacity-50" />
                <p>Camera inactive</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-[#111] border border-[#00ff88]/30 rounded-xl overflow-hidden">
          <div className="bg-[#0a0a0a] px-4 py-2 flex items-center gap-2 border-b border-[#00ff88]/30">
            <Zap className="w-4 h-4 text-[#00ff88]" />
            <span className="text-white font-medium">CAMERA MIRAGECAM</span>
            <div className="ml-auto flex items-center gap-2 text-xs">
              {isConnected && (
                <>
                  <span className="text-[#00ff88]">{stats.fps} FPS</span>
                  <span className="text-white/40">|</span>
                  <span className="text-white/60">{stats.resolution}</span>
                </>
              )}
              <button
                onClick={toggleCamFullscreen}
                aria-label={isCamFullscreen ? 'Réduire la caméra' : 'Agrandir la caméra'}
                title={isCamFullscreen ? 'Réduire' : 'Agrandir en plein écran (capture OBS)'}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88] transition-colors hover:bg-[#00ff88]/20"
              >
                {isCamFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div ref={mirageCamRef} className="relative aspect-video bg-[#0a0a0a]">
            {isLocal ? (
              <canvas ref={local.remoteCanvasRef} className="w-full h-full object-cover" />
            ) : (
              <video
                ref={remoteVideoRef}
                data-mirargecam-output="true"
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
            )}

            <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-md text-white text-xs px-3 py-1 rounded-md flex items-center gap-1.5 z-20">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              MirageCam • {isLocal ? 'Local' : 'Cloud'}
            </div>

            {!isConnected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-[#0a0a0a]">
                <Zap className="w-12 h-12 mb-2 opacity-50" />
                <p>{isConnecting ? 'Connexion en cours...' : 'Swap inactif'}</p>
              </div>
            )}
            
            {isConnecting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="w-8 h-8 text-[#00ff88] animate-spin" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-[#111] border border-[#222] rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            {isConnected ? <Wifi className="w-4 h-4 text-[#00ff88]" /> : <WifiOff className="w-4 h-4 text-gray-500" />}
            <span className={`text-sm ${isConnected ? 'text-[#00ff88]' : 'text-gray-400'}`}>
              {isConnected ? 'En direct' : 'Deconnecte'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-white">{formatDuration(duration)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-yellow-500" />
            <span className="text-white">{pointsUsed} pts utilises</span>
          </div>
          {/* Network Quality */}
          <div className={`flex items-center gap-2 px-2 py-1 rounded ${
            networkQuality === 'good' ? 'bg-green-500/10' :
            networkQuality === 'medium' ? 'bg-yellow-500/10' : 'bg-red-500/10'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              networkQuality === 'good' ? 'bg-green-500' :
              networkQuality === 'medium' ? 'bg-yellow-500' : 'bg-red-500'
            }`} />
            <span className={`text-xs ${
              networkQuality === 'good' ? 'text-green-400' :
              networkQuality === 'medium' ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {networkQuality === 'good' ? 'Connexion stable' :
               networkQuality === 'medium' ? 'Connexion moyenne' : 'Connexion faible'}
            </span>
          </div>
        </div>
        <div className="text-gray-400 text-sm">
          Avatar : <span className="text-white">{selectedAvatar?.name || 'Aucun'}</span>
        </div>
      </div>

      {/* Certification d'usage responsable (avant demarrage) */}
      {!isConnected && (
        <SwapConsent checked={swapConsent} onChange={handleConsentChange} />
      )}

      {/* Bouton Swap */}
      <button
        onClick={isConnected ? handleStopSwap : handleStartSwap}
        disabled={(!selectedAvatar || !swapConsent) && !isConnected}
        className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
          isConnected
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : isConnecting
            ? 'bg-yellow-500 text-black cursor-wait'
            : selectedAvatar && userPoints >= POINTS_PER_SECOND && swapConsent
            ? 'bg-[#00ff88] hover:bg-[#00dd77] text-black shadow-[0_0_40px_rgba(0,255,136,0.25)]'
            : 'bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
      >
        {isConnecting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            CONNEXION EN COURS...
          </>
        ) : isConnected ? (
          <>
            <Square className="w-5 h-5" />
            ARRETER LE SWAP
          </>
        ) : (
          <>
            <Zap className="w-5 h-5" />
            DEMARRER LE SWAP {processingMode === 'local' ? '(LOCAL)' : '(CLOUD)'}
          </>
        )}
      </button>

      {!isConnected && <GenerateNotice />}

      {/* Mes Avatars — filtrés par moteur */}
      <div className="bg-[#111] border border-[#222] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold">
            MES AVATARS — {engineMode === 'avatar_complet' ? 'COMPLET' : 'VISAGE'}
          </h2>
          <a href="/dashboard/avatars" className="flex items-center gap-1 text-[#00ff88] hover:underline text-sm">
            <Plus className="w-4 h-4" />
            Ajouter
          </a>
        </div>

        {filteredAvatars.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 mb-2">
              Aucun avatar {engineMode === 'avatar_complet' ? '"Avatar Complet"' : '"Échange de Visage"'} trouvé
            </p>
            <p className="text-gray-500 text-sm mb-4">
              {engineMode === 'avatar_complet'
                ? 'Ajoutez un avatar corps entier (personnage en pied)'
                : 'Ajoutez une photo de visage à échanger'}
            </p>
            <a href="/dashboard/avatars" className="inline-flex items-center gap-2 bg-[#00ff88] text-black px-4 py-2 rounded-lg font-medium">
              Ajouter un avatar
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {filteredAvatars.map((avatar) => (
              <button
                key={avatar.id}
                onClick={() => handleSelectAvatar(avatar)}
                className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                  selectedAvatar?.id === avatar.id ?
                    (engineMode === 'avatar_complet' ? 'border-[#00ff88] shadow-[0_0_20px_rgba(0,255,136,0.3)]' : 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)]')
                    : 'border-[#333] hover:border-[#555]'
                }`}
              >
                <img src={avatar.url} alt={avatar.name} className="w-full h-full object-cover" />
                {selectedAvatar?.id === avatar.id && (
                  <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center ${engineMode === 'avatar_complet' ? 'bg-[#00ff88]' : 'bg-blue-500'}`}>
                    <Check className="w-4 h-4 text-black" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="text-white text-xs font-medium truncate">{avatar.name}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      </div>

      {/* Panneau de reglages du studio */}
      <aside className="h-fit space-y-6 rounded-2xl border border-[#222] bg-[#111]/70 p-5 backdrop-blur-xl lg:sticky lg:top-6">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-[#00ff88]" />
          <h2 className="text-base font-bold text-white">Réglages du studio</h2>
        </div>

        {/* Toggle Logo MirageCam (watermark) */}
        <div className="rounded-xl border border-[#00ff88]/25 bg-[#00ff88]/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00ff88]/15">
                {noWatermark
                  ? <EyeOff className="h-5 w-5 text-[#00ff88]" />
                  : <Eye className="h-5 w-5 text-[#00ff88]" />}
              </span>
              <div>
                <p className="text-sm font-semibold text-white">Logo MirageCam</p>
                <p className="text-[11px] text-white/50">
                  {noWatermark ? 'OFF — vidéo sans logo' : 'ON — logo affiché sur la vidéo'}
                </p>
              </div>
            </div>
            <button
              onClick={toggleNoWatermark}
              role="switch"
              aria-checked={!noWatermark}
              aria-label="Logo MirageCam"
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                !noWatermark ? 'bg-[#00ff88]' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${
                  !noWatermark ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
          {isConnected && (
            <p className="mt-3 rounded-lg bg-black/40 px-3 py-2 text-[11px] text-yellow-400/90">
              Prend effet au prochain démarrage du swap.
            </p>
          )}
        </div>

        {/* Mode de traitement */}
        <div>
          <p className="mb-2 text-xs font-medium text-white/60">Mode de traitement</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleModeChange('cloud')}
              disabled={hardware?.isGamingPC}
              className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                processingMode === 'cloud'
                  ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                  : 'border-[#333] bg-black/30 text-white/50 hover:border-[#555]'
              }`}
            >
              <Cloud className="h-4 w-4" />
              Cloud
            </button>
            <button
              onClick={() => { setProcessingMode('local') }}
              disabled={localServerAvailable !== true}
              className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                processingMode === 'local'
                  ? 'border-green-500/50 bg-green-500/10 text-green-400'
                  : 'border-[#333] bg-black/30 text-white/50 hover:border-[#555]'
              }`}
            >
              <Monitor className="h-4 w-4" />
              Local
            </button>
          </div>
          {hardware?.isGamingPC && (
            <p className="mt-2 text-[10px] text-green-400/70">
              PC Gaming détecté — mode local forcé pour des performances optimales.
            </p>
          )}
        </div>

        {/* Sortie video */}
        <div>
          <p className="mb-2 text-xs font-medium text-white/60">Sortie vidéo</p>
          <button
            onClick={toggleCamFullscreen}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#333] bg-black/30 py-2 text-xs font-medium text-white/70 transition-colors hover:border-[#00ff88]/40 hover:text-[#00ff88]"
          >
            {isCamFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {isCamFullscreen ? 'Quitter le plein écran' : 'Plein écran (capture OBS)'}
          </button>
        </div>

        {/* Session info */}
        <div className="space-y-2 rounded-xl border border-[#222] bg-black/30 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-white/50">Durée session</span>
            <span className="font-medium text-white">{formatDuration(duration)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/50">Points utilisés</span>
            <span className="font-medium text-white">{pointsUsed} pts</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/50">Moteur</span>
            <span className="font-medium text-white">
              {engineMode === 'avatar_complet' ? 'Avatar complet' : 'Échange de visage'}
            </span>
          </div>
        </div>
      </aside>
      </div>
    </div>
  )
}
