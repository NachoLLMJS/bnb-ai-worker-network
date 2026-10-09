import { describe, expect, it } from "vitest";
import { getService, listServices } from "../src/service-catalog.js";

describe("approved service catalog", () => {
  it("offers local and hosted text, image and video services without exposing credentials", () => {
    const services = listServices();
    expect(services.map((service) => service.id)).toEqual(expect.arrayContaining([
      "text.ollama",
      "text.openai.chatgpt",
      "text.openai.sol",
      "text.anthropic.fable",
      "image.openai.gpt-image-2",
      "image.higgsfield.nano-banana-2",
      "image.higgsfield.seedream-5-pro",
      "image.higgsfield.recraft-4.1",
      "video.higgsfield.seedance-2.5",
      "video.higgsfield.genjutsu",
      "video.higgsfield.kling-3-turbo"
    ]));
    expect(services.every((service) => !JSON.stringify(service).match(/api[_-]?key|secret|token/i))).toBe(true);
    expect(getService("image.openai.gpt-image-2")).toMatchObject({ kind: "image", provider: "OpenAI", executor: "openai" });
    expect(getService("video.higgsfield.seedance-2.5")).toMatchObject({ kind: "video", provider: "Higgsfield" });
  });
});
