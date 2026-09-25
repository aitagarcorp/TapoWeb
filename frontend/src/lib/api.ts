import { getToken } from './auth';

const API = '';

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (opts?.body && typeof opts.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API}${url}`, {
    headers,
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface Camera {
  id: string;
  name: string;
  ip: string;
  user: string;
  password: string;
  cloud_password: string;
  enabled: boolean;
  model: string;
  motion_detection?: boolean;
}

export interface WatchdogStatus {
  camera_id: string;
  kind: string;
  active: boolean;
  pid: number | null;
  healthy: boolean;
  recovering: boolean;
  black_detected: boolean;
  consecutive_failures: number;
  last_error: string;
}

export interface MjpegStatus {
  camera_id: string;
  active: boolean;
  subscribers: number;
  pid: number | null;
  has_signal: boolean;
  reconnecting: boolean;
  last_frame_age_sec: number | null;
}

export interface Preset {
  token: string;
  name: string;
}

export interface Recording {
  filename: string;
  size: number;
  modified: number;
  camera_id?: string | null;
  date?: string | null;
  hour?: number | null;
  type?: 'dvr' | 'manual';
}

export interface Snapshot {
  filename: string;
  size: number;
  modified: number;
}

export interface CalendarDay {
  date: string;
  count: number;
  total_size: number;
  hours: number[];
}

export interface HourSegment {
  hour: number;
  filename: string;
  size: number;
  modified: number;
  playable?: boolean;
  in_progress?: boolean;
}

export interface Settings {
  grid_size: number;
  theme: string;
  view_mode: string;
  main_camera: string;
  recording_retention_days?: number;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ access_token: string; token_type: string; expires_in: number; user: { username: string; role: string; allowed_camera_ids: string[] } }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  getMe: () => request<{ username: string; role: string; allowed_camera_ids: string[] }>('/api/auth/me'),
  getTrailerCameras: () => request<{ allowed_camera_ids: string[] }>('/api/auth/trailer-cameras'),
  setTrailerCameras: (ids: string[]) => request<{ success: boolean; allowed_camera_ids: string[] }>('/api/auth/trailer-cameras', { method: 'PUT', body: JSON.stringify({ allowed_camera_ids: ids }) }),

  getCameras: () => request<Camera[]>('/api/cameras'),
  addCamera: (cam: Partial<Camera>) => request<{ cameras: Camera[] }>('/api/cameras', { method: 'POST', body: JSON.stringify(cam) }),
  updateCamera: (id: string, cam: Partial<Camera>) => request<{ cameras: Camera[] }>(`/api/cameras/${id}`, { method: 'PUT', body: JSON.stringify(cam) }),
  deleteCamera: (id: string) => request<{ cameras: Camera[] }>(`/api/cameras/${id}`, { method: 'DELETE' }),
  reorderCameras: (from: number, to: number) => request<{ cameras: Camera[] }>('/api/cameras/reorder', { method: 'PUT', body: JSON.stringify({ from_index: from, to_index: to }) }),
  getSettings: () => request<{ grid_size: number; theme: string; view_mode: string; main_camera: string }>('/api/cameras/settings'),
  updateSettings: (s: { grid_size?: number; theme?: string; view_mode?: string; main_camera?: string }) => request<{ grid_size: number; theme: string; view_mode: string; main_camera: string }>('/api/cameras/settings', { method: 'PUT', body: JSON.stringify(s) }),

  startStream: (id: string) => request(`/api/stream/${id}/start`, { method: 'POST' }),
  stopStream: (id: string) => request(`/api/stream/${id}/stop`, { method: 'POST' }),
  streamStatus: () => request<{ camera_id: string; active: boolean; pid: number | null }[]>('/api/stream/status'),

  connectPtz: (id: string) => request(`/api/ptz/${id}/connect`, { method: 'POST' }),
  ptzCommand: (id: string, cmd: Record<string, unknown>) => request(`/api/ptz/${id}/command`, { method: 'POST', body: JSON.stringify(cmd) }),
  getPresets: (id: string) => request<Preset[]>(`/api/ptz/${id}/presets`),
  ptzStatus: (id: string) => request<{ connected: boolean; led: string }>(`/api/ptz/${id}/status`),

  getRecordings: () => request<Recording[]>('/api/recordings'),
  startRecording: (id: string) => request(`/api/recordings/${id}/start`, { method: 'POST' }),
  stopRecording: (id: string) => request(`/api/recordings/${id}/stop`, { method: 'POST' }),
  recordingStatus: (id: string) => request<{ recording: boolean }>(`/api/recordings/${id}/status`),

  getDvrCalendar: (cameraId: string) => request<CalendarDay[]>(`/api/recordings/calendar/${cameraId}`),
  getDvrHours: (cameraId: string, date: string) => request<HourSegment[]>(`/api/recordings/hours/${cameraId}/${date}`),
  cleanupDvr: () => request<{ success: boolean; deleted: number; freed_bytes: number }>(`/api/recordings/cleanup`, { method: 'POST' }),

  recordingStreamUrl: (filename: string) => `/api/recordings/stream/${filename}?token=${getToken() ?? ''}`,
  prepareRecording: (filename: string) => request<{ ready: boolean; prepared_filename: string }>(`/api/recordings/prepare/${filename}`, { method: 'POST' }),

  checkRecording: (filename: string) => request<{ playable: boolean; reason: string }>(`/api/recordings/check/${filename}`),

  getSnapshots: () => request<Snapshot[]>('/api/snapshots'),
  takeSnapshot: (id: string) => request(`/api/snapshots/${id}`, { method: 'POST' }),

  health: () => request<{ status: string; streams: { camera_id: string; active: boolean; pid: number | null }[]; watchdog: WatchdogStatus[]; mjpeg: MjpegStatus[] }>('/api/health'),
};
