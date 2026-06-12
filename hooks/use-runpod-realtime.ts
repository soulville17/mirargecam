'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

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

  const processLoop = useCallback(async () => {
    if (!processingRef.current) return

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

    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)

    const check = ctx.getImageData(0, 0, 20, 20)
    if (!check.data.some(v => v > 15)) {
      isProcessingRef.current = false
      animFrameRef.current = requestAnimationFrame(processLoop)
      return
    }

    const frameBase64 = captureCanvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    const avatarB64   = avatarBase64Ref.current || ''

    try {
      const res = await fetch('/api/faceswap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_image: `data:image/jpeg;base64,${avatarB64}`,
          target_image: `data:image/jpeg;base64,${frameBase64}`,
        }),
      })

      if (!res.ok) {
        if (res.status === 402) {
          setError('Points insuffisants')
          processingRef.current = false
          setIsConnected(false)
          return
        }
        console.error('[FaceSwap] Erreur POST:', res.status)
      } else {
        const data = await res.json()
        if (data.output_image) {
          setLatestFrame(data.output_image)
          updateFps()
          if (data.processing_time) setProcessingMs(data.processing_time)
        } else if (data.error) {
          console.error('[FaceSwap] Erreur:', data.error)
        }
      }
    } catch (err) {
      console.error('[FaceSwap] Exception:', err)
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
      console.error('[FaceSwap] connect error:', err)
      setError(err.message || 'Erreur de connexion')
      setIsConnecting(false)
    }
  }, [fetchAvatarBase64, processLoop])

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