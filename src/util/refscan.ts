/**
 * Walk an arbitrary value tree and emit every string leaf with its dotted path.
 * Reused by name-reference formats (HS3) to discover edges. Iterative (explicit
 * stack) so deeply nested JSON cannot overflow the native call stack.
 */
export function scanStringLeaves(
  root: unknown,
  emit: (value: string, path: string) => void,
  options: { skipKeys?: ReadonlySet<string>; path?: string } = {},
): void {
  const { skipKeys, path = '' } = options;
  const stack: Array<{ value: unknown; path: string }> = [{ value: root, path }];

  while (stack.length > 0) {
    const { value, path: p } = stack.pop()!;
    if (typeof value === 'string') {
      emit(value, p || 'ref');
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) stack.push({ value: value[i], path: `${p}[${i}]` });
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (skipKeys?.has(k)) continue;
        stack.push({ value: v, path: p ? `${p}.${k}` : k });
      }
    }
  }
}
