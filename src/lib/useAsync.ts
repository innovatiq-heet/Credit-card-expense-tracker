"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./supabase";

type State<T> = { token: string | null; data: T | undefined; error: string | null };

/**
 * Run an async loader when `key` changes and expose { data, error, loading, reload }.
 * Pass a key that changes whenever the loader's inputs change.
 * `reload()` keeps showing the current data while fresh data loads.
 */
export function useAsync<T>(loader: () => Promise<T>, key: string) {
  const [version, setVersion] = useState(0);
  const token = `${key}#${version}`;
  const [state, setState] = useState<State<T>>({ token: null, data: undefined, error: null });

  useEffect(() => {
    let alive = true;
    loader()
      .then((data) => alive && setState({ token, data, error: null }))
      .catch((e) => alive && setState((s) => ({ token, data: s.data, error: errorMessage(e) })));
    return () => {
      alive = false;
    };
    // The loader is re-created on every render; `token` decides when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const sameKey = state.token !== null && state.token.slice(0, state.token.lastIndexOf("#")) === key;

  return {
    data: sameKey ? state.data : undefined,
    error: sameKey ? state.error : null,
    loading: state.token !== token,
    reload,
  };
}
