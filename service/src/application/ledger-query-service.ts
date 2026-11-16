import type {
  AuthContext,
  BalanceLine,
  Page,
  PayTransaction,
  TransactionListOptions
} from "../domain/types.ts";
import type {
  LedgerRepository,
  PaymentRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export class LedgerQueryService {
  private readonly payments: PaymentRepository;
  private readonly ledger: LedgerRepository;
  private readonly auth: AuthService;

  constructor(payments: PaymentRepository, ledger: LedgerRepository, auth: AuthService) {
    this.payments = payments;
    this.ledger = ledger;
    this.auth = auth;
  }

  async getBalances(auth: AuthContext): Promise<BalanceLine[]> {
    this.auth.requireScope(auth, "payments:read");
    return this.ledger.balances(auth.merchantId);
  }

  async listTransactions(
    auth: AuthContext,
    options: TransactionListOptions
  ): Promise<Page<PayTransaction>> {
    this.auth.requireScope(auth, "payments:read");
    return this.payments.listTransactions(auth.merchantId, options);
  }
}
