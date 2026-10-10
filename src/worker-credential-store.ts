import { createHash, randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";

export type WorkerCredential = {
  id: string;
  issuanceId: string;
  label: string;
  workerId: string;
  enabled: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type RegisterWorkerCredentialInput = {
  issuanceId: string;
  label: string;
  workerId: string;
  token: string;
};

export interface WorkerCredentialStore {
  initialize(): Promise<void>;
  register(input: RegisterWorkerCredentialInput): Promise<{ credential: WorkerCredential; created: boolean }>;
  authenticate(token: string, workerId: string): Promise<boolean>;
  list(): Promise<WorkerCredential[]>;
  revoke(id: string): Promise<WorkerCredential | null>;
  revokeOpenWorker(workerId: string): Promise<void>;
  isOpenWorkerRevoked(workerId: string): Promise<boolean>;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function credentialFromRow(row: QueryResultRow): WorkerCredential {
  return {
    id: row.id,
    issuanceId: row.issuance_id,
    label: row.label,
    workerId: row.worker_id,
    enabled: row.enabled,
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null
  };
}

function sameRegistration(record: WorkerCredential & { tokenHash: string }, input: RegisterWorkerCredentialInput): boolean {
  return record.issuanceId === input.issuanceId && record.label === input.label && record.workerId === input.workerId && record.tokenHash === hashToken(input.token);
}

export class MemoryWorkerCredentialStore implements WorkerCredentialStore {
  private readonly records = new Map<string, WorkerCredential & { tokenHash: string }>();
  private readonly revokedOpenWorkers = new Set<string>();

  async initialize(): Promise<void> {}

  async register(input: RegisterWorkerCredentialInput): Promise<{ credential: WorkerCredential; created: boolean }> {
    const existing = [...this.records.values()].find((record) => record.issuanceId === input.issuanceId);
    if (existing) {
      if (!sameRegistration(existing, input)) throw new Error("issuance_id_conflict");
      if (!existing.enabled) throw new Error("credential_revoked");
      const { tokenHash: _tokenHash, ...credential } = existing;
      return { credential: { ...credential }, created: false };
    }
    if ([...this.records.values()].some((record) => record.workerId === input.workerId)) throw new Error("worker_id_conflict");
    const credential: WorkerCredential = {
      id: randomUUID(), issuanceId: input.issuanceId, label: input.label, workerId: input.workerId,
      enabled: true, createdAt: new Date(), lastUsedAt: null
    };
    this.records.set(credential.id, { ...credential, tokenHash: hashToken(input.token) });
    return { credential: { ...credential }, created: true };
  }

  async authenticate(token: string, workerId: string): Promise<boolean> {
    const tokenHash = hashToken(token);
    const record = [...this.records.values()].find((candidate) => candidate.enabled && candidate.tokenHash === tokenHash && candidate.workerId === workerId);
    if (!record) return false;
    record.lastUsedAt = new Date();
    return true;
  }

  async list(): Promise<WorkerCredential[]> {
    return [...this.records.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(({ tokenHash: _tokenHash, ...credential }) => ({ ...credential }));
  }

  async revoke(id: string): Promise<WorkerCredential | null> {
    const record = this.records.get(id);
    if (!record) return null;
    record.enabled = false;
    const { tokenHash: _tokenHash, ...credential } = record;
    return { ...credential };
  }

  async revokeOpenWorker(workerId: string): Promise<void> {
    this.revokedOpenWorkers.add(workerId);
  }

  async isOpenWorkerRevoked(workerId: string): Promise<boolean> {
    return this.revokedOpenWorkers.has(workerId);
  }
}

export class PostgresWorkerCredentialStore implements WorkerCredentialStore {
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS worker_credentials (
        id text PRIMARY KEY,
        issuance_id text NOT NULL UNIQUE,
        label text NOT NULL,
        worker_id text NOT NULL,
        token_hash text NOT NULL UNIQUE,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL,
        last_used_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS worker_credentials_enabled_idx ON worker_credentials (enabled);
      CREATE UNIQUE INDEX IF NOT EXISTS worker_credentials_active_worker_idx ON worker_credentials (worker_id) WHERE enabled=true;
      CREATE TABLE IF NOT EXISTS revoked_open_workers (
        worker_id text PRIMARY KEY,
        revoked_at timestamptz NOT NULL
      );
    `);
  }

  async register(input: RegisterWorkerCredentialInput): Promise<{ credential: WorkerCredential; created: boolean }> {
    const tokenHash = hashToken(input.token);
    const prior = await this.pool.query("SELECT * FROM worker_credentials WHERE issuance_id=$1", [input.issuanceId]);
    if (prior.rows[0]) {
      const row = prior.rows[0];
      if (row.label !== input.label || row.worker_id !== input.workerId || row.token_hash !== tokenHash) throw new Error("issuance_id_conflict");
      if (!row.enabled) throw new Error("credential_revoked");
      return { credential: credentialFromRow(row), created: false };
    }
    const activeWorker = await this.pool.query("SELECT id FROM worker_credentials WHERE worker_id=$1 AND enabled=true", [input.workerId]);
    if (activeWorker.rows[0]) throw new Error("worker_id_conflict");
    try {
      const inserted = await this.pool.query(
        `INSERT INTO worker_credentials (id,issuance_id,label,worker_id,token_hash,enabled,created_at,last_used_at)
         VALUES ($1,$2,$3,$4,$5,true,$6,NULL) RETURNING *`,
        [randomUUID(), input.issuanceId, input.label, input.workerId, tokenHash, new Date()]
      );
      return { credential: credentialFromRow(inserted.rows[0]), created: true };
    } catch (error) {
      const concurrent = await this.pool.query("SELECT * FROM worker_credentials WHERE issuance_id=$1", [input.issuanceId]);
      const row = concurrent.rows[0];
      if (row) {
        if (row.label !== input.label || row.worker_id !== input.workerId || row.token_hash !== tokenHash) throw new Error("issuance_id_conflict");
        if (!row.enabled) throw new Error("credential_revoked");
        return { credential: credentialFromRow(row), created: false };
      }
      const conflictingWorker = await this.pool.query("SELECT id FROM worker_credentials WHERE worker_id=$1 AND enabled=true", [input.workerId]);
      if (conflictingWorker.rows[0]) throw new Error("worker_id_conflict");
      throw error;
    }
  }

  async authenticate(token: string, workerId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE worker_credentials SET last_used_at=$3
       WHERE token_hash=$1 AND worker_id=$2 AND enabled=true RETURNING id`,
      [hashToken(token), workerId, new Date()]
    );
    return Boolean(result.rows[0]);
  }

  async list(): Promise<WorkerCredential[]> {
    const result = await this.pool.query("SELECT * FROM worker_credentials ORDER BY created_at DESC");
    return result.rows.map(credentialFromRow);
  }

  async revoke(id: string): Promise<WorkerCredential | null> {
    const result = await this.pool.query("UPDATE worker_credentials SET enabled=false WHERE id=$1 RETURNING *", [id]);
    return result.rows[0] ? credentialFromRow(result.rows[0]) : null;
  }

  async revokeOpenWorker(workerId: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO revoked_open_workers (worker_id, revoked_at) VALUES ($1,$2) ON CONFLICT (worker_id) DO NOTHING",
      [workerId, new Date()]
    );
  }

  async isOpenWorkerRevoked(workerId: string): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM revoked_open_workers WHERE worker_id=$1", [workerId]);
    return Boolean(result.rows[0]);
  }
}
