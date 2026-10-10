import { describe, expect, it } from "vitest";
import { inferJobRequirements, requirementsFromLegacyServiceId } from "../src/job-requirements.js";

describe("job requirement inference", () => {
  it.each([
    ["Explain how BNB validators work", ["text"]],
    ["Generate a cinematic image of a moonlit forest", ["image"]],
    ["Crea una imagen cinematográfica de un bosque", ["image"]],
    ["Create a short video of a robot dancing", ["video"]],
    ["Genera un vídeo corto de un robot bailando", ["video"]],
    ["Write a launch announcement and create a matching image", ["text", "image"]],
    ["Escribe un anuncio y crea una imagen a juego", ["text", "image"]],
    ["Write a narration and generate a matching video", ["text", "video"]],
    ["Escribe una narración y genera un vídeo a juego", ["text", "video"]],
    ["Create an image and a short video for the launch", ["image", "video"]],
    ["Write the copy, create an image, and generate a video", ["text", "image", "video"]],
    ["I need an image of a moonlit forest", ["image"]],
    ["Quiero una imagen de un bosque nocturno", ["image"]],
    ["A short video of the product launch", ["video"]],
    ["Necesito un vídeo corto del lanzamiento", ["video"]]
  ])("infers %s", (prompt, expected) => {
    expect(inferJobRequirements(prompt)).toEqual(expected);
  });

  it("derives safe requirements for legacy database rows from the service prefix", () => {
    expect(requirementsFromLegacyServiceId("image.openai.gpt-image-2")).toEqual(["image"]);
    expect(requirementsFromLegacyServiceId("video.higgsfield.seedance-2.5")).toEqual(["video"]);
    expect(requirementsFromLegacyServiceId("unknown-service")).toEqual(["text"]);
  });
});
