import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Camera, Bell, Users, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ReactNode } from "react";
import clsx from "clsx";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/camera", label: "AI Camera", icon: Camera },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/contacts", label: "Trusted Contacts", icon: Users },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-white/[0.06] bg-night-950/60 backdrop-blur-xl">
        <div className="flex items-center gap-2 px-6 py-6">
          <ShieldCheck className="h-6 w-6 text-beacon-500" />
          <span className="font-display text-lg font-semibold tracking-tight">Guardian Shield</span>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-beacon-500/10 text-beacon-400 border border-beacon-500/20"
                    : "text-ink-400 hover:bg-white/[0.04] hover:text-ink-100"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/[0.06] p-4">
          <div className="mb-3 flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-signal-500/15 text-sm font-semibold text-signal-400">
              {user?.full_name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-100">{user?.full_name}</p>
              <p className="truncate text-xs text-ink-500">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-ink-400 transition-colors hover:bg-alarm-500/10 hover:text-alarm-400"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="ml-64 flex-1 p-8">{children}</main>
    </div>
  );
}
