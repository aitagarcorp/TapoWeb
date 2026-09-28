import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  X, AlertTriangle, RotateCw, MapPin, Plus, Trash2, Play, Square, Clock,
} from 'lucide-react';
import { usePtzWs } from '../hooks/usePtzWs';

interface Props {
  cameraId: string;
  cameraName: string;
  onClose: () => void;
}

type Direction = 'up' | 'down' | 'left' | 'right';

const MIN_STEP_MS = 220;
const QUICK_INTERVALS = [5, 10, 15, 30, 60];
const PATROL_SPEEDS = [
  { label: 'Muy lento', speed: 0.15 },
  { label: 'Lento', speed: 0.25 },
  { label: 'Medio', speed: 0.35 },
  { label: 'Rápido', speed: 0.5 },
];

export function PTZPanel({ cameraId, cameraName, onClose }: Props) {
  const {
    connected, error, cruiseMode,
    patrolInterval, setPatrolInterval,
    patrolSpeed, setPatrolSpeed,
    presets,
    move, stop, gotoPreset, setPreset, removePreset,
    cruiseH, stopCruise, patrol, stopPatrol,
  } = usePtzWs(cameraId);

  const [activeDir, setActiveDir] = useState<Direction | null>(null);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [activePresetToken, setActivePresetToken] = useState<string | null>(null);

  const isMovingRef = useRef(false);
  const pressStartRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (isMovingRef.current) {
        isMovingRef.current = false;
        stop();
      }
    };
  }, [stop]);

  const startMove = useCallback((dir: Direction, pan: number, tilt: number, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    isMovingRef.current = true;
    pressStartRef.current = performance.now();
    setActiveDir(dir);
    setActivePresetToken(null);
    move(pan, tilt);
  }, [move]);

  const endMove = useCallback((e?: React.PointerEvent<HTMLButtonElement>) => {
    if (e) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {}
    }
    if (!isMovingRef.current) return;
    isMovingRef.current = false;
    setActiveDir(null);

    const elapsed = performance.now() - pressStartRef.current;
    if (elapsed < MIN_STEP_MS) {
      stopTimerRef.current = setTimeout(() => {
        stopTimerRef.current = null;
        stop();
      }, MIN_STEP_MS - elapsed);
    } else {
      stop();
    }
  }, [stop]);

  const handleCruiseH = () => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    isMovingRef.current = false;
    setActiveDir(null);
    if (cruiseMode === 'h') {
      stopCruise();
    } else {
      cruiseH(0.5);
    }
  };

  const handleSavePreset = async () => {
    if (savingPreset) return;
    const finalName = presetName.trim() || `Punto ${presets.length + 1}`;
    setSavingPreset(true);
    try {
      await setPreset(finalName);
      setPresetName('');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleGotoPreset = (token: string) => {
    setActivePresetToken(token);
    gotoPreset(token);
  };

  const handleDeletePreset = async (token: string) => {
    if (activePresetToken === token) setActivePresetToken(null);
    await removePreset(token);
  };

  const handleIntervalChange = (sec: number) => {
    const valid = Math.max(3, Math.min(3600, Math.round(sec || 10)));
    setPatrolInterval(valid);
    if (cruiseMode === 'patrol' && presets.length > 0) {
      patrol(presets.map(p => p.token), valid, patrolSpeed);
    }
  };

  const handleSpeedChange = (spd: number) => {
    setPatrolSpeed(spd);
    if (cruiseMode === 'patrol' && presets.length > 0) {
      patrol(presets.map(p => p.token), patrolInterval, spd);
    }
  };

  const handleTogglePatrol = () => {
    if (cruiseMode === 'patrol') {
      stopPatrol();
    } else if (presets.length > 0) {
      patrol(presets.map(p => p.token), patrolInterval, patrolSpeed);
    }
  };

  const btnClass = (dir: Direction) =>
    `w-14 h-14 rounded-md border flex items-center justify-center select-none touch-none transition-all ${
      activeDir === dir
        ? 'bg-accent text-on-accent border-accent scale-95'
        : 'bg-void border-glass-border/70 text-text-secondary hover:border-accent hover:text-accent active:scale-95'
    }`;

  return (
    <>
      <div className="lg:hidden fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div className="w-[290px] max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:w-full max-lg:h-auto max-lg:max-h-[80dvh] max-lg:rounded-t-sm max-lg:border-t max-lg:border-l-0 bg-surface border-l border-glass-border/60 flex flex-col h-full overflow-y-auto shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-glass-border/60">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-1 bg-void border border-glass-border/70 rounded-sm font-mono text-[10px] font-bold text-text-secondary tracking-[0.14em] leading-none">PTZ</span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-text-primary font-mono truncate">{cameraName}</h2>
              <p className="text-[10px] text-text-muted font-mono">
                ONVIF &middot; {connected ? 'CONECTADO' : 'CONECTANDO...'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-elevated rounded-sm text-text-secondary hover:text-accent transition-colors">
            <X size={17} />
          </button>
        </div>

        {error && !connected && (
          <div className="mx-3 mt-3 p-2.5 bg-danger/10 border border-danger/40 rounded-sm flex items-center gap-2">
            <AlertTriangle size={16} className="text-danger shrink-0" />
            <span className="text-danger text-[11px] font-mono leading-tight truncate">{error}</span>
          </div>
        )}

        <div className="p-4 flex flex-col gap-5">
          {/* 1. Controles direccionales (4 lados) */}
          <div>
            <p className="text-[10px] text-text-muted font-mono uppercase tracking-[0.18em] mb-3 text-center">
              Direccion
            </p>
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                aria-label="Arriba"
                onPointerDown={(e) => startMove('up', 0, 1, e)}
                onPointerUp={endMove}
                onPointerCancel={endMove}
                className={btnClass('up')}
              >
                <ChevronUp size={22} />
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Izquierda"
                  onPointerDown={(e) => startMove('left', -1, 0, e)}
                  onPointerUp={endMove}
                  onPointerCancel={endMove}
                  className={btnClass('left')}
                >
                  <ChevronLeft size={22} />
                </button>

                <div className="w-14 h-14 rounded-md bg-void/40 border border-glass-border/40 flex items-center justify-center font-mono text-[10px] text-text-muted uppercase tracking-widest select-none">
                  {activeDir ? activeDir.toUpperCase() : 'PTZ'}
                </div>

                <button
                  type="button"
                  aria-label="Derecha"
                  onPointerDown={(e) => startMove('right', 1, 0, e)}
                  onPointerUp={endMove}
                  onPointerCancel={endMove}
                  className={btnClass('right')}
                >
                  <ChevronRight size={22} />
                </button>
              </div>

              <button
                type="button"
                aria-label="Abajo"
                onPointerDown={(e) => startMove('down', 0, -1, e)}
                onPointerUp={endMove}
                onPointerCancel={endMove}
                className={btnClass('down')}
              >
                <ChevronDown size={22} />
              </button>
            </div>
          </div>

          {/* 2. Movimiento Horizontal continuo */}
          <div className="border-t border-glass-border/60 pt-4">
            <p className="text-[10px] text-text-muted font-mono uppercase tracking-[0.18em] mb-2">
              Movimiento Horizontal
            </p>
            <button
              type="button"
              onClick={handleCruiseH}
              className={`w-full py-2.5 px-3 rounded-md border text-xs font-mono font-semibold flex items-center justify-center gap-2 transition-colors ${
                cruiseMode === 'h'
                  ? 'bg-accent text-on-accent border-accent'
                  : 'bg-void border-glass-border/70 text-text-primary hover:border-accent hover:text-accent'
              }`}
            >
              <RotateCw size={15} className={cruiseMode === 'h' ? 'animate-spin' : ''} />
              {cruiseMode === 'h' ? 'Detener Movimiento Horizontal' : 'Movimiento Horizontal'}
            </button>
          </div>

          {/* 3. Puntos de Vista (Guardar / Ir / Eliminar) */}
          <div className="border-t border-glass-border/60 pt-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-text-muted font-mono uppercase tracking-[0.18em]">
                Puntos de Vista ({presets.length})
              </p>
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSavePreset();
                  }
                }}
                placeholder={`Punto ${presets.length + 1}...`}
                className="flex-1 min-w-0 bg-void border border-glass-border/70 rounded-md px-2.5 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handleSavePreset}
                disabled={savingPreset}
                title="Guardar posición actual como punto de vista"
                className="px-3 py-2 rounded-md border bg-void border-glass-border/70 hover:border-accent hover:text-accent text-text-primary text-xs font-mono font-semibold flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
              >
                <Plus size={14} />
                Guardar
              </button>
            </div>

            {presets.length > 0 ? (
              <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-0.5">
                {presets.map((p, idx) => (
                  <div
                    key={p.token}
                    className={`flex items-center justify-between gap-1 px-2 py-1.5 rounded-md border text-xs font-mono transition-colors ${
                      activePresetToken === p.token
                        ? 'bg-accent/15 border-accent text-accent'
                        : 'bg-void border-glass-border/60 text-text-primary hover:border-accent/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleGotoPreset(p.token)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left truncate"
                      title={`Ir a ${p.name}`}
                    >
                      <MapPin size={13} className="text-accent shrink-0" />
                      <span className="text-[10px] text-text-muted shrink-0">#{idx + 1}</span>
                      <span className="truncate">{p.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePreset(p.token)}
                      title={`Eliminar ${p.name}`}
                      className="p-1 rounded-sm text-text-muted hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-text-muted font-mono text-center py-1.5 bg-void/40 rounded-md border border-dashed border-glass-border/50">
                Mueve la cámara y pulsa Guardar para crear puntos de vista
              </p>
            )}
          </div>

          {/* 4. Modo Patrulla por segundos */}
          <div className="border-t border-glass-border/60 pt-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-text-muted font-mono uppercase tracking-[0.18em]">
                Modo Patrulla
              </p>
              <span className="flex items-center gap-1 text-[10px] font-mono text-text-secondary">
                <Clock size={11} />
                Cada {patrolInterval}s
              </span>
            </div>

            <div className="flex items-center gap-1">
              {QUICK_INTERVALS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => handleIntervalChange(sec)}
                  className={`flex-1 py-1.5 rounded-sm border text-[11px] font-mono transition-colors ${
                    patrolInterval === sec
                      ? 'bg-accent text-on-accent border-accent font-bold'
                      : 'bg-void border-glass-border/60 text-text-secondary hover:border-accent hover:text-accent'
                  }`}
                >
                  {sec}s
                </button>
              ))}
              <div className="flex items-center bg-void border border-glass-border/70 rounded-sm px-1.5 py-1 w-16 shrink-0 focus-within:border-accent">
                <input
                  type="number"
                  min={3}
                  max={3600}
                  value={patrolInterval}
                  onChange={(e) => handleIntervalChange(Number(e.target.value))}
                  aria-label="Segundos por punto de vista"
                  className="w-full bg-transparent text-[11px] font-mono text-text-primary text-right focus:outline-none"
                />
                <span className="text-[10px] font-mono text-text-muted ml-0.5">s</span>
              </div>
            </div>

            {/* Velocidad de transicion entre puntos */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-glass-border/40">
              <span className="text-[10px] text-text-muted font-mono uppercase tracking-[0.14em]">
                Velocidad de movimiento
              </span>
              <div className="grid grid-cols-4 gap-1">
                {PATROL_SPEEDS.map((s) => (
                  <button
                    key={s.speed}
                    type="button"
                    onClick={() => handleSpeedChange(s.speed)}
                    className={`py-1 rounded-sm border text-[10px] font-mono transition-colors ${
                      Math.abs(patrolSpeed - s.speed) < 0.05
                        ? 'bg-accent text-on-accent border-accent font-bold'
                        : 'bg-void border-glass-border/60 text-text-secondary hover:border-accent hover:text-accent'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleTogglePatrol}
              disabled={presets.length === 0 && cruiseMode !== 'patrol'}
              className={`w-full py-2.5 px-3 rounded-md border text-xs font-mono font-semibold flex items-center justify-center gap-2 transition-colors ${
                cruiseMode === 'patrol'
                  ? 'bg-recording text-on-accent border-recording'
                  : presets.length > 0
                  ? 'bg-void border-glass-border/70 text-text-primary hover:border-accent hover:text-accent'
                  : 'bg-void/50 border-glass-border/40 text-text-muted cursor-not-allowed'
              }`}
            >
              {cruiseMode === 'patrol' ? (
                <>
                  <Square size={14} />
                  Detener Patrulla ({patrolInterval}s)
                </>
              ) : (
                <>
                  <Play size={14} />
                  Iniciar Patrulla ({presets.length} {presets.length === 1 ? 'punto' : 'puntos'})
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
