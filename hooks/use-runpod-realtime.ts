'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// Hook fal.ai realtime — face swap via fal-ai/face-swap
// ~2-3s par frame, réponse directe (pas de polling)

export function useRunPodRealtime() {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latestFrame, setLatestFrame] = useState<string | null>(null)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteCanvasRef = useRef<HTMLCanvasElement>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const avatarBase64Ref = useRef<string | null>(null)
  const processingRef = useRef(false)
  const isProcessingFrameRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)

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

    // Ne pas lancer un nouveau job si le précédent tourne encore
    if (isProcessingFrameRef.current) {
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }

    const video = localVideoRef.current
    const captureCanvas = captureCanvasRef.current
    const avatarBase64 = avatarBase64Ref.current

    if (!video || !captureCanvas || !avatarBase64) {
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }

    const ctx = captureCanvas.getContext('2d')
    if (!ctx) { animFrameRef.current = requestAnimationFrame(processLoop); return }

    isProcessingFrameRef.current = true

    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)
    const frameBase64 = captureCanvas.toDataURL('image/jpeg', 0.85).split(',')[1]

    try {
      // 1. Soumettre le job
      const res = await fetch('/api/faceswap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_image: frameBase64,   // ton visage (webcam) = source
          target_image: avatarBase64,  // avatar = cible où coller
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
        const e = await res.json().catch(() => ({}))
        console.error('[RunPod] Erreur POST:', res.status, e)
      } else {
        const data = await res.json()

        // 2. Si réponse directe (sync)
        if (data.output_image) {
          setLatestFrame(data.output_image)
        }
        // 3. Si réponse async → polling
        else if (data.job_id) {
          const jobId = data.job_id
          let attempts = 0
          const maxAttempts = 30 // 60s max

          while (attempts < maxAttempts && processingRef.current) {
            await new Promise(r => setTimeout(r, 2000))
            attempts++

            const pollRes = await fetch(`/api/faceswap?job_id=${jobId}`)
            if (!pollRes.ok) break

            const pollData = await pollRes.json()
            console.log('[RunPod] Poll status:', pollData.status)

            if (pollData.status === 'COMPLETED' && pollData.output?.output_image) {
              setLatestFrame(pollData.output.output_image)
              break
            } else if (pollData.status === 'FAILED') {
              console.error('[RunPod] Job échoué:', pollData)
              break
            }
          }
        } else {
          console.error('[RunPod] Réponse inattendue:', JSON.stringify(data).slice(0, 200))
        }
      }
    } catch (err) {
      console.error('[RunPod] Exception:', err)
    }

    isProcessingFrameRef.current = false

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
      isProcessingFrameRef.current = false
      setIsConnected(true)
      setIsConnecting(false)

      animFrameRef.current = requestAnimationFrame(processLoop)

    } catch (err: any) {
      console.error('[fal.ai Realtime] connect error:', err)
      setError(err.message || 'Erreur de connexion')
      setIsConnecting(false)
    }
  }, [fetchAvatarBase64, processLoop])

  const disconnect = useCallback(() => {
    processingRef.current = false
    isProcessingFrameRef.current = false
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
    latestFrame,
    localVideoRef,
    remoteVideoRef,
    remoteCanvasRef,
    connect,
    disconnect,
    updateAvatar,
  }
}
