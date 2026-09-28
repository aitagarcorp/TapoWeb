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

  const nextBufferRef = useRef<ArrayBuffer | null>(null);
  const decodingRef = useRef(false);

  const processNext = useCallback(() => {
    if (nextBufferRef.current && !decodingRef.current) {
      const data = nextBufferRef.current;
      nextBufferRef.current = null;
      decodingRef.current = true;

      createImageBitmap(new Blob([data], { type: 'image/jpeg' }))
        .then((bitmap) => {
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) ctx.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
          decodingRef.current = false;
          processNext();
        })
        .catch(() => {
          decodingRef.current = false;
          processNext();
        });
    }
  }, []);

  const cleanup = useCallback(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    nextBufferRef.current = null;
    decodingRef.current = false;
    retryCountRef.current = 0;
    playingRef.current = false;
    setPlaying(false);
    setReconnecting(false);
  }, []);

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
        }

        nextBufferRef.current = e.data;
        processNext();
      };

      ws.onerror = () => { setError(true); };

      ws.onclose = () => {
        setPlaying(false);
        setReconnecting(true);
        playingRef.current = false;
        nextBufferRef.current = null;
        decodingRef.current = false;
        if (urlRef.current === wsUrl) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000) + Math.random() * 1000;
          retryCountRef.current++;
          retryRef.current = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return cleanup;
  }, [wsUrl, cleanup, processNext]);

  return { canvasRef, playing, reconnecting, error };
}
