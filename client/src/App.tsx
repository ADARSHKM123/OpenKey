import { useEffect } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuthState } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { useAuthActions } from "./hooks/useAuthActions";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/Login";
import { AdminOverview } from "./pages/admin/Overview";
import { AdminTeams } from "./pages/admin/Teams";
import { AdminUsers } from "./pages/admin/Users";
import { AdminProviders } from "./pages/admin/Providers";
import { AdminModels } from "./pages/admin/Models";
import { AdminLogs } from "./pages/admin/Logs";
import { AdminApprovals } from "./pages/admin/Approvals";
import { AdminAudit } from "./pages/admin/Audit";
import { AdminSettings } from "./pages/admin/Settings";
import { KeysProvider } from "./context/KeysContext";
import { PortalHome } from "./pages/portal/Home";
import { PortalKeys } from "./pages/portal/Keys";
import { PortalUsage } from "./pages/portal/Usage";

function Boot() {
  const { status, user } = useAuthState();
  const { loadMe } = useAuthActions();

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={status === "authed" ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={status === "authed" ? <AppShell /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<RoleHome />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<AdminOverview />} />
          <Route path="/admin/teams" element={<AdminTeams />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/providers" element={<AdminProviders />} />
          <Route path="/admin/models" element={<AdminModels />} />
          <Route path="/admin/logs" element={<AdminLogs />} />
          <Route path="/admin/approvals" element={<AdminApprovals />} />
          <Route path="/admin/audit" element={<AdminAudit />} />
          <Route path="/admin/settings" element={<AdminSettings />} />
        </Route>
        <Route path="/portal" element={<PortalHome />} />
        <Route path="/portal/keys" element={<PortalKeys />} />
        <Route path="/portal/usage" element={<PortalUsage />} />
        <Route path="/chat" element={<ComingSoon label="Chat" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  function RoleHome() {
    const isAdmin = user?.role === "ADMIN" || user?.role === "OWNER";
    return <Navigate to={isAdmin ? "/admin" : "/portal"} replace />;
  }
}

function RequireAdmin() {
  const { user } = useAuthState();
  const isAdmin = user?.role === "ADMIN" || user?.role === "OWNER";
  return isAdmin ? <Outlet /> : <Navigate to="/portal" replace />;
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-600">
      {label} arrives in the next milestone.
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <KeysProvider>
            <Boot />
          </KeysProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
