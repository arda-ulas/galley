const ADJECTIVES = [
  "Bold", "Calm", "Dark", "East", "Fast",
  "Gold", "High", "Iron", "Just", "Keen",
  "Late", "Mild", "Near", "Pale", "Quick",
  "Rare", "Safe", "True", "Vast", "Warm",
];

const ANIMALS = [
  "Bear", "Crow", "Deer", "Elk", "Finch",
  "Hawk", "Ibis", "Jay", "Kite", "Lynx",
  "Mink", "Newt", "Owl", "Pike", "Quail",
  "Rook", "Sage", "Teal", "Vole", "Wren",
];

const COLORS = [
  "#F5A623",
  "#5BB8A0",
  "#A78BFA",
  "#F87171",
  "#34D399",
];

const STORAGE_KEY = "echo-rewind:identity";

export type SessionIdentity = {
  id: string;
  name: string;
  color: string;
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generate(): SessionIdentity {
  return {
    id: crypto.randomUUID(),
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
  };
}

function isValid(value: unknown): value is SessionIdentity {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.color === "string"
  );
}

function loadOrCreate(): SessionIdentity {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) return parsed;
    }
  } catch {
    // malformed JSON or sessionStorage unavailable
  }

  const identity = generate();
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // sessionStorage full or unavailable — return in-memory identity
  }
  return identity;
}

// Computed once per module load (once per tab). Stable across re-renders.
const identity = loadOrCreate();

export function useSessionIdentity(): SessionIdentity {
  return identity;
}
