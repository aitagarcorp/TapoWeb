import { useEffect, useState } from "react"
import { Sun, Moon, LogOut, HardDrive, Video } from "lucide-react"
import { api } from "@/lib/api"
import type { CalendarDay } from "@/lib/api"
import { useTicker } from "@/hooks/useTicker"

interface Props {
  page: string
  theme: string
  onToggleTheme: () => void
  role: string
  onLogout: () => void
}

const PAGE_TITLES: Record<string, string> = {
  dashboard: "Monitor en vivo",
  dvr: "Reproduccion DVR",
  recordings: "Archivo de grabaciones",
  config: "Configuracion del sistema",
}

function formatSize(bytes: number) {
  if (bytes <= 0) return "0.0 GB"
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(1)} GB`
}

export function TopBar({ page, theme, onToggleTheme, role, onLogout }: Props) {
  const now = useTicker()
  const [camOnline, setCamOnline] = useState(0)
  const [camTotal, setCamTotal] = useState(0)
  const [totalSize, setTotalSize] = useState(0)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const h = await api.health()
        if (cancelled) return
        const mjpeg = h.mjpeg ?? []
        setCamTotal(mjpeg.length)
        setCamOnline(mjpeg.filter((m) => m.has_signal).length)
      } catch {}
    }
    poll()
    const iv = setInterval(poll, 10000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.getCameras().then((cameras) => {
      const cams = cameras.filter((c) => c.enabled)
      return Promise.all(cams.map((c) => api.getDvrCalendar(c.id).catch<CalendarDay[]>(() => [])))
    }).then((calendars) => {
      if (cancelled || !calendars) return
      let total = 0
      calendars.flat().forEach((d) => { total += d.total_size })
      setTotalSize(total)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [page])

  const allOnline = camTotal > 0 && camOnline === camTotal

  return (
    <header className="h-[70px] shrink-0 bg-[#07111e] border-b border-[#17283c] flex items-center gap-[18px] px-[18px] relative z-30 text-[#d9e5f5]">
      <div className="flex items-center gap-[10px] min-w-[190px] select-none">
        <div className="w-[30px] h-[30px] rounded-[5px] bg-[#1687ff] flex items-center justify-center text-white text-[17px]">
          <Video size={17} className="text-white" />
        </div>
        <div className="font-sans font-bold text-[18px] text-white tracking-normal">
          AGARVEN <span className="text-[#1687ff]">NVR</span>
        </div>
      </div>

      <div className="w-px h-[30px] bg-[#27384d] hidden md:block" />

      <div className="hidden xl:block font-mono text-[23px] font-bold tracking-[5px] text-[#f0f4fa] whitespace-nowrap uppercase">
        SISTEMA DE VIGILANCIA AGARVEN
      </div>

      <div className="hidden md:flex items-center gap-[18px]">
        <div className="flex items-center gap-2 font-sans text-[12px] text-[#8da1ba] whitespace-nowrap" title="Camaras con senal">
          <span
            className={`w-2 h-2 rounded-full ${
              allOnline ? "bg-[#20d67a]" : camOnline > 0 ? "bg-[#328cff]" : "bg-[#328cff]"
            }`}
          />
          <span className="tabular-nums">CAM {camOnline}/{camTotal}</span>
        </div>

        <div className="flex items-center gap-2 font-sans text-[12px] text-[#8da1ba] whitespace-nowrap" title="Grabacion continua activa">
          <span className="w-2 h-2 rounded-full bg-[#e53935] animate-pulse" />
          <span className="tabular-nums">REC {camTotal}</span>
        </div>

        <div className="hidden lg:flex items-center gap-2 font-sans text-[12px] text-[#8da1ba] whitespace-nowrap" title="Almacenamiento DVR">
          <HardDrive size={14} className="text-[#8da1ba]" />
          <span className="tabular-nums">{formatSize(totalSize)}</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-4 font-sans">
        <span className="text-[#637b98] text-[12px] tracking-[2px] uppercase hidden sm:block">
          {PAGE_TITLES[page] ?? ""}
        </span>

        <span className="border-l border-[#27384d] pl-[15px] font-mono font-bold text-[15px] text-white tabular-nums">
          {now.toLocaleTimeString("es-VE", { hour12: false })}
        </span>

        <span
          className={`hidden sm:inline text-[11px] font-bold uppercase px-[5px] py-[2px] rounded-[4px] border ${
            role === "baseadv"
              ? "text-[#318aff] border-[#318aff]"
              : "text-warning border-warning/60"
          }`}
        >
          {role === "baseadv" ? "ADMIN" : "OPERADOR"}
        </span>

        <button
          onClick={onToggleTheme}
          aria-label="Cambiar tema"
          title="Cambiar tema"
          className="p-1.5 rounded-[4px] text-[#8499b5] hover:text-white hover:bg-[#101d30] transition-colors"
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          onClick={onLogout}
          aria-label="Cerrar sesion"
          title="Cerrar sesion"
          className="p-1.5 rounded-[4px] text-[#8499b5] hover:text-[#ff4545] hover:bg-[#101d30] transition-colors"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  )
}
