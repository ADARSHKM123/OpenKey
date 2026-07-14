import { useCallback } from "react";
import { api } from "../lib/api";
import { useKeysDispatch } from "../context/KeysContext";
import type { VirtualKey } from "../context/reducers/keys";

type KeyWithSecret = VirtualKey & { key: string };

export function useKeysActions() {
  const dispatch = useKeysDispatch();

  const load = useCallback(async () => {
    dispatch({ type: "loading" });
    try {
      const keys = await api<VirtualKey[]>("/api/keys");
      dispatch({ type: "loaded", keys });
      return keys;
    } catch (err) {
      dispatch({ type: "failed", error: (err as Error).message });
      return [];
    }
  }, [dispatch]);

  const create = useCallback(
    async (body: { name: string; teamId?: string | null; monthlyBudgetUsd?: string | null }) => {
      const created = await api<KeyWithSecret>("/api/keys", { method: "POST", body });
      const { key: rawKey, ...rest } = created;
      dispatch({ type: "created", key: rest });
      return { key: rest, rawKey };
    },
    [dispatch],
  );

  const rotate = useCallback(
    async (id: string) => {
      const rotated = await api<KeyWithSecret>(`/api/keys/${id}/rotate`, { method: "POST" });
      const { key: rawKey, ...rest } = rotated;
      dispatch({ type: "updated", key: rest });
      return { key: rest, rawKey };
    },
    [dispatch],
  );

  const revoke = useCallback(
    async (id: string) => {
      await api(`/api/keys/${id}`, { method: "DELETE" });
      dispatch({ type: "revoked", id });
    },
    [dispatch],
  );

  return { load, create, rotate, revoke };
}
