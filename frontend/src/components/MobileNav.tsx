import { useState } from 'react';
import { LayoutDashboard, Settings, Sun, Moon, Video, Film, LogOut, Camera, Truck, Users } from 'lucide-react';

interface Props {
  page: string;
  onNavigate: (page: string) => void;
  theme: string;
  onToggleTheme: () => void;
  role: string;
  onLogout: () => void;
}

export function MobileNav({ page, onNavigate, theme, onToggleTheme, role, onLogout }: Props) {
  const [configMenuOpen, setConfigMenuOpen] = useState(false);
  const isConfigActive = page === 'config' || page.startsWith('config:');

  const mainItems = [
    { id: 'dashboard', label: 'En Vivo', icon: LayoutDashboard, roles: ['baseadv', 'traileradv'] },
    { id: 'dvr', label: 'DVR', icon: Video, roles: ['baseadv'] },
    { id: 'recordings', label: 'Archivo', icon: Film, roles: ['baseadv'] },
  ].filter(item => item.roles.includes(role));

  const configSubItems = [
    { id: 'config:cameras', label: 'Camaras', icon: Camera },
    { id: 'config:trailer', label: 'Trailer', icon: Truck },
    { id: 'config:users', label: 'Usuarios', icon: Users },
  ];

  return (
    <div className="shrink-0 relative">
      {role === 'baseadv' && configMenuOpen && (
        <div className="absolute bottom-full left-0 right-0 bg-[#07101b] border-t border-[#1c2c40] flex divide-x divide-[#19283b] z-40">
          {configSubItems.map((sub) => {
            const subActive = page === sub.id || (page === 'config' && sub.id === 'config:cameras');
            return (
              <button
                key={sub.id}
                onClick={() => {
                  onNavigate(sub.id);
                  setConfigMenuOpen(false);
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-3 font-mono text-xs font-bold uppercase ${
                  subActive ? 'bg-[#17439b] text-white' : 'text-[#8da6c4] hover:text-white'
                }`}
              >
                <sub.icon size={16} />
                <span>{sub.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <nav
        className="bg-sidebar-bg border-t border-glass-border flex items-stretch"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {mainItems.map(item => (
          <button
            key={item.id}
            onClick={() => {
              setConfigMenuOpen(false);
              onNavigate(item.id);
            }}
            className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-3 transition-all border-t-2 ${
              page === item.id
                ? 'text-accent border-accent bg-accent-bg/40'
                : 'text-text-secondary border-transparent'
            }`}
          >
            <item.icon size={22} />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em]">{item.label}</span>
          </button>
        ))}

        {role === 'baseadv' && (
          <button
            onClick={() => setConfigMenuOpen((prev) => !prev)}
            className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-3 transition-all border-t-2 ${
              isConfigActive || configMenuOpen
                ? 'text-accent border-accent bg-accent-bg/40'
                : 'text-text-secondary border-transparent'
            }`}
          >
            <Settings size={22} />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Config</span>
          </button>
        )}

        <button
          onClick={onToggleTheme}
          className="flex-1 flex flex-col items-center justify-center gap-1.5 py-3 text-text-secondary border-t-2 border-transparent transition-colors"
        >
          {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Tema</span>
        </button>
        <button
          onClick={onLogout}
          className="flex-1 flex flex-col items-center justify-center gap-1.5 py-3 text-danger border-t-2 border-transparent transition-colors"
        >
          <LogOut size={22} />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Salir</span>
        </button>
      </nav>
    </div>
  );
}
