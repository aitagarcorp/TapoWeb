import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Settings, Video, Film,
  PanelLeftClose, PanelLeftOpen, Camera, Truck, Users, ChevronDown, ChevronRight,
} from 'lucide-react';
import logo from '../assets/LOGO_AGAR_SVG_FONDOBLANCO.svg';
import { useUIStore } from '../lib/store';

interface Props {
  page: string;
  onNavigate: (page: string) => void;
  role: string;
}

export function Sidebar({ page, onNavigate, role }: Props) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUIStore((s) => s.toggleSidebar);

  const isConfigActive = page === 'config' || page.startsWith('config:');
  const [configOpen, setConfigOpen] = useState(isConfigActive);

  useEffect(() => {
    if (isConfigActive) {
      setConfigOpen(true);
    }
  }, [isConfigActive]);

  const mainItems = [
    { id: 'dashboard', label: 'En Vivo', icon: LayoutDashboard, roles: ['baseadv', 'traileradv'] },
    { id: 'dvr', label: 'DVR', icon: Video, roles: ['baseadv'] },
    { id: 'recordings', label: 'Grabaciones', icon: Film, roles: ['baseadv'] },
  ].filter(item => item.roles.includes(role));

  const configSubItems = [
    { id: 'config:cameras', label: 'Camaras', icon: Camera },
    { id: 'config:trailer', label: 'Trailer', icon: Truck },
    { id: 'config:users', label: 'Usuarios', icon: Users },
  ];

  const handleConfigClick = () => {
    if (!isConfigActive) {
      setConfigOpen(true);
      onNavigate('config:cameras');
    } else {
      setConfigOpen((prev) => !prev);
    }
  };

  return (
    <aside
      className={`h-full bg-[#07101b] border-r border-[#1c2c40] flex flex-col shrink-0 transition-[width] duration-200 ${
        collapsed ? 'w-14' : 'w-[210px] lg:w-[250px] xl:w-[300px]'
      }`}
    >
      {collapsed ? (
        <div className="h-16 flex items-center justify-center border-b border-[#1d2d42] px-1.5">
          <img src={logo} alt="AGARCORP" className="w-10 h-10 object-contain" />
        </div>
      ) : (
        <div className="h-[208px] flex flex-col items-center justify-center border-b border-[#1d2d42] px-4">
          <img
            src={logo}
            alt="AGARCORP"
            className="w-32 h-auto max-h-[112px] object-contain mb-3"
          />
          <div className="text-center font-sans font-bold text-[19px] leading-[25px] text-white">
            AGARCORP<br />
            DE VENEZUELA
          </div>
        </div>
      )}

      <nav className="w-full flex-1 flex flex-col overflow-y-auto">
        {mainItems.map(item => {
          const active = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              className={`h-[55px] w-full border-b border-[#19283b] flex items-center transition-colors duration-200 cursor-pointer shrink-0 ${
                collapsed ? 'justify-center px-0' : 'px-[14px] gap-[14px]'
              } ${
                active
                  ? 'bg-[#17439b] text-white'
                  : 'text-[#8da6c4] hover:bg-[#101d30] hover:text-white'
              }`}
            >
              <span className="w-[28px] flex items-center justify-center shrink-0">
                <item.icon size={24} />
              </span>
              {!collapsed && (
                <span className="font-sans text-[21px] font-bold truncate">
                  {item.label}
                </span>
              )}
            </button>
          );
        })}

        {role === 'baseadv' && (
          <div className="flex flex-col border-b border-[#19283b]">
            <button
              onClick={handleConfigClick}
              title={collapsed ? 'Configuracion' : undefined}
              className={`h-[55px] w-full flex items-center transition-colors duration-200 cursor-pointer shrink-0 ${
                collapsed ? 'justify-center px-0' : 'px-[14px] gap-[14px]'
              } ${
                isConfigActive
                  ? 'bg-[#112c63] text-white'
                  : 'text-[#8da6c4] hover:bg-[#101d30] hover:text-white'
              }`}
            >
              <span className="w-[28px] flex items-center justify-center shrink-0">
                <Settings size={24} />
              </span>
              {!collapsed && (
                <>
                  <span className="font-sans text-[21px] font-bold truncate flex-1 text-left">
                    Configuracion
                  </span>
                  <span className="text-[#8da6c4] shrink-0">
                    {configOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </span>
                </>
              )}
            </button>

            {configOpen && (
              <div className="bg-[#040a12] border-t border-[#152336] flex flex-col">
                {configSubItems.map((sub) => {
                  const subActive =
                    page === sub.id || (page === 'config' && sub.id === 'config:cameras');
                  return (
                    <button
                      key={sub.id}
                      onClick={() => onNavigate(sub.id)}
                      title={collapsed ? `Configuracion - ${sub.label}` : undefined}
                      className={`h-[44px] w-full border-b border-[#111e2e] last:border-b-0 flex items-center transition-colors duration-150 cursor-pointer ${
                        collapsed
                          ? 'justify-center px-0'
                          : 'pl-[36px] pr-[14px] gap-3'
                      } ${
                        subActive
                          ? 'bg-[#17439b] text-white border-l-[3px] border-l-[#4ea0ff]'
                          : 'text-[#7d97b8] hover:bg-[#0d1929] hover:text-white'
                      }`}
                    >
                      <span className="w-[22px] flex items-center justify-center shrink-0">
                        <sub.icon size={18} />
                      </span>
                      {!collapsed && (
                        <span className="font-sans text-[16px] font-bold truncate">
                          {sub.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="border-t border-[#19283b] p-2 flex flex-col gap-1">
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expandir menu' : 'Colapsar menu'}
          className={`flex items-center gap-3 rounded-[4px] border border-[#19283b] text-[#8da6c4] hover:bg-[#101d30] hover:text-white transition-colors ${
            collapsed ? 'justify-center px-0 py-3' : 'px-3 py-2.5'
          }`}
        >
          {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          {!collapsed && <span className="font-sans text-sm font-bold">Colapsar</span>}
        </button>
      </div>
    </aside>
  );
}
