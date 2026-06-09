'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// Hook RunPod realtime — affichage via <canvas> (compatible tous navigateurs)
// Traitement frame par frame via /api/faceswap (RunPod InsightFace)

const FRAME_INTERVAL = 500 // 1 frame toutes les 500ms (RunPod ~1-3s par frame)

export function useRunPodRealtime() {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  // remoteCanvasRef: on dessine directement sur le canvas DOM (pas de captureStream)
  const remoteCanvasRef = useRef<HTMLCanvasElement>(null)
  // remoteVideoRef gardé pour compatibilité avec page.tsx (non utilisé pour affichage RunPod)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const avatarBase64Ref = useRef<string | null>(null)
  const processingRef = useRef(false)
  const lastFrameTimeRef = useRef(0)
  const animFrameRef = useRef<number | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)

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

  // Dessine l'image base64 sur le canvas DOM visible
  const drawToCanvas = useCallback((imageB64: string) => {
    const canvas = remoteCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = new Image()
    img.onload = () => {
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      ctx.drawImage(img, 0, 0)
      // Supprime le badge "AI Generated"
      const w = canvas.width, h = canvas.height
      if (w > 0 && h > 0) {
        ctx.save()
        ctx.filter = 'blur(14px)'
        ctx.drawImage(canvas, w*0.32, Math.max(0, h*0.31), w*0.36, h*0.13, w*0.32, h*0.37, w*0.36, h*0.13)
        ctx.restore()
      }
    }
    img.onerror = (e) => console.error('[RunPod] drawToCanvas error:', e)
    img.src = `data:image/jpeg;base64,${imageB64}`
  }, [])

  // Boucle principale : capture frame → soumet → poll → affiche
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
    if (!ctx) { animFrameRef.current = requestAnimationFrame(processLoop); return }

    // Capture frame caméra
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height)
    const frameBase64 = captureCanvas.toDataURL('image/jpeg', 0.8).split(',')[1]

    try {
      // 1. Soumettre le job (retour immédiat — pas de timeout Vercel)
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
          setError('Points insuffisants — recharge ton compte')
          processingRef.current = false
          setIsConnected(false)
          return
        }
        const e = await submitRes.json().catch(() => ({}))
        console.error('[RunPod] Soumission échouée:', submitRes.status, e)
        if (processingRef.current) animFrameRef.current = requestAnimationFrame(processLoop)
        return
      }

      const submitData = await submitRes.json()
      const job_id = submitData.job_id
      if (!job_id) {
        console.error('[RunPod] Pas de job_id:', submitData)
        if (processingRef.current) animFrameRef.current = requestAnimationFrame(processLoop)
        return
      }

      // 2. Poll le résultat (max 55s)
      const deadline = Date.now() + 55000
      let output_image: string | null = null
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500))
        if (!processingRef.current) return

        const pollRes = await fetch(`/api/faceswap?job_id=${job_id}`)
        if (!pollRes.ok) { console.warn('[RunPod] Poll erreur:', pollRes.status); continue }
        const poll = await pollRes.json()
        console.log('[RunPod] Status:', poll.status)

        if (poll.status === 'COMPLETED') {
          // Chercher output_image à différents endroits selon le format RunPod
          output_image = poll.output?.output_image ?? poll.output_image ?? null
          if (output_image) break
          console.warn('[RunPod] COMPLETED mais pas d\'image:', JSON.stringify(poll).slice(0, 300))
          break
        }
        if (poll.status === 'FAILED') {
          console.error('[RunPod] Job échoué:', poll.error)
          break
        }
      }

      // 3. Afficher
      if (output_image) {
        drawToCanvas(output_image)
      } else {
        console.warn('[RunPod] Pas d\'image résultat')
      }

    } catch (err) {
      console.error('[RunPod Realtime] Exception:', err)
    }

    if (processingRef.current) {
      animFrameRef.current = requestAnimationFrame(processLoop)
    }
  }, [drawToCanvas])

  const connect = useCallback(async (avatarImageUrl: string) => {
    try {
      setIsConnecting(true)
      setError(null)

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

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null

    avatarBase64Ref.current = null
    setIsConnected(false)
    setIsConnecting(false)
    setError(null)
  }, [])

  const updateAvatar = useCallback(async (avatarImageUrl: string) => {
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
    remoteVideoRef,      // gardé pour compatibilité (non utilisé pour RunPod)
    remoteCanvasRef,     // utiliser ce ref sur un <canvas> dans la page
    connect,
    disconnect,
    updateAvatar,
  }
}
