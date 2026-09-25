import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Film, Trash2, RefreshCw,
  ChevronLeft, ChevronRight, X, Download, Loader2,
} from 'lucide-react';
import type HlsType from 'hls.js';
import { api } from '../lib/api';
import { getToken } from '../lib/auth';
import type { Camera, CalendarDay, HourSegment } from '../lib/api';

const WEEKDAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS_FULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatDateEs(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS_FULL[date.getDay()]}, ${d} de ${MONTHS_FULL[date.getMonth()]} de ${y}`;
}

function CalendarView({ days, selectedDate, onSelect }: {
  days: CalendarDay[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const daysByDate = useMemo(() => {
    const m = new Map<string, CalendarDay>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  const calendarCells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: { date: string | null; dom: number | null }[] = [];
    for (let i = 0; i < startDow; i++) cells.push({ date: null, dom: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        date: `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`,
        dom: d,
      });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, dom: null });
    return cells;
  }, [viewYear, viewMonth]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();

  return (
    <div className="bg-surface border border-glass-border/60 rounded-sm p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <button onClick={prevMonth} className="p-2.5 rounded-md bg-void border border-glass-border/70 text-text-secondary hover:text-accent hover:border-accent transition-colors">
          <ChevronLeft size={18} className="text-current" />
        </button>
        <h3 className="text-sm font-semibold font-mono uppercase tracking-[0.14em] text-text-primary">
          {MONTHS_ES[viewMonth]} {viewYear}
        </h3>
        <button onClick={nextMonth} className="p-2.5 rounded-md bg-void border border-glass-border/70 text-text-secondary hover:text-accent hover:border-accent transition-colors">
          <ChevronRight size={18} className="text-current" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-bold text-text-muted font-mono uppercase py-1">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {calendarCells.map((cell, i) => {
          if (!cell.date) return <div key={i} className="aspect-square" />;
          const day = daysByDate.get(cell.date);
          const isToday = cell.date === todayStr;
          const isSelected = cell.date === selectedDate;
          const domNum = cell.date ? Number(cell.date.slice(-2)) : 0;
          const isFuture = (cell.dom ?? 0) > 0 &&
            (viewYear > todayYear || (viewYear === todayYear && viewMonth > todayMonth) ||
              (viewYear === todayYear && viewMonth === todayMonth && domNum > today.getDate()));
          return (
            <button
              key={i}
              onClick={() => day && cell.date && onSelect(cell.date)}
              disabled={!day || isFuture}
              className={`aspect-square rounded-md flex flex-col items-center justify-center text-xs font-mono transition-colors relative
                ${isSelected ? 'bg-accent text-on-accent font-bold' : ''}
                ${!isSelected && day ? 'bg-void text-text-primary border border-glass-border/60 hover:border-accent hover:text-accent cursor-pointer' : ''}
                ${!day && !isFuture ? 'text-text-muted cursor-default' : ''}
                ${isFuture ? 'text-text-muted opacity-40 cursor-not-allowed' : ''}
                ${isToday && !isSelected ? 'ring-1 ring-accent' : ''}
              `}
              title={day ? `${day.count} grabaciones` : ''}
            >
              <span>{cell.dom}</span>
              {day && (
                <span className={`w-1 h-1 rounded-[1px] mt-0.5 ${isSelected ? 'bg-white' : 'bg-recording'}`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HourTimeline({ hours, selectedHour, onSelect }: {
  hours: HourSegment[];
  selectedHour: number | null;
  onSelect: (hour: number) => void;
}) {
  const all24 = Array.from({ length: 24 }, (_, h) => h);
  const byHour = new Map<number, HourSegment>();
  for (const h of hours) byHour.set(h.hour, h);

  const totalSize = hours.reduce((acc, h) => acc + h.size, 0);

  return (
    <div className="bg-surface border border-glass-border/60 rounded-sm p-3">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-text-secondary">Timeline 24h</h3>
        <span className="font-mono text-[10px] text-text-muted">
          {hours.length} seg &middot; {formatSize(totalSize)}
        </span>
      </div>

      <div className="flex items-end gap-[3px] h-14">
        {all24.map((h) => {
          const seg = byHour.get(h);
          const playable = seg?.playable !== false;
          const clickable = seg && (playable || seg.in_progress);
          const isSelected = h === selectedHour;
          return (
            <button
              key={h}
              onClick={() => clickable && onSelect(h)}
              disabled={!clickable}
              aria-label={`${pad(h)}:00`}
              className={`flex-1 min-w-0 rounded-[1px] transition-colors ${clickable
                ? isSelected
                  ? 'bg-accent'
                  : 'bg-recording/75 hover:bg-accent/80'
                : 'bg-void border border-glass-border/40'}
                ${seg?.in_progress && !isSelected ? 'animate-pulse' : ''}`}
              style={{ height: clickable ? '100%' : '35%' }}
              title={seg ? (seg.in_progress
                ? `${pad(h)}:00 - ${pad(h + 1)}:00 (grabando - ${formatSize(seg.size)})`
                : `${pad(h)}:00 - ${pad(h + 1)}:00 (${formatSize(seg.size)})`)
                : `${pad(h)}:00 sin grabacion`}
            />
          );
        })}
      </div>

      <div className="flex mt-1">
        {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
          <div key={h} className="flex-1 flex flex-col items-start">
            <div className="h-1 w-px bg-glass-border/60" />
            <span className="font-mono text-[9px] text-text-muted leading-none mt-0.5">{pad(h)}:00</span>
          </div>
        ))}
        <div className="flex-1" />
      </div>
    </div>
  );
}

function VideoPlayer({ filename, title, url, downloadUrl, onClose, onNext, onPrev }: {
  filename: string;
  title: string;
  url: string;
  downloadUrl: string;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [preparing, setPreparing] = useState(false);
  const retriesRef = useRef(0);
  const MAX_RETRIES = 2;
  const isInProgressRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let hls: HlsType | null = null;
    const el = videoRef.current;
    if (!el) return;
    const v: HTMLVideoElement = el;

    let streamUrl = url;

    const onLoaded = () => {
      if (!cancelled) {
        setLoading(false);
        setPreparing(false);
        v.play().catch(() => {});
      }
    };

    const onErr = () => {
      if (cancelled) return;
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        setTimeout(() => {
          if (!cancelled && v) {
            setLoading(true);
            setError(false);
            v.load();
          }
        }, 2000);
      } else {
        setError(true);
        setLoading(false);
        setPreparing(false);
        const code = v.error?.code;
        if (code === 3) setErrorMsg('Error de decodificacion — archivo corrupto o incompleto');
        else if (code === 4) setErrorMsg('Formato no soportado por el navegador');
        else setErrorMsg('No se pudo cargar el segmento');
      }
    };

    const attachDirectStream = (targetUrl: string) => {
      v.addEventListener('loadedmetadata', onLoaded);
      v.addEventListener('loadeddata', onLoaded);
      v.addEventListener('canplay', onLoaded);
      v.src = targetUrl;
      v.load();
    };

    async function loadVideo() {
      setLoading(true);
      setError(false);
      setErrorMsg('');
      setPreparing(false);
      retriesRef.current = 0;

      v.addEventListener('error', onErr);

      try {
        const res = await api.checkRecording(filename);
        if (cancelled) return;
        isInProgressRef.current = res.playable && res.reason === 'in progress';
        if (!res.playable) {
          if (res.reason.includes('moov')) {
            setPreparing(true);
            try {
              const prep = await api.prepareRecording(filename);
              if (cancelled) return;
              if (!prep.ready) {
                setError(true);
                setLoading(false);
                setPreparing(false);
                setErrorMsg('Segmento en grabacion — el video no esta disponible hasta que termine la hora.\n\nVe al Dashboard para ver en vivo.');
                return;
              }
              streamUrl = api.recordingStreamUrl(prep.prepared_filename);
              setPreparing(false);
            } catch {
              if (cancelled) return;
              setError(true);
              setLoading(false);
              setPreparing(false);
              setErrorMsg('Segmento en grabacion — el video no esta disponible hasta que termine la hora.\n\nVe al Dashboard para ver en vivo.');
              return;
            }
          } else {
            setError(true);
            setLoading(false);
            if (res.reason.includes('codec')) {
              setErrorMsg('Formato de video no soportado por el navegador — la grabacion usa un codec incompatible. Cambia la camara a H.264 en la app Tapo.');
            } else if (res.reason.includes('in progress') || res.reason.includes('recording')) {
              setErrorMsg('Segmento en grabacion, aun no disponible');
            } else if (res.reason.includes('small')) {
              setErrorMsg('Segmento incompleto, grabacion en curso');
            } else {
              setErrorMsg('Segmento no disponible');
            }
            return;
          }
        }

        if (isInProgressRef.current) {
          const cameraFolder = filename.split('/')[0];
          const hlsUrl = `/recordings/files/${cameraFolder}/_live/playlist.m3u8`;
          try {
            const Hls = (await import('hls.js')).default;
            if (cancelled) return;
            hls = new Hls({ liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 10 });
            hls.loadSource(hlsUrl);
            hls.attachMedia(v);
            hls.on((Hls as any).Events.MANIFEST_PARSED, () => {
              if (cancelled) return;
              (hls as any).startLoad(0);
              setLoading(false);
              v.play().catch(() => {});
            });
            hls.on((Hls as any).Events.ERROR, async (_ev: any, data: any) => {
              if (data.fatal) {
                hls?.destroy();
                hls = null;
                try {
                  setPreparing(true);
                  const prep = await api.prepareRecording(filename);
                  if (cancelled) return;
                  if (prep.ready) {
                    streamUrl = api.recordingStreamUrl(prep.prepared_filename);
                  }
                } catch {}
                if (!cancelled) {
                  setPreparing(false);
                  attachDirectStream(streamUrl);
                }
              }
            });
          } catch {
            if (cancelled) return;
            attachDirectStream(streamUrl);
          }
        } else {
          attachDirectStream(streamUrl);
        }
      } catch {
        if (cancelled) return;
        attachDirectStream(streamUrl);
      }
    }

    loadVideo();

    return () => {
      cancelled = true;
      v.removeEventListener('error', onErr);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('canplay', onLoaded);
      if (hls) hls.destroy();
    };
  }, [filename, url]);

  return (
    <div className="bg-surface border border-glass-border/60 rounded-sm overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-glass-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold font-mono text-text-primary truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {onPrev && (
            <button onClick={onPrev} className="p-2 rounded-sm hover:bg-elevated transition-colors text-text-secondary hover:text-accent" title="Hora anterior">
              <ChevronLeft size={15} />
            </button>
          )}
          {onNext && (
            <button onClick={onNext} className="p-2 rounded-sm hover:bg-elevated transition-colors text-text-secondary hover:text-accent" title="Hora siguiente">
              <ChevronRight size={15} />
            </button>
          )}
          <a href={downloadUrl} download className="p-2 rounded-sm hover:bg-elevated transition-colors text-accent" title="Descargar">
            <Download size={15} />
          </a>
          <button onClick={onClose} className="p-2 rounded-sm hover:bg-elevated transition-colors text-text-secondary hover:text-danger" title="Cerrar">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="relative bg-void aspect-video">
        {loading && (
          <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center gap-2 bg-void/60">
            <Loader2 size={28} className="text-accent animate-spin" />
            {preparing && (
              <span className="text-xs font-mono text-text-muted uppercase tracking-[0.14em]">Preparando segmento...</span>
            )}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-void/90 text-text-muted text-base text-center px-4 whitespace-pre-line">
            {errorMsg}
          </div>
        )}
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          preload="auto"
          className="w-full h-full object-contain"
        />
      </div>
    </div>
  );
}

export function Dvr() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [calendar, setCalendar] = useState<CalendarDay[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hours, setHours] = useState<HourSegment[]>([]);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedCameraRef = useRef(selectedCamera);
  const selectedDateRef = useRef(selectedDate);

  const loadCameras = useCallback(async () => {
    if (cameras.length > 0) return;
    try {
      const cams = await api.getCameras();
      setCameras(cams);
      if (cams.length > 0 && (!selectedCamera || !cams.find(c => c.id === selectedCamera))) {
        setSelectedCamera(cams[0].id);
      }
    } catch {}
  }, [cameras.length, selectedCamera]);

  const loadCalendar = useCallback(async () => {
    if (!selectedCamera) return;
    setLoadingCalendar(true);
    try {
      const c = await api.getDvrCalendar(selectedCamera);
      setCalendar(c);
      if (c.length > 0 && (!selectedDateRef.current || !c.some((d) => d.date === selectedDateRef.current))) {
        selectedDateRef.current = c[0].date;
        setSelectedDate(c[0].date);
      }
    } catch {
      setCalendar([]);
    }
    setLoadingCalendar(false);
  }, [selectedCamera]);

  const loadHours = useCallback(async (date: string) => {
    try {
      const h = await api.getDvrHours(selectedCamera, date);
      setHours(h);
    } catch {
      setHours([]);
    }
  }, [selectedCamera]);

  useEffect(() => {
    loadCameras();
  }, [loadCameras]);

  useEffect(() => {
    selectedCameraRef.current = selectedCamera;
    selectedDateRef.current = selectedDate;
  }, [selectedCamera, selectedDate]);

  useEffect(() => {
    if (!selectedCamera) return;
    selectedDateRef.current = null;
    setSelectedDate(null);
    setHours([]);
    setSelectedHour(null);
    loadCalendar();
  }, [selectedCamera, loadCalendar]);

  useEffect(() => {
    intervalRef.current = null;
    if (!selectedCamera) return;
    intervalRef.current = setInterval(() => {
      if (!selectedCameraRef.current) return;
      setAutoRefreshing(true);
      loadCalendar().finally(() => setAutoRefreshing(false));
      const currentDate = selectedDateRef.current;
      if (currentDate) loadHours(currentDate);
    }, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [selectedCamera]);

  useEffect(() => {
    if (selectedDate) {
      loadHours(selectedDate);
      setSelectedHour(null);
    } else {
      setHours([]);
      setSelectedHour(null);
    }
  }, [selectedDate, loadHours]);

  const refreshCalendar = () => {
    loadCalendar();
    if (selectedDate) loadHours(selectedDate);
  };

  const handleCleanup = async () => {
    setCleanupBusy(true);
    try {
      const r = await api.cleanupDvr();
      setLastCleanup(`${r.deleted} archivos eliminados`);
      loadCalendar();
      if (selectedDate) loadHours(selectedDate);
    } catch {
      setLastCleanup('Error al limpiar');
    }
    setCleanupBusy(false);
    setTimeout(() => setLastCleanup(null), 5000);
  };

  const selectedSeg = useMemo(() => {
    if (selectedHour === null) return null;
    return hours.find((h) => h.hour === selectedHour) ?? null;
  }, [hours, selectedHour]);

  const nextHour = useMemo(() => {
    if (selectedHour === null) return null;
    return hours.find((h) => h.hour > selectedHour)?.hour ?? null;
  }, [hours, selectedHour]);

  const prevHour = useMemo(() => {
    if (selectedHour === null) return null;
    const prev = [...hours].reverse().find((h) => h.hour < selectedHour);
    return prev?.hour ?? null;
  }, [hours, selectedHour]);

  const selectedCam = cameras.find(c => c.id === selectedCamera);
  const cameraName = selectedCam?.name ?? 'Cam';
  const segUrl = selectedSeg ? api.recordingStreamUrl(selectedSeg.filename) : null;
  const segDownloadUrl = selectedSeg ? `/api/recordings/${selectedSeg.filename}?token=${getToken() ?? ''}` : null;
  const segTitle = selectedSeg && selectedDate
    ? `${cameraName} - ${selectedDate} ${pad(selectedSeg.hour)}:00 - ${pad((selectedSeg.hour + 1) % 24)}:00${selectedSeg.in_progress ? ' (grabando)' : ''}`
    : '';

  return (
    <div className="h-full flex flex-col p-3 gap-3 overflow-y-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <span className="px-2 py-1 bg-void border border-glass-border/70 rounded-sm font-mono text-[10px] font-bold text-accent tracking-[0.14em] leading-none">DVR</span>
          <h1 className="text-base font-bold font-mono uppercase tracking-[0.12em] text-text-primary">Grabacion continua</h1>
          <div
            className="flex items-center gap-1.5 bg-recording/15 px-2 py-1 rounded-sm border border-recording/40"
            title="Las camaras graban siempre. El DVR no se puede detener."
          >
            <div className="w-1.5 h-1.5 rounded-full bg-recording animate-pulse" />
            <span className="text-[10px] font-bold text-recording tracking-[0.14em]">REC</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedCamera}
            onChange={(e) => setSelectedCamera(e.target.value)}
            className="bg-void border border-glass-border/70 rounded-md px-3 py-2 text-sm font-mono text-text-primary focus:outline-none focus:border-accent"
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name || `Cam ${c.id}`}</option>
            ))}
          </select>
<button
              onClick={refreshCalendar}
              className="p-2.5 rounded-md bg-void border border-glass-border/70 text-text-secondary hover:text-accent hover:border-accent transition-colors"
              title="Actualizar"
            >
              <RefreshCw size={15} className={(loadingCalendar || autoRefreshing) ? 'animate-spin' : ''} />
            </button>
          <button
            onClick={handleCleanup}
            disabled={cleanupBusy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-void border border-glass-border/70 text-text-secondary hover:text-danger hover:border-danger transition-colors disabled:opacity-50"
            title="Eliminar grabaciones antiguas"
          >
            <Trash2 size={15} className={cleanupBusy ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {lastCleanup && (
        <div className="bg-void border border-glass-border/60 rounded-sm px-3 py-2 text-xs font-mono text-text-secondary">
          {lastCleanup}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1">
        <div className="lg:col-span-5 xl:col-span-4">
          <CalendarView days={calendar} selectedDate={selectedDate} onSelect={setSelectedDate} />
        </div>
        <div className="lg:col-span-7 xl:col-span-8">
          {selectedDate ? (
            <>
              <div className="mb-2 text-sm text-text-muted">
                <Film size={14} className="inline mr-1" />
                {formatDateEs(selectedDate)}
              </div>
              <HourTimeline hours={hours} selectedHour={selectedHour} onSelect={setSelectedHour} />
            </>
          ) : (
            <div className="bg-surface border border-glass-border/60 rounded-sm p-4 h-full flex items-center justify-center text-text-muted text-sm">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Selecciona una fecha del calendario</span>
            </div>
          )}
        </div>
      </div>

      {selectedSeg && segUrl && segDownloadUrl && (
        <div className="mt-2">
          <VideoPlayer
            filename={selectedSeg.filename}
            title={segTitle}
            url={segUrl}
            downloadUrl={segDownloadUrl}
            onClose={() => setSelectedHour(null)}
            onNext={nextHour !== null ? () => setSelectedHour(nextHour) : undefined}
            onPrev={prevHour !== null ? () => setSelectedHour(prevHour) : undefined}
          />
        </div>
      )}

      {cameras.length === 0 && (
        <div className="text-center py-16 text-text-muted text-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em]">No hay camaras configuradas. Ve a Configuracion.</span>
        </div>
      )}
    </div>
  );
}
