import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Edit3, Trash2, Save, X, Camera as CameraIcon,
  Eye, EyeOff, Users, Shield, Truck, KeyRound, CheckSquare, Square, Power,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Camera, UserAccount } from '../lib/api';
import { getUser } from '../lib/auth';
import { EmptyState } from '../components/EmptyState';

export type ConfigSection = 'cameras' | 'trailer' | 'users';

interface Props {
  section?: ConfigSection;
}

interface UserFormState {
  originalUsername: string | null;
  username: string;
  password: string;
  role: 'baseadv' | 'traileradv';
  allowed_camera_ids: string[];
}

export function Config({ section = 'cameras' }: Props) {
  const currentUser = getUser();

  const [cameras, setCameras] = useState<Camera[]>([]);
  const [editingCam, setEditingCam] = useState<string | null>(null);
  const [showCamModal, setShowCamModal] = useState(false);
  const [showCamPassword, setShowCamPassword] = useState(false);
  const [camForm, setCamForm] = useState<Partial<Camera>>({
    name: '',
    ip: '',
    user: '',
    password: '',
    model: '',
    enabled: true,
  });

  const [trailerCams, setTrailerCams] = useState<Set<string>>(new Set());
  const [savingTrailer, setSavingTrailer] = useState(false);

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>({
    originalUsername: null,
    username: '',
    password: '',
    role: 'traileradv',
    allowed_camera_ids: [],
  });

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const cams = await api.getCameras();
      setCameras(cams);
    } catch {}
    try {
      const res = await api.getTrailerCameras();
      setTrailerCams(new Set(res.allowed_camera_ids));
    } catch {}
    try {
      const usrList = await api.getUsers();
      setUsers(usrList);
    } catch {}
  }, []);

  useEffect(() => {
    load();
  }, [load, section]);

  const openAddCamera = () => {
    setCamForm({ name: '', ip: '', user: '', password: '', model: 'c500', enabled: true });
    setEditingCam(null);
    setShowCamPassword(false);
    setShowCamModal(true);
  };

  const openEditCamera = (cam: Camera) => {
    setCamForm({ ...cam });
    setEditingCam(cam.id);
    setShowCamPassword(false);
    setShowCamModal(true);
  };

  const handleSaveCamera = async () => {
    const ip = (camForm.ip || '').trim();
    if (!ip) {
      notify('err', 'La direccion IP de la camara es obligatoria');
      return;
    }
    try {
      if (editingCam !== null) {
        await api.updateCamera(editingCam, camForm);
        notify('ok', `Camara "${camForm.name || ip}" actualizada`);
      } else {
        await api.addCamera(camForm);
        notify('ok', `Camara "${camForm.name || ip}" agregada`);
      }
      setShowCamModal(false);
      setEditingCam(null);
      load();
    } catch (e) {
      notify('err', e instanceof Error ? e.message : 'Error al guardar camara');
    }
  };

  const handleToggleCameraEnabled = async (cam: Camera) => {
    const nextEnabled = cam.enabled === false;
    try {
      await api.updateCamera(cam.id, { ...cam, enabled: nextEnabled });
      notify('ok', `Camara "${cam.name}" ${nextEnabled ? 'activada' : 'desactivada'}`);
      load();
    } catch (e) {
      notify('err', e instanceof Error ? e.message : 'Error al actualizar estado');
    }
  };

  const handleDeleteCamera = async (cam: Camera) => {
    if (!confirm(`¿Eliminar la camara "${cam.name}" (${cam.ip})?`)) return;
    try {
      await api.deleteCamera(cam.id);
      notify('ok', `Camara "${cam.name}" eliminada`);
      load();
    } catch (e) {
      notify('err', e instanceof Error ? e.message : 'Error al eliminar camara');
    }
  };

  const saveTrailerSelection = async (nextIds: string[]) => {
    setSavingTrailer(true);
    try {
      await api.setTrailerCameras(nextIds);
      setTrailerCams(new Set(nextIds));
      const usrList = await api.getUsers();
      setUsers(usrList);
      notify('ok', `Permisos de Trailer actualizados (${nextIds.length} camaras)`);
    } catch (e) {
      notify('err', e instanceof Error ? e.message : 'Error al actualizar Trailer');
    } finally {
      setSavingTrailer(false);
    }
  };

  const toggleTrailerCam = (camId: string) => {
    const next = trailerCams.has(camId)
      ? [...trailerCams].filter((id) => id !== camId)
      : [...trailerCams, camId];
    saveTrailerSelection(next);
  };

  const selectAllTrailerCams = () => {
    saveTrailerSelection(cameras.map((c) => c.id));
  };

  const clearAllTrailerCams = () => {
    saveTrailerSelection([]);
  };

  const openAddUser = () => {
    setUserForm({
      originalUsername: null,
      username: '',
      password: '',
      role: 'traileradv',
      allowed_camera_ids: [...trailerCams],
    });
    setShowUserPassword(false);
    setShowUserModal(true);
  };

  const openEditUser = (u: UserAccount) => {
    setUserForm({
      originalUsername: u.username,
      username: u.username,
      password: '',
      role: u.role === 'baseadv' ? 'baseadv' : 'traileradv',
      allowed_camera_ids: [...(u.allowed_camera_ids || [])],
    });
    setShowUserPassword(false);
    setShowUserModal(true);
  };

  const toggleUserAllowedCam = (camId: string) => {
    setUserForm((prev) => {
      const exists = prev.allowed_camera_ids.includes(camId);
      const next = exists
        ? prev.allowed_camera_ids.filter((id) => id !== camId)
        : [...prev.allowed_camera_ids, camId];
      return { ...prev, allowed_camera_ids: next };
    });
  };

  const handleSaveUser = async () => {
    const username = userForm.username.trim();
    if (!username) {
      notify('err', 'El nombre de usuario es obligatorio');
      return;
    }
    try {
      if (userForm.originalUsername === null) {
        if (!userForm.password || userForm.password.length < 4) {
          notify('err', 'La contrasena debe tener al menos 4 caracteres');
          return;
        }
        await api.addUser({
          username,
          password: userForm.password,
          role: userForm.role,
          allowed_camera_ids: userForm.role === 'traileradv' ? userForm.allowed_camera_ids : [],
        });
        notify('ok', `Usuario "${username}" creado correctamente`);
      } else {
        await api.updateUser(userForm.originalUsername, {
          username,
          password: userForm.password ? userForm.password : undefined,
          role: userForm.role,
          allowed_camera_ids: userForm.role === 'traileradv' ? userForm.allowed_camera_ids : [],
        });
        notify('ok', `Usuario "${username}" actualizado`);
      }
      setShowUserModal(false);
      load();
    } catch (e) {
      notify('err', e instanceof Error ? e.message : 'Error al guardar usuario');
    }
  };

  const handleDeleteUser = async (u: UserAccount) => {
    if (u.username === currentUser?.username) {
      notify('err', 'No puedes eliminar tu propio usuario en sesion');
      return;
    }
    if (!confirm(`¿Eliminar al usuario "${u.username}"?`)) return;
    try {
      await api.deleteUser(u.username);
      notify('ok', `Usuario "${u.username}" eliminado`);
      load();
    } catch (e) {
      notify('err', e instanceof Error ? e.message : 'Error al eliminar usuario');
    }
  };

  const inputClass =
    'w-full bg-[#050c16] border border-[#24364c] rounded-[5px] px-3 py-2.5 text-sm font-mono text-[#e8eef7] placeholder-[#587291] focus:border-[#287ff1] focus:outline-none';

  const activeCamerasCount = cameras.filter((c) => c.enabled !== false).length;
  const trailerUsers = users.filter((u) => u.role === 'traileradv');
  const adminUsers = users.filter((u) => u.role === 'baseadv');

  return (
    <div className="h-full flex flex-col bg-[#050a12] overflow-y-auto">
      <div className="h-[55px] shrink-0 flex items-center justify-between px-[16px] border-b border-[#17273a] gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="bg-[#064a93] text-white px-[6px] py-[2px] text-[12px] font-mono font-bold">
            CFG
          </span>
          <h1 className="text-[17px] md:text-[19px] font-bold font-mono uppercase tracking-[2px] text-[#e8eef7]">
            {section === 'cameras' && 'CONFIGURACION / CAMARAS'}
            {section === 'trailer' && 'CONFIGURACION / TRAILER'}
            {section === 'users' && 'CONFIGURACION / USUARIOS'}
          </h1>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-[#8da1ba]">
          {section === 'cameras' && (
            <>
              <span className="px-2.5 py-1 rounded-[4px] bg-[#07121f] border border-[#1d3148]">
                TOTAL: <strong className="text-white">{cameras.length}</strong>
              </span>
              <span className="px-2.5 py-1 rounded-[4px] bg-[#07121f] border border-[#1d3148]">
                ACTIVAS: <strong className="text-[#20d67a]">{activeCamerasCount}</strong>
              </span>
              <button
                onClick={openAddCamera}
                className="flex items-center gap-1.5 bg-[#17439b] hover:bg-[#1e56c2] border border-[#3b82f6] text-white px-3.5 py-1.5 rounded-[5px] font-mono text-xs font-bold uppercase tracking-[1px] transition-colors cursor-pointer"
              >
                <Plus size={15} /> Agregar Camara
              </button>
            </>
          )}

          {section === 'trailer' && (
            <>
              <span className="px-2.5 py-1 rounded-[4px] bg-[#07121f] border border-[#1d3148]">
                HABILITADAS: <strong className="text-[#328cff]">{trailerCams.size}/{cameras.length}</strong>
              </span>
              <span className="px-2.5 py-1 rounded-[4px] bg-[#07121f] border border-[#1d3148]">
                CUENTAS TRAILER: <strong className="text-white">{trailerUsers.length}</strong>
              </span>
            </>
          )}

          {section === 'users' && (
            <>
              <span className="px-2.5 py-1 rounded-[4px] bg-[#07121f] border border-[#1d3148]">
                ADMINS: <strong className="text-[#328cff]">{adminUsers.length}</strong>
              </span>
              <span className="px-2.5 py-1 rounded-[4px] bg-[#07121f] border border-[#1d3148]">
                TRAILER: <strong className="text-[#20d67a]">{trailerUsers.length}</strong>
              </span>
              <button
                onClick={openAddUser}
                className="flex items-center gap-1.5 bg-[#17439b] hover:bg-[#1e56c2] border border-[#3b82f6] text-white px-3.5 py-1.5 rounded-[5px] font-mono text-xs font-bold uppercase tracking-[1px] transition-colors cursor-pointer"
              >
                <Plus size={15} /> Nuevo Usuario
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`mx-4 mt-3 px-4 py-2.5 rounded-[5px] border font-mono text-xs flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-[#0b291e] border-[#1f6f4f] text-[#5ce0a0]'
              : 'bg-[#2c1016] border-[#8c2633] text-[#ff8080]'
          }`}
        >
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="text-current opacity-75 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="p-4 flex-1">
        {section === 'cameras' && (
          <section className="bg-[#07111e] border border-[#17283c] rounded-[6px] overflow-hidden">
            <div className="px-4 py-3 bg-[#091728] border-b border-[#17283c] flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <CameraIcon size={18} className="text-[#328cff]" />
                <div>
                  <h2 className="font-mono text-sm font-bold uppercase tracking-[1.5px] text-white">
                    1. Camaras del Sistema
                  </h2>
                  <p className="font-sans text-xs text-[#7d97b8]">
                    Administra direcciones IP, credenciales RTSP/ONVIF, modelos y estado de cada camara.
                  </p>
                </div>
              </div>
              <button
                onClick={openAddCamera}
                className="flex items-center gap-1.5 bg-[#17439b] hover:bg-[#1e56c2] border border-[#3b82f6] text-white px-3.5 py-2 rounded-[5px] font-mono text-xs font-bold uppercase tracking-[1px] transition-colors cursor-pointer"
              >
                <Plus size={15} /> Agregar Camara
              </button>
            </div>

            {cameras.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={CameraIcon}
                  title="Sin camaras configuradas"
                  subtitle="Agrega tu primera camara usando el boton 'Agregar Camara'."
                />
              </div>
            ) : (
              <div className="divide-y divide-[#142336]">
                {cameras.map((cam, i) => {
                  const isEnabled = cam.enabled !== false;
                  const inTrailer = trailerCams.has(cam.id);
                  return (
                    <div
                      key={cam.id}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-[#0c1b2e] transition-colors flex-wrap sm:flex-nowrap"
                    >
                      <span className="px-2.5 py-1 bg-[#050b14] border border-[#24364c] rounded-[4px] font-mono text-[11px] font-bold text-[#9ab4d4] tracking-[1px] shrink-0">
                        CAM {String(i + 1).padStart(2, '0')}
                      </span>

                      <div className="flex-1 min-w-[180px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-mono font-bold text-white truncate">{cam.name}</h3>
                          <span
                            className={`px-2 py-0.5 rounded-[3px] font-mono text-[10px] font-bold uppercase ${
                              isEnabled
                                ? 'bg-[#0c2d20] border border-[#1b6848] text-[#35dc8a]'
                                : 'bg-[#2c1216] border border-[#7c2430] text-[#ff6464]'
                            }`}
                          >
                            {isEnabled ? 'ACTIVA' : 'OFF'}
                          </span>
                          {inTrailer && (
                            <span className="px-2 py-0.5 rounded-[3px] bg-[#0f294d] border border-[#25589c] font-mono text-[10px] font-bold text-[#6db1ff] uppercase">
                              TRAILER
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 font-mono text-xs text-[#7d97b8] flex-wrap">
                          <span>IP: <strong className="text-[#c8d9ed]">{cam.ip}</strong></span>
                          <span>&middot;</span>
                          <span>Usuario: <strong className="text-[#c8d9ed]">{cam.user || '—'}</strong></span>
                          <span>&middot;</span>
                          <span>Modelo: <strong className="text-[#c8d9ed] uppercase">{cam.model || 'Tapo'}</strong></span>
                          <span>&middot;</span>
                          <span className="text-[#567091]">ID: {cam.id}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                        <button
                          onClick={() => handleToggleCameraEnabled(cam)}
                          className={`px-2.5 py-1.5 rounded-[4px] border font-mono text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                            isEnabled
                              ? 'bg-[#09192b] border-[#243b56] text-[#9ab4d4] hover:border-[#ff6464] hover:text-[#ff6464]'
                              : 'bg-[#0c2d20] border-[#1b6848] text-[#35dc8a] hover:bg-[#12402e]'
                          }`}
                          title={isEnabled ? 'Desactivar camara' : 'Activar camara'}
                        >
                          <Power size={13} />
                          <span className="hidden md:inline">{isEnabled ? 'Desactivar' : 'Activar'}</span>
                        </button>
                        <button
                          onClick={() => openEditCamera(cam)}
                          className="px-2.5 py-1.5 bg-[#09192b] hover:bg-[#132c4a] border border-[#243b56] hover:border-[#3b82f6] rounded-[4px] text-[#c8d9ed] hover:text-white font-mono text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                          title="Editar camara"
                        >
                          <Edit3 size={13} />
                          <span className="hidden md:inline">Editar</span>
                        </button>
                        <button
                          onClick={() => handleDeleteCamera(cam)}
                          className="p-1.5 bg-[#1b0d12] hover:bg-[#33131b] border border-[#561c26] hover:border-[#ff4545] rounded-[4px] text-[#ff6464] transition-colors cursor-pointer"
                          title="Eliminar camara"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {section === 'trailer' && (
          <section className="bg-[#07111e] border border-[#17283c] rounded-[6px] overflow-hidden">
            <div className="px-4 py-3 bg-[#091728] border-b border-[#17283c] flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <Truck size={18} className="text-[#328cff]" />
                <div>
                  <h2 className="font-mono text-sm font-bold uppercase tracking-[1.5px] text-white">
                    2. Configuracion del Trailer
                  </h2>
                  <p className="font-sans text-xs text-[#7d97b8]">
                    Selecciona las camaras que tendran habilitadas los operadores con perfil Trailer ({trailerCams.size} de {cameras.length} habilitadas).
                  </p>
                </div>
              </div>

              {cameras.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={selectAllTrailerCams}
                    disabled={savingTrailer}
                    className="px-3 py-1.5 rounded-[4px] bg-[#0c223d] hover:bg-[#15355e] border border-[#29548a] font-mono text-xs text-[#9ec8ff] hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <CheckSquare size={13} /> Seleccionar todas
                  </button>
                  <button
                    onClick={clearAllTrailerCams}
                    disabled={savingTrailer}
                    className="px-3 py-1.5 rounded-[4px] bg-[#091626] hover:bg-[#132640] border border-[#1f344d] font-mono text-xs text-[#8da6c4] hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <Square size={13} /> Ninguna
                  </button>
                </div>
              )}
            </div>

            {cameras.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-[#607b9c]">
                No hay camaras registradas para asignar al Trailer.
              </div>
            ) : (
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {cameras.map((cam, i) => {
                    const allowed = trailerCams.has(cam.id);
                    return (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => toggleTrailerCam(cam.id)}
                        disabled={savingTrailer}
                        className={`p-3 rounded-[6px] border text-left flex items-center gap-3 transition-all cursor-pointer ${
                          allowed
                            ? 'bg-[#0d2342] border-[#287ff1] text-white shadow-[0_0_10px_rgba(40,127,241,0.18)]'
                            : 'bg-[#050c16] border-[#18293e] text-[#6d87a5] hover:border-[#294363] hover:text-[#b8cce4]'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-[4px] flex items-center justify-center border shrink-0 ${
                            allowed
                              ? 'bg-[#287ff1] border-[#5aa2ff] text-white'
                              : 'bg-[#040911] border-[#2a3f5a] text-transparent'
                          }`}
                        >
                          ✓
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#050b14] border border-[#22364f] text-[#8da6c4]">
                              CAM {String(i + 1).padStart(2, '0')}
                            </span>
                            <span className="font-mono text-xs font-bold truncate">{cam.name}</span>
                          </div>
                          <div className="font-mono text-[11px] text-[#6d87a5] mt-0.5">
                            {cam.ip} &middot; {allowed ? 'Visible en Trailer' : 'Oculta en Trailer'}
                          </div>
                        </div>
                        {allowed ? (
                          <Eye size={16} className="text-[#35dc8a] shrink-0" />
                        ) : (
                          <EyeOff size={16} className="text-[#4a627f] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 pt-3 border-t border-[#142336] flex items-center justify-between flex-wrap gap-2 text-xs font-mono text-[#7d97b8]">
                  <div>
                    Cuentas con rol Trailer vinculadas:{' '}
                    {trailerUsers.length > 0 ? (
                      trailerUsers.map((u) => (
                        <span
                          key={u.username}
                          className="inline-block ml-1.5 px-2 py-0.5 rounded bg-[#0c223d] border border-[#234875] text-[#9ec8ff]"
                        >
                          {u.username} ({u.allowed_camera_ids?.length ?? 0} cam)
                        </span>
                      ))
                    ) : (
                      <span className="text-[#ff9c45]">Ningun usuario Trailer creado</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {section === 'users' && (
          <section className="bg-[#07111e] border border-[#17283c] rounded-[6px] overflow-hidden">
            <div className="px-4 py-3 bg-[#091728] border-b border-[#17283c] flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <Users size={18} className="text-[#328cff]" />
                <div>
                  <h2 className="font-mono text-sm font-bold uppercase tracking-[1.5px] text-white">
                    3. Usuarios Existentes y Nuevos
                  </h2>
                  <p className="font-sans text-xs text-[#7d97b8]">
                    Gestiona las cuentas existentes, cambia contrasenas, asigna roles (Administrador o Trailer) y registra nuevos usuarios.
                  </p>
                </div>
              </div>

              <button
                onClick={openAddUser}
                className="flex items-center gap-1.5 bg-[#17439b] hover:bg-[#1e56c2] border border-[#3b82f6] text-white px-3.5 py-2 rounded-[5px] font-mono text-xs font-bold uppercase tracking-[1px] transition-colors cursor-pointer"
              >
                <Plus size={15} /> Nuevo Usuario
              </button>
            </div>

            <div className="divide-y divide-[#142336]">
              {users.map((u) => {
                const isAdmin = u.role === 'baseadv';
                const isSelf = u.username === currentUser?.username;
                const assignedCount = isAdmin ? cameras.length : (u.allowed_camera_ids?.length ?? 0);

                return (
                  <div
                    key={u.username}
                    className="px-4 py-3.5 flex items-center justify-between gap-4 hover:bg-[#0c1b2e] transition-colors flex-wrap"
                  >
                    <div className="flex items-center gap-3 min-w-[220px]">
                      <div
                        className={`w-10 h-10 rounded-[6px] flex items-center justify-center border shrink-0 ${
                          isAdmin
                            ? 'bg-[#0e2952] border-[#2b6cb0] text-[#58a6ff]'
                            : 'bg-[#0d2824] border-[#1f6f5b] text-[#35dc8a]'
                        }`}
                      >
                        {isAdmin ? <Shield size={19} /> : <Truck size={19} />}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-white">{u.username}</span>
                          <span
                            className={`px-2 py-0.5 rounded-[3px] font-mono text-[10px] font-bold uppercase ${
                              isAdmin
                                ? 'bg-[#0e2952] border border-[#318aff] text-[#63b3ed]'
                                : 'bg-[#0d2824] border border-[#289672] text-[#4fd1c5]'
                            }`}
                          >
                            {isAdmin ? 'ADMIN (BASE)' : 'OPERADOR TRAILER'}
                          </span>
                          {isSelf && (
                            <span className="px-2 py-0.5 rounded-[3px] bg-[#1f2937] border border-[#374151] font-mono text-[10px] text-[#9ca3af]">
                              SESION ACTUAL
                            </span>
                          )}
                        </div>

                        <div className="font-mono text-xs text-[#7d97b8] mt-1">
                          {isAdmin ? (
                            <span>Acceso total: Monitor en Vivo, DVR, Grabaciones y Configuracion ({cameras.length} camaras)</span>
                          ) : (
                            <span>
                              Acceso Trailer: Solo Monitor en Vivo &middot;{' '}
                              <strong className="text-[#c8d9ed]">{assignedCount} de {cameras.length} camaras permitidas</strong>
                            </span>
                          )}
                        </div>

                        {!isAdmin && cameras.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap mt-2">
                            {cameras.map((cam, idx) => {
                              const hasCam = u.allowed_camera_ids?.includes(cam.id);
                              return (
                                <span
                                  key={cam.id}
                                  className={`px-2 py-0.5 rounded-[3px] font-mono text-[10px] border ${
                                    hasCam
                                      ? 'bg-[#0c223d] border-[#2b6cb0] text-[#9ec8ff]'
                                      : 'bg-[#050b14] border-[#172638] text-[#455a73] line-through'
                                  }`}
                                >
                                  CAM {String(idx + 1).padStart(2, '0')}: {cam.name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        onClick={() => openEditUser(u)}
                        className="px-3 py-1.5 bg-[#09192b] hover:bg-[#132c4a] border border-[#243b56] hover:border-[#3b82f6] rounded-[4px] text-[#c8d9ed] hover:text-white font-mono text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <KeyRound size={13} />
                        <span>Editar / Clave</span>
                      </button>
                      {!isSelf && (
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1.5 bg-[#1b0d12] hover:bg-[#33131b] border border-[#561c26] hover:border-[#ff4545] rounded-[4px] text-[#ff6464] transition-colors cursor-pointer"
                          title="Eliminar usuario"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {showCamModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowCamModal(false)}
        >
          <div
            className="bg-[#07111e] border border-[#243b56] rounded-[6px] p-5 w-full max-w-[460px] max-h-[90dvh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 border-b border-[#17283c] pb-3">
              <div className="flex items-center gap-2">
                <CameraIcon size={18} className="text-[#328cff]" />
                <h2 className="text-sm font-mono font-bold uppercase tracking-[1.5px] text-white">
                  {editingCam !== null ? 'Editar Camara' : 'Agregar Nueva Camara'}
                </h2>
              </div>
              <button
                onClick={() => setShowCamModal(false)}
                className="p-1.5 hover:bg-[#102238] rounded-[4px] text-[#8da6c4] hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-mono text-[11px] uppercase text-[#8da6c4] mb-1">Nombre de la Camara</label>
                <input
                  placeholder="Ej: Galpon Principal / Entrada"
                  value={camForm.name || ''}
                  onChange={(e) => setCamForm({ ...camForm, name: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-mono text-[11px] uppercase text-[#8da6c4] mb-1">Direccion IP *</label>
                  <input
                    placeholder="192.168.239.x"
                    value={camForm.ip || ''}
                    onChange={(e) => setCamForm({ ...camForm, ip: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block font-mono text-[11px] uppercase text-[#8da6c4] mb-1">Modelo</label>
                  <input
                    placeholder="c500 / c200"
                    value={camForm.model || ''}
                    onChange={(e) => setCamForm({ ...camForm, model: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[11px] uppercase text-[#8da6c4] mb-1">Usuario RTSP/ONVIF</label>
                  <input
                    placeholder="Usuario de camara"
                    value={camForm.user || ''}
                    onChange={(e) => setCamForm({ ...camForm, user: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block font-mono text-[11px] uppercase text-[#8da6c4] mb-1">Contrasena</label>
                  <div className="relative">
                    <input
                      placeholder="Contrasena RTSP"
                      type={showCamPassword ? 'text' : 'password'}
                      value={camForm.password || ''}
                      onChange={(e) => setCamForm({ ...camForm, password: e.target.value })}
                      className={`${inputClass} pr-9`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCamPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6d87a5] hover:text-white"
                    >
                      {showCamPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2.5 pt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={camForm.enabled !== false}
                  onChange={(e) => setCamForm({ ...camForm, enabled: e.target.checked })}
                  className="w-4 h-4 accent-[#287ff1]"
                />
                <span className="font-mono text-xs text-[#c8d9ed]">
                  Camara habilitada (grabacion DVR continua y stream en vivo)
                </span>
              </label>
            </div>

            <div className="flex gap-2 mt-5 pt-3 border-t border-[#17283c]">
              <button
                onClick={handleSaveCamera}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#17439b] hover:bg-[#1e56c2] border border-[#3b82f6] text-white py-2.5 rounded-[5px] font-mono text-xs font-bold uppercase tracking-[1px] transition-colors cursor-pointer"
              >
                <Save size={14} /> {editingCam !== null ? 'Guardar Cambios' : 'Agregar Camara'}
              </button>
              <button
                onClick={() => setShowCamModal(false)}
                className="px-4 py-2.5 bg-[#050c16] border border-[#24364c] rounded-[5px] font-mono text-xs text-[#8da6c4] hover:text-white hover:border-[#3b82f6] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showUserModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowUserModal(false)}
        >
          <div
            className="bg-[#07111e] border border-[#243b56] rounded-[6px] p-5 w-full max-w-[500px] max-h-[90dvh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 border-b border-[#17283c] pb-3">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-[#328cff]" />
                <h2 className="text-sm font-mono font-bold uppercase tracking-[1.5px] text-white">
                  {userForm.originalUsername ? `Editar Usuario: ${userForm.originalUsername}` : 'Crear Nuevo Usuario'}
                </h2>
              </div>
              <button
                onClick={() => setShowUserModal(false)}
                className="p-1.5 hover:bg-[#102238] rounded-[4px] text-[#8da6c4] hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block font-mono text-[11px] uppercase text-[#8da6c4] mb-1">Nombre de Usuario *</label>
                <input
                  placeholder="Ej: operador_trailer2"
                  value={userForm.username}
                  onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase text-[#8da6c4] mb-1">
                  {userForm.originalUsername
                    ? 'Nueva Contrasena (dejar en blanco para mantener la actual)'
                    : 'Contrasena * (minimo 4 caracteres)'}
                </label>
                <div className="relative">
                  <input
                    placeholder={userForm.originalUsername ? '•••••••• (sin cambios)' : 'Contrasena de acceso'}
                    type={showUserPassword ? 'text' : 'password'}
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    className={`${inputClass} pr-9`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowUserPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6d87a5] hover:text-white"
                  >
                    {showUserPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-mono text-[11px] uppercase text-[#8da6c4] mb-1.5">Rol / Nivel de Acceso</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setUserForm({ ...userForm, role: 'baseadv' })}
                    className={`p-3 rounded-[5px] border text-left transition-all cursor-pointer ${
                      userForm.role === 'baseadv'
                        ? 'bg-[#0e2952] border-[#318aff] text-white'
                        : 'bg-[#050c16] border-[#1c2e44] text-[#7d97b8] hover:border-[#2d496b]'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-mono text-xs font-bold">
                      <Shield size={15} className="text-[#328cff]" />
                      <span>Administrador (Base)</span>
                    </div>
                    <p className="font-sans text-[11px] text-[#8da6c4] mt-1">
                      Acceso completo a todas las camaras, DVR, archivo y configuracion.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUserForm({ ...userForm, role: 'traileradv' })}
                    className={`p-3 rounded-[5px] border text-left transition-all cursor-pointer ${
                      userForm.role === 'traileradv'
                        ? 'bg-[#0d2824] border-[#289672] text-white'
                        : 'bg-[#050c16] border-[#1c2e44] text-[#7d97b8] hover:border-[#2d496b]'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-mono text-xs font-bold">
                      <Truck size={15} className="text-[#35dc8a]" />
                      <span>Operador Trailer</span>
                    </div>
                    <p className="font-sans text-[11px] text-[#8da6c4] mt-1">
                      Solo vista en vivo de las camaras autorizadas para este usuario.
                    </p>
                  </button>
                </div>
              </div>

              {userForm.role === 'traileradv' && (
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-mono text-[11px] uppercase text-[#8da6c4]">
                      Camaras permitidas ({userForm.allowed_camera_ids.length}/{cameras.length})
                    </label>
                    <div className="flex gap-2 font-mono text-[11px]">
                      <button
                        type="button"
                        onClick={() => setUserForm((p) => ({ ...p, allowed_camera_ids: cameras.map((c) => c.id) }))}
                        className="text-[#58a6ff] hover:underline cursor-pointer"
                      >
                        Todas
                      </button>
                      <span className="text-[#3a506b]">|</span>
                      <button
                        type="button"
                        onClick={() => setUserForm((p) => ({ ...p, allowed_camera_ids: [] }))}
                        className="text-[#8da6c4] hover:underline cursor-pointer"
                      >
                        Ninguna
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[180px] overflow-y-auto border border-[#1d3148] rounded-[5px] divide-y divide-[#132235] bg-[#050b14]">
                    {cameras.map((cam, idx) => {
                      const checked = userForm.allowed_camera_ids.includes(cam.id);
                      return (
                        <label
                          key={cam.id}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#0b1829] cursor-pointer text-xs font-mono"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUserAllowedCam(cam.id)}
                            className="w-4 h-4 accent-[#287ff1]"
                          />
                          <span className="text-[#7d97b8]">CAM {String(idx + 1).padStart(2, '0')}</span>
                          <span className="text-white font-semibold truncate flex-1">{cam.name}</span>
                          <span className="text-[#587291]">{cam.ip}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5 pt-3 border-t border-[#17283c]">
              <button
                onClick={handleSaveUser}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#17439b] hover:bg-[#1e56c2] border border-[#3b82f6] text-white py-2.5 rounded-[5px] font-mono text-xs font-bold uppercase tracking-[1px] transition-colors cursor-pointer"
              >
                <Save size={14} /> {userForm.originalUsername ? 'Guardar Usuario' : 'Crear Usuario'}
              </button>
              <button
                onClick={() => setShowUserModal(false)}
                className="px-4 py-2.5 bg-[#050c16] border border-[#24364c] rounded-[5px] font-mono text-xs text-[#8da6c4] hover:text-white hover:border-[#3b82f6] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
