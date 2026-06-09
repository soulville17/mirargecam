'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// Hook RunPod realtime — affichage via état React (compatible tous navigateurs)

export function useRunPodRealtime() {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // latestFrame: dernière image reçue de RunPod (base64 jpeg)
  const [latestFrame, setLatestFrame] = useState<string | null>(null)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  // gardés pour compatibilité avec page.tsx
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteCanvasRef = useRef<HTMLCanvasElement>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const avatarBase64Ref = useRef<string | null>(null)
  const processingRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastSentRef = useRef(0)

  const FRAME_INTERVAL = 3000 // 1 frame toutes les 3s (RunPod ~2-5s par frame)

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

  const processLoop = useCallback(async () => {
    if (!processingRef.current) return

    const now = Date.now()
    if (now - lastSentRef.current < FRAME_INTERVAL) {
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }
    lastSentRef.current = now

    const video = localVideoRef.current
    const captureCanvas = captureCanvasRef.current
    const avatarBase64 = avatarBase64Ref.current

    if (!video || !captureCanvas || !avatarBase64) {
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }

    const ctx = captureCanvas.getContext('2d')
    if (!ctx) { animFrameRef.current = requestAnimationFrame(processLoop); return }

    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)
    const frameBase64 = captureCanvas.toDataURL('image/jpeg', 0.8).split(',')[1]

    try {
      // 1. Soumettre le job (retour immédiat)
      const submitRes = await fetch('/api/faceswap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_image: avatarBase64,
          target_image: frameBase64,
          mode: 'async',
          enhance_face: false,
          face_restore: false,
        }),
      })

      if (!submitRes.ok) {
        if (submitRes.status === 402) {
          setError('Points insuffisants')
          processingRef.current = false
          setIsConnected(false)
          return
        }
        console.error('[RunPod] Soumission échouée:', submitRes.status)
        if (processingRef.current) animFrameRef.current = requestAnimationFrame(processLoop)
        return
      }

      const submitData = await submitRes.json()
      const job_id = submitData.job_id
      console.log('[RunPod] Job soumis:', job_id)

      if (!job_id) {
        console.error('[RunPod] Pas de job_id:', JSON.stringify(submitData))
        if (processingRef.current) animFrameRef.current = requestAnimationFrame(processLoop)
        return
      }

      // 2. Poll le résultat
      const deadline = Date.now() + 55000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000))
        if (!processingRef.current) return

        const pollRes = await fetch(`/api/faceswap?job_id=${job_id}`)
        const poll = await pollRes.json()
        console.log('[RunPod] Poll:', poll.status, JSON.stringify(poll).slice(0, 150))

        if (poll.status === 'COMPLETED') {
          // Chercher output_image à différents endroits
          const img =
            poll.output?.output_image ??
            poll.output_image ??
            (typeof poll.output === 'string' ? poll.output : null)

          if (img) {
            console.log('[RunPod] Image reçue, taille:', img.length)
            setLatestFrame(img)
          } else {
            console.error('[RunPod] COMPLETED sans image. Réponse complète:', JSON.stringify(poll))
          }
          break
        }
        if (poll.status === 'FAILED') {
          console.error('[RunPod] Job échoué:', poll.error)
          break
        }
      }
    } catch (err) {
      console.error('[RunPod] Exception:', err)
    }

    if (processingRef.current) {
      animFrameRef.current = requestAnimationFrame(processLoop)
    }
  }, [])

  const connect = useCallback(async (avatarImageUrl: string) => {
    try {
      setIsConnecting(true)
      setError(null)
      setLatestFrame(null)

      avatarBase64Ref.current = await fetchAvatarBase64(avatarImageUrl)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, frameRate: 30 },
        audio: false,
      })
      streamRef.current = stream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        await localVideoRef.current.play()
      }

      captureCanvasRef.current = document.createElement('canvas')
      captureCanvasRef.current.width = 640
      captureCanvasRef.current.height = 480

      processingRef.current = true
      setIsConnected(true)
      setIsConnecting(false)

      animFrameRef.current = requestAnimationFrame(processLoop)

    } catch (err: any) {
      console.error('[RunPod Realtime] connect error:', err)
      setError(err.message || 'Erreur de connexion')
      setIsConnecting(false)
    }
  }, [fetchAvatarBase64, processLoop])

  const disconnect = useCallback(() => {
    processingRef.current = false
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    avatarBase64Ref.current = null
    setIsConnected(false)
    setIsConnecting(false)
    setLatestFrame(null)
    setError(null)
  }, [])

  const updateAvatar = useCallback(async (avatarImageUrl: string) => {
    avatarBase64Ref.current = await fetchAvatarBase64(avatarImageUrl)
  }, [fetchAvatarBase64])

  useEffect(() => { return () => { disconnect() } }, [disconnect])

  return {
    isConnected,
    isConnecting,
    error,
    latestFrame,       // <-- base64 jpeg de la dernière frame traitée
    localVideoRef,
    remoteVideoRef,
    remoteCanvasRef,
    connect,
    disconnect,
    updateAvatar,
  }
}
