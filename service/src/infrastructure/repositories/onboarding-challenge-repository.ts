import { BaseRepository } from "./base-repository.ts";

export class OnboardingChallengeRepository extends BaseRepository {
  async create(input: {
    id: string;
    challengeHash: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.t("onboarding_challenges")}
        (id, challenge_hash, created_at, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [input.id, input.challengeHash, input.now.toISOString(), input.expiresAt.toISOString()]
    );
  }

  async consume(challengeHash: string, now: Date): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE ${this.t("onboarding_challenges")}
          SET consumed_at = $2
        WHERE challenge_hash = $1 AND consumed_at IS NULL AND expires_at > $2`,
      [challengeHash, now.toISOString()]
    );
    return (result.rowCount ?? 0) === 1;
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.db.query(
      `DELETE FROM ${this.t("onboarding_challenges")}
        WHERE expires_at <= $1 OR consumed_at IS NOT NULL`,
      [now.toISOString()]
    );
  }
}
