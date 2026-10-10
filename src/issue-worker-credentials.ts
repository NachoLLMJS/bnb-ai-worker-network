import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, open, stat, unlink, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

import { fileURLToPath } from "node:url";

type Fetcher = typeof fetch;
export type PreparedCredential = {
  issuanceId: string;
  label: string;
  workerId: string;
  token: string;
  status: "pending" | "active";
  credentialId: string | null;
};

type CredentialDocument = {
  generatedAt: string;
  coordinatorUrl: string;
  warning: string;
  credentials: PreparedCredential[];
};

export function validateCoordinatorUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Coordinator URL must use HTTPS unless it is loopback");
  if (url.username || url.password || url.search || url.hash) throw new Error("Coordinator URL must not contain credentials, query strings, or fragments");
  return url.toString().replace(/\/$/, "");
}

export async function registerWorkerCredentials(input: {
  baseUrl: string;
  adminToken: string;
  credentials: PreparedCredential[];
  fetcher?: Fetcher;
  onProgress?: (credentials: PreparedCredential[]) => Promise<void>;
}): Promise<PreparedCredential[]> {
  const baseUrl = validateCoordinatorUrl(input.baseUrl);
  const fetcher = input.fetcher ?? fetch;
  for (const item of input.credentials) {
    const response = await fetcher(`${baseUrl}/api/admin/worker-credentials/${item.issuanceId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${input.adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ label: item.label, workerId: item.workerId, token: item.token })
    });
    if (!response.ok) throw new Error(`credential registration failed (${response.status})`);
    const body = await response.json() as { credential?: Record<string, unknown> };
    const credential = body.credential;
    if (!credential || typeof credential.id !== "string" || credential.issuanceId !== item.issuanceId || credential.label !== item.label || credential.workerId !== item.workerId || credential.enabled !== true) {
      throw new Error("credential registration returned mismatched metadata");
    }
    item.status = "active";
    item.credentialId = credential.id;
    await input.onProgress?.(input.credentials);
  }
  return input.credentials;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function createBatch(count: number, labelPrefix: string, workerPrefix: string): PreparedCredential[] {
  return Array.from({ length: count }, (_, index) => ({
    issuanceId: randomUUID(), label: `${labelPrefix} ${index + 1}`, workerId: `${workerPrefix}-${index + 1}`,
    token: `bncw_${randomBytes(32).toString("base64url")}`, status: "pending" as const, credentialId: null
  }));
}

async function verifyIdentity(handle: FileHandle, path: string): Promise<void> {
  const [opened, named] = await Promise.all([handle.stat(), lstat(path)]);
  if (named.isSymbolicLink()) throw new Error("credential path must not be a symbolic link");
  if (opened.dev !== named.dev || opened.ino !== named.ino) throw new Error("credential path changed during secure setup");
}

async function secureOutputPath(path: string): Promise<void> {
  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference='Stop'",
      "$path=$env:BNB_CREDENTIAL_PATH",
      "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
      "$sid=$identity.User",
      "$acl=New-Object Security.AccessControl.FileSecurity",
      "$acl.SetOwner($sid)",
      "$acl.SetAccessRuleProtection($true,$false)",
      "$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow)",
      "$acl.AddAccessRule($rule)",
      "Set-Acl -LiteralPath $path -AclObject $acl",
      "$verified=Get-Acl -LiteralPath $path",
      "$rules=@($verified.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))",
      "if(-not $verified.AreAccessRulesProtected -or $rules.Count -ne 1){exit 41}",
      "$actual=$rules[0]",
      "if($actual.IdentityReference.Value -ne $sid.Value -or $actual.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){exit 42}",
      "if(($actual.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl){exit 43}"
    ].join(";");
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, BNB_CREDENTIAL_PATH: path },
      stdio: "pipe",
      windowsHide: true
    });
    return;
  }
  await chmod(path, 0o600);
  if (((await stat(path)).mode & 0o777) !== 0o600) throw new Error("credential file permissions are not owner-only");
}

async function reserveAndWriteSecretFile(path: string, document: CredentialDocument): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
  let success = false;
  try {
    await verifyIdentity(handle, path);
    await secureOutputPath(path);
    await verifyIdentity(handle, path);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.sync();
    success = true;
  } finally {
    await handle.close();
    if (!success) await unlink(path).catch(() => {});
  }
}

async function readSecuredSecretFile(path: string): Promise<CredentialDocument> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    await verifyIdentity(handle, path);
    await secureOutputPath(path);
    await verifyIdentity(handle, path);
    return JSON.parse(await handle.readFile("utf8")) as CredentialDocument;
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const baseUrl = validateCoordinatorUrl(argument("--url") || process.env.PUBLIC_BASE_URL?.trim() || "");
  const adminToken = process.env.ADMIN_ACCESS_TOKEN?.trim();
  const output = argument("--output");
  const count = Number(argument("--count") || 5);
  const labelPrefix = argument("--label-prefix") || "Friend Worker";
  const workerPrefix = argument("--worker-prefix") || "friend-worker";
  const resume = process.argv.includes("--resume");
  if (!adminToken) throw new Error("ADMIN_ACCESS_TOKEN is required");
  if (!output) throw new Error("--output is required");
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("--count must be an integer from 1 to 100");
  const outputPath = resolve(output);
  let document: CredentialDocument;
  if (resume) {
    document = await readSecuredSecretFile(outputPath);
    if (validateCoordinatorUrl(document.coordinatorUrl) !== baseUrl) throw new Error("resume file coordinator does not match --url");
  } else {
    document = {
      generatedAt: new Date().toISOString(), coordinatorUrl: baseUrl,
      warning: "Contains plaintext worker credentials. Give one workerId/token pair to each person through a private channel.",
      credentials: createBatch(count, labelPrefix, workerPrefix)
    };
    await reserveAndWriteSecretFile(outputPath, document);
  }
  await registerWorkerCredentials({ baseUrl, adminToken, credentials: document.credentials });
  console.log(`Registered ${document.credentials.length} worker credentials. Secret file: ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
