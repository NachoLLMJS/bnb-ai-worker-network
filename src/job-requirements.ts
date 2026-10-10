import type { ServiceKind } from "./service-catalog.js";

export type JobRequirement = ServiceKind;

const imageIntent = /\b(?:create|generate|make|draw|design|render|produce|crea|crear|genera|generar|haz|hacer|dibuja|dibujar|diseña|diseñar|renderiza|renderizar|produce|producir)\b[^.!?\n]{0,80}\b(?:image|illustration|picture|photo|graphic|logo|icon|artwork|imagen|ilustraci[oó]n|foto|gr[aá]fico|logotipo|icono|arte)\b/iu;
const videoIntent = /\b(?:create|generate|make|render|produce|animate|crea|crear|genera|generar|haz|hacer|renderiza|renderizar|produce|producir|anima|animar)\b[^.!?\n]{0,80}\b(?:video|animation|clip|film|vídeo|video|animaci[oó]n|pel[ií]cula)\b/iu;
const imageRequest = /(?:\b(?:need|want|request|quiero|necesito|solicito)\b[^.!?\n]{0,50}|^\s*(?:an?|the|un|una)\s+(?:\w+\s+){0,3})(?:image|illustration|picture|photo|graphic|logo|icon|artwork|imagen|ilustraci[oó]n|foto|gr[aá]fico|logotipo|icono|arte)\b/iu;
const videoRequest = /(?:\b(?:need|want|request|quiero|necesito|solicito)\b[^.!?\n]{0,50}|^\s*(?:an?|the|un|una)\s+(?:\w+\s+){0,3})(?:video|animation|clip|film|vídeo|animaci[oó]n|pel[ií]cula)\b/iu;
const textIntent = /\b(?:write|explain|summarize|describe|draft|compose|translate|analyze|answer|tell|escribe|explica|resume|describe|redacta|comp[oó]n|traduce|analiza|responde|cuenta)\b/iu;

export function inferJobRequirements(prompt: string): JobRequirement[] {
  const wantsImage = imageIntent.test(prompt) || imageRequest.test(prompt);
  const wantsVideo = videoIntent.test(prompt) || videoRequest.test(prompt);
  const wantsText = textIntent.test(prompt);
  const requirements: JobRequirement[] = [];
  if (wantsText || (!wantsImage && !wantsVideo)) requirements.push("text");
  if (wantsImage) requirements.push("image");
  if (wantsVideo) requirements.push("video");
  return requirements;
}

export function requirementsFromLegacyServiceId(serviceId: string): JobRequirement[] {
  const prefix = serviceId.split(".", 1)[0];
  return prefix === "image" || prefix === "video" || prefix === "text" ? [prefix] : ["text"];
}
