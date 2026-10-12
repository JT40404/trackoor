import { PublicKey } from "@solana/web3.js";
import { ATA_PROGRAM, TOKEN_PROGRAM } from "./constants";

export function isValidAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try {
    return new PublicKey(value).toBytes().length === 32;
  } catch {
    return false;
  }
}

/** Associated token account address. Deterministic, so it works even after the account is closed. */
export function deriveAta(owner: string, mint: string, tokenProgram: string = TOKEN_PROGRAM): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ATA_PROGRAM),
  );
  return ata.toBase58();
}
