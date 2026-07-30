import React from "react";
import { copy } from "../../../lib/copy";

/**
 * IngestHealthNotice - warns when running Claude CLI sessions have
 * transcript writing disabled, so TokenTracker cannot count their tokens.
 *
 * Renders nothing unless the backend actually checked and found suppressed
 * sessions. `checked: false` (unsupported platform, or the check failed)
 * belongs in `tokentracker doctor`, not on the daily dashboard surface.
 *
 * @param {Object} props
 * @param {Object|null} [props.ingestHealth] - Response from getIngestHealth().
 */
export function IngestHealthNotice({ ingestHealth }) {
  const suppressed = ingestHealth?.transcript_suppressed;
  if (!suppressed || suppressed.checked !== true) return null;
  const count = Number(suppressed.count) || 0;
  if (count <= 0) return null;

  // A suppressed session need not name a model — `--model` is optional, so the
  // detector legitimately reports a count with no models. Interpolating an
  // empty list would render an empty "()" in the sentence.
  const models = Array.isArray(suppressed.models) ? suppressed.models.join(", ") : "";
  const body = models
    ? copy("dashboard.ingestHealth.suppressed.body", { count, models })
    : copy("dashboard.ingestHealth.suppressed.bodyNoModel", { count });

  // `role="status"` + `aria-live="polite"`, not `role="note"`. The notice is
  // inserted after an async fetch resolves, so it appears without any user
  // action and without moving focus. `note` is a static landmark: a screen
  // reader announces it only if the user happens to navigate onto it, which
  // means the one class of user who cannot see an amber box appear is also the
  // one who is never told about it. `polite` queues the announcement behind
  // whatever is being read rather than interrupting.
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-1 rounded-md border border-amber-300/60 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-900/10 px-2.5 py-2 text-[11px] text-oai-gray-600 dark:text-oai-gray-300"
    >
      <div className="font-medium text-oai-gray-700 dark:text-oai-gray-200">
        {copy("dashboard.ingestHealth.suppressed.title")}
      </div>
      <div className="mt-0.5 leading-snug">{body}</div>
      <div className="mt-0.5 leading-snug">
        {copy("dashboard.ingestHealth.suppressed.remedy")}
      </div>
    </div>
  );
}
