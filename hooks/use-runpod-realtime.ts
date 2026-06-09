'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// Hook RunPod realtime — interface compatible avec useLucy21
// Traitement frame par frame via /api/faceswap (RunPod InsightFace)
// Coût : ~$0.0003/sec vs $0.02/sec pour Decart = 70x moins cher

const TARGET_FPS = 10 // 10 fps = bon compromis qualité/coût RunPod
const FRAME_INTERVAL = 1000 / TARGET_FPS

export function useRunPodRealtime() {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const avatarUrlRef = useRef<string | null>(null)
  const avatarBase64Ref = useRef<string | null>(null)
  const processingRef = useRef(false)
  const lastFrameTimeRef = useRef(0)
  const animFrameRef = useRef<number | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Convertit une URL d'image en base64
  const fetchAvatarBase64 = useCallback(async (url: string): Promise<string> => {
    const res = await fetch(url)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }, [])

  // Boucle de traitement frame par frame
  const processLoop = useCallback(async () => {
    if (!processingRef.current) return

    const now = performance.now()
    if (now - lastFrameTimeRef.current < FRAME_INTERVAL) {
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }
    lastFrameTimeRef.current = now

    const video = localVideoRef.current
    const captureCanvas = captureCanvasRef.current
    const avatarBase64 = avatarBase64Ref.current

    if (!video || !captureCanvas || !avatarBase64) {
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }

    const ctx = captureCanvas.getContext('2d')
    if (!ctx) return

    // Capture la frame courante
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)
    const frameBase64 = captureCanvas.toDataURL('image/jpeg', 0.75).split(',')[1]

    try {
      const res = await fetch('/api/faceswap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_image: avatarBase64,
          target_image: frameBase64,
          mode: 'sync',
          enhance_face: false,  // désactivé pour éviter artefacts (bague, etc.)
          face_restore: false,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.output_image && outputCanvasRef.current) {
          const img = new Image()
          img.onload = () => {
            const out = outputCanvasRef.current
            if (!out) return
            const octx = out.getContext('2d')
            if (!octx) return
            out.width = img.width
            out.height = img.height
            octx.drawImage(img, 0, 0)
            // Supprime le badge "AI Generated" gravé par le serveur GPU
            const w = out.width, h = out.height
            octx.save()
            octx.filter = 'blur(14px)'
            octx.drawImage(out, w*0.32, Math.max(0, h*0.31), w*0.36, h*0.13, w*0.32, h*0.37, w*0.36, h*0.13)
            octx.restore()
            // Afficher le canvas dans la video remote via captureStream
            if (remoteVideoRef.current && !remoteVideoRef.current.srcObject) {
              const stream = (out as any).captureStream?.(TARGET_FPS)
              if (stream) remoteVideoRef.current.srcObject = stream
            }
          }
          img.src = `data:image/jpeg;base64,${data.output_image}`
        }
      } else if (res.status === 402) {
        setError('Points insuffisants — recharge ton compte')
        processingRef.current = false
        setIsConnected(false)
        return
      }
    } catch (err) {
      console.error('[RunPod Realtime]', err)
    }

    if (processingRef.current) {
      animFrameRef.current = requestAnimationFrame(processLoop)
    }
  }, [])

  const connect = useCallback(async (avatarImageUrl: string) => {
    try {
      setIsConnecting(true)
      setError(null)
      avatarUrlRef.current = avatarImageUrl

      // Charger l'avatar en base64
      avatarBase64Ref.current = await fetchAvatarBase64(avatarImageUrl)

      // Démarrer la caméra
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, frameRate: 30 },
        audio: false,
      })
      streamRef.current = stream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        await localVideoRef.current.play()
      }

      // Canvas de capture
      captureCanvasRef.current = document.createElement('canvas')
      captureCanvasRef.current.width = 640
      captureCanvasRef.current.height = 480

      // Canvas de sortie
      outputCanvasRef.current = document.createElement('canvas')

      processingRef.current = true
      setIsConnected(true)
      setIsConnecting(false)

      // Lancer la boucle
      animFrameRef.current = requestAnimationFrame(processLoop)

    } catch (err: any) {
      console.error('[RunPod Realtime] connect error:', err)
      setError(err.message || 'Erreur de connexion')
      setIsConnecting(false)
    }
  }, [fetchAvatarBase64, processLoop])

  const disconnect = useCallback(() => {
    processingRef.current = false

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null

    avatarBase64Ref.current = null
    setIsConnected(false)
    setIsConnecting(false)
    setError(null)
  }, [])

  const updateAvatar = useCallback(async (avatarImageUrl: string) => {
    avatarUrlRef.current = avatarImageUrl
    avatarBase64Ref.current = await fetchAvatarBase64(avatarImageUrl)
  }, [fetchAvatarBase64])

  useEffect(() => {
    return () => { disconnect() }
  }, [disconnect])

  return {
    isConnected,
    isConnecting,
    error,
    localVideoRef,
    remoteVideoRef,
    connect,
    disconnect,
    updateAvatar,
  }
}
