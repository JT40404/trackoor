/** Shared API response types (imported by both server and client code). */

export type Severity = "high" | "medium" | "low" | "info";

export interface Signal {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  wallets?: string[];
}

export interface TokenMeta {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string;
  decimals: number;
  supply: number;
  tokenProgram: string;
}

export interface EarlyBuyer {
  wallet: string;
  rank: number;
  firstSlot: number;
  slotOffset: number;
  firstTime: number;
  firstSignature: string;
  sol: number;
  tokens: number;
  pctSupply: number;
  buys: number;
  isCreator: boolean;
  sameSlotAsCreate: boolean;
  jitoTip: number;
  multiWalletTx: boolean;
}

export interface SlotBuy {
  wallet: string;
  sol: number;
  pctSupply: number;
  signature: string;
}

export interface SlotColumn {
  offset: number;
  slot: number;
  buys: SlotBuy[];
}

export interface LaunchAnalysis {
  mint: string;
  meta: TokenMeta;
  creator: string;
  createSignature: string;
  createSlot: number;
  createTime: number;
  devBuy: { sol: number; tokens: number; pctSupply: number } | null;
  earlyBuyers: EarlyBuyer[];
  slots: SlotColumn[];
  signals: Signal[];
  txsScanned: number;
  windowEndSlot: number;
  generatedAt: number;
}

export type PositionStatus = "holding" | "partial" | "exited" | "transferred" | "unknown";

export interface PositionEvent {
  kind: "buy" | "sell" | "transfer_in" | "transfer_out";
  tokens: number;
  sol: number;
  time: number;
  signature: string;
  venue: "pump" | "other" | "transfer";
  counterparty?: string;
}

export interface Position {
  status: PositionStatus;
  boughtTokens: number;
  soldTokens: number;
  transferredIn: number;
  transferredOut: number;
  remainingTokens: number;
  solIn: number;
  solOut: number;
  realizedPnlSol: number;
  /** Token-weighted median time between buying and selling/sending, in seconds. */
  holdMedianSec: number | null;
  /** When the oldest still-held tokens were acquired (unix seconds). */
  holdingSince: number | null;
  firstTime: number | null;
  lastTime: number | null;
  buys: number;
  sells: number;
  /** Sells with no matching buy inside the scanned history (bought before the window). */
  unmatchedSellTokens: number;
  events: PositionEvent[];
  truncated?: boolean;
}

export interface Funder {
  address: string;
  sol: number;
  time: number;
  signature: string;
  label?: string;
}

export interface EarlyWalletDetail {
  wallet: string;
  funder: Funder | null;
  firstSeen: number | null;
  ageAtLaunchSec: number | null;
  position: Position;
  remainingPctSupply: number;
  clusterId: number | null;
  /** True when one of this wallet's lookups failed (usually a rate limit), so its data is incomplete. */
  incomplete?: boolean;
}

export interface Cluster {
  id: number;
  kind: "creator" | "shared";
  root: string;
  rootLabel?: string;
  wallets: string[];
  pctSupply: number;
  sol: number;
}

/** A wallet that sent SOL to one or more early buyers before launch. */
export interface FunderNode {
  address: string;
  label?: string;
  /** Early buyers this address funded. */
  wallets: string[];
  /** SOL it sent to those wallets (the inflow we traced for each). */
  sol: number;
  pctSupply: number;
  /** Where this funder itself got SOL before launch (second hop). */
  parent: { address: string; label?: string; sol: number } | null;
  /** Other launches (searched on this site) where it also funded early buyers. */
  otherLaunches: number;
  otherMints: string[];
  clusterId: number | null;
  isExchange: boolean;
}

export interface WalletsAnalysis {
  mint: string;
  wallets: EarlyWalletDetail[];
  funders: FunderNode[];
  clusters: Cluster[];
  signals: Signal[];
  /** How many wallets have incomplete data. Results with gaps are cached briefly so a reload can fill them in. */
  incompleteWallets: number;
  generatedAt: number;
}

export type TraderLabel = "smart" | "flipper" | "bot" | "losing" | "unproven";

export interface TraderStats {
  closedPositions: number;
  tokensTraded: number;
  winRate: number | null;
  realizedPnlSol: number;
  medianHoldSec: number | null;
  avgBuySol: number | null;
  txsScanned: number;
}

export interface TraderRating {
  label: TraderLabel;
  /** 0-100, null when there isn't enough history to judge. */
  score: number | null;
  reasons: string[];
}

export interface SmartWallet {
  wallet: string;
  stats: TraderStats | null;
  rating: TraderRating;
  incomplete?: boolean;
}

export interface SmartAnalysis {
  mint: string;
  wallets: SmartWallet[];
  incompleteWallets: number;
  generatedAt: number;
}

export interface LeaderboardWallet {
  wallet: string;
  rating: TraderRating;
  stats: TraderStats;
  mints: string[];
  lastSeen: number;
}

export interface LeaderboardFunder {
  address: string;
  label?: string;
  launches: { mint: string; wallets: number; time: number }[];
  walletsFunded: number;
  lastSeen: number;
}

export interface Leaderboard {
  smart: LeaderboardWallet[];
  funders: LeaderboardFunder[];
  persistent: boolean;
  generatedAt: number;
}

export interface TokenPosition extends Omit<Position, "events"> {
  mint: string;
  venue: "pump" | "other" | "mixed";
}

export interface FundingEdge {
  address: string;
  label?: string;
  sol: number;
  count: number;
}

export interface WalletProfile {
  wallet: string;
  firstSeen: number | null;
  tokens: TokenPosition[];
  funding: { sources: FundingEdge[]; recipients: FundingEdge[] };
  /** Launches (searched on this site) where this wallet funded early buyers. */
  fundedLaunches: { mint: string; wallets: number; time: number }[];
  stats: {
    tokensTraded: number;
    closedPositions: number;
    winRate: number | null;
    realizedPnlSol: number;
    solVolume: number;
    medianHoldSec: number | null;
    avgBuySol: number | null;
    pumpShare: number | null;
  };
  txsScanned: number;
  truncated: boolean;
  generatedAt: number;
}

export interface ApiError {
  error: string;
  hint?: string;
}
