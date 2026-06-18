'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

const LOCAL_SERVER_URL = 'ws://localhost:7860/ws'
const LOCAL_HEALTH_URL = 'http://localhost:7860/health'

export type LocalServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'no_server'

export function useLocalServer() {
  const [status, setStatus] = useState<LocalServerStatus>('disconnected')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteCanvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const avatarLoadedRef = useRef(false)

  useEffect(() => () => disconnect(), [])

  const checkServerAvailable = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(LOCAL_HEALTH_URL, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  }, [])

  const disconnect = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    avatarLoadedRef.current = false
    setStatus('disconnected')
    setIsProcessing(false)
    setError(null)
  }, [])

  const sendFrame = useCallback(() => {
    const video = localVideoRef.current
    const canvas = remoteCanvasRef.current
    const ws = wsRef.current

    if (!video || !canvas || !ws || ws.readyState !== WebSocket.OPEN || !avatarLoadedRef.current) {
      animFrameRef.current = requestAnimationFrame(sendFrame)
      return
    }

    const offscreen = document.createElement('canvas')
    offscreen.width = video.videoWidth || 640
    offscreen.height = video.videoHeight || 480
    const ctx = offscreen.getContext('2d')!
    ctx.drawImage(video, 0, 0)

    offscreen.toBlob(blob => {
      if (!blob) return
      blob.arrayBuffer().then(buf => {
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
        ws.send(JSON.stringify({ type: 'frame', data: b64 }))
      })
    }, 'image/jpeg', 0.8)

    animFrameRef.current = requestAnimationFrame(sendFrame)
  }, [])

  const connect = useCallback(async (avatarImageUrl: string) => {
    disconnect()
    setStatus('connecting')
    setError(null)

    const available = await checkServerAvailable()
    if (!available) {
      setStatus('no_server')
      setError('Serveur local non detecte. Lance start.bat sur ton PC.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, frameRate: 30 }
      })
    } catch (e: any) {
      setStatus('error')
      setError('Camera inaccessible: ' + e.message)
      return
    }

    streamRef.current = stream
    if (localVideoRef.current) localVideoRef.current.srcObject = stream

    const ws = new WebSocket(LOCAL_SERVER_URL)
    wsRef.current = ws

    ws.onopen = async () => {
      setStatus('connected')
      setIsProcessing(true)

      const avatarRes = await fetch(avatarImageUrl)
      const avatarBlob = await avatarRes.blob()
      const buf = await avatarBlob.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
      ws.send(JSON.stringify({ type: 'avatar', data: b64 }))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      if (msg.type === 'avatar_ok') {
        avatarLoadedRef.current = true
        animFrameRef.current = requestAnimationFrame(sendFrame)
      } else if (msg.type === 'frame') {
        const canvas = remoteCanvasRef.current
        if (!canvas) return
        const img = new Image()
        img.onload = () => {
          const ctx = canvas.getContext('2d')!
          canvas.width = img.width
          canvas.height = img.height
          ctx.drawImage(img, 0, 0)
        }
        img.src = 'data:image/jpeg;base64,' + msg.data
      } else if (msg.type === 'error') {
        setError(msg.message)
      }
    }

    ws.onerror = () => {
      setStatus('error')
      setError('Erreur de connexion au serveur local.')
    }

    ws.onclose = () => {
      if (status !== 'disconnected') setStatus('disconnected')
      setIsProcessing(false)
    }
  }, [disconnect, checkServerAvailable, sendFrame])

  return {
    status,
    isProcessing,
    error,
    localVideoRef,
    remoteCanvasRef,
    connect,
    disconnect,
    checkServerAvailable,
  }
}
