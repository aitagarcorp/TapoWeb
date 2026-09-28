import { useEffect, useRef, useCallback, useState } from 'react';
import { getToken } from '../lib/auth';
import { api } from '../lib/api';
import type { Preset } from '../lib/api';

export type CruiseMode = 'h' | 'v' | 'patrol' | 'sweep' | null;

export function usePtzWs(cameraId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [led, setLed] = useState<'on' | 'off'>('off');
  const [cruiseMode, setCruiseMode] = useState<CruiseMode>(null);
  const [patrolInterval, setPatrolInterval] = useState<number>(10);
  const [patrolSpeed, setPatrolSpeed] = useState<number>(0.25);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [lastOk, setLastOk] = useState<boolean | null>(null);

  const refreshPresets = useCallback(async () => {
    if (!cameraId) return;
    try {
      const list = await api.getPresets(cameraId);
      if (Array.isArray(list)) setPresets(list);
    } catch {}
  }, [cameraId]);

  useEffect(() => {
    if (cameraId === null) return;
    let cancelled = false;
    setPresets([]);

    api.ptzStatus(cameraId).then((st) => {
      if (cancelled) return;
      if (st.connected) setConnected(true);
      if (st.led === 'on' || st.led === 'off') setLed(st.led);
      const s = st as { cruise_mode?: CruiseMode; patrol_interval?: number; patrol_speed?: number };
      if ('cruise_mode' in s) setCruiseMode(s.cruise_mode ?? null);
      if (typeof s.patrol_interval === 'number' && s.patrol_interval >= 3) {
        setPatrolInterval(s.patrol_interval);
      }
      if (typeof s.patrol_speed === 'number' && s.patrol_speed > 0) {
        setPatrolSpeed(s.patrol_speed);
      }
    }).catch(() => {});

    api.getPresets(cameraId).then((list) => {
      if (!cancelled && Array.isArray(list)) setPresets(list);
    }).catch(() => {});

    const connect = () => {
      if (cancelled) return;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      setError(null);

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/ws/ptz/${cameraId}?token=${encodeURIComponent(getToken() || '')}`);
      wsRef.current = ws;
      ws.onopen = () => { retryCountRef.current = 0; };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        setLastOk(null);
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000) + Math.random() * 500;
        retryCountRef.current++;
        retryRef.current = setTimeout(connect, delay);
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.error) {
            setError(data.error);
            setConnected(false);
            return;
          }
          if (data.connected) {
            setConnected(true);
            setError(null);
          }
          if (data.led === 'on' || data.led === 'off') setLed(data.led);
          if ('cruise_mode' in data) setCruiseMode(data.cruise_mode ?? null);
          if (typeof data.patrol_interval === 'number' && data.patrol_interval >= 3) {
            setPatrolInterval(data.patrol_interval);
          }
          if (typeof data.patrol_speed === 'number' && data.patrol_speed > 0) {
            setPatrolSpeed(data.patrol_speed);
          }
          if (Array.isArray(data.presets)) setPresets(data.presets);
          if (typeof data.ok === 'boolean') setLastOk(data.ok);
        } catch {}
      };
      ws.onerror = () => { setConnected(false); };
    };

    connect();
    return () => {
      cancelled = true;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      setConnected(false);
      setLastOk(null);
      setError(null);
    };
  }, [cameraId]);

  const send = useCallback((cmd: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
      return true;
    }
    return false;
  }, []);

  const sendOrRest = useCallback(async (cmd: Record<string, unknown>) => {
    if (!cameraId) return;
    try {
      const res = await api.ptzCommand(cameraId, cmd) as {
        success?: boolean;
        cruise_mode?: CruiseMode;
        patrol_interval?: number;
        patrol_speed?: number;
        led?: 'on' | 'off';
        presets?: Preset[];
      };
      setConnected(true);
      setError(null);
      if (res && 'cruise_mode' in res) setCruiseMode(res.cruise_mode ?? null);
      if (res && typeof res.patrol_interval === 'number' && res.patrol_interval >= 3) {
        setPatrolInterval(res.patrol_interval);
      }
      if (res && typeof res.patrol_speed === 'number' && res.patrol_speed > 0) {
        setPatrolSpeed(res.patrol_speed);
      }
      if (res && (res.led === 'on' || res.led === 'off')) setLed(res.led);
      if (res && Array.isArray(res.presets)) setPresets(res.presets);
    } catch {
      send(cmd);
    }
  }, [cameraId, send]);

  const move = useCallback((pan: number, tilt: number) => {
    if (!send({ action: 'move', pan, tilt }) && cameraId) {
      api.ptzCommand(cameraId, { action: 'move', pan, tilt }).catch(() => {});
    }
  }, [send, cameraId]);

  const stop = useCallback(() => {
    if (!send({ action: 'stop' }) && cameraId) {
      api.ptzCommand(cameraId, { action: 'stop' }).catch(() => {});
    }
  }, [send, cameraId]);

  const home = useCallback(() => { sendOrRest({ action: 'home' }); }, [sendOrRest]);
  const gotoPreset = useCallback((token: string) => {
    setCruiseMode(null);
    sendOrRest({ action: 'goto_preset', preset_token: token, token });
  }, [sendOrRest]);

  const setPreset = useCallback(async (name: string) => {
    await sendOrRest({ action: 'set_preset', preset_name: name, name });
  }, [sendOrRest]);

  const removePreset = useCallback(async (token: string) => {
    await sendOrRest({ action: 'remove_preset', preset_token: token, token });
  }, [sendOrRest]);

  const cruiseH = useCallback((speed?: number) => {
    setCruiseMode('h');
    sendOrRest({ action: 'cruise_h', speed: speed ?? 0.5 });
  }, [sendOrRest]);

  const cruiseV = useCallback((speed?: number) => {
    setCruiseMode('v');
    sendOrRest({ action: 'cruise_v', speed: speed ?? 0.5 });
  }, [sendOrRest]);

  const stopCruise = useCallback(() => {
    setCruiseMode(null);
    sendOrRest({ action: 'stop_cruise' });
  }, [sendOrRest]);

  const patrol = useCallback((tokens: string[], interval?: number, speed?: number) => {
    const sec = Math.max(3, interval ?? patrolInterval);
    const spd = Math.max(0.1, Math.min(0.8, speed ?? patrolSpeed));
    setPatrolInterval(sec);
    setPatrolSpeed(spd);
    setCruiseMode('patrol');
    sendOrRest({ action: 'patrol', preset_token: tokens.join(','), tokens, interval: sec, speed: spd });
  }, [sendOrRest, patrolInterval, patrolSpeed]);

  const stopPatrol = useCallback(() => {
    setCruiseMode(null);
    sendOrRest({ action: 'stop_patrol' });
  }, [sendOrRest]);

  const patrolSweep = useCallback((speed?: number) => {
    setCruiseMode('sweep');
    sendOrRest({ action: 'patrol_sweep', speed: speed ?? 0.5 });
  }, [sendOrRest]);

  const stopSweep = useCallback(() => {
    setCruiseMode(null);
    sendOrRest({ action: 'stop_sweep' });
  }, [sendOrRest]);

  const ledOn = useCallback(() => {
    setLed('on');
    sendOrRest({ action: 'led_on' });
  }, [sendOrRest]);

  const ledOff = useCallback(() => {
    setLed('off');
    sendOrRest({ action: 'led_off' });
  }, [sendOrRest]);

  return {
    connected, error, led, cruiseMode,
    patrolInterval, setPatrolInterval,
    patrolSpeed, setPatrolSpeed,
    presets, refreshPresets, lastOk,
    move, stop, home, gotoPreset, setPreset, removePreset,
    cruiseH, cruiseV, stopCruise, patrol, stopPatrol, patrolSweep, stopSweep, ledOn, ledOff,
  };
}
