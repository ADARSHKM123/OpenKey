import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UsersRound,
  Plug,
  Boxes,
  ScrollText,
  Inbox,
  ShieldCheck,
  Settings,
  KeyRound,
  ChartLine,
  MessageSquare,
  LogOut,
  Home,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useAuthState } from "../../context/AuthContext";
import { useAuthActions } from "../../hooks/useAuthActions";

// One shell for all three surfaces. Navigation is role-aware: members see
// the portal + chat; admins additionally get the admin section.

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const portalNav: NavItem[] = [
  { to: "/portal", label: "Home", icon: <Home className="h-4 w-4" /> },
  { to: "/portal/keys", label: "API keys", icon: <KeyRound className="h-4 w-4" /> },
  { to: "/portal/usage", label: "My usage", icon: <ChartLine className="h-4 w-4" /> },
  { to: "/chat", label: "Chat", icon: <MessageSquare className="h-4 w-4" /> },
];

const adminNav: NavItem[] = [
  { to: "/admin", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: "/admin/teams", label: "Teams", icon: <UsersRound className="h-4 w-4" /> },
  { to: "/admin/users", label: "Users", icon: <Users className="h-4 w-4" /> },
  { to: "/admin/providers", label: "Providers", icon: <Plug className="h-4 w-4" /> },
  { to: "/admin/models", label: "Models", icon: <Boxes className="h-4 w-4" /> },
  { to: "/admin/logs", label: "Logs", icon: <ScrollText className="h-4 w-4" /> },
  { to: "/admin/approvals", label: "Approvals", icon: <Inbox className="h-4 w-4" /> },
  { to: "/admin/audit", label: "Audit", icon: <ShieldCheck className="h-4 w-4" /> },
  { to: "/admin/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="mb-5">
      <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wider text-zinc-600">{title}</p>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/admin" || item.to === "/portal"}
          className={({ isActive }) =>
            cn(
              "mb-0.5 flex items-center gap-2.5 rounded px-2 py-1.5 text-[13px] font-medium transition-colors",
              isActive
                ? "bg-surface-2 text-zinc-100 shadow-[inset_2px_0_0_0] shadow-accent"
                : "text-zinc-500 hover:bg-surface-2/60 hover:text-zinc-300",
            )
          }
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}

export function AppShell() {
  const { user } = useAuthState();
  const { logout } = useAuthActions();
  const navigate = useNavigate();
  const isAdmin = user?.role === "ADMIN" || user?.role === "OWNER";

  return (
    <div className="flex h-full">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-[#0c0c0e]">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-accent-strong font-mono text-xs font-bold text-zinc-950">
            K
          </div>
          <span className="text-sm font-semibold tracking-tight text-zinc-100">OpenKey</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pt-2">
          <NavSection title="Workspace" items={portalNav} />
          {isAdmin && <NavSection title="Admin" items={adminNav} />}
        </nav>
        <div className="border-t border-line px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-zinc-300">{user?.name}</p>
              <p className="truncate text-2xs text-zinc-600">{user?.org.name}</p>
            </div>
            <button
              aria-label="Sign out"
              onClick={() => void logout().then(() => navigate("/login"))}
              className="rounded p-1.5 text-zinc-500 hover:bg-surface-2 hover:text-zinc-200"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-bg/90 px-6 py-3.5 backdrop-blur">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-6xl px-6 py-6", className)}>{children}</div>;
}
