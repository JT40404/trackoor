/** A transaction as returned by getTransactionsForAddress with transactionDetails "full" + encoding "jsonParsed". */
export interface RawTx {
  slot: number;
  transactionIndex?: number;
  blockTime: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta: any;
}

export interface HistoryPage {
  data: RawTx[];
  paginationToken: string | null;
}
