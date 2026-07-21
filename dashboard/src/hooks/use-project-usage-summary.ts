import { useCallback, useEffect, useState } from "react";
import { getProjectUsageSummary } from "../lib/api";

export function useProjectUsageSummary({
  baseUrl,
  accessToken,
  limit = 3,
  from,
  to,
  source,
  timeZone,
  tzOffsetMinutes,
}: any = {}) {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectUsageSummary({
        baseUrl,
        accessToken,
        limit,
        from,
        to,
        source,
        timeZone,
        tzOffsetMinutes,
      });
      setEntries(Array.isArray(res?.entries) ? res.entries : []);
    } catch (err) {
      const message = (err as any)?.message || String(err);
      setError(message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, baseUrl, from, limit, source, timeZone, to, tzOffsetMinutes]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}
