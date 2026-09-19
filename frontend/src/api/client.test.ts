import { http, HttpResponse } from "msw";
import { server } from "../test/handlers";
import { api, ApiError } from "./client";

test("GET returns parsed JSON", async () => {
  server.use(http.get("/api/meta", () => HttpResponse.json({ ok: 1 })));
  await expect(api<{ ok: number }>("/api/meta")).resolves.toEqual({ ok: 1 });
});

test("mutations send JSON body and X-Agent header", async () => {
  let seenAgent = "";
  let seenBody: unknown = null;
  server.use(
    http.post("/api/tickets", async ({ request }) => {
      seenAgent = request.headers.get("X-Agent") ?? "";
      seenBody = await request.json();
      return HttpResponse.json({ id: 1 }, { status: 201 });
    }),
  );
  await api("/api/tickets", { method: "POST", body: { subject: "x" }, agent: "Priya Natarajan" });
  expect(seenAgent).toBe("Priya Natarajan");
  expect(seenBody).toEqual({ subject: "x" });
});

test("error envelope becomes ApiError with the server message", async () => {
  server.use(http.patch("/api/tickets/9", () => HttpResponse.json({ error: { code: 400, message: "cannot move" } }, { status: 400 })));
  await expect(api("/api/tickets/9", { method: "PATCH", body: {} })).rejects.toMatchObject({ code: 400, message: "cannot move" });
  await expect(api("/api/tickets/9", { method: "PATCH", body: {} })).rejects.toBeInstanceOf(ApiError);
});

test("non-JSON failure gets a generic message", async () => {
  server.use(http.get("/api/tickets", () => new HttpResponse("<html>502</html>", { status: 502 })));
  await expect(api("/api/tickets")).rejects.toMatchObject({ message: "Request failed (502)" });
});
