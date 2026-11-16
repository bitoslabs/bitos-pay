import { BaseRepository } from "./base-repository.ts";

export type ConsoleChallengePurpose = "LOGIN" | "LINK";

export interface ConsoleChallengeRow {
  id: string;
  challenge_hash: string;
  purpose: ConsoleChallengePurpose;
  merchant_id: string | null;
  session_id: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

export interface ConsoleChallenge {
  id: string;
  purpose: ConsoleChallengePurpose;
  merchantId: string | null;
  sessionId: string | null;
  expiresAt: string;
}

function mapChallenge(row: ConsoleChallengeRow): ConsoleChallenge {
  return {
    id: row.id,
    purpose: row.purpose,
    merchantId: row.merchant_id,
    sessionId: row.session_id,
    expiresAt: new Date(row.expires_at).toISOString()
  };
}

export class ConsoleChallengeRepository extends BaseRepository {
  async create(input: {
    id: string;
    challengeHash: string;
    purpose: ConsoleChallengePurpose;
    merchantId: string | null;
    sessionId: string | null;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.t("console_nostr_challenges")}
        (id, challenge_hash, purpose, merchant_id, session_id, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.id,
        input.challengeHash,
        input.purpose,
        input.merchantId,
        input.sessionId,
        input.now.toISOString(),
        input.expiresAt.toISOString()
      ]
    );
  }

  async findActive(
    challengeHash: string,
    purpose: ConsoleChallengePurpose,
    now: Date
  ): Promise<ConsoleChallenge | null> {
    const result = await this.db.query<ConsoleChallengeRow>(
      `SELECT * FROM ${this.t("console_nostr_challenges")}
        WHERE challenge_hash = $1 AND purpose = $2
          AND consumed_at IS NULL AND expires_at > $3`,
      [challengeHash, purpose, now.toISOString()]
    );
    return result.rows[0] ? mapChallenge(result.rows[0]) : null;
  }

  async consume(
    challengeHash: string,
    purpose: ConsoleChallengePurpose,
    merchantId: string | null,
    sessionId: string | null,
    now: Date
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE ${this.t("console_nostr_challenges")}
          SET consumed_at = $5
        WHERE challenge_hash = $1 AND purpose = $2
          AND consumed_at IS NULL AND expires_at > $5
          AND merchant_id IS NOT DISTINCT FROM $3
          AND session_id IS NOT DISTINCT FROM $4`,
      [challengeHash, purpose, merchantId, sessionId, now.toISOString()]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.db.query(
      `DELETE FROM ${this.t("console_nostr_challenges")}
        WHERE expires_at <= $1 OR consumed_at IS NOT NULL`,
      [now.toISOString()]
    );
  }
}
