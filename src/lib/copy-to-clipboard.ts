/**
 * Clipboard write abstraction (Task 7.3).
 *
 * Outcome-based instead of exception-based so UI code can render success/failure
 * feedback deterministically and tests can inject the clipboard boundary:
 *
 * - writer injected  -> used verbatim (deterministic unit tests)
 * - no writer        -> navigator.clipboard.writeText when available
 * - unsupported/rejected/throwing -> resolves 'failed'; NEVER throws
 *
 * No dependency, no network, no automatic copying - invocation always originates from
 * an explicit user action.
 */

export type CopyOutcome = 'copied' | 'failed';

export type ClipboardWriter = (text: string) => Promise<void> | void;

type NavigatorWithClipboard = {
  clipboard?: {
    writeText?: (text: string) => Promise<void>;
  };
};

export async function copyToClipboard(
  text: string,
  writer?: ClipboardWriter
): Promise<CopyOutcome> {
  const write =
    writer ??
    (() => {
      if (typeof navigator === 'undefined') {
        return undefined;
      }

      return (navigator as NavigatorWithClipboard).clipboard?.writeText?.bind(
        (navigator as NavigatorWithClipboard).clipboard
      );
    })();

  if (!write) {
    // Clipboard API unavailable (insecure context, older browser): fail safely.
    return 'failed';
  }

  try {
    await write(text);

    // A silent void resolution is indistinguishable from success only because the
    // API contract guarantees rejection on failure; anything else is a failed copy.
    return 'copied';
  } catch {
    return 'failed';
  }
}
