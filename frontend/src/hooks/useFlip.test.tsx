import { render } from "@testing-library/react";
import { useRef } from "react";
import { useFlip } from "./useFlip";

function List({ ids }: { ids: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref, [ids], true);
  return <div ref={ref}>{ids.map((id) => <div key={id} className="row" data-id={id}>{id}</div>)}</div>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("marks new rows with row-enter after the first paint and animates moved rows", () => {
  let top = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: Number(this.dataset["id"]) * 40 + top, left: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const { container, rerender } = render(<List ids={[1, 2]} />);
  expect(container.querySelector(".row-enter")).toBeNull();
  rerender(<List ids={[3, 1, 2]} />);
  expect(container.querySelector('[data-id="3"]')).toHaveClass("row-enter");
  top = 40; // rows 1 and 2 moved down by one slot
  rerender(<List ids={[3, 1, 2]} />);
  expect((container.querySelector('[data-id="1"]') as HTMLElement).style.transform).toContain("translateY(-40px)");
});
