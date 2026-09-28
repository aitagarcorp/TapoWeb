import { useEffect, useRef, useState, useCallback } from 'react';

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

  const pendingBlobRef = useRef<Blob | null>(null);
  const renderingRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const stopRender = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingBlobRef.current = null;
    renderingRef.current = false;
  }, []);

  const startRender = useCallback((canvas: HTMLCanvasElement) => {
    if (rafIdRef.current !== null) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const render = () => {
      const blob = pendingBlobRef.current;
      if (blob && !renderingRef.current) {
        pendingBlobRef.current = null;
        renderingRef.current = true;
        createImageBitmap(blob)
          .then((bitmap) => {
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            renderingRef.current = false;
          })
          .catch(() => {
            renderingRef.current = false;
          });
      }
      rafIdRef.current = requestAnimationFrame(render);
    };

    rafIdRef.current = requestAnimationFrame(render);
  }, []);

  const cleanup = useCallback(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    stopRender();
    retryCountRef.current = 0;
    playingRef.current = false;
    setPlaying(false);
    setReconnecting(false);
  }, [stopRender]);

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

      ws.onmessage = (e) => {
        if (!(e.data instanceof ArrayBuffer) || e.data.byteLength === 0) return;

        if (!playingRef.current) {
          setPlaying(true);
          setReconnecting(false);
          playingRef.current = true;
          const canvas = canvasRef.current;
          if (canvas) startRender(canvas);
        }

        pendingBlobRef.current = new Blob([e.data], { type: 'image/jpeg' });
      };

      ws.onerror = () => { setError(true); };

      ws.onclose = () => {
        setPlaying(false);
        setReconnecting(true);
        playingRef.current = false;
        stopRender();
        if (urlRef.current === wsUrl) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000) + Math.random() * 1000;
          retryCountRef.current++;
          retryRef.current = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return cleanup;
  }, [wsUrl, cleanup, startRender, stopRender]);

  return { canvasRef, playing, reconnecting, error };
}
