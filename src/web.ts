import FastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export async function registerWeb(app: FastifyInstance, publicRoot: string): Promise<void> {
  await app.register(FastifyStatic, { root: publicRoot, wildcard: false });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.raw.url?.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
    return reply.sendFile("index.html");
  });
}
