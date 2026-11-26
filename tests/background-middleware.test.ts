import { beforeEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock("@/services/background", () => ({ enqueueBackgroundJob: state.send }))
vi.mock("nitro/h3", () => ({ defineMiddleware: (handler: unknown) => handler }))
import middleware from "@/middlewares/background"

beforeEach(() => state.send.mockReset().mockResolvedValue(undefined))

async function respond(path: string, status = 200) {
  const response = new Response(null, { status })
  const result = await middleware({ req: new Request("https://service.example" + path, { method: "POST" }) } as never, () => Promise.resolve(response))
  expect(result).toBe(response)
}

it.each(["/_vercel/queues/consumer", "/_nitro/tasks/background:recover"])(
  "does not create a delivery loop when the internal callback %s succeeds", async (path) => {
    await respond(path)
    expect(state.send).not.toHaveBeenCalled()
  },
)
it("enqueues only after a successful domain mutation", async () => {
  await respond("/domain", 403)
  expect(state.send).not.toHaveBeenCalled()
  await respond("/domain", 201)
  expect(state.send).toHaveBeenCalledOnce()
})
it("retains the committed response for outbox recovery if enqueue fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  state.send.mockRejectedValueOnce(new Error("fixture queue offline"))
  await respond("/domain", 201)
})
