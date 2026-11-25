export function asIntersection<T>() {
  return <const U extends T>(u: U): U & T => u;
}
