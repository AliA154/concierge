import { clamp01, fmtAge, fmtClock, fmtDeskTime, fmtRelative } from "./format";
import { NOW_MS } from "../test/fixtures";

test.each([
  [0, "00:00"], [1.5, "01:30"], [-3, "00:00"], [90.25, "90:15"],
])("fmtClock(%s) = %s", (min, out) => expect(fmtClock(min)).toBe(out));

test("fmtAge buckets minutes, hours, days", () => {
  expect(fmtAge("2026-09-18T11:45:00+00:00", NOW_MS)).toBe("15m");
  expect(fmtAge("2026-09-18T09:00:00+00:00", NOW_MS)).toBe("3h");
  expect(fmtAge("2026-09-15T12:00:00+00:00", NOW_MS)).toBe("3d");
  expect(fmtAge("2026-09-18T12:05:00+00:00", NOW_MS)).toBe("0m");
});

test("fmtRelative", () => {
  expect(fmtRelative("2026-09-18T11:59:40+00:00", NOW_MS)).toBe("just now");
  expect(fmtRelative("2026-09-18T11:30:00+00:00", NOW_MS)).toBe("30m ago");
});

test("fmtDeskTime is UTC HH:MM:SS", () => expect(fmtDeskTime(NOW_MS)).toBe("12:00:00"));
test("clamp01", () => { expect(clamp01(-1)).toBe(0); expect(clamp01(0.4)).toBe(0.4); expect(clamp01(9)).toBe(1); });
