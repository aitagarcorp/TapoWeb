import { useEffect, useRef, useState, useCallback } from 'react';

const TARGET_FPS = 15;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
// Pacing buffer: hold up to this many decoded frames before drawing.
// Absorbs WireGuard TCP-retransmission bursts without increasing perceived latency
// beyond ~280 ms (4 × 67 ms) relative to the live edge.
const PACE_SLOTS = 4;

export function useMjpegWs(wsUrl: string | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  const playingRef = useRef(false);

  // Pacing ring-buffer: decoded ImageBitmaps waiting to be drawn.
  const pacingRef = useRef<ImageBitmap[]>([]);
  const pacingTimerRef = useRef<number | null>(null);
  const lastDrawRef = useRef<number>(0);

  const stopPacing = useCallback(() => {
    if (pacingTimerRef.current !== null) {
      clearInterval(pacingTimerRef.current);
      pacingTimerRef.current = null;
    }
    for (const bm of pacingRef.current) bm.close();
    pacingRef.current = [];
  }, []);

  const startPacing = useCallback((canvas: HTMLCanvasElement) => {
    if (pacingTimerRef.current !== null) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    pacingTimerRef.current = window.setInterval(() => {
      const buf = pacingRef.current;
      if (buf.length === 0) return;
      const now = performance.now();
      if (now - lastDrawRef.current < FRAME_INTERVAL_MS - 2) return;
      const bitmap = buf.shift()!;
      if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
      if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      lastDrawRef.current = now;
    }, Math.max(4, FRAME_INTERVAL_MS - 2));
  }, []);

  const cleanup = useCallback(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    stopPacing();
    retryCountRef.current = 0;
    playingRef.current = false;
    setPlaying(false);
    setReconnecting(false);
  }, [stopPacing]);

  useEffect(() => {
    if (!wsUrl) return;
    urlRef.current = wsUrl;

    const connect = () => {
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      setError(false);
      setReconnecting(true);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => { setError(false); retryCountRef.current = 0; };

      ws.onmessage = async (e) => {
        if (!(e.data instanceof ArrayBuffer) || e.data.byteLength === 0) return;

        if (!playingRef.current) {
          setPlaying(true);
          setReconnecting(false);
          playingRef.current = true;
          const canvas = canvasRef.current;
          if (canvas) startPacing(canvas);
        }

        try {
          const bitmap = await createImageBitmap(
            new Blob([e.data], { type: 'image/jpeg' }),
          );
          const buf = pacingRef.current;
          buf.push(bitmap);
          // Drop oldest frames when burst exceeds the pacing window.
          while (buf.length > PACE_SLOTS) {
            buf.shift()!.close();
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      ws.onerror = () => { setError(true); };

      ws.onclose = () => {
        setPlaying(false);
        setReconnecting(true);
        playingRef.current = false;
        stopPacing();
        if (urlRef.current === wsUrl) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000) + Math.random() * 1000;
          retryCountRef.current++;
          retryRef.current = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return cleanup;
  }, [wsUrl, cleanup, startPacing, stopPacing]);

  return { canvasRef, playing, reconnecting, error };
}
