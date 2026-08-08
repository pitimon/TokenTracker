import React from "react";
import { copy } from "../lib/copy";

/**
 * This UI is supported only when the browser is connected to TokenTracker's
 * loopback local CLI backend. A non-local host cannot read usage data from the user's
 * machine, and TokenTracker has no hosted/cloud fallback.
 */
export function LocalOnlyNotice() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="max-w-md">
        <h2 className="text-lg font-semibold text-oai-black dark:text-white">
          {copy("local_only.title")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-oai-gray-500 dark:text-oai-gray-400">
          {copy("local_only.body")}
        </p>
      </div>
    </div>
  );
}
