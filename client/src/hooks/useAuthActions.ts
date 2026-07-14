import { useCallback } from "react";
import { api } from "../lib/api";
import { useAuthDispatch } from "../context/AuthContext";
import type { SessionUser } from "../context/reducers/auth";

export function useAuthActions() {
  const dispatch = useAuthDispatch();

  const loadMe = useCallback(async () => {
    try {
      const user = await api<SessionUser>("/api/me");
      dispatch({ type: "resolved", user });
      return user;
    } catch {
      dispatch({ type: "anon" });
      return null;
    }
  }, [dispatch]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      return loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    dispatch({ type: "logout" });
  }, [dispatch]);

  return { loadMe, login, logout };
}
