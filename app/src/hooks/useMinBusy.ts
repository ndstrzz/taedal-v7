import { useEffect, useRef, useState } from "react";

/**
 * Keeps a busy flag true for at least `minMs` once it turns true.
 * When `busy` flips to false, it waits the remaining time before releasing.
 */
export default function useMinBusy(busy: boolean, minMs = 5000) {
  const [gated, setGated] = useState(false);
  const startRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // clear any pending timeout on prop change/unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (busy) {
      // start/extend gate
      startRef.current = Date.now();
      if (!gated) setGated(true);
      // cancel pending release if any
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      // schedule release after remaining time
      const elapsed = Date.now() - startRef.current;
      const remain = Math.max(0, minMs - elapsed);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setGated(false);
        timeoutRef.current = null;
      }, remain);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, minMs]);

  return gated;
}
