import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { TopBar } from './components/layout/TopBar';
import { Dashboard } from './pages/Dashboard';
import { Config } from './pages/Config';
import { Recordings } from './pages/Recordings';
import { Dvr } from './pages/Dvr';
import { Login } from './pages/Login';
import { api } from './lib/api';
import { isAuthenticated, getToken, getUser, subscribe, logout } from './lib/auth';
import { useIsMobile } from './hooks/useIsMobile';
import { useSettingsStore } from './lib/store';

export default function App() {
  const [auth, setAuth] = useState(isAuthenticated);
  const isMobile = useIsMobile();
  const [page, setPage] = useState(() => sessionStorage.getItem('activePage') || 'dashboard');

  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  useEffect(() => {
    return subscribe(() => setAuth(isAuthenticated()));
  }, []);

  useEffect(() => {
    sessionStorage.setItem('activePage', page);
  }, [page]);

  useEffect(() => {
    if (!auth) return;
    api.getSettings().then(s => {
      if (s.theme === 'light' || s.theme === 'dark') {
        setTheme(s.theme);
      }
    }).catch(err => {
      if (err.message?.includes('Token')) logout();
    });
  }, [auth]);

  const handleToggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    toggleTheme();
    api.updateSettings({ theme: next }).catch(() => {});
  }, [theme, toggleTheme]);

  const handleLogin = useCallback(() => {
    setAuth(true);
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    setAuth(false);
  }, []);

  const user = getUser();
  const role = user?.role ?? '';

  if (!auth) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar page={page} theme={theme} onToggleTheme={handleToggleTheme} role={role} onLogout={handleLogout} />
      <div className="flex-1 flex min-h-0">
        {!isMobile && <Sidebar page={page} onNavigate={setPage} role={role} />}
        <div className="flex-1 h-full overflow-hidden flex flex-col min-w-0">
          <div className="flex-1 min-h-0 relative">
            <div className={page === 'dashboard' ? 'h-full' : 'h-full hidden'}>
              <Dashboard />
            </div>
            {(page === 'config' || page === 'config:cameras') && role === 'baseadv' && (
              <Config section="cameras" />
            )}
            {page === 'config:trailer' && role === 'baseadv' && (
              <Config section="trailer" />
            )}
            {page === 'config:users' && role === 'baseadv' && (
              <Config section="users" />
            )}
            {page === 'dvr' && <Dvr />}
            {page === 'recordings' && <Recordings />}
          </div>
        </div>
      </div>
      {isMobile && <MobileNav page={page} onNavigate={setPage} theme={theme} onToggleTheme={handleToggleTheme} role={role} onLogout={handleLogout} />}
    </div>
  );
}
