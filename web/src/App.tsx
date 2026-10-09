import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AppState } from "./api";

type Action = "load" | "increment" | "decrement" | "reset" | "refresh";
type TrackProps = Record<string, string | number | boolean>;

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
// Sends demo-load, demo-increment, demo-decrement, demo-reset and demo-refresh
// when an action succeeds, and demo-action-failed when one fails.
function trackEvent(name: Action | "action-failed", props?: TrackProps) {
  if (typeof window !== "undefined") {
    try {
      window.pendo?.track?.(`demo-${name}`, props);
    } catch (e) {
      // Tracking must never break the app or surface as a failed action.
      console.warn("Pendo track failed", e);
    }
  }
}

// Properties for the demo-<action> event. `previous` is the last state the
// client received before this response; `next` is what the server returned.
function successProps(action: Action, previous: AppState, next: AppState, errorWasShowing: boolean): TrackProps {
  switch (action) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return { counter: next.counter, previousCounter: previous.counter };
    case "reset":
      // The counter is always 0 after a reset, so report what was cleared.
      return { previousCounter: previous.counter, previousAction: previous.lastAction };
    case "refresh":
      return {
        counter: next.counter,
        previousCounter: previous.counter,
        counterChanged: next.counter !== previous.counter,
        recoveredFromError: errorWasShowing,
      };
  }
}

// Properties for demo-action-failed. api.ts throws ApiError for non-2xx
// responses; fetch rejects with a TypeError when no response arrives at all.
function failureProps(action: Action, e: unknown): TrackProps {
  // Pendo caps the properties payload at 512 bytes.
  const errorMessage = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  if (e instanceof ApiError) {
    // A status code is categorical, and Pendo groups string properties best.
    return { action, errorType: "http", httpStatus: String(e.status), errorMessage };
  }
  return { action, errorType: e instanceof TypeError ? "network" : "unknown", errorMessage };
}

// Loading the initial state is app initialization, so it runs once per page
// load. React StrictMode mounts components twice in development, which would
// otherwise send a second request and a duplicate demo-load event.
let initialLoadStarted = false;

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);
  // Latest state received from the server. Read when a response arrives rather
  // than when the button is clicked, so overlapping requests from quick repeat
  // clicks still report the right previousCounter.
  const lastState = useRef(state);

  const run = async (action: Action, fn: () => Promise<AppState>) => {
    const errorWasShowing = error !== null;
    try {
      setError(null);
      const next = await fn();
      const previous = lastState.current;
      lastState.current = next;
      setState(next);
      trackEvent(action, successProps(action, previous, next, errorWasShowing));
    } catch (e) {
      setError((e as Error).message);
      trackEvent("action-failed", failureProps(action, e));
    }
  };

  useEffect(() => {
    if (initialLoadStarted) return;
    initialLoadStarted = true;
    run("load", api.getState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>QAWolf Demo</h1>

      <p data-testid="counter-value" style={{ fontSize: "3rem", margin: "1rem 0" }}>
        {state.counter}
      </p>
      <p data-testid="last-action" style={{ color: "#666" }}>
        Last action: {state.lastAction}
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button data-testid="btn-increment" onClick={() => run("increment", api.increment)}>
          Increment
        </button>
        <button data-testid="btn-decrement" onClick={() => run("decrement", api.decrement)}>
          Decrement
        </button>
        <button data-testid="btn-reset" onClick={() => run("reset", api.reset)}>
          Reset
        </button>
        <button data-testid="btn-refresh" onClick={() => run("refresh", api.getState)}>
          Refresh
        </button>
      </div>

      {error && (
        <p data-testid="error" style={{ color: "crimson", marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  );
}
