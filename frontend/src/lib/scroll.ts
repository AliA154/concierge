// Shared row-scrolling helper: VIP banner clicks and j/k selection moves
// both need to bring the target row into view, honoring reduced-motion.
export function scrollToRow(id: number, block: ScrollLogicalPosition, reduced: boolean): void {
  document.querySelector<HTMLElement>(`.row[data-id="${id}"]`)?.scrollIntoView({ block, behavior: reduced ? "auto" : "smooth" });
}
