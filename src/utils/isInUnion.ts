export function isInUnion<T, U extends readonly T[]>(input: T, union: U): input is U[number] {
  return union.includes(input);
}
