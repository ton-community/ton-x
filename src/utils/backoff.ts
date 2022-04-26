import { createBackoff } from "teslabot";

export const backoff = createBackoff({
    maxFailureCount: 5,
    onError: (e, i) => i > 3 && console.warn(e)
});