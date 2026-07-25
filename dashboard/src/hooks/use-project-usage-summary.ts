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
  // Sources with usage in this window that carry no project attribution. The
  // panel names them: their absence otherwise reads as "that tool cost nothing
  // here", which under-reports while looking complete.
  const [unattributedSources, setUnattributedSources] = useState<string[]>([]);
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
      setUnattributedSources(
        Array.isArray(res?.unattributed_sources) ? res.unattributed_sources : [],
      );
    } catch (err) {
      const message = (err as any)?.message || String(err);
      setError(message);
      setEntries([]);
      setUnattributedSources([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, baseUrl, from, limit, source, timeZone, to, tzOffsetMinutes]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, unattributedSources, loading, error, refresh };
}
