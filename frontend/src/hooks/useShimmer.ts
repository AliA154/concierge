import { useEffect } from "react";

const SHIMMER_DELAY_MS = 300;

// Arms body.shimmer-on only if loading outlasts SHIMMER_DELAY_MS, so a fast
// load never flashes the shimmer sweep across the skeleton. Removes the class
// (and cancels the pending timer) as soon as the data has loaded.
export function useShimmer(loaded: boolean): void {
  useEffect(() => {
    if (loaded) {
      document.body.classList.remove("shimmer-on");
      return;
    }
    const timer = setTimeout(() => document.body.classList.add("shimmer-on"), SHIMMER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loaded]);
}
