export type BanAppealSource = 'command' | 'dashboard' | 'automod' | 'massban' | 'unknown';

export type BanAppealState = 'none' | 'pending' | 'approved' | 'denied' | 'dismissed' | 'blacklisted';

export type BanAppealHistoryAction = 'ban' | 'submit' | 'approve' | 'deny' | 'dismiss' | 'blacklist' | 'unban';

export interface IBanAppealAnswers {
  whatHappened: string;
  whyLift: string;
  whatDifferent: string;
  evidence: string;
  onlyFluxerAccount: 'yes' | 'no' | null;
}

export interface IBanAppealHistoryEntry {
  at: Date;
  by: string;
  action: BanAppealHistoryAction;
  note: string;
}

export interface IBanAppeal {
  guildId: string;
  userId: string;
  caseNumber: number | null;
  source: BanAppealSource;
  banReason: string;
  moderatorId: string;
  permanent: boolean;
  eligible: boolean;
  state: BanAppealState;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  staffReason: string;
  nextEligibleAt: Date | null;
  answers: IBanAppealAnswers;
  history: IBanAppealHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}
