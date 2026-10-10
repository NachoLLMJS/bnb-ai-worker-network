const TOKEN_KEY = "worker-relay-access";
const PUBLIC_REQUEST_KEY = "bnb-compute-public-request";
const validRoutes = new Set(["dashboard", "jobs", "workers", "submit", "inbox", "logs"]);
const publicRoutes = new Set(["home", "explore", "job-detail", "network", "docs"]);
const publicPaths = { home: "/", explore: "/explore", network: "/network", docs: "/docs" };
const servicesById = new Map();
let jobs = [];
let publicJobs = [];
let currentPublicJobId = null;
let publicFilter = "all";
let currentRoute = "dashboard";
let jobsFilter = "all";
let inboxFilter = "open";
let selectedJobId = null;
let poller;
let publicRequestPoller;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const introLoader = $("#intro-loader");
if (introLoader) {
  const introFrame = introLoader.querySelector("iframe");
  let loaderDismissed = false;
  const dismissLoader = () => {
    if (loaderDismissed) return;
    loaderDismissed = true;
    introLoader.classList.add("intro-loader-exit");
    window.setTimeout(() => introLoader.remove(), 950);
  };
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== introFrame?.contentWindow) return;
    if (event.data?.type === "sxg-loader-complete") dismissLoader();
  });
  window.setTimeout(dismissLoader, 14000);
}
const landingView = $("#landing-view");
const appShell = $("#app-shell");
const accessOverlay = $("#access-overlay");
const workspaceOverlay = $("#workspace-overlay");
const accessForm = $("#access-form");
const accessKey = $("#access-key");
const accessError = $("#access-error");
const publicRequestForm = $("#public-request-form");
const publicRequestPrompt = $("#public-request-prompt");
const publicRequestService = $("#public-request-service");
const publicRequestPublish = $("#public-request-publish");
const publicRequestSubmit = $("#public-request-submit");
const publicRequestError = $("#public-request-error");
const appNav = $("#app-nav");
const jobForm = $("#job-form");
const prompt = $("#prompt");
const promptCount = $("#prompt-count");
const serviceId = $("#service-id");
const publishJob = $("#publish-job");
const submitJob = $("#submit-job");
const jobError = $("#job-error");

function token() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
function setText(node, value) { if (node) node.textContent = value ?? ""; }
function authHeaders(extra = {}) { return { ...extra, Authorization: `Bearer ${token()}` }; }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: authHeaders(options.headers) });
  if (response.status === 401) throw new Error("Access key rejected");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

async function publicApi(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Public request failed (${response.status})`);
  return response.json();
}

async function publicRequestApi(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error === "rate_limit_exceeded" ? "Too many requests. Try again in a few minutes." : body.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function relativeTime(value) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function shortId(id) { return `#${id.slice(0, 4).toUpperCase()}`; }
function serviceFor(job) { return servicesById.get(job.serviceId) || { id: job.serviceId, label: job.serviceId || "Local model", provider: "Unknown", kind: "text" }; }
function titleFor(job) {
  const text = job.prompt.trim().replace(/\s+/g, " ");
  return text.length > 58 ? `${text.slice(0, 57)}…` : text;
}
function kindSymbol(kind) { return kind === "image" ? "▧" : kind === "video" ? "▣" : "▤"; }
function stateLabel(state) { return state === "succeeded" ? "Completed" : state === "active" ? "Running" : state.charAt(0).toUpperCase() + state.slice(1); }

function stateBadge(state) {
  const badge = document.createElement("span");
  badge.className = `state state-${state}`;
  setText(badge, `● ${stateLabel(state)}`);
  return badge;
}

function typeIcon(service) {
  const icon = document.createElement("span");
  icon.className = `type-icon kind-${service.kind}`;
  setText(icon, kindSymbol(service.kind));
  return icon;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

function safeMediaUrl(value, kind) {
  const https = safeHttpsUrl(value);
  if (https) return https;
  if (kind === "image" && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value || "")) return value;
  return null;
}

function mediaResult(job, service) {
  const url = safeMediaUrl(job.output, service.kind);
  if (!url || !["image", "video"].includes(service.kind)) {
    const result = document.createElement("pre");
    result.className = "result-text";
    setText(result, job.output || "No result yet");
    return result;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "media-result";
  if (service.kind === "image") {
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Generated image from ${service.label}`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    wrapper.append(image);
  } else {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.referrerPolicy = "no-referrer";
    wrapper.append(video);
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  setText(link, "OPEN GENERATED ASSET ↗");
  wrapper.append(link);
  return wrapper;
}

function publicJobIdFromPath() {
  const match = location.pathname.match(/^\/explore\/jobs\/([0-9a-f-]+)$/i);
  return match ? match[1] : null;
}

function publicRouteFromPath() {
  if (publicJobIdFromPath()) return "job-detail";
  if (location.pathname === "/explore") return "explore";
  if (location.pathname === "/network") return "network";
  if (location.pathname === "/docs") return "docs";
  return "home";
}

function publicJobMatches(job) {
  if (publicFilter === "all") return true;
  if (["active", "succeeded"].includes(publicFilter)) return job.state === publicFilter;
  return serviceFor(job).kind === publicFilter;
}

function publicJobCard(job, compact = false) {
  const service = serviceFor(job);
  const card = document.createElement("article");
  card.className = `public-job-card${compact ? " compact-card" : ""}`;
  card.dataset.publicJobId = job.id;
  card.tabIndex = 0;
  card.setAttribute("role", "link");
  card.setAttribute("aria-label", `Open public job ${shortId(job.id)}: ${titleFor(job)}`);
  const icon = typeIcon(service);
  const body = document.createElement("div"); body.className = "public-job-body";
  const heading = document.createElement("div"); heading.className = "public-job-heading";
  const title = document.createElement("h3"); setText(title, titleFor(job));
  const meta = document.createElement("span"); setText(meta, `${service.label} · ${relativeTime(job.updatedAt || job.createdAt)}`);
  heading.append(title, meta);
  const result = document.createElement("div"); result.className = "public-job-result";
  if (!compact && job.output) result.append(mediaResult(job, service));
  else if (!compact) {
    const waiting = document.createElement("p");
    setText(waiting, job.state === "active" ? "A compatible worker is processing this job." : job.state === "succeeded" ? "Open this job to view the published result." : "Waiting for a compatible worker.");
    result.append(waiting);
  }
  body.append(heading);
  if (!compact) body.append(result);
  const aside = document.createElement("div"); aside.className = "public-job-meta";
  const id = document.createElement("code"); setText(id, shortId(job.id));
  aside.append(stateBadge(job.state), id);
  card.append(icon, body, aside);
  return card;
}

function renderPublicExplorer() {
  const visible = publicJobs.filter(publicJobMatches);
  $("#public-jobs-list").replaceChildren(...visible.map((job) => publicJobCard(job)));
  $("#public-jobs-empty").hidden = visible.length > 0;
  setText($("#public-total"), publicJobs.length);
  setText($("#public-running"), publicJobs.filter((job) => job.state === "active").length);
  setText($("#public-completed"), publicJobs.filter((job) => job.state === "succeeded").length);
  setText($("#public-services"), servicesById.size);
  $("#home-public-jobs").replaceChildren(...publicJobs.slice(0, 4).map((job) => publicJobCard(job, true)));
  if (!publicJobs.length) {
    const empty = document.createElement("div"); empty.className = "public-home-empty";
    const strong = document.createElement("strong"); const text = document.createElement("p");
    setText(strong, "The public Explorer is ready"); setText(text, "Completed work will appear here when a requester explicitly publishes a job.");
    empty.append(strong, text); $("#home-public-jobs").replaceChildren(empty);
  }
}

function timelineItem(title, description, timestamp) {
  const item = document.createElement("li");
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  const text = document.createElement("p");
  const time = document.createElement("time");
  setText(heading, title); setText(text, description); setText(time, timestamp ? formatDate(timestamp) : "Pending");
  copy.append(heading, text); item.append(copy, time);
  return item;
}

async function openPublicJobDetail(jobId, push = true) {
  if (!jobId) { showPublicRoute("explore", push); return; }
  currentPublicJobId = jobId;
  clearInterval(poller);
  appShell.hidden = true; landingView.hidden = false; accessOverlay.hidden = true;
  $$("[data-public-view]").forEach((view) => { view.hidden = view.dataset.publicView !== "job-detail"; });
  $$("[data-public-route]").forEach((control) => control.classList.toggle("active", control.dataset.publicRoute === "explore"));
  if (push && location.pathname !== `/explore/jobs/${jobId}`) history.pushState({ publicJobId: jobId }, "", `/explore/jobs/${jobId}`);
  setText($("#public-detail-id"), shortId(jobId));
  setText($("#public-detail-title"), "Loading published job…");
  $("#public-detail-state").replaceChildren();
  setText($("#public-detail-prompt"), "");
  const loading = document.createElement("div"); loading.className = "artifact-empty"; setText(loading, "Loading published result…");
  $("#public-job-artifact").replaceChildren(loading);
  $("#public-job-timeline").replaceChildren();
  window.scrollTo({ top: 0, behavior: "instant" });
  try {
    if (!servicesById.size) {
      const catalog = await publicApi("/api/services");
      catalog.services.forEach((service) => servicesById.set(service.id, service));
    }
    const detail = await publicApi(`/api/explorer/jobs/${jobId}`);
    if (currentPublicJobId !== jobId) return;
    const job = detail.job;
    const service = serviceFor(job);
    setText($("#public-detail-icon"), kindSymbol(service.kind));
    setText($("#public-detail-service"), `${service.provider} · ${service.label}`);
    setText($("#public-detail-id"), shortId(job.id));
    setText($("#public-detail-title"), titleFor(job));
    $("#public-detail-state").replaceChildren(stateBadge(job.state));
    setText($("#public-detail-age"), relativeTime(job.updatedAt || job.createdAt));
    setText($("#public-detail-prompt"), job.prompt);
    setText($("#public-artifact-title"), service.kind === "text" ? "Published Response" : `Published ${service.kind.charAt(0).toUpperCase() + service.kind.slice(1)}`);
    setText($("#public-artifact-meta"), `${service.provider} · ${service.id}`);
    if (job.output) $("#public-job-artifact").replaceChildren(mediaResult(job, service));
    else { const empty = document.createElement("div"); empty.className = "artifact-empty"; setText(empty, job.state === "active" ? "A compatible worker is producing this result." : "No result has been published yet."); $("#public-job-artifact").replaceChildren(empty); }
    const work = detail.work || {};
    const steps = [timelineItem("Job published", "The requester explicitly chose to make this prompt and result public.", job.createdAt)];
    if (work.claimedAt) steps.push(timelineItem("Work accepted", "A compatible worker securely claimed the approved capability. Worker identity remains private.", work.claimedAt));
    if (work.completedAt || job.state === "succeeded") steps.push(timelineItem("Result completed", "The published artifact passed lease validation and was accepted by the control plane.", work.completedAt || job.updatedAt));
    if (!work.claimedAt && job.state !== "succeeded") steps.push(timelineItem("Awaiting compatible capacity", "The request remains available to workers advertising this capability.", null));
    $("#public-job-timeline").replaceChildren(...steps);
  } catch {
    if (currentPublicJobId !== jobId) return;
    const error = document.createElement("div"); error.className = "public-detail-error";
    const strong = document.createElement("strong"); const text = document.createElement("p");
    setText(strong, "Published job not found"); setText(text, "This job is private, unavailable, or no longer published.");
    error.append(strong, text); $("#public-job-artifact").replaceChildren(error);
    setText($("#public-detail-title"), "Unavailable public job");
  }
}

function enhanceWorldMap() {
  const map = $("#public-worker-map");
  const label = $("#map-country-label");
  if (!map || !label) return;
  const bind = () => {
    const documentRoot = map.contentDocument;
    if (!documentRoot || documentRoot.documentElement.dataset.interactive === "true") return;
    documentRoot.documentElement.dataset.interactive = "true";
    documentRoot.querySelectorAll("path[data-country]").forEach((country) => {
      country.style.cursor = "crosshair";
      const activate = () => { country.style.fill = "#52697b"; country.style.stroke = "#f0b90b"; setText(label, `${country.dataset.country} · worker availability is open, live location not claimed`); };
      const deactivate = () => { country.style.removeProperty("fill"); country.style.removeProperty("stroke"); };
      country.addEventListener("pointerenter", activate);
      country.addEventListener("pointerleave", deactivate);
      country.addEventListener("click", activate);
    });
  };
  map.addEventListener("load", bind);
  bind();
}

function renderPublicCapabilities() {
  const target = $("#public-capability-list");
  if (!target) return;
  target.replaceChildren(...[...servicesById.values()].map((service) => {
    const card = document.createElement("article"); card.className = "capability-card";
    const kind = document.createElement("span"); const name = document.createElement("strong"); const provider = document.createElement("small");
    setText(kind, `${kindSymbol(service.kind)} ${service.kind}`); setText(name, service.label); setText(provider, `${service.provider} · worker opt-in`);
    card.append(kind, name, provider); return card;
  }));
}

function showPublicRoute(route = publicRouteFromPath(), push = true) {
  if (route === "job-detail") { openPublicJobDetail(publicJobIdFromPath(), push); return; }
  if (!publicRoutes.has(route)) route = "home";
  currentPublicJobId = null;
  clearInterval(poller);
  appShell.hidden = true;
  landingView.hidden = false;
  accessOverlay.hidden = true;
  $$("[data-public-view]").forEach((view) => { view.hidden = view.dataset.publicView !== route; });
  $$("[data-public-route]").forEach((control) => control.classList.toggle("active", control.dataset.publicRoute === route));
  if (push && location.pathname !== publicPaths[route]) history.pushState({ publicRoute: route }, "", publicPaths[route]);
  if (route === "explore") renderPublicExplorer();
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function loadPublicSite() {
  const [catalog, explorer] = await Promise.all([publicApi("/api/services"), publicApi("/api/explorer/jobs?limit=100")]);
  servicesById.clear();
  catalog.services.forEach((service) => servicesById.set(service.id, service));
  publicRequestService.replaceChildren(...catalog.services.map((service) => {
    const option = document.createElement("option");
    option.value = service.id;
    setText(option, `${service.label} · ${service.provider}`);
    return option;
  }));
  publicJobs = explorer.jobs;
  renderPublicCapabilities();
  renderPublicExplorer();
  enhanceWorldMap();
}

function routeFromPath() {
  const segment = location.pathname.split("/").filter(Boolean)[0];
  return validRoutes.has(segment) ? segment : "dashboard";
}

function navigate(route, push = true) {
  if (!validRoutes.has(route)) route = "dashboard";
  currentRoute = route;
  selectedJobId = null;
  $$("[data-view]").forEach((view) => { view.hidden = view.dataset.view !== route; });
  $$('[data-route]').forEach((control) => control.classList.toggle("active", control.dataset.route === route));
  appNav.classList.remove("open");
  if (push && location.pathname !== `/${route}`) history.pushState({ route }, "", `/${route}`);
  renderRoute(route);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderRoute(route) {
  if (route === "dashboard") renderDashboard();
  if (route === "jobs") renderJobsTable();
  if (route === "workers") renderWorkers();
  if (route === "inbox") renderInbox();
  if (route === "logs") renderLogs();
}

function renderDashboard() {
  const completed = jobs.filter((job) => job.state === "succeeded").length;
  const running = jobs.filter((job) => job.state === "active").length;
  const pending = jobs.filter((job) => job.state === "queued").length;
  setText($("#stat-total"), jobs.length);
  setText($("#stat-completed"), completed);
  setText($("#stat-running"), running);
  setText($("#stat-pending"), pending);

  const chart = $("#activity-chart");
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - offset);
    const next = new Date(day); next.setDate(next.getDate() + 1);
    const dayJobs = jobs.filter((job) => new Date(job.createdAt) >= day && new Date(job.createdAt) < next);
    days.push({ day, complete: dayJobs.filter((job) => job.state === "succeeded").length, running: dayJobs.filter((job) => job.state === "active").length, pending: dayJobs.filter((job) => job.state === "queued").length });
  }
  const max = Math.max(1, ...days.flatMap((day) => [day.complete, day.running, day.pending]));
  chart.replaceChildren(...days.map((day) => {
    const column = document.createElement("div"); column.className = "chart-day";
    const bars = document.createElement("div"); bars.className = "chart-bars";
    [["complete", "bar-complete"], ["running", "bar-running"], ["pending", "bar-pending"]].forEach(([key, className]) => {
      const bar = document.createElement("span"); bar.className = `chart-bar ${className}`; bar.style.height = `${Math.max(3, day[key] / max * 100)}%`; bar.title = `${day[key]} ${key}`; bars.append(bar);
    });
    const label = document.createElement("small"); setText(label, new Intl.DateTimeFormat("en", { weekday: "short" }).format(day.day));
    column.append(bars, label); return column;
  }));

  const recent = $("#recent-jobs");
  const rows = jobs.slice(0, 6).map((job) => {
    const service = serviceFor(job);
    const row = document.createElement("div"); row.className = "recent-row"; row.tabIndex = 0;
    const copy = document.createElement("div"); const strong = document.createElement("strong"); const small = document.createElement("small");
    setText(strong, titleFor(job)); setText(small, `${service.label} · ${relativeTime(job.createdAt)}`); copy.append(strong, small);
    row.append(typeIcon(service), copy, stateBadge(job.state));
    row.addEventListener("click", () => openJobDetail(job.id));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") openJobDetail(job.id); });
    return row;
  });
  if (!rows.length) { const empty = document.createElement("div"); empty.className = "empty-state"; setText(empty, "No jobs yet"); rows.push(empty); }
  recent.replaceChildren(...rows);
}

function renderJobsTable() {
  const visible = jobs.filter((job) => jobsFilter === "all" || serviceFor(job).kind === jobsFilter);
  const body = $("#jobs-table-body");
  body.replaceChildren(...visible.map((job) => {
    const service = serviceFor(job);
    const row = document.createElement("tr");
    const idCell = document.createElement("td"); idCell.className = "job-id"; setText(idCell, shortId(job.id));
    const kindCell = document.createElement("td"); const kind = document.createElement("span"); kind.className = "kind-pill"; setText(kind, `${kindSymbol(service.kind)} ${service.kind}`); kindCell.append(kind);
    const description = document.createElement("td"); description.className = "job-description"; setText(description, titleFor(job)); description.title = job.prompt;
    const statusCell = document.createElement("td"); statusCell.append(stateBadge(job.state));
    const created = document.createElement("td"); setText(created, relativeTime(job.createdAt));
    const actionCell = document.createElement("td"); const action = document.createElement("button"); action.className = "open-job"; action.type = "button"; setText(action, "View"); action.addEventListener("click", () => openJobDetail(job.id)); actionCell.append(action);
    row.append(idCell, kindCell, description, statusCell, created, actionCell); return row;
  }));
  $("#jobs-empty").hidden = visible.length > 0;
}

function renderWorkers() {
  const services = [...servicesById.values()];
  setText($("#worker-service-count"), services.length);
  setText($("#worker-text-count"), services.filter((service) => service.kind === "text").length);
  setText($("#worker-image-count"), services.filter((service) => service.kind === "image").length);
  setText($("#worker-video-count"), services.filter((service) => service.kind === "video").length);
  $("#capability-list").replaceChildren(...services.map((service) => {
    const card = document.createElement("article"); card.className = "capability-card";
    const kind = document.createElement("span"); const name = document.createElement("strong"); const provider = document.createElement("small");
    setText(kind, `${kindSymbol(service.kind)} ${service.kind}`); setText(name, service.label); setText(provider, `${service.provider} · explicit opt-in`); card.append(kind, name, provider); return card;
  }));
}

function inboxMatches(job) {
  if (inboxFilter === "completed") return job.state === "succeeded" || job.state === "failed" || job.state === "cancelled";
  if (inboxFilter === "active") return job.state === "active";
  return job.state === "queued";
}

function renderInbox() {
  setText($("#inbox-open-count"), jobs.filter((job) => job.state === "queued").length);
  setText($("#inbox-active-count"), jobs.filter((job) => job.state === "active").length);
  setText($("#inbox-completed-count"), jobs.filter((job) => ["succeeded", "failed", "cancelled"].includes(job.state)).length);
  const visible = jobs.filter(inboxMatches);
  $("#inbox-list").replaceChildren(...visible.map((job) => {
    const service = serviceFor(job);
    const card = document.createElement("article"); card.className = "inbox-card";
    const id = document.createElement("span"); id.className = "inbox-card-id"; setText(id, shortId(job.id));
    const copy = document.createElement("div"); const heading = document.createElement("h3"); const description = document.createElement("p"); setText(heading, `${service.label} · ${stateLabel(job.state)}`); setText(description, titleFor(job)); copy.append(heading, description);
    const meta = document.createElement("div"); meta.className = "inbox-card-meta"; const time = document.createElement("time"); setText(time, relativeTime(job.updatedAt || job.createdAt)); const view = document.createElement("button"); view.type = "button"; setText(view, job.output ? "View Result" : "View"); view.addEventListener("click", () => openJobDetail(job.id)); meta.append(time, view);
    card.append(id, copy, meta); return card;
  }));
  $("#inbox-empty").hidden = visible.length > 0;
}

function renderLogs() {
  $("#logs-list").replaceChildren(...jobs.flatMap((job) => {
    const service = serviceFor(job);
    const events = [{ at: job.createdAt, event: "JOB CREATED", detail: `${service.label} request submitted` }];
    if (job.state === "active") events.unshift({ at: job.updatedAt, event: "LEASE ACTIVE", detail: "A compatible worker is processing the request" });
    if (job.state === "succeeded") events.unshift({ at: job.updatedAt, event: "RESULT READY", detail: "Worker result returned to the private inbox" });
    if (["failed", "cancelled"].includes(job.state)) events.unshift({ at: job.updatedAt, event: stateLabel(job.state).toUpperCase(), detail: "The request closed without a completed result" });
    return events.map((entry) => {
      const row = document.createElement("div"); row.className = "log-row";
      const time = document.createElement("time"); time.dateTime = entry.at; setText(time, formatDate(entry.at));
      const event = document.createElement("span"); event.className = "log-event"; setText(event, entry.event);
      const id = document.createElement("code"); setText(id, shortId(job.id));
      const detail = document.createElement("span"); setText(detail, entry.detail);
      row.append(time, event, id, detail); return row;
    });
  }));
}

function openJobDetail(id, push = true) {
  const job = jobs.find((item) => item.id === id);
  if (!job) return;
  selectedJobId = id;
  currentRoute = "job-detail";
  $$("[data-view]").forEach((view) => { view.hidden = view.dataset.view !== "job-detail"; });
  $$('[data-route]').forEach((control) => control.classList.remove("active"));
  const service = serviceFor(job);
  $("#detail-state").replaceChildren(stateBadge(job.state));
  setText($("#detail-title"), `Job ${shortId(job.id)}`);
  setText($("#detail-subtitle"), titleFor(job));
  setText($("#detail-type"), service.kind.toUpperCase());
  setText($("#detail-provider"), service.provider);
  setText($("#detail-created"), formatDate(job.createdAt));
  setText($("#detail-status"), stateLabel(job.state));
  setText($("#detail-prompt"), job.prompt);
  $("#detail-result-block").hidden = !job.output;
  $("#detail-waiting").hidden = Boolean(job.output);
  if (job.output) $("#detail-result").replaceChildren(mediaResult(job, service)); else $("#detail-result").replaceChildren();
  if (push && location.pathname !== `/jobs/${id}`) history.pushState({ jobId: id }, "", `/jobs/${id}`);
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function loadServices() {
  const data = await api("/api/services");
  servicesById.clear();
  const groups = new Map();
  data.services.forEach((service) => { servicesById.set(service.id, service); if (!groups.has(service.kind)) groups.set(service.kind, []); groups.get(service.kind).push(service); });
  const labels = { text: "TEXT & CHAT", image: "IMAGE", video: "VIDEO" };
  serviceId.replaceChildren(...["text", "image", "video"].map((kind) => {
    const group = document.createElement("optgroup"); group.label = labels[kind];
    (groups.get(kind) || []).forEach((service) => { const option = document.createElement("option"); option.value = service.id; setText(option, `${service.label} · ${service.provider}`); group.append(option); });
    return group;
  }));
}

async function loadJobs() {
  const data = await api("/api/jobs");
  jobs = data.jobs;
  if (currentRoute === "job-detail" && selectedJobId) openJobDetail(selectedJobId, false); else renderRoute(currentRoute);
}

async function loadWorkspace() { await Promise.all([loadServices(), loadJobs()]); }

function openApp(route = routeFromPath()) {
  landingView.hidden = true; accessOverlay.hidden = true; workspaceOverlay.hidden = true; appShell.hidden = false;
  navigate(route, false);
  clearInterval(poller); poller = setInterval(() => loadJobs().catch(() => {}), 5000);
}

function publicRequestRecord() {
  try { return JSON.parse(sessionStorage.getItem(PUBLIC_REQUEST_KEY) || "null"); }
  catch { return null; }
}

function renderPublicRequestStatus(job) {
  $("#public-request-status").hidden = false;
  setText($("#public-request-id"), shortId(job.id));
  $("#public-request-state").replaceChildren(stateBadge(job.state));
  setText($("#public-request-prompt-copy"), job.prompt);
  const result = $("#public-request-result");
  if (job.output) result.replaceChildren(mediaResult(job, serviceFor(job)));
  else {
    const waiting = document.createElement("p");
    setText(waiting, job.state === "active" ? "A compatible worker is processing this request." : "Waiting for a compatible worker.");
    result.replaceChildren(waiting);
  }
}

async function refreshPublicRequest() {
  const record = publicRequestRecord();
  if (!record?.id || !record?.token) return;
  const job = await publicRequestApi(`/api/requests/${record.id}`, { headers: { "x-request-token": record.token } });
  renderPublicRequestStatus(job);
  if (["succeeded", "failed", "cancelled"].includes(job.state)) clearInterval(publicRequestPoller);
}

function startPublicRequestPolling() {
  clearInterval(publicRequestPoller);
  refreshPublicRequest().catch(() => {});
  publicRequestPoller = setInterval(() => refreshPublicRequest().catch(() => {}), 4_000);
}

function lockApp() {
  sessionStorage.removeItem(TOKEN_KEY); clearInterval(poller); appShell.hidden = true; landingView.hidden = false; accessOverlay.hidden = true; workspaceOverlay.hidden = true; accessKey.value = ""; history.replaceState({ publicRoute: "home" }, "", "/"); showPublicRoute("home", false);
}

function showAccess() {
  accessOverlay.hidden = false;
  startPublicRequestPolling();
  requestAnimationFrame(() => publicRequestPrompt.focus());
}
function hideAccess() { accessOverlay.hidden = true; clearInterval(publicRequestPoller); setText(accessError, ""); setText(publicRequestError, ""); }
function showWorkspace() { workspaceOverlay.hidden = false; requestAnimationFrame(() => accessKey.focus()); }
function hideWorkspace() { workspaceOverlay.hidden = true; setText(accessError, ""); }

publicRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  publicRequestSubmit.disabled = true;
  setText(publicRequestError, "");
  try {
    const created = await publicRequestApi("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: publicRequestPrompt.value,
        serviceId: publicRequestService.value,
        isPublic: publicRequestPublish.checked
      })
    });
    sessionStorage.setItem(PUBLIC_REQUEST_KEY, JSON.stringify({ id: created.job.id, token: created.requesterToken }));
    renderPublicRequestStatus(created.job);
    publicRequestPrompt.value = "";
    publicRequestPublish.checked = false;
    startPublicRequestPolling();
  } catch (error) {
    setText(publicRequestError, error.message);
  } finally {
    publicRequestSubmit.disabled = false;
  }
});

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault(); sessionStorage.setItem(TOKEN_KEY, accessKey.value.trim()); setText(accessError, "");
  try { await loadWorkspace(); openApp("dashboard"); history.replaceState({ route: "dashboard" }, "", "/dashboard"); }
  catch (error) { sessionStorage.removeItem(TOKEN_KEY); setText(accessError, error.message); }
});

jobForm.addEventListener("submit", async (event) => {
  event.preventDefault(); submitJob.disabled = true; setText(jobError, "");
  try {
    await api("/api/jobs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ prompt: prompt.value, serviceId: serviceId.value, isPublic: publishJob.checked }) });
    prompt.value = ""; publishJob.checked = false; setText(promptCount, "0 / 8000"); await loadJobs(); navigate("inbox");
  } catch (error) { setText(jobError, error.message); }
  finally { submitJob.disabled = false; }
});

$("#open-access").addEventListener("click", showAccess);
$("#open-workspace").addEventListener("click", showWorkspace);
$("#hero-access").addEventListener("click", showAccess);
$("#close-access").addEventListener("click", hideAccess);
$("#close-workspace").addEventListener("click", hideWorkspace);
accessOverlay.addEventListener("click", (event) => { if (event.target === accessOverlay) hideAccess(); });
workspaceOverlay.addEventListener("click", (event) => { if (event.target === workspaceOverlay) hideWorkspace(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !accessOverlay.hidden) hideAccess();
  if (event.key === "Escape" && !workspaceOverlay.hidden) hideWorkspace();
  const publicJobCardControl = event.target.closest?.("[data-public-job-id]");
  if (publicJobCardControl && ["Enter", " "].includes(event.key)) { event.preventDefault(); openPublicJobDetail(publicJobCardControl.dataset.publicJobId); }
});
$("#sign-out").addEventListener("click", lockApp);
$("#mobile-menu").addEventListener("click", () => appNav.classList.toggle("open"));
prompt.addEventListener("input", () => setText(promptCount, `${prompt.value.length} / 8000`));
$("#refresh").addEventListener("click", () => loadJobs().catch((error) => setText(jobError, error.message)));
$("#refresh-logs").addEventListener("click", () => loadJobs().catch(() => {}));
$("#back-to-jobs").addEventListener("click", () => navigate("jobs"));
$("#public-job-back").addEventListener("click", () => showPublicRoute("explore"));

document.addEventListener("click", (event) => {
  const publicJobCardControl = event.target.closest("[data-public-job-id]");
  if (publicJobCardControl && !event.target.closest("a,button")) { openPublicJobDetail(publicJobCardControl.dataset.publicJobId); return; }
  const publicRouteControl = event.target.closest("[data-public-route]");
  if (publicRouteControl && landingView.contains(publicRouteControl)) { event.preventDefault(); showPublicRoute(publicRouteControl.dataset.publicRoute); }
  if (event.target.closest(".public-submit")) showAccess();
  const publicFilterControl = event.target.closest("[data-public-filter]");
  if (publicFilterControl) {
    publicFilter = publicFilterControl.dataset.publicFilter;
    $$("[data-public-filter]").forEach((button) => button.classList.toggle("active", button === publicFilterControl));
    renderPublicExplorer();
  }
  const routeControl = event.target.closest("[data-route]");
  if (routeControl && appShell.contains(routeControl)) { event.preventDefault(); navigate(routeControl.dataset.route); }
  const filter = event.target.closest("[data-filter]");
  if (filter) { jobsFilter = filter.dataset.filter; $$("[data-filter]").forEach((button) => button.classList.toggle("active", button === filter)); renderJobsTable(); }
  const inboxTab = event.target.closest("[data-inbox-filter]");
  if (inboxTab) { inboxFilter = inboxTab.dataset.inboxFilter; $$("[data-inbox-filter]").forEach((button) => button.classList.toggle("active", button === inboxTab)); renderInbox(); }
});

window.addEventListener("popstate", () => {
  if (["/", "/explore", "/network", "/docs"].includes(location.pathname)) { showPublicRoute(publicRouteFromPath(), false); return; }
  const publicJobId = publicJobIdFromPath();
  if (publicJobId) { openPublicJobDetail(publicJobId, false); return; }
  if (!token()) { showPublicRoute("home", false); showWorkspace(); return; }
  const detailMatch = location.pathname.match(/^\/jobs\/([0-9a-f-]+)$/i);
  if (detailMatch) openJobDetail(detailMatch[1], false); else { appShell.hidden = false; landingView.hidden = true; navigate(routeFromPath(), false); }
});

loadPublicSite().catch(() => {
  const empty = document.createElement("div"); empty.className = "public-home-empty";
  setText(empty, "Public activity is temporarily unavailable.");
  $("#home-public-jobs").replaceChildren(empty);
});

const initialPublicJobId = publicJobIdFromPath();
if (initialPublicJobId) {
  openPublicJobDetail(initialPublicJobId, false);
} else if (["/", "/explore", "/network", "/docs"].includes(location.pathname)) {
  showPublicRoute(publicRouteFromPath(), false);
} else if (token()) loadWorkspace().then(() => {
  const detailMatch = location.pathname.match(/^\/jobs\/([0-9a-f-]+)$/i);
  openApp(detailMatch ? "jobs" : routeFromPath());
  if (detailMatch) openJobDetail(detailMatch[1], false);
}).catch(lockApp);
else {
  showPublicRoute("home", false);
  showWorkspace();
}