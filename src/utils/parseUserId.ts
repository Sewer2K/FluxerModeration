const SNOWFLAKE = /(?:0|[1-9]\d{16,})/;

export default function parseUserId(arg: string | null | undefined): string | null {
  if (!arg?.trim()) return null;

  const trimmed = arg.trim();
  const mentionMatch = trimmed.match(new RegExp(`^<@!?(${SNOWFLAKE.source})>$`));
  if (mentionMatch?.[1]) return mentionMatch[1];

  const wrappedMatch = trimmed.match(new RegExp(`^<(${SNOWFLAKE.source})>$`));
  if (wrappedMatch?.[1]) return wrappedMatch[1];

  if (new RegExp(`^${SNOWFLAKE.source}$`).test(trimmed)) return trimmed;

  const embedded = trimmed.match(new RegExp(`<@!?(${SNOWFLAKE.source})>`));
  return embedded?.[1] ?? null;
}

/*

   ("`-''-/").___..--''"`-._
   `6_ 6  )   `-.  (     ).`-.__.`)
   (_Y_.)'  ._   )  `._ `. ``-..-`
  _..`--'_..-_/  /--'_.' ,'
(il),-''  (li),'  ((!.-'

*/
