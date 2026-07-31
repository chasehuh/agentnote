/**
 * Defers inbound remote updates while an IME composition is active.
 *
 * `y-codemirror.next`'s sync plugin dispatches remote deltas into CodeMirror
 * immediately, with no `view.composing` bail-out — a Hangul composition would
 * be cut short by a peer's edit. Holding the update back is lossless because
 * Yjs updates are commutative and idempotent: applying them a moment later
 * converges to exactly the same document.
 */
export type CompositionGate<T> = {
  readonly composing: boolean;
  /** Apply now, or hold until the composition ends. */
  push: (item: T) => void;
  start: () => void;
  end: () => void;
};

export function createCompositionGate<T>(
  apply: (item: T) => void,
): CompositionGate<T> {
  let composing = false;
  let deferred: T[] = [];

  return {
    get composing() {
      return composing;
    },
    push(item) {
      if (composing) {
        deferred.push(item);
        return;
      }
      apply(item);
    },
    start() {
      composing = true;
    },
    end() {
      composing = false;
      const queued = deferred;
      deferred = [];
      for (const item of queued) apply(item);
    },
  };
}
