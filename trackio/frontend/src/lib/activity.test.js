import { expect, it } from "vitest";
import { activityStatus } from "./activity.js";
it("expires running sessions without a poll and accounts for client clock offset", () => {
  const activity = {state:"running",server_time:"2026-01-01T00:00:00Z",last_log_at:"2026-01-01T00:00:00Z",timeout_seconds:900};
  expect(activityStatus(activity, 1000, 1000)).toBe(true);
  expect(activityStatus(activity, 902000, 1000)).toBe(false);
  expect(activityStatus({...activity,state:"finished"},1000,1000)).toBe(false);
  expect(activityStatus(null,1000,1000)).toBe(false);
});
