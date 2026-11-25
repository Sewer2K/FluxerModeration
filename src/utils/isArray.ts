// better than `Array.isArray` as it does not potentially lose the type-safety on the elements
export function isArray<T>(iterable: Iterable<T> | ReadonlyArray<T>): iterable is ReadonlyArray<T>;
export function isArray(iterable: unknown): iterable is ReadonlyArray<unknown>;
export function isArray(input: unknown): boolean {
  return input instanceof Array;
}
