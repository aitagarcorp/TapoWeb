import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, LayoutGrid, Columns, GripVertical, Radar } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../lib/api';
import type { Camera, WatchdogStatus, MjpegStatus } from '../lib/api';
import { getToken } from '../lib/auth';
import { CameraTile } from '../components/CameraTile';
import { PTZPanel } from '../components/PTZPanel';
import { useKeyboardPtz } from '../hooks/useKeyboardPtz';
import { usePtzWs } from '../hooks/usePtzWs';
import { useIsMobile } from '../hooks/useIsMobile';

const THUMB_HEIGHT = 160;
const LEFT_WIDTH = 270;
const LMAIN_GAP = 6;
const M_THUMB_HEIGHT = 140;
const M_THUMB_WIDTH = 150;

function SortableCameraTile({
  cam,
  wsUrl,
  watchdog,
  mjpeg,
  viewMode,
  isMain,
  onOpenPtz,
  onFocus,
  onBlur,
  onClick,
  tileHeight,
  compact,
  thumbWidth,
  index = 0,
  camNumber,
}: {
  cam: Camera;
  wsUrl: string;
  watchdog: WatchdogStatus | null;
  mjpeg: MjpegStatus | null;
  viewMode: string;
  isMain: boolean;
  onOpenPtz: (id: string) => void;
  onFocus: (id: string) => void;
  onBlur: () => void;
  onClick?: () => void;
  tileHeight?: number;
  compact?: boolean;
  thumbWidth?: number;
  index?: number;
  camNumber?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cam.id,
    disabled: isMain,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto',
    animationDelay: `${Math.min(index, 12) * 45}ms`,
    ...(!compact && tileHeight ? { height: tileHeight, minHeight: tileHeight } : {}),
    ...(compact && thumbWidth ? { width: thumbWidth, minWidth: thumbWidth, maxWidth: thumbWidth } : {}),
  };

  if (viewMode === 'lmain' && !isMain) {
    return (
      <div ref={setNodeRef} style={style} className={`animate-tile-in relative group h-full ${compact ? 'flex-1 min-h-0' : ''}`}>
        <div
          {...attributes}
          {...listeners}
          className="absolute top-1 left-1 z-20 p-1 rounded-sm bg-void/85 backdrop-blur-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
        >
          <GripVertical size={14} className="text-text-muted" />
        </div>
        <div onClick={onClick} className="cursor-pointer h-full">
          <CameraTile
            cameraId={cam.id}
            name={cam.name}
            wsUrl={wsUrl}
            watchdog={watchdog}
            mjpeg={mjpeg}
            onOpenPtz={onOpenPtz}
            onFocus={onFocus}
            onBlur={onBlur}
            className="min-h-0"
            compact={compact}
            camNumber={camNumber}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="animate-tile-in relative group h-full">
      {!isMain && (
        <div
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 z-20 p-1.5 rounded-sm bg-void/85 backdrop-blur-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
        >
          <GripVertical size={14} className="text-text-muted" />
        </div>
      )}
      <CameraTile
        cameraId={cam.id}
        name={cam.name}
        wsUrl={wsUrl}
        watchdog={watchdog}
        mjpeg={mjpeg}
        onOpenPtz={onOpenPtz}
        onFocus={onFocus}
        onBlur={onBlur}
        camNumber={camNumber}
      />
    </div>
  );
}

function SweepLauncher({ cameraId, active }: { cameraId: string; active: boolean }) {
  const ptz = usePtzWs(cameraId);
  const sentRef = useRef(false);

  useEffect(() => {
    if (active && ptz.connected && !sentRef.current) {
      ptz.patrolSweep(0.7);
      sentRef.current = true;
    }
    if (!active && sentRef.current) {
      ptz.stopSweep();
      sentRef.current = false;
    }
  }, [active, ptz.connected, ptz.patrolSweep, ptz.stopSweep]);

  useEffect(() => {
    sentRef.current = false;
  }, [cameraId]);

  useEffect(() => {
    return () => {
      if (sentRef.current) ptz.stopSweep();
    };
  }, [ptz.stopSweep]);

  return null;
}

export function Dashboard() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [gridSize, setGridSize] = useState(4);
  const [viewMode, setViewMode] = useState<'grid' | 'lmain'>('grid');
  const [mainCamera, setMainCamera] = useState('');
  const [ptzCamera, setPtzCamera] = useState<string | null>(null);
  const [focusedCamera, setFocusedCamera] = useState<string | null>(null);
  const [watchdogMap, setWatchdogMap] = useState<Map<string, WatchdogStatus>>(new Map());
  const [mjpegMap, setMjpegMap] = useState<Map<string, MjpegStatus>>(new Map());
  const [sweepActive, setSweepActive] = useState(false);
  const [sweepCameraIds, setSweepCameraIds] = useState<string[]>([]);
  const isMobile = useIsMobile();

  const lmainRef = useRef<HTMLDivElement>(null);

  const cameraIds = cameras.map(c => c.id);
  const activePtzTarget = ptzCamera ?? focusedCamera;
  const { connected: kbPtzConnected } = useKeyboardPtz(cameraIds, activePtzTarget);

  const toggleSweep = useCallback(() => {
    if (!cameras.length) return;
    if (sweepActive) {
      setSweepActive(false);
    } else {
      const targets = cameras
        .filter(c => mjpegMap.get(c.id)?.has_signal)
        .map(c => c.id);
      if (targets.length === 0) {
        for (const c of cameras) targets.push(c.id);
      }
      setSweepCameraIds(targets);
      setSweepActive(true);
    }
  }, [sweepActive, cameras, mjpegMap]);

  useEffect(() => {
    if (!sweepActive && sweepCameraIds.length > 0) {
      const t = setTimeout(() => setSweepCameraIds([]), 300);
      return () => clearTimeout(t);
    }
  }, [sweepActive, sweepCameraIds.length]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const load = useCallback(async () => {
    const allCams = await api.getCameras();
    // De-duplicate by IP (physical-camera identity) and by id, keep first occurrence.
    // Also ignore disabled cameras and entries without a usable ip/id (defensive).
    const seenIp = new Set<string>();
    const seenId = new Set<string>();
    const cams = allCams.filter(cam => {
      if (cam.enabled === false) return false;
      const id = cam.id ?? '';
      const ip = (cam.ip ?? '').trim();
      if (!id || !ip) return false;
      if (seenId.has(id)) return false;
      if (seenIp.has(ip)) return false;
      seenId.add(id);
      seenIp.add(ip);
      return true;
    });
    setCameras(cams);
    const s = await api.getSettings();
    setGridSize(s.grid_size);
    setViewMode(s.view_mode as 'grid' | 'lmain');
    const mainId = cams.find(c => c.id === s.main_camera) ? s.main_camera : (cams.length > 0 ? cams[0].id : '');
    setMainCamera(mainId);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pollWatchdog = useCallback(async () => {
    try {
      const h = await api.health();
      const wmap = new Map<string, WatchdogStatus>();
      for (const s of h.watchdog) {
        wmap.set(s.camera_id, s);
      }
      setWatchdogMap(wmap);
      const mmap = new Map<string, MjpegStatus>();
      for (const s of (h.mjpeg ?? [])) {
        mmap.set(s.camera_id, s);
      }
      setMjpegMap(mmap);
    } catch {}
  }, []);

  useEffect(() => {
    pollWatchdog();
    const iv = setInterval(pollWatchdog, 5000);
    return () => clearInterval(iv);
  }, [pollWatchdog]);

  const toggleView = useCallback(() => {
    const next = viewMode === 'grid' ? 'lmain' : 'grid';
    setViewMode(next);
    api.updateSettings({ view_mode: next });
  }, [viewMode]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;

    const oldIndex = cameras.findIndex(c => c.id === active.id);
    const newIndex = cameras.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    setCameras(prev => arrayMove(prev, oldIndex, newIndex));
    api.reorderCameras(oldIndex, newIndex);
  }, [cameras]);

  const handleColumnClick = useCallback((clickedId: string) => {
    if (clickedId === mainCamera) return;
    setMainCamera(clickedId);
    api.updateSettings({ main_camera: clickedId });
  }, [mainCamera]);

  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsToken = getToken() || '';
  const mjpegUrl = (id: string) => `${wsProtocol}//${location.host}/ws/mjpeg/${id}?token=${encodeURIComponent(wsToken)}`;

  const cols = isMobile ? Math.min(gridSize, 2) : gridSize;

  const mainCam = cameras.find(c => c.id === mainCamera);
  const otherCams = cameras.filter(c => c.id !== mainCamera);

  const leftCount = Math.min(otherCams.length, 4);
  const leftCams = otherCams.slice(0, leftCount);
  const bottomCams = otherCams.slice(leftCount);

  const leftEmptyCount = Math.max(0, 4 - leftCams.length);

  const camNum = (id: string) => cameras.findIndex(c => c.id === id) + 1;

  return (
    <div className="h-full flex bg-void">
      <div className="flex-1 flex flex-col p-2 gap-2 min-w-0">
        <div className="flex items-center gap-2 shrink-0 h-12 px-2 lg:px-3 bg-surface border border-glass-border rounded-sm">
          <div className="flex items-center bg-elevated border border-glass-border rounded-sm p-0.5">
            <button
              onClick={() => { if (viewMode !== 'grid') toggleView(); }}
              title="Vista grilla"
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-sm transition-all ${viewMode === 'grid' ? 'bg-accent text-on-accent' : 'text-text-secondary hover:text-text-primary'}`}
            >
              <LayoutGrid size={17} />
              <span className="hidden lg:inline font-mono text-xs font-semibold uppercase tracking-[0.12em]">Grid</span>
            </button>
            <button
              onClick={() => { if (viewMode !== 'lmain') toggleView(); }}
              title="Vista principal + auxiliares"
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-sm transition-all ${viewMode === 'lmain' ? 'bg-accent text-on-accent' : 'text-text-secondary hover:text-text-primary'}`}
            >
              <Columns size={17} />
              <span className="hidden lg:inline font-mono text-xs font-semibold uppercase tracking-[0.12em]">L+Main</span>
            </button>
          </div>

          {viewMode === 'grid' && (
            <select
              value={gridSize}
              aria-label="Tamano de grilla"
              onChange={e => { setGridSize(Number(e.target.value)); api.updateSettings({ grid_size: Number(e.target.value) }); }}
              className="bg-elevated border border-glass-border rounded-sm px-3 py-2 font-mono text-sm font-semibold text-text-primary focus:outline-none focus:border-accent"
            >
              {[2,3,4,5,6].map(n => <option key={n} value={n}>{n}x{n}</option>)}
            </select>
          )}

          <div className="h-6 w-px bg-glass-border" />

          <button
            onClick={toggleSweep}
            className={`flex items-center gap-1.5 px-3.5 py-2 border rounded-sm font-mono text-xs font-semibold uppercase tracking-[0.12em] transition-all ${sweepActive ? 'bg-accent text-on-accent border-accent' : 'bg-elevated border-glass-border text-text-secondary hover:border-accent hover:text-text-primary'}`}
            title={sweepActive ? `Detener patrullaje en ${sweepCameraIds.length} camaras` : 'Patrullaje horizontal en todas las camaras disponibles'}
          >
            <Radar size={17} className={sweepActive ? 'animate-spin' : ''} />
            <span className="hidden lg:inline">{sweepActive ? `Stop (${sweepCameraIds.length})` : 'Patrulla'}</span>
          </button>
          <button
            onClick={load}
            aria-label="Actualizar"
            title="Actualizar"
            className="p-2.5 bg-elevated border border-glass-border hover:border-accent rounded-sm text-text-secondary hover:text-text-primary transition-all"
          >
            <RefreshCw size={17} />
          </button>

          <div className="flex-1" />

          <span className="hidden lg:block font-mono text-[11px] text-text-muted truncate">
            {activePtzTarget !== null && cameras.find(c => c.id === activePtzTarget)
              ? `PTZ \u2192 ${cameras.find(c => c.id === activePtzTarget)!.name}${kbPtzConnected ? ' \u2713' : ' ...'}`
              : 'Hover sobre una camara para PTZ por teclado'}
          </span>
        </div>

        {viewMode === 'grid' ? (
        <motion.div
          key="grid"
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="h-full flex flex-col flex-1 min-h-0"
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={cameraIds} strategy={rectSortingStrategy}>
              <div
                className="flex-1 grid gap-2 overflow-y-auto"
                style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: isMobile ? '200px' : '1fr' }}
              >
                {cameras.map((cam, i) => (
                  <SortableCameraTile
                    key={cam.id}
                    index={i}
                    cam={cam}
                    camNumber={camNum(cam.id)}
                    wsUrl={mjpegUrl(cam.id)}
                    watchdog={watchdogMap.get(cam.id) ?? null}
                    mjpeg={mjpegMap.get(cam.id) ?? null}
                    viewMode="grid"
                    isMain={false}
                    onOpenPtz={setPtzCamera}
                    onFocus={setFocusedCamera}
                    onBlur={() => setFocusedCamera(null)}
                  />
                ))}
                {Array.from({ length: Math.max(0, cols * cols - cameras.length) }).map((_, i) => (
                  <div key={`empty-${i}`} className="hidden lg:flex border border-dashed border-glass-border/60 rounded-sm items-center justify-center min-h-[180px] bg-void/40 hover:border-accent/40 transition-colors">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Slot {cameras.length + i + 1}</span>
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </motion.div>
        ) : (
        <motion.div
          key="lmain"
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="h-full flex flex-col flex-1 min-h-0"
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            {isMobile ? (
              <div className="flex-1 flex flex-col min-h-0" style={{ gap: LMAIN_GAP }}>
                <div className="flex-1 min-h-0">
                  {mainCam ? (
                    <div className="h-full ring-1 ring-accent/20 rounded-lg overflow-hidden">
                      <SortableCameraTile
                        cam={mainCam}
                        camNumber={camNum(mainCam.id)}
                        wsUrl={mjpegUrl(mainCam.id)}
                        watchdog={watchdogMap.get(mainCam.id) ?? null}
                        mjpeg={mjpegMap.get(mainCam.id) ?? null}
                        viewMode="lmain"
                        isMain={true}
                        onOpenPtz={setPtzCamera}
                        onFocus={setFocusedCamera}
                        onBlur={() => setFocusedCamera(null)}
                      />
                    </div>
                  ) : (
                    <div className="h-full border-2 border-dashed border-glass-border rounded-lg flex items-center justify-center">
                      <span className="text-text-muted text-sm">Sin camara principal</span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 overflow-x-auto" style={{ gap: LMAIN_GAP, height: M_THUMB_HEIGHT }}>
                  {otherCams.length > 0 && (
                    <SortableContext items={otherCams.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                      {otherCams.map(cam => (
                        <SortableCameraTile
                          key={cam.id}
                          cam={cam}
                          camNumber={camNum(cam.id)}
                          wsUrl={mjpegUrl(cam.id)}
                          watchdog={watchdogMap.get(cam.id) ?? null}
                          mjpeg={mjpegMap.get(cam.id) ?? null}
                          viewMode="lmain"
                          isMain={false}
                          onOpenPtz={setPtzCamera}
                          onFocus={setFocusedCamera}
                          onBlur={() => setFocusedCamera(null)}
                          onClick={() => handleColumnClick(cam.id)}
                          tileHeight={M_THUMB_HEIGHT}
                          compact
                          thumbWidth={M_THUMB_WIDTH}
                        />
                      ))}
                    </SortableContext>
                  )}
                </div>
              </div>
            ) : (
            <div ref={lmainRef} className="flex-1 flex flex-col min-h-0" style={{ gap: LMAIN_GAP }}>
              <div className="flex flex-1 min-h-0" style={{ gap: LMAIN_GAP }}>
                <div className="shrink-0 flex flex-col" style={{ width: LEFT_WIDTH, gap: LMAIN_GAP }}>
                  {leftCams.length > 0 && (
                    <SortableContext items={leftCams.map(c => c.id)} strategy={verticalListSortingStrategy}>
                      {leftCams.map(cam => (
                        <SortableCameraTile
                          key={cam.id}
                          cam={cam}
                          camNumber={camNum(cam.id)}
                          wsUrl={mjpegUrl(cam.id)}
                          watchdog={watchdogMap.get(cam.id) ?? null}
                          mjpeg={mjpegMap.get(cam.id) ?? null}
                          viewMode="lmain"
                          isMain={false}
                          onOpenPtz={setPtzCamera}
                          onFocus={setFocusedCamera}
                          onBlur={() => setFocusedCamera(null)}
                          onClick={() => handleColumnClick(cam.id)}
                          compact
                        />
                      ))}
                    </SortableContext>
                  )}
                  {Array.from({ length: leftEmptyCount }).map((_, i) => (
                    <div key={`left-empty-${i}`} className="flex-1 border border-dashed border-glass-border/60 rounded-sm flex items-center justify-center bg-void/40 hover:border-accent/40 transition-colors">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Slot {camNum(mainCam?.id ?? '') === 0 ? i + 1 : leftCams.length + i + 1}</span>
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-w-0 h-full">
                  {mainCam ? (
                    <div className="h-full ring-1 ring-accent/20 rounded-lg overflow-hidden">
                      <SortableCameraTile
                        cam={mainCam}
                        camNumber={camNum(mainCam.id)}
                        wsUrl={mjpegUrl(mainCam.id)}
                        watchdog={watchdogMap.get(mainCam.id) ?? null}
                        mjpeg={mjpegMap.get(mainCam.id) ?? null}
                        viewMode="lmain"
                        isMain={true}
                        onOpenPtz={setPtzCamera}
                        onFocus={setFocusedCamera}
                        onBlur={() => setFocusedCamera(null)}
                      />
                    </div>
                  ) : (
                    <div className="h-full border border-dashed border-glass-border/60 rounded-sm flex items-center justify-center bg-void/40 hover:border-accent/40 transition-colors">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Sin camara principal</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 overflow-x-auto" style={{ gap: LMAIN_GAP, height: THUMB_HEIGHT }}>
                {bottomCams.length > 0 && (
                  <SortableContext items={bottomCams.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                    {bottomCams.map(cam => (
                      <SortableCameraTile
                        key={cam.id}
                        cam={cam}
                        camNumber={camNum(cam.id)}
                        wsUrl={mjpegUrl(cam.id)}
                        watchdog={watchdogMap.get(cam.id) ?? null}
                        mjpeg={mjpegMap.get(cam.id) ?? null}
                        viewMode="lmain"
                        isMain={false}
                        onOpenPtz={setPtzCamera}
                        onFocus={setFocusedCamera}
                        onBlur={() => setFocusedCamera(null)}
                        onClick={() => handleColumnClick(cam.id)}
                        tileHeight={THUMB_HEIGHT}
                        compact
                        thumbWidth={LEFT_WIDTH}
                      />
                    ))}
                  </SortableContext>
                )}
                {bottomCams.length === 0 && (
                  <>
                    <div className="border border-dashed border-glass-border/60 rounded-sm flex items-center justify-center bg-void/40 hover:border-accent/40 transition-colors" style={{ width: LEFT_WIDTH, minWidth: LEFT_WIDTH }}>
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Slot {leftCams.length + 1}</span>
                    </div>
                    <div className="flex-1 border border-dashed border-glass-border/60 rounded-sm flex items-center justify-center bg-void/40 hover:border-accent/40 transition-colors">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Slot {leftCams.length + 2}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            )}
          </DndContext>
        </motion.div>
        )}
      </div>

      {ptzCamera !== null && (
        <PTZPanel cameraId={ptzCamera} cameraName={cameras.find(c => c.id === ptzCamera)?.name ?? ''} onClose={() => setPtzCamera(null)} />
      )}
      {sweepCameraIds.map(id => (
        <SweepLauncher key={id} cameraId={id} active={sweepActive} />
      ))}
    </div>
  );
}
