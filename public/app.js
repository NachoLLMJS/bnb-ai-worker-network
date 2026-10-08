const accessPanel = document.querySelector("#access-panel");
const accessForm = document.querySelector("#access-form");
const accessKey = document.querySelector("#access-key");
const accessError = document.querySelector("#access-error");
const workspace = document.querySelector("#workspace");
const jobForm = document.querySelector("#job-form");
const prompt = document.querySelector("#prompt");
const promptCount = document.querySelector("#prompt-count");
const submitJob = document.querySelector("#submit-job");
const jobError = document.querySelector("#job-error");
const jobsList = document.querySelector("#jobs-list");
const emptyState = document.querySelector("#empty-state");
const refresh = document.querySelector("#refresh");
const signOut = document.querySelector("#sign-out");

const TOKEN_KEY = "worker-relay-access";
let poller;

function token() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
function authHeaders(extra = {}) { return { ...extra, Authorization: `Bearer ${token()}` }; }
function setText(element, value) { element.textContent = value; }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: authHeaders(options.headers) });
  if (response.status === 401) throw new Error("Access key rejected");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function badge(state) {
  const node = document.createElement("span");
  node.className = `state state-${state}`;
  setText(node, state.toUpperCase());
  return node;
}

function jobCard(job, index) {
  const article = document.createElement("article");
  article.className = "job-card";
  const top = document.createElement("div");
  top.className = "job-top";
  const number = document.createElement("span");
  number.className = "job-number";
  setText(number, String(index + 1).padStart(2, "0"));
  const meta = document.createElement("div");
  meta.className = "job-meta";
  const time = document.createElement("time");
  time.dateTime = job.createdAt;
  setText(time, formatDate(job.createdAt));
  meta.append(badge(job.state), time);
  top.append(number, meta);

  const requestLabel = document.createElement("p");
  requestLabel.className = "card-label";
  setText(requestLabel, "REQUEST");
  const request = document.createElement("p");
  request.className = "request-text";
  setText(request, job.prompt);
  article.append(top, requestLabel, request);

  if (job.output) {
    const divider = document.createElement("div");
    divider.className = "result-divider";
    const resultLabel = document.createElement("p");
    resultLabel.className = "card-label";
    setText(resultLabel, "RESULT");
    const result = document.createElement("pre");
    result.className = "result-text";
    setText(result, job.output);
    article.append(divider, resultLabel, result);
  } else {
    const waiting = document.createElement("div");
    waiting.className = "waiting";
    setText(waiting, job.state === "active" ? "Worker is processing this request" : "Waiting for an available worker");
    article.append(waiting);
  }
  return article;
}

async function loadJobs() {
  const data = await api("/api/jobs");
  jobsList.replaceChildren(...data.jobs.map(jobCard));
  emptyState.hidden = data.jobs.length > 0;
}

function openWorkspace() {
  accessPanel.hidden = true;
  workspace.hidden = false;
  clearInterval(poller);
  poller = setInterval(() => loadJobs().catch(() => {}), 5000);
}

function lockWorkspace() {
  sessionStorage.removeItem(TOKEN_KEY);
  clearInterval(poller);
  workspace.hidden = true;
  accessPanel.hidden = false;
  accessKey.value = "";
}

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sessionStorage.setItem(TOKEN_KEY, accessKey.value.trim());
  try {
    await loadJobs();
    setText(accessError, "");
    openWorkspace();
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    setText(accessError, error.message);
  }
});

jobForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitJob.disabled = true;
  setText(jobError, "");
  try {
    await api("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ prompt: prompt.value })
    });
    prompt.value = "";
    setText(promptCount, "0 / 8000");
    await loadJobs();
  } catch (error) {
    setText(jobError, error.message);
  } finally {
    submitJob.disabled = false;
  }
});

prompt.addEventListener("input", () => setText(promptCount, `${prompt.value.length} / 8000`));
refresh.addEventListener("click", () => loadJobs().catch((error) => setText(jobError, error.message)));
signOut.addEventListener("click", lockWorkspace);

if (token()) {
  loadJobs().then(openWorkspace).catch(lockWorkspace);
}
