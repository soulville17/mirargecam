'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Hook LivePortrait — anime l'avatar avec les expressions du webcam
 * source_image = avatar portrait
 * target_image = webcam frame (pilote l'animation)
 */

export function useRunPodRealtime() {
  const [isConnected, setIsConnected]   = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [latestFrame, setLatestFrame]   = useState<string | null>(null)
  const [fps, setFps]                   = useState(0)
  const [processingMs, setProcessingMs] = useState(0)

  const localVideoRef   = useRef<HTMLVideoElement>(null)
  const remoteVideoRef  = useRef<HTMLVideoElement>(null)
  const remoteCanvasRef = useRef<HTMLCanvasElement>(null)

  const streamRef           = useRef<MediaStream | null>(null)
  const avatarBase64Ref     = useRef<string | null>(null)
  const processingRef       = useRef(false)
  const isProcessingRef     = useRef(false)
  const animFrameRef        = useRef<number | null>(null)
  const captureCanvasRef    = useRef<HTMLCanvasElement | null>(null)
  const fpsCounterRef       = useRef({ frames: 0, lastTime: Date.now() })

  // ── Charge l'avatar en base64 ──────────────────────────────────────────
  const fetchAvatarBase64 = useCallback(async (url: string): Promise<string> => {
    const res = await fetch(url)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }, [])

  // ── Boucle principale ──────────────────────────────────────────────────
  const processLoop = useCallback(async () => {
    if (!processingRef.current) return

    // Attendre que le job précédent soit terminé
    if (isProcessingRef.current) {
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }

    const video         = localVideoRef.current
    const captureCanvas = captureCanvasRef.current
    const avatarBase64  = avatarBase64Ref.current

    if (!video || !captureCanvas || !avatarBase64) {
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }

    const ctx = captureCanvas.getContext('2d')
    if (!ctx) { animFrameRef.current = requestAnimationFrame(processLoop); return }

    isProcessingRef.current = true

    // Capturer la frame webcam
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)

    // Vérifier que la frame n'est pas noire
    const check = ctx.getImageData(0, 0, 20, 20)
    if (!check.data.some(v => v > 15)) {
      isProcessingRef.current = false
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }

    // Réduire la résolution pour plus de vitesse (640x360 suffit pour LivePortrait)
    const frameBase64 = captureCanvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    const avatarB64   = avatarBase64Ref.current || ''

    try {
      // 1. Soumettre le job
      const res = await fetch('/api/faceswap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_image: avatarB64,    // avatar = portrait à animer
          target_image: frameBase64,  // webcam = pilote l'animation
          mode: 'async',
        }),
      })

      if (!res.ok) {
        if (res.status === 402) {
          setError('Points insuffisants')
          processingRef.current = false
          setIsConnected(false)
          return
        }
        console.error('[LivePortrait] Erreur POST:', res.status)
      } else {
        const data = await res.json()

        // Réponse directe (sync)
        if (data.output_image) {
          setLatestFrame(data.output_image)
          updateFps()
          if (data.processing_time) setProcessingMs(data.processing_time)
        }
        // Réponse async → polling court
        else if (data.job_id) {
          const jobId = data.job_id
          let attempts = 0
          const maxAttempts = 60  // 120s max

          while (attempts < maxAttempts && processingRef.current) {
            await new Promise(r => setTimeout(r, 1000))  // poll toutes les 1s
            attempts++

            const pollRes = await fetch(`/api/faceswap?job_id=${jobId}`)
            if (!pollRes.ok) break

            const pollData = await pollRes.json()
            console.log('[LivePortrait] Status:', pollData.status, `(${attempts}s)`)

            if (pollData.status === 'COMPLETED') {
              const out = pollData.output
              if (out?.output_image) {
                setLatestFrame(out.output_image)
                updateFps()
                if (out.processing_time) setProcessingMs(out.processing_time)
              }
              break
            } else if (pollData.status === 'FAILED') {
              console.error('[LivePortrait] Job échoué:', pollData.error || pollData)
              break
            }
          }
        } else {
          console.error('[LivePortrait] Réponse inattendue:', JSON.stringify(data).slice(0, 200))
        }
      }
    } catch (err) {
      console.error('[LivePortrait] Exception:', err)
    }

    isProcessingRef.current = false

    if (processingRef.current) {
      animFrameRef.current = requestAnimationFrame(processLoop)
    }
  }, [])

  const updateFps = useCallback(() => {
    const counter = fpsCounterRef.current
    counter.frames++
    const now = Date.now()
    const elapsed = now - counter.lastTime
    if (elapsed >= 2000) {
      setFps(Math.round(counter.frames / (elapsed / 1000)))
      counter.frames = 0
      counter.lastTime = now
    }
  }, [])

  // ── Connect ────────────────────────────────────────────────────────────
  const connect = useCallback(async (avatarImageUrl: string) => {
    try {
      setIsConnecting(true)
      setError(null)
      setLatestFrame(null)
      setFps(0)

      avatarBase64Ref.current = await fetchAvatarBase64(avatarImageUrl)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360, frameRate: 30 },
        audio: false,
      })
      streamRef.current = stream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        await localVideoRef.current.play()
        await new Promise<void>(resolve => {
          const v = localVideoRef.current!
          if (v.readyState >= 2) { resolve(); return }
          v.addEventListener('canplay', () => resolve(), { once: true })
        })
      }

      captureCanvasRef.current = document.createElement('canvas')
      captureCanvasRef.current.width  = 640
      captureCanvasRef.current.height = 360

      await new Promise(r => setTimeout(r, 300))

      processingRef.current   = true
      isProcessingRef.current = false
      setIsConnected(true)
      setIsConnecting(false)

      animFrameRef.current = requestAnimationFrame(processLoop)

    } catch (err: any) {
      console.error('[LivePortrait] connect error:', err)
      setError(err.message || 'Erreur de connexion')
      setIsConnecting(false)
    }
  }, [fetchAvatarBase64, processLoop])

  // ── Disconnect ─────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    processingRef.current   = false
    isProcessingRef.current = false
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
    if (streamRef.current)    { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    avatarBase64Ref.current = null
    setIsConnected(false)
    setIsConnecting(false)
    setLatestFrame(null)
    setError(null)
    setFps(0)
    setProcessingMs(0)
  }, [])

  const updateAvatar = useCallback(async (avatarImageUrl: string) => {
    avatarBase64Ref.current = await fetchAvatarBase64(avatarImageUrl)
  }, [fetchAvatarBase64])

  useEffect(() => { return () => { disconnect() } }, [disconnect])

  return {
    isConnected,
    isConnecting,
    error,
    latestFrame,
    fps,
    processingMs,
    localVideoRef,
    remoteVideoRef,
    remoteCanvasRef,
    connect,
    disconnect,
    updateAvatar,
  }
}
