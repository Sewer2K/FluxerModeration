const FLUXER_EPOCH = 1_420_070_400_000;

export function snowflakeToDate(id: string | null | undefined): Date | null {
  if (!id || !/^\d{15,21}$/.test(String(id))) return null;
  try {
    return new Date(Number(BigInt(id) >> 22n) + FLUXER_EPOCH);
  } catch {
    return null;
  }
}
